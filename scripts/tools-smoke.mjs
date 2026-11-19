// Globals, Input, Localization, Physics, Mixer: live global values editable while playing, held input actions light
// up, live bus meters, plain scene texts moved into the string table as {@key} (one undo step), and Fit to visual
// sizes a collider to the object's shape.
import {_electron as electron, expect} from '@playwright/test';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(join(root, 'apps/editor-desktop/package.json'));
const temp = await mkdtemp(join(tmpdir(), 'rewrite-tools-'));
const env = {...process.env};
delete env.ELECTRON_RUN_AS_NODE;
const t = (id, x, y) => ({id: `${id}-t`, type: 'scene.transform2d', version: 1, data: {x, y, rotation: 0, scaleX: 1, scaleY: 1}});
const project = {formatVersion: 1, name: 'Tools', entrySceneId: 'main', modules: {}, providers: {render: 'pixi'}, scenes: [{formatVersion: 1, id: 'main', name: 'Main', entities: [
 {id: 'title', name: 'Title', parentId: null, active: true, components: [t('title', 480, 80), {id: 'title-x', type: 'pixi.text', version: 1, data: {alpha: 1, text: 'Hello world', fontSize: 32, color: '#ffffff', font: ''}}]},
 {id: 'score', name: 'Score', parentId: null, active: true, components: [t('score', 480, 140), {id: 'score-x', type: 'pixi.text', version: 1, data: {alpha: 1, text: 'score {score}', fontSize: 24, color: '#ffffff', font: ''}}]},
 {id: 'crate', name: 'Crate', parentId: null, active: true, components: [t('crate', 300, 400), {id: 'crate-s', type: 'pixi.shape', version: 1, data: {width: 120, height: 40, color: '#b07a3f', rounded: 0, alpha: 1}}, {id: 'crate-b', type: 'physics.boxCollider2d', version: 1, data: {width: 10, height: 10, offsetX: 3, offsetY: 4, chamfer: 0, sensor: false}}]},
]}], extensions: {
 'interactions.globals': {version: 1, items: [{id: 'v-score', name: 'score', type: 'number', initial: 0}]},
 'input.map': {version: 1, deadzone: 0.2, actions: [{id: 'boost', name: 'boost', kind: 'button', bindings: [{type: 'key', code: 'KeyB'}]}]},
}};
const file = join(temp, 'Tools.pixieditor');
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
 await expect.poll(async () => Object.keys(JSON.parse(await canvas.getAttribute('data-transforms') ?? '{}')).length).toBe(3);
 const save = async () => { await choose(file); await menu('Save'); await expect(page.getByLabel('Unsaved changes', {exact: true})).toHaveCount(0); return JSON.parse(await readFile(file, 'utf8')); };
 const pin = async name => { await page.getByRole('button', {name, exact: true}).click(); await page.getByRole('button', {name: `Pin ${name}`, exact: true}).click(); };

 // Physics: Fit to visual sizes the box collider to the 120 × 40 shape and centres it.
 await pin('Layers');
 await page.getByRole('button', {name: 'Select Crate', exact: true}).click();
 await pin('Properties');
 const props = page.getByTestId('properties');
 const collider = props.locator('details', {has: page.locator('summary', {hasText: /Box Collider/})});
 if (await collider.getAttribute('open') === null) await collider.locator('summary').click();
 await collider.getByRole('button', {name: 'Fit to visual', exact: true}).click();
 let saved = await save();
 expect(saved.scenes[0].entities.find(e => e.id === 'crate').components.find(c => c.type === 'physics.boxCollider2d').data).toMatchObject({width: 120, height: 40, offsetX: 0, offsetY: 0});
 console.log('PASS Physics: Fit to visual sizes the collider to the shape and centres it');

 // Localization: the plain title is listed (the {score} template is not); Make key moves it into the table; one Undo.
 await page.getByRole('button', {name: 'Localization', exact: true}).click();
 const texts = page.getByTestId('scene-texts');
 await expect(texts).toHaveAttribute('data-count', '1');
 await texts.getByRole('button', {name: 'Make key Title', exact: true}).click();
 await expect(texts).toHaveAttribute('data-count', '0');
 saved = await save();
 expect(saved.scenes[0].entities.find(e => e.id === 'title').components[1].data.text).toBe('{@title.hello_world}');
 expect(saved.extensions['interactions.strings'].entries).toEqual([{key: 'title.hello_world', values: {en: 'Hello world'}}]);
 await menu('Undo');
 saved = await save();
 expect(saved.scenes[0].entities.find(e => e.id === 'title').components[1].data.text).toBe('Hello world');
 expect(saved.extensions['interactions.strings']?.entries ?? []).toEqual([]);
 await page.keyboard.press('Escape');
 console.log('PASS Localization: plain scene texts listed, Make key moves one into the table as {@key}, one Undo');

 // Preview: Globals Now edits the running value; Input rows light up while held; Mixer meters show the buses.
 // Back to the Canvas layout first: docked panels would leave the canvas too narrow to click.
 await page.getByRole('button', {name: 'Workspace layout', exact: true}).click(); await page.getByRole('menuitem', {name: 'Canvas', exact: true}).click();
 await page.getByRole('button', {name: 'Play', exact: true}).click();
 await expect(page.getByTestId('editor-shell')).toHaveAttribute('data-mode', 'playing');
 await page.getByRole('button', {name: 'Globals', exact: true}).click();
 const globals = page.getByTestId('globals-panel');
 await expect(globals).toHaveAttribute('data-live', 'true');
 const now = globals.getByLabel('Now score', {exact: true});
 await expect(now).toHaveValue('0');
 await now.fill('42'); await now.press('Enter');
 await expect.poll(async () => JSON.parse(await canvas.getAttribute('data-interactions')).globals.score).toBe(42);
 await expect(globals.getByLabel('Initial value score', {exact: true})).toHaveValue('0');
 await page.keyboard.press('Escape');
 await pin('Input');
 // Keys reach the game once the canvas has focus: click an empty stage point. Pinning reflows the dock, so the point
 // is measured again on each try.
 const boost = page.getByTestId('input-panel').locator('[data-action="boost"]');
 await expect.poll(async () => {
  const b = await canvas.locator('canvas').boundingBox(), k = Math.min((b.width - 80) / 960, (b.height - 90) / 540);
  await page.mouse.click(b.x + (b.width - 960 * k) / 2 + 800 * k, b.y + (b.height - 540 * k) / 2 + 300 * k);
  await page.keyboard.down('KeyB'); await page.waitForTimeout(200);
  const held = await boost.getAttribute('data-held');
  if (held !== 'true') await page.keyboard.up('KeyB');
  return held;
 }, {timeout: 15000}).toBe('true');
 await page.keyboard.up('KeyB');
 await expect(boost).not.toHaveAttribute('data-held', /./);
 await page.getByRole('button', {name: 'Mixer', exact: true}).click();
 const meters = page.getByTestId('mixer-meters');
 await expect(meters.locator('[data-bus="music"]')).toHaveAttribute('data-gain', '100');
 await expect(meters.locator('[data-bus]')).toHaveCount(3);
 await page.keyboard.press('Escape');
 await page.getByRole('button', {name: 'Stop', exact: true}).click();
 await expect(page.getByTestId('editor-shell')).toHaveAttribute('data-mode', 'edit');
 await page.getByRole('button', {name: 'Mixer', exact: true}).click();
 await expect(page.getByTestId('mixer-panel')).toBeVisible();
 await expect(meters).toHaveCount(0);
 await page.keyboard.press('Escape');
 await page.getByRole('button', {name: 'Globals', exact: true}).click();
 await expect(globals).toHaveAttribute('data-live', 'false');
 expect(errors).toEqual([]);
 await mkdir(join(root, 'outputs'), {recursive: true});
 await page.screenshot({path: join(root, 'outputs/editor-tools.png')});
 console.log('PASS Preview: Globals Now edits the running value, held input actions light up, Mixer meters per bus');
} catch (error) {
 await mkdir(join(root, 'outputs'), {recursive: true});
 const page = app ? await app.firstWindow().catch(() => null) : null;
 await page?.screenshot({path: join(root, 'outputs/tools-failure.png')}).catch(() => {});
 throw error;
} finally {
 if (app) { await app.evaluate(({BrowserWindow}) => { for (const w of BrowserWindow.getAllWindows()) w.destroy(); }).catch(() => {}); await app.close().catch(() => {}); }
 await rm(temp, {recursive: true, force: true, maxRetries: 3});
}
