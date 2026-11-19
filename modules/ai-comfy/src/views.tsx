import {useEffect, useMemo, useState, useSyncExternalStore, type ReactNode} from 'react';
import {areas, fits, purposeById, purposeFor, purposesOf, sizeFor, sizePresets, type Area, type Purpose} from './purposes';
import {builtInWorkflows, applyInputs, applyTemplate, chainEdits, editPrompt, feedImage, isFp8, withCutouts, gridFor, sheetPrompt, sliceGrid, GenerateInputsSchema, nameFromPrompt, preferredModel, samplerDefaults, workflowDefaults, workflowNeeds, WorkflowSchema, type ComfyPort, type ComfyProgress, type ComfyStatus, type Generation, type GenerateInputs, type AnimationMethod, type Job, type JobStatus, type LibraryEntry, type SkillChoice, type Workflow, type WorkflowChoice} from './contracts';

/** Prompt writer progress shown in the panel's info line. */
export interface PromptStatus {phase: 'connecting' | 'waiting' | 'thinking' | 'writing' | 'done' | 'failed' | 'cancelled'; chars?: number; seconds?: number; model?: string; message?: string}
interface Bridge {
 port: ComfyPort; url(): string; text(key: string): string; report(error: unknown): void; useEditable(): boolean;
 /** The selected sprite's texture as PNG bytes (image-to-image input), or null. */
 selectedTexture(): Promise<{name: string; bytes: Uint8Array<ArrayBuffer>} | null>; useSelectedTextureName(): string | null;
 /** Adds the imported records and their generation info in one undo step; returns the new asset IDs. */
 adopt(records: readonly unknown[], info: Omit<Generation, 'assetId'>): string[];
 thumbnail(assetId: string): string | undefined; assetName(assetId: string): string | undefined;
 place(assetId: string): void;
 /** Image results replace the selected sprite's texture; sounds replace the selected audio source's clip. */
 applyToSelection(assetId: string): void; useCanApply(): {image: boolean; audio: boolean};
 /** Playback controls for a generated sound (the Library's clip preview). */
 clipControls(assetId: string): ReactNode;
 /** Imported workflows are machine-local (not part of the project). */
 loadWorkflows(): WorkflowChoice[]; saveWorkflows(list: WorkflowChoice[]): void;
 /** Optional prompt writer (LM Studio): turns a short idea into a detailed prompt, reporting progress. */
 improvePrompt?(idea: string, kind: Area, onStatus: (status: PromptStatus) => void, signal: AbortSignal, skill?: SkillChoice, brief?: string): Promise<string>;
 /** Skills with generation presets (project, this computer, built-in). */
 skills?(): SkillChoice[]; useSkills?(): SkillChoice[];
 /** Background jobs are kept on this machine per project (`projectKey`), so they survive closing the editor. */
 loadJobs(): Job[]; saveJobs(jobs: Job[]): void; projectKey(): string; useProjectKey(): string;
 /** Whether finished jobs can be imported now (editable, no Preview or file operation). */
 canImport(): boolean;
 openGenerate?(): void; openJobs?(): void; jobQueued?(job: Job): void;
 /** Adds an Animated sprite for a packed sheet to the scene (selected). */
 placeAnimation(assetId: string, sheet: SheetLayout): void;
 /** Generated assets wait in the Library's Generated inbox; one click sends them to the Library (its open folder). */
 useInbox?(): ReadonlySet<string>; sendToLibrary?(assetIds: readonly string[]): void;
}
/** How a packed sprite sheet plays (Animated sprite fields). */
export interface SheetLayout {columns: number; rows: number; frames: number; fps: number; loop: boolean; width: number; height: number}
/** Animation mode settings and the frames generated so far (PNG bytes, kept until a new run). */
type Animation = {method: AnimationMethod; frames: number; columns: number; fps: number; motion: string; loop: boolean; removeBackground: boolean; fromSelection: boolean};
export type Frame = {id: string; url: string; bytes: Uint8Array<ArrayBuffer>; on: boolean};
/** Which workflows each method can use. */
export function suits(method: AnimationMethod, needs: ReturnType<typeof workflowNeeds>) {
 return method === 'video' ? needs.kind === 'video' : needs.kind === 'image' && needs.prompt && (method === 'edit' ? needs.image : !needs.image);
}
export const png = (bytes: Uint8Array) => new Blob([new Uint8Array(bytes)], {type: 'image/png'});
const canvasBytes = async (canvas: OffscreenCanvas) => new Uint8Array(await (await canvas.convertToBlob({type: 'image/png'})).arrayBuffer());
/** Cuts a generated sheet into its grid cells. */
export async function sliceSheet(bytes: Uint8Array, columns: number, rows: number, frames: number) {
 const bitmap = await createImageBitmap(png(bytes)), out: Uint8Array<ArrayBuffer>[] = [];
 try { for (const r of sliceGrid(bitmap.width, bitmap.height, columns, rows, frames)) { const c = new OffscreenCanvas(r.width, r.height); c.getContext('2d')!.drawImage(bitmap, r.x, r.y, r.width, r.height, 0, 0, r.width, r.height); out.push(await canvasBytes(c)); } }
 finally { bitmap.close(); }
 return out;
}
/** Packs frames into one grid sheet (cells as large as the largest frame, centred; at most 4096 px a side). */
export async function packSheet(frames: readonly Uint8Array[], columns: number) {
 const bitmaps = await Promise.all(frames.map(f => createImageBitmap(png(f))));
 try {
  const grid = gridFor(frames.length, columns), w = Math.max(...bitmaps.map(b => b.width)), h = Math.max(...bitmaps.map(b => b.height));
  const scale = Math.min(1, 4096 / (w * grid.columns), 4096 / (h * grid.rows)), cw = Math.max(1, Math.floor(w * scale)), ch = Math.max(1, Math.floor(h * scale));
  const canvas = new OffscreenCanvas(cw * grid.columns, ch * grid.rows), ctx = canvas.getContext('2d')!;
  bitmaps.forEach((b, i) => { const bw = b.width * scale, bh = b.height * scale; ctx.drawImage(b, (i % grid.columns) * cw + (cw - bw) / 2, Math.floor(i / grid.columns) * ch + (ch - bh) / 2, bw, bh); });
  return {bytes: await canvasBytes(canvas), ...grid, width: cw, height: ch};
 } finally { for (const b of bitmaps) b.close(); }
}
/** Cycles the frames at the chosen speed (editor preview of the animation). */
export function FramePreview({frames, fps, label}: {frames: Frame[]; fps: number; label: string}) {
 const [index, setIndex] = useState(0), shown = frames.filter(f => f.on);
 useEffect(() => { if (shown.length < 2) return; const timer = setInterval(() => setIndex(i => (i + 1) % shown.length), 1000 / Math.max(1, fps)); return () => clearInterval(timer); }, [shown.length, fps]);
 const frame = shown[index % Math.max(1, shown.length)];
 return frame ? <img className="generate-frame-preview" src={frame.url} alt={label} data-testid="frame-preview" data-frame={index % shown.length}/> : null;
}
/** The "From ComfyUI" browser: saved workflows and templates, and which of them run here as they are. */
type Library = {open: boolean; loading: boolean; items: LibraryEntry[]; problems: Record<string, string[]> | null; query: string; adding: string | null; error?: string};
type State = {loras: string[]; skillId: string; jobs: Job[]; reviewing: string | null; unets: string[]; area: Area; purposes: Record<Area, string>; hint: boolean; customSize: boolean; animation: Animation; frames: Frame[]; step: string | null; removers: string[]; library: Library; writing: boolean; writer: PromptStatus | null; status: ComfyStatus | null; checkpoints: string[]; encoders: string[]; checking: boolean; workflowId: string; inputs: GenerateInputs; randomSeed: boolean; job: string | null; progress: ComfyProgress | null; results: {id: string; kind: 'image' | 'audio' | 'animation'; sheet?: SheetLayout}[]; imported: WorkflowChoice[]};

