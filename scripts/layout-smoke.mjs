// Flexbox layout (@pixi/layout + Yoga): a row container arranges its child entities (pixels), reflows on property
// changes and when a child is hidden, owns child positions (move tool and arrows are ignored), adds from the Add
// menu, and the exported game lays out the same way.
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
const temp = await mkdtemp(join(tmpdir(), 'rewrite-layout-'));
const env = {...process.env};
delete env.ELECTRON_RUN_AS_NODE;
const RED = [220, 60, 60], GREEN = [60, 200, 90], BLUE = [60, 90, 220], PANEL = [42, 48, 56];
const hex = c => '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
const near = (a, b, tolerance = 8) => a.every((v, i) => Math.abs(v - b[i]) <= tolerance);
const t = (id, x, y) => ({id: `${id}-t`, type: 'scene.transform2d', version: 1, data: {x, y, rotation: 0, scaleX: 1, scaleY: 1}});
const box = (id, color) => ({id, name: id, parentId: 'row', active: true, components: [t(id, 999, -999), {id: `${id}-s`, type: 'pixi.shape', version: 1, data: {alpha: 1, kind: 'rect', width: 100, height: 100, color: hex(color), rounded: 0, sides: 5, innerRadius: .5, strokeColor: '#ffffff', strokeWidth: 0}}]});
// Row 480×160 centred at (480, 200): content 3×100 + 2×20 gap → items centred at x 360 / 480 / 600.
const project = {
 formatVersion: 1, name: 'Layout', entrySceneId: 'main', modules: {}, providers: {render: 'pixi'},
 scenes: [{formatVersion: 1, id: 'main', name: 'Main', entities: [
  {id: 'row', name: 'row', parentId: null, active: true, components: [t('row', 480, 200), {id: 'row-l', type: 'layout.container', version: 1, data: {width: 480, height: 160, anchorX: .5, anchorY: .5, direction: 'row', justify: 'center', align: 'center', wrap: false, gap: 20, padding: 16, background: hex(PANEL), backgroundAlpha: 1, borderColor: '#ffffff', borderWidth: 0, borderRadius: 0, clip: false}}]},
  box('a', RED), box('b', GREEN), box('c', BLUE),
  // Nested: a 400×120 column centres a 200×60 space-between row holding two 40 px boxes → x 400 / 560, y 430.
  {id: 'outer', name: 'outer', parentId: null, active: true, components: [t('outer', 480, 430), {id: 'outer-l', type: 'layout.container', version: 1, data: {width: 400, height: 120, anchorX: .5, anchorY: .5, direction: 'column', justify: 'center', align: 'center', wrap: false, gap: 0, padding: 0, background: hex(PANEL), backgroundAlpha: 1, borderColor: '#ffffff', borderWidth: 0, borderRadius: 0, clip: false}}]},
  {id: 'inner', name: 'inner', parentId: 'outer', active: true, components: [t('inner', 0, 0), {id: 'inner-l', type: 'layout.container', version: 1, data: {width: 200, height: 60, anchorX: .5, anchorY: .5, direction: 'row', justify: 'space-between', align: 'center', wrap: false, gap: 0, padding: 0, background: '#000000', backgroundAlpha: 0, borderColor: '#ffffff', borderWidth: 0, borderRadius: 0, clip: false}}]},
  {...box('n1', RED), parentId: 'inner', components: [t('n1', 0, 0), {id: 'n1-s', type: 'pixi.shape', version: 1, data: {alpha: 1, kind: 'rect', width: 40, height: 40, color: hex(RED), rounded: 0, sides: 5, innerRadius: .5, strokeColor: '#ffffff', strokeWidth: 0}}]},
  {...box('n2', BLUE), parentId: 'inner', components: [t('n2', 0, 0), {id: 'n2-s', type: 'pixi.shape', version: 1, data: {alpha: 1, kind: 'rect', width: 40, height: 40, color: hex(BLUE), rounded: 0, sides: 5, innerRadius: .5, strokeColor: '#ffffff', strokeWidth: 0}}]},
  // Absolute badge at left 8 / top 8 of the outer box (outer top-left 280,370): a 20 px green square centred at 298,388.
  {...box('badge', GREEN), parentId: 'outer', components: [t('badge', 0, 0), {id: 'badge-s', type: 'pixi.shape', version: 1, data: {alpha: 1, kind: 'rect', width: 20, height: 20, color: hex(GREEN), rounded: 0, sides: 5, innerRadius: .5, strokeColor: '#ffffff', strokeWidth: 0}}, {id: 'badge-i', type: 'layout.item', version: 1, data: {grow: 0, shrink: 1, alignSelf: 'auto', margin: 0, width: 0, height: 0, fit: 'none', position: 'absolute', left: 8, top: 8, widthUnit: 'px', heightUnit: 'px'}}]},
 ]}],
 extensions: {},
};
const file = join(temp, 'Layout.pixieditor');
let app, browser, server, game;

