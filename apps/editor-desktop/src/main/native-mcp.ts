import {createServer, type Server} from 'node:http';
import {randomBytes, randomUUID, timingSafeEqual} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {writeFile} from 'node:fs/promises';
import {ipcMain, type BrowserWindow} from 'electron';
import {z} from 'zod';
import {allowedRequest, handleBody, type McpContent, type McpTool} from './mcp-protocol';

/** Machine-local MCP settings (also read by the stdio bridge, so it finds the port and token). */
export const McpConfigSchema = z.object({enabled: z.boolean().default(false), port: z.number().int().min(1024).max(65535).default(47821), token: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/)}).strict();
export type McpConfig = z.infer<typeof McpConfigSchema>;
const newToken = () => randomBytes(32).toString('base64url');
const screenshotTool: McpTool = {name: 'screenshot', description: 'A PNG picture of the editor: the scene canvas (default) or the whole window. Use it to check what your edits look like.', inputSchema: {type: 'object', properties: {area: {type: 'string', enum: ['canvas', 'window'], description: 'canvas (default) or window'}}}};
const instructions = 'OliveStudio: a 2D game editor (PixiJS). The tools edit the open project the way its built-in assistant does: call get_editor_state first, address objects by id or name, and use screenshot to look at the result. Every tool call is one undo step in the editor. Nothing outside this computer is reachable.';

/**
 * MCP server in the main process: Streamable HTTP (JSON replies, no SSE) on 127.0.0.1 only, a bearer token, loopback
 * Host/Origin checks against DNS rebinding. Tool calls go to the renderer, which runs the assistant's editor tools.
 */
