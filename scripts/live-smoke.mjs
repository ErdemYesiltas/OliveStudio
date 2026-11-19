// Timeline and Scripts: New from template (every template compiles), live script edits while the game runs (running
// objects switch to the new code and keep their state), and Timeline Record keys (canvas drags become keys at the
// playhead; the object keeps its authored transform; one undo step).
import {_electron as electron, expect} from '@playwright/test';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(join(root, 'apps/editor-desktop/package.json'));
const temp = await mkdtemp(join(tmpdir(), 'rewrite-live-'));
const env = {...process.env};
delete env.ELECTRON_RUN_AS_NODE;
const shape = (id, name, x, y, color, extra = []) => ({id, name, parentId: null, active: true, components: [
 {id: `${id}-t`, type: 'scene.transform2d', version: 1, data: {x, y, rotation: 0, scaleX: 1, scaleY: 1}},
 {id: `${id}-s`, type: 'pixi.shape', version: 1, data: {width: 60, height: 60, color, rounded: 0, alpha: 1}}, ...extra]});
const mover = 'export function update(self: GameObject, dt: number) {\n  self.state.t = (self.state.t ?? 0) + dt;\n  self.x = 100 + self.state.t * 10;\n}\n';
const moverCode = '"use strict";Object.defineProperty(exports, "__esModule", {value: true}); function update(self, dt) {\n  self.state.t = (self.state.t ?? 0) + dt;\n  self.x = 100 + self.state.t * 10;\n} exports.update = update;';
const spin = {id: 'spin', entityId: 'ball', componentId: 'ball-t', property: 'rotation', keys: [{id: 'r0', time: 0, value: 0, ease: 'linear'}, {id: 'r1', time: 2, value: 0, ease: 'linear'}]};
const player = {id: 'ball-anim', type: 'animation.player', version: 1, data: {activeClipId: 'move', autoplay: false, clips: [{id: 'move', name: 'Move', duration: 2, repeat: 0, yoyo: false, tracks: [spin], markers: [], clips: []}]}};
const project = {formatVersion: 1, name: 'Live', entrySceneId: 's', modules: {}, providers: {render: 'pixi'}, scenes: [{formatVersion: 1, id: 's', name: 'Live', entities: [
 shape('hero', 'Hero', 100, 120, '#e14c4c', [{id: 'hero-js', type: 'scripts.behaviour', version: 1, data: {scriptId: 's1', params: {}, refs: {}}}]),
 shape('ball', 'Ball', 200, 380, '#3f7be0', [player]),
]}], extensions: {'scripts.library': {version: 1, items: [{id: 's1', name: 'Mover', source: mover, code: moverCode}]}}};
const file = join(temp, 'Live.pixieditor');
let app;
try {
 await writeFile(file, JSON.stringify(project));
 app = await electron.launch({executablePath: process.env.REWRITE_EXECUTABLE || require('electron'), args: [...(process.env.REWRITE_EXECUTABLE ? [] : [join(root, 'apps/editor-desktop/out/main/index.js')]), '--no-hub', `--user-data-dir=${join(temp, 'user')}`], env});
 const page = await app.firstWindow();
 page.setDefaultTimeout(20000);
 const errors = [];
 page.on('pageerror', e => errors.push(e.message));
 const canvas = page.getByTestId('pixi-canvas');
 await expect(canvas).toHaveAttribute('data-ready', 'true', {timeout: 30000});
 const menu = label => app.evaluate(({Menu}, text) => Menu.getApplicationMenu().items.flatMap(m => m.submenu?.items ?? []).find(i => i.label === text).click(), label);
 const choose = path => app.evaluate(({dialog}, target) => { dialog.showOpenDialog = async () => ({canceled: false, filePaths: [target]}); dialog.showSaveDialog = async () => ({canceled: false, filePath: target}); dialog.showMessageBox = async () => ({response: 1, checkboxChecked: false}); }, path);
 await choose(file); await menu('Open…');
 await expect.poll(async () => Object.keys(JSON.parse(await canvas.getAttribute('data-transforms') ?? '{}')).length).toBe(2);
 const poses = async () => JSON.parse(await canvas.getAttribute('data-transforms'));
 const save = async () => { await choose(file); await menu('Save'); await expect(page.getByLabel('Unsaved changes', {exact: true})).toHaveCount(0); return JSON.parse(await readFile(file, 'utf8')); };

 // Templates: every one compiles in the editor; picking one creates and opens a new script.
 await page.keyboard.press('Alt+KeyC');
 const panel = page.getByTestId('scripts-panel'), status = panel.getByTestId('script-status'), picker = panel.getByRole('combobox', {name: 'New from template…', exact: true});
 const titles = (await picker.locator('option').allInnerTexts()).slice(1);
 expect(titles).toEqual(['Starter (moves back and forth)', 'Top-down mover (input actions)', 'Platformer (physics, jump)', 'Follow the pointer', 'Hover and spin', 'Click counter (global)', 'Spawner (every few seconds)']);
 for (const title of titles) {
  await picker.selectOption({label: title});
  await expect(status).toHaveText('Ready · runs in Preview and exported games');
 }
 const library = (await save()).extensions['scripts.library'].items;
 expect(library.map(s => s.name)).toEqual(['Mover', 'Script', 'TopDownMover', 'PlatformerController', 'FollowPointer', 'HoverSpin', 'ClickCounter', 'Spawner']);
 expect(library.every(s => s.code && !s.error)).toBe(true);
 console.log('PASS New from template: seven templates, each compiles and opens as a new script');

 // Live edit: while playing, the Mover's speed changes from 10 to 400 px/s; its state (elapsed time) is kept.
 await panel.getByRole('combobox', {name: 'Script', exact: true}).selectOption({label: 'Mover'});
 const editor = panel.getByTestId('script-editor');
 await expect(editor.locator('.view-lines')).toContainText('self.state.t * 10');
 await page.getByRole('button', {name: 'Play', exact: true}).click();
 await expect.poll(async () => (await poses()).hero.x, {timeout: 10000}).toBeGreaterThan(105);
 // Play closed the panel (a popover): open it again; the source stays editable while playing.
 if (!await panel.isVisible()) await page.keyboard.press('Alt+KeyC');
 await expect(editor.locator('.view-lines')).toContainText('self.state.t * 10');
 await app.evaluate(({clipboard}, text) => clipboard.writeText(text), mover.replace('* 10', '* 400'));
 await editor.locator('.view-lines').click(); await page.keyboard.press('Meta+KeyA'); await page.keyboard.press('Meta+KeyV');
 await expect.poll(async () => (await poses()).hero.x, {timeout: 10000}).toBeGreaterThan(400);
 const x1 = (await poses()).hero.x; await page.waitForTimeout(300);
 expect((await poses()).hero.x - x1).toBeGreaterThan(60);
 if (!await panel.isVisible()) await page.keyboard.press('Alt+KeyC');
 await expect(page.getByTestId('script-console')).toContainText('Updated while playing: Mover');
 await page.getByRole('button', {name: 'Stop', exact: true}).click();
 await expect.poll(async () => (await poses()).hero.x).toBe(100);
 console.log('PASS live script edit while playing: running objects switch to the new code and keep their state');

 // Record keys: playhead at 1 s, drag the ball; the clip gets an x track 200 → 500, the ball itself stays at 200.
 await page.keyboard.press('Escape');
 const view = async () => { const b = await canvas.locator('canvas').boundingBox(), s = Math.min((b.width - 80) / 960, (b.height - 90) / 540); return (x, y) => ({x: b.x + (b.width - 960 * s) / 2 + x * s, y: b.y + (b.height - 540 * s) / 2 + y * s}); };
 let at = await view();
 let p = at(200, 380); await page.mouse.click(p.x, p.y);
 await expect.poll(async () => JSON.parse(await canvas.getAttribute('data-selection'))).toEqual(['ball']);
 await page.keyboard.press('Alt+KeyT');
 const timeline = page.getByTestId('animation-timeline');
 await page.getByRole('button', {name: 'Pin Timeline', exact: true}).click();
 await timeline.getByRole('slider', {name: 'Clip time', exact: true}).fill('1');
 await timeline.getByRole('button', {name: /Record keys$/}).click();
 await expect(timeline).toHaveAttribute('data-recording', 'true');
 at = await view(); // the pinned Timeline made the canvas smaller
 const from = at(200, 380), to = at(500, 380);
 await page.mouse.move(from.x, from.y); await page.keyboard.down('Alt'); await page.mouse.down();
 for (let i = 1; i <= 8; i++) await page.mouse.move(from.x + (to.x - from.x) * i / 8, from.y);
 await page.mouse.up(); await page.keyboard.up('Alt');
 await expect(timeline).toHaveAttribute('data-preview-time', '1');
 await expect.poll(async () => Math.round((await poses()).ball.x)).toBe(500);
 let saved = await save(), ball = saved.scenes[0].entities.find(e => e.id === 'ball');
 expect(ball.components[0].data.x).toBe(200);
 const track = ball.components.find(c => c.type === 'animation.player').data.clips[0].tracks.find(t => t.property === 'x');
 expect(track.keys.map(k => [k.time, Math.round(k.value)])).toEqual([[0, 200], [1, 500]]);
 await menu('Undo');
 saved = await save();
 expect(saved.scenes[0].entities.find(e => e.id === 'ball').components.find(c => c.type === 'animation.player').data.clips[0].tracks).toEqual([spin]);
 expect(errors).toEqual([]);
 await mkdir(join(root, 'outputs'), {recursive: true});
 await page.screenshot({path: join(root, 'outputs/editor-live.png')});
 console.log('PASS Record keys: a canvas drag at 1 s becomes an x track 0 → 200, 1 → 500; the object stays authored; one Undo');
} catch (error) {
 await mkdir(join(root, 'outputs'), {recursive: true});
 const page = app ? await app.firstWindow().catch(() => null) : null;
 await page?.screenshot({path: join(root, 'outputs/live-failure.png')}).catch(() => {});
 throw error;
} finally {
 if (app) { await app.evaluate(({BrowserWindow}) => { for (const w of BrowserWindow.getAllWindows()) w.destroy(); }).catch(() => {}); await app.close().catch(() => {}); }
 await rm(temp, {recursive: true, force: true, maxRetries: 3});
}