try {
 await writeFile(file, JSON.stringify(project));
 app = await electron.launch({executablePath: process.env.REWRITE_EXECUTABLE || require('electron'), args: [...(process.env.REWRITE_EXECUTABLE ? [] : [join(root, 'apps/editor-desktop/out/main/index.js')]), '--no-hub', `--user-data-dir=${join(temp, 'user')}`], env});
 const page = await app.firstWindow();
 page.setDefaultTimeout(15000);
 const errors = [];
 page.on('pageerror', e => errors.push(e.message));
 page.on('console', m => { if (m.type() === 'error' && /Content Security Policy|WebAssembly|yoga/i.test(m.text())) errors.push(m.text().slice(0, 200)); });
 const canvas = page.getByTestId('pixi-canvas');
 await expect(canvas).toHaveAttribute('data-ready', 'true', {timeout: 30000});
 const menu = label => app.evaluate(({Menu}, text) => Menu.getApplicationMenu().items.flatMap(m => m.submenu?.items ?? []).find(i => i.label === text).click(), label);
 const choose = path => app.evaluate(({dialog}, target) => {
  dialog.showOpenDialog = async () => ({canceled: false, filePaths: [target]});
  dialog.showSaveDialog = async () => ({canceled: false, filePath: target});
  dialog.showMessageBox = async () => ({response: 1, checkboxChecked: false});
 }, path);
 await choose(file); await menu('Open…');
 await expect(page.locator('header strong').first()).toHaveText(/^Main/);
 const view = async () => { const b = await canvas.locator('canvas').boundingBox(), s = Math.min((b.width - 80) / 960, (b.height - 90) / 540); return {b, at: (x, y) => ({x: b.x + (b.width - 960 * s) / 2 + x * s, y: b.y + (b.height - 540 * s) / 2 + y * s})}; };
 const pixel = async (x, y) => {
  const {b, at} = await view(), p = at(x, y), buffer = await canvas.locator('canvas').screenshot(), ratio = (await sharp(buffer).metadata()).width / b.width;
  return [...await sharp(buffer).extract({left: Math.round((p.x - b.x) * ratio), top: Math.round((p.y - b.y) * ratio), width: 1, height: 1}).removeAlpha().raw().toBuffer()];
 };
 const deselect = async () => { const p = (await view()).at(60, 500); await page.mouse.click(p.x, p.y); };
 const expectPixels = async (checks, prefix) => { for (const [x, y, color, label] of checks) await expect.poll(async () => near(await pixel(x, y), color), {message: `${prefix} ${label} at ${x},${y}`}).toBe(true); };
 const centred = [[360, 200, RED, 'a'], [480, 200, GREEN, 'b'], [600, 200, BLUE, 'c'], [250, 130, PANEL, 'panel corner'], [420, 200, PANEL, 'gap'], [400, 430, RED, 'nested left'], [560, 430, BLUE, 'nested right'], [450, 430, PANEL, 'nested gap'], [298, 388, GREEN, 'absolute badge']];
 await expectPixels(centred, 'centred row:');
 console.log('PASS row container lays out children by flexbox (centre, gap, padding, background); child x/y are ignored; nested containers and absolute items');

 // Properties: justify start → items move to the padding edge; Undo restores the centred row.
 await page.getByRole('button', {name: 'Layers', exact: true}).click();
 await page.getByRole('button', {name: 'Select row', exact: true}).click();
 await page.keyboard.press('Escape');
 await page.getByRole('button', {name: 'Properties', exact: true}).click();
 await page.locator('details.component > summary').filter({hasText: /^Layout container/}).click();
 await page.getByLabel('justify', {exact: true}).selectOption('flex-start');
 await page.keyboard.press('Escape');
 await deselect();
 await expectPixels([[306, 200, RED, 'a'], [426, 200, GREEN, 'b'], [546, 200, BLUE, 'c'], [680, 200, PANEL, 'free space']], 'justify start:');
 await menu('Undo');
 await expectPixels(centred, 'after undo:');
 console.log('PASS justify change reflows in one undo step');

 // Hidden child leaves the flow: two items centred at 420 / 540.
 await page.getByRole('button', {name: 'Layers', exact: true}).click();
 await page.getByRole('button', {name: 'Hide b', exact: true}).click();
 await page.keyboard.press('Escape');
 await expectPixels([[420, 200, RED, 'a'], [540, 200, BLUE, 'c'], [480, 200, PANEL, 'gap']], 'b hidden:');
 await page.getByRole('button', {name: 'Layers', exact: true}).click();
 await page.getByRole('button', {name: /^(Show|Unhide|Hide) b$/}).click();
 await page.keyboard.press('Escape');
 await expectPixels(centred, 'b shown:');
 console.log('PASS hiding a child removes it from the flow');

 // The layout owns child positions: dragging or nudging a child changes nothing.
 const from = (await view()).at(360, 200);
 await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(from.x + 60, from.y + 50, {steps: 6}); await page.mouse.up();
 await page.keyboard.press('ArrowRight');
 await deselect();
 await expectPixels(centred, 'after drag:');
 await expect(page.getByLabel('Unsaved changes', {exact: true})).toHaveCount(0);
 console.log('PASS dragging and nudging a laid-out child keep the layout and the document unchanged');

 // Add menu: Layout › Row creates a container entity.
 await page.getByRole('button', {name: 'Add', exact: true}).click();
 await page.getByRole('menuitem', {name: 'Layout', exact: true}).click();
 await expect(page.getByRole('menu', {name: 'Layout'}).getByRole('menuitem')).toHaveText(['Row', 'Column', 'Wrapping grid']);
 await page.getByRole('menuitem', {name: 'Column', exact: true}).click();
 await choose(file); await menu('Save');
 await expect(page.getByLabel('Unsaved changes', {exact: true})).toHaveCount(0);
 const saved = JSON.parse(await readFile(file, 'utf8')), column = saved.scenes[0].entities.find(e => e.name === 'Column');
 expect(column.components.find(c => c.type === 'layout.container').data).toMatchObject({direction: 'column', width: 240, height: 360});
 expect(saved.scenes[0].entities.find(e => e.id === 'a').components[0].data.x).toBe(999);
 await menu('Undo');
 await expect.poll(async () => near(await pixel(360, 200), RED)).toBe(true);
 console.log('PASS Add › Layout › Column creates a layout container');

 // Export: the `layout` runtime chunk (Yoga WASM) lays out the same pixels in Chrome.
 const exportDir = join(temp, 'export');
 await mkdir(exportDir);
 await page.getByRole('button', {name: 'Export', exact: true}).click();
 await choose(exportDir);
 await page.getByRole('button', {name: 'Export HTML…', exact: true}).click();
 await expect(page.getByTestId('build-status')).toHaveAttribute('data-phase', /complete|failed/, {timeout: 30000});
 expect(await page.getByTestId('build-status').innerText()).not.toMatch(/Error/);
 const output = await page.getByTestId('build-output').innerText();
 const bundle = JSON.parse(await readFile(join(output, 'project.json'), 'utf8'));
 expect(bundle.runtimes).toContain('layout');
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
 game.on('console', m => { if (m.type() === 'error') gameErrors.push(m.text()); });
 await game.goto(`http://127.0.0.1:${server.address().port}`);
 await game.getByRole('button', {name: 'Start', exact: true}).click({timeout: 30000});
 await expect(game.locator('#game')).toHaveAttribute('data-scene-id', 'main');
 const gamePixel = async (x, y) => {
  const box = await game.locator('#game canvas').boundingBox(), s = Math.min(box.width / 960, box.height / 540), buffer = await game.screenshot();
  const px = Math.round(box.x + (box.width - 960 * s) / 2 + x * s), py = Math.round(box.y + (box.height - 540 * s) / 2 + y * s);
  return [...await sharp(buffer).extract({left: px, top: py, width: 1, height: 1}).removeAlpha().raw().toBuffer()];
 };
 for (const [x, y, color, label] of centred) await expect.poll(async () => near(await gamePixel(x, y), color), {message: `game ${label}`}).toBe(true);
 expect(gameErrors).toEqual([]);
 expect(errors).toEqual([]);
 await mkdir(join(root, 'outputs'), {recursive: true});
 await page.screenshot({path: join(root, 'outputs/editor-layout.png')});
 await game.screenshot({path: join(root, 'outputs/game-layout.png')});
 console.log('PASS exported game ships the layout chunk and lays out the row like the editor');
} catch (error) {
 await mkdir(join(root, 'outputs'), {recursive: true});
 const page = app ? await app.firstWindow().catch(() => null) : null;
 await page?.screenshot({path: join(root, 'outputs/layout-failure.png')}).catch(() => {});
 await game?.screenshot({path: join(root, 'outputs/layout-game-failure.png')}).catch(() => {});
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
