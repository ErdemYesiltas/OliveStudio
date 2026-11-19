// Library, Scenes, Prefabs: the Scenes panel draws the scene flow (a rule and a script that change scene), opens a
// scene from the diagram and shows scene previews; the Library slices an image as a sprite sheet (guessed grid,
// frame size) and creates an animated sprite; the Prefabs panel counts instances and selects them.
import {_electron as electron, expect} from '@playwright/test';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(join(root, 'apps/editor-desktop/package.json'));
const sharp = require('sharp');
const temp = await mkdtemp(join(tmpdir(), 'rewrite-flow-'));
const env = {...process.env};
delete env.ELECTRON_RUN_AS_NODE;
const shape = (id, name, x, y, color, extra = []) => ({id, name, parentId: null, active: true, components: [
 {id: `${id}-t`, type: 'scene.transform2d', version: 1, data: {x, y, rotation: 0, scaleX: 1, scaleY: 1}},
 {id: `${id}-s`, type: 'pixi.shape', version: 1, data: {width: 80, height: 50, color, rounded: 0, alpha: 1}}, ...extra]});
const scene = (id, name, entities) => ({formatVersion: 1, id, name, entities});
const source = "export function onClick(self: GameObject) {\n  game.changeScene('Win');\n}\n";
const code = '"use strict";Object.defineProperty(exports, "__esModule", {value: true}); function onClick(self) {\n  game.changeScene(\'Win\');\n} exports.onClick = onClick;';
const project = {formatVersion: 1, name: 'Flow', entrySceneId: 'menu', modules: {}, providers: {render: 'pixi'}, scenes: [
 scene('menu', 'Menu', [shape('play', 'Play', 300, 270, '#3f7be0', [{id: 'play-b', type: 'interactions.bindings', version: 1, data: {rules: [{id: 'go', trigger: {type: 'pointer.click', sourceId: 'play', event: ''}, actions: [{id: 'go-0', type: 'scene.change', targetId: 'level', value: true}]}]}}]), shape('coin', 'Coin', 650, 270, '#d9b43a')]),
 scene('level', 'Level', [shape('runner', 'Runner', 480, 270, '#e14c4c', [{id: 'runner-js', type: 'scripts.behaviour', version: 1, data: {scriptId: 's-win', params: {}, refs: {}}}])]),
 scene('win', 'Win', [shape('cup', 'Cup', 480, 270, '#57ab5a')]),
], extensions: {'scripts.library': {version: 1, items: [{id: 's-win', name: 'GoWin', source, code}]}}};
const file = join(temp, 'Flow.pixieditor');
let app;
try {
 await writeFile(file, JSON.stringify(project));
 await sharp({create: {width: 256, height: 64, channels: 4, background: '#cc8833'}}).png().toFile(join(temp, 'strip.png'));
 app = await electron.launch({executablePath: process.env.REWRITE_EXECUTABLE || require('electron'), args: [...(process.env.REWRITE_EXECUTABLE ? [] : [join(root, 'apps/editor-desktop/out/main/index.js')]), '--no-hub', `--user-data-dir=${join(temp, 'user')}`], env});
 const page = await app.firstWindow();
 page.setDefaultTimeout(15000);
 const errors = [];
 page.on('pageerror', e => errors.push(e.message));
 const canvas = page.getByTestId('pixi-canvas');
 await expect(canvas).toHaveAttribute('data-ready', 'true', {timeout: 30000});
 const menu = label => app.evaluate(({Menu}, text) => Menu.getApplicationMenu().items.flatMap(m => m.submenu?.items ?? []).find(i => i.label === text).click(), label);
 const choose = (...paths) => app.evaluate(({dialog}, targets) => { dialog.showOpenDialog = async () => ({canceled: false, filePaths: targets}); dialog.showSaveDialog = async () => ({canceled: false, filePath: targets[0]}); dialog.showMessageBox = async () => ({response: 1, checkboxChecked: false}); }, paths);
 await choose(file); await menu('Open…');
 await expect.poll(async () => Object.keys(JSON.parse(await canvas.getAttribute('data-transforms') ?? '{}')).length).toBe(2);

 // Scenes: the flow from a rule (Menu → Level) and a script (Level → Win); open a scene from the diagram; previews.
 await page.getByRole('button', {name: 'Scenes', exact: true}).click(); await page.getByRole('button', {name: 'Pin Scenes', exact: true}).click();
 const scenes = page.getByTestId('project-scenes'), flow = scenes.getByTestId('scene-flow');
 await expect(flow).toHaveAttribute('data-edges', JSON.stringify([['Menu', 'Level'], ['Level', 'Win']]));
 await expect(flow.locator('li')).toHaveText([/^Menu → Level · Play · interactions\.bindings/, /^Level → Win · Runner · script GoWin/]);
 const card = name => scenes.locator(`.scene-card[data-scene-id="${name}"]`);
 await expect(card('menu').getByTestId('scene-thumbnail')).toBeVisible({timeout: 10000});
 await flow.getByRole('button', {name: 'Scene flow: Level', exact: true}).click();
 await expect(scenes).toHaveAttribute('data-active-scene', 'level');
 await expect(card('level').getByTestId('scene-thumbnail')).toBeVisible({timeout: 10000});
 await expect(card('menu').getByTestId('scene-thumbnail')).toBeVisible();
 await expect(card('win').getByTestId('scene-thumbnail')).toHaveCount(0);
 // Deleting a scene a script goes to is refused like any other reference.
 await scenes.getByRole('button', {name: 'Delete scene… Win', exact: true}).click();
 await expect(page.getByRole('dialog')).toContainText('script GoWin');
 await page.keyboard.press('Escape');
 // The dialog hands focus back to its Delete button a frame later; wait for that before using the keyboard.
 await expect(page.getByRole('dialog')).toHaveCount(0);
 await expect(scenes.getByRole('button', {name: 'Delete scene… Win', exact: true})).toBeFocused();
 await flow.getByRole('button', {name: 'Scene flow: Menu', exact: true}).press('Enter');
 await expect(scenes).toHaveAttribute('data-active-scene', 'menu');
 console.log('PASS Scenes: flow from a rule and a script, open from the diagram (click and Enter), previews, script references protect scenes');

 // Library: slice a 256×64 strip — the 4 × 1 grid is guessed — and create an animated sprite.
 const lib = page.locator('.asset-library');
 if (!await lib.isVisible()) await page.keyboard.press('Alt+KeyB');
 await choose(join(temp, 'strip.png'));
 await lib.getByRole('button', {name: 'Add files…', exact: true}).click();
 await expect(lib.locator('[data-asset-name="strip"]')).toHaveCount(1, {timeout: 30000});
 await lib.getByRole('button', {name: 'Preview strip', exact: true}).click();
 const slicer = lib.getByTestId('sheet-slicer');
 await slicer.locator('summary').click();
 await expect(slicer.getByRole('spinbutton', {name: 'Columns', exact: true})).toHaveValue('4');
 await expect(slicer.getByTestId('sheet-frame-size')).toHaveText('4 frames of 64 × 64 px');
 await slicer.getByRole('spinbutton', {name: 'Frames', exact: true}).fill('3');
 await expect(slicer.locator('.sheet-unused')).toHaveCount(1);
 await slicer.getByRole('spinbutton', {name: 'Columns', exact: true}).fill('5');
 await expect(slicer.getByTestId('sheet-frame-size')).toHaveAttribute('data-even', 'false');
 await slicer.getByRole('spinbutton', {name: 'Columns', exact: true}).fill('4');
 await slicer.getByRole('spinbutton', {name: 'Frames', exact: true}).fill('3');
 await slicer.getByRole('button', {name: 'Create animated sprite', exact: true}).click();
 await expect.poll(async () => Object.keys(JSON.parse(await canvas.getAttribute('data-transforms'))).length).toBe(3);
 await choose(file); await menu('Save');
 await expect(page.getByLabel('Unsaved changes', {exact: true})).toHaveCount(0);
 let saved = JSON.parse(await readFile(file, 'utf8'));
 const sheet = saved.scenes[0].entities.find(e => e.name === 'strip').components.find(c => c.type === 'pixi.flipbook').data;
 expect(sheet).toMatchObject({columns: 4, rows: 1, frames: 3, fps: 12, loop: true, autoplay: true, width: 64, height: 64});
 console.log('PASS Library: sprite sheet slicer guesses 4 × 1, shows unused cells and uneven grids, creates an animated sprite');

 // Prefabs: two instances in this scene; Select instances selects both.
 await page.keyboard.press('Escape');
 await canvas.click({position: {x: 8, y: 8}});
 const b = await canvas.locator('canvas').boundingBox(), s = Math.min((b.width - 80) / 960, (b.height - 90) / 540);
 await page.mouse.click(b.x + (b.width - 960 * s) / 2 + 650 * s, b.y + (b.height - 540 * s) / 2 + 270 * s);
 await expect.poll(async () => JSON.parse(await canvas.getAttribute('data-selection'))).toEqual(['coin']);
 await page.getByRole('button', {name: 'Prefabs', exact: true}).click();
 const library = page.getByTestId('prefab-library');
 await library.getByRole('button', {name: 'Create prefab', exact: true}).click();
 await library.getByRole('button', {name: 'Instantiate prefab', exact: true}).click();
 const usage = library.getByTestId('prefab-usage');
 await expect(usage).toHaveAttribute('data-here', '2');
 await expect(usage).toHaveAttribute('data-elsewhere', '0');
 await expect(usage).toContainText('2 in this scene · 0 in other scenes');
 await usage.getByRole('button', {name: 'Select instances', exact: true}).click();
 await expect.poll(async () => JSON.parse(await canvas.getAttribute('data-selection')).length).toBe(2);
 expect(errors).toEqual([]);
 await mkdir(join(root, 'outputs'), {recursive: true});
 await page.screenshot({path: join(root, 'outputs/editor-flow.png')});
 console.log('PASS Prefabs: instance counts per scene and Select instances');
} catch (error) {
 await mkdir(join(root, 'outputs'), {recursive: true});
 const page = app ? await app.firstWindow().catch(() => null) : null;
 await page?.screenshot({path: join(root, 'outputs/flow-failure.png')}).catch(() => {});
 throw error;
} finally {
 if (app) { await app.evaluate(({BrowserWindow}) => { for (const w of BrowserWindow.getAllWindows()) w.destroy(); }).catch(() => {}); await app.close().catch(() => {}); }
 await rm(temp, {recursive: true, force: true, maxRetries: 3});
}
