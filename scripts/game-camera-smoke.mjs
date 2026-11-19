// Scene camera (Camera 2D, one per scene): zoom, following a tweened hero, limits, script lookAt/zoom, a rule that
// zooms out when an object is clicked through the zoomed view, the yellow frame gizmo, the Inspector target picker,
// and the one-camera rule in the Add menu and Add component. Checked in Preview and in the exported HTML game.
import {_electron as electron, chromium, expect} from '@playwright/test';
import {createServer} from 'node:http';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {dirname, extname, join, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(join(root, 'apps/editor-desktop/package.json')), sharp = require('sharp');
const {transform} = createRequire(join(root, 'modules/scripts/package.json'))('sucrase');
const temp = await mkdtemp(join(tmpdir(), 'rewrite-game-camera-'));
const env = {...process.env};
delete env.ELECTRON_RUN_AS_NODE;
let app, browser, server, game;

// After the hero's tween, point the camera far away at zoom 1 (the limits keep it inside the level).
const sceneScript = `let done = false;
export function update() {
  if (!done && game.time > 2.6) { done = true; game.camera.lookAt(5000, 5000); game.camera.zoom = 1; game.log('zoom', game.camera.zoom); }
}`;
const compile = source => transform(source, {transforms: ['typescript', 'imports'], production: true, disableESTransforms: true}).code;
const camera = {zoom: 2, rotate: false, target: 'hero', offsetX: 0, offsetY: 0, smoothing: 0, deadzoneWidth: 0, deadzoneHeight: 0, limit: true, limitLeft: 0, limitTop: 0, limitRight: 1920, limitBottom: 1080};

try {
 const file = join(temp, 'camera.pixieditor');
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
 await choose(file); await menu('Save');
 await expect.poll(() => readFile(file, 'utf8').then(() => true, () => false)).toBe(true);
 const project = JSON.parse(await readFile(file, 'utf8'));
 const t = (id, x, y) => ({id: `${id}-t`, type: 'scene.transform2d', version: 1, data: {x, y, rotation: 0, scaleX: 1, scaleY: 1}});
 const shape = (id, w, h, color) => ({id: `${id}-s`, type: 'pixi.shape', version: 1, data: {alpha: 1, kind: 'rect', width: w, height: h, color, rounded: 0, sides: 5, innerRadius: .5, strokeColor: '#ffffff', strokeWidth: 0}});
 const entity = (id, x, y, ...components) => ({id, name: id, parentId: null, active: true, components: [t(id, x, y), ...components]});
 project.scenes[0].entities = [
  entity('hero', 200, 300, shape('hero', 40, 40, '#e04040'),
   {id: 'hero-tw', type: 'tween.player', version: 1, data: {duration: 2, delay: 0, ease: 'linear', repeat: 0, yoyo: false, autoplay: true, tracks: [{id: 'hx', entityId: 'hero', componentId: 'hero-t', property: 'x', from: 200, to: 1400}]}}),
  entity('flag', 1500, 800, shape('flag', 80, 80, '#40e080'), {id: 'flag-r', type: 'interactions.bindings', version: 1, data: {rules: [{id: 'out', trigger: {type: 'pointer.click', sourceId: 'flag', event: ''}, actions: [{id: 'z', type: 'camera.zoom', targetId: 'camera', value: true, amount: .5}]}]}}),
  entity('wall', 929, 810, shape('wall', 58, 2000, '#ffd400')),
  entity('cam', 480, 270, {id: 'cam-c', type: 'pixi.camera2d', version: 1, data: camera}),
 ];
 project.extensions['scripts.library'] = {version: 1, items: [{id: 's-scene', name: 'Director', source: sceneScript, code: compile(sceneScript)}], scenes: {[project.entrySceneId]: {scriptId: 's-scene', params: {}, refs: {}}}};
 await writeFile(file, JSON.stringify(project));
 await choose(file); await menu('Open…');
 await expect.poll(async () => Object.keys(JSON.parse(await canvas.getAttribute('data-transforms') ?? '{}'))).toContain('cam');

 // Authoring: the yellow frame is drawn, a second camera is refused (Add menu selects the existing one), Add component
 // hides Camera 2D on other objects, and the Inspector shows the followed object.
 await expect.poll(async () => Number(await canvas.getAttribute('data-decorations'))).toBeGreaterThanOrEqual(1);
 await mkdir(join(root, 'outputs'), {recursive: true}); await canvas.screenshot({path: join(root, 'outputs/editor-game-camera.png')});
 await page.getByRole('button', {name: 'Add', exact: true}).click();
 await page.getByTestId('add-menu').getByRole('menuitem', {name: 'Camera', exact: true}).click();
 await expect(page.getByText('This scene already has one: cam (selected).')).toBeVisible();
 expect(Object.keys(JSON.parse(await canvas.getAttribute('data-transforms')))).toHaveLength(4);
 await page.getByRole('button', {name: 'Properties', exact: true}).click();
 const props = page.getByTestId('properties');
 await props.locator('summary').filter({hasText: /^Camera 2D$/}).click();
 await expect(props.getByRole('combobox', {name: 'Follow', exact: true}).locator('option:checked')).toHaveText('hero');
 await expect(props.getByRole('button', {name: 'Use the stage as limits', exact: true})).toBeVisible();
 await page.keyboard.press('Escape');
 await page.getByRole('button', {name: 'Layers', exact: true}).click(); await page.getByRole('button', {name: 'Select flag', exact: true}).click(); await page.keyboard.press('Escape');
 await page.getByRole('button', {name: 'Properties', exact: true}).click();
 const options = await props.getByRole('combobox', {name: 'Add component', exact: true}).locator('option').allInnerTexts();
 expect(options).not.toContain('Camera 2D');
 expect(options).toContain('Audio Listener');
 await page.keyboard.press('Escape');
 console.log('PASS authoring: camera frame gizmo, one camera per scene in the Add menu and Add component, Inspector target');

 // Preview: zoom 2 follows the hero (limits hold it at the left edge first), the script looks far away at zoom 1
 // (clamped to the level's corner), and clicking the flag through the moved view zooms out to 0.5.
 const view = async () => JSON.parse(await canvas.getAttribute('data-runtime-view') ?? 'null');
 const screen = async (v, x, y) => { const b = await canvas.locator('canvas').boundingBox(), s = Math.min((b.width - 80) / 960, (b.height - 90) / 540); return {x: b.x + (b.width - 960 * s) / 2 + (480 + (x - v.x) * v.zoom) * s, y: b.y + (b.height - 540 * s) / 2 + (270 + (y - v.y) * v.zoom) * s}; };
 await page.getByRole('button', {name: 'Play', exact: true}).click();
 await expect.poll(view).toMatchObject({zoom: 2, y: 300});
 const early = await view(); expect(early.x).toBeGreaterThanOrEqual(240);
 await expect.poll(async () => (await view()).x, {timeout: 5000}).toBeGreaterThan(1000);
 await expect.poll(view, {timeout: 6000}).toEqual({x: 1440, y: 810, zoom: 1, rotation: 0});
 const flag = await screen(await view(), 1500, 800);
 // The wall lies just left of the screen (world x 900–958 against a view starting at 960): the stage mask hides it.
 const pixel = async (x, y) => { const el = canvas.locator('canvas'), b = await el.boundingBox(), shot = await el.screenshot(), ratio = (await sharp(shot).metadata()).width / b.width, s = Math.min((b.width - 80) / 960, (b.height - 90) / 540);
  return [...await sharp(shot).extract({left: Math.floor(((b.width - 960 * s) / 2 + x * s) * ratio), top: Math.floor(((b.height - 540 * s) / 2 + y * s) * ratio), width: 1, height: 1}).removeAlpha().raw().toBuffer()]; };
 await expect(canvas).toHaveAttribute('data-stage-mask', 'true');
 const outside = await pixel(-6, 270); expect(outside[0]).toBeLessThan(120);
 await page.mouse.click(flag.x, flag.y);
 await expect.poll(view).toEqual({x: 960, y: 540, zoom: .5, rotation: 0});
 // Zoomed out, the same wall is inside the screen and drawn.
 await expect.poll(() => pixel(465, 270)).toEqual([expect.closeTo(255, -1.5), expect.closeTo(212, -1.5), expect.closeTo(0, -1.5)]);
 await page.getByRole('button', {name: 'Stop', exact: true}).click();
 await expect(canvas).not.toHaveAttribute('data-runtime-view', /./);
 await expect(canvas).not.toHaveAttribute('data-stage-mask', /./);
 await expect.poll(async () => Number(await canvas.getAttribute('data-decorations'))).toBeGreaterThanOrEqual(1);
 console.log('PASS Preview: world masked to the stage, zoomed follow inside limits, script lookAt/zoom, rule zoom from a click through the camera, Stop restores');

 // Export: the same camera in the browser game.
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
 const gameErrors = [], gameLogs = [];
 game.on('pageerror', e => gameErrors.push(e.message));
 game.on('console', m => { if (m.type() === 'error') gameErrors.push(m.text().slice(0, 300)); else if (m.text().startsWith('[script]')) gameLogs.push(m.text()); });
 await game.goto(`http://127.0.0.1:${server.address().port}`);
 await game.getByRole('button', {name: 'Start', exact: true}).click({timeout: 30000});
 const stage = game.locator('#game'), gameView = async () => JSON.parse(await stage.getAttribute('data-view') ?? 'null');
 await expect.poll(gameView).toMatchObject({zoom: 2, y: 300});
 await expect.poll(async () => (await gameView()).x, {timeout: 5000}).toBeGreaterThan(1000);
 await expect.poll(gameView, {timeout: 6000}).toEqual({x: 1440, y: 810, zoom: 1, rotation: 0});
 await expect.poll(() => gameLogs).toContain('[script] zoom 1');
 const at = async (v, x, y) => { const b = await stage.locator('canvas').boundingBox(), s = Math.min(b.width / 960, b.height / 540); return {x: b.x + (b.width - 960 * s) / 2 + (480 + (x - v.x) * v.zoom) * s, y: b.y + (b.height - 540 * s) / 2 + (270 + (y - v.y) * v.zoom) * s}; };
 const target = await at(await gameView(), 1500, 800);
 await game.mouse.click(target.x, target.y);
 await expect.poll(gameView).toEqual({x: 960, y: 540, zoom: .5, rotation: 0});
 expect(gameErrors).toEqual([]);
 expect(errors).toEqual([]);
 console.log('PASS exported game: the same follow, limits, script lookAt/zoom and rule zoom through the camera');
} catch (error) {
 await mkdir(join(root, 'outputs'), {recursive: true});
 const page = app ? await app.firstWindow().catch(() => null) : null;
 await page?.screenshot({path: join(root, 'outputs/game-camera-failure.png')}).catch(() => {});
 await game?.screenshot({path: join(root, 'outputs/game-camera-game-failure.png')}).catch(() => {});
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
