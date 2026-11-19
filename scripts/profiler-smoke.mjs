// Profiler: during Preview the panel records one sample per frame, splits it by system (scripts, physics, drawing),
// shows rate / slow frames / draw calls, inspects a single frame, pauses, copies CSV and clears.
import {_electron as electron, expect} from '@playwright/test';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(join(root, 'apps/editor-desktop/package.json'));
const {transform} = createRequire(join(root, 'modules/scripts/package.json'))('sucrase');
const compile = source => transform(source, {transforms: ['typescript', 'imports'], production: true, disableESTransforms: true}).code;
const temp = await mkdtemp(join(tmpdir(), 'rewrite-profiler-'));
const env = {...process.env};
delete env.ELECTRON_RUN_AS_NODE;
let app;
const busyScript = `export function update(self: GameObject, dt: number) {
  let x = 0; for (let i = 0; i < 20000; i++) x += Math.sqrt(i);
  self.state.x = x;
}`;
try {
 const file = join(temp, 'profiler.pixieditor');
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
 const shape = (id, color) => ({id: `${id}-s`, type: 'pixi.shape', version: 1, data: {alpha: 1, kind: 'rect', width: 60, height: 60, color, rounded: 0, sides: 5, innerRadius: .5, strokeColor: '#ffffff', strokeWidth: 0}});
 const body = id => ({id: `${id}-rb`, type: 'physics.rigidBody2d', version: 1, data: {bodyType: 'dynamic', density: .001, friction: .4, restitution: 0, airFriction: .01, lockRotation: false, velocityX: 0, velocityY: 0, angularVelocity: 0, frictionStatic: .8, gravityScale: 0, mass: 0, layer: 0, mask: 65535, group: 0, draggable: false, bullet: false}});
 project.scenes[0].entities = [
  {id: 'busy', name: 'Busy', parentId: null, active: true, components: [t('busy', 200, 200), shape('busy', '#f2b84b'), {id: 'busy-b', type: 'scripts.behaviour', version: 1, data: {scriptId: 's-busy', params: {}, refs: {}}}]},
  {id: 'box', name: 'Box', parentId: null, active: true, components: [t('box', 400, 200), shape('box', '#5bc0eb'), body('box'), {id: 'box-c', type: 'physics.boxCollider2d', version: 1, data: {width: 60, height: 60, offsetX: 0, offsetY: 0, sensor: false}}]},
 ];
 project.extensions['scripts.library'] = {version: 1, items: [{id: 's-busy', name: 'Busy', source: busyScript, code: compile(busyScript)}]};
 await writeFile(file, JSON.stringify(project));
 await choose(file); await menu('Open…');
 await expect.poll(async () => Object.keys(JSON.parse(await canvas.getAttribute('data-transforms') ?? '{}'))).toContain('box');

 await page.keyboard.press('Alt+KeyO');
 const panel = page.getByTestId('profiler');
 await expect(panel).toBeVisible();
 await expect(panel.getByTestId('profiler-empty')).toBeVisible();
 await page.keyboard.press('Escape');
 await page.getByRole('button', {name: 'Play', exact: true}).click();
 await page.keyboard.press('Alt+KeyO');
 await expect.poll(async () => Number(await panel.getAttribute('data-frames')), {timeout: 20000}).toBeGreaterThan(60);
 await expect(panel.locator('tr[data-system="scripts"]')).toBeVisible();
 await expect(panel.locator('tr[data-system="physics"]')).toBeVisible();
 await expect(panel.locator('tr[data-system="render"]')).toBeVisible();
 await expect(panel.getByTestId('profiler-Frame rate')).toHaveText(/^[1-9]\d*$/);
 await expect.poll(async () => Number(await panel.getByTestId('profiler-Draw calls').textContent())).toBeGreaterThan(0);
 if (process.env.SHOT) await page.screenshot({path: process.env.SHOT});
 console.log('PASS Preview fills the profiler: frame rate, draw calls and scripts / physics / drawing rows');

 await panel.getByRole('button', {name: 'Pause capture'}).click();
 await page.waitForTimeout(400);
 const frozen = await panel.getAttribute('data-frames');
 await page.waitForTimeout(500);
 await expect(panel).toHaveAttribute('data-frames', frozen);
 const chart = panel.getByTestId('profiler-chart'), box = await chart.boundingBox();
 await chart.click({position: {x: box.width - 3, y: box.height / 2}});
 await expect(panel.getByText('Selected frame', {exact: false})).toBeVisible();
 await expect(panel.getByTestId('profiler-Frame time')).toHaveText(/ms$/);
 await chart.click({position: {x: box.width - 3, y: box.height / 2}});
 await expect(panel.getByTestId('profiler-Frame rate')).toBeVisible();
 console.log('PASS pausing freezes the capture; clicking a bar inspects that frame and clicking again returns');

 await panel.getByRole('button', {name: 'Copy as CSV'}).click();
 await expect(panel.getByRole('button', {name: 'Copied'})).toBeVisible();
 const csv = await app.evaluate(({clipboard}) => clipboard.readText());
 const [head, ...rows] = csv.trim().split('\n');
 expect(head).toContain('scripts_ms'); expect(head).toContain('physics_ms'); expect(rows.length).toBe(Number(frozen));
 await panel.getByRole('button', {name: 'Clear'}).click();
 await expect(panel).toHaveAttribute('data-frames', '0');
 await panel.getByRole('button', {name: 'Resume capture'}).click();
 await expect.poll(async () => Number(await panel.getAttribute('data-frames'))).toBeGreaterThan(5);
 await page.keyboard.press('Escape');
 await page.getByRole('button', {name: 'Stop', exact: true}).click();
 await page.keyboard.press('Alt+KeyO');
 const after = await panel.getAttribute('data-frames');
 await page.waitForTimeout(400);
 await expect(panel).toHaveAttribute('data-frames', after);
 expect(errors).toEqual([]);
 console.log('PASS CSV copy has a row per frame and a column per system; Clear empties; Stop ends recording');
} catch (error) {
 await mkdir(join(root, 'outputs'), {recursive: true});
 const page = app ? await app.firstWindow().catch(() => null) : null;
 await page?.screenshot({path: join(root, 'outputs/profiler-failure.png')}).catch(() => {});
 throw error;
} finally {
 if (app) { await app.evaluate(({BrowserWindow}) => { for (const w of BrowserWindow.getAllWindows()) w.destroy(); }).catch(() => {}); await app.close().catch(() => {}); }
 await rm(temp, {recursive: true, force: true, maxRetries: 3});
}
