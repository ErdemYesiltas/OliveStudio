import {dialog, ipcMain, type BrowserWindow} from 'electron';
import {mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {basename, join} from 'node:path';
import {imageImporter} from '@rewrite/assetpack/catalog';
import {audioImporter} from '@rewrite/audio/contracts';
import {resolveComfy} from '@rewrite/ai-comfy/client.node';
import {analyzeWorkflow, backgroundRemovalWorkflow, GenerateRequestSchema, WorkflowSchema, type ComfyProgress} from '@rewrite/ai-comfy/contracts';
import {isUiWorkflow, libraryProblems, uiToApi, type LibraryItem} from '@rewrite/ai-comfy/convert';
import type {ComfyClient} from '@rewrite/ai-comfy/client.node';
import type {NativeAssets} from './native-assets.types';

/**
 * ComfyUI bridge in the main process: the renderer never talks to the network. Results are written to a private temp
 * folder and imported through the normal asset pipeline (validation, WebP, thumbnails), then the temp files are removed.
 */
export function registerComfy(options: {window(): BrowserWindow | null; sender(event: Electron.IpcMainInvokeEvent): void; assets(): NativeAssets | null; task<T>(work: () => Promise<T>): Promise<T>; temp: string}) {
 const jobs = new Map<string, {abort: AbortController; cancel(): Promise<void>}>();
 const progress = (p: ComfyProgress) => options.window()?.webContents.send('comfy:progress', p);
 const url = (value: unknown) => { if (typeof value !== 'string' || value.length > 200) throw Error('Invalid ComfyUI address'); return value; };

 ipcMain.handle('comfy:status', async (event, value: unknown) => {
  options.sender(event);
  const client = await resolveComfy(url(value)), status = await client.status();
  return {status, checkpoints: status.online ? await client.checkpoints().catch(() => []) : [], encoders: status.online ? await client.encoders().catch(() => []) : [], removers: status.online ? await client.removers().catch(() => []) : [], unets: status.online ? await client.unets().catch(() => []) : [], loras: status.online ? await client.loras().catch(() => []) : []};
 });
 /** A UI-format save converted with this server's node schemas; problems say why it cannot run as it is. */
 const convert = async (client: ComfyClient, json: unknown) => { const report = uiToApi(json, await client.objectInfo()); return {workflow: report.workflow, problems: libraryProblems(report)}; };
 const libraryItem = (value: unknown): Pick<LibraryItem, 'source' | 'ref'> => {
  const v = value as Partial<LibraryItem> | null;
  if (!v || (v.source !== 'user' && v.source !== 'template') || typeof v.ref !== 'string' || !v.ref || v.ref.length > 300) throw Error('Invalid ComfyUI workflow');
  return {source: v.source, ref: v.ref};
 };
 ipcMain.handle('comfy:open-workflow', async (event, value: unknown) => {
  options.sender(event);
  const window = options.window();
  const result = window ? await dialog.showOpenDialog(window, {properties: ['openFile'], filters: [{name: 'ComfyUI workflow', extensions: ['json']}]}) : {canceled: true, filePaths: []};
  if (result.canceled || !result.filePaths[0]) return null;
  const text = await readFile(result.filePaths[0], 'utf8');
  if (Buffer.byteLength(text) > 5 * 1024 * 1024) throw Error('Workflow file is too large');
  let json: unknown = JSON.parse(text);
  if (isUiWorkflow(json)) {
   const client = await resolveComfy(url(value));
   if (!(await client.status()).online) throw Error('This is a ComfyUI app workflow: start ComfyUI so the editor can convert it (or use Workflow → Export (API) in ComfyUI).');
   const converted = await convert(client, json);
   if (converted.problems.length) throw Error(converted.problems.join('. '));
   json = converted.workflow;
  }
  const workflow = WorkflowSchema.parse(json), slots = analyzeWorkflow(workflow);
  if (!slots.outputs.length) throw Error('The workflow has no image or audio output node (SaveImage, SaveAudio…)');
  return {name: basename(result.filePaths[0]).replace(/\.json$/i, '').slice(0, 60) || 'Workflow', workflow};
 });
 ipcMain.handle('comfy:library', async (event, value: unknown) => {
  options.sender(event);
  const client = await resolveComfy(url(value));
  return client.library();
 });
 /** Converts every listed workflow to find which run on this server as they are (models, nodes, inputs). */
 ipcMain.handle('comfy:library-check', async (event, value: unknown, items: unknown) => {
  options.sender(event);
  if (!Array.isArray(items) || items.length > 1000) throw Error('Invalid workflow list');
  const client = await resolveComfy(url(value)), list = items.map(libraryItem), out: Record<string, string[]> = {};
  let next = 0;
  const worker = async () => { while (next < list.length) { const item = list[next++]; try { out[`${item.source}:${item.ref}`] = (await convert(client, await client.libraryWorkflow(item))).problems; } catch (error) { out[`${item.source}:${item.ref}`] = [String(error instanceof Error ? error.message : error)]; } } };
  await Promise.all(Array.from({length: 6}, worker));
  return out;
 });
 ipcMain.handle('comfy:library-get', async (event, value: unknown, input: unknown) => {
  options.sender(event);
  const client = await resolveComfy(url(value)), item = libraryItem(input), converted = await convert(client, await client.libraryWorkflow(item));
  if (converted.problems.length) throw Error(converted.problems.join('. '));
  return {workflow: WorkflowSchema.parse(converted.workflow)};
 });
 ipcMain.handle('comfy:cancel', async (event, jobId: unknown) => { options.sender(event); const job = typeof jobId === 'string' ? jobs.get(jobId) : undefined; if (job) { job.abort.abort(); await job.cancel(); } });
 ipcMain.handle('comfy:generate', async (event, value: unknown, jobId: unknown, input: unknown) => {
  options.sender(event);
  if (typeof jobId !== 'string' || !/^[a-f0-9-]{36}$/.test(jobId) || jobs.has(jobId)) throw Error('Invalid generation job');
  const request = GenerateRequestSchema.parse(input), client = await resolveComfy(url(value)), abort = new AbortController();
  let promptId: string | undefined;
  jobs.set(jobId, {abort, cancel: async () => { if (promptId) await client.cancel(promptId); }});
  const folder = join(options.temp, jobId);
  try {
   const workflow = structuredClone(request.workflow), slots = analyzeWorkflow(workflow);
   if (slots.image) {
    if (!request.image) throw Error('This workflow needs an input image: select a sprite with a texture');
    workflow[slots.image].inputs.image = await client.upload(request.image, `olivestudio-${jobId}.png`);
   }
   progress({jobId, phase: 'queued', value: 0, max: 1});
   promptId = await client.queue(workflow);
   const images = await client.wait(promptId, p => progress({jobId, phase: 'running', value: p.value, max: p.max, node: p.node}), abort.signal);
   if (!images.length) throw Error('ComfyUI finished without saving an image or sound');
   if (request.frames) {
    // Animation frames come back as bytes (packed into one sheet by the editor), in output-node then file order.
    const pictures = images.filter(f => /\.(png|webp|jpe?g)$/i.test(f.filename)).slice(0, 128);
    if (!pictures.length) throw Error(`ComfyUI saved ${images.map(f => f.filename).join(', ')}; animation frames must be images`);
    progress({jobId, phase: 'saving', value: 0, max: pictures.length});
    const frames: Uint8Array[] = [];
    for (const [i, file] of pictures.entries()) { frames.push(await client.view(file)); progress({jobId, phase: 'saving', value: i + 1, max: pictures.length}); }
    progress({jobId, phase: 'done', value: 1, max: 1});
    return {records: [], kind: slots.kind, frames};
   }
   const kind = slots.kind, importer = kind === 'audio' ? audioImporter : imageImporter, allowed = new Set<string>(importer.extensions);
   const files = images.filter(f => allowed.has(f.filename.split('.').pop()!.toLowerCase()));
   if (!files.length) throw Error(`ComfyUI saved ${images.map(f => f.filename).join(', ')}; the editor imports ${[...allowed].join('/')}`);
   progress({jobId, phase: 'saving', value: 0, max: files.length});
   await mkdir(folder, {recursive: true});
   const safe = request.name.replace(/[^a-zA-Z0-9-_]+/g, '-').slice(0, 50) || 'generated', paths: string[] = [];
   for (const [i, file] of files.entries()) { const ext = file.filename.split('.').pop()!.toLowerCase(), path = join(folder, files.length > 1 ? `${safe}-${i + 1}.${ext}` : `${safe}.${ext}`); await writeFile(path, await client.view(file)); paths.push(path); progress({jobId, phase: 'saving', value: i + 1, max: files.length}); }
   const assets = options.assets();
   if (!assets) throw Error('Assets unavailable');
   // Another file operation may hold the lock for a moment; wait briefly instead of failing the whole generation.
   let records;
   for (let attempt = 0; ; attempt++) {
    try { records = await options.task(() => assets.import(paths, importer.id)); break; } catch (error) { if (attempt >= 20 || !String(error).includes('already running')) throw error; await new Promise(r => setTimeout(r, 500)); }
   }
   progress({jobId, phase: 'done', value: 1, max: 1});
   return {records, kind};
  } catch (error) {
   const cancelled = abort.signal.aborted;
   progress({jobId, phase: cancelled ? 'cancelled' : 'failed', value: 0, max: 1, message: String(error instanceof Error ? error.message : error)});
   if (cancelled) return {records: [], cancelled: true};
   throw error;
  } finally {
   jobs.delete(jobId);
   await rm(folder, {recursive: true, force: true}).catch(() => {});
  }
 });
 /** Imports PNG bytes the editor made (a packed sprite sheet) through the image importer. */
 const importImage = async (bytes: Uint8Array, name: string, folder: string) => {
  await mkdir(folder, {recursive: true});
  const path = join(folder, `${name.replace(/[^a-zA-Z0-9-_]+/g, '-').slice(0, 50) || 'animation'}.png`);
  await writeFile(path, bytes);
  const assets = options.assets();
  if (!assets) throw Error('Assets unavailable');
  for (let attempt = 0; ; attempt++) {
   try { return await options.task(() => assets.import([path], imageImporter.id)); } catch (error) { if (attempt >= 20 || !String(error).includes('already running')) throw error; await new Promise(r => setTimeout(r, 500)); }
  }
 };
 const frameList = (value: unknown) => {
  if (!Array.isArray(value) || !value.length || value.length > 128) throw Error('Send 1–128 frames');
  return value.map(v => { if (!(v instanceof Uint8Array) || !v.byteLength || v.byteLength > 16 * 1024 * 1024) throw Error('Each frame must be an image under 16 MB'); return v; });
 };
 ipcMain.handle('comfy:remove-background', async (event, value: unknown, jobId: unknown, input: unknown) => {
  options.sender(event);
  if (typeof jobId !== 'string' || !/^[a-f0-9-]{36}$/.test(jobId) || jobs.has(jobId)) throw Error('Invalid generation job');
  const frames = frameList(input), client = await resolveComfy(url(value)), abort = new AbortController();
  let promptId: string | undefined;
  jobs.set(jobId, {abort, cancel: async () => { if (promptId) await client.cancel(promptId); }});
  try {
   const model = (await client.removers())[0];
   if (!model) throw Error('No background removal model in ComfyUI (install BiRefNet: the "Remove Background" template lists it)');
   progress({jobId, phase: 'queued', value: 0, max: frames.length});
   const names: string[] = [];
   for (const [i, frame] of frames.entries()) names.push(await client.upload(frame, `olivestudio-${jobId}-${i}.png`));
   promptId = await client.queue(backgroundRemovalWorkflow(model, names));
   const outputs = await client.wait(promptId, p => progress({jobId, phase: 'running', value: p.value, max: p.max, node: p.node}), abort.signal);
   const cutouts: Uint8Array[] = [];
   for (const file of outputs.filter(f => /\.png$/i.test(f.filename))) cutouts.push(await client.view(file));
   if (cutouts.length !== frames.length) throw Error(`Background removal returned ${cutouts.length} of ${frames.length} frames`);
   progress({jobId, phase: 'done', value: 1, max: 1});
   return {frames: cutouts};
  } catch (error) {
   const cancelled = abort.signal.aborted;
   progress({jobId, phase: cancelled ? 'cancelled' : 'failed', value: 0, max: 1, message: String(error instanceof Error ? error.message : error)});
   if (cancelled) return {frames: [], cancelled: true};
   throw error;
  } finally { jobs.delete(jobId); }
 });
 ipcMain.handle('comfy:import-sheet', async (event, bytes: unknown, name: unknown) => {
  options.sender(event);
  if (!(bytes instanceof Uint8Array) || !bytes.byteLength || bytes.byteLength > 64 * 1024 * 1024) throw Error('Sprite sheet must be a PNG under 64 MB');
  if (typeof name !== 'string' || name.length > 80) throw Error('Invalid sprite sheet name');
  const folder = join(options.temp, `sheet-${crypto.randomUUID()}`);
  try { return await importImage(bytes, name, folder); } finally { await rm(folder, {recursive: true, force: true}).catch(() => {}); }
 });
 /** Background jobs: queue and return at once; the editor follows them (and can be closed meanwhile). */
 ipcMain.handle('comfy:submit', async (event, value: unknown, input: unknown) => {
  options.sender(event);
  const request = GenerateRequestSchema.parse(input), client = await resolveComfy(url(value)), workflow = structuredClone(request.workflow);
  const placeholders = Object.keys(workflow).filter(id => workflow[id].class_type === 'LoadImage' && workflow[id].inputs.image === ''), slot = analyzeWorkflow(workflow).image;
  if (placeholders.length || (slot && request.image)) {
   if (!request.image) throw Error('This workflow needs an input image: select a sprite with a texture');
   const uploaded = await client.upload(request.image, `olivestudio-${crypto.randomUUID()}.png`);
   for (const id of placeholders.length ? placeholders : [slot!]) workflow[id].inputs.image = uploaded;
  }
  return {promptId: await client.queue(workflow)};
 });
 ipcMain.handle('comfy:jobs', async (event, value: unknown, ids: unknown) => {
  options.sender(event);
  if (!Array.isArray(ids) || ids.length > 200 || ids.some(id => typeof id !== 'string' || id.length > 100)) throw Error('Invalid job list');
  const client = await resolveComfy(url(value));
  if (!(await client.status()).online) return {};
  return client.jobs(ids as string[]);
 });
 ipcMain.handle('comfy:job-result', async (event, value: unknown, input: unknown) => {
  options.sender(event);
  const request = input as {promptId?: unknown; frames?: unknown; kind?: unknown; name?: unknown} | null;
  if (!request || typeof request.promptId !== 'string' || typeof request.name !== 'string' || request.name.length > 120) throw Error('Invalid job');
  const client = await resolveComfy(url(value)), files = await client.outputs(request.promptId);
  if (request.frames === true) {
   const pictures = files.filter(f => /\.(png|webp|jpe?g)$/i.test(f.filename)).slice(0, 128), frames: Uint8Array[] = [];
   for (const file of pictures) frames.push(await client.view(file));
   if (!frames.length) throw Error('The job saved no images');
   return {frames};
  }
  const importer = request.kind === 'audio' ? audioImporter : imageImporter, allowed = new Set<string>(importer.extensions), chosen = files.filter(f => allowed.has(f.filename.split('.').pop()!.toLowerCase()));
  if (!chosen.length) throw Error(`The job saved ${files.map(f => f.filename).join(', ') || 'nothing'}; the editor imports ${[...allowed].join('/')}`);
  const folder = join(options.temp, `job-${crypto.randomUUID()}`);
  try {
   await mkdir(folder, {recursive: true});
   const safe = request.name.replace(/[^a-zA-Z0-9-_]+/g, '-').slice(0, 50) || 'generated', paths: string[] = [];
   for (const [i, file] of chosen.entries()) { const ext = file.filename.split('.').pop()!.toLowerCase(), path = join(folder, chosen.length > 1 ? `${safe}-${i + 1}.${ext}` : `${safe}.${ext}`); await writeFile(path, await client.view(file)); paths.push(path); }
   const assets = options.assets();
   if (!assets) throw Error('Assets unavailable');
   for (let attempt = 0; ; attempt++) {
    try { return {records: await options.task(() => assets.import(paths, importer.id))}; } catch (error) { if (attempt >= 20 || !String(error).includes('already running')) throw error; await new Promise(r => setTimeout(r, 500)); }
   }
  } finally { await rm(folder, {recursive: true, force: true}).catch(() => {}); }
 });
 ipcMain.handle('comfy:job-cancel', async (event, value: unknown, promptId: unknown) => {
  options.sender(event);
  if (typeof promptId !== 'string' || promptId.length > 100) throw Error('Invalid job');
  await (await resolveComfy(url(value))).cancel(promptId);
 });
 return {dispose() { for (const job of jobs.values()) { job.abort.abort(); void job.cancel(); } jobs.clear(); for (const channel of ['comfy:status', 'comfy:open-workflow', 'comfy:submit', 'comfy:jobs', 'comfy:job-result', 'comfy:job-cancel', 'comfy:remove-background', 'comfy:import-sheet', 'comfy:library', 'comfy:library-check', 'comfy:library-get', 'comfy:cancel', 'comfy:generate']) ipcMain.removeHandler(channel); }};
}
