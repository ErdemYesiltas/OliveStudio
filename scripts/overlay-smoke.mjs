// Debug overlay: F3 in Preview shows frame rate, objects, timers and globals (and hides again); the Game setting turns
// it on for exported games, where F3 shows the same panel.
import {_electron as electron, chromium, expect} from '@playwright/test';
import {createServer} from 'node:http';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {dirname, extname, join, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(join(root, 'apps/editor-desktop/package.json'));
const temp = await mkdtemp(join(tmpdir(), 'rewrite-overlay-'));
const env = {...process.env};
delete env.ELECTRON_RUN_AS_NODE;
let app, browser, server, game;
try {
 const file = join(temp, 'overlay.pixieditor');
 app = await electron.launch({executablePath: process.env.REWRITE_EXECUTABLE || require('electron'), args: [...(process.env.REWRITE_EXECUTABLE ? [] : [join(root, 'apps/editor-desktop/out/main/index.js')]), '--no-hub', `--user-data-dir=${join(temp, 'user')}`], env});
 const page = await app.firstWindow();
 page.setDefaultTimeout(15000);
 const errors = [];
 page.on('pageerror', e => errors.push(e.message));
 const canvas = page.getByTestId('pixi-canvas');
 await expect(canvas).toHaveAttribute('data-ready', 'true', {timeout: 30000});
 const menu = label => app.evaluate(({Menu}, text) => Menu.getApplicationMenu().items.flatMap(m => m.submenu?.items ?? []).find(i => i.label === text).click(), label);
 const choose = path => app.evaluate(({dialog}, target) => { dialog.showOpenDialog = async () => ({canceled: false, filePaths: [target]}); dialog.showSaveDialog = async () => ({canceled: false, filePath: target}); dialog.showMessageBox = async () => ({response: 1, checkboxChecked: false}); }, path);
 await choose(file); await menu('Save');
 await expect.poll(() => readFile(file, 'utf8').then(() => true, () => false)).toBe(true);
 const project = JSON.parse(await readFile(file, 'utf8'));
 const t = (id, x, y) => ({id: `${id}-t`, type: 'scene.transform2d', version: 1, data: {x, y, rotation: 0, scaleX: 1, scaleY: 1}});
 project.extensions['interactions.globals'] = {version: 1, items: [{id: 'g-score', name: 'score', type: 'number', initial: 7}]};
 project.scenes[0].entities = [
  {id: 'a', name: 'A', parentId: null, active: true, components: [t('a', 100, 100)]},
  {id: 'b', name: 'B', parentId: null, active: false, components: [t('b', 200, 100)]},
  {id: 'clock', name: 'Clock', parentId: null, active: true, components: [t('clock', 300, 100), {id: 'clock-timer', type: 'interactions.timer', version: 1, data: {seconds: 5, repeat: true, autostart: true}}]},
 ];
 await writeFile(file, JSON.stringify(project));
 await choose(file); await menu('Open…');
 await expect.poll(async () => Object.keys(JSON.parse(await canvas.getAttribute('data-transforms') ?? '{}'))).toContain('clock');
 const overlay = canvas.locator('[data-debug-overlay]');
 await page.getByRole('button', {name: 'Play', exact: true}).click();
 await expect(overlay).toBeHidden();
 await page.keyboard.press('F3');
 await expect(overlay).toBeVisible();
 await expect(overlay).toContainText(/FPS \d+/);
 await expect(overlay).toContainText('Objects 2 / 3');
 await expect(overlay).toContainText('Timers 1');
 await expect(overlay).toContainText('score = 7');
 await page.keyboard.press('F3');
 await expect(overlay).toBeHidden();
 await page.getByRole('button', {name: 'Stop', exact: true}).click();
 console.log('PASS Preview: F3 shows frame rate, objects, timers and globals, F3 hides it');

 // Settings → Game: on for exported games.
 await page.getByRole('button', {name: 'Editor settings', exact: true}).click(); await page.getByRole('menuitem', {name: /^Settings…/}).click();
 const dialog = page.getByTestId('settings-dialog');
 await dialog.getByRole('checkbox', {name: 'Debug overlay in exported games (F3)', exact: true}).check();
 await page.keyboard.press('Escape');
 await choose(file); await menu('Save');
 await expect.poll(() => readFile(file, 'utf8').then(t => JSON.parse(t).extensions['pixi.render']?.debugOverlay)).toBe(true);
 const exportDir = join(temp, 'export');
 await mkdir(exportDir);
 await page.getByRole('button', {name: 'Export', exact: true}).click();
 await choose(exportDir);
 await page.getByRole('button', {name: 'Export HTML…', exact: true}).click();
 await expect(page.getByTestId('build-status')).toHaveAttribute('data-phase', /complete|failed/, {timeout: 60000});
 expect(await page.getByTestId('build-status').innerText()).not.toMatch(/Error/);
 const output = await page.getByTestId('build-output').innerText();
 server = createServer(async (req, res) => {
  try {
   const path = resolve(output, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/$/, '/index.html'));
   if (!path.startsWith(resolve(output) + sep)) throw Error('outside');
   res.setHeader('Content-Type', {'.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.webp': 'image/webp', '.wasm': 'application/wasm'}[extname(path)] ?? 'application/octet-stream');
   res.end(await readFile(path));
  } catch { res.statusCode = 404; res.end(); }
 });
 await new Promise(r => server.listen(0, '127.0.0.1', r));
 browser = await chromium.launch({channel: 'chrome', headless: true, args: ['--enable-unsafe-swiftshader']});
 game = await (await browser.newContext({viewport: {width: 960, height: 540}})).newPage();
 const gameErrors = [];
 game.on('pageerror', e => gameErrors.push(e.message));
 await game.goto(`http://127.0.0.1:${server.address().port}`);
 await game.getByRole('button', {name: 'Start', exact: true}).click({timeout: 30000});
 const gameOverlay = game.locator('#game [data-debug-overlay]');
 await expect(gameOverlay).toBeHidden();
 await game.keyboard.press('F3');
 await expect(gameOverlay).toBeVisible();
 await expect(gameOverlay).toContainText('Objects 2 / 3');
 await expect(gameOverlay).toContainText('score = 7');
 expect(gameErrors).toEqual([]);
 expect(errors).toEqual([]);
 console.log('PASS exported game: the Game setting enables F3 and the same overlay');
} catch (error) {
 await mkdir(join(root, 'outputs'), {recursive: true});
 const page = app ? await app.firstWindow().catch(() => null) : null;
 await page?.screenshot({path: join(root, 'outputs/overlay-failure.png')}).catch(() => {});
 throw error;
} finally {
 await browser?.close().catch(() => {});
 if (server) await new Promise(r => server.close(r));
 if (app) { await app.evaluate(({BrowserWindow}) => { for (const w of BrowserWindow.getAllWindows()) w.destroy(); }).catch(() => {}); await app.close().catch(() => {}); }
 await rm(temp, {recursive: true, force: true, maxRetries: 3});
}
