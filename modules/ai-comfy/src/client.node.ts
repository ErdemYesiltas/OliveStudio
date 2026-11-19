import {assertLocal, defaultComfyUrls, explainFailure, WorkflowSchema, type ComfyStatus, type Workflow} from './contracts';
import type {LibraryItem, ObjectInfo} from './convert';

const infoCache = new Map<string, {at: number; info: Promise<ObjectInfo>}>();

/**
 * ComfyUI HTTP/WebSocket client for the Electron main process (Node 22: global fetch and WebSocket). Every address is
 * checked to be loopback. Progress comes from `/ws`; `/history` polling is the fallback and the source of truth for
 * completion and errors, so a missing or broken socket never hangs a job.
 */
export interface ImageRef {filename: string; subfolder: string; type: string;
 /** The output node that saved it (frames are ordered by node, then by file). */
 node?: string}
export class ComfyClient {
 readonly base: URL;
 readonly clientId = crypto.randomUUID();
 constructor(url: string, private timeoutMs = 10 * 60 * 1000) { this.base = assertLocal(url); }
 private url(path: string, query?: Record<string, string>) { const u = new URL(path, this.base); for (const [k, v] of Object.entries(query ?? {})) u.searchParams.set(k, v); return u; }
 private async json<T>(path: string, init?: RequestInit, timeout = 15000): Promise<T> {
  const response = await fetch(this.url(path), {...init, signal: AbortSignal.any([AbortSignal.timeout(timeout), ...(init?.signal ? [init.signal] : [])])});
  const text = await response.text();
  if (!response.ok) { let message = text.slice(0, 500); try { const body = JSON.parse(text); message = body?.error?.message ?? body?.message ?? message; if (body?.node_errors && Object.keys(body.node_errors).length) message += ': ' + Object.values(body.node_errors as Record<string, {errors?: {message?: string; details?: string}[]}>).flatMap(n => n.errors ?? []).map(e => [e.message, e.details].filter(Boolean).join(' ')).join('; '); } catch { /* plain text */ } throw Error(`ComfyUI ${response.status}: ${message}`); }
  return JSON.parse(text) as T;
 }
 async status(): Promise<ComfyStatus> {
  try {
   const s = await this.json<{system?: {comfyui_version?: string}; devices?: {name?: string; vram_free?: number}[]}>('/system_stats', undefined, 2500);
   return {online: true, url: this.base.origin, version: s.system?.comfyui_version, device: s.devices?.[0]?.name, vramFreeMB: s.devices?.[0]?.vram_free ? Math.round(s.devices[0].vram_free / 1048576) : undefined};
  } catch (error) { return {online: false, url: this.base.origin, error: String(error instanceof Error ? error.message : error)}; }
 }
 /** Text encoder files known to `CLIPLoader` (audio models pair a checkpoint with one). */
 async encoders(): Promise<string[]> {
  const info = await this.json<Record<string, {input?: {required?: {clip_name?: [unknown]}}}>>('/object_info/CLIPLoader');
  const list = info.CLIPLoader?.input?.required?.clip_name?.[0];
  return Array.isArray(list) ? list.filter((v): v is string => typeof v === 'string') : [];
 }
 /** Diffusion model files known to `UNETLoader`. */
 async unets(): Promise<string[]> {
  const info = await this.json<Record<string, {input?: {required?: {unet_name?: [unknown]}}}>>('/object_info/UNETLoader').catch(() => ({} as Record<string, never>));
  const list = info.UNETLoader?.input?.required?.unet_name?.[0];
  return Array.isArray(list) ? list.filter((v): v is string => typeof v === 'string') : [];
 }
 /** LoRA files known to `LoraLoader` (empty when the node is missing). */
 async loras(): Promise<string[]> {
  const info = await this.json<Record<string, {input?: {required?: {lora_name?: [unknown]}}}>>('/object_info/LoraLoader').catch(() => ({} as Record<string, never>));
  const list = info.LoraLoader?.input?.required?.lora_name?.[0];
  return Array.isArray(list) ? list.filter((v): v is string => typeof v === 'string') : [];
 }
 /** Background removal models (BiRefNet…) known to `LoadBackgroundRemovalModel`; empty when the node is missing. */
 async removers(): Promise<string[]> {
  const info = await this.json<Record<string, {input?: {required?: {bg_removal_name?: [unknown, {options?: unknown}?]}}}>>('/object_info/LoadBackgroundRemovalModel').catch(() => ({} as Record<string, never>));
  const spec = info.LoadBackgroundRemovalModel?.input?.required?.bg_removal_name, list = Array.isArray(spec?.[0]) ? spec[0] : spec?.[1]?.options;
  return Array.isArray(list) ? list.filter((v): v is string => typeof v === 'string') : [];
 }
 /** Checkpoint names known to `CheckpointLoaderSimple`. */
 async checkpoints(): Promise<string[]> {
  const info = await this.json<Record<string, {input?: {required?: {ckpt_name?: [unknown]}}}>>('/object_info/CheckpointLoaderSimple');
  const list = info.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0];
  return Array.isArray(list) ? list.filter((v): v is string => typeof v === 'string') : [];
 }
 /** Every node schema (cached for a minute: conversions of a whole list share one fetch). */
 objectInfo(): Promise<ObjectInfo> {
  const cached = infoCache.get(this.base.origin);
  if (cached && Date.now() - cached.at < 60000) return cached.info;
  const info = this.json<ObjectInfo>('/object_info', undefined, 60000);
  infoCache.set(this.base.origin, {at: Date.now(), info});
  info.catch(() => infoCache.delete(this.base.origin));
  return info;
 }
 /** Workflows saved in ComfyUI (user data) and installed templates for images, sound and video (paid API templates left out). */
 async library(): Promise<LibraryItem[]> {
  const [saved, index] = await Promise.all([
   this.json<{path?: string}[] | string[]>('/api/userdata?dir=workflows&recurse=true&split=false&full_info=true').catch(() => []),
   this.json<{title?: string; type?: string; templates?: {name?: string; title?: string; description?: string; openSource?: boolean}[]}[]>('/templates/index.json').catch(() => []),
  ]);
  const user = (Array.isArray(saved) ? saved : []).map(e => typeof e === 'string' ? e : e?.path).filter((p): p is string => typeof p === 'string' && /\.json$/i.test(p))
   .map((path): LibraryItem => ({source: 'user', ref: path, title: path.replace(/\.json$/i, '').split('/').pop()!.replace(/[_-]+/g, ' '), group: 'Your workflows'}));
  const templates = (Array.isArray(index) ? index : []).filter(c => c?.type === 'image' || c?.type === 'audio' || c?.type === 'video').flatMap(c => (c.templates ?? [])
   .filter(t => typeof t?.name === 'string' && /^[\w.-]+$/.test(t.name) && !t.name.startsWith('api_') && t.openSource !== false)
   .map((t): LibraryItem => ({source: 'template', ref: t.name!, title: t.title || t.name!, group: c.title || c.type!, description: t.description?.slice(0, 300)})));
  const seen = new Set<string>();
  return [...user, ...templates].filter(i => { const key = `${i.source}:${i.ref}`; if (seen.has(key)) return false; seen.add(key); return true; });
 }
 /** The UI-format JSON of a library item. */
 async libraryWorkflow(item: Pick<LibraryItem, 'source' | 'ref'>): Promise<unknown> {
  if (item.source === 'template') { if (!/^[\w.-]+$/.test(item.ref)) throw Error('Invalid template name'); return this.json(`/templates/${encodeURIComponent(item.ref)}.json`, undefined, 30000); }
  if (item.ref.split(/[\\/]/).some(part => part === '..' || part === '') || !/\.json$/i.test(item.ref)) throw Error('Invalid workflow path');
  return this.json(`/api/userdata/${encodeURIComponent(`workflows/${item.ref}`)}`, undefined, 30000);
 }
 async upload(bytes: Uint8Array, name: string): Promise<string> {
  const form = new FormData();
  form.append('image', new Blob([new Uint8Array(bytes)], {type: 'image/png'}), name); form.append('overwrite', 'true'); form.append('type', 'input');
  const result = await this.json<{name: string; subfolder?: string}>('/upload/image', {method: 'POST', body: form}, 60000);
  return result.subfolder ? `${result.subfolder}/${result.name}` : result.name;
 }
 async queue(workflow: Workflow): Promise<string> {
  const result = await this.json<{prompt_id: string}>('/prompt', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({prompt: WorkflowSchema.parse(workflow), client_id: this.clientId})}, 30000);
  if (!result.prompt_id) throw Error('ComfyUI did not return a prompt id');
  return result.prompt_id;
 }
 /** Stops the running job (if it is ours) and removes it from the queue. */
 async cancel(promptId: string) {
  await fetch(this.url('/queue'), {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({delete: [promptId]}), signal: AbortSignal.timeout(5000)}).catch(() => {});
  await fetch(this.url('/interrupt'), {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({prompt_id: promptId}), signal: AbortSignal.timeout(5000)}).catch(() => {});
 }
 /** Where prompts are: running/pending in the queue, finished (or failed) in the history, or gone (server restarted). */
 async jobs(promptIds: readonly string[]): Promise<Record<string, import('./contracts').JobStatus>> {
  const queue = await this.json<{queue_running?: [number, string][]; queue_pending?: [number, string][]}>('/queue');
  const running = new Set((queue.queue_running ?? []).map(q => q[1])), pending = (queue.queue_pending ?? []).slice().sort((a, b) => a[0] - b[0]).map(q => q[1]), out: Record<string, import('./contracts').JobStatus> = {};
  for (const id of promptIds) {
   if (running.has(id)) { out[id] = {state: 'running'}; continue; }
   const at = pending.indexOf(id);
   if (at >= 0) { out[id] = {state: 'queued', ahead: at + running.size}; continue; }
   const history = await this.json<Record<string, {status?: {status_str?: string; completed?: boolean; messages?: [string, {exception_message?: string}][]}; outputs?: Record<string, {images?: ImageRef[]; audio?: ImageRef[]}>}>>(`/history/${encodeURIComponent(id)}`).catch(() => ({} as Record<string, never>));
   const entry = history[id];
   if (!entry) { out[id] = {state: 'lost'}; continue; }
   if (entry.status?.status_str === 'error') { const detail = entry.status.messages?.find(m => m[0] === 'execution_error')?.[1]?.exception_message; out[id] = {state: 'failed', error: explainFailure(`ComfyUI failed${detail ? `: ${detail.trim()}` : ''}`)}; continue; }
   const files = Object.values(entry.outputs ?? {}).flatMap(o => [...(o.images ?? []), ...(o.audio ?? [])]).filter(i => i.type === 'output');
   out[id] = entry.status?.completed || files.length ? {state: 'done', outputs: files.length} : {state: 'running'};
  }
  return out;
 }
 /** Output files of a finished prompt (images and audio, in output-node then file order). */
 async outputs(promptId: string): Promise<ImageRef[]> {
  const history = await this.json<Record<string, {outputs?: Record<string, {images?: ImageRef[]; audio?: ImageRef[]}>}>>(`/history/${encodeURIComponent(promptId)}`);
  const entry = history[promptId];
  if (!entry) throw Error('ComfyUI no longer has this job (was it restarted?)');
  return Object.entries(entry.outputs ?? {}).sort(([a], [b]) => a.localeCompare(b, 'en', {numeric: true})).flatMap(([node, o]) => [...(o.images ?? []), ...(o.audio ?? [])].map(i => ({...i, node}))).filter(i => i.type === 'output');
 }
 /** Resolves with the output files (images and audio) once the prompt finished; rejects on errors, cancellation or timeout. */
 async wait(promptId: string, onProgress: (p: {value: number; max: number; node?: string; running: boolean}) => void, signal: AbortSignal): Promise<ImageRef[]> {
  let socket: WebSocket | undefined;
  try {
   const ws = new URL('/ws', this.base); ws.protocol = ws.protocol === 'https:' ? 'wss:' : 'ws:'; ws.searchParams.set('clientId', this.clientId);
   socket = new WebSocket(ws);
   socket.onmessage = event => {
    if (typeof event.data !== 'string') return;
    try {
     const message = JSON.parse(event.data) as {type: string; data?: {prompt_id?: string; value?: number; max?: number; node?: string | null}};
     if (message.data?.prompt_id && message.data.prompt_id !== promptId) return;
     if (message.type === 'progress' && typeof message.data?.value === 'number') onProgress({value: message.data.value, max: message.data.max ?? 1, node: message.data.node ?? undefined, running: true});
     else if (message.type === 'executing' && message.data?.node) onProgress({value: 0, max: 1, node: message.data.node, running: true});
    } catch { /* ignore malformed frames */ }
   };
   socket.onerror = () => {};
  } catch { socket = undefined; }
  const started = Date.now();
  try {
   for (;;) {
    if (signal.aborted) throw Error('Generation cancelled');
    if (Date.now() - started > this.timeoutMs) throw Error('ComfyUI did not finish in time');
    const history = await this.json<Record<string, {status?: {status_str?: string; completed?: boolean; messages?: [string, {exception_message?: string}][]}; outputs?: Record<string, {images?: ImageRef[]; audio?: ImageRef[]}>}>>(`/history/${encodeURIComponent(promptId)}`, {signal});
    const entry = history[promptId];
    if (entry?.status?.status_str === 'error') { const detail = entry.status.messages?.find(m => m[0] === 'execution_error')?.[1]?.exception_message; throw Error(explainFailure(`ComfyUI failed${detail ? `: ${detail.trim()}` : ''}`)); }
    if (entry?.status?.completed || (entry?.outputs && Object.keys(entry.outputs).length && entry.status?.status_str === 'success')) return Object.entries(entry.outputs ?? {}).sort(([a], [b]) => a.localeCompare(b, 'en', {numeric: true})).flatMap(([node, o]) => [...(o.images ?? []), ...(o.audio ?? [])].map(i => ({...i, node}))).filter(i => i.type === 'output');
    await new Promise<void>((resolve, reject) => { const timer = setTimeout(resolve, 400); signal.addEventListener('abort', () => { clearTimeout(timer); reject(Error('Generation cancelled')); }, {once: true}); });
   }
  } finally { socket?.close(); }
 }
 async view(image: ImageRef): Promise<Uint8Array> {
  const response = await fetch(this.url('/view', {filename: image.filename, subfolder: image.subfolder, type: image.type}), {signal: AbortSignal.timeout(60000)});
  if (!response.ok) throw Error(`ComfyUI image unavailable: ${image.filename}`);
  return new Uint8Array(await response.arrayBuffer());
 }
}
/** The configured address, or the first default that answers ("auto"). */
export async function resolveComfy(setting: string): Promise<ComfyClient> {
 if (setting && setting !== 'auto') return new ComfyClient(setting);
 for (const url of defaultComfyUrls) { const client = new ComfyClient(url); if ((await client.status()).online) return client; }
 return new ComfyClient(defaultComfyUrls[0]);
}
