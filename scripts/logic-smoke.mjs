// Dalga C: tilemaps (render, brush stroke as one undo step), state machines (transitions, conditions), game camera
// (follow, shake) and the save slot — in the editor Preview and in exported HTML.
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
const temp = await mkdtemp(join(tmpdir(), 'rewrite-logic-'));
const env = {...process.env};
delete env.ELECTRON_RUN_AS_NODE;
const RED = [220, 60, 60], BLUE = [60, 90, 220];
const near = (a, b, tolerance = 12) => a.every((v, i) => Math.abs(v - b[i]) <= tolerance);
let app, browser, server, game;

try {
 await sharp({create: {width: 64, height: 32, channels: 4, background: {r: RED[0], g: RED[1], b: RED[2], alpha: 1}}}).composite([{input: {create: {width: 32, height: 32, channels: 4, background: {r: BLUE[0], g: BLUE[1], b: BLUE[2], alpha: 1}}}, left: 32, top: 0}]).png().toFile(join(temp, 'tiles.png'));
 const file = join(temp, 'logic.pixieditor');
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
 await page.getByRole('button', {name: 'Library', exact: true}).click();
 await choose(join(temp, 'tiles.png'));
 await page.getByRole('button', {name: 'Import image…', exact: true}).click();
 await expect(page.getByTestId('asset-list').getByText('tiles', {exact: true})).toBeVisible({timeout: 30000});
 await page.keyboard.press('Escape');
 await choose(file); await menu('Save');
 await expect.poll(() => readFile(file, 'utf8').then(() => true, () => false)).toBe(true);
 const project = JSON.parse(await readFile(file, 'utf8')), tileset = project.extensions['assets.registry'].items.find(a => a.type === 'pixi.texture').id;
 const t = (id, x, y) => ({id: `${id}-t`, type: 'scene.transform2d', version: 1, data: {x, y, rotation: 0, scaleX: 1, scaleY: 1}});
 const shape = (id, color, size = 60) => ({id: `${id}-s`, type: 'pixi.shape', version: 1, data: {alpha: 1, kind: 'rect', width: size, height: size, color, rounded: 0, sides: 5, innerRadius: .5, strokeColor: '#ffffff', strokeWidth: 0}});
 const action = (id, type, targetId, amount) => ({id, type, targetId, value: true, ...(amount === undefined ? {} : {amount})});
 const button = (id, x, color, actions) => ({id, name: id, parentId: null, active: true, components: [t(id, x, 470), shape(id, color), ...(actions.length ? [{id: `${id}-b`, type: 'interactions.bindings', version: 1, data: {rules: [{id: `${id}-r`, trigger: {type: 'pointer.click', sourceId: id, event: ''}, actions}]}}] : [])]});
 project.scenes[0].entities = [
  {id: 'map', name: 'map', parentId: null, active: true, components: [t('map', 100, 100), {id: 'map-tm', type: 'pixi.tilemap', version: 1, data: {assetId: tileset, tileWidth: 32, tileHeight: 32, columns: 6, rows: 3, alpha: 1, tiles: [0, 1, ...Array(16).fill(-1)]}}]},
  {id: 'brain', name: 'brain', parentId: null, active: true, components: [t('brain', 40, 40), {id: 'sm', type: 'interactions.stateMachine', version: 1, data: {initial: 'idle', states: [{id: 'idle', name: 'idle', actions: [action('e0', 'global.set', 'v-mode', 0)]}, {id: 'run', name: 'run', actions: [action('e1', 'global.set', 'v-mode', 1)]}], transitions: [{id: 'x1', from: 'idle', to: 'run', trigger: {type: 'pointer.click', sourceId: 'go', event: ''}}, {id: 'x2', from: '*', to: 'idle', trigger: {type: 'pointer.click', sourceId: 'reset', event: ''}}]}}]},
  {id: 'hero', name: 'hero', parentId: null, active: true, components: [t('hero', 800, 270), shape('hero', '#3c5adc', 40)]},
  {id: 'label', name: 'label', parentId: null, active: true, components: [t('label', 480, 300), {id: 'label-x', type: 'pixi.text', version: 1, data: {alpha: 1, text: 'score {score} mode {mode}', fontSize: 28, color: '#ffffff', font: ''}}]},
  button('go', 380, '#44aa66', []), button('reset', 460, '#888888', []),
  button('plus', 540, '#d4c040', [action('p', 'global.add', 'v-score', 1)]), button('save', 620, '#40c0d4', [action('s', 'save.write', 'save')]),
  button('load', 700, '#c040d4', [action('l', 'save.read', 'save')]), button('cam', 780, '#eeeeee', [action('c', 'camera.follow', 'hero')]),
  button('shake', 860, '#e08040', [action('k', 'camera.shake', 'camera', 30)]),
 ];
 project.extensions['interactions.globals'] = {version: 1, items: [{id: 'v-score', name: 'score', type: 'number', initial: 0}, {id: 'v-mode', name: 'mode', type: 'number', initial: -1}]};
 await writeFile(file, JSON.stringify(project));
 await choose(file); await menu('Open…');
 await expect.poll(async () => Object.keys(JSON.parse(await canvas.getAttribute('data-transforms') ?? '{}'))).toContain('brain');
 await expect.poll(async () => JSON.parse(await canvas.getAttribute('data-visuals') ?? '[]').some(v => v.ready && v.tiles === 2)).toBe(true);

 const view = async () => { const b = await canvas.locator('canvas').boundingBox(), s = Math.min((b.width - 80) / 960, (b.height - 90) / 540); return {b, at: (x, y) => ({x: b.x + (b.width - 960 * s) / 2 + x * s, y: b.y + (b.height - 540 * s) / 2 + y * s})}; };
 const pixel = async (x, y) => { const {b, at} = await view(), p = at(x, y), buffer = await canvas.locator('canvas').screenshot(), ratio = (await sharp(buffer).metadata()).width / b.width; return [...await sharp(buffer).extract({left: Math.round((p.x - b.x) * ratio), top: Math.round((p.y - b.y) * ratio), width: 1, height: 1}).removeAlpha().raw().toBuffer()]; };
 await expect.poll(async () => near(await pixel(116, 116), RED)).toBe(true);
 await expect.poll(async () => near(await pixel(148, 116), BLUE)).toBe(true);
 expect(near(await pixel(180, 116), RED) || near(await pixel(180, 116), BLUE)).toBe(false);

 // Brush: blue across row 1 in one stroke = one undo step.
 await page.getByRole('button', {name: 'Layers', exact: true}).click();
 await page.getByRole('button', {name: 'Select map', exact: true}).click();
 await page.keyboard.press('Escape');
 await page.getByRole('button', {name: 'Properties', exact: true}).click();
 await page.locator('details.component > summary').filter({hasText: /^Tilemap/}).click();
 const inspector = page.getByTestId('tilemap-inspector');
 await inspector.getByRole('button', {name: 'Tile 1', exact: true}).click();
 await inspector.getByRole('button', {name: 'Paint tiles', exact: true}).click();
 await expect(canvas).toHaveAttribute('data-painting', 'map');
 await page.keyboard.press('Escape');
 const {at} = await view(), a = at(110, 148), b = at(190, 148);
 await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, {steps: 8}); await page.mouse.up();
 await expect.poll(async () => near(await pixel(116, 148), BLUE) && near(await pixel(148, 148), BLUE) && near(await pixel(180, 148), BLUE)).toBe(true);
 await expect(page.getByLabel('Unsaved changes', {exact: true})).toBeVisible();
 await menu('Undo');
 await expect.poll(async () => near(await pixel(148, 148), BLUE)).toBe(false);
 await menu('Redo');
 await expect.poll(async () => near(await pixel(148, 148), BLUE)).toBe(true);
 await page.getByRole('button', {name: 'Properties', exact: true}).click();
 await page.locator('details.component > summary').filter({hasText: /^Tilemap/}).click();
 await page.getByTestId('tilemap-inspector').getByRole('button', {name: 'Stop painting', exact: true}).click();
 await page.keyboard.press('Escape');
 await expect(canvas).toHaveAttribute('data-painting', '');
 console.log('PASS tilemap renders tiles; a brush stroke paints a row as one undo step');

 // State machine inspector shows the diagram.
 await page.getByRole('button', {name: 'Layers', exact: true}).click();
 await page.getByRole('button', {name: 'Select brain', exact: true}).click();
 await page.keyboard.press('Escape');
 await page.getByRole('button', {name: 'Properties', exact: true}).click();
 await page.locator('details.component > summary').filter({hasText: /^State machine/}).click();
 await expect(page.getByTestId('state-machine').getByRole('img', {name: 'State diagram'})).toBeVisible();
 await expect(page.getByTestId('state-machine').locator('[data-transition]')).toHaveCount(2);
 await page.keyboard.press('Escape');
 await page.getByRole('button', {name: 'Layers', exact: true}).click();
 await page.getByRole('button', {name: 'Select brain', exact: true}).click({modifiers: ['Meta']});
 await page.keyboard.press('Escape');

 // Preview: state transitions, camera follow and shake; Stop restores the framing.
 const states = async () => JSON.parse(await canvas.getAttribute('data-interactions')).states ?? {};
 const camera = async () => JSON.parse(await canvas.getAttribute('data-runtime-camera') ?? '{"x":0,"y":0}');
 await page.getByRole('button', {name: 'Play', exact: true}).click();
 await expect.poll(states).toEqual({sm: 'idle'});
 const press = async (x, y) => { const p = (await view()).at(x, y); await page.mouse.click(p.x, p.y); };
 await press(380, 470); await expect.poll(states).toEqual({sm: 'run'});
 await press(460, 470); await expect.poll(states).toEqual({sm: 'idle'});
 await press(780, 470); await expect.poll(camera).toEqual({x: -320, y: 0});
 await press(860 - 320, 470); await expect.poll(async () => { const c = await camera(); return c.x !== -320 || c.y !== 0; }).toBe(true);
 await expect.poll(camera, {timeout: 3000}).toEqual({x: -320, y: 0});
 await page.getByRole('button', {name: 'Stop', exact: true}).click();
 await expect.poll(camera).toEqual({x: 0, y: 0});
 console.log('PASS Preview: state machine transitions (including from any state), camera follow and shake, Stop resets');

 // Export: tilemap pixels, state machine, save slot across reloads, camera follow.
 const exportDir = join(temp, 'export');
 await mkdir(exportDir);
 await page.getByRole('button', {name: 'Export', exact: true}).click();
 await choose(exportDir);
 await page.getByRole('button', {name: 'Export HTML…', exact: true}).click();
 await expect(page.getByTestId('build-status')).toHaveAttribute('data-phase', /complete|failed/, {timeout: 30000});
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
 const context = await browser.newContext({viewport: {width: 960, height: 540}});
 game = await context.newPage();
 const gameErrors = [];
 game.on('pageerror', e => gameErrors.push(e.message));
 game.on('console', m => { if (m.type() === 'error') gameErrors.push(m.text().slice(0, 300)); });
 const start = async () => { await game.goto(`http://127.0.0.1:${server.address().port}`); await game.getByRole('button', {name: 'Start', exact: true}).click({timeout: 30000}); await expect(game.locator('#game')).toHaveAttribute('data-scene-id', project.entrySceneId); };
 await start();
 const stage = game.locator('#game'), text = async () => JSON.parse(await stage.getAttribute('data-texts') ?? '{}')['label-x'];
 const gameAt = async (x, y) => { const box = await stage.locator('canvas').boundingBox(), s = Math.min(box.width / 960, box.height / 540); return {x: box.x + (box.width - 960 * s) / 2 + x * s, y: box.y + (box.height - 540 * s) / 2 + y * s}; };
 const gamePixel = async (x, y) => { const p = await gameAt(x, y), buffer = await game.screenshot(); return [...await sharp(buffer).extract({left: Math.round(p.x), top: Math.round(p.y), width: 1, height: 1}).removeAlpha().raw().toBuffer()]; };
 const tap = async (x, y) => { const p = await gameAt(x, y); await game.mouse.click(p.x, p.y); };
 await expect.poll(async () => near(await gamePixel(116, 116), RED) && near(await gamePixel(180, 148), BLUE)).toBe(true);
 await expect.poll(async () => JSON.parse(await stage.getAttribute('data-states'))).toEqual({sm: 'idle'});
 await expect.poll(text).toBe('score 0 mode 0');
 await tap(380, 470); await expect.poll(text).toBe('score 0 mode 1');
 await tap(540, 470); await expect.poll(text).toBe('score 1 mode 1');
 await tap(620, 470); await tap(540, 470); await expect.poll(text).toBe('score 2 mode 1');
 await start();
 await expect.poll(text).toBe('score 0 mode 0');
 await tap(700, 470); await expect.poll(text).toBe('score 1 mode 1');
 await tap(780, 470); await expect.poll(async () => JSON.parse(await stage.getAttribute('data-camera'))).toEqual({x: -320, y: 0});
 expect(gameErrors).toEqual([]);
 expect(errors).toEqual([]);
 await mkdir(join(root, 'outputs'), {recursive: true});
 await game.screenshot({path: join(root, 'outputs/game-logic.png')});
 console.log('PASS export: painted tilemap, state machine, save slot survives a reload, camera follow');
} catch (error) {
 await mkdir(join(root, 'outputs'), {recursive: true});
 const page = app ? await app.firstWindow().catch(() => null) : null;
 await page?.screenshot({path: join(root, 'outputs/logic-failure.png')}).catch(() => {});
 await game?.screenshot({path: join(root, 'outputs/logic-game-failure.png')}).catch(() => {});
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
