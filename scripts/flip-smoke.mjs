// Flip and skew: Skew X in Properties shears the object on the GPU, Edit → Flip Horizontally/Vertically mirror the
// selection on screen around its centre (rotated objects and children of turned parents too) in one undo step, zero
// scale is refused, and the saved file and the exported game draw the same mirrored, skewed pixels.
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
const temp = await mkdtemp(join(tmpdir(), 'rewrite-flip-'));
const env = {...process.env};
delete env.ELECTRON_RUN_AS_NODE;
const shape = (id, name, x, y, width, height, color, extra = {}, parentId = null) => ({id, name, parentId, active: true, components: [
 {id: `${id}-t`, type: 'scene.transform2d', version: 1, data: {x, y, rotation: 0, scaleX: 1, scaleY: 1, ...extra}},
 {id: `${id}-s`, type: 'pixi.shape', version: 1, data: {width, height, color, rounded: 0, alpha: 1}},
]});
const entities = [
 shape('a', 'Alpha', 200, 150, 120, 40, '#e14c4c'), shape('b', 'Beta', 400, 250, 80, 80, '#3fa36b', {rotation: 30}),
 shape('k', 'Kite', 700, 270, 100, 100, '#2f6fe0'),
 shape('p', 'Parent', 250, 420, 30, 30, '#d9a441', {rotation: 90}), shape('c', 'Child', 40, 0, 60, 20, '#d9d941', {}, 'p'),
 {...shape('f', 'Flag', 880, 480, 40, 30, '#e07a3f'), components: [...shape('f', 'Flag', 880, 480, 40, 30, '#e07a3f').components, {id: 'f-tw', type: 'tween.player', version: 1, data: {duration: .3, delay: 0, ease: 'linear', repeat: 0, yoyo: false, autoplay: true, tracks: [{id: 'f-k0', entityId: 'f', componentId: 'f-t', property: 'skewX', from: 0, to: 30}, {id: 'f-k1', entityId: 'f', componentId: 'f-t', property: 'scaleX', from: 1, to: -1}]}}]},
];
const project = {formatVersion: 1, name: 'Flip', entrySceneId: 'scene', scenes: [{formatVersion: 1, id: 'scene', name: 'Flip', entities}], modules: {}, providers: {render: 'pixi'}, extensions: {}};
const file = join(temp, 'Flip.pixieditor');
let app, browser, server;
const blue = async (page, p) => { const {data} = await sharp(await page.screenshot({clip: {x: Math.round(p.x), y: Math.round(p.y), width: 1, height: 1}})).raw().toBuffer({resolveWithObject: true}); return data[2] > 180 && data[0] < 120; };
try {
 await writeFile(file, JSON.stringify(project));
 app = await electron.launch({executablePath: process.env.REWRITE_EXECUTABLE || require('electron'), args: [...(process.env.REWRITE_EXECUTABLE ? [] : [join(root, 'apps/editor-desktop/out/main/index.js')]), '--no-hub', `--user-data-dir=${join(temp, 'user')}`], env});
 const page = await app.firstWindow();
 page.setDefaultTimeout(15000);
 const errors = [];
 page.on('pageerror', e => errors.push(e.message));
 const canvas = page.getByTestId('pixi-canvas');
 await expect(canvas).toHaveAttribute('data-ready', 'true', {timeout: 30000});
 const menu = label => app.evaluate(({Menu}, text) => Menu.getApplicationMenu().items.flatMap(m => m.submenu?.items ?? []).find(i => i.label === text).click(), label);
 const choose = path => app.evaluate(({dialog}, target) => { dialog.showOpenDialog = async () => ({canceled: false, filePaths: [target]}); dialog.showSaveDialog = async () => ({canceled: false, filePath: target}); dialog.showMessageBox = async () => ({response: 1, checkboxChecked: false}); }, path);
 await choose(file); await menu('Open…');
 await expect.poll(async () => Object.keys(JSON.parse(await canvas.getAttribute('data-transforms') ?? '{}')).length).toBe(6);
 await page.getByRole('button', {name: 'Layers', exact: true}).click(); await page.getByRole('button', {name: 'Pin Layers', exact: true}).click();
 await page.getByRole('button', {name: 'Properties', exact: true}).click(); await page.getByRole('button', {name: 'Pin Properties', exact: true}).click();
 const poses = async () => JSON.parse(await canvas.getAttribute('data-transforms'));
 const row = name => page.getByRole('button', {name: `Select ${name}`, exact: true});
 const field = key => page.getByLabel(key, {exact: true}).first();
 const view = async () => { const b = await canvas.locator('canvas').boundingBox(), s = Math.min((b.width - 80) / 960, (b.height - 90) / 540); return (x, y) => ({x: b.x + (b.width - 960 * s) / 2 + x * s, y: b.y + (b.height - 540 * s) / 2 + y * s}); };
 const close = (a, b) => Math.abs(a - b) < 1e-3;

 // Skew X 30°: the lower half leans right, the upper half left (Pixi's skew model).
 await row('Kite').click();
 await expect(field('skewX')).toHaveValue('0');
 await field('skewX').fill('30'); await field('skewX').press('Enter');
 await expect.poll(async () => (await poses()).k.skewX ?? 0).toBeCloseTo(30, 6);
 let at = await view();
 await expect.poll(() => blue(page, at(765, 305))).toBe(true);
 expect(await blue(page, at(765, 235))).toBe(false);
 expect(await blue(page, at(635, 235))).toBe(true);
 console.log('PASS Skew X in Properties shears the object on the GPU (lower half right, upper half left)');

 await menu('Flip Horizontally');
 await expect.poll(async () => { const k = (await poses()).k; return [k.x, k.scaleX, Math.round(k.skewX)]; }).toEqual([700, -1, -30]);
 at = await view();
 await expect.poll(() => blue(page, at(635, 305))).toBe(true);
 expect(await blue(page, at(765, 305))).toBe(false);
 await menu('Undo');
 await expect.poll(async () => (await poses()).k.scaleX).toBe(1);
 await field('scaleX').fill('0'); await field('scaleX').press('Enter');
 await expect(page.getByText(/Scale cannot be 0/).first()).toBeVisible();
 expect((await poses()).k.scaleX).toBe(1);
 await page.keyboard.press('Escape');
 console.log('PASS Flip Horizontally mirrors on screen (skew mirrored too), one Undo; zero scale is refused');

 // Two objects flip vertically around their shared centre; the rotated one keeps its angle mirrored.
 await row('Alpha').click(); await row('Beta').click({modifiers: ['Meta']});
 const before = await poses();
 await menu('Flip Vertically');
 await expect.poll(async () => (await poses()).a.scaleY).toBe(-1);
 const after = await poses();
 expect(close(after.a.y + before.a.y, after.b.y + before.b.y)).toBe(true);
 expect(after.a.y).toBeGreaterThan(before.a.y); expect(after.b.y).toBeLessThan(before.b.y);
 expect([after.a.x, after.a.scaleX, after.b.x, Math.round(after.b.rotation), after.b.scaleY]).toEqual([before.a.x, 1, before.b.x, -30, -1]);
 await menu('Undo');
 await expect.poll(async () => { const p = await poses(); return [p.a.y, p.a.scaleY, p.b.y, Math.round(p.b.rotation), p.b.scaleY]; }).toEqual([before.a.y, 1, before.b.y, 30, 1]);
 console.log('PASS Flip Vertically mirrors a multi-selection around its centre; one Undo restores both');

 // A child of a parent turned 90°: flipping it horizontally on screen is a vertical flip in its own space.
 await row('Child').click();
 await menu('Flip Horizontally');
 await expect.poll(async () => { const c = (await poses()).c; return [Math.round(c.rotation) || 0, c.scaleX, c.scaleY]; }).toEqual([0, 1, -1]);
 console.log('PASS flipping a child of a rotated parent mirrors it on screen');

 // A tween animates skew and flips the scale through 0 (never written as 0); Stop restores the authored pose.
 await page.getByRole('button', {name: 'Play', exact: true}).click();
 await expect.poll(async () => { const f = (await poses()).f; return [Math.round(f.skewX ?? 0), Math.round(f.scaleX * 100) / 100]; }, {timeout: 10000}).toEqual([30, -1]);
 await page.getByRole('button', {name: 'Stop', exact: true}).click();
 await expect.poll(async () => { const f = (await poses()).f; return [f.skewX ?? 0, f.scaleX]; }).toEqual([0, 1]);
 console.log('PASS a tween animates Skew X and flips Scale X through zero in Preview');

 await row('Kite').click(); await menu('Flip Horizontally');
 await expect.poll(async () => (await poses()).k.scaleX).toBe(-1);
 await choose(file); await menu('Save');
 await expect(page.getByLabel('Unsaved changes', {exact: true})).toHaveCount(0);
 const saved = JSON.parse(await readFile(file, 'utf8')).scenes[0].entities, kite = saved.find(e => e.id === 'k').components[0].data;
 expect([kite.scaleX, Math.round(kite.skewX), kite.skewY ?? 0]).toEqual([-1, -30, 0]);
 expect(saved.find(e => e.id === 'a').components[0].data).toEqual({x: 200, y: 150, rotation: 0, scaleX: 1, scaleY: 1});

 const exportDir = join(temp, 'export'); await mkdir(exportDir);
 await page.getByRole('button', {name: 'Export', exact: true}).click();
 await choose(exportDir);
 await page.getByRole('button', {name: 'Export HTML…', exact: true}).click();
 await expect(page.getByTestId('build-status')).toHaveAttribute('data-phase', 'complete', {timeout: 30000});
 const output = await page.getByTestId('build-output').innerText();
 server = createServer(async (req, res) => { try { const path = resolve(output, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/$/, '/index.html')); if (!path.startsWith(resolve(output) + sep)) throw Error('outside'); res.setHeader('Content-Type', {'.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json'}[extname(path)] ?? 'application/octet-stream'); res.end(await readFile(path)); } catch { res.statusCode = 404; res.end(); } });
 await new Promise(r => server.listen(0, '127.0.0.1', r));
 browser = await chromium.launch({channel: 'chrome', headless: true, args: ['--enable-unsafe-swiftshader']});
 const game = await browser.newPage({viewport: {width: 960, height: 540}});
 const gameErrors = []; game.on('pageerror', e => gameErrors.push(e.message));
 await game.goto(`http://127.0.0.1:${server.address().port}`);
 await game.getByRole('button', {name: 'Start', exact: true}).click({timeout: 30000});
 await expect.poll(async () => JSON.parse(await game.locator('#game').getAttribute('data-poses') ?? '{}').k?.scaleX).toBe(-1);
 const box = await game.locator('#game canvas').boundingBox(), g = (x, y) => ({x: box.x + x * box.width / 960, y: box.y + y * box.height / 540});
 await expect.poll(() => blue(game, g(635, 305))).toBe(true);
 expect(await blue(game, g(765, 305))).toBe(false);
 expect(await blue(game, g(765, 235))).toBe(true);
 await expect.poll(async () => { const f = JSON.parse(await game.locator('#game').getAttribute('data-poses')).f; return [Math.round(f.skewX ?? 0), Math.round(f.scaleX * 100) / 100]; }, {timeout: 10000}).toEqual([30, -1]);
 expect(gameErrors).toEqual([]);
 expect(errors).toEqual([]);
 await mkdir(join(root, 'outputs'), {recursive: true});
 await page.screenshot({path: join(root, 'outputs/editor-flip.png')});
 console.log('PASS saved file keeps flip and skew (untouched objects unchanged); the exported game draws the same pixels');
} catch (error) {
 await mkdir(join(root, 'outputs'), {recursive: true});
 const page = app ? await app.firstWindow().catch(() => null) : null;
 await page?.screenshot({path: join(root, 'outputs/flip-failure.png')}).catch(() => {});
 throw error;
} finally {
 await browser?.close().catch(() => {});
 if (server) await new Promise(r => server.close(r));
 if (app) { await app.evaluate(({BrowserWindow}) => { for (const w of BrowserWindow.getAllWindows()) w.destroy(); }).catch(() => {}); await app.close().catch(() => {}); }
 await rm(temp, {recursive: true, force: true, maxRetries: 3});
}
