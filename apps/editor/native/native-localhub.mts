import {randomUUID} from 'node:crypto';
import {hostname} from 'node:os';
import {HubClient, HubRequestError, InviteError, PinMismatchError, parseInvite, pinnedRequest, readBody, type HubFile, type HubJob, type HubModel, type HubVideo, type SessionStore} from '@localhub/client';
import {ChatRequestSchema} from '@rewrite/ai-lm/contracts';
import {chatBody, chunkReader} from '@rewrite/ai-lm/stream';
import {CreateRequestSchema, encodeProblem, hubApp, hubCapabilities, unpaired, uploadLimit, uploadName, type HubFileInfo, type HubJobInfo, type HubOutput, type HubProblem, type HubStatus} from '@rewrite/ai-hub/contracts';

const unreachableCodes = new Set(['ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'ETIMEDOUT', 'EHOSTDOWN', 'ECONNRESET', 'ENOTFOUND']);
/** What went wrong, as a code the renderer can act on (integration guide §6–7). */
function problemOf(error: unknown): HubProblem {
 if (error instanceof HubRequestError) return {code: error.code, message: error.message, ...(error.provider ? {provider: error.provider} : {})};
 if (error instanceof PinMismatchError) return {code: 'pin_mismatch', message: error.message};
 if (error instanceof InviteError) return {code: 'invalid_invite', message: error.message};
 const code = (error as NodeJS.ErrnoException | undefined)?.code;
 if (code && unreachableCodes.has(code) || /timed out/i.test(String((error as Error)?.message))) return {code: 'unreachable', message: String((error as Error).message)};
 return {code: 'error', message: error instanceof Error ? error.message : String(error)};
}
const fail = (error: unknown): never => { throw Error(encodeProblem(problemOf(error))); };
const id = (value: unknown) => { if (typeof value !== 'string' || !/^[\w.-]{1,200}$/.test(value)) throw Error('Invalid LocalHub job'); return value; };
/** Videos are jobs too (same ID); the panel tracks both the same way. */
const videoJob = (v: HubVideo, capability: string): HubJobInfo => ({id: v.id, status: v.status, capability, model: v.model, progress: v.progress / 100, output_file_ids: v.file_id ? [v.file_id] : [], created_at: v.created_at, ...(v.error ? {error: v.error.message} : {})});
const jobInfo = (j: HubJob): HubJobInfo => ({...j});
const fileInfo = (f: HubFile): HubFileInfo => ({id: f.id, filename: f.filename, bytes: f.bytes, mime: f.mime_type, purpose: f.purpose, source: f.source, createdAt: f.created_at, ...(f.job_id ? {jobId: f.job_id} : {})});

/** LocalHub session and event stream shared by the editor hosts. */
export function registerLocalHub<Event>(options: {
 store: SessionStore;
 handle(channel: string, handler: (event: Event, ...args: unknown[]) => unknown): void;
 removeHandler(channel: string): void;
 sender(event: Event): void;
 send(channel: string, payload: unknown): void;
}) {
 const {store, send} = options;
 let hub = new HubClient(store);
 const ready = hub.restore().catch(() => null);
 const chats = new Map<string, AbortController>();
 let events: AbortController | null = null;
 const stopEvents = () => { events?.abort(); events = null; };
 /** Drops the session on this side even when the hub cannot be told (offline Mac, revoked device). */
 const forgetLocally = async () => { stopEvents(); await store.clear(); hub = new HubClient(store); };
 const forget = async () => { stopEvents(); await hub.unpair().catch(forgetLocally); };
 const listen = () => {
  if (events || !hub.session) return;
  const abort = events = new AbortController();
  void (async () => {
   let delay = 1000;
   while (!abort.signal.aborted && hub.session) {
    try {
     for await (const event of hub.events(abort.signal)) {
      delay = 1000;
      if (event.type === 'revoked') { await forget(); send('localhub:event', event); return; }
      send('localhub:event', event.type === 'job' ? {type: 'job', job: jobInfo(event.job)} : event);
     }
    } catch (error) {
     if (abort.signal.aborted) return;
     if (error instanceof HubRequestError && error.code === 'unauthorized') { await forget(); send('localhub:event', {type: 'revoked'}); return; }
    }
    await new Promise(resolve => setTimeout(resolve, delay));
    delay = Math.min(30_000, delay * 2);
   }
  })().finally(() => { if (events === abort) events = null; });
 };
 const status = async (): Promise<HubStatus> => {
  await ready;
  const s = hub.session;
  if (!s) return unpaired();
  const base = {paired: true, ...(s.hubName ? {hubName: s.hubName} : {}), address: s.address, scopes: s.scopes};
  try {
   const session = await hub.request('GET', '/v2/session') as {scopes?: string[]};
   const scopes = session.scopes ?? s.scopes;
   const [models, integrations, mcp] = await Promise.all([
    hub.models(),
    hub.integrations().catch(() => []),
    scopes.some(x => x.startsWith('mcp:')) ? hub.request('GET', '/v2/mcp/servers').then(list => (Array.isArray(list) ? list as {id: string}[] : []).map(x => x.id)).catch(() => []) : Promise.resolve([] as string[]),
   ]);
   listen();
   return {...base, online: true, scopes, mcpServers: mcp.filter(x => scopes.includes(`mcp:${x}`)),
    models: models.map((m: HubModel & {loaded?: unknown}) => ({id: m.id, capabilities: m.capabilities ?? [], ...(typeof m.loaded === 'boolean' ? {loaded: m.loaded} : {})})),
    integrations: integrations.map(i => ({id: i.id, name: i.name, kind: i.kind, state: i.state, capabilities: i.capabilities ?? [], ...(i.detail ? {detail: i.detail} : {})}))};
  } catch (error) {
   const problem = problemOf(error);
   if (problem.code === 'unauthorized') { await forget(); return {...unpaired(), problem}; }
   return {...base, online: false, models: [], integrations: [], mcpServers: [], problem};
  }
 };
 /** `/v1/audio/edits` with `Prefer: respond-async` (the client library has no helper for it yet). */
 const editAudio = async (fields: Record<string, string>, audio: Uint8Array) => {
  const s = hub.session; if (!s) throw Error('LocalHub is not paired');
  const boundary = `olive-${randomUUID()}`, parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="audio.wav"\r\nContent-Type: application/octet-stream\r\n\r\n`), Buffer.from(audio), Buffer.from(`\r\n--${boundary}--\r\n`));
  const body = Buffer.concat(parts);
  const response = await pinnedRequest(new URL(s.address), s.fingerprint, {method: 'POST', path: '/v1/audio/edits', body, timeoutMs: 11 * 60_000,
   headers: {Authorization: `Bearer ${s.token}`, 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': String(body.length), Accept: 'application/json', Prefer: 'respond-async'}});
  const text = (await readBody(response, 16 * 1024 * 1024)).toString('utf8');
  if (response.statusCode !== 200 && response.statusCode !== 202) { let e: {code?: string; message?: string} | undefined; try { e = JSON.parse(text).error; } catch { /* not JSON */ } throw new HubRequestError(response.statusCode ?? 0, e?.code ?? 'http_error', e?.message ?? `LocalHub HTTP ${response.statusCode}`); }
  return JSON.parse(text) as HubJob;
 };

 options.handle('localhub:status', async event => { options.sender(event); return status(); });
 options.handle('localhub:pair', async (event, text: unknown) => {
  options.sender(event);
  if (typeof text !== 'string' || !text.trim() || text.length > 1024) throw Error(encodeProblem({code: 'invalid_invite', message: 'Paste the invite from LocalHub › Pair a Device'}));
  try {
   const invite = parseInvite(text.trim());
   await ready;
   if (hub.session) await forget();
   await hub.pair(invite, {deviceName: `OliveStudio on ${hostname()}`.slice(0, 80), app: hubApp, scopes: [...hubCapabilities]});
  } catch (error) { fail(error); }
  return status();
 });
 options.handle('localhub:unpair', async event => { options.sender(event); await ready; await forget(); });
 options.handle('localhub:cancel', (event, jobId: unknown) => { options.sender(event); if (typeof jobId === 'string') chats.get(jobId)?.abort(); });
 options.handle('localhub:chat', async (event, jobId: unknown, input: unknown, servers: unknown) => {
  options.sender(event);
  if (typeof jobId !== 'string' || !/^[a-f0-9-]{36}$/.test(jobId) || chats.has(jobId)) throw Error('Invalid assistant job');
  const request = ChatRequestSchema.parse(input), mcp = Array.isArray(servers) ? servers.filter((x): x is string => typeof x === 'string' && /^[\w.-]{1,64}$/.test(x)).slice(0, 8) : [];
  const abort = new AbortController(), reader = chunkReader(delta => send('localhub:delta', {jobId, ...delta}), 'LocalHub');
  chats.set(jobId, abort);
  try {
   await ready;
   for await (const chunk of hub.chatStream({...chatBody(request), ...(mcp.length ? {mcp_servers: mcp} : {})}, abort.signal)) reader.push(chunk);
   return reader.result();
  } catch (error) { if (abort.signal.aborted) throw Error('Assistant cancelled'); return fail(error); }
  finally { chats.delete(jobId); send('localhub:delta', {jobId, done: true}); }
 });
 options.handle('localhub:create', async (event, input: unknown) => {
  options.sender(event);
  const r = CreateRequestSchema.parse(input);
  await ready;
  const size = r.width && r.height ? {size: `${r.width}x${r.height}`} : {};
  const common = {prompt: r.prompt, ...(r.model ? {model: r.model} : {}), ...(r.negative ? {negative_prompt: r.negative} : {}), ...(r.seed !== undefined ? {seed: r.seed} : {}), ...(r.steps ? {steps: r.steps} : {})};
  try {
   switch (r.capability) {
    case 'image.create': return {job: jobInfo(await hub.generateImage({...common, ...size}, {async: true}))};
    case 'image.edit': return {job: jobInfo(await hub.editImage({...common, ...size, ...(r.strength !== undefined ? {strength: r.strength} : {}), image: {data: Buffer.from(r.image!), filename: 'image.png'}}, {async: true}))};
    case 'audio.create': return {job: jobInfo(await hub.generateAudio({...common, ...(r.seconds ? {seconds: r.seconds} : {})}, {async: true}))};
    case 'audio.edit': return {job: jobInfo(await editAudio(Object.fromEntries(Object.entries({...common, ...(r.seconds ? {seconds: r.seconds} : {}), ...(r.strength !== undefined ? {strength: r.strength} : {})}).map(([k, v]) => [k, String(v)])), r.audio!))};
    case 'audio.speech': {
     const speech = await hub.speech({input: r.prompt, ...(r.model ? {model: r.model} : {}), ...(r.voice ? {voice: r.voice} : {})});
     const output: HubOutput = {bytes: new Uint8Array(speech.data), mime: speech.contentType, filename: 'speech'};
     return {output};
    }
    case 'video.create': {
     const file = r.image ? await hub.uploadFile(Buffer.from(r.image), 'first-frame.png', {purpose: 'reference', contentType: 'image/png'}) : null;
     return {job: videoJob(await hub.createVideo({...common, ...size, ...(r.seconds ? {seconds: String(r.seconds)} : {}), ...(file ? {image_file_id: file.id} : {})}), r.capability)};
    }
    case 'video.edit': return {job: videoJob(await hub.remixVideo(r.videoId!, {prompt: r.prompt, ...(r.model ? {model: r.model} : {})}), r.capability)};
   }
  } catch (error) { return fail(error); }
 });
 options.handle('localhub:job', async (event, value: unknown) => {
  options.sender(event);
  try { return jobInfo(await hub.job(id(value))); }
  catch (error) { if (error instanceof HubRequestError && error.status === 404) return null; return fail(error); }
 });
 options.handle('localhub:job-cancel', async (event, value: unknown) => { options.sender(event); try { await hub.cancelJob(id(value)); } catch (error) { fail(error); } });
 options.handle('localhub:job-preview', async (event, value: unknown) => {
  options.sender(event);
  try { const bytes = await hub.jobPreview(id(value)); return bytes ? new Uint8Array(bytes) : null; } catch { return null; }
 });
 /** A finished job's files (images, sounds, a video) with their types, at most 256 MB in all. */
 options.handle('localhub:job-outputs', async (event, value: unknown) => {
  options.sender(event);
  try {
   const job = await hub.job(id(value)), out: HubOutput[] = [];
   let total = 0;
   for (const fileId of job.output_file_ids.slice(0, 64)) {
    const meta = await hub.request('GET', `/v1/files/${encodeURIComponent(fileId)}`) as {mime_type?: string; filename?: string; bytes?: number};
    total += meta.bytes ?? 0;
    if (total > 256 * 1024 * 1024) throw Error('The job’s files are larger than 256 MB');
    out.push({bytes: new Uint8Array(await hub.fileContent(fileId)), mime: meta.mime_type ?? '', filename: meta.filename ?? fileId});
   }
   return out;
  } catch (error) { return fail(error); }
 });
 /** Files (guide §5.6): this device's uploads and job outputs on the hub. */
 options.handle('localhub:files', async event => {
  options.sender(event); await ready;
  try { return (await hub.files()).map(fileInfo).sort((a, b) => b.createdAt - a.createdAt); } catch (error) { return fail(error); }
 });
 options.handle('localhub:file-content', async (event, value: unknown) => {
  options.sender(event);
  try {
   const fileId = id(value), meta = await hub.request('GET', `/v1/files/${encodeURIComponent(fileId)}`) as HubFile;
   if (meta.bytes > 256 * 1024 * 1024) throw Error('The file is larger than 256 MB');
   const output: HubOutput = {bytes: new Uint8Array(await hub.fileContent(fileId)), mime: meta.mime_type ?? '', filename: meta.filename ?? fileId};
   return output;
  } catch (error) { return fail(error); }
 });
 options.handle('localhub:file-upload', async (event, bytes: unknown, name: unknown) => {
  options.sender(event);
  if (!(bytes instanceof Uint8Array) || !bytes.byteLength || bytes.byteLength > uploadLimit || typeof name !== 'string' || name.length > 200) throw Error(encodeProblem({code: 'payload_too_large', message: 'Files up to 100 MB'}));
  const {filename, mime} = uploadName(name);
  await ready;
  try { return fileInfo(await hub.uploadFile(Buffer.from(bytes), filename, {purpose: 'reference', contentType: mime})); } catch (error) { return fail(error); }
 });
 options.handle('localhub:file-delete', async (event, value: unknown) => { options.sender(event); try { await hub.deleteFile(id(value)); } catch (error) { fail(error); } });
 return {dispose() {
  stopEvents();
  for (const chat of chats.values()) chat.abort();
  chats.clear();
  for (const channel of ['localhub:status', 'localhub:pair', 'localhub:unpair', 'localhub:cancel', 'localhub:chat', 'localhub:create', 'localhub:job', 'localhub:job-cancel', 'localhub:job-preview', 'localhub:job-outputs', 'localhub:files', 'localhub:file-content', 'localhub:file-upload', 'localhub:file-delete']) options.removeHandler(channel);
 }};
}
