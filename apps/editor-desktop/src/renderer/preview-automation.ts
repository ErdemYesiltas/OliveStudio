import {z} from 'zod';

/**
 * Preview automation beyond single key presses: frame-scheduled input scenarios, filtered read-only inspection of the
 * running world and a readiness wait. Studio supplies the ports; nothing here touches the project document.
 */
export interface PreviewRuntime {readonly paused: boolean; readonly time: number; readonly frame?: number; pause(): void; resume(): void; step(): void}
export interface PreviewEntity {id: string; name?: string; active: boolean; spatial?: string; parentId?: string | null; components?: {id: string; type: string; data: unknown}[]}
export interface PreviewPorts {
 session(): PreviewRuntime | null;
 /** Increases with every Preview start (scene changes inside a run keep it). */
 sessionId(): number;
 generation?(): number;
 sceneId(): string | null;
 /** The running input map session (keys pressed through the game's own input system). */
 input(): {paused: boolean; key(code: string, down: boolean): void} | null;
 /** Dispatch queued interaction events (rules, scripts, behaviors see input before the next step). */
 flush(): void;
 /** Draw the stepped frame and apply a pending scene change. */
 render(): void;
 setMode(mode: 'playing' | 'paused'): void;
 entities(): readonly PreviewEntity[];
 body?(id: string): {velocityX: number; velocityY: number; angularVelocity: number; sleeping: boolean; mass: number} | undefined;
 contacts?(): readonly {phase: string; a: string; b: string; sensor: boolean; time: number}[];
 scripts?(): readonly {script: string; object: string; entityId: string; state: string}[];
 behaviors?(entityId?: string): readonly unknown[] | null;
 diagnostics?(): unknown;
}

const Id = z.string().min(1).max(100), Code = z.string().regex(/^[A-Za-z0-9]{1,24}$/, 'Use a KeyboardEvent.code such as ArrowRight or Space');
export const SequenceSchema = z.object({
 frames: z.number().int().min(1).max(3600),
 events: z.array(z.object({frame: z.number().int().min(0).max(3600), code: Code, down: z.boolean()}).strict()).max(512).default([]),
 observe: z.object({objectIds: z.array(Id).max(20).default([]), every: z.number().int().min(1).max(3600).default(1), fields: z.array(z.enum(['transform', 'velocity', 'active'])).default(['transform', 'velocity'])}).strict().default({objectIds: [], every: 1, fields: ['transform', 'velocity']}),
 session: z.number().int().min(0).optional(),
}).strict().superRefine((v, c) => { if (v.events.some(e => e.frame > v.frames)) c.addIssue({code: 'custom', message: 'Event frames must be within 0…frames'}); if (Math.ceil((v.frames + 1) / v.observe.every) * Math.max(1, v.observe.objectIds.length) > 20000) c.addIssue({code: 'custom', message: 'Too many observations: raise observe.every or watch fewer objects'}); });
export type Sequence = z.infer<typeof SequenceSchema>;

const transformOf = (e: PreviewEntity) => {const type=e.spatial??'scene.transform2d',d=e.components?.find(c=>c.type===type)?.data as Record<string,number>|undefined;if(!d)return null;const keys=type==='scene3d.transform'?['x','y','z','qx','qy','qz','qw','scaleX','scaleY','scaleZ']:type==='scene.transform2d'?['x','y','rotation','scaleX','scaleY']:Object.keys(d);return Object.fromEntries(keys.filter(k=>typeof d[k]==='number'&&Number.isFinite(d[k])).map(k=>[k,d[k]]));};
const round = (v: number) => Math.round(v * 1e4) / 1e4;
function sample(p: PreviewPorts, ids: readonly string[], fields: readonly string[]) {
 const all = new Map(p.entities().map(e => [e.id, e]));
 return Object.fromEntries(ids.map(id => {
  const e = all.get(id); if (!e) return [id, null];
  const out: Record<string, unknown> = {};
  if (fields.includes('active')) out.active = e.active;
  if (fields.includes('transform')) { if(e.spatial&&e.spatial!=='scene.transform2d')out.spatial=e.spatial;const t = transformOf(e); if (t) Object.assign(out, Object.fromEntries(Object.entries(t).map(([k, v]) => [k, typeof v === 'number' ? round(v) : v]))); }
  if (fields.includes('velocity')) { const b = p.body?.(id); if (b) Object.assign(out, {vx: round(b.velocityX), vy: round(b.velocityY), angularVelocity: round(b.angularVelocity), sleeping: b.sleeping}); }
  return [id, out];
 }));
}