/**
 * Generate panel: talks to ComfyUI through the main process (loopback only). State lives outside the component so a
 * generation keeps running and reporting while the panel is closed.
 */
export function createGeneratePanel(bridge: Bridge) {
 let state: State = {loras: [], skillId: '', jobs: bridge.loadJobs(), reviewing: null, unets: [], area: 'image', purposes: {image: 'image.sprite', audio: 'audio.sfx', video: 'video.sprite'}, hint: true, customSize: false, animation: {method: 'sheet', frames: 8, columns: 4, fps: 8, motion: '', loop: true, removeBackground: true, fromSelection: false}, frames: [], step: null, removers: [], library: {open: false, loading: false, items: [], problems: null, query: '', adding: null}, writing: false, writer: null, status: null, checkpoints: [], encoders: [], checking: false, workflowId: 'builtin.txt2img', inputs: {prompt: '', negative: 'blurry, low quality, watermark, text', seed: 1, steps: 20, cfg: 7, width: 512, height: 512, batch: 1, denoise: 0.6, model: '', seconds: 10, encoder: '', lyrics: '', loras: []}, randomSeed: true, job: null, progress: null, results: [], imported: []};
 let loaded = false;
 const listeners = new Set<() => void>(), set = (patch: Partial<State>) => { state = {...state, ...patch}; for (const fn of listeners) fn(); };
 const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
 bridge.port.onProgress(p => { if (p.jobId === state.job) set({progress: p}); });
 const choices = () => [...builtInWorkflows(), ...state.imported];
 const refresh = async () => {
  if (state.checking) return; set({checking: true});
  try { const {status, checkpoints, encoders, removers, unets, loras} = await bridge.port.status(bridge.url()); set({status, checkpoints, encoders, removers: removers ?? [], unets: unets ?? [], loras: loras ?? []}); if (!checkpoints.includes(state.inputs.model) || (state.encoders.length && !encoders.includes(state.inputs.encoder ?? ''))) adapt(); }
  catch (error) { set({status: {online: false, url: bridge.url(), error: String(error)}}); }
  finally { set({checking: false}); }
 };
 /** Model, encoder and sampler defaults for the chosen workflow: built-ins suit the output kind, imported workflows start as authored. */
 const adapt = () => {
  const choice = choices().find(c => c.id === state.workflowId); if (!choice) return;
  const kind = workflowNeeds(choice.workflow).kind === 'audio' ? 'audio' : 'image', model = preferredModel(kind, state.checkpoints), encoder = state.encoders.find(e => /t5gemma|t5/i.test(e)) ?? state.encoders[0] ?? '';
  const base = {...state.inputs, model, encoder, ...samplerDefaults(kind, model), ...(kind === 'audio' ? {negative: ''} : {negative: state.inputs.negative || 'blurry, low quality, watermark, text'})};
  if (choice.builtIn) return set({inputs: {...base, ...purposeInputs(purpose(), choice, model)}});
  const authored = workflowDefaults(choice.workflow), clamp = (v: number | undefined, min: number, max: number) => v === undefined ? undefined : Math.min(max, Math.max(min, v));
  set({inputs: {...base, ...authored,
   prompt: state.inputs.prompt.trim() ? state.inputs.prompt : authored.prompt ?? '', negative: authored.negative ?? base.negative,
   model: authored.model && (state.checkpoints.includes(authored.model) || !state.checkpoints.length) ? authored.model : model,
   encoder: authored.encoder && (state.encoders.includes(authored.encoder) || !state.encoders.length) ? authored.encoder : encoder,
   steps: clamp(authored.steps, 1, 150) ?? base.steps, cfg: clamp(authored.cfg, 0, 30) ?? base.cfg, batch: clamp(authored.batch, 1, 4) ?? base.batch, seconds: clamp(authored.seconds, 1, 300) ?? base.seconds,
   width: authored.width && authored.width % 8 === 0 ? Math.min(4096, Math.max(64, authored.width)) : base.width, height: authored.height && authored.height % 8 === 0 ? Math.min(4096, Math.max(64, authored.height)) : base.height,
   lyrics: authored.lyrics ?? base.lyrics}});
 };
 /** Purposes ------------------------------------------------------------------------------------------------------ */
 const purpose = () => purposeById(state.purposes[state.area]);
 /** Built-in templates run SD-class models at 512 (XL/Flux-class at 1024); imported ones at their authored size. */
 const nativeSide = (choice: WorkflowChoice, model: string) => { if (choice.builtIn) return /xl|sd3|flux|klein|qwen|hidream/i.test(model) ? 1024 : 512; const d = workflowDefaults(choice.workflow); return Math.max(d.width ?? 0, d.height ?? 0) || 1024; };
 const purposeInputs = (p: Purpose, choice: WorkflowChoice, model: string): Partial<GenerateInputs> => ({...(p.aspects ? sizeFor(p.aspects[0], nativeSide(choice, model)) : {}), ...(p.seconds ? {seconds: p.seconds.value} : {})});
 /** Makes `p` the open purpose and takes its animation defaults (workflow and inputs stay). */
 const selectPurpose = (p: Purpose) => set({customSize: false, area: p.area, purposes: {...state.purposes, [p.area]: p.id}, animation: {...state.animation, ...(p.method ? {method: p.method} : {}), ...(p.loop !== undefined ? {loop: p.loop} : {}), ...(p.cutout !== undefined ? {removeBackground: p.cutout} : {}), fromSelection: Boolean(p.input)}});
 /** Opens a purpose: a fitting workflow (the current one when it fits, imported ones first) and its size or duration. */
 const choosePurpose = (id: string) => {
  const p = purposeById(id);
  selectPurpose(p);
  const current = choices().find(c => c.id === state.workflowId);
  if (current && fits(p, workflowNeeds(current.workflow))) return set({inputs: {...state.inputs, ...purposeInputs(p, current, state.inputs.model)}});
  const next = choices().filter(c => fits(p, workflowNeeds(c.workflow))).sort((a, b) => Number(Boolean(a.builtIn)) - Number(Boolean(b.builtIn)))[0];
  if (next) { set({workflowId: next.id}); adapt(); if (!next.builtIn) set({inputs: {...state.inputs, ...(p.seconds ? {seconds: Math.min(p.seconds.max, Math.max(p.seconds.min, state.inputs.seconds ?? p.seconds.value))} : {})}}); }
 };
 /** A workflow chosen another way (import, skill preset) opens the purpose it fits. */
 const followWorkflow = (choice: WorkflowChoice) => { const p = purposeFor(workflowNeeds(choice.workflow), purpose()); if (p.id !== purpose().id) selectPurpose(p); };
 /** Skills: the chosen one's template wraps the prompt (else the purpose's hint, when on); its preset fills the panel when picked. */
 const skill = () => state.skillId ? bridge.skills?.().find(k => k.id === state.skillId) : undefined;
 const template = () => skill()?.preset?.prompt.trim() ? skill()!.preset!.prompt : state.hint ? purpose().hint ?? '' : '';
 const sent = (prompt: string) => applyTemplate(template(), prompt);
 const skillInfo = (loras: GenerateInputs['loras']) => ({...(loras?.length ? {loras} : {}), ...(skill() ? {skill: skill()!.name} : {}), purpose: purpose().id.split('.')[1]});
 const chooseSkill = (id: string) => {
  set({skillId: id});
  const preset = skill()?.preset;
  if (!preset) return;
  const workflow = preset.workflow ? choices().find(c => c.name === preset.workflow) : undefined;
  if (workflow && workflow.id !== state.workflowId) { set({workflowId: workflow.id}); followWorkflow(workflow); adapt(); }
  const patch: Partial<GenerateInputs> = {};
  if (preset.negative !== undefined) patch.negative = preset.negative;
  if (preset.loras.length) patch.loras = preset.loras;
  for (const key of ['width', 'height', 'steps', 'cfg'] as const) if (preset[key] !== undefined) patch[key] = preset[key];
  set({inputs: {...state.inputs, ...patch}});
 };
 const library = (patch: Partial<Library>) => set({library: {...state.library, ...patch}});
 const libraryKey = (item: Pick<LibraryEntry, 'source' | 'ref'>) => `${item.source}:${item.ref}`;
 /** Lists the server's workflows, then converts each to tell which run here as they are. */
 const browse = async () => {
  if (state.library.loading) return;
  library({open: true, loading: true, error: undefined, problems: null});
  try {
   const items = await bridge.port.library(bridge.url());
   library({items});
   library({problems: await bridge.port.libraryCheck(bridge.url(), items.map(i => ({source: i.source, ref: i.ref})))});
  } catch (error) { library({error: error instanceof Error ? error.message : String(error)}); }
  finally { library({loading: false}); }
 };
 const remember = (choice: WorkflowChoice) => {
  const next = [...state.imported.filter(w => w.id !== choice.id && w.name !== choice.name), choice];
  bridge.saveWorkflows(next); set({imported: next, workflowId: choice.id}); followWorkflow(choice); adapt();
 };
 const addFromLibrary = async (item: LibraryEntry) => {
  library({adding: libraryKey(item), error: undefined});
  try {
   const {workflow} = await bridge.port.libraryGet(bridge.url(), {source: item.source, ref: item.ref});
   remember({id: `comfy.${libraryKey(item)}`, name: item.title.slice(0, 60), workflow: WorkflowSchema.parse(workflow)});
   library({open: false});
  } catch (error) { library({error: error instanceof Error ? error.message : String(error)}); }
  finally { library({adding: null}); }
 };
 /** Background jobs ------------------------------------------------------------------------------------------------ */
 const persist = (jobs: Job[]) => { set({jobs}); bridge.saveJobs(jobs); };
 const updateJob = (id: string, patch: Partial<Job>) => persist(state.jobs.map(j => j.id === id ? {...j, ...patch} : j));
 const projectJobs = () => state.jobs.filter(j => j.project === bridge.projectKey());
 /** Queues a workflow and records the job; the editor follows it from now on (and after a restart). */
 const submit = async (workflow: Workflow, meta: Pick<Job, 'name' | 'kind' | 'info' | 'animation'>, image?: Uint8Array<ArrayBuffer>) => {
  const {promptId} = await bridge.port.submit(bridge.url(), {workflow, name: meta.name, ...(image ? {image} : {})});
  const job: Job = {id: crypto.randomUUID(), promptId, url: bridge.url(), project: bridge.projectKey(), createdAt: new Date().toISOString(), state: 'queued', ...meta};
  persist([job, ...state.jobs].slice(0, 100));
  bridge.jobQueued?.(job);
  return job;
 };
 const generate = async () => {
  const choice = choices().find(c => c.id === state.workflowId);
  if (!choice) return;
  const needs = workflowNeeds(choice.workflow), seed = state.randomSeed ? Math.floor(Math.random() * 2 ** 32) : state.inputs.seed, inputs = GenerateInputsSchema.parse({...state.inputs, seed, prompt: needs.prompt ? state.inputs.prompt : state.inputs.prompt.trim() || choice.name});
  const p = purpose();
  if (!fits(p, needs)) throw Error(bridge.text(p.needs));
  if (needs.model && !inputs.model) throw Error(bridge.text('comfy.noModel'));
  if (needs.encoder && !inputs.encoder) throw Error(bridge.text('comfy.noEncoder'));
  const image = needs.image ? await bridge.selectedTexture() : null;
  if (needs.image && !image) throw Error(bridge.text('comfy.needsImage'));
  set({inputs});
  const kind = needs.kind === 'audio' ? 'audio' as const : 'image' as const;
  const prompt = needs.prompt ? sent(inputs.prompt) : inputs.prompt;
  const graph = applyInputs(choice.workflow, {...inputs, prompt, lyrics: p.lyrics ? inputs.lyrics : ''});
  await submit(kind === 'image' && p.cutout !== undefined && state.animation.removeBackground && state.removers[0] ? withCutouts(graph, state.removers[0]) : graph, {name: nameFromPrompt(inputs.prompt, seed), kind, info: {...skillInfo(needs.loras ? inputs.loras : []), workflow: choice.name, prompt, negative: inputs.negative, seed, steps: inputs.steps, cfg: inputs.cfg, width: needs.size ? inputs.width : 0, height: needs.size ? inputs.height : 0, model: needs.model ? inputs.model : '', kind, ...(needs.seconds ? {seconds: inputs.seconds} : {}), ...(needs.lyrics && p.lyrics && inputs.lyrics ? {lyrics: inputs.lyrics} : {})}}, image?.bytes);
 };
 /** Animation mode ------------------------------------------------------------------------------------------------ */
 const animate = (patch: Partial<Animation>) => set({animation: {...state.animation, ...patch}});
 /** Inputs for another workflow (the first frame of an edit chain or a video): its own defaults, this run's prompt/seed/size. */
 const inputsFor = (choice: WorkflowChoice, patch: Partial<GenerateInputs>) => {
  if (choice.builtIn) { const model = preferredModel('image', state.checkpoints); return GenerateInputsSchema.parse({...state.inputs, model, ...samplerDefaults('image', model), ...patch}); }
  return GenerateInputsSchema.parse({...state.inputs, ...workflowDefaults(choice.workflow), ...patch});
 };
 const showFrames = (frames: Uint8Array<ArrayBuffer>[]) => { for (const f of state.frames) URL.revokeObjectURL(f.url); set({frames: frames.map(bytes => ({id: crypto.randomUUID(), url: URL.createObjectURL(png(bytes)), bytes, on: true}))}); };
 /** Builds the whole animation as one ComfyUI graph and queues it: it finishes even if the editor is closed. */
 const generateFrames = async () => {
  const choice = choices().find(c => c.id === state.workflowId), a = state.animation, t = bridge.text;
  if (!choice) return;
  const needs = workflowNeeds(choice.workflow);
  if (!fits(purpose(), needs)) throw Error(t(purpose().needs));
  const seed = state.randomSeed ? Math.floor(Math.random() * 2 ** 32) : state.inputs.seed, typed = state.inputs.prompt.trim(), prompt = sent(typed), count = Math.max(2, Math.min(32, Math.round(a.frames))), base = {...state.inputs, seed, prompt};
  if (!typed) throw Error(t('comfy.promptFirst'));
  const firstChoice = () => { const first = choices().filter(c => suits('sheet', workflowNeeds(c.workflow))).sort((x, y) => Number(Boolean(x.builtIn)) - Number(Boolean(y.builtIn)))[0]; if (!first) throw Error(t('comfy.needs.sheet')); return first; };
  const picked = a.method !== 'sheet' && a.fromSelection ? await bridge.selectedTexture() : null;
  if (a.method !== 'sheet' && a.fromSelection && !picked) throw Error(t('comfy.needsImage'));
  let graph: Workflow;
  if (a.method === 'sheet') {
   const grid = gridFor(count, a.columns);
   graph = applyInputs(choice.workflow, GenerateInputsSchema.parse({...base, prompt: sheetPrompt(prompt, a.motion, count, grid.columns, grid.rows)}));
  } else if (a.method === 'edit') {
   const edits = Array.from({length: count - 1}, (_, k) => applyInputs(choice.workflow, GenerateInputsSchema.parse({...base, prompt: editPrompt(prompt, a.motion, k + 1, count)})));
   graph = chainEdits(picked ? 'upload' : applyInputs(firstChoice().workflow, inputsFor(firstChoice(), {prompt, seed})), edits);
  } else {
   const video = applyInputs(choice.workflow, GenerateInputsSchema.parse({...base, length: needs.length ? count : undefined}));
   graph = needs.image && !picked ? feedImage(applyInputs(firstChoice().workflow, inputsFor(firstChoice(), {prompt, seed})), video) : video;
  }
  if (a.removeBackground && state.removers[0]) graph = withCutouts(graph, state.removers[0]);
  set({inputs: {...state.inputs, seed}});
  await submit(graph, {name: `${nameFromPrompt(typed, seed)}-anim`, kind: 'animation', info: {...skillInfo(needs.loras ? state.inputs.loras : []), workflow: choice.name, prompt, negative: state.inputs.negative, seed, steps: state.inputs.steps, cfg: state.inputs.cfg, width: 0, height: 0, model: state.inputs.model, kind: 'animation', method: a.method}, animation: {method: a.method, frames: count, columns: a.columns, fps: a.fps, loop: a.loop}}, picked?.bytes);
 };
 /** A finished animation job's frames (a sheet is cut into its grid). */
 const jobFrames = async (job: Job) => {
  const {frames = []} = await bridge.port.jobResult(job.url, {promptId: job.promptId, name: job.name, kind: job.kind, frames: true});
  const bytes = frames.map(f => new Uint8Array(f)), meta = job.animation;
  if (meta?.method === 'sheet' && bytes[0]) { const grid = gridFor(meta.frames, meta.columns); return sliceSheet(bytes[0], grid.columns, grid.rows, meta.frames); }
  return bytes;
 };
 /** Opens a finished animation job in the panel: frames to review, then Create animation. */
 const reviewJob = async (job: Job) => {
  set({step: bridge.text('comfy.step.fetch')});
  try {
   showFrames(await jobFrames(job));
   const meta = job.animation;
   if (meta && purpose().method !== meta.method) selectPurpose(purposeById(meta.method === 'sheet' ? 'image.sheet' : meta.method === 'edit' ? 'image.frames' : 'video.sprite'));
   set({reviewing: job.id, ...(meta ? {animation: {...state.animation, method: meta.method, columns: meta.columns, fps: meta.fps, loop: meta.loop}} : {})});
   bridge.openGenerate?.();
  } finally { set({step: null}); }
 };
 const createAnimation = async (job?: Job) => {
  const reviewing = job ?? state.jobs.find(j => j.id === state.reviewing), a = reviewing?.animation ?? state.animation;
  let frames = state.frames.filter(f => f.on).map(f => f.bytes);
  set({step: bridge.text('comfy.step.pack')});
  try {
   if (job) frames = await jobFrames(job);
   if (frames.length < 1) throw Error(bridge.text('comfy.noFrames'));
   const sheet = await packSheet(frames, a.columns), name = reviewing?.name ?? `${nameFromPrompt(state.inputs.prompt, state.inputs.seed)}-anim`;
   const records = await bridge.port.importSheet(sheet.bytes, name);
   const layout: SheetLayout = {columns: sheet.columns, rows: sheet.rows, frames: frames.length, fps: a.fps, loop: a.loop, width: sheet.width, height: sheet.height};
   const info = (reviewing?.info ?? {workflow: 'Animation', prompt: state.inputs.prompt, negative: state.inputs.negative, seed: state.inputs.seed, steps: state.inputs.steps, cfg: state.inputs.cfg, model: state.inputs.model}) as Omit<Generation, 'assetId'>;
   const ids = bridge.adopt(records, {...info, width: sheet.width, height: sheet.height, createdAt: new Date().toISOString(), kind: 'animation', frames: frames.length, fps: a.fps, ...(reviewing?.animation ? {method: reviewing.animation.method} : {})});
   if (ids[0] && !job) bridge.placeAnimation(ids[0], layout);
   if (reviewing) updateJob(reviewing.id, {state: 'imported', assets: ids, layout});
   set({results: [...ids.map(id => ({id, kind: 'animation' as const, sheet: layout})), ...state.results].slice(0, 12), ...(job ? {} : {reviewing: null})});
  } finally { set({step: null}); }
 };
 /** Follows the project's jobs; finished images and sounds are imported automatically when the editor can take them. */
 let polling = false;
 const poll = async () => {
  if (polling) return;
  const active = projectJobs().filter(j => j.state === 'queued' || j.state === 'running' || (j.state === 'done' && j.kind !== 'animation'));
  if (!active.length) return;
  polling = true;
  try {
   for (const url of [...new Set(active.map(j => j.url))]) {
    const statuses = await bridge.port.jobs(url, active.filter(j => j.url === url).map(j => j.promptId)).catch(() => ({} as Record<string, JobStatus>));
    for (const job of active.filter(j => j.url === url)) {
     const s = statuses[job.promptId];
     if (!s) continue;
     if (s.state === 'queued' && (job.state !== 'queued' || job.ahead !== s.ahead)) updateJob(job.id, {state: 'queued', ahead: s.ahead});
     else if (s.state === 'running' && job.state !== 'running') updateJob(job.id, {state: 'running', ahead: undefined});
     else if (s.state === 'failed') updateJob(job.id, {state: 'failed', error: s.error});
     else if (s.state === 'lost' && job.state !== 'done') updateJob(job.id, {state: 'lost', error: bridge.text('comfy.jobLost')});
     else if (s.state === 'done' && job.state !== 'done') updateJob(job.id, {state: 'done', ahead: undefined});
    }
   }
   // Import finished images/sounds of this project, one undo step each, when nothing else is going on.
   for (const job of projectJobs().filter(j => j.state === 'done' && j.kind !== 'animation')) {
    if (!bridge.canImport()) break;
    try {
     const {records = []} = await bridge.port.jobResult(job.url, {promptId: job.promptId, name: job.name, kind: job.kind});
     const ids = bridge.adopt(records, {...(job.info as Omit<Generation, 'assetId' | 'createdAt'>), createdAt: new Date().toISOString()} as Omit<Generation, 'assetId'>);
     updateJob(job.id, {state: 'imported', assets: ids});
     set({results: [...ids.map(id => ({id, kind: job.kind as 'image' | 'audio'})), ...state.results].slice(0, 12)});
    } catch (error) { updateJob(job.id, {state: 'failed', error: error instanceof Error ? error.message : String(error)}); }
   }
  } finally { polling = false; }
 };
 setInterval(() => { void poll().catch(bridge.report); }, 1500);
 const cancelJob = async (job: Job) => { await bridge.port.jobCancel(job.url, job.promptId); updateJob(job.id, {state: 'cancelled'}); };
 const removeJob = (job: Job) => persist(state.jobs.filter(j => j.id !== job.id));

 let writerAbort: AbortController | null = null;
 const writePrompt = async () => {
  if (!bridge.improvePrompt || state.writing) return;
  writerAbort = new AbortController();
  set({writing: true, writer: {phase: 'connecting'}});
  try {
   const next = await bridge.improvePrompt(state.inputs.prompt, state.area, writer => set({writer}), writerAbort.signal, skill(), purpose().brief);
   set({inputs: {...state.inputs, prompt: next}});
  } catch (error) {
   const message = error instanceof Error ? error.message : String(error);
   set({writer: message === 'Cancelled' ? {phase: 'cancelled'} : {phase: 'failed', message}});
  } finally { writerAbort = null; set({writing: false}); }
 };
 const writerText = (w: PromptStatus) => {
  const t = bridge.text, fill = (key: string) => t(key).replace('{model}', w.model ?? '').replace('{chars}', String(w.chars ?? 0)).replace('{seconds}', String(w.seconds ?? 0));
  return w.phase === 'failed' ? w.message ?? t('comfy.writer.failed') : fill(`comfy.writer.${w.phase}`);
 };
 const run = (work: () => Promise<void> | void) => { try { const r = work(); if (r) r.catch(bridge.report); } catch (error) { bridge.report(error); } };

 function LibraryBrowser({library: l, busy}: {library: Library; busy: boolean}) {
  const t = bridge.text, query = l.query.trim().toLowerCase();
  const shown = l.items.filter(i => !query || `${i.title} ${i.group} ${i.description ?? ''}`.toLowerCase().includes(query));
  const problems = (i: LibraryEntry) => l.problems?.[libraryKey(i)];
  const ready = shown.filter(i => problems(i)?.length === 0), blocked = shown.filter(i => (problems(i)?.length ?? 0) > 0), unknown = l.problems ? [] : shown;
  const groups = (list: LibraryEntry[]) => [...new Set(list.map(i => i.group))].map(group => ({group, items: list.filter(i => i.group === group)}));
  const row = (i: LibraryEntry, enabled: boolean) => <div role="listitem" key={libraryKey(i)} className={`comfy-library-item${enabled ? '' : ' blocked'}`} data-ref={i.ref} data-ready={enabled}>
   <button disabled={!enabled || busy || Boolean(l.adding)} title={i.description} onClick={() => run(() => addFromLibrary(i))}>{l.adding === libraryKey(i) ? <span className="spinner" aria-hidden="true"/> : null}{i.title}</button>
   {!enabled && problems(i) && <small>{problems(i)!.join(' · ')}</small>}
  </div>;
  const counts = l.problems ? t('comfy.library.counts').replace('{ready}', String(l.items.filter(i => problems(i)?.length === 0).length)).replace('{blocked}', String(l.items.filter(i => (problems(i)?.length ?? 0) > 0).length)) : '';
  return <section className="comfy-library" aria-label={t('comfy.library')} data-testid="comfy-library" data-loading={l.loading}>
   <input type="search" aria-label={t('comfy.library.search')} placeholder={t('comfy.library.search')} value={l.query} onChange={e => library({query: e.target.value})}/>
   <p className="comfy-library-status" role="status">{l.loading && <span className="spinner" aria-hidden="true"/>}{l.loading ? (l.items.length ? t('comfy.library.checking').replace('{count}', String(l.items.length)) : t('comfy.library.loading')) : l.items.length ? counts : t('comfy.library.empty')}</p>
   {l.error && <p role="alert" className="component-warning">{l.error}</p>}
   <div className="comfy-library-list" role="list" aria-label={t('comfy.library')}>
    {groups(ready).map(g => <div role="group" aria-label={g.group} key={`r-${g.group}`}><h4>{g.group}</h4>{g.items.map(i => row(i, true))}</div>)}
    {unknown.length > 0 && groups(unknown).map(g => <div role="group" aria-label={g.group} key={`u-${g.group}`}><h4>{g.group}</h4>{g.items.map(i => row(i, false))}</div>)}
    {blocked.length > 0 && <details className="comfy-library-blocked"><summary>{t('comfy.library.needsSetup').replace('{count}', String(blocked.length))}</summary>{blocked.map(i => row(i, false))}</details>}
   </div>
  </section>;
 }

 const finished = (j: Job) => ['imported', 'failed', 'cancelled', 'lost'].includes(j.state);
 const jobText = (j: Job) => { const t = bridge.text; return j.state === 'queued' ? (j.ahead ? t('comfy.job.queuedAhead').replace('{n}', String(j.ahead)) : t('comfy.job.queued')) : j.state === 'failed' || j.state === 'lost' ? j.error ?? t(`comfy.job.${j.state}`) : t(`comfy.job.${j.state === 'done' && j.kind === 'animation' ? 'ready' : j.state}`); };
 /** A line in the Generate panel: how many jobs are running or ready, with a way to the Jobs panel. */
 function JobsSummary() {
  const s = useSyncExternalStore(subscribe, () => state), key = bridge.useProjectKey(), t = bridge.text, mine = s.jobs.filter(j => j.project === key);
  const active = mine.filter(j => j.state === 'queued' || j.state === 'running').length, ready = mine.filter(j => j.state === 'done').length;
  if (!active && !ready) return null;
  return <p className="generate-jobs" role="status" data-testid="jobs-summary">{[active ? t('comfy.jobs.active').replace('{n}', String(active)) : '', ready ? t('comfy.jobs.ready').replace('{n}', String(ready)) : ''].filter(Boolean).join(' · ')}{bridge.openJobs && <button onClick={bridge.openJobs}>{t('comfy.jobs.open')}</button>}</p>;
 }
 /** Jobs panel: every ComfyUI job of this project, newest first; they keep running while you work or with the editor closed. */
 function JobsPanel() {
  const s = useSyncExternalStore(subscribe, () => state), key = bridge.useProjectKey(), t = bridge.text, editable = bridge.useEditable(), jobs = s.jobs.filter(j => j.project === key), inbox = bridge.useInbox?.();
  return <div className="panel-body jobs-panel" data-testid="jobs-panel">
   {!jobs.length && <p className="panel-empty">{t('comfy.jobs.empty')}</p>}
   <div role="list" aria-label={t('comfy.jobs')}>{jobs.map(j => { const thumb = j.assets?.[0] && j.kind !== 'audio' ? bridge.thumbnail(j.assets[0]) : undefined; return <div role="listitem" key={j.id} className={`job ${j.state}`} data-job={j.id} data-state={j.state} data-kind={j.kind}>
    {thumb && <img src={thumb} alt=""/>}
    <div className="job-body">
     <strong>{j.name}</strong>
     <small>{t(`comfy.kind.${j.kind}`)} · {new Date(j.createdAt).toLocaleTimeString()}</small>
     <span className="job-state" data-testid="job-state">{(j.state === 'queued' || j.state === 'running') && <span className="spinner" aria-hidden="true"/>}{jobText(j)}</span>
     <div className="panel-actions">
      {(j.state === 'queued' || j.state === 'running') && <button aria-label={`${t('comfy.cancel')} ${j.name}`} onClick={() => run(() => cancelJob(j))}>{t('comfy.cancel')}</button>}
      {j.state === 'done' && j.kind === 'animation' && <><button disabled={!editable || Boolean(s.step)} aria-label={`${t('comfy.job.review')} ${j.name}`} onClick={() => run(() => reviewJob(j))}>{t('comfy.job.review')}</button><button disabled={!editable || Boolean(s.step)} aria-label={`${t('comfy.createAnimation')} ${j.name}`} onClick={() => run(() => createAnimation(j))}>{t('comfy.createAnimation')}</button></>}
      {j.state === 'imported' && j.assets?.[0] && j.kind !== 'audio' && <button disabled={!editable} aria-label={`${t('comfy.place')} ${j.name}`} onClick={() => run(() => j.kind === 'animation' && j.layout ? bridge.placeAnimation(j.assets![0], j.layout) : bridge.place(j.assets![0]))}>{t('comfy.place')}</button>}
      {inbox && bridge.sendToLibrary && j.state === 'imported' && j.assets?.some(a => inbox.has(a)) && <button aria-label={`${t('comfy.sendToLibrary')} ${j.name}`} title={t('comfy.sendToLibraryHint')} disabled={!editable} onClick={() => run(() => bridge.sendToLibrary!(j.assets!.filter(a => inbox.has(a))))}>{`📥 ${t('comfy.sendToLibrary')}`}</button>}
      {finished(j) && <button aria-label={`${t('comfy.job.remove')} ${j.name}`} onClick={() => removeJob(j)}>{t('comfy.job.remove')}</button>}
     </div>
    </div>
   </div>; })}</div>
   {jobs.some(finished) && <button onClick={() => persist(state.jobs.filter(j => j.project !== key || !finished(j)))}>{t('comfy.jobs.clear')}</button>}
  </div>;
 }

 return Object.assign(function GeneratePanel() {
  const s = useSyncExternalStore(subscribe, () => state), t = bridge.text, editable = bridge.useEditable(), selectedName = bridge.useSelectedTextureName(), canApply = bridge.useCanApply();
  const modelChanged = (model: string) => set({inputs: {...s.inputs, model, ...samplerDefaults(workflowNeeds(choice.workflow).kind === 'audio' ? 'audio' : 'image', model)}});
  useEffect(() => { if (!loaded) { loaded = true; set({imported: bridge.loadWorkflows()}); } void refresh(); }, []);
  const choice = choices().find(c => c.id === s.workflowId) ?? choices()[0], needs = workflowNeeds(choice.workflow), busy = Boolean(s.step);
  const p = purposeById(s.purposes[s.area]), fitting = choices().filter(c => fits(p, workflowNeeds(c.workflow))), ok = fits(p, needs), animated = Boolean(p.method);
  const presets = sizePresets(p, nativeSide(choice, s.inputs.model)), preset = presets.find(x => x.width === s.inputs.width && x.height === s.inputs.height);
  const input = (patch: Partial<GenerateInputs>) => set({inputs: {...s.inputs, ...patch}});
  const num = (key: 'steps' | 'cfg' | 'denoise' | 'seed', label: string, step: number) => <label className="field"><span>{label}</span><input type="number" aria-label={label} step={step} value={s.inputs[key]} disabled={busy || (key === 'seed' && s.randomSeed)} onChange={e => { const v = Number(e.target.value); if (Number.isFinite(v)) input({[key]: v}); }}/></label>;
  const inbox = bridge.useInbox?.();
  const skills = bridge.useSkills?.() ?? [], chosen = skills.find(k => k.id === s.skillId);
  const sizes = [...new Set([256, 384, 512, 640, 768, 896, 1024, 1280, 1536, s.inputs.width, s.inputs.height])].sort((a, b) => a - b);
  return <div className="panel-body generate-panel" data-testid="generate-panel" data-online={s.status?.online ?? false} data-phase={s.progress?.phase ?? ''}>
   <div className="generate-status" role="status">
    <span className={s.status?.online ? 'status-dot online' : 'status-dot'} aria-hidden="true"/>
    <span>{s.checking && !s.status ? t('comfy.checking') : s.status?.online ? `${t('comfy.connected')} · ${s.status.url}${s.status.version ? ` · v${s.status.version}` : ''}` : `${t('comfy.offline')} · ${s.status?.url ?? bridge.url()}`}</span>
    <button onClick={() => run(refresh)} disabled={s.checking}>{t('comfy.retry')}</button>
   </div>
   {!s.status?.online && s.status && <p className="panel-empty">{t('comfy.offlineHelp')}</p>}
   <div className="generate-areas" role="tablist" aria-label={t('comfy.area')}>{areas.map(a => <button key={a} role="tab" aria-selected={s.area === a} data-area={a} disabled={busy} onClick={() => { if (s.area !== a) choosePurpose(s.purposes[a]); }}>{t(`comfy.area.${a}`)}</button>)}</div>
   <div className="generate-purposes" role="radiogroup" aria-label={t('comfy.purpose')} data-testid="generate-purposes">{[...new Set(purposesOf(s.area).map(x => x.group))].map(g => <div key={g ?? 'all'} role="group" className="generate-purpose-group" aria-label={g ? t(`comfy.group.${g}`) : t(`comfy.area.${s.area}`)}>
    {g && <small>{t(`comfy.group.${g}`)}</small>}
    <div>{purposesOf(s.area).filter(x => x.group === g).map(x => <button key={x.id} role="radio" aria-checked={x.id === p.id} data-purpose={x.id} title={t(`comfy.purpose.${x.id}.help`)} disabled={busy} onClick={() => choosePurpose(x.id)}>{t(`comfy.purpose.${x.id}`)}</button>)}</div>
   </div>)}</div>
   <p className="generate-purpose-help" data-testid="purpose-help">{t(`comfy.purpose.${p.id}.help`)}</p>
   {!ok && <p className="component-warning" data-testid="animation-workflow-hint">{t(p.needs)}</p>}
   {fitting.length > 0 && <label className="field"><span>{t('comfy.workflow')}</span><select aria-label={t('comfy.workflow')} value={ok ? choice.id : ''} disabled={busy} onChange={e => { set({workflowId: e.target.value}); adapt(); }}>{!ok && <option value="">—</option>}{fitting.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
   <div className="panel-actions">
    <button disabled={busy || !s.status?.online} aria-expanded={s.library.open} onClick={() => s.library.open ? library({open: false}) : run(browse)}>{t('comfy.fromComfy')}</button>
    <button disabled={busy} onClick={() => run(async () => { const result = await bridge.port.openWorkflow(bridge.url()); if (!result) return; remember({id: `user.${crypto.randomUUID()}`, name: result.name, workflow: WorkflowSchema.parse(result.workflow)}); })}>{t('comfy.importWorkflow')}</button>
    {!choice.builtIn && <button disabled={busy} onClick={() => { const next = state.imported.filter(w => w.id !== choice.id); bridge.saveWorkflows(next); set({imported: next, workflowId: 'builtin.txt2img'}); adapt(); }}>{t('comfy.removeWorkflow')}</button>}
   </div>
   {s.library.open && <LibraryBrowser library={s.library} busy={busy}/>}
   {skills.length > 0 && <label className="field"><span>{t('comfy.skill')}</span><select aria-label={t('comfy.skill')} value={chosen?.id ?? ''} disabled={busy} onChange={e => chooseSkill(e.target.value)}><option value="">{t('comfy.noSkill')}</option>{skills.filter(k => !k.preset?.kind || k.preset.kind === (s.area === 'audio' ? 'audio' : 'image') || k.id === chosen?.id).map(k => <option key={k.id} value={k.id}>{k.name}</option>)}</select></label>}
   {needs.model && <label className="field"><span>{t('comfy.model')}</span><select aria-label={t('comfy.model')} value={s.inputs.model} disabled={busy || !s.checkpoints.length} onChange={e => modelChanged(e.target.value)}>{!s.checkpoints.length && <option value="">{t('comfy.noModels')}</option>}{s.checkpoints.map(m => <option key={m} value={m}>{m}</option>)}</select></label>}
   {needs.unet && <label className="field"><span>{t('comfy.unet')}</span><select aria-label={t('comfy.unet')} value={s.inputs.unet} disabled={busy} onChange={e => input({unet: e.target.value})}>{[...new Set([s.inputs.unet, ...s.unets].filter(Boolean))].map(m => <option key={m} value={m}>{m}</option>)}</select></label>}
   {(needs.unet && isFp8(s.inputs.unet ?? '') || needs.model && isFp8(s.inputs.model)) && /mps/i.test(s.status?.device ?? '') && <p className="component-warning" data-testid="fp8-warning">{t('comfy.fp8')}</p>}
   {needs.encoder && <label className="field"><span>{t('comfy.encoder')}</span><select aria-label={t('comfy.encoder')} value={s.inputs.encoder} disabled={busy || !s.encoders.length} onChange={e => input({encoder: e.target.value})}>{!s.encoders.length && <option value="">{t('comfy.noEncoders')}</option>}{s.encoders.map(m => <option key={m} value={m}>{m}</option>)}</select></label>}
   {needs.loras && <fieldset className="generate-loras" data-testid="generate-loras"><legend>{t('comfy.loras')}</legend>
    {(s.inputs.loras ?? []).map(l => <div className="lora-row" key={l.name} data-lora={l.name}>
     <span title={l.name}>{l.name.replace(/\.safetensors$/i, '')}</span>
     <input type="number" aria-label={`${t('comfy.loraStrength')} ${l.name}`} min={-4} max={4} step={0.05} value={l.strength} disabled={busy} onChange={e => { const v = Number(e.target.value); if (Number.isFinite(v) && v >= -4 && v <= 4) input({loras: (s.inputs.loras ?? []).map(x => x.name === l.name ? {...x, strength: v} : x)}); }}/>
     <button aria-label={`${t('comfy.removeLora')} ${l.name}`} title={t('comfy.removeLora')} disabled={busy} onClick={() => input({loras: (s.inputs.loras ?? []).filter(x => x.name !== l.name)})}>×</button>
    </div>)}
    <select aria-label={t('comfy.addLora')} value="" disabled={busy || (s.inputs.loras ?? []).length >= 8 || !s.loras.some(n => !(s.inputs.loras ?? []).some(l => l.name === n))} onChange={e => { if (e.target.value) input({loras: [...(s.inputs.loras ?? []), {name: e.target.value, strength: 1}]}); }}>
     <option value="">{s.loras.length ? t('comfy.addLora') : t('comfy.noLoras')}</option>
     {s.loras.filter(n => !(s.inputs.loras ?? []).some(l => l.name === n)).map(n => <option key={n} value={n}>{n}</option>)}
    </select>
   </fieldset>}
   {needs.image && (!animated || p.input) && <p className="panel-empty" data-testid="generate-input-image">{selectedName ? `${t('comfy.inputImage')}: ${selectedName}` : t('comfy.needsImage')}</p>}
   {needs.prompt && <label className="field generate-prompt"><span>{t('comfy.prompt')}</span><textarea aria-label={t('comfy.prompt')} rows={3} value={s.inputs.prompt} disabled={busy} onChange={e => input({prompt: e.target.value})}/></label>}
   {needs.prompt && chosen?.preset?.prompt.trim() && <p className="generate-template" data-testid="skill-template">{t('comfy.skillTemplate').replace('{template}', chosen.preset.prompt)}</p>}
   {needs.prompt && p.hint && !chosen?.preset?.prompt.trim() && <label className="checkbox generate-hint" title={t('comfy.skillTemplate').replace('{template}', p.hint)}><input type="checkbox" aria-label={t('comfy.hint')} checked={s.hint} disabled={busy} onChange={e => set({hint: e.target.checked})}/>{t('comfy.hint')}{s.hint && <small data-testid="purpose-template">{p.hint.replace('{prompt}', '…')}</small>}</label>}
   {needs.prompt && bridge.improvePrompt && <div className="prompt-writer">
    <div className="panel-actions">{s.writing
     ? <button onClick={() => writerAbort?.abort()}>{t('comfy.cancelWriting')}</button>
     : <button disabled={busy || !s.inputs.prompt.trim()} title={t('comfy.writePromptHint')} onClick={() => run(writePrompt)}>{`✨ ${t('comfy.writePrompt')}`}</button>}</div>
    {s.writer && <p className={`prompt-writer-status ${s.writer.phase}`} role="status" aria-live="polite" data-testid="prompt-writer-status" data-phase={s.writer.phase}>{s.writing && <span className="spinner" aria-hidden="true"/>}{writerText(s.writer)}</p>}
   </div>}
   {needs.negative && <label className="field generate-prompt"><span>{t('comfy.negative')}</span><textarea aria-label={t('comfy.negative')} rows={2} value={s.inputs.negative} disabled={busy} onChange={e => input({negative: e.target.value})}/></label>}
   {needs.lyrics && p.lyrics && <label className="field generate-prompt"><span>{t('comfy.lyrics')}</span><textarea aria-label={t('comfy.lyrics')} rows={3} value={s.inputs.lyrics} disabled={busy} onChange={e => input({lyrics: e.target.value})}/></label>}
   {needs.seconds && <div className="inline-row">
    <label className="field"><span>{t('comfy.seconds')}</span><input type="number" aria-label={t('comfy.seconds')} min={p.seconds?.min ?? 1} max={p.seconds?.max ?? 300} step={0.5} value={s.inputs.seconds} disabled={busy} onChange={e => { const v = Number(e.target.value); if (Number.isFinite(v)) input({seconds: v}); }}/></label>
    {needs.batch && <label className="field"><span>{t('comfy.batch')}</span><select aria-label={t('comfy.batch')} value={s.inputs.batch} disabled={busy} onChange={e => input({batch: Number(e.target.value)})}>{[1, 2, 3, 4].map(v => <option key={v} value={v}>{v}</option>)}</select></label>}
   </div>}
   {needs.size && presets.length > 0 && <label className="field"><span>{t('comfy.size')}</span><select aria-label={t('comfy.size')} value={preset && !s.customSize ? preset.label : 'custom'} disabled={busy} onChange={e => { const x = presets.find(v => v.label === e.target.value); set({customSize: !x}); if (x) input({width: x.width, height: x.height}); }}>{presets.map(x => <option key={x.label} value={x.label}>{`${x.label} · ${x.width}×${x.height}`}</option>)}<option value="custom">{t('comfy.size.custom')}</option></select></label>}
   {needs.size && <div className="inline-row">
    {(!preset || s.customSize || !presets.length) && <><label className="field"><span>{t('comfy.width')}</span><select aria-label={t('comfy.width')} value={s.inputs.width} disabled={busy} onChange={e => input({width: Number(e.target.value)})}>{sizes.map(v => <option key={v} value={v}>{v}</option>)}</select></label>
    <label className="field"><span>{t('comfy.height')}</span><select aria-label={t('comfy.height')} value={s.inputs.height} disabled={busy} onChange={e => input({height: Number(e.target.value)})}>{sizes.map(v => <option key={v} value={v}>{v}</option>)}</select></label></>}
    {!animated && <label className="field"><span>{t('comfy.batch')}</span><select aria-label={t('comfy.batch')} value={s.inputs.batch} disabled={busy} onChange={e => input({batch: Number(e.target.value)})}>{[1, 2, 3, 4].map(v => <option key={v} value={v}>{v}</option>)}</select></label>}
   </div>}
   {needs.image && (!animated || s.animation.method === 'edit') && <label className="field generate-amount"><span>{t('comfy.changeAmount')}</span><input type="range" aria-label={t('comfy.changeAmount')} min={0.05} max={1} step={0.05} value={s.inputs.denoise} disabled={busy} onChange={e => input({denoise: Number(e.target.value)})}/><output>{Math.round(s.inputs.denoise * 100)}%</output></label>}
   {!animated && p.cutout !== undefined && needs.kind === 'image' && <label className="checkbox" title={s.removers.length ? s.removers[0] : t('comfy.removeBackgroundMissing')}><input type="checkbox" aria-label={t('comfy.removeBackground')} checked={s.animation.removeBackground && s.removers.length > 0} disabled={busy || !s.removers.length} onChange={e => animate({removeBackground: e.target.checked})}/>{t('comfy.removeBackground')}</label>}
   <details className="generate-advanced"><summary>{t('comfy.advanced')}</summary>
    {needs.steps && num('steps', t('comfy.steps'), 1)}{needs.cfg && num('cfg', t('comfy.cfg'), 0.5)}
    {num('seed', t('comfy.seed'), 1)}
    <label className="checkbox"><input type="checkbox" aria-label={t('comfy.randomSeed')} checked={s.randomSeed} disabled={busy} onChange={e => set({randomSeed: e.target.checked})}/>{t('comfy.randomSeed')}</label>
   </details>
   {animated && <div className="generate-animation" data-testid="animation-settings">
    <label className="field"><span>{t('comfy.motion')}</span><input aria-label={t('comfy.motion')} placeholder={t('comfy.motionHint')} value={s.animation.motion} disabled={busy} onChange={e => animate({motion: e.target.value})}/></label>
    <div className="inline-row">
     <label className="field"><span>{t('comfy.frames')}</span><input type="number" aria-label={t('comfy.frames')} min={2} max={32} value={s.animation.frames} disabled={busy} onChange={e => { const v = Math.round(Number(e.target.value)); if (v >= 2 && v <= 32) animate({frames: v, columns: Math.min(s.animation.columns, v)}); }}/></label>
     <label className="field"><span>{t('comfy.columns')}</span><input type="number" aria-label={t('comfy.columns')} min={1} max={s.animation.frames} value={s.animation.columns} disabled={busy} onChange={e => { const v = Math.round(Number(e.target.value)); if (v >= 1 && v <= s.animation.frames) animate({columns: v}); }}/></label>
     <label className="field"><span>{t('comfy.fps')}</span><input type="number" aria-label={t('comfy.fps')} min={1} max={60} value={s.animation.fps} onChange={e => { const v = Number(e.target.value); if (v >= 1 && v <= 60) animate({fps: v}); }}/></label>
    </div>
    <label className="checkbox"><input type="checkbox" aria-label={t('comfy.loop')} checked={s.animation.loop} onChange={e => animate({loop: e.target.checked})}/>{t('comfy.loop')}</label>
    {s.animation.method !== 'sheet' && !p.input && (s.animation.method === 'edit' || needs.image) && <label className="checkbox"><input type="checkbox" aria-label={t('comfy.fromSelection')} checked={s.animation.fromSelection} disabled={busy} onChange={e => animate({fromSelection: e.target.checked})}/>{selectedName ? `${t('comfy.fromSelection')} (${selectedName})` : t('comfy.fromSelection')}</label>}
    <label className="checkbox" title={s.removers.length ? s.removers[0] : t('comfy.removeBackgroundMissing')}><input type="checkbox" aria-label={t('comfy.removeBackground')} checked={s.animation.removeBackground && s.removers.length > 0} disabled={busy || !s.removers.length} onChange={e => animate({removeBackground: e.target.checked})}/>{t('comfy.removeBackground')}</label>
    {s.step && <p className="prompt-writer-status" role="status" data-testid="animation-step"><span className="spinner" aria-hidden="true"/>{s.step}</p>}
    {s.frames.length > 0 && <div className="generate-frames" data-testid="animation-frames">
     <FramePreview frames={s.frames} fps={s.animation.fps} label={t('comfy.animationPreview')}/>
     <div className="generate-frame-strip" role="list" aria-label={t('comfy.frameList')}>{s.frames.map((f, i) => <label role="listitem" key={f.id} className={`generate-frame${f.on ? '' : ' off'}`}><img src={f.url} alt=""/><input type="checkbox" aria-label={t('comfy.useFrame').replace('{n}', String(i + 1))} checked={f.on} disabled={busy || Boolean(s.step)} onChange={e => set({frames: state.frames.map(x => x.id === f.id ? {...x, on: e.target.checked} : x)})}/></label>)}</div>
     <button className="primary" disabled={!editable || busy || Boolean(s.step) || !s.frames.some(f => f.on)} onClick={() => run(createAnimation)}>{t('comfy.createAnimation')}</button>
    </div>}
   </div>}
   {animated ? <button className="primary" disabled={!editable || !s.status?.online || Boolean(s.step) || !s.inputs.prompt.trim() || !ok || (s.animation.fromSelection && !selectedName)} onClick={() => run(generateFrames)}>{t('comfy.generateFrames')}</button> : <button className="primary" disabled={!editable || !s.status?.online || !ok || (needs.prompt && !s.inputs.prompt.trim()) || (needs.image && !selectedName)} onClick={() => run(generate)}>{t('comfy.generate')}</button>}
   <JobsSummary/>
   {inbox && s.results.some(r => inbox.has(r.id)) && bridge.sendToLibrary && <div className="panel-actions"><button className="primary" disabled={!editable} onClick={() => run(() => bridge.sendToLibrary!(s.results.filter(r => inbox.has(r.id)).map(r => r.id)))}>{`📥 ${t('comfy.sendAllToLibrary')}`}</button></div>}
   {s.results.length > 0 && <div className="generate-results" role="list" aria-label={t('comfy.results')}>
    {s.results.map(({id, kind, sheet}) => { const url = kind !== 'audio' ? bridge.thumbnail(id) : undefined, name = bridge.assetName(id); return name ? <div role="listitem" key={id} className={`generate-result ${kind}`} data-asset={id} data-kind={kind}>
     {url && <img src={url} alt={name}/>}{kind === 'audio' && <div className="generate-audio" aria-hidden="true">♪</div>}<small>{name}</small>
     {kind === 'audio' && bridge.clipControls(id)}
     {inbox && bridge.sendToLibrary && (inbox.has(id) ? <button className="generate-send" aria-label={`${t('comfy.sendToLibrary')} ${name}`} title={t('comfy.sendToLibraryHint')} disabled={!editable} onClick={() => run(() => bridge.sendToLibrary!([id]))}>{`📥 ${t('comfy.sendToLibrary')}`}</button> : <small className="generate-sent" data-testid="in-library">{t('comfy.inLibrary')}</small>)}
     {kind === 'animation' && sheet ? <div className="panel-actions"><button disabled={!editable} aria-label={`${t('comfy.place')} ${name}`} onClick={() => run(() => bridge.placeAnimation(id, sheet))}>{t('comfy.place')}</button><small>{t('comfy.sheetInfo').replace('{frames}', String(sheet.frames)).replace('{fps}', String(sheet.fps))}</small></div> : <div className="panel-actions"><button disabled={!editable} aria-label={`${t('comfy.place')} ${name}`} onClick={() => run(() => bridge.place(id))}>{t('comfy.place')}</button><button disabled={!editable || kind === 'animation' || !canApply[kind as 'image' | 'audio']} aria-label={`${t(kind === 'audio' ? 'comfy.applySound' : 'comfy.apply')} ${name}`} onClick={() => run(() => bridge.applyToSelection(id))}>{t(kind === 'audio' ? 'comfy.applySound' : 'comfy.apply')}</button></div>}
    </div> : null; })}
   </div>}
  </div>;
 }, {Jobs: JobsPanel,
  /** LoRA files ComfyUI reports (checks the server once if nothing is known yet). */
  useLoras() { useEffect(() => { if (!state.status) void refresh(); }, []); return useSyncExternalStore(subscribe, () => state.loras); },
  /** Names of the workflows the panel offers (built-in and imported). */
  useWorkflowNames() { useEffect(() => { if (!loaded) { loaded = true; set({imported: bridge.loadWorkflows()}); } }, []); const imported = useSyncExternalStore(subscribe, () => state.imported); return useMemo(() => [...builtInWorkflows(), ...imported].map(c => c.name), [imported]); },
 });
}
