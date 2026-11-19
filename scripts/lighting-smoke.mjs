// 2D lighting: a Lighting object darkens the world, a Light 2D brightens around it and a static wall casts a shadow;
// screen-space HUD stays untouched — in the editor, Preview and the exported game.
import {_electron as electron, chromium, expect} from '@playwright/test';
import {createServer} from 'node:http';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {dirname, extname, join, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(join(root, 'apps/editor-desktop/package.json'));
const sharp = require('sharp');
const temp = await mkdtemp(join(tmpdir(), 'rewrite-lighting-'));
const env = {...process.env};
delete env.ELECTRON_RUN_AS_NODE;
let app, browser, server, game;
try {
 const file = join(temp, 'lighting.pixieditor');
 app = await electron.launch({executablePath: process.env.REWRITE_EXECUTABLE || require('electron'), args: [...(process.env.REWRITE_EXECUTABLE ? [] : [join(root, 'apps/editor-desktop/out/main/index.js')]), '--no-hub', `--user-data-dir=${join(temp, 'user')}`], env});
 const page = await app.firstWindow();
 page.setDefaultTimeout(15000);
 const errors = [];
 page.on('pageerror', e => errors.push(e.message));
 page.on('console', m => { if (process.env.DEBUG_CONSOLE && m.type() !== 'log') console.log('[console]', m.type(), m.text().slice(0, 1500)); });
 const canvas = page.getByTestId('pixi-canvas');
 await expect(canvas).toHaveAttribute('data-ready', 'true', {timeout: 30000});
 const menu = label => app.evaluate(({Menu}, text) => Menu.getApplicationMenu().items.flatMap(m => m.submenu?.items ?? []).find(i => i.label === text).click(), label);
 const choose = path => app.evaluate(({dialog}, target) => { dialog.showOpenDialog = async () => ({canceled: false, filePaths: [target]}); dialog.showSaveDialog = async () => ({canceled: false, filePath: target}); dialog.showMessageBox = async () => ({response: 1, checkboxChecked: false}); }, path);
 await choose(file); await menu('Save');
 await expect.poll(() => readFile(file, 'utf8').then(() => true, () => false)).toBe(true);
 const project = JSON.parse(await readFile(file, 'utf8'));
 const t = (id, x, y) => ({id: `${id}-t`, type: 'scene.transform2d', version: 1, data: {x, y, rotation: 0, scaleX: 1, scaleY: 1}});
 const shape = (id, color, w, h) => ({id: `${id}-s`, type: 'pixi.shape', version: 1, data: {alpha: 1, kind: 'rect', width: w, height: h, color, rounded: 0, sides: 5, innerRadius: .5, strokeColor: '#ffffff', strokeWidth: 0}});
 project.scenes[0].entities = [
  {id: 'floor', name: 'Floor', parentId: null, active: true, components: [t('floor', 480, 270), shape('floor', '#c8c8c8', 960, 540)]},
  {id: 'wall', name: 'Wall', parentId: null, active: true, components: [t('wall', 480, 270), shape('wall', '#c8c8c8', 40, 200), {id: 'wall-c', type: 'physics.boxCollider2d', version: 1, data: {width: 40, height: 200, offsetX: 0, offsetY: 0, sensor: false, chamfer: 0}}]},
  {id: 'lamp', name: 'Lamp', parentId: null, active: true, components: [t('lamp', 300, 270), {id: 'lamp-l', type: 'pixi.light', version: 1, data: {color: '#ffffff', radius: 900, intensity: 1, flicker: 0, shadows: true}}]},
  {id: 'dark', name: 'Darkness', parentId: null, active: true, components: [t('dark', 0, 0), {id: 'dark-l', type: 'pixi.lighting', version: 1, data: {enabled: true, ambient: '#202020'}}]},
  {id: 'hud', name: 'HUD', parentId: null, active: true, components: [t('hud', 60, 40), shape('hud', '#ff2020', 60, 40), {id: 'hud-screen', type: 'pixi.screenSpace', version: 1, data: {anchor: 'top-left'}}]},
 ];
 await writeFile(file, JSON.stringify(project));
 await choose(file); await menu('Open…');
 await expect.poll(async () => Object.keys(JSON.parse(await canvas.getAttribute('data-transforms') ?? '{}'))).toContain('hud');
 const view = async () => { const b = await canvas.locator('canvas').boundingBox(), s = Math.min((b.width - 80) / 960, (b.height - 90) / 540); return {b, at: (x, y) => ({x: b.x + (b.width - 960 * s) / 2 + x * s, y: b.y + (b.height - 540 * s) / 2 + y * s})}; };
 const pixel = async (x, y) => {
  const {b, at} = await view(), p = at(x, y), buffer = await canvas.locator('canvas').screenshot(), ratio = (await sharp(buffer).metadata()).width / b.width;
  return [...await sharp(buffer).extract({left: Math.round((p.x - b.x) * ratio), top: Math.round((p.y - b.y) * ratio), width: 1, height: 1}).removeAlpha().raw().toBuffer()];
 };
 const level = p => (p[0] + p[1] + p[2]) / 3;
 const check = async (read, where) => {
  await expect.poll(async () => level(await read(340, 270)) > 140, {message: `${where}: lit near the lamp`}).toBe(true);
  await expect.poll(async () => level(await read(640, 270)) < 60, {message: `${where}: shadow behind the wall`}).toBe(true);
  expect(level(await read(640, 30)) - level(await read(640, 270)), `${where}: open side brighter than the shadow`).toBeGreaterThan(30);
  const [r, g] = await read(60, 40); expect(r > 180 && g < 90, `${where}: HUD not darkened`).toBe(true);
 };
 await check(pixel, 'editor');
 console.log('PASS editor: ambient darkness, a lamp, a hard shadow behind the wall, HUD untouched');
 await page.getByRole('button', {name: 'Play', exact: true}).click();
 await check(pixel, 'Preview');
 await page.getByRole('button', {name: 'Stop', exact: true}).click();
 console.log('PASS Preview draws the same lighting');

 const exportDir = join(temp, 'export');
 await mkdir(exportDir);
 await page.getByRole('button', {name: 'Export', exact: true}).click();
 await choose(exportDir);
 await page.getByRole('button', {name: 'Export HTML…', exact: true}).click();
 await expect(page.getByTestId('build-status')).toHaveAttribute('data-phase', /complete|failed/, {timeout: 30000});
 expect(await page.getByTestId('build-status').innerText()).not.toMatch(/Error/);
 const output = await page.getByTestId('build-output').innerText();
 const bundle = JSON.parse(await readFile(join(output, 'project.json'), 'utf8'));
 expect(bundle.runtimes).toContain('lighting');
 server = createServer(async (req, res) => {
  try {
   const path = resolve(output, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/$/, '/index.html'));
   if (!path.startsWith(resolve(output) + sep)) throw Error('outside');
   res.setHeader('Content-Type', {'.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.webp': 'image/webp'}[extname(path)] ?? 'application/octet-stream');
   res.end(await readFile(path));
  } catch { res.statusCode = 404; res.end(); }
 });
 await new Promise(r => server.listen(0, '127.0.0.1', r));
 browser = await chromium.launch({channel: 'chrome', headless: true, args: ['--enable-unsafe-swiftshader']});
 game = await browser.newPage({viewport: {width: 960, height: 540}});
 const gameErrors = [];
 game.on('pageerror', e => gameErrors.push(e.message));
 game.on('console', m => { if (m.type() === 'error') gameErrors.push(m.text().slice(0, 300)); });
 await game.goto(`http://127.0.0.1:${server.address().port}`);
 await game.getByRole('button', {name: 'Start', exact: true}).click({timeout: 30000});
 const stage = game.locator('#game');
 await expect(stage).toHaveAttribute('data-scene-id', project.entrySceneId);
 const at = async (x, y) => { const box = await stage.locator('canvas').boundingBox(), s = Math.min(box.width / 960, box.height / 540); return {x: box.x + (box.width - 960 * s) / 2 + x * s, y: box.y + (box.height - 540 * s) / 2 + y * s}; };
 const gamePixel = async (x, y) => { const q = await at(x, y), buffer = await game.screenshot(); return [...await sharp(buffer).extract({left: Math.round(q.x), top: Math.round(q.y), width: 1, height: 1}).removeAlpha().raw().toBuffer()]; };
 await check(gamePixel, 'game');
 expect(gameErrors).toEqual([]);
 expect(errors).toEqual([]);
 console.log('PASS exported game: the lighting chunk draws the same light, shadow and HUD');
} catch (error) {
 await mkdir(join(root, 'outputs'), {recursive: true});
 const page = app ? await app.firstWindow().catch(() => null) : null;
 await page?.screenshot({path: join(root, 'outputs/lighting-failure.png')}).catch(() => {});
 await game?.screenshot({path: join(root, 'outputs/lighting-game-failure.png')}).catch(() => {});
 throw error;
} finally {
 await browser?.close().catch(() => {});
 if (server) await new Promise(r => server.close(r));
 if (app) { await app.evaluate(({BrowserWindow}) => { for (const w of BrowserWindow.getAllWindows()) w.destroy(); }).catch(() => {}); await app.close().catch(() => {}); }
 await rm(temp, {recursive: true, force: true, maxRetries: 3});
}
