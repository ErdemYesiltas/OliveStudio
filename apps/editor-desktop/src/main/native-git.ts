import { execFile } from 'node:child_process';
import { basename, dirname } from 'node:path';
import { ipcMain, type IpcMainInvokeEvent } from 'electron';

/**
 * Version control for the open project through the system `git` (no shell; fixed arguments; always inside the
 * project's folder). Status, init, commit everything in the folder, history, a file's text at a commit (for the scene
 * diff) and restoring the project file to a commit when the folder has no uncommitted changes.
 */
type Staged = {text: string; path: string; warnings: string[]};
const run = (cwd: string, args: string[], timeout = 20000) => new Promise<string>((resolve, reject) => {
 execFile('git', args, {cwd, timeout, maxBuffer: 20 * 1024 * 1024, env: {...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C'}}, (error, stdout, stderr) => {
  if (error) reject(Error((stderr || error.message).trim().split('\n').slice(-3).join(' ') || 'git failed')); else resolve(stdout);
 });
});
const hash = (value: unknown) => { if (typeof value !== 'string' || !/^[0-9a-f]{7,40}$/.test(value)) throw Error('Invalid commit'); return value; };
export function registerGit(options: {sender(event: IpcMainInvokeEvent): void; task<T>(work: () => Promise<T>): Promise<T>; current(): string | null; confirmDiscard(): Promise<boolean>; stage(path: string): Promise<Staged>}) {
 const project = () => { const path = options.current(); if (!path) throw Error('Save the project first: version control works on its folder'); return {path, dir: dirname(path), file: basename(path)}; };
 const inRepo = async (dir: string) => run(dir, ['rev-parse', '--show-toplevel']).then(s => s.trim(), () => null);
 ipcMain.handle('git:status', event => (async () => {
  options.sender(event);
  const version = await run(process.cwd(), ['--version']).catch(() => null);
  if (!version) return {available: false};
  const path = options.current(); if (!path) return {available: true, saved: false};
  const dir = dirname(path), root = await inRepo(dir);
  if (!root) return {available: true, saved: true, repo: false, folder: dir};
  const branch = (await run(dir, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => 'main\n')).trim();
  const changes = (await run(dir, ['status', '--porcelain=v1', '--untracked-files=all', '--', '.'])).split('\n').filter(Boolean).map(l => ({status: l.slice(0, 2).trim() || '?', file: l.slice(3)}));
  const head = await run(dir, ['rev-parse', '--short', 'HEAD']).then(s => s.trim(), () => null);
  return {available: true, saved: true, repo: true, folder: dir, root, branch, head, changes};
 })());
 ipcMain.handle('git:init', event => options.task(async () => {
  options.sender(event); const {dir} = project();
  if (await inRepo(dir)) return true;
  await run(dir, ['init', '-b', 'main']); return true;
 }));
 ipcMain.handle('git:commit', (event, message: unknown) => options.task(async () => {
  options.sender(event); const {dir} = project();
  if (typeof message !== 'string' || !message.trim() || message.length > 2000) throw Error('Write a short description of the change');
  await run(dir, ['add', '-A', '--', '.']);
  const staged = await run(dir, ['diff', '--cached', '--name-only', '--', '.']);
  if (!staged.trim()) throw Error('Nothing to commit: save the project first');
  await run(dir, ['commit', '-q', '-m', message.trim(), '--', '.']);
  return (await run(dir, ['rev-parse', '--short', 'HEAD'])).trim();
 }));
 ipcMain.handle('git:log', event => (async () => {
  options.sender(event); const {dir, file} = project();
  const out = await run(dir, ['log', '-n', '50', '--date=iso-strict', '--pretty=format:%H%x1f%h%x1f%an%x1f%ad%x1f%s', '--', file]).catch(() => '');
  return out.split('\n').filter(Boolean).map(line => { const [full, short, author, date, subject] = line.split('\x1f'); return {hash: full, short, author, date, subject}; });
 })());
 ipcMain.handle('git:show', (event, commit: unknown) => (async () => {
  options.sender(event); const {dir, file} = project();
  const text = await run(dir, ['show', `${hash(commit)}:./${file}`]);
  if (Buffer.byteLength(text) > 10 * 1024 * 1024) throw Error('Project exceeds 10 MB');
  return text;
 })());
 ipcMain.handle('git:restore', (event, commit: unknown) => options.task(async () => {
  options.sender(event); const {path, dir, file} = project();
  if ((await run(dir, ['status', '--porcelain', '--', '.'])).trim()) throw Error('Commit or discard your changes before going back to an older version');
  if (!await options.confirmDiscard()) return null;
  await run(dir, ['checkout', hash(commit), '--', file]);
  return options.stage(path);
 }));
}
