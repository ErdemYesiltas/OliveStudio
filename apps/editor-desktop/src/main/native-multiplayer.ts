import {ipcMain, utilityProcess, type UtilityProcess} from 'electron';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PreviewClients} from './native-preview-clients';
import type {Json} from '@rewrite/sdk';
import {serverRules,ServerRulesSchema, type ServerStatus} from '@rewrite/multiplayer/contracts';

/**
 * The editor's local game server for Preview and test clients: the same bundled `server.mjs` the server export
 * ships, run in a utility process on 127.0.0.1 (a crash cannot take the editor down). One server at a time; it stops
 * with the project, on Stop, and when the editor quits.
 */
export function registerMultiplayer(options: {sender(event: Electron.IpcMainInvokeEvent): void; bundle: string; buildPreview(folder:string,project:Json):Promise<{output:string}>}) {
 const previews=new PreviewClients(options.buildPreview);
 let child: UtilityProcess | null = null, endpoint = '', port = 0, folder = '', seq = 0, lastError = '', rulesKey='';
 const waiting = new Map<number, {resolve(v: unknown): void; reject(e: Error): void; timer: ReturnType<typeof setTimeout>}>();
 const idle = (): ServerStatus => ({running: false, endpoint: '', port: 0, latencyMs: 0, error: lastError, rooms: []});
 const request = (type: string, extra: Record<string, unknown> = {}) => new Promise<unknown>((resolve, reject) => {
  if (!child) { reject(Error('The local game server is not running')); return; }
  const id = ++seq, timer = setTimeout(() => { waiting.delete(id); reject(Error('The local game server did not answer')); }, 5000);
  waiting.set(id, {resolve, reject, timer}); child.postMessage({id, type, ...extra});
 });
 const cleanup = async () => { for (const w of waiting.values()) { clearTimeout(w.timer); w.reject(Error('The local game server stopped')); } waiting.clear(); child = null; endpoint = ''; port = 0; if (folder) { await rm(folder, {recursive: true, force: true}).catch(() => undefined); folder = ''; } };
 async function start(rulesValue: unknown, requestedPort: unknown) {
  const rules = ServerRulesSchema.parse(rulesValue);
  const wanted = requestedPort === undefined || requestedPort === null ? 0 : Number(requestedPort);
  if (!Number.isInteger(wanted) || wanted < 0 || wanted > 65535) throw Error('Invalid port');
  await stop();
  lastError = ''; rulesKey=JSON.stringify(rules); folder = await mkdtemp(join(tmpdir(), 'olive-server-'));
  const file = join(folder, 'rules.json'); await writeFile(file, JSON.stringify(rules));
  const proc = child = utilityProcess.fork(options.bundle, ['--rules', file, '--port', String(wanted), '--host', '127.0.0.1'], {serviceName: 'OliveStudio game server', stdio: 'pipe'});
  let output = '';
  proc.stderr?.on('data', (chunk: Buffer) => { output = (output + chunk.toString()).slice(-2000); });
  const ready = new Promise<void>((resolve, reject) => {
   const timer = setTimeout(() => reject(Error('The local game server did not start: ' + output.trim())), 15000);
   proc.on('message', (m: {type?: string; id?: number; port?: number; endpoint?: string; ok?: boolean; value?: unknown; error?: string}) => {
    if (m.type === 'ready') { clearTimeout(timer); port = m.port ?? 0; endpoint = m.endpoint ?? ''; resolve(); return; }
    const w = m.id !== undefined ? waiting.get(m.id) : undefined; if (!w) return;
    waiting.delete(m.id!); clearTimeout(w.timer); if (m.ok) w.resolve(m.value); else w.reject(Error(m.error ?? 'Request failed'));
   });
   proc.once('exit', code => { clearTimeout(timer); if (child === proc) { lastError = code ? `The local game server exited (${code}): ${output.trim().split('\n').at(-1) ?? ''}` : ''; void cleanup(); } reject(Error(lastError || 'The local game server exited')); });
  });
  await ready;
  return status();
 }
 async function stop() {
  await previews.close();
  const proc = child; if (!proc) return idle();
  try { await request('stop'); } catch { /* already gone */ }
  await new Promise<void>(resolve => { const timer = setTimeout(() => { proc.kill(); resolve(); }, 3000); proc.once('exit', () => { clearTimeout(timer); resolve(); }); });
  if (child === proc) await cleanup();
  return idle();
 }
 async function status(): Promise<ServerStatus> { if (!child) return idle(); try { return await request('status') as ServerStatus; } catch (error) { return {...idle(), running: Boolean(child), endpoint, port, error: error instanceof Error ? error.message : String(error)}; } }
 ipcMain.handle('multiplayer:previews',async(event,action:unknown,text:unknown,count:unknown)=>{
  options.sender(event);
  if(action==='list')return previews.list();if(action==='close')return previews.close();
  if(action!=='open'||typeof text!=='string'||Buffer.byteLength(text)>10*1024*1024)throw Error('Invalid preview request');
  if(!Number.isInteger(count)||Number(count)<1||Number(count)>4)throw Error('Open 1 to 4 preview clients');
  const project=JSON.parse(text),rules=serverRules(project);
  let s=await status();if(!s.running||rulesKey!==JSON.stringify(rules))s=await start(rules,0);
  project.extensions['multiplayer.settings']={...project.extensions['multiplayer.settings'],endpoint:s.endpoint};
  return previews.open(project,Number(count));
 });
 ipcMain.handle('multiplayer:start', (event, rules: unknown, requested: unknown) => { options.sender(event); return start(rules, requested); });
 ipcMain.handle('multiplayer:stop', event => { options.sender(event); return stop(); });
 ipcMain.handle('multiplayer:status', event => { options.sender(event); return status(); });
 ipcMain.handle('multiplayer:latency', async (event, ms: unknown) => { options.sender(event); if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0 || ms > 2000) throw Error('Latency is 0–2000 ms'); return request('latency', {ms}); });
 ipcMain.handle('multiplayer:drop', async (event, sessionId: unknown) => { options.sender(event); if (typeof sessionId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(sessionId)) throw Error('Invalid player'); await request('drop', {sessionId}); return status(); });
 return {async dispose() { await stop(); for (const c of ['multiplayer:previews','multiplayer:start', 'multiplayer:stop', 'multiplayer:status', 'multiplayer:latency', 'multiplayer:drop']) ipcMain.removeHandler(c); }};
}
