// List and object globals: the Globals panel takes JSON initial values (invalid JSON is marked and not saved), rules
// add list items and set object fields, a condition checks "contains", a script changes them in place
// (globals.inventory.push, globals.player.hp -= 2), the Now column shows live values in Preview, and text templates
// read {inventory}, {inventory.length} and {player.hp}. Preview and exported HTML.
import {_electron as electron, chromium, expect} from '@playwright/test';
import {createServer} from 'node:http';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {dirname, extname, join, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(join(root, 'apps/editor-desktop/package.json'));
const {transform} = createRequire(join(root, 'modules/scripts/package.json'))('sucrase');
const temp = await mkdtemp(join(tmpdir(), 'rewrite-globals-'));
const env = {...process.env};
delete env.ELECTRON_RUN_AS_NODE;
let app, browser, server, game;
const bagScript = `export function onClick(self: GameObject) { globals.inventory.push('map'); globals.player.hp -= 2; game.log('bag', globals.inventory.length, globals.player.hp); }`;
const compile = source => transform(source, {transforms: ['typescript', 'imports'], production: true, disableESTransforms: true}).code;
const t = (id, x, y) => ({id: `${id}-t`, type: 'scene.transform2d', version: 1, data: {x, y, rotation: 0, scaleX: 1, scaleY: 1}});
const rect = (id, w, color) => ({id: `${id}-s`, type: 'pixi.shape', version: 1, data: {alpha: 1, kind: 'rect', width: w, height: w, color, rounded: 6, sides: 5, innerRadius: .5, strokeColor: '#ffffff', strokeWidth: 0}});
const rules = (id, list) => ({id: `${id}-r`, type: 'interactions.bindings', version: 1, data: {rules: list}});
const click = (source, actions, condition) => ({id: `${source}-rule`, trigger: {type: 'pointer.click', sourceId: source, event: ''}, ...(condition ? {condition} : {}), actions});

try {
 const file = join(temp, 'globals.pixieditor');
 app = await electron.launch({executablePath: process.env.REWRITE_EXECUTABLE || require('electron'), args: [...(process.env.REWRITE_EXECUTABLE ? [] : [join(root, 'apps/editor-desktop/out/main/index.js')]), '--no-hub', `--user-data-dir=${join(temp, 'user')}`], env});
 const page = await app.firstWindow();
 page.setDefaultTimeout(15000);
 const errors = [];
 page.on('pageerror', e => errors.push(e.message));
 const canvas = page.getByTestId('pixi-canvas');
 await expect(canvas).toHaveAttribute('data-ready', 'true', {timeout: 30000});
 const menu = label => app.evaluate(({Menu}, text) => Menu.getApplicationMenu().items.flatMap(m => m.submenu?.items ?? []).find(i => i.label === text).click(), label);
 const choose = path => app.evaluate(({dialog}, target) => { dialog.showOpenDialog = async () => ({canceled: false, filePaths: [target]}); dialog.showSaveDialog = async () => ({canceled: false, filePath: target}); dialog.showMessageBox = async () => ({response: 1, checkboxChecked: false}); }, path);
 const save = async () => { await choose(file); await menu('Save'); await expect(page.getByLabel('Unsaved changes', {exact: true})).toHaveCount(0); return JSON.parse(await readFile(file, 'utf8')); };
 await choose(file); await menu('Save');
 await expect.poll(() => readFile(file, 'utf8').then(() => true, () => false)).toBe(true);
 const project = JSON.parse(await readFile(file, 'utf8'));
 project.scenes[0].entities = [
  {id: 'pickup', name: 'Pickup', parentId: null, active: true, components: [t('pickup', 120, 80), rect('pickup', 70, '#06d6a0'), rules('pickup', [click('pickup', [{id: 'p1', type: 'list.add', targetId: 'inv', value: true, to: 'key'}, {id: 'p2', type: 'object.set', targetId: 'pl', value: true, key: 'hp', to: 7}])])]},
  {id: 'door', name: 'Door', parentId: null, active: true, components: [t('door', 320, 80), rect('door', 70, '#ef476f'), rules('door', [click('door', [{id: 'd1', type: 'entity.active', targetId: 'open', value: true}], {globalId: 'inv', op: 'contains', value: 'key'})])]},
  {id: 'open', name: 'Open', parentId: null, active: false, components: [t('open', 320, 200), rect('open', 40, '#ffd166')]},
  {id: 'bag', name: 'Bag', parentId: null, active: true, components: [t('bag', 520, 80), rect('bag', 70, '#3a86ff'), {id: 'bag-b', type: 'scripts.behaviour', version: 1, data: {scriptId: 's-bag', params: {}, refs: {}}}]},
  {id: 'hud', name: 'HUD', parentId: null, active: true, components: [t('hud', 480, 400), {id: 'hud-x', type: 'pixi.text', version: 1, data: {alpha: 1, text: '{inventory} | {inventory.length} | {player.hp} HP', fontSize: 28, color: '#ffffff', font: '', fontWeight: 'normal', fontStyle: 'normal', align: 'center', letterSpacing: 0, strokeColor: '#000000', strokeWidth: 0}}]},
 ];
 project.extensions['interactions.globals'] = {version: 1, items: [{id: 'inv', name: 'inventory', type: 'list', initial: ['sword']}, {id: 'pl', name: 'player', type: 'object', initial: {hp: 10, name: 'Ada'}}]};
 project.extensions['scripts.library'] = {version: 1, items: [{id: 's-bag', name: 'Bag', source: bagScript, code: compile(bagScript)}]};
 await writeFile(file, JSON.stringify(project));
 await choose(file); await menu('Open…');
 await expect.poll(async () => Object.keys(JSON.parse(await canvas.getAttribute('data-transforms') ?? '{}'))).toContain('hud');

 // Globals panel: JSON initial values for a new list global, invalid JSON marked and not saved.
 await page.getByRole('button', {name: 'Globals', exact: true}).click();
 const panel = page.getByTestId('globals-panel');
 await expect(panel.getByRole('textbox', {name: 'Initial value inventory', exact: true})).toHaveValue('["sword"]');
 await expect(panel.getByRole('textbox', {name: 'Initial value player', exact: true})).toHaveValue('{"hp":10,"name":"Ada"}');
 await panel.getByRole('button', {name: '+ Global', exact: true}).click();
 const added = panel.locator('[data-global]').nth(2), name = await added.getAttribute('data-global');
 await panel.getByRole('combobox', {name: `Type ${name}`, exact: true}).selectOption('list');
 const initial = panel.getByRole('textbox', {name: `Initial value ${name}`, exact: true});
 await expect(initial).toHaveValue('[]');
 await initial.fill('{"a": 1}'); await initial.press('Enter');
 await expect(initial).toHaveAttribute('aria-invalid', 'true');
 expect((await save()).extensions['interactions.globals'].items[2].initial).toEqual([]);
 await initial.fill('["x", 2, true]'); await initial.press('Enter');
 await expect(initial).not.toHaveAttribute('aria-invalid', 'true');
 expect((await save()).extensions['interactions.globals'].items[2]).toMatchObject({type: 'list', initial: ['x', 2, true]});
 await panel.getByRole('combobox', {name: `Type ${name}`, exact: true}).selectOption('object');
 await expect(initial).toHaveValue('{}');
 for (let i = 0; i < 4; i++) await menu('Undo');
 await expect(panel.locator('[data-global]')).toHaveCount(2);
 await page.keyboard.press('Escape');
 console.log('PASS Globals panel: list and object types with JSON initial values; invalid JSON is marked and not saved');

 // Rule editors show the item, field and condition values.
 await page.getByRole('button', {name: 'Layers', exact: true}).click();
 await page.getByRole('button', {name: 'Select Pickup', exact: true}).click();
 await page.keyboard.press('Escape');
 await page.getByRole('button', {name: 'Properties', exact: true}).click();
 const props = page.getByTestId('properties');
 if (!await props.getByLabel('Action value 1.1', {exact: true}).count()) await props.locator('summary').filter({hasText: /^Interactions$/}).click();
 await expect(props.getByLabel('Action value 1.1', {exact: true})).toHaveValue('key');
 await expect(props.getByLabel('Action field 1.2', {exact: true})).toHaveValue('hp');
 await expect(props.getByLabel('Action value 1.2', {exact: true})).toHaveValue('7');
 await page.keyboard.press('Escape');
 console.log('PASS rule editors: List add item and Object set field values');

 // Preview: the Now column follows rules and the script.
 const at = async (x, y) => { const b = await canvas.locator('canvas').boundingBox(), s = Math.min((b.width - 80) / 960, (b.height - 90) / 540); return {x: b.x + (b.width - 960 * s) / 2 + x * s, y: b.y + (b.height - 540 * s) / 2 + y * s}; };
 await page.getByRole('button', {name: 'Play', exact: true}).click();
 await expect.poll(async () => Number(await canvas.getAttribute('data-runtime-time') ?? 0)).toBeGreaterThan(.2);
 for (const [x, y] of [[320, 80], [120, 80], [320, 80], [520, 80]]) { const p = await at(x, y); await page.mouse.click(p.x, p.y); await page.waitForTimeout(120); }
 await page.getByRole('button', {name: 'Globals', exact: true}).click();
 await expect(panel.getByRole('textbox', {name: 'Now inventory', exact: true})).toHaveValue('["sword","key","map"]');
 await expect(panel.getByRole('textbox', {name: 'Now player', exact: true})).toHaveValue('{"hp":5,"name":"Ada"}');
 await panel.getByRole('textbox', {name: 'Now inventory', exact: true}).fill('[]');
 await panel.getByRole('textbox', {name: 'Now inventory', exact: true}).press('Enter');
 await expect(panel.getByRole('textbox', {name: 'Now inventory', exact: true})).toHaveValue('[]');
 await page.keyboard.press('Escape');
 await page.getByRole('button', {name: 'Stop', exact: true}).click();
 console.log('PASS Preview: rules add the key and set hp, the door opens only with the key, the script pushes and subtracts in place, Now edits');

 // Export.
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
 const gameErrors = [];
 game.on('pageerror', e => gameErrors.push(e.message));
 game.on('console', m => { if (m.type() === 'error') gameErrors.push(m.text().slice(0, 300)); });
 await game.goto(`http://127.0.0.1:${server.address().port}`);
 await game.getByRole('button', {name: 'Start', exact: true}).click({timeout: 30000});
 const stage = game.locator('#game'), text = async () => JSON.parse(await stage.getAttribute('data-texts') ?? '{}')['hud-x'], poses = async () => JSON.parse(await stage.getAttribute('data-poses') ?? '{}');
 await expect.poll(text).toBe('sword | 1 | 10 HP');
 const gameAt = async (x, y) => { const b = await stage.locator('canvas').boundingBox(), s = Math.min(b.width / 960, b.height / 540); return {x: b.x + (b.width - 960 * s) / 2 + x * s, y: b.y + (b.height - 540 * s) / 2 + y * s}; };
 const tap = async (x, y) => { const p = await gameAt(x, y); await game.mouse.click(p.x, p.y); await game.waitForTimeout(120); };
 await tap(320, 80);
 expect((await poses()).open.active).toBe(false);
 await tap(120, 80);
 await expect.poll(text).toBe('sword, key | 2 | 7 HP');
 await tap(320, 80);
 await expect.poll(async () => (await poses()).open.active).toBe(true);
 await tap(520, 80);
 await expect.poll(text).toBe('sword, key, map | 3 | 5 HP');
 expect(gameErrors).toEqual([]);
 expect(errors).toEqual([]);
 console.log('PASS exported game: templates {inventory}, {inventory.length}, {player.hp}; rules, condition and script in place');
} catch (error) {
 await mkdir(join(root, 'outputs'), {recursive: true});
 const page = app ? await app.firstWindow().catch(() => null) : null;
 await page?.screenshot({path: join(root, 'outputs/globals-failure.png')}).catch(() => {});
 await game?.screenshot({path: join(root, 'outputs/globals-game-failure.png')}).catch(() => {});
 throw error;
} finally {
 await browser?.close().catch(() => {});
 if (server) await new Promise(r => server.close(r));
 if (app) { await app.evaluate(({BrowserWindow}) => { for (const w of BrowserWindow.getAllWindows()) w.destroy(); }).catch(() => {}); await app.close().catch(() => {}); }
 await rm(temp, {recursive: true, force: true, maxRetries: 3});
}
