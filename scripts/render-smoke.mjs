// Game rendering (PixiJS) settings: Settings → Game (this project) edits the render size, background, scaling,
// resolution, antialias, pixel art and ticker limits as project undo steps; the editor stage and Preview mirror them,
// and the exported game initialises PixiJS with them (canvas size, resolution, ticker, scale mode, clear colour).
import {_electron as electron, chromium, expect} from '@playwright/test';
import {createServer} from 'node:http';
import {mkdir, mkdtemp, readFile, rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {dirname, extname, join, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(join(root, 'apps/editor-desktop/package.json'));
const sharp = require('sharp');
const temp = await mkdtemp(join(tmpdir(), 'rewrite-render-'));
const env = {...process.env};
delete env.ELECTRON_RUN_AS_NODE;
let app, browser, server, game;

try {
 const file = join(temp, 'render.pixieditor');
 app = await electron.launch({executablePath: process.env.REWRITE_EXECUTABLE || require('electron'), args: [...(process.env.REWRITE_EXECUTABLE ? [] : [join(root, 'apps/editor-desktop/out/main/index.js')]), '--no-hub', `--user-data-dir=${join(temp, 'user')}`], env});
 const page = await app.firstWindow();
 page.setDefaultTimeout(15000);
 const errors = [];
 page.on('pageerror', e => errors.push(e.message));
 const canvas = page.getByTestId('pixi-canvas');
 await expect(canvas).toHaveAttribute('data-ready', 'true', {timeout: 30000});
 const menu = label => app.evaluate(({Menu}, text) => Menu.getApplicationMenu().items.flatMap(m => m.submenu?.items ?? []).find(i => i.label === text).click(), label);
 const choose = path => app.evaluate(({dialog}, target) => {
  dialog.showOpenDialog = async () => ({canceled: false, filePaths: [target]});
  dialog.showSaveDialog = async () => ({canceled: false, filePath: target});
  dialog.showMessageBox = async () => ({response: 1, checkboxChecked: false});
 }, path);
 const save = async () => { await choose(file); await menu('Save'); await expect(page.getByLabel('Unsaved changes', {exact: true})).toHaveCount(0); return JSON.parse(await readFile(file, 'utf8')); };

 // Settings → Game (this project).
 await menu('Settings…');
 const dialog = page.getByTestId('settings-dialog'), gameSection = dialog.getByRole('region', {name: 'Game (this project)', exact: true});
 await expect(gameSection).toBeVisible();
 await expect(dialog.locator('section').first()).toHaveAttribute('data-section', 'studio.game');
 const g = gameSection.getByTestId('game-settings');
 await g.getByRole('combobox', {name: 'Render size', exact: true}).selectOption({label: '1080×1920 (portrait)'});
 await expect(g.getByRole('spinbutton', {name: 'Width', exact: true})).toHaveValue('1080');
 await g.locator('input[type="color"][aria-label="Background"]').fill('#e02020');
 await g.getByRole('combobox', {name: 'Canvas scale', exact: true}).selectOption('fill');
 await expect(g).toContainText("The window is covered; the stage's edges may be cut off.");
 await g.getByRole('combobox', {name: 'Resolution', exact: true}).selectOption('1');
 await expect(g.getByRole('combobox', {name: 'Max resolution', exact: true})).toHaveCount(0);
 await g.getByRole('checkbox', {name: 'Antialias', exact: true}).uncheck();
 await g.getByRole('checkbox', {name: 'Pixel art', exact: true}).check();
 await g.getByRole('combobox', {name: 'Max FPS (ticker)', exact: true}).selectOption('30');
 await g.getByRole('combobox', {name: 'Min FPS (ticker)', exact: true}).selectOption('15');
 await dialog.getByRole('searchbox', {name: 'Search settings', exact: true}).fill('ticker');
 await expect(gameSection).toBeVisible();
 await dialog.getByRole('searchbox', {name: 'Search settings', exact: true}).fill('');
 await page.keyboard.press('Escape');
 await expect(canvas).toHaveAttribute('data-stage-background', '#e02020');
 await expect(canvas).toHaveAttribute('data-pixel-art', 'true');
 let saved = await save();
 expect(saved.stage).toEqual({width: 1080, height: 1920});
 expect(saved.extensions['pixi.render']).toEqual({version: 1, background: '#e02020', resolution: 1, maxResolution: 2, antialias: false, renderer: 'webgl', scaleMode: 'fill', pixelArt: true, maxFPS: 30, minFPS: 15, debugOverlay: false});
 await menu('Undo');
 saved = await save();
 expect(saved.extensions['pixi.render'].minFPS).toBe(10);
 await menu('Redo');
 saved = await save();
 expect(saved.extensions['pixi.render'].minFPS).toBe(15);
 console.log('PASS Settings → Game (this project): render size, background, scaling, resolution, antialias, pixel art and ticker limits are saved as undo steps');

 // Editor stage background and Preview ticker.
 const view = async () => { const b = await canvas.locator('canvas').boundingBox(), s = Math.min((b.width - 80) / 1080, (b.height - 90) / 1920); return {b, at: (x, y) => ({x: b.x + (b.width - 1080 * s) / 2 + x * s, y: b.y + (b.height - 1920 * s) / 2 + y * s})}; };
 const pixel = async (x, y) => { const {b, at} = await view(), p = at(x, y), buffer = await canvas.locator('canvas').screenshot(), ratio = (await sharp(buffer).metadata()).width / b.width; return [...await sharp(buffer).extract({left: Math.round((p.x - b.x) * ratio), top: Math.round((p.y - b.y) * ratio), width: 1, height: 1}).removeAlpha().raw().toBuffer()]; };
 await expect.poll(async () => { const [r, gr, bl] = await pixel(1000, 1800); return r > 200 && gr < 60 && bl < 60; }).toBe(true);
 await page.getByRole('button', {name: 'Play', exact: true}).click();
 await expect.poll(async () => JSON.parse(await canvas.getAttribute('data-ticker') ?? '{}')).toEqual({maxFPS: 30, minFPS: 15});
 await page.getByRole('button', {name: 'Stop', exact: true}).click();
 await expect.poll(async () => JSON.parse(await canvas.getAttribute('data-ticker') ?? '{}')).toEqual({maxFPS: 0, minFPS: 10});
 console.log('PASS the editor stage uses the game background and pixel art; Preview runs with the ticker limits and Stop restores them');

 // Export: PixiJS initialised with the settings.
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
   res.setHeader('Content-Type', {'.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.webp': 'image/webp'}[extname(path)] ?? 'application/octet-stream');
   res.end(await readFile(path));
  } catch { res.statusCode = 404; res.end(); }
 });
 await new Promise(r => server.listen(0, '127.0.0.1', r));
 browser = await chromium.launch({channel: 'chrome', headless: true, args: ['--enable-unsafe-swiftshader']});
 game = await (await browser.newContext({viewport: {width: 960, height: 540}, deviceScaleFactor: 2})).newPage();
 const gameErrors = [];
 game.on('pageerror', e => gameErrors.push(e.message));
 game.on('console', m => { if (m.type() === 'error') gameErrors.push(m.text().slice(0, 300)); });
 await game.goto(`http://127.0.0.1:${server.address().port}`);
 await game.getByRole('button', {name: 'Start', exact: true}).click({timeout: 30000});
 const stage = game.locator('#game');
 await expect(stage).toHaveAttribute('data-scale', 'fill');
 const render = JSON.parse(await stage.getAttribute('data-render'));
 expect(render).toMatchObject({resolution: 1, width: 1080, height: 1920, maxFPS: 30, minFPS: 15, pixelArt: true, antialias: false});
 const box = await stage.boundingBox();
 expect(Math.round(box.width)).toBe(960); expect(Math.round(box.height)).toBe(1707);
 const shot = await game.screenshot(), [r, gr, bl] = [...await sharp(shot).extract({left: Math.round(888 * 2), top: Math.round((box.y + 960 * 960 / 1080) * 2), width: 1, height: 1}).removeAlpha().raw().toBuffer()];
 expect(r > 200 && gr < 60 && bl < 60).toBe(true);
 expect(gameErrors).toEqual([]);
 expect(errors).toEqual([]);
 await mkdir(join(root, 'outputs'), {recursive: true});
 await menu('Settings…');
 await page.screenshot({path: join(root, 'outputs/editor-game-settings.png')});
 console.log('PASS exported game: canvas 1080×1920 at resolution 1, ticker 15–30 FPS, pixel art, no antialias, fill scaling and the red clear colour');
} catch (error) {
 await mkdir(join(root, 'outputs'), {recursive: true});
 const page = app ? await app.firstWindow().catch(() => null) : null;
 await page?.screenshot({path: join(root, 'outputs/render-failure.png')}).catch(() => {});
 await game?.screenshot({path: join(root, 'outputs/render-game-failure.png')}).catch(() => {});
 throw error;
} finally {
 await browser?.close().catch(() => {});
 if (server) await new Promise(r => server.close(r));
 if (app) {
  await app.evaluate(({BrowserWindow}) => { for (const w of BrowserWindow.getAllWindows()) w.destroy(); }).catch(() => {});
  await app.close().catch(() => {});
 }
 await rm(temp, {recursive: true, force: true, maxRetries: 3});
}
