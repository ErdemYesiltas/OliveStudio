// Canvas: badges for objects without a visual (role glyph + name, constant size, click to select), rulers with the
// selection's extent (toggle), live numbers while dragging (a skewed object keeps its skew), and Scene view in
// Preview (free look, the game camera's frame drawn, mask back when it is turned off; edit mode turns it off).
import {_electron as electron, expect} from '@playwright/test';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(join(root, 'apps/editor-desktop/package.json'));
const sharp = require('sharp');
const temp = await mkdtemp(join(tmpdir(), 'rewrite-canvas-'));
const env = {...process.env};
delete env.ELECTRON_RUN_AS_NODE;
const entity = (id, name, x, y, extra = [], transform = {}) => ({id, name, parentId: null, active: true, components: [{id: `${id}-t`, type: 'scene.transform2d', version: 1, data: {x, y, rotation: 0, scaleX: 1, scaleY: 1, ...transform}}, ...extra]});
const camera = {zoom: 2, rotate: false, target: '', offsetX: 0, offsetY: 0, smoothing: 0, deadzoneWidth: 0, deadzoneHeight: 0, limit: false, limitLeft: 0, limitTop: 0, limitRight: 1920, limitBottom: 1080};
const entities = [
 entity('box', 'Box', 300, 300, [{id: 'box-s', type: 'pixi.shape', version: 1, data: {width: 100, height: 60, color: '#2f6fe0', rounded: 0, alpha: 1}}], {skewX: 20}),
 entity('brain', 'Brain', 800, 120, [{id: 'brain-b', type: 'interactions.bindings', version: 1, data: {rules: []}}]),
 entity('clock', 'Clock', 800, 420, [{id: 'clock-timer', type: 'interactions.timer', version: 1, data: {seconds: 1, repeat: false, autostart: false}}]),
 entity('empty', 'Empty', 150, 120),
 entity('cam', 'Camera', 700, 270, [{id: 'cam-c', type: 'pixi.camera2d', version: 1, data: camera}]),
];
const project = {formatVersion: 1, name: 'Canvas', entrySceneId: 'scene', scenes: [{formatVersion: 1, id: 'scene', name: 'Canvas', entities}], modules: {}, providers: {render: 'pixi'}, extensions: {}};
const file = join(temp, 'Canvas.pixieditor');
let app;
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
 await expect.poll(async () => Object.keys(JSON.parse(await canvas.getAttribute('data-transforms') ?? '{}')).length).toBe(5);
 const data = async key => JSON.parse(await canvas.getAttribute(`data-${key}`) ?? 'null');
 const view = async () => { const b = await canvas.locator('canvas').boundingBox(), s = Math.min((b.width - 80) / 960, (b.height - 90) / 540); return (x, y) => ({x: b.x + (b.width - 960 * s) / 2 + x * s, y: b.y + (b.height - 540 * s) / 2 + y * s}); };

 await expect.poll(() => data('markers')).toEqual({brain: '⚙', clock: '◷', empty: '◇', cam: '◉'});
 let at = await view();
 for (const [id, x, y] of [['brain', 800, 120], ['clock', 800, 420]]) { const p = at(x, y); await page.mouse.click(p.x, p.y); await expect.poll(() => data('selection')).toEqual([id]); }
 console.log('PASS objects without a visual show role badges (rules, timer, plain, camera) and select by click');

 await expect(canvas).toHaveAttribute('data-rulers', 'true');
 const rulers = page.getByRole('button', {name: 'Show rulers', exact: true});
 await expect(rulers).toHaveAttribute('aria-pressed', 'true');
 await rulers.click(); await expect(canvas).toHaveAttribute('data-rulers', 'false');
 await rulers.click(); await expect(canvas).toHaveAttribute('data-rulers', 'true');
 console.log('PASS rulers are on by default and toggle from the canvas bar');

 at = await view();
 const from = at(300, 300), to = at(360, 280);
 // Alt: no smart-guide snapping, so the numbers are exact.
 await page.mouse.move(from.x, from.y); await page.keyboard.down('Alt'); await page.mouse.down();
 for (let i = 1; i <= 6; i++) await page.mouse.move(from.x + (to.x - from.x) * i / 6, from.y + (to.y - from.y) * i / 6);
 await expect(canvas).toHaveAttribute('data-readout', /^Δx 60 {2}Δy -20 {2}· {2}360, 280$/);
 await page.mouse.up(); await page.keyboard.up('Alt');
 await expect(canvas).not.toHaveAttribute('data-readout', /./);
 await expect.poll(async () => Math.round((await data('transforms')).box.x * 1000) / 1000).toBe(360);
 await choose(file); await menu('Save');
 await expect(page.getByLabel('Unsaved changes', {exact: true})).toHaveCount(0);
 const box = JSON.parse(await readFile(file, 'utf8')).scenes[0].entities.find(e => e.id === 'box').components[0].data;
 expect({...box, x: Math.round(box.x * 1000) / 1000, y: Math.round(box.y * 1000) / 1000}).toEqual({x: 360, y: 280, rotation: 0, scaleX: 1, scaleY: 1, skewX: 20});
 console.log('PASS dragging shows Δx/Δy and the position next to the pointer; the skewed object keeps its skew');

 const sceneView = page.getByRole('button', {name: /^Scene view/});
 await expect(sceneView).toBeDisabled();
 await page.getByRole('button', {name: 'Play', exact: true}).click();
 await expect(canvas).toHaveAttribute('data-stage-mask', 'true');
 await expect(canvas).toHaveAttribute('data-rulers', 'false');
 await sceneView.click();
 await expect(canvas).toHaveAttribute('data-scene-view', 'true');
 await expect(canvas).not.toHaveAttribute('data-stage-mask', /./);
 await expect.poll(() => data('camera-frame')).toEqual([[460, 135], [940, 135], [940, 405], [460, 405]]);
 await expect(canvas).toHaveAttribute('data-rulers', 'true');
 await sceneView.click();
 await expect(canvas).toHaveAttribute('data-stage-mask', 'true');
 await expect(canvas).not.toHaveAttribute('data-camera-frame', /./);
 await sceneView.click(); await expect(canvas).toHaveAttribute('data-scene-view', 'true');
 await page.getByRole('button', {name: 'Stop', exact: true}).click();
 await expect(canvas).toHaveAttribute('data-scene-view', 'false');
 await expect(sceneView).toBeDisabled();
 await expect(canvas).not.toHaveAttribute('data-stage-mask', /./);
 // Pivot: top left of the box's own visual; the box stays where it is on screen (same pixels blue).
 const blue = async p => { const {data} = await sharp(await page.screenshot({clip: {x: Math.round(p.x), y: Math.round(p.y), width: 1, height: 1}})).raw().toBuffer({resolveWithObject: true}); return data[2] > 180 && data[0] < 120; };
 await page.getByRole('button', {name: 'Properties', exact: true}).click(); await page.getByRole('button', {name: 'Pin Properties', exact: true}).click();
 at = await view(); const p = at(360, 280);
 await page.mouse.click(p.x, p.y);
 await expect.poll(() => data('selection')).toEqual(['box']);
 at = await view();
 // Two points inside the skewed box away from the gizmo arms, one outside it.
 const probes = [at(335, 272), at(345, 296), at(300, 300)];
 const before = await Promise.all(probes.map(blue));
 expect(before).toEqual([true, true, false]);
 await page.getByRole('button', {name: 'Pivot top left', exact: true}).click();
 await expect.poll(async () => { const b = (await data('transforms')).box; return [b.pivotX, b.pivotY]; }).toEqual([-50, -30]);
 await expect(page.getByRole('button', {name: 'Pivot top left', exact: true})).toHaveAttribute('aria-current', 'true');
 expect(await Promise.all(probes.map(blue))).toEqual(before);
 await menu('Undo');
 await expect.poll(async () => (await data('transforms')).box.pivotX ?? 0).toBe(0);
 console.log('PASS Pivot presets move the pivot to a corner of the visual without moving it on screen; one Undo');

 // Device preview: a portrait phone sees the whole 960-wide stage with letterbox above and below (fit).
 await page.getByRole('combobox', {name: 'Device preview', exact: true}).selectOption({label: 'Phone · portrait'});
 await expect.poll(() => data('device-frame')).toEqual([0, -771, 960, 2081]);
 await page.getByRole('combobox', {name: 'Device preview', exact: true}).selectOption({label: 'Desktop · 1920 × 1080'});
 await expect.poll(() => data('device-frame')).toEqual([0, 0, 960, 540]);
 await page.getByRole('button', {name: 'Play', exact: true}).click();
 await expect(canvas).not.toHaveAttribute('data-device-frame', /./);
 await page.getByRole('button', {name: 'Stop', exact: true}).click();
 await expect.poll(() => data('device-frame')).toEqual([0, 0, 960, 540]);
 console.log('PASS Device preview outlines what a screen shows of the stage (letterbox for a portrait phone); hidden while playing');
 expect(errors).toEqual([]);
 await mkdir(join(root, 'outputs'), {recursive: true});
 await page.screenshot({path: join(root, 'outputs/editor-canvas.png')});
 console.log('PASS Scene view in Preview: unmasked free look with the camera frame (460,135)–(940,405); off restores the mask; Stop ends it');
} catch (error) {
 await mkdir(join(root, 'outputs'), {recursive: true});
 const page = app ? await app.firstWindow().catch(() => null) : null;
 await page?.screenshot({path: join(root, 'outputs/canvas-failure.png')}).catch(() => {});
 throw error;
} finally {
 if (app) { await app.evaluate(({BrowserWindow}) => { for (const w of BrowserWindow.getAllWindows()) w.destroy(); }).catch(() => {}); await app.close().catch(() => {}); }
 await rm(temp, {recursive: true, force: true, maxRetries: 3});
}
