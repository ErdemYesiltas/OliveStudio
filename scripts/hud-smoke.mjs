// Screen Space (HUD): top-level objects with the component stay put on the screen while a zoomed camera follows a
// moving hero (a world box at the same spot moves away), draw above the world, and in the exported game keep their
// anchors when a device profile widens the screen. Add → HUD text creates one. Pixel checks.
import {_electron as electron, chromium, expect} from '@playwright/test';
import {createServer} from 'node:http';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {dirname, extname, join, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(join(root, 'apps/editor-desktop/package.json')), sharp = require('sharp');
const temp = await mkdtemp(join(tmpdir(), 'rewrite-hud-'));
const env = {...process.env};
delete env.ELECTRON_RUN_AS_NODE;
let app, browser, server, game;
const WHITE = [255, 255, 255], RED = [230, 57, 70], GREEN = [6, 214, 160];
const near = (p, c, d = 30) => Math.abs(p[0] - c[0]) < d && Math.abs(p[1] - c[1]) < d && Math.abs(p[2] - c[2]) < d;

try {
 const file = join(temp, 'hud.pixieditor');
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
 const box = (id, w, h, color) => ({id: `${id}-s`, type: 'pixi.shape', version: 1, data: {alpha: 1, kind: 'rect', width: w, height: h, color, rounded: 0, sides: 5, innerRadius: .5, strokeColor: '#ffffff', strokeWidth: 0}});
 const hud = (id, anchor) => ({id: `${id}-hud`, type: 'pixi.screenSpace', version: 1, data: {anchor}});
 const e = (id, x, y, ...components) => ({id, name: id, parentId: null, active: true, components: [t(id, x, y), ...components]});
 project.extensions['pixi.render'] = {version: 1, background: '#101820', profiles: {mobile: {landscape: {width: 1280, height: 540, scaleMode: 'fit'}}}};
 project.scenes[0].entities = [
  // A HUD box first in Layers still draws above the world.
  e('score', 900, 40, box('score', 80, 40, '#ffffff'), hud('score', 'top-right')),
  e('lives', 60, 500, box('lives', 60, 40, '#e63946'), hud('lives', 'bottom-left')),
  e('marker', 900, 40, box('marker', 120, 60, '#06d6a0')),
  e('hero', 200, 270, box('hero', 30, 30, '#ffd166'), {id: 'hero-tw', type: 'tween.player', version: 1, data: {duration: 1, delay: 0, ease: 'linear', repeat: 0, yoyo: false, autoplay: true, tracks: [{id: 'hx', entityId: 'hero', componentId: 'hero-t', property: 'x', from: 200, to: 1600}]}}),
  e('cam', 480, 270, {id: 'cam-c', type: 'pixi.camera2d', version: 1, data: {zoom: 2, rotate: false, target: 'hero', offsetX: 0, offsetY: 0, smoothing: 0, deadzoneWidth: 0, deadzoneHeight: 0, limit: false, limitLeft: 0, limitTop: 0, limitRight: 1920, limitBottom: 1080}}),
 ];
 await writeFile(file, JSON.stringify(project));
 await choose(file); await menu('Open…');
 await expect.poll(async () => Object.keys(JSON.parse(await canvas.getAttribute('data-transforms') ?? '{}'))).toContain('score');
 const pixel = async (x, y) => { const b = await canvas.locator('canvas').boundingBox(), s = Math.min((b.width - 80) / 960, (b.height - 90) / 540), shot = await canvas.locator('canvas').screenshot(), ratio = (await sharp(shot).metadata()).width / b.width; return [...await sharp(shot).extract({left: Math.round(((b.width - 960 * s) / 2 + x * s) * ratio), top: Math.round(((b.height - 540 * s) / 2 + y * s) * ratio), width: 1, height: 1}).removeAlpha().raw().toBuffer()]; };
 await page.mouse.click(5, 300);
 // Edit mode: the HUD box covers the world box placed at the same spot.
 await expect.poll(async () => near(await pixel(900, 40), WHITE)).toBe(true);
 await expect.poll(async () => near(await pixel(945, 40), GREEN)).toBe(true);
 console.log('PASS editor: HUD drawn above the world at its screen position');

 // Preview: the camera zooms 2× and follows the hero; HUD boxes stay, the world box leaves.
 await page.getByRole('button', {name: 'Play', exact: true}).click();
 await expect.poll(async () => JSON.parse(await canvas.getAttribute('data-runtime-view') ?? 'null')?.x ?? 0, {timeout: 5000}).toBeGreaterThan(1000);
 expect(near(await pixel(900, 40), WHITE)).toBe(true);
 expect(near(await pixel(60, 500), RED)).toBe(true);
 expect(near(await pixel(945, 40), GREEN)).toBe(false);
 await page.getByRole('button', {name: 'Stop', exact: true}).click();
 console.log('PASS Preview: HUD stays on screen while the zoomed camera follows; world objects move');

 // Add → HUD text: a text with the Screen Space component.
 await page.getByRole('button', {name: 'Add', exact: true}).click();
 const sub = page.getByRole('menu', {name: 'Text'});
 await expect(async () => { if (!await sub.isVisible()) { await page.getByRole('menuitem', {name: 'Text', exact: true}).focus(); await page.keyboard.press('ArrowRight'); } await expect(sub).toBeVisible({timeout: 1000}); }).toPass({timeout: 10000});
 await sub.getByRole('menuitem', {name: 'HUD text', exact: true}).focus(); await page.keyboard.press('Enter');
 await page.getByRole('button', {name: 'Properties', exact: true}).click();
 const props = page.getByTestId('properties');
 if (!await props.getByRole('combobox', {name: 'anchor', exact: true}).count()) await props.locator('summary').filter({hasText: /^Screen Space \(HUD\)$/}).click();
 await expect(props.getByRole('combobox', {name: 'anchor', exact: true}).locator('option:checked')).toHaveText('Top left');
 await expect(props).toContainText('ignoring the camera');
 await page.keyboard.press('Escape');
 await menu('Undo');
 console.log('PASS Add → HUD text with the Screen Space component and its anchor');

 // Export: a mobile-landscape profile widens the screen to 1280; top-right HUD moves with the edge, bottom-left stays.
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
 game = await (await browser.newContext({viewport: {width: 1280, height: 540}})).newPage();
 const gameErrors = [];
 game.on('pageerror', e => gameErrors.push(e.message));
 await game.goto(`http://127.0.0.1:${server.address().port}`);
 await game.getByRole('button', {name: 'Start', exact: true}).click({timeout: 30000});
 const stage = game.locator('#game');
 await expect.poll(async () => JSON.parse(await stage.getAttribute('data-view') ?? 'null')?.x ?? 0, {timeout: 5000}).toBeGreaterThan(1000);
 const gamePixel = async (x, y) => { const c = stage.locator('canvas'), b = await c.boundingBox(), s = Math.min(b.width / 1280, b.height / 540), shot = await c.screenshot(), ratio = (await sharp(shot).metadata()).width / b.width; return [...await sharp(shot).extract({left: Math.round(((b.width - 1280 * s) / 2 + x * s) * ratio), top: Math.round(((b.height - 540 * s) / 2 + y * s) * ratio), width: 1, height: 1}).removeAlpha().raw().toBuffer()]; };
 await expect.poll(async () => near(await gamePixel(1220, 40), WHITE)).toBe(true);
 expect(near(await gamePixel(900, 40), WHITE)).toBe(false);
 expect(near(await gamePixel(60, 500), RED)).toBe(true);
 expect(gameErrors).toEqual([]);
 expect(errors).toEqual([]);
 console.log('PASS exported game: HUD anchored top-right follows the wider screen, bottom-left stays, above the camera');
} catch (error) {
 await mkdir(join(root, 'outputs'), {recursive: true});
 const page = app ? await app.firstWindow().catch(() => null) : null;
 await page?.screenshot({path: join(root, 'outputs/hud-failure.png')}).catch(() => {});
 await game?.screenshot({path: join(root, 'outputs/hud-game-failure.png')}).catch(() => {});
 throw error;
} finally {
 await browser?.close().catch(() => {});
 if (server) await new Promise(r => server.close(r));
 if (app) { await app.evaluate(({BrowserWindow}) => { for (const w of BrowserWindow.getAllWindows()) w.destroy(); }).catch(() => {}); await app.close().catch(() => {}); }
 await rm(temp, {recursive: true, force: true, maxRetries: 3});
}
