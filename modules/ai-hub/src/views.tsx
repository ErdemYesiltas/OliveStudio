import {useEffect, useState, useSyncExternalStore, type ReactNode} from 'react';
import {applyTemplate, gridFor, nameFromPrompt, sheetPrompt, type Generation, type GeneratePreset, type SkillChoice} from '@rewrite/ai-comfy/contracts';
import {purposeById, sizePresets, type Area, type Purpose} from '@rewrite/ai-comfy/purposes';
import {FramePreview, packSheet, png, sliceSheet, type Frame, type PromptStatus, type SheetLayout} from '@rewrite/ai-comfy/views';
import {applySnapshot, availability, decodeProblem, encodeWav, explainProblem, formatBytes, formatEta, uploadLimit, uploadName, type HubFileInfo, isActive, LocalJobSchema, manualInvite, modelsFor, outputExtension, outputKind, type Connection, type CreateCapability, type CreateRequest, type HubCapability, type HubJobInfo, type HubOutput, type HubPort, type HubStatus, type LocalJob} from './contracts';

interface Bridge {
 port: HubPort; text(key: string): string; report(error: unknown): void; useEditable(): boolean;
 connection(): Connection; setConnection(value: Connection): void; useConnection(): Connection;
 /** Jobs are kept on this machine per project (its entry scene ID). */
 projectKey(): string; useProjectKey(): string;
 /** Whether finished jobs can be imported now (editable, no Preview or file operation). */
 canImport(): boolean;
 selectedTexture(): Promise<{name: string; bytes: Uint8Array<ArrayBuffer>} | null>; useSelectedTextureName(): string | null;
 /** The selected object's sound (its clip's bytes) for audio edits. */
 selectedSound(): Promise<{name: string; bytes: Uint8Array<ArrayBuffer>} | null>; useSelectedSoundName(): string | null;
 importBytes(bytes: Uint8Array, name: string, extension: string): Promise<unknown[]>;
 /** Adds imported records and how they were made in one undo step; returns the new asset IDs. */
 adopt(records: readonly unknown[], info: Omit<Generation, 'assetId'>): string[];
 /** Adds imported records to the Library as plain imports (one undo step); returns the new asset IDs. */
 addToLibrary(records: readonly unknown[]): string[];
 thumbnail(assetId: string): string | undefined; assetName(assetId: string): string | undefined;
 place(assetId: string): void; placeAnimation(assetId: string, sheet: SheetLayout): void;
 applyToSelection(assetId: string): void; useCanApply(): {image: boolean; audio: boolean};
 clipControls(assetId: string): ReactNode;
 /** Plain-background removal on this computer (PNG in, PNG out). */
 cutout?(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>>;
 improvePrompt?(idea: string, kind: Area, onStatus: (status: PromptStatus) => void, signal: AbortSignal, skill?: SkillChoice, brief?: string): Promise<string>;
 useSkills?(): SkillChoice[];
 useInbox?(): ReadonlySet<string>; sendToLibrary?(assetIds: readonly string[]): void;
 openJobs?(): void;
}

/** What the panel makes through the hub: the Generate panel's kinds, mapped to hub capabilities. */
interface Kind {id: string; area: Area; capability: CreateCapability; purpose: Purpose; animation?: 'sheet' | 'video'; input?: 'image' | 'audio'; voice?: boolean; strength?: boolean}
const voicePurpose: Purpose = {id: 'audio.voice', area: 'audio', brief: 'a line of dialogue for a game character, read aloud', needs: 'hub.needs'};
const audioEditPurpose: Purpose = {id: 'audio.edit', area: 'audio', brief: 'how to change the selected sound', seconds: {min: 1, max: 60, value: 5}, needs: 'hub.needs'};
export const hubKinds: readonly Kind[] = [
 ...['image.sprite', 'image.background', 'image.icon', 'image.texture'].map((id): Kind => ({id, area: 'image', capability: 'image.create', purpose: purposeById(id)})),
 {id: 'image.edit', area: 'image', capability: 'image.edit', purpose: purposeById('image.edit'), input: 'image', strength: true},
 {id: 'image.sheet', area: 'image', capability: 'image.create', purpose: purposeById('image.sheet'), animation: 'sheet'},
 ...['audio.sfx', 'audio.music', 'audio.ambience'].map((id): Kind => ({id, area: 'audio', capability: 'audio.create', purpose: purposeById(id)})),
 {id: 'audio.voice', area: 'audio', capability: 'audio.speech', purpose: voicePurpose, voice: true},
 {id: 'audio.edit', area: 'audio', capability: 'audio.edit', purpose: audioEditPurpose, input: 'audio', strength: true},
 {id: 'video.sprite', area: 'video', capability: 'video.create', purpose: purposeById('video.sprite'), animation: 'video'},
 {id: 'video.selection', area: 'video', capability: 'video.create', purpose: purposeById('video.selection'), animation: 'video', input: 'image'},
 {id: 'video.effect', area: 'video', capability: 'video.create', purpose: purposeById('video.effect'), animation: 'video'},
];
const kindById = (id: string) => hubKinds.find(k => k.id === id) ?? hubKinds[0];
const kindsOf = (area: Area) => hubKinds.filter(k => k.area === area);
const areas: readonly Area[] = ['image', 'audio', 'video'];

type Pairing = {invite: string; address: string; fingerprint: string; code: string; busy: boolean; error: string};
type Result = {id: string; kind: 'image' | 'audio' | 'animation'; sheet?: SheetLayout};
type State = {
 status: HubStatus | null; checking: boolean; pairing: Pairing;
 area: Area; kinds: Record<Area, string>; models: Record<string, string>; skillId: string;
 prompt: string; negative: string; hint: boolean; size: string; seconds: number; strength: number; voice: string; steps: number; seed: number; randomSeed: boolean;
 animation: {frames: number; columns: number; fps: number; loop: boolean; motion: string}; cutout: boolean;
 submitting: boolean; writing: boolean; writer: PromptStatus | null;
 jobs: LocalJob[]; results: Result[]; review: {jobId: string; frames: Frame[]} | null; step: string;
 /** MCP servers the assistant may use through the hub in this chat. */
 servers: string[];
 /** The hub's Files tab: the list, what is shown, and per-file work. */
 files: {items: HubFileInfo[]; loading: boolean; error: string; filter: 'all' | 'image' | 'audio' | 'video' | 'other'; query: string; busy: string; done: Record<string, string[]>; confirm: string};
};
const storageKey = 'rewrite:hub-jobs';
const finished = (j: LocalJob) => ['imported', 'failed', 'cancelled', 'lost'].includes(j.state);
const safeName = (text: string) => text.replace(/[^\w .()#-]/g, '').trim().slice(0, 80) || 'generated';

async function toPng(bytes: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
 const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)]));
 try { const c = new OffscreenCanvas(bitmap.width, bitmap.height); c.getContext('2d')!.drawImage(bitmap, 0, 0); return new Uint8Array(await (await c.convertToBlob({type: 'image/png'})).arrayBuffer()); }
 finally { bitmap.close(); }
}
/** FLAC, Ogg and other sounds the browser decodes, as WAV for the Library. */
async function toWav(bytes: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
 const context = new OfflineAudioContext(1, 1, 44100), buffer = await context.decodeAudioData(new Uint8Array(bytes).buffer);
 return encodeWav(Array.from({length: Math.min(2, buffer.numberOfChannels)}, (_, c) => buffer.getChannelData(c)), buffer.sampleRate);
}
/** `count` evenly spaced frames of a video (MP4/WebM) as PNG bytes. */
async function videoFrames(bytes: Uint8Array, mime: string, count: number): Promise<Uint8Array<ArrayBuffer>[]> {
 const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], {type: mime || 'video/mp4'})), video = document.createElement('video');
 const wait = (event: string) => new Promise<void>((resolve, reject) => { const ok = () => { off(); resolve(); }, bad = () => { off(); reject(Error('The video could not be decoded')); }; const off = () => { video.removeEventListener(event, ok); video.removeEventListener('error', bad); }; video.addEventListener(event, ok); video.addEventListener('error', bad); });
 try {
  video.muted = true; video.preload = 'auto'; video.src = url;
  await wait('loadeddata');
  if (!Number.isFinite(video.duration)) { const end = wait('seeked'); video.currentTime = 1e6; await end; }
  const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : Math.max(0.1, video.currentTime), out: Uint8Array<ArrayBuffer>[] = [];
  const canvas = new OffscreenCanvas(video.videoWidth || 1, video.videoHeight || 1), ctx = canvas.getContext('2d')!;
  for (let i = 0; i < count; i++) {
   const seeked = wait('seeked');
   video.currentTime = Math.min(duration - 0.001, (i + 0.5) * duration / count);
   await seeked;
   ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(video, 0, 0);
   out.push(new Uint8Array(await (await canvas.convertToBlob({type: 'image/png'})).arrayBuffer()));
  }
  return out;
 } finally { video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url); }
}

