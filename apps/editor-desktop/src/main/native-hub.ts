import {app, dialog, ipcMain, shell, type BrowserWindow, type IpcMainInvokeEvent} from 'electron';
import {cp, mkdir, readFile, rm, stat, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {basename, extname, join, resolve, sep} from 'node:path';
import {recentProjectMetadata} from './project-discovery';

/** A project the Hub lists: where it is, what it is called and when it was last opened here. */
interface Recent {path: string; name: string; openedAt: number; pinned?: boolean}
export interface HubProject {path: string; name: string; openedAt: number; pinned?: boolean; modifiedAt: number | null; exists: boolean; scenes: number; thumbnail: string | null}
export interface HubExample {id: string; title: string; description: string; tags: string[]; thumbnail: string | null; category: string | null}
interface CatalogEntry {id: string; title: string; description: string; tags: string[]; file: string; thumbnail?: string; category?: string}
type Staged = {text: string; path: string; warnings: string[]};

const limit = 30, readable = (text: string) => { try { const p = JSON.parse(text) as {name?: unknown; scenes?: unknown}; return {name: typeof p.name === 'string' ? p.name : '', scenes: Array.isArray(p.scenes) ? p.scenes.length : 0}; } catch { return {name: '', scenes: 0}; } };
const png = async (file: string) => { try { const data = await readFile(file); return data.length <= 2 * 1024 * 1024 ? `data:image/png;base64,${data.toString('base64')}` : null; } catch { return null; } };

/**
 * The Hub (start screen): recently opened projects (kept in userData/hub.json with thumbnails captured at save) and
 * bundled example projects that are copied to a folder the user picks before they open. Only listed paths and
 * catalogue IDs are accepted from the renderer.
 */
export function registerHub(options: {window(): BrowserWindow | null; sender(event: IpcMainInvokeEvent): void; task<T>(work: () => Promise<T>): Promise<T>; confirmDiscard(): Promise<boolean>; stage(path: string): Promise<Staged>; current(): string | null; examplesDir: string; showAtStartup: boolean; resolveFolder(candidate: unknown): Promise<string>}) {
 const store = join(app.getPath('userData'), 'hub.json'), thumbs = join(app.getPath('userData'), 'hub-thumbnails');
 const thumbFor = (path: string) => join(thumbs, createHash('sha256').update(resolve(path)).digest('hex').slice(0, 32) + '.png');
 let recents: Recent[] | null = null;
 const load = async () => { if (recents) return recents; try { const raw = JSON.parse(await readFile(store, 'utf8')) as {items?: unknown}; recents = Array.isArray(raw.items) ? raw.items.filter((r): r is Recent => !!r && typeof r.path === 'string' && typeof r.name === 'string' && typeof r.openedAt === 'number').slice(0, limit) : []; } catch { recents = []; } return recents; };
 const persist = async () => { await mkdir(app.getPath('userData'), {recursive: true}); await writeFile(store, JSON.stringify({version: 1, items: recents ?? []}), {mode: 0o600}); };
 const listed = async (candidate: unknown) => { if (typeof candidate !== 'string') throw Error('Invalid path'); const found = (await load()).find(r => r.path === candidate); if (!found) throw Error('This project is not in the Hub list'); return found; };
 const catalog = async (): Promise<CatalogEntry[]> => { try { const raw = JSON.parse(await readFile(join(options.examplesDir, 'catalog.json'), 'utf8')) as {examples?: CatalogEntry[]}; return (raw.examples ?? []).filter(e => typeof e.id === 'string' && typeof e.file === 'string'); } catch { return []; } };
 const inside = (file: string) => { const full = resolve(options.examplesDir, file); if (!full.startsWith(resolve(options.examplesDir) + sep)) throw Error('Invalid example'); return full; };

 ipcMain.handle('hub:state', event => { options.sender(event); return {showAtStartup: options.showAtStartup}; });
 ipcMain.handle('hub:list', async event => {
  options.sender(event);
  // Pinned projects first, each group newest first (the stored order).
  const ordered = [...(await load())].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)));
  const rows = await Promise.all(ordered.map(async (r): Promise<HubProject|null> => {
   const meta = await recentProjectMetadata(r.path);
   if (!meta.visible) return null;
   return {...r, name: meta.name || r.name, modifiedAt: meta.modifiedAt, exists: meta.exists, scenes: meta.scenes, thumbnail: meta.exists ? await png(thumbFor(r.path)) : null};
  }));
  return rows.filter(row=>row!==null);
 });
 ipcMain.handle('hub:open', (event, candidate: unknown) => options.task(async () => { options.sender(event); const r = await listed(candidate); if (!await options.confirmDiscard()) return null; return options.stage(r.path); }));
 ipcMain.handle('hub:remove', async (event, candidate: unknown) => { options.sender(event); const r = await listed(candidate); recents = (await load()).filter(x => x !== r); await persist(); await rm(thumbFor(r.path), {force: true}); });
 ipcMain.handle('hub:pin', async (event, candidate: unknown, pinned: unknown) => { options.sender(event); const r = await listed(candidate); if (typeof pinned !== 'boolean') throw Error('Invalid pin'); if (pinned) r.pinned = true; else delete r.pinned; await persist(); });
 ipcMain.handle('hub:reveal', async (event, candidate: unknown) => { options.sender(event); shell.showItemInFolder((await listed(candidate)).path); });
 ipcMain.handle('hub:examples', async event => { options.sender(event); return Promise.all((await catalog()).map(async (e): Promise<HubExample> => ({id: e.id, title: e.title, description: e.description, tags: e.tags ?? [], thumbnail: e.thumbnail ? await png(inside(e.thumbnail)) : null, category: typeof e.category === 'string' ? e.category : null}))); });
 /** Copy an example (project file and its `.assets` sidecar) to a new place, name it after the file, then stage it. */
 ipcMain.handle('hub:create', (event, id: unknown) => options.task(async () => {
  options.sender(event);
  const entry = (await catalog()).find(e => e.id === id); if (!entry) throw Error('Unknown example');
  if (!await options.confirmDiscard()) return null;
  const window = options.window(); if (!window) return null;
  const result = await dialog.showSaveDialog(window, {title: `New project from “${entry.title}”`, defaultPath: join(app.getPath('documents'), `${entry.title}.pixieditor`), buttonLabel: 'Create', filters: [{name: 'Pixi Editor project', extensions: ['pixieditor']}]});
  if (result.canceled || !result.filePath) return null;
  return copyExample(entry, extname(result.filePath) === '.pixieditor' ? result.filePath : result.filePath + '.pixieditor');
 }));
 const copyExample = async (entry: CatalogEntry, target: string) => {
  const source = inside(entry.file), project = JSON.parse(await readFile(source, 'utf8')) as {name: string};
  project.name = basename(target, '.pixieditor').trim().slice(0, 100) || entry.title;
  await rm(target + '.assets', {recursive: true, force: true});
  if (await stat(source + '.assets').catch(() => null)) await cp(source + '.assets', target + '.assets', {recursive: true});
  await writeFile(target, JSON.stringify(project, null, 1));
  if (entry.thumbnail) { await mkdir(thumbs, {recursive: true}); await cp(inside(entry.thumbnail), thumbFor(target)).catch(() => {}); }
  return options.stage(target);
 };
 /**
  * For agents: copies an example into a folder they were granted, without a dialog, as "<title>.pixieditor" (or "<title> 2"…
  * when taken, so nothing is overwritten). The renderer runs it only after the request is approved.
  */
 ipcMain.handle('hub:create-at', (event, id: unknown, folder: unknown) => options.task(async () => {
  options.sender(event);
  const entry = (await catalog()).find(e => e.id === id); if (!entry) throw Error('Unknown example');
  const directory = await options.resolveFolder(folder); if (!(await stat(directory)).isDirectory()) throw Error('Expected a folder');
  const name = entry.title.replace(/[\\/:*?"<>|]/g, '-').trim() || entry.id;
  let target = join(directory, `${name}.pixieditor`);
  for (let n = 2; await stat(target).catch(() => null) || await stat(target + '.assets').catch(() => null); n++) { if (n > 99) throw Error('Too many copies of this example in the folder'); target = join(directory, `${name} ${n}.pixieditor`); }
  return copyExample(entry, target);
 }));
 /** A PNG of the current project's stage, captured by the renderer after a save. */
 ipcMain.handle('hub:thumbnail', async (event, url: unknown) => {
  options.sender(event); const path = options.current();
  if (!path || typeof url !== 'string' || !url.startsWith('data:image/png;base64,') || url.length > 3 * 1024 * 1024) return;
  await mkdir(thumbs, {recursive: true}); await writeFile(thumbFor(path), Buffer.from(url.slice('data:image/png;base64,'.length), 'base64'));
 });
 return {
  /** Put a project at the top of the list (on open and save). */
  async touch(path: string, text: string) { const all = await load(), pinned = all.find(r => r.path === path)?.pinned, list = all.filter(r => r.path !== path); recents = [{path, name: readable(text).name || basename(path, '.pixieditor'), openedAt: Date.now(), ...(pinned ? {pinned} : {})}, ...list]; const keep = recents.filter(r => r.pinned), rest = recents.filter(r => !r.pinned); recents = recents.filter(r => r.pinned || rest.indexOf(r) < Math.max(0, limit - keep.length)); await persist(); },
 };
}