export function registerMcp(options: {window(): BrowserWindow | null; sender(event: Electron.IpcMainInvokeEvent): void; configPath: string; version: string; stdioScript: string}) {
 let config: McpConfig = load(), server: Server | null = null, failure: string | undefined, lastCall: number | undefined, clients = 0;
 const pending = new Map<string, {resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout>}>();
 function load(): McpConfig { try { return McpConfigSchema.parse(JSON.parse(readFileSync(options.configPath, 'utf8'))); } catch { return {enabled: false, port: 47821, token: newToken()}; } }
 const save = () => writeFile(options.configPath, JSON.stringify(config, null, 1), {mode: 0o600});
 /** Asks the renderer (tool list, a tool call, the canvas rectangle); calls may run long (asset generation). */
 const ask = (request: {method: 'list' | 'call' | 'rect'; name?: string; args?: Record<string, unknown>}) => new Promise<unknown>((resolve, reject) => {
  const w = options.window();
  if (!w || w.isDestroyed()) return reject(Error('The editor window is closed'));
  const id = randomUUID(), timer = setTimeout(() => { pending.delete(id); reject(Error('The editor did not answer in time')); }, request.method === 'call' ? 600_000 : 15_000);
  pending.set(id, {resolve, reject, timer});
  w.webContents.send('mcp:request', {id, ...request});
 });
 ipcMain.handle('mcp:reply', (event, id: unknown, ok: unknown, value: unknown) => {
  options.sender(event);
  const p = typeof id === 'string' ? pending.get(id) : undefined;
  if (!p) return;
  clearTimeout(p.timer); pending.delete(id as string);
  if (ok === true) p.resolve(value); else p.reject(Error(typeof value === 'string' ? value : 'Tool failed'));
 });
 const handlers = {
  tools: async () => [...(await ask({method: 'list'}) as McpTool[]), screenshotTool],
  call: async (name: string, args: Record<string, unknown>): Promise<McpContent[]> => {
   lastCall = Date.now();
   if (name === 'screenshot') {
    const w = options.window();
    if (!w || w.isDestroyed()) throw Error('The editor window is closed');
    const rect = args.area === 'window' ? undefined : await ask({method: 'rect'}) as Electron.Rectangle | null;
    let image = await w.webContents.capturePage(rect ?? undefined);
    if (image.getSize().width > 1600) image = image.resize({width: 1600});
    return [{type: 'image', data: image.toPNG().toString('base64'), mimeType: 'image/png'}];
   }
   const result = await ask({method: 'call', name, args});
   return [{type: 'text', text: JSON.stringify(result ?? {ok: true})}];
  },
 };
 const info = {name: 'olivestudio', version: options.version, instructions};
 const stop = () => new Promise<void>(resolve => { if (!server) return resolve(); const s = server; server = null; s.close(() => resolve()); s.closeAllConnections(); });
 const start = () => new Promise<void>(resolve => {
  failure = undefined;
  const s = createServer((req, res) => {
   void (async () => {
    if (!allowedRequest({host: req.headers.host, origin: req.headers.origin}, config.port)) { res.writeHead(403).end('Forbidden'); return; }
    if (new URL(req.url ?? '/', 'http://127.0.0.1').pathname !== '/mcp') { res.writeHead(404).end('Not found'); return; }
    const given = Buffer.from((req.headers.authorization ?? '').replace(/^Bearer\s+/i, '')), wanted = Buffer.from(config.token);
    if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) { res.writeHead(401, {'WWW-Authenticate': 'Bearer'}).end('Unauthorized'); return; }
    if (req.method === 'DELETE') { res.writeHead(204).end(); return; }
    if (req.method !== 'POST') { res.writeHead(405, {Allow: 'POST, DELETE'}).end('Use POST'); return; }
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of req) { size += (chunk as Buffer).length; if (size > 4 * 1024 * 1024) { res.writeHead(413).end('Too large'); return; } chunks.push(chunk as Buffer); }
    const text = Buffer.concat(chunks).toString('utf8'), reply = await handleBody(text, handlers, info);
    const headers: Record<string, string> = {};
    if (/"method"\s*:\s*"initialize"/.test(text)) { headers['Mcp-Session-Id'] = randomUUID(); clients++; }
    if (!reply) { res.writeHead(202, headers).end(); return; }
    res.writeHead(200, {...headers, 'Content-Type': 'application/json'}).end(JSON.stringify(reply));
   })().catch(error => { if (!res.headersSent) res.writeHead(500).end(String(error)); });
  });
  s.on('error', error => { failure = (error as NodeJS.ErrnoException).code === 'EADDRINUSE' ? `Port ${config.port} is in use` : String(error); server = null; resolve(); });
  s.listen(config.port, '127.0.0.1', () => { server = s; resolve(); });
 });
 const apply = async () => { await stop(); if (config.enabled) await start(); };
 const status = () => ({...config, running: Boolean(server?.listening), url: `http://127.0.0.1:${config.port}/mcp`, error: failure, lastCall, clients, configPath: options.configPath,
  stdio: {command: process.execPath, args: [options.stdioScript, '--config', options.configPath], env: {ELECTRON_RUN_AS_NODE: '1'}}});
 ipcMain.handle('mcp:status', event => { options.sender(event); return status(); });
 ipcMain.handle('mcp:configure', async (event, patch: unknown) => {
  options.sender(event);
  const p = z.object({enabled: z.boolean().optional(), port: z.number().int().min(1024).max(65535).optional(), regenerate: z.boolean().optional()}).strict().parse(patch);
  config = McpConfigSchema.parse({...config, ...(p.enabled === undefined ? {} : {enabled: p.enabled}), ...(p.port === undefined ? {} : {port: p.port}), ...(p.regenerate ? {token: newToken()} : {})});
  await save(); await apply();
  return status();
 });
 void save().then(apply);
 return {async dispose() { for (const p of pending.values()) { clearTimeout(p.timer); p.reject(Error('The editor is closing')); } pending.clear(); await stop(); for (const channel of ['mcp:reply', 'mcp:status', 'mcp:configure']) ipcMain.removeHandler(channel); }};
}