/**
 * LocalHub views for the AI panel: the connection card (pairing, permissions, what runs on the Mac), generation of
 * images, sounds, speech and videos as hub jobs, and the job list (progress, live preview, cancel, remix). Finished
 * images and sounds are imported into the Library; animations wait for review. State lives outside the components so
 * jobs keep going while the panel is closed.
 */
export function createHubViews(bridge: Bridge) {
 const t = (key: string) => bridge.text(key);
 let state: State = {
  status: null, checking: false, pairing: {invite: '', address: '', fingerprint: '', code: '', busy: false, error: ''},
  area: 'image', kinds: {image: 'image.sprite', audio: 'audio.sfx', video: 'video.sprite'}, models: {}, skillId: '',
  prompt: '', negative: 'blurry, low quality, watermark, text', hint: true, size: 'default', seconds: 2, strength: 0.6, voice: '', steps: 0, seed: 0, randomSeed: true,
  animation: {frames: 8, columns: 4, fps: 8, loop: true, motion: ''}, cutout: true,
  submitting: false, writing: false, writer: null, jobs: [], results: [], review: null, step: '', servers: [],
  files: {items: [], loading: false, error: '', filter: 'all', query: '', busy: '', done: {}, confirm: ''},
 };
 const listeners = new Set<() => void>(), set = (patch: Partial<State>) => { state = {...state, ...patch}; for (const fn of listeners) fn(); };
 const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
 const run = (work: () => Promise<unknown> | unknown) => { try { const r = work(); if (r instanceof Promise) r.catch(error => bridge.report(Error(explainProblem(decodeProblem(error))))); } catch (error) { bridge.report(error); } };

 /** Jobs ---------------------------------------------------------------------------------------------------------- */
 const loadJobs = () => { try { const raw = JSON.parse(localStorage.getItem(storageKey) ?? '[]'); return Array.isArray(raw) ? raw.flatMap(j => { const p = LocalJobSchema.safeParse(j); return p.success ? [p.data] : []; }) : []; } catch { return []; } };
 const persist = (jobs: LocalJob[]) => { set({jobs: jobs.slice(0, 200)}); try { localStorage.setItem(storageKey, JSON.stringify(state.jobs)); } catch (error) { bridge.report(error); } };
 const update = (id: string, patch: Partial<LocalJob>) => persist(state.jobs.map(j => j.id === id ? {...j, ...patch} : j));
 let loaded = false;
 const ensureLoaded = () => { if (!loaded) { loaded = true; set({jobs: loadJobs()}); } };
 const adoptionGuards=new Map<string,()=>void>();
 const waiters = new Map<string, {resolve(ids: string[]): void; reject(error: Error): void}>();
 const settle = (id: string, result: string[] | Error) => { const w = waiters.get(id); if (!w) return; waiters.delete(id); if (result instanceof Error) w.reject(result); else w.resolve(result); };

 const importOutputs = async (job: LocalJob, outputs: readonly HubOutput[]) => {
  const allRecords:unknown[]=[], usable = outputs.filter(o => outputKind(o) === (job.kind === 'audio' ? 'audio' : 'image'));
  if (!usable.length) throw Error(`LocalHub returned no ${job.kind === 'audio' ? 'sound' : 'image'} (${outputs.map(o => o.mime || o.filename).join(', ') || 'no files'})`);
  for (const [i, output] of usable.entries()) {
   let bytes: Uint8Array<ArrayBuffer> = new Uint8Array(output.bytes), extension = outputExtension(output);
   if (job.kind === 'audio') { if (!['wav', 'mp3'].includes(extension)) { bytes = await toWav(bytes); extension = 'wav'; } }
   else { if (extension !== 'png') bytes = await toPng(bytes); extension = 'png'; if (job.cutout && bridge.cutout) bytes = await bridge.cutout(bytes); }
   const records = await bridge.importBytes(bytes, safeName(usable.length > 1 ? `${job.name}-${i + 1}` : job.name), extension);
   allRecords.push(...records);
  }
  adoptionGuards.get(job.id)?.();
  return bridge.adopt(allRecords,job.info);
 };
 const importing = new Set<string>();
 /** A finished image or sound job goes to the Library (once the project is editable); animations wait for review. */
 const finish = async (job: LocalJob) => {
  if (job.kind === 'animation' || importing.has(job.id) || job.project !== bridge.projectKey() || !bridge.canImport()) return;
  importing.add(job.id);
  try {
   const ids = await importOutputs(job, await bridge.port.outputs(job.id));
   update(job.id, {state: 'imported', assets: ids});
   set({results: [...ids.map((id): Result => ({id, kind: job.kind === 'audio' ? 'audio' : 'image'})), ...state.results].slice(0, 24)});
   settle(job.id, ids);
  } catch (error) {
   const message = explainProblem(decodeProblem(error));
   update(job.id, {state: 'failed', error: message}); settle(job.id, Error(message));
  } finally { importing.delete(job.id); }
 };
 const absorb = (hub: HubJobInfo) => {
  const local = state.jobs.find(j => j.id === hub.id);
  if (!local) return;
  const next = applySnapshot(local, hub);
  persist(state.jobs.map(j => j.id === hub.id ? next : j));
  if (next.state === 'completed') void finish(next);
  if (next.state === 'failed' || next.state === 'cancelled') settle(next.id, Error(next.error ?? (next.state === 'cancelled' ? 'Cancelled' : 'The job failed on the Mac')));
 };
 /** Polls the open jobs (events are the fast path; this catches what a dropped stream missed) and imports finished ones. */
 const tick = async () => {
  ensureLoaded();
  for (const job of state.jobs.filter(j => isActive(j))) {
   try { const hub = await bridge.port.job(job.id); if (hub) absorb(hub); else { update(job.id, {state: 'lost', error: t('hub.job.lost')}); settle(job.id, Error(t('hub.job.lost'))); } }
   catch { /* offline: try again on the next tick */ }
  }
  for (const job of state.jobs.filter(j => j.state === 'completed')) void finish(job);
 };
 let timer: ReturnType<typeof setInterval> | null = null;
 const watch = () => { if (!timer) timer = setInterval(() => { if (state.jobs.some(j => isActive(j) || j.state === 'completed' && j.kind !== 'animation')) void tick(); }, 3000); };
 const offEvents = bridge.port.onEvent(event => {
  if (event.type === 'job') { ensureLoaded(); absorb(event.job); }
  else void refresh();
 });

 /** Connection --------------------------------------------------------------------------------------------------- */
 const refresh = async () => {
  if (state.checking) return;
  set({checking: true});
  try { const status = await bridge.port.status(); set({status, servers: state.servers.filter(s => status.mcpServers.includes(s))}); if (status.paired) { watch(); void tick(); } }
  catch (error) { set({status: {paired: false, online: false, scopes: [], models: [], integrations: [], mcpServers: [], problem: decodeProblem(error)}}); }
  finally { set({checking: false}); }
 };
 const pairing = (patch: Partial<Pairing>) => set({pairing: {...state.pairing, ...patch}});
 const pair = async (invite: string) => {
  pairing({busy: true, error: ''});
  try { const status = await bridge.port.pair(invite); set({status, pairing: {invite: '', address: '', fingerprint: '', code: '', busy: false, error: ''}}); watch(); }
  catch (error) { pairing({busy: false, error: explainProblem(decodeProblem(error))}); }
 };

 /** Generation --------------------------------------------------------------------------------------------------- */
 const kind = () => kindById(state.kinds[state.area]);
 const skill = (skills: readonly SkillChoice[] = []) => skills.find(k => k.id === state.skillId);
 const presetFor = (k: Kind, choice?: SkillChoice): GeneratePreset | undefined => { const p = choice?.preset; return p && (!p.kind || p.kind === (k.area === 'audio' ? 'audio' : 'image')) ? p : undefined; };
 const sentPrompt = (k: Kind, prompt: string, preset?: GeneratePreset) => preset?.prompt.trim() ? applyTemplate(preset.prompt, prompt) : state.hint && k.purpose.hint ? applyTemplate(k.purpose.hint, prompt) : prompt.trim();
 const sizesFor = (k: Kind) => [...sizePresets(k.purpose, 512).map(p => ({...p, label: `${p.label} · ${p.width}×${p.height}`})), ...sizePresets(k.purpose, 1024).map(p => ({...p, label: `${p.label} · ${p.width}×${p.height}`}))];
 const chooseKind = (id: string) => {
  const k = kindById(id), presets = sizesFor(k), wide = k.purpose.aspects?.[0] && k.purpose.aspects[0][0] !== k.purpose.aspects[0][1];
  set({area: k.area, kinds: {...state.kinds, [k.area]: k.id}, size: wide ? presets[Math.floor(presets.length / 2)]?.label ?? 'default' : 'default', seconds: k.purpose.seconds?.value ?? (k.animation === 'video' ? 2 : state.seconds), ...(k.purpose.cutout !== undefined ? {cutout: k.purpose.cutout} : {}), animation: {...state.animation, loop: k.purpose.loop ?? state.animation.loop}});
 };
 const add = (job: LocalJob) => { persist([job, ...state.jobs]); watch(); };
 /** Submits one request as a hub job (speech answers at once and is imported directly). */
 const submit = async (request: CreateRequest, meta: Pick<LocalJob, 'name' | 'kind' | 'purpose' | 'info'> & Partial<Pick<LocalJob, 'cutout' | 'animation' | 'video'>>,beforeAdopt?:()=>void) => {
  ensureLoaded();
  const reply = await bridge.port.create(request);
  const base: LocalJob = {id: reply.job?.id ?? `speech-${crypto.randomUUID()}`, project: bridge.projectKey(), capability: request.capability, createdAt: Date.now(), state: 'queued', ...meta};
  if(beforeAdopt)adoptionGuards.set(base.id,beforeAdopt);
  if (reply.output) {
   const ids = await importOutputs(base, [reply.output]);
   add({...base, state: 'imported', assets: ids});
   set({results: [...ids.map((id): Result => ({id, kind: 'audio'})), ...state.results].slice(0, 24)});
   return {job: base, ids};
  }
  const job = applySnapshot(base, reply.job!);
  add(job);
  if (job.state === 'completed') void finish(job);
  return {job};
 };
 const generate = async (skills: readonly SkillChoice[]) => {
  const k = kind(), choice = skill(skills), preset = presetFor(k, choice), typed = state.prompt.trim();
  if (!typed) throw Error(t('comfy.promptFirst'));
  const seed = state.randomSeed ? Math.floor(Math.random() * 2 ** 32) : state.seed, size = sizesFor(k).find(x => x.label === state.size);
  const width = preset?.width ?? size?.width, height = preset?.height ?? size?.height, steps = preset?.steps ?? (state.steps || undefined), negative = preset?.negative ?? (k.area === 'audio' ? '' : state.negative);
  const image = k.input === 'image' ? await bridge.selectedTexture() : null, audio = k.input === 'audio' ? await bridge.selectedSound() : null;
  if (k.input === 'image' && !image) throw Error(t('comfy.needsImage'));
  if (k.input === 'audio' && !audio) throw Error(t('hub.needsSound'));
  let prompt = sentPrompt(k, typed, preset);
  const a = state.animation, frames = Math.max(2, Math.min(32, Math.round(a.frames))), grid = gridFor(frames, a.columns);
  if (k.animation === 'sheet') prompt = sheetPrompt(prompt, a.motion, frames, grid.columns, grid.rows);
  if (k.animation === 'video' && a.motion.trim()) prompt = `${prompt}, ${a.motion.trim()}`;
  const model = state.models[k.capability] || undefined, seconds = k.animation === 'video' ? Math.max(1, Math.round(frames / a.fps * 10) / 10) : k.purpose.seconds || k.input === 'audio' ? state.seconds : undefined;
  const request: CreateRequest = {capability: k.capability, prompt, ...(model ? {model} : {}), ...(k.capability !== 'audio.speech' ? {seed, ...(steps ? {steps} : {}), ...(negative ? {negative} : {})} : {}),
   ...(width && height && k.area !== 'audio' ? {width, height} : {}), ...(seconds && k.capability !== 'audio.speech' ? {seconds} : {}), ...(k.strength ? {strength: state.strength} : {}),
   ...(k.voice && state.voice.trim() ? {voice: state.voice.trim()} : {}), ...(image ? {image: image.bytes} : {}), ...(audio ? {audio: audio.bytes} : {})};
  const info: Omit<Generation, 'assetId'> = {workflow: model ?? `LocalHub · ${k.capability}`, prompt, negative: negative ?? '', seed, steps: steps ?? 0, cfg: 0, width: width ?? 0, height: height ?? 0, model: model ?? '', createdAt: new Date().toISOString(),
   kind: k.animation ? 'animation' : k.area === 'audio' ? 'audio' : 'image', purpose: k.id, ...(choice ? {skill: choice.name} : {}), ...(seconds && k.area === 'audio' ? {seconds} : {}), ...(k.animation ? {frames, fps: a.fps, method: k.animation} : {})};
  set({submitting: true, seed});
  try {
   await submit(request, {name: `${nameFromPrompt(typed, seed)}${k.animation ? '-anim' : ''}`.slice(0, 80), kind: info.kind, purpose: k.id, info,
    ...(k.purpose.cutout !== undefined ? {cutout: state.cutout} : {}), ...(k.animation ? {animation: {method: k.animation, frames, columns: grid.columns, fps: a.fps, loop: a.loop}} : {}), ...(k.capability === 'video.create' ? {video: true} : {})});
  } finally { set({submitting: false}); }
 };
 const remix = async (job: LocalJob, prompt: string) => {
  if (!prompt.trim()) throw Error(t('comfy.promptFirst'));
  await submit({capability: 'video.edit', prompt: prompt.trim(), videoId: job.id}, {name: `${job.name}-remix`.slice(0, 80), kind: job.kind, purpose: job.purpose, info: {...job.info, prompt: prompt.trim(), createdAt: new Date().toISOString()}, ...(job.animation ? {animation: job.animation} : {}), ...(job.cutout !== undefined ? {cutout: job.cutout} : {}), video: true});
 };
 /** Review and pack animations -------------------------------------------------------------------------------- */
 const showFrames = (jobId: string, frames: Uint8Array<ArrayBuffer>[]) => { for (const f of state.review?.frames ?? []) URL.revokeObjectURL(f.url); set({review: {jobId, frames: frames.map(bytes => ({id: crypto.randomUUID(), url: URL.createObjectURL(png(bytes)), bytes, on: true}))}}); };
 const framesOf = async (job: LocalJob) => {
  const a = job.animation; if (!a) throw Error('Not an animation');
  set({step: t('comfy.step.fetch')});
  try {
   const outputs = job.file ? [await bridge.port.fileContent(job.file)] : await bridge.port.outputs(job.id);
   if (a.method === 'video') { const video = outputs.find(o => outputKind(o) === 'video'); if (!video) throw Error('LocalHub returned no video'); return videoFrames(video.bytes, video.mime, a.frames); }
   const sheet = outputs.find(o => outputKind(o) === 'image'); if (!sheet) throw Error('LocalHub returned no image');
   return sliceSheet(await toPng(sheet.bytes), a.columns, Math.ceil(a.frames / a.columns), a.frames);
  } finally { set({step: ''}); }
 };
 const review = async (job: LocalJob) => { showFrames(job.id, await framesOf(job)); };
 const createAnimation = async (job: LocalJob, chosen?: readonly Uint8Array<ArrayBuffer>[], automation?:{check():void;place:boolean}) => {
  const a = job.animation; if (!a) return;
  let frames = chosen ?? await framesOf(job);
  if (!frames.length) throw Error(t('comfy.noFrames'));
  set({step: t('comfy.step.pack')});
  try {
   if (job.cutout && bridge.cutout) frames = await Promise.all(frames.map(f => bridge.cutout!(f)));
   const sheet = await packSheet(frames, a.columns), layout: SheetLayout = {columns: sheet.columns, rows: sheet.rows, frames: frames.length, fps: a.fps, loop: a.loop, width: sheet.width, height: sheet.height};
   const records=await bridge.importBytes(sheet.bytes,safeName(`${job.name}-sheet`),'png');automation?.check();
   const ids=bridge.adopt(records,{...job.info,frames:frames.length,fps:a.fps});
   if (!ids[0]) throw Error('The sprite sheet was not imported');
   if(automation?.place!==false)bridge.placeAnimation(ids[0],layout);
   update(job.id, {state: 'imported', assets: ids, layout});
   set({results: [{id: ids[0], kind: 'animation' as const, sheet: layout}, ...state.results].slice(0, 24), ...(state.review?.jobId === job.id ? {review: null} : {})});
   return{assetIds:ids,layout};
  } finally { set({step: ''}); }
 };
 let writerAbort: AbortController | null = null;
 const writePrompt = async (skills: readonly SkillChoice[]) => {
  if (!bridge.improvePrompt || state.writing) return;
  writerAbort = new AbortController();
  set({writing: true, writer: {phase: 'connecting'}});
  try { const k = kind(); set({prompt: await bridge.improvePrompt(state.prompt, k.area, writer => set({writer}), writerAbort.signal, skill(skills), k.purpose.brief)}); }
  catch (error) { const message = error instanceof Error ? error.message : String(error); set({writer: message === 'Cancelled' ? {phase: 'cancelled'} : {phase: 'failed', message}}); }
  finally { writerAbort = null; set({writing: false}); }
 };
 const writerText = (w: PromptStatus) => w.phase === 'failed' ? w.message ?? t('comfy.writer.failed') : t(`comfy.writer.${w.phase}`).replace('{model}', w.model ?? '').replace('{chars}', String(w.chars ?? 0)).replace('{seconds}', String(w.seconds ?? 0));
 const ready = (capability: HubCapability) => availability(state.status, capability);
 const why = (capability: HubCapability) => { const a = ready(capability); return a === 'ready' ? '' : t(`hub.unavailable.${a}`).replace('{capability}', capability); };

 /** Components ------------------------------------------------------------------------------------------------- */
 function Connection() {
  const s = useSyncExternalStore(subscribe, () => state), connection = bridge.useConnection(), p = s.pairing, status = s.status;
  useEffect(() => { ensureLoaded(); if (!state.status) void refresh(); }, []);
  const missing = status?.paired && status.online ? (['chat', 'image.create', 'audio.create', 'video.create'] as const).filter(c => !status.scopes.includes(c)) : [];
  return <section className="hub-connection" aria-label={t('hub.connection')} data-testid="hub-connection" data-paired={status?.paired ?? false} data-online={status?.online ?? false} data-connection={connection}>
   <label className="field"><span>{t('hub.connection')}</span><select aria-label={t('hub.connection')} value={connection} onChange={e => { bridge.setConnection(e.target.value as Connection); void refresh(); }}>
    {(['auto', 'localhub', 'direct'] as const).map(v => <option key={v} value={v}>{t(`setting.aiConnection.${v}`)}</option>)}
   </select></label>
   {connection !== 'direct' && (status?.paired ? <>
    <div className="generate-status" role="status" data-testid="hub-status">
     <span className={status.online ? 'status-dot online' : 'status-dot'} aria-hidden="true"/>
     <span>{status.online ? `${t('hub.connected')} · ${status.hubName ?? status.address}` : `${t('hub.offline')} · ${status.hubName ?? status.address}`}</span>
     <button onClick={() => run(refresh)} disabled={s.checking}>{t('comfy.retry')}</button>
     <button onClick={() => run(async () => { await bridge.port.unpair(); await refresh(); })}>{t('hub.unpair')}</button>
    </div>
    {status.problem && <p className="component-warning" role="alert" data-testid="hub-problem" data-code={status.problem.code}>{explainProblem(status.problem)}</p>}
    {missing.length > 0 && <p className="panel-empty" data-testid="hub-missing">{t('hub.missingScopes').replace('{scopes}', missing.join(', '))}</p>}
    {status.online && <details className="hub-details"><summary>{t('hub.onMac')}</summary>
     <ul aria-label={t('hub.integrations')}>{status.integrations.map(i => <li key={i.id} data-state={i.state}><span className={i.state === 'running' ? 'status-dot online' : 'status-dot'} aria-hidden="true"/>{i.name}<small>{[i.state, i.detail].filter(Boolean).join(' · ')}</small></li>)}</ul>
     <p><small>{t('hub.scopes')}: {status.scopes.join(', ') || '—'}</small></p>
    </details>}
   </> : <details className="hub-pair" data-testid="hub-pair" open={connection === 'localhub' || Boolean(p.error)}>
    <summary>{t('hub.connect')}</summary>
    <p className="panel-empty">{t('hub.pairHelp')}</p>
    <label className="field generate-prompt"><span>{t('hub.invite')}</span><textarea aria-label={t('hub.invite')} rows={2} placeholder="localhub://pair?v=2&u=…" value={p.invite} disabled={p.busy} onChange={e => pairing({invite: e.target.value})}/></label>
    <div className="panel-actions"><button className="primary" disabled={p.busy || !p.invite.trim()} onClick={() => run(() => pair(p.invite))}>{p.busy && <span className="spinner" aria-hidden="true"/>}{t('hub.pair')}</button></div>
    <details><summary>{t('hub.manual')}</summary>
     <label className="field"><span>{t('hub.address')}</span><input aria-label={t('hub.address')} placeholder="192.168.1.20:8790" value={p.address} onChange={e => pairing({address: e.target.value})}/></label>
     <label className="field"><span>{t('hub.fingerprint')}</span><input aria-label={t('hub.fingerprint')} value={p.fingerprint} onChange={e => pairing({fingerprint: e.target.value})}/></label>
     <label className="field"><span>{t('hub.code')}</span><input aria-label={t('hub.code')} inputMode="numeric" maxLength={6} value={p.code} onChange={e => pairing({code: e.target.value})}/></label>
     <button disabled={p.busy || !p.address.trim() || !p.fingerprint.trim() || !/^\d{6}$/.test(p.code.trim())} onClick={() => run(() => pair(manualInvite(p.address, p.fingerprint, p.code)))}>{t('hub.pair')}</button>
    </details>
    {p.error && <p className="component-warning" role="alert" data-testid="hub-pair-error">{p.error}</p>}
    {status?.problem && !p.error && <p className="component-warning" role="alert">{explainProblem(status.problem)}</p>}
   </details>)}
  </section>;
 }

 /** Generation tab (LocalHub): kinds, model per capability, prompt, options; results land in the Library. */
 function Create() {
  const s = useSyncExternalStore(subscribe, () => state), editable = bridge.useEditable(), selectedName = bridge.useSelectedTextureName(), soundName = bridge.useSelectedSoundName(), canApply = bridge.useCanApply(), inbox = bridge.useInbox?.();
  const skills = bridge.useSkills?.() ?? [], k = kindById(s.kinds[s.area]), choice = skill(skills), preset = presetFor(k, choice), models = modelsFor(s.status, k.capability), why0 = why(k.capability), sizes = sizesFor(k), busy = s.submitting || Boolean(s.step);
  useEffect(() => { ensureLoaded(); if (!state.status) void refresh(); }, []);
  const a = s.animation, animate = (patch: Partial<State['animation']>) => set({animation: {...state.animation, ...patch}});
  const blocked = !editable || busy || Boolean(why0) || !s.prompt.trim() || (k.input === 'image' && !selectedName) || (k.input === 'audio' && !soundName);
  return <div className="hub-create" data-testid="hub-create" data-kind={k.id}>
   <div className="generate-areas" role="tablist" aria-label={t('comfy.area')}>{areas.map(area => <button key={area} role="tab" aria-selected={s.area === area} data-area={area} disabled={busy} onClick={() => chooseKind(state.kinds[area])}>{t(`comfy.area.${area}`)}</button>)}</div>
   <div className="generate-purposes" role="radiogroup" aria-label={t('comfy.purpose')} data-testid="hub-kinds"><div>{kindsOf(s.area).map(x => <button key={x.id} role="radio" aria-checked={x.id === k.id} data-purpose={x.id} title={t(`hub.kind.${x.id}.help`) === `hub.kind.${x.id}.help` ? t(`comfy.purpose.${x.id}.help`) : t(`hub.kind.${x.id}.help`)} disabled={busy} onClick={() => chooseKind(x.id)}>{t(`hub.kind.${x.id}`) === `hub.kind.${x.id}` ? t(`comfy.purpose.${x.id}`) : t(`hub.kind.${x.id}`)}</button>)}</div></div>
   {why0 && <p className="component-warning" data-testid="hub-unavailable">{why0}</p>}
   <label className="field"><span>{t('comfy.model')}</span><select aria-label={t('comfy.model')} value={s.models[k.capability] ?? ''} disabled={busy} onChange={e => set({models: {...state.models, [k.capability]: e.target.value}})}>
    <option value="">{t('hub.macDefault')}</option>{models.map(m => <option key={m.id} value={m.id}>{m.id}</option>)}
   </select></label>
   {skills.length > 0 && k.capability !== 'audio.speech' && <label className="field"><span>{t('comfy.skill')}</span><select aria-label={t('comfy.skill')} value={choice?.id ?? ''} disabled={busy} onChange={e => set({skillId: e.target.value})}><option value="">{t('comfy.noSkill')}</option>{skills.filter(x => !x.preset?.kind || x.preset.kind === (k.area === 'audio' ? 'audio' : 'image') || x.id === choice?.id).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>}
   {k.input === 'image' && <p className="panel-empty" data-testid="generate-input-image">{selectedName ? `${t('comfy.inputImage')}: ${selectedName}` : t('comfy.needsImage')}</p>}
   {k.input === 'audio' && <p className="panel-empty" data-testid="generate-input-sound">{soundName ? `${t('hub.inputSound')}: ${soundName}` : t('hub.needsSound')}</p>}
   <label className="field generate-prompt"><span>{k.voice ? t('hub.line') : t('comfy.prompt')}</span><textarea aria-label={k.voice ? t('hub.line') : t('comfy.prompt')} rows={3} value={s.prompt} disabled={busy} onChange={e => set({prompt: e.target.value})}/></label>
   {preset?.prompt.trim() && <p className="generate-template" data-testid="skill-template">{t('comfy.skillTemplate').replace('{template}', preset.prompt)}</p>}
   {!k.voice && k.purpose.hint && !preset?.prompt.trim() && <label className="checkbox generate-hint"><input type="checkbox" aria-label={t('comfy.hint')} checked={s.hint} disabled={busy} onChange={e => set({hint: e.target.checked})}/>{t('comfy.hint')}{s.hint && <small data-testid="purpose-template">{k.purpose.hint.replace('{prompt}', '…')}</small>}</label>}
   {!k.voice && bridge.improvePrompt && <div className="prompt-writer">
    <div className="panel-actions">{s.writing ? <button onClick={() => writerAbort?.abort()}>{t('comfy.cancelWriting')}</button> : <button disabled={busy || !s.prompt.trim()} title={t('comfy.writePromptHint')} onClick={() => run(() => writePrompt(skills))}>{`✨ ${t('comfy.writePrompt')}`}</button>}</div>
    {s.writer && <p className={`prompt-writer-status ${s.writer.phase}`} role="status" aria-live="polite" data-testid="prompt-writer-status" data-phase={s.writer.phase}>{s.writing && <span className="spinner" aria-hidden="true"/>}{writerText(s.writer)}</p>}
   </div>}
   {k.voice && <label className="field"><span>{t('hub.voice')}</span><input aria-label={t('hub.voice')} placeholder={t('hub.voiceHint')} value={s.voice} disabled={busy} onChange={e => set({voice: e.target.value})}/></label>}
   {(k.purpose.seconds || k.input === 'audio') && <label className="field"><span>{t('comfy.seconds')}</span><input type="number" aria-label={t('comfy.seconds')} min={k.purpose.seconds?.min ?? 1} max={k.purpose.seconds?.max ?? 60} step={0.5} value={s.seconds} disabled={busy} onChange={e => { const v = Number(e.target.value); if (Number.isFinite(v) && v > 0) set({seconds: v}); }}/></label>}
   {k.area !== 'audio' && !preset?.width && <label className="field"><span>{t('comfy.size')}</span><select aria-label={t('comfy.size')} value={s.size} disabled={busy} onChange={e => set({size: e.target.value})}><option value="default">{t('hub.macDefault')}</option>{sizes.map(x => <option key={x.label} value={x.label}>{x.label}</option>)}</select></label>}
   {k.strength && <label className="field generate-amount"><span>{t('comfy.changeAmount')}</span><input type="range" aria-label={t('comfy.changeAmount')} min={0.05} max={1} step={0.05} value={s.strength} disabled={busy} onChange={e => set({strength: Number(e.target.value)})}/><output>{Math.round(s.strength * 100)}%</output></label>}
   {k.purpose.cutout !== undefined && bridge.cutout && <label className="checkbox" title={t('hub.cutoutHint')}><input type="checkbox" aria-label={t('comfy.removeBackground')} checked={s.cutout} disabled={busy} onChange={e => set({cutout: e.target.checked})}/>{t('comfy.removeBackground')}</label>}
   {k.animation && <div className="generate-animation" data-testid="animation-settings">
    <label className="field"><span>{t('comfy.motion')}</span><input aria-label={t('comfy.motion')} placeholder={t('comfy.motionHint')} value={a.motion} disabled={busy} onChange={e => animate({motion: e.target.value})}/></label>
    <div className="inline-row">
     <label className="field"><span>{t('comfy.frames')}</span><input type="number" aria-label={t('comfy.frames')} min={2} max={32} value={a.frames} disabled={busy} onChange={e => { const v = Math.round(Number(e.target.value)); if (v >= 2 && v <= 32) animate({frames: v, columns: Math.min(a.columns, v)}); }}/></label>
     <label className="field"><span>{t('comfy.columns')}</span><input type="number" aria-label={t('comfy.columns')} min={1} max={a.frames} value={a.columns} disabled={busy} onChange={e => { const v = Math.round(Number(e.target.value)); if (v >= 1 && v <= a.frames) animate({columns: v}); }}/></label>
     <label className="field"><span>{t('comfy.fps')}</span><input type="number" aria-label={t('comfy.fps')} min={1} max={60} value={a.fps} onChange={e => { const v = Number(e.target.value); if (v >= 1 && v <= 60) animate({fps: v}); }}/></label>
    </div>
    <label className="checkbox"><input type="checkbox" aria-label={t('comfy.loop')} checked={a.loop} onChange={e => animate({loop: e.target.checked})}/>{t('comfy.loop')}</label>
   </div>}
   {k.capability !== 'audio.speech' && <details className="generate-advanced"><summary>{t('comfy.advanced')}</summary>
    {k.area !== 'audio' && <label className="field generate-prompt"><span>{t('comfy.negative')}</span><textarea aria-label={t('comfy.negative')} rows={2} value={s.negative} disabled={busy} onChange={e => set({negative: e.target.value})}/></label>}
    <label className="field"><span>{t('comfy.steps')}</span><input type="number" aria-label={t('comfy.steps')} min={0} max={200} value={s.steps} placeholder={t('hub.macDefault')} disabled={busy} onChange={e => { const v = Math.round(Number(e.target.value)); if (v >= 0 && v <= 200) set({steps: v}); }}/></label>
    <label className="field"><span>{t('comfy.seed')}</span><input type="number" aria-label={t('comfy.seed')} value={s.seed} disabled={busy || s.randomSeed} onChange={e => { const v = Math.round(Number(e.target.value)); if (v >= 0) set({seed: v}); }}/></label>
    <label className="checkbox"><input type="checkbox" aria-label={t('comfy.randomSeed')} checked={s.randomSeed} disabled={busy} onChange={e => set({randomSeed: e.target.checked})}/>{t('comfy.randomSeed')}</label>
   </details>}
   <button className="primary" data-testid="hub-generate" disabled={blocked} onClick={() => run(() => generate(skills))}>{s.submitting && <span className="spinner" aria-hidden="true"/>}{k.animation ? t('comfy.generateFrames') : t('comfy.generate')}</button>
   <JobsSummary/>
   <Review/>
   {s.results.length > 0 && <div className="generate-results" role="list" aria-label={t('comfy.results')}>
    {s.results.map(({id, kind: rk, sheet}) => { const url = rk !== 'audio' ? bridge.thumbnail(id) : undefined, name = bridge.assetName(id); return name ? <div role="listitem" key={id} className={`generate-result ${rk}`} data-asset={id} data-kind={rk}>
     {url && <img src={url} alt={name}/>}{rk === 'audio' && <div className="generate-audio" aria-hidden="true">♪</div>}<small>{name}</small>
     {rk === 'audio' && bridge.clipControls(id)}
     {inbox && bridge.sendToLibrary && (inbox.has(id) ? <button className="generate-send" aria-label={`${t('comfy.sendToLibrary')} ${name}`} title={t('comfy.sendToLibraryHint')} disabled={!editable} onClick={() => run(() => bridge.sendToLibrary!([id]))}>{`📥 ${t('comfy.sendToLibrary')}`}</button> : <small className="generate-sent" data-testid="in-library">{t('comfy.inLibrary')}</small>)}
     <div className="panel-actions">
      {rk !== 'audio' && <button disabled={!editable} aria-label={`${t('comfy.place')} ${name}`} onClick={() => run(() => sheet ? bridge.placeAnimation(id, sheet) : bridge.place(id))}>{t('comfy.place')}</button>}
      {rk === 'audio' && <button disabled={!editable} aria-label={`${t('comfy.place')} ${name}`} onClick={() => run(() => bridge.place(id))}>{t('comfy.place')}</button>}
      {rk !== 'animation' && <button disabled={!editable || !(rk === 'audio' ? canApply.audio : canApply.image)} aria-label={`${rk === 'audio' ? t('comfy.applySound') : t('comfy.apply')} ${name}`} onClick={() => run(() => bridge.applyToSelection(id))}>{rk === 'audio' ? t('comfy.applySound') : t('comfy.apply')}</button>}
     </div>
    </div> : null; })}
   </div>}
  </div>;
 }
 /** Frames of an animation job: preview, pick, pack into an Animated sprite. */
 function Review() {
  const s = useSyncExternalStore(subscribe, () => state), editable = bridge.useEditable(), job = s.review && s.jobs.find(j => j.id === s.review!.jobId);
  if (!s.review || !job) return s.step ? <p className="prompt-writer-status" role="status" data-testid="animation-step"><span className="spinner" aria-hidden="true"/>{s.step}</p> : null;
  const frames = s.review.frames;
  return <div className="generate-frames" data-testid="animation-frames" data-job={job.id}>
   <FramePreview frames={frames} fps={job.animation?.fps ?? 8} label={t('comfy.animationPreview')}/>
   <div className="generate-frame-strip" role="list" aria-label={t('comfy.frameList')}>{frames.map((f, i) => <label role="listitem" key={f.id} className={`generate-frame${f.on ? '' : ' off'}`}><img src={f.url} alt=""/><input type="checkbox" aria-label={t('comfy.useFrame').replace('{n}', String(i + 1))} checked={f.on} disabled={Boolean(s.step)} onChange={e => set({review: {jobId: job.id, frames: frames.map(x => x.id === f.id ? {...x, on: e.target.checked} : x)}})}/></label>)}</div>
   {s.step && <p className="prompt-writer-status" role="status" data-testid="animation-step"><span className="spinner" aria-hidden="true"/>{s.step}</p>}
   <button className="primary" disabled={!editable || Boolean(s.step) || !frames.some(f => f.on)} onClick={() => run(() => createAnimation(job, frames.filter(f => f.on).map(f => f.bytes)))}>{t('comfy.createAnimation')}</button>
  </div>;
 }
 function JobsSummary() {
  const s = useSyncExternalStore(subscribe, () => state), key = bridge.useProjectKey(), mine = s.jobs.filter(j => j.project === key);
  const active = mine.filter(isActive).length, waiting = mine.filter(j => j.state === 'completed' && j.kind === 'animation').length;
  if (!active && !waiting) return null;
  return <p className="generate-jobs" role="status" data-testid="jobs-summary">{[active ? t('comfy.jobs.active').replace('{n}', String(active)) : '', waiting ? t('comfy.jobs.ready').replace('{n}', String(waiting)) : ''].filter(Boolean).join(' · ')}{bridge.openJobs && <button onClick={bridge.openJobs}>{t('comfy.jobs.open')}</button>}</p>;
 }
 /** Live preview frame of a running job, refreshed every two seconds. */
 function LivePreview({id}: {id: string}) {
  const [url, setUrl] = useState('');
  useEffect(() => {
   let current = '', alive = true;
   const load = async () => { const bytes = await bridge.port.preview(id).catch(() => null); if (!alive || !bytes) return; const next = URL.createObjectURL(new Blob([new Uint8Array(bytes)])); if (current) URL.revokeObjectURL(current); current = next; setUrl(next); };
   void load(); const timer = setInterval(() => void load(), 2000);
   return () => { alive = false; clearInterval(timer); if (current) URL.revokeObjectURL(current); };
  }, [id]);
  return url ? <img className="hub-preview" src={url} alt="" data-testid="job-preview"/> : null;
 }
 const jobText = (j: LocalJob) => {
  if (j.state === 'queued') return [t('comfy.job.queued'), j.detail].filter(Boolean).join(' · ');
  if (j.state === 'in_progress') return [`${Math.round((j.progress ?? 0) * 100)}%`, j.detail, formatEta(j.eta)].filter(Boolean).join(' · ');
  if (j.state === 'failed' || j.state === 'lost') return j.error ?? t(`hub.job.${j.state}`);
  return t(`hub.job.${j.state === 'completed' && j.kind === 'animation' ? 'ready' : j.state}`);
 };
 /** Jobs tab (LocalHub): this project's jobs, newest first; they run on the Mac whether or not the editor is open. */
 function Jobs() {
  const s = useSyncExternalStore(subscribe, () => state), key = bridge.useProjectKey(), editable = bridge.useEditable(), jobs = s.jobs.filter(j => j.project === key), inbox = bridge.useInbox?.();
  const [remixing, setRemixing] = useState<{id: string; prompt: string} | null>(null);
  useEffect(() => { ensureLoaded(); if (!state.status) void refresh(); else void tick(); }, []);
  return <div className="hub-jobs jobs-panel" data-testid="hub-jobs">
   {!jobs.length && <p className="panel-empty">{t('hub.jobs.empty')}</p>}
   <div role="list" aria-label={t('hub.jobs')}>{jobs.map(j => { const thumb = j.assets?.[0] && j.kind !== 'audio' ? bridge.thumbnail(j.assets[0]) : undefined; return <div role="listitem" key={j.id} className={`job ${j.state}`} data-job={j.id} data-state={j.state} data-kind={j.kind}>
    {thumb && <img src={thumb} alt=""/>}
    {j.state === 'in_progress' && j.preview && <LivePreview id={j.id}/>}
    <div className="job-body">
     <strong>{j.name}</strong>
     <small>{t(`comfy.kind.${j.kind}`)} · {j.capability} · {new Date(j.createdAt).toLocaleTimeString()}</small>
     {j.state === 'in_progress' && <progress max={1} value={j.progress ?? 0} aria-label={j.name}/>}
     <span className="job-state" data-testid="job-state">{isActive(j) && <span className="spinner" aria-hidden="true"/>}{jobText(j)}</span>
     <div className="panel-actions">
      {isActive(j) && <button aria-label={`${t('comfy.cancel')} ${j.name}`} onClick={() => run(async () => { await bridge.port.cancelJob(j.id); await tick(); })}>{t('comfy.cancel')}</button>}
      {j.state === 'completed' && j.kind === 'animation' && <><button disabled={!editable || Boolean(s.step)} aria-label={`${t('comfy.job.review')} ${j.name}`} onClick={() => run(() => review(j))}>{t('comfy.job.review')}</button><button disabled={!editable || Boolean(s.step)} aria-label={`${t('comfy.createAnimation')} ${j.name}`} onClick={() => run(() => createAnimation(j))}>{t('comfy.createAnimation')}</button></>}
      {j.state === 'imported' && j.assets?.[0] && j.kind !== 'audio' && <button disabled={!editable} aria-label={`${t('comfy.place')} ${j.name}`} onClick={() => run(() => j.layout ? bridge.placeAnimation(j.assets![0], j.layout) : bridge.place(j.assets![0]))}>{t('comfy.place')}</button>}
      {inbox && bridge.sendToLibrary && j.state === 'imported' && j.assets?.some(a => inbox.has(a)) && <button aria-label={`${t('comfy.sendToLibrary')} ${j.name}`} disabled={!editable} onClick={() => run(() => bridge.sendToLibrary!(j.assets!.filter(a => inbox.has(a))))}>{`📥 ${t('comfy.sendToLibrary')}`}</button>}
      {j.video && (j.state === 'completed' || j.state === 'imported') && <button aria-label={`${t('hub.remix')} ${j.name}`} disabled={!editable || ready('video.edit') !== 'ready'} title={why('video.edit')} onClick={() => setRemixing({id: j.id, prompt: ''})}>{t('hub.remix')}</button>}
      {finished(j) && <button aria-label={`${t('comfy.job.remove')} ${j.name}`} onClick={() => persist(state.jobs.filter(x => x.id !== j.id))}>{t('comfy.job.remove')}</button>}
     </div>
     {remixing?.id === j.id && <div className="hub-remix"><input aria-label={t('hub.remixPrompt')} placeholder={t('hub.remixPrompt')} value={remixing.prompt} onChange={e => setRemixing({id: j.id, prompt: e.target.value})}/><button className="primary" disabled={!remixing.prompt.trim()} onClick={() => run(async () => { await remix(j, remixing.prompt); setRemixing(null); })}>{t('hub.remix')}</button></div>}
    </div>
   </div>; })}</div>
   {jobs.some(finished) && <button onClick={() => persist(state.jobs.filter(j => j.project !== key || !finished(j)))}>{t('comfy.jobs.clear')}</button>}
  </div>;
 }
 /** Files ------------------------------------------------------------------------------------------------------- */
 const files = (patch: Partial<State['files']>) => set({files: {...state.files, ...patch}});
 const loadFiles = async () => {
  files({loading: true, error: ''});
  try { files({items: await bridge.port.files(), loading: false}); }
  catch (error) { files({loading: false, error: explainProblem(decodeProblem(error))}); }
 };
 const fileKind = (f: Pick<HubFileInfo, 'mime' | 'filename'>) => outputKind({mime: f.mime, filename: f.filename});
 /** Images and sounds go to the Library: job outputs with how they were made, uploads as plain imports. */
 const importFile = async (f: HubFileInfo,check?:()=>void) => {
  if (!bridge.canImport()) throw Error(t('hub.files.notNow'));
  files({busy: f.id});
  try {
   const output = await bridge.port.fileContent(f.id), kind = fileKind(f);
   if (kind !== 'image' && kind !== 'audio') throw Error(t('hub.files.cannotImport'));
   let bytes: Uint8Array<ArrayBuffer> = new Uint8Array(output.bytes), extension = outputExtension(output);
   if (kind === 'audio' && !['wav', 'mp3'].includes(extension)) { bytes = await toWav(bytes); extension = 'wav'; }
   if (kind === 'image' && extension !== 'png') { bytes = await toPng(bytes); extension = 'png'; }
   const records = await bridge.importBytes(bytes, safeName(f.filename.replace(/\.[a-z0-9]+$/i, '')), extension);
   check?.();
   const ids = f.source === 'job' ? bridge.adopt(records, {workflow: 'LocalHub · files', prompt: f.filename, negative: '', seed: 0, steps: 0, cfg: 0, width: 0, height: 0, model: '', createdAt: new Date(f.createdAt * 1000).toISOString(), kind}) : bridge.addToLibrary(records);
   files({done: {...state.files.done, [f.id]: ids}});return{assetIds:ids};
  } finally { files({busy: ''}); }
 };
 /** A video on the hub becomes an animation: its frames wait in Create for review (like a video job). */
 const fileAnimation = (f:HubFileInfo,frames:number,fps:number) => {
  const id = `file-${crypto.randomUUID()}`, name = safeName(`${f.filename.replace(/\.[a-z0-9]+$/i, '')}-anim`);
  const job: LocalJob = {id, project: bridge.projectKey(), name, capability: 'files', purpose: 'video.sprite', kind: 'animation', createdAt: Date.now(), state: 'completed', file: f.id, cutout: state.cutout,
   animation: {method: 'video', frames, columns: gridFor(frames).columns, fps, loop: true}, info: {workflow: 'LocalHub · files', prompt: f.filename, negative: '', seed: 0, steps: 0, cfg: 0, width: 0, height: 0, model: '', createdAt: new Date().toISOString(), kind: 'animation', frames, fps, method: 'video'}};
  add(job);return job;
 };
 const animateFile=async(f:HubFileInfo,frames:number,fps:number)=>{const job=fileAnimation(f,frames,fps);
  files({busy:f.id});
  try { await review(job); } finally { files({busy: ''}); }
 };
 const upload = async (bytes: Uint8Array, name: string) => {
  if (bytes.byteLength > uploadLimit) throw Error(t('hub.files.tooLarge'));
  uploadName(name);
  files({busy: 'upload'});
  try { const added = await bridge.port.uploadFile(bytes, name); files({items: [added, ...state.files.items.filter(x => x.id !== added.id)]});return added; }
  finally { files({busy: ''}); }
 };
 const deleteFile=async(f:HubFileInfo)=>{files({busy:f.id,confirm:''});try{await bridge.port.deleteFile(f.id);files({items:state.files.items.filter(x=>x.id!==f.id)});}finally{files({busy:''});}};
 const remove=async(f:HubFileInfo)=>{if(state.files.confirm!==f.id){files({confirm:f.id});return;}await deleteFile(f);};
 /** Image thumbnail or audio/video player, loaded on demand (blob URL freed on unmount). */
 function FilePreview({file, kind}: {file: HubFileInfo; kind: 'image' | 'audio' | 'video'}) {
  const [url, setUrl] = useState('');
  useEffect(() => {
   let alive = true, current = '';
   void bridge.port.fileContent(file.id).then(o => { if (!alive) return; current = URL.createObjectURL(new Blob([new Uint8Array(o.bytes)], {type: o.mime || file.mime})); setUrl(current); }).catch(() => undefined);
   return () => { alive = false; if (current) URL.revokeObjectURL(current); };
  }, [file.id]);
  if (!url) return <span className="spinner" aria-hidden="true"/>;
  return kind === 'image' ? <img src={url} alt={file.filename} data-testid="file-preview"/> : kind === 'audio' ? <audio controls src={url} data-testid="file-preview"/> : <video controls muted loop src={url} data-testid="file-preview"/>;
 }
 /** Files tab (LocalHub): this device's uploads and job outputs on the Mac; import, animate, upload, delete. */
 function Files() {
  const s = useSyncExternalStore(subscribe, () => state), f = s.files, editable = bridge.useEditable(), selectedName = bridge.useSelectedTextureName(), soundName = bridge.useSelectedSoundName();
  const [open, setOpen] = useState<Record<string, boolean>>({}), [frames, setFrames] = useState(8), [fps, setFps] = useState(8);
  useEffect(() => { if (!state.status) void refresh(); void loadFiles(); }, []);
  const query = f.query.trim().toLowerCase(), shown = f.items.filter(x => (f.filter === 'all' || fileKind(x) === f.filter) && (!query || x.filename.toLowerCase().includes(query)));
  const total = f.items.reduce((sum, x) => sum + x.bytes, 0), busy = Boolean(f.busy);
  return <div className="hub-files" data-testid="hub-files" data-loading={f.loading}>
   <div className="hub-files-head">
    <input type="search" aria-label={t('hub.files.search')} placeholder={t('hub.files.search')} value={f.query} onChange={e => files({query: e.target.value})}/>
    <select aria-label={t('hub.files.filter')} value={f.filter} onChange={e => files({filter: e.target.value as State['files']['filter']})}>{(['all', 'image', 'audio', 'video', 'other'] as const).map(v => <option key={v} value={v}>{t(`hub.files.filter.${v}`)}</option>)}</select>
    <button onClick={() => run(loadFiles)} disabled={f.loading}>{f.loading && <span className="spinner" aria-hidden="true"/>}{t('comfy.retry')}</button>
   </div>
   <p className="hub-files-usage" role="status" data-testid="hub-files-usage">{t('hub.files.usage').replace('{n}', String(f.items.length)).replace('{size}', formatBytes(total))}</p>
   <div className="panel-actions hub-files-upload">
    <label className="hub-upload-button"><input type="file" aria-label={t('hub.files.upload')} accept=".png,.jpg,.jpeg,.webp,.gif,.mp3,.wav,.flac,.ogg,.mp4,.webm,.mov,.json,.txt" disabled={busy} onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) run(async () => upload(new Uint8Array(await file.arrayBuffer()), file.name)); }}/>{t('hub.files.upload')}</label>
    <button disabled={busy || !selectedName} title={selectedName ?? t('comfy.needsImage')} onClick={() => run(async () => { const picked = await bridge.selectedTexture(); if (picked) await upload(picked.bytes, `${picked.name}.png`); })}>{t('hub.files.uploadSprite')}</button>
    <button disabled={busy || !soundName} title={soundName ?? t('hub.needsSound')} onClick={() => run(async () => { const picked = await bridge.selectedSound(); if (picked) await upload(picked.bytes, `${picked.name}.${new TextDecoder().decode(picked.bytes.slice(0, 4)) === 'RIFF' ? 'wav' : 'mp3'}`); })}>{t('hub.files.uploadSound')}</button>
    {f.busy === 'upload' && <span className="spinner" aria-hidden="true"/>}
   </div>
   {f.error && <p className="component-warning" role="alert" data-testid="hub-files-error">{f.error}</p>}
   {!f.loading && !f.error && !shown.length && <p className="panel-empty">{f.items.length ? t('hub.files.none') : t('hub.files.empty')}</p>}
   <div role="list" aria-label={t('hub.files')}>{shown.map(x => { const kind = fileKind(x), done = f.done[x.id]; return <div role="listitem" key={x.id} className="hub-file" data-file={x.id} data-kind={kind} data-source={x.source}>
    <div className="hub-file-head">
     <strong title={x.filename}>{x.filename}</strong>
     <small>{[t(`hub.files.filter.${kind}`), formatBytes(x.bytes), t(`hub.files.source.${x.source}`), new Date(x.createdAt * 1000).toLocaleString()].join(' · ')}</small>
    </div>
    {open[x.id] && kind !== 'other' && <div className="hub-file-preview"><FilePreview file={x} kind={kind}/></div>}
    <div className="panel-actions">
     {kind !== 'other' && <button aria-label={`${t(open[x.id] ? 'hub.files.hide' : 'hub.files.preview')} ${x.filename}`} onClick={() => setOpen({...open, [x.id]: !open[x.id]})}>{t(open[x.id] ? 'hub.files.hide' : 'hub.files.preview')}</button>}
     {(kind === 'image' || kind === 'audio') && (done ? <small className="generate-sent" data-testid="file-imported">{t('comfy.inLibrary')}</small> : <button disabled={!editable || busy} aria-label={`${t('hub.files.import')} ${x.filename}`} onClick={() => run(() => importFile(x))}>{f.busy === x.id && <span className="spinner" aria-hidden="true"/>}{t('hub.files.import')}</button>)}
     {done?.[0] && kind === 'image' && <button disabled={!editable} aria-label={`${t('comfy.place')} ${x.filename}`} onClick={() => run(() => bridge.place(done[0]))}>{t('comfy.place')}</button>}
     {kind === 'video' && <button disabled={!editable || busy} aria-label={`${t('hub.files.animate')} ${x.filename}`} onClick={() => run(() => animateFile(x, frames, fps))}>{f.busy === x.id && <span className="spinner" aria-hidden="true"/>}{t('hub.files.animate')}</button>}
     <button className={f.confirm === x.id ? 'danger' : ''} disabled={busy} aria-label={`${t(f.confirm === x.id ? 'hub.files.confirmDelete' : 'hub.files.delete')} ${x.filename}`} onClick={() => run(() => remove(x))}>{t(f.confirm === x.id ? 'hub.files.confirmDelete' : 'hub.files.delete')}</button>
    </div>
   </div>; })}</div>
   {f.items.some(x => fileKind(x) === 'video') && <details className="hub-files-animate"><summary>{t('hub.files.animateSettings')}</summary>
    <div className="inline-row">
     <label className="field"><span>{t('comfy.frames')}</span><input type="number" aria-label={t('comfy.frames')} min={2} max={32} value={frames} onChange={e => { const v = Math.round(Number(e.target.value)); if (v >= 2 && v <= 32) setFrames(v); }}/></label>
     <label className="field"><span>{t('comfy.fps')}</span><input type="number" aria-label={t('comfy.fps')} min={1} max={60} value={fps} onChange={e => { const v = Number(e.target.value); if (v >= 1 && v <= 60) setFps(v); }}/></label>
    </div>
   </details>}
   <Review/>
  </div>;
 }
 /** Hub tools (MCP servers allowed for this device) the assistant may use in this chat. */
 function ChatTools() {
  const s = useSyncExternalStore(subscribe, () => state), servers = s.status?.online ? s.status.mcpServers : [];
  if (!servers.length) return null;
  return <fieldset className="hub-tools" data-testid="hub-tools"><legend>{t('hub.tools')}</legend>{servers.map(id => <label key={id} className="checkbox"><input type="checkbox" aria-label={`${t('hub.tools')} ${id}`} checked={s.servers.includes(id)} onChange={e => set({servers: e.target.checked ? [...state.servers, id] : state.servers.filter(x => x !== id)})}/>{id}</label>)}</fieldset>;
 }

 return {
  Connection, Create, Jobs, Files, ChatTools, refresh,
  fileTools:{
   files:()=>bridge.port.files(),
   async import(id:string,check:()=>void){check();const file=(await bridge.port.files()).find(f=>f.id===id);if(!file)throw Error('LocalHub file not found');return importFile(file,check);},
   async animate(id:string,frames:number,fps:number,check:()=>void){check();const file=(await bridge.port.files()).find(f=>f.id===id);if(!file||fileKind(file)!=='video')throw Error('LocalHub video not found');const job=fileAnimation(file,frames,fps);return createAnimation(job,undefined,{check,place:false});},
   upload,
   async remove(id:string){const file=(await bridge.port.files()).find(f=>f.id===id);if(!file)throw Error('LocalHub file not found');await deleteFile(file);},
  },
  status: () => state.status,
  useStatus: () => useSyncExternalStore(subscribe, () => state.status),
  servers: () => state.servers,
  /** Running hub jobs of this project (the Jobs tab badge). */
  useActiveJobs() { const key = bridge.useProjectKey(); return useSyncExternalStore(subscribe, () => state.jobs.filter(j => j.project === key && isActive(j)).length); },
  /** One image or sound for the assistant: waits for the job and returns the imported asset IDs. */
  async generateNow(request: {kind: 'image' | 'audio'; prompt: string; seconds?: number; width?: number; height?: number; preset?: GeneratePreset; skill?: string;beforeAdopt?:()=>void;signal?:AbortSignal}): Promise<string[]> {
   request.signal?.throwIfAborted();
   const capability: CreateCapability = request.kind === 'audio' ? 'audio.create' : 'image.create';
   const a = availability(state.status ?? await bridge.port.status(), capability);
   if (a !== 'ready') throw Error(t(`hub.unavailable.${a}`).replace('{capability}', capability));
   const p = request.preset, seed = Math.floor(Math.random() * 2 ** 32), snap = (v: number | undefined) => v ? Math.min(4096, Math.max(64, Math.round(v / 8) * 8)) : undefined;
   if (p?.kind && p.kind !== request.kind) throw Error(`The skill "${request.skill ?? 'chosen'}" makes ${p.kind === 'audio' ? 'sounds' : 'images'}, not ${request.kind === 'audio' ? 'sounds' : 'images'}`);
   const prompt = applyTemplate(p?.prompt ?? '', request.prompt), width = snap(request.width ?? p?.width), height = snap(request.height ?? p?.height ?? width), negative = p?.negative ?? (request.kind === 'audio' ? '' : 'blurry, low quality, watermark, text');
   const seconds = request.kind === 'audio' ? Math.min(60, Math.max(1, request.seconds ?? 5)) : undefined;
   const {job, ids} = await submit({capability, prompt, seed, ...(negative ? {negative} : {}), ...(p?.steps ? {steps: p.steps} : {}), ...(width && height && request.kind === 'image' ? {width, height} : {}), ...(seconds ? {seconds} : {})},
    {name: nameFromPrompt(request.prompt, seed), kind: request.kind, purpose: request.kind === 'audio' ? 'audio.sfx' : 'image.sprite', info: {workflow: `LocalHub · ${capability}`, prompt, negative, seed, steps: p?.steps ?? 0, cfg: 0, width: width ?? 0, height: height ?? 0, model: '', createdAt: new Date().toISOString(), kind: request.kind, ...(request.skill ? {skill: request.skill} : {}), ...(seconds ? {seconds} : {})}},request.beforeAdopt);
   const cancel=()=>{adoptionGuards.set(job.id,()=>{throw Error('Generation cancelled');});void bridge.port.cancel(job.id);update(job.id,{state:'cancelled'});settle(job.id,Error('Generation cancelled'));};
   if(request.signal?.aborted){cancel();request.signal.throwIfAborted();}
   if (ids) return ids;
   const done = state.jobs.find(j => j.id === job.id);
   if (done?.state === 'imported') return done.assets ?? [];
   if (done && finished(done)) throw Error(done.error ?? t(`hub.job.${done.state}`));
   request.signal?.addEventListener('abort',cancel,{once:true});
   return new Promise<string[]>((resolve, reject) => { waiters.set(job.id, {resolve, reject}); }).finally(()=>{request.signal?.removeEventListener('abort',cancel);});
  },
  dispose() { offEvents(); if (timer) clearInterval(timer); for (const f of state.review?.frames ?? []) URL.revokeObjectURL(f.url); for (const w of waiters.values()) w.reject(Error('Closed')); waiters.clear(); },
 };
}