/**
 * Runs an input scenario frame by frame on the paused game: for frame f, the keys scheduled at f are pressed/released
 * through the input system and their events dispatched, the sample of frame f is taken (the state after f steps),
 * then one fixed 1/60 s step runs (fixedUpdate, then update). Keys still held at the end, on error or cancellation are
 * released; the previous play/pause state is restored. Stepping keeps Preview's silent-step rule (no real-time audio).
 */
const runningSequences=new WeakSet<PreviewRuntime>();
export async function runInputSequence(p: PreviewPorts, spec: Sequence, signal?: AbortSignal, yieldFrame = () => new Promise<void>(r => setTimeout(r, 0))) {
 const session = p.session(), input = p.input();
 if (!session || !input) throw Error('Start Preview first');
 if(runningSequences.has(session))throw Error('An input sequence is already running');
 if (spec.session !== undefined && spec.session !== p.sessionId()) throw Error(`Preview session ${spec.session} has ended (current session: ${p.sessionId()})`);
 const id = p.sessionId(), scene = p.sceneId(), wasPaused = session.paused, held = new Set<string>(), byFrame = new Map<number, Sequence['events']>();
 for (const e of spec.events) byFrame.set(e.frame, [...byFrame.get(e.frame) ?? [], e]);
 const samples: {frame: number; time: number; objects: Record<string, unknown>}[] = [], startTime = session.time;
 if (!wasPaused) { session.pause(); p.setMode('paused'); }
 const inputWasPaused = input.paused; input.paused = false;
 let frame = 0, stopped = '';
 runningSequences.add(session);
 try {
  for (; frame <= spec.frames; frame++) {
   if (signal?.aborted) { stopped = 'Sequence cancelled'; break; }
   if (p.session() !== session || p.sessionId() !== id) { stopped = 'Preview stopped during the sequence'; break; }
   if (p.sceneId() !== scene) { stopped = 'The scene changed during the sequence'; break; }
   for (const e of byFrame.get(frame) ?? []) { input.key(e.code, e.down); if (e.down) held.add(e.code); else held.delete(e.code); }
   p.flush();
   if (spec.observe.objectIds.length && (frame % spec.observe.every === 0 || frame === spec.frames)) samples.push({frame, time: round(session.time - startTime), objects: sample(p, spec.observe.objectIds, spec.observe.fields)});
   if (frame < spec.frames) { session.step(); p.render(); }
   if (frame % 8 === 7) await yieldFrame();
  }
 } finally {
  runningSequences.delete(session);
  // Release only the captured input session; never change a replacement session on Stop/scene change.
  input.paused = false; for (const code of held) input.key(code, false); input.paused = inputWasPaused || wasPaused;
  const live = p.input(); if (live === input && p.session() === session) p.flush();
  const now = p.session(); if (now === session && !wasPaused) { session.resume(); p.setMode('playing'); if (live) live.paused = false; }
 }
 return {session: id, generation: p.generation?.(), frame: session.frame ?? null, completed: !stopped, ...(stopped ? {stoppedAt: frame, reason: stopped} : {}), frames: spec.frames, startTime: round(startTime), endTime: round((p.session() ?? session).time), samples, released: [...held]};
}

