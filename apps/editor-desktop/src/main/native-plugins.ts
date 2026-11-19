import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { extname, join, relative, resolve, sep } from 'node:path';
import { app, ipcMain, protocol, shell, type IpcMainInvokeEvent } from 'electron';

/**
 * User plugins: folders in `<userData>/plugins/<id>/` with a `plugin.json` ({id, name, version, description?, main})
 * and ES module code. Nothing runs until the user enables a plugin in Settings (stored in `plugins.json`); enabled
 * plugins are served to the renderer only through `olive-plugin://<id>/<file>` (their own folder, scripts / styles /
 * JSON only) and activated as editor modules at the next start.
 */
export const pluginScheme = 'olive-plugin';
export interface PluginInfo {id: string; name: string; version: string; description: string; main: string; enabled: boolean; error?: string}
const types: Record<string, string> = {'.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json'};
const idPattern = /^[a-z][a-z0-9-]{1,40}$/;
export function registerPlugins(options: {sender(event: IpcMainInvokeEvent): void}) {
 const dir = () => join(app.getPath('userData'), 'plugins'), stateFile = () => join(app.getPath('userData'), 'plugins.json');
 const enabled = async () => { try { const v = JSON.parse(await readFile(stateFile(), 'utf8')) as {enabled?: unknown}; return new Set(Array.isArray(v.enabled) ? v.enabled.filter((x): x is string => typeof x === 'string') : []); } catch { return new Set<string>(); } };
 const list = async (): Promise<PluginInfo[]> => {
  await mkdir(dir(), {recursive: true});
  const on = await enabled(), out: PluginInfo[] = [];
  for (const entry of await readdir(dir(), {withFileTypes: true})) {
   if (!entry.isDirectory() || !idPattern.test(entry.name)) continue;
   const base = {id: entry.name, name: entry.name, version: '', description: '', main: 'main.js', enabled: on.has(entry.name)};
   try {
    const m = JSON.parse(await readFile(join(dir(), entry.name, 'plugin.json'), 'utf8')) as Record<string, unknown>;
    if (m.id !== entry.name) throw Error('plugin.json "id" must match the folder name');
    const main = typeof m.main === 'string' ? m.main : 'main.js';
    if (!/^[\w./-]+\.(m?js)$/.test(main) || main.includes('..')) throw Error('"main" must be a .js file inside the plugin folder');
    await stat(join(dir(), entry.name, main));
    out.push({...base, name: String(m.name ?? entry.name).slice(0, 80), version: String(m.version ?? '').slice(0, 20), description: String(m.description ?? '').slice(0, 300), main});
   } catch (error) { out.push({...base, enabled: false, error: error instanceof Error ? error.message : String(error)}); }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
 };
 protocol.handle(pluginScheme, async request => {
  try {
   const url = new URL(request.url), id = url.hostname, plugins = await list(), plugin = plugins.find(p => p.id === id && p.enabled && !p.error);
   if (!plugin) return new Response('Plugin not enabled', {status: 404});
   const root = resolve(dir(), id), file = resolve(root, '.' + decodeURIComponent(url.pathname));
   if (!file.startsWith(root + sep) || relative(root, file).includes('..') || !types[extname(file)]) return new Response('Not found', {status: 404});
   return new Response(await readFile(file), {headers: {'Content-Type': types[extname(file)], 'Cache-Control': 'no-store'}});
  } catch { return new Response('Not found', {status: 404}); }
 });
 ipcMain.handle('plugins:list', event => { options.sender(event); return list(); });
 ipcMain.handle('plugins:enable', async (event, id: unknown, value: unknown) => {
  options.sender(event);
  if (typeof id !== 'string' || !idPattern.test(id) || typeof value !== 'boolean') throw Error('Invalid plugin');
  const on = await enabled(); if (value) on.add(id); else on.delete(id);
  await writeFile(stateFile(), JSON.stringify({enabled: [...on].sort()}, null, 1));
  return [...on];
 });
 ipcMain.handle('plugins:reveal', async event => { options.sender(event); await mkdir(dir(), {recursive: true}); await shell.openPath(dir()); });
}
