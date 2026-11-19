// Dialogues: author in the Dialogues panel and test it there; in Preview and the exported game a click rule opens the
// dialogue, a choice shows only while its condition holds, a line sets a global and fires an event a rule reacts to,
// and the scene script hears the end in onDialogue.
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
const compile = source => transform(source, {transforms: ['typescript', 'imports'], production: true, disableESTransforms: true}).code;
const temp = await mkdtemp(join(tmpdir(), 'rewrite-dialogue-'));
const env = {...process.env};
delete env.ELECTRON_RUN_AS_NODE;
let app, browser, server, game;
const sceneScript = `export function onDialogue(self: GameObject, event: string, dialogue: string) {
  if (event === 'end' && dialogue === 'Shop') globals.ends = globals.ends + 1;
}`;
try {
 const file = join(temp, 'dialogue.pixieditor');
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
 const project = JSON.parse(await readFile(file, 'utf8')), sceneId = project.entrySceneId;
 const t = (id, x, y) => ({id: `${id}-t`, type: 'scene.transform2d', version: 1, data: {x, y, rotation: 0, scaleX: 1, scaleY: 1}});
 const shape = (id, color) => ({id: `${id}-s`, type: 'pixi.shape', version: 1, data: {alpha: 1, kind: 'rect', width: 80, height: 80, color, rounded: 0, sides: 5, innerRadius: .5, strokeColor: '#ffffff', strokeWidth: 0}});
 project.scenes[0].entities = [
  {id: 'button', name: 'Button', parentId: null, active: true, components: [t('button', 200, 160), shape('button', '#5bc0eb'), {id: 'button-r', type: 'interactions.bindings', version: 1, data: {rules: [
   {id: 'open', trigger: {type: 'pointer.click', sourceId: 'button', event: ''}, actions: [{id: 'open-1', type: 'dialogue.start', targetId: 'd-shop', value: true}]},
  ]}}]},
  {id: 'gem', name: 'Gem', parentId: null, active: true, components: [t('gem', 760, 160), shape('gem', '#40c060'), {id: 'gem-r', type: 'interactions.bindings', version: 1, data: {rules: [
   {id: 'hide', trigger: {type: 'dialogue.event', sourceId: 'd-shop', event: 'done'}, actions: [{id: 'hide-1', type: 'entity.active', targetId: 'gem', value: false}]},
  ]}}]},
 ];
 project.extensions['interactions.globals'] = {version: 1, items: [{id: 'g-coins', name: 'coins', type: 'number', initial: 9}, {id: 'g-bought', name: 'bought', type: 'boolean', initial: false}, {id: 'g-ends', name: 'ends', type: 'number', initial: 0}]};
 project.extensions['dialogue.library'] = {version: 1, items: [{id: 'd-shop', name: 'Shop', start: 'a', lines: [
  {id: 'a', speaker: 'Olive', text: 'Hi! You have {coins} coins.', next: '', event: '', choices: [
   {id: 'c1', text: 'Buy a gem', next: 'b', condition: {globalId: 'g-coins', op: '>=', value: 5}},
   {id: 'c2', text: 'Rich only', next: '', condition: {globalId: 'g-coins', op: '>=', value: 100}},
   {id: 'c3', text: 'Bye', next: ''},
  ]},
  {id: 'b', speaker: 'Olive', text: 'Thanks!', next: 'c', choices: [], event: '', set: {globalId: 'g-bought', value: true}},
  {id: 'c', speaker: '', text: 'Come again.', next: '', choices: [], event: 'done'},
 ]}]};
 project.extensions['scripts.library'] = {version: 1, items: [{id: 's-scene', name: 'Scene', source: sceneScript, code: compile(sceneScript)}], scenes: {[sceneId]: {scriptId: 's-scene', params: {}, refs: {}}}};
 await writeFile(file, JSON.stringify(project));
 await choose(file); await menu('Open…');
 await expect.poll(async () => Object.keys(JSON.parse(await canvas.getAttribute('data-transforms') ?? '{}'))).toContain('gem');

 // Panel: the dialogue, its lines, adding a line, and Test.
 await page.keyboard.press('Alt+KeyD');
 const panel = page.getByTestId('dialogue-panel');
 await expect(panel).toBeVisible();
 await expect(panel.getByRole('listbox', {name: 'Project dialogues'}).getByRole('option', {name: 'Shop'})).toHaveAttribute('aria-selected', 'true');
 await expect(panel.locator('section.dialogue-line')).toHaveCount(3);
 await expect(panel.getByTestId('dialogue-problems')).toHaveCount(0);
 await panel.getByRole('button', {name: 'Add line'}).click();
 await expect(panel.locator('section.dialogue-line')).toHaveCount(4);
 await expect(panel.getByRole('combobox', {name: 'Then 3'})).not.toHaveValue('');
 await panel.getByRole('textbox', {name: 'Text ({global} shows a value)'}).nth(3).fill('A new line');
 await panel.getByRole('textbox', {name: 'Speaker'}).nth(3).click();
 await panel.getByRole('button', {name: 'Test'}).click();
 const testBox = panel.getByTestId('dialogue-test').locator('[data-dialogue-box]');
 await expect(testBox).toContainText('Hi! You have 9 coins.');
 await expect(testBox.getByRole('button')).toHaveText(['1. Buy a gem', '3. Bye'].map(s => s.replace('3.', '2.')));
 await testBox.getByRole('button', {name: '1. Buy a gem'}).click();
 await expect(testBox).toContainText('Thanks!');
 await page.keyboard.press('Escape');
 await expect.poll(async () => JSON.parse(await readFile(file, 'utf8')).extensions['dialogue.library'].items[0].lines.length).toBe(3);
 console.log('PASS Dialogues panel: lists lines, Add line links the last one, Test plays it with conditional choices');

 // Preview.
 const view = async () => { const b = await canvas.locator('canvas').boundingBox(), s = Math.min((b.width - 80) / 960, (b.height - 90) / 540); return {b, at: (x, y) => ({x: b.x + (b.width - 960 * s) / 2 + x * s, y: b.y + (b.height - 540 * s) / 2 + y * s})}; };
 await page.getByRole('button', {name: 'Play', exact: true}).click();
 const box = canvas.locator('[data-dialogue-box]');
 await expect(box).toBeHidden();
 { const p = (await view()).at(200, 160); await page.mouse.click(p.x, p.y); }
 await expect(box).toBeVisible();
 await expect(box).toContainText('Olive');
 await expect(box).toHaveAttribute('data-typing', 'false');
 await expect(box).toContainText('Hi! You have 9 coins.');
 await expect(box.getByRole('button')).toHaveText(['1. Buy a gem', '2. Bye']);
 await page.keyboard.press('1');
 await expect(box).toHaveAttribute('data-line', 'b');
 await page.keyboard.press('Space');
 await expect(box).toHaveAttribute('data-typing', 'false');
 await page.keyboard.press('Space');
 await expect(box).toHaveAttribute('data-line', 'c');
 await expect(box).toHaveAttribute('data-typing', 'false');
 await page.keyboard.press('Enter');
 await expect(box).toContainText('A new line');
 await expect(box).toHaveAttribute('data-typing', 'false');
 await page.keyboard.press('Enter');
 await expect(box).toBeHidden();
 await page.keyboard.press('F3');
 const overlay = canvas.locator('[data-debug-overlay]');
 await expect(overlay).toContainText('bought = true');
 await expect(overlay).toContainText('ends = 1');
 await page.keyboard.press('F3');
 await page.getByRole('button', {name: 'Stop', exact: true}).click();
 await expect(box).toHaveCount(0);
 console.log('PASS Preview: click opens the dialogue, choice and keys move through it, a line sets a global, the event rule fires, onDialogue hears the end');

 const exportDir = join(temp, 'export');
 await mkdir(exportDir);
 await page.getByRole('button', {name: 'Export', exact: true}).click();
 await choose(exportDir);
 await page.getByRole('button', {name: 'Export HTML…', exact: true}).click();
 await expect(page.getByTestId('build-status')).toHaveAttribute('data-phase', /complete|failed/, {timeout: 30000});
 expect(await page.getByTestId('build-status').innerText()).not.toMatch(/Error/);
 const output = await page.getByTestId('build-output').innerText();
 const bundle = JSON.parse(await readFile(join(output, 'project.json'), 'utf8'));
 expect(bundle.runtimes).toEqual(expect.arrayContaining(['dialogue', 'scripts']));
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
 game = await browser.newPage({viewport: {width: 960, height: 540}});
 const gameErrors = [];
 game.on('pageerror', e => gameErrors.push(e.message));
 game.on('console', m => { if (m.type() === 'error') gameErrors.push(m.text().slice(0, 300)); });
 await game.goto(`http://127.0.0.1:${server.address().port}`);
 await game.getByRole('button', {name: 'Start', exact: true}).click({timeout: 30000});
 const stage = game.locator('#game');
 await expect(stage).toHaveAttribute('data-scene-id', sceneId);
 const at = async (x, y) => { const b = await stage.locator('canvas').boundingBox(), s = Math.min(b.width / 960, b.height / 540); return {x: b.x + (b.width - 960 * s) / 2 + x * s, y: b.y + (b.height - 540 * s) / 2 + y * s}; };
 const gameBox = stage.locator('[data-dialogue-box]');
 { const p = await at(200, 160); await game.mouse.click(p.x, p.y); }
 await expect(gameBox).toBeVisible();
 await expect(gameBox).toHaveAttribute('data-typing', 'false');
 await gameBox.getByRole('button', {name: '1. Buy a gem'}).click();
 await expect(gameBox).toHaveAttribute('data-line', 'b');
 await gameBox.click(); await expect(gameBox).toHaveAttribute('data-typing', 'false'); await gameBox.click();
 await expect(gameBox).toHaveAttribute('data-line', 'c');
 await expect.poll(async () => JSON.parse(await stage.getAttribute('data-poses') ?? '{}').gem?.active).toBe(false);
 await expect(gameBox).toHaveAttribute('data-typing', 'false'); await gameBox.click();
 await expect(gameBox).toContainText('A new line');
 await expect(gameBox).toHaveAttribute('data-typing', 'false'); await gameBox.click();
 await expect(gameBox).toBeHidden();
 expect(gameErrors).toEqual([]);
 expect(errors).toEqual([]);
 console.log('PASS exported game: the dialogue chunk shows the same box, choices, event rule and end');
} catch (error) {
 await mkdir(join(root, 'outputs'), {recursive: true});
 const page = app ? await app.firstWindow().catch(() => null) : null;
 await page?.screenshot({path: join(root, 'outputs/dialogue-failure.png')}).catch(() => {});
 await game?.screenshot({path: join(root, 'outputs/dialogue-game-failure.png')}).catch(() => {});
 throw error;
} finally {
 await browser?.close().catch(() => {});
 if (server) await new Promise(r => server.close(r));
 if (app) { await app.evaluate(({BrowserWindow}) => { for (const w of BrowserWindow.getAllWindows()) w.destroy(); }).catch(() => {}); await app.close().catch(() => {}); }
 await rm(temp, {recursive: true, force: true, maxRetries: 3});
}