export const InspectSchema = z.object({
 objectIds: z.array(Id).max(50).optional(), names: z.array(z.string().min(1).max(120)).max(50).optional(),
 components: z.array(z.string().min(1).max(80)).max(20).optional(),
 include: z.array(z.enum(['transform', 'physics', 'contacts', 'components', 'scripts', 'behaviors', 'diagnostics'])).default(['transform', 'physics']),
 offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(50).default(20),
 session: z.number().int().min(0).optional(),
 componentFields: z.record(z.string().max(80), z.array(z.string().min(1).max(80)).max(40)).optional(),
}).strict();
export type Inspect = z.infer<typeof InspectSchema>;
const LIMIT = 100_000;
/** Read-only view of selected runtime objects with a size cap; stale sessions are refused rather than answered from old data. */
export function inspectRuntime(p: PreviewPorts, q: Inspect) {
 const session = p.session(); if (!session) throw Error('Start Preview first');
 if (q.session !== undefined && q.session !== p.sessionId()) throw Error(`Preview session ${q.session} has ended (current session: ${p.sessionId()})`);
 const all = p.entities(), byId = new Map(all.map(e => [e.id, e]));
 let list = all.filter(e => (!q.objectIds || q.objectIds.includes(e.id)) && (!q.names || q.names.includes(e.name ?? '')) && (!q.components || e.components?.some(c => q.components!.includes(c.type))));
 const missing = (q.objectIds ?? []).filter(id => !byId.has(id)), total = list.length;
 list = list.slice(q.offset, q.offset + q.limit);
 const has = (k: Inspect['include'][number]) => q.include.includes(k), contacts = has('contacts') ? p.contacts?.() ?? [] : [], scripts = has('scripts') ? p.scripts?.() ?? [] : [];
 const objects = list.map(e => {
  const o: Record<string, unknown> = {id: e.id, name: e.name ?? '', active: e.active, parentId: e.parentId ?? null};
  if (has('transform')) {o.transform = transformOf(e);if(e.spatial&&e.spatial!=='scene.transform2d')o.spatial=e.spatial;}
  if (has('physics')) o.physics = p.body?.(e.id) ?? null;
  if (has('contacts')) o.contacts = contacts.filter(c => c.a === e.id || c.b === e.id).slice(-10).map(c => ({phase: c.phase, other: c.a === e.id ? c.b : c.a, sensor: c.sensor, time: round(c.time)}));
  if (has('components')) o.components = (e.components ?? []).filter(c => !q.components || q.components.includes(c.type)).map(c => ({id: c.id, type: c.type, data: q.componentFields?.[c.type] && c.data && typeof c.data === 'object' ? Object.fromEntries(Object.entries(c.data).filter(([key]) => q.componentFields![c.type].includes(key))) : c.data}));
  if (has('scripts')) o.scripts = scripts.filter(s => s.entityId === e.id).map(s => ({script: s.script, state: s.state}));
  if (has('behaviors')) o.behaviors = p.behaviors?.(e.id) ?? null;
  return o;
 });
 const result: Record<string, unknown> = {session: p.sessionId(), generation: p.generation?.(), frame: session.frame ?? null, sceneId: p.sceneId(), time: round(session.time), paused: session.paused, total, offset: q.offset, nextOffset: q.offset + list.length < total ? q.offset + list.length : null, missing, objects, ...(has('diagnostics') ? {diagnostics: p.diagnostics?.() ?? null} : {})};
 let text = JSON.stringify(result);
 while (text.length > LIMIT && objects.length > 1) { objects.pop(); result.nextOffset = q.offset + objects.length; result.truncated = true; text = JSON.stringify(result); }
 if (text.length > LIMIT) throw Error(`The answer would exceed ${LIMIT} characters: request fewer components or fields`);
 return result;
}

export const ReadySchema = z.object({target: z.enum(['project', 'preview']).default('project'), generation: z.number().int().min(0).optional(), timeoutMs: z.number().int().min(100).max(60000).default(10000)}).strict();
export interface Readiness {
 generation: number; busy: boolean; previewRunning: boolean;
 textures: {loading: string[]; failed: string[]; unresolved: string[]};
 visuals: {entityId: string; ready: boolean; error?: string}[];
 engines: {name: string; ready: boolean;error?:string}[];
}
/**
 * Waits until the project (or running Preview) has no pending loads. Permanent problems (failed or unresolved
 * textures, visual errors) answer `failed` at once instead of hiding behind the timeout; a project change answers
 * `cancelled`.
 */
export async function waitUntilReady(read: () => Readiness, spec: z.infer<typeof ReadySchema>, signal: AbortSignal, sleep = (ms: number) => new Promise(r => setTimeout(r, ms))) {
 const first = read(), generation = spec.generation ?? first.generation, end = Date.now() + spec.timeoutMs;
 if (first.generation !== generation) return {state: 'cancelled' as const, reason: `Project generation is ${first.generation}, not ${generation}`, generation: first.generation};
 for (;;) {
  const r = read();
  const report = {generation: r.generation, loading: [...r.textures.loading, ...r.visuals.filter(v => !v.ready && !v.error).map(v => `visual:${v.entityId}`), ...r.engines.filter(e => !e.ready).map(e => `engine:${e.name}`), ...(r.busy ? ['editor busy'] : [])], failed: [...r.textures.failed.map(id => `texture:${id}`), ...r.textures.unresolved.map(id => `missing asset:${id}`), ...r.visuals.filter(v => v.error).map(v => `visual:${v.entityId}: ${v.error}`),...r.engines.filter(e=>e.error).map(e=>`engine:${e.name}: ${e.error}`)]};
  if (signal.aborted) return {state: 'cancelled' as const, reason: 'Request cancelled', ...report};
  if (r.generation !== generation) return {state: 'cancelled' as const, reason: 'The project changed while waiting', ...report};
  if (spec.target === 'preview' && !r.previewRunning) return {state: 'failed' as const, reason: 'Preview is not running', ...report};
  if (report.failed.length) return {state: 'failed' as const, reason: 'Some resources cannot load (reimport or fix them)', ...report};
  if (!report.loading.length) return {state: 'ready' as const, ...report};
  if (Date.now() >= end) return {state: 'timeout' as const, reason: `Still loading after ${spec.timeoutMs} ms`, ...report};
  await sleep(50);
 }
}
