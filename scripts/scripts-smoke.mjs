// Behaviour scripts: write one in the Monaco Scripts panel (⌥C) from the Script component, its typed params become
// Properties fields (number + slider, object picker, reset), run it in Preview (moves its object, reacts to clicks, writes
// globals, logs), compile errors block Play, an endless loop is stopped by the sandbox, a scene script runs for the
// whole scene, edits undo as document steps, and the exported HTML game runs the same scripts.
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
const temp = await mkdtemp(join(tmpdir(), 'rewrite-scripts-'));
const env = {...process.env};
delete env.ELECTRON_RUN_AS_NODE;
let app, browser, server, game;

const clicker = `export function onClick(self: GameObject) {
  globals.score += 1;
  self.rotation += 15;
  game.log('score', globals.score);
}
`;
const mover = `export const params = {speed: param.number(120, {min: 0, max: 600}), target: param.object()};
export function start(self: GameObject) { game.log('start', self.name, self.params.target ? self.params.target.name : 'none', self.parent); }
export function update(self: GameObject, dt: number) {
  self.x += self.params.speed * dt;
  if (self.x > 700) self.x = 200;
}
`;
const director = `export const params = {lives: param.number(3), hero: param.object()};
export function start(self: SceneSelf) {
  globals.score = self.params.lives;
  game.log('scene', self.name, self.params.lives, self.params.hero ? self.params.hero.name : 'none');
}
`;

try {
 const file = join(temp, 'scripts.pixieditor');
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
 const save = async () => { await choose(file); await menu('Save'); await expect(page.getByLabel('Unsaved changes', {exact: true})).toHaveCount(0); return JSON.parse(await readFile(file, 'utf8')); };
 await choose(file); await menu('Save');
 await expect.poll(() => readFile(file, 'utf8').then(() => true, () => false)).toBe(true);
 const project = JSON.parse(await readFile(file, 'utf8'));
 const t = (id, x, y) => ({id: `${id}-t`, type: 'scene.transform2d', version: 1, data: {x, y, rotation: 0, scaleX: 1, scaleY: 1}});
 const shape = (id, color) => ({id: `${id}-s`, type: 'pixi.shape', version: 1, data: {alpha: 1, kind: 'rect', width: 70, height: 70, color, rounded: 0, sides: 5, innerRadius: .5, strokeColor: '#ffffff', strokeWidth: 0}});
 const behaviour = (id, scriptId) => ({id: `${id}-b`, type: 'scripts.behaviour', version: 1, data: {scriptId, params: {}}});
 project.scenes[0].entities = [
  {id: 'mover', name: 'mover', parentId: null, active: true, components: [t('mover', 200, 200), shape('mover', '#7c5cff'), behaviour('mover', '')]},
  {id: 'button', name: 'button', parentId: null, active: true, components: [t('button', 480, 420), shape('button', '#44aa66'), behaviour('button', 's-click')]},
  {id: 'label', name: 'label', parentId: null, active: true, components: [t('label', 480, 80), {id: 'label-x', type: 'pixi.text', version: 1, data: {alpha: 1, text: 'score {score}', fontSize: 28, color: '#ffffff', font: ''}}]},
 ];
 project.extensions['interactions.globals'] = {version: 1, items: [{id: 'v-score', name: 'score', type: 'number', initial: 0}]};
 project.extensions['scripts.library'] = {version: 1, items: [{id: 's-click', name: 'Clicker', source: clicker, code: transform(clicker, {transforms: ['typescript', 'imports'], production: true, disableESTransforms: true}).code}]};
 await writeFile(file, JSON.stringify(project));
 await choose(file); await menu('Open…');
 await expect.poll(async () => Object.keys(JSON.parse(await canvas.getAttribute('data-transforms') ?? '{}'))).toContain('mover');
 const transforms = async () => JSON.parse(await canvas.getAttribute('data-transforms') ?? '{}');

 // A Script component without a script blocks Play with a clear message.
 await page.getByRole('button', {name: 'Play', exact: true}).click();
 await expect(page.getByRole('alert')).toContainText('mover: choose a script for its Script component');
 await page.getByRole('button', {name: 'Dismiss message', exact: true}).click();

 // Inspector → New script… opens the Scripts panel on the new script; Monaco edits compile and save.
 await page.getByRole('button', {name: 'Layers', exact: true}).click();
 await page.getByRole('button', {name: 'Select mover', exact: true}).click();
 await page.keyboard.press('Escape');
 await page.getByRole('button', {name: 'Properties', exact: true}).click();
 await page.locator('details.component > summary').filter({hasText: /^Script/}).click();
 const inspector = page.getByTestId('script-inspector');
 await expect(inspector).toContainText('Choose a script, or create a new one.');
 await inspector.getByRole('button', {name: 'New script…', exact: true}).click();
 const panel = page.getByTestId('scripts-panel'), status = panel.getByTestId('script-status');
 await expect(panel).toBeVisible();
 await expect(panel.getByRole('combobox', {name: 'Script', exact: true}).locator('option:checked')).toHaveText('Script');
 await expect(status).toHaveText('Ready · runs in Preview and exported games');
 const editor = panel.getByTestId('script-editor');
 await expect(editor.locator('.monaco-editor')).toBeVisible({timeout: 30000});
 await expect(editor.locator('.view-lines')).toContainText('export function update');
 // Pasted like a user would (typing line by line would trigger Monaco's auto-closing and auto-indent).
 const replace = async source => { await app.evaluate(({clipboard}, text) => clipboard.writeText(text), source); await editor.locator('.view-lines').click(); await page.keyboard.press('Meta+KeyA'); await page.keyboard.press('Meta+KeyV'); await expect(editor.locator('.view-lines')).toContainText(source.split('\n')[0].trim().slice(0, 20)); };
 await replace('export function update(self: GameObject) {\n  self.x += ;\n}\n');
 await expect(status).toContainText(/^Script: line 2: /);
 await expect(panel.getByRole('combobox', {name: 'Script', exact: true}).locator('option:checked')).toHaveText('⚠ Script');
 await replace(mover);
 await expect(status).toHaveText('Ready · runs in Preview and exported games');
 // Type errors come from the TypeScript service with the game API declarations (no DOM, typed GameObject).
 await panel.getByRole('button', {name: 'Rename', exact: true}).click();
 await panel.getByRole('textbox', {name: 'Script name', exact: true}).fill('Mover');
 await panel.getByRole('textbox', {name: 'Script name', exact: true}).press('Enter');
 await expect(panel.getByRole('combobox', {name: 'Script', exact: true}).locator('option:checked')).toHaveText('Mover');
 await menu('Undo');
 await expect(panel.getByRole('combobox', {name: 'Script', exact: true}).locator('option:checked')).toHaveText('Script');
 await menu('Redo');
 await expect(panel.getByRole('combobox', {name: 'Script', exact: true}).locator('option:checked')).toHaveText('Mover');
 let saved = await save();
 const library = saved.extensions['scripts.library'].items, moverScript = library.find(s => s.name === 'Mover');
 expect(moverScript.source).toBe(mover); expect(moverScript.code).toContain('exports.update'); expect(moverScript.error).toBeUndefined();
 expect(saved.scenes[0].entities.find(e => e.id === 'mover').components.find(c => c.type === 'scripts.behaviour').data.scriptId).toBe(moverScript.id);
 console.log('PASS Script component → New script… opens Monaco; edits compile on the fly (errors shown), rename undoes, the library is saved');

 // Typed params become Properties fields: number (+ slider, clamped), object picker, reset to the script default.
 await page.keyboard.press('Escape');
 await page.getByRole('button', {name: 'Properties', exact: true}).click();
 if (!await inspector.isVisible()) await page.locator('details.component > summary').filter({hasText: /^Script/}).click();
 const params = inspector.getByTestId('script-params-object');
 await expect(params.locator('[data-param]')).toHaveCount(2);
 const speed = params.getByRole('spinbutton', {name: 'speed', exact: true});
 await expect(speed).toHaveValue('120');
 await expect(params.getByRole('slider', {name: 'speed slider', exact: true})).toBeVisible();
 await speed.fill('900'); await speed.press('Enter');
 await expect(speed).toHaveValue('600');
 await params.getByRole('button', {name: "Reset to the script's default speed", exact: true}).click();
 await expect(speed).toHaveValue('120');
 await speed.fill('240'); await speed.press('Enter');
 await params.getByRole('combobox', {name: 'target', exact: true}).selectOption({label: 'button'});
 await expect(params.locator('[data-param="target"]')).toHaveAttribute('data-overridden', 'true');
 saved = await save();
 expect(saved.scenes[0].entities.find(e => e.id === 'mover').components.find(c => c.type === 'scripts.behaviour').data).toMatchObject({params: {speed: 240}, refs: {target: 'button'}});
 await page.keyboard.press('Escape');
 console.log('PASS typed params appear in Properties (number with slider, clamped to min/max, object picker, reset) and are saved per object');

 // Preview: the mover moves, a click runs the Clicker script (global + rotation), logs reach the console.
 await page.getByRole('button', {name: 'Play', exact: true}).click();
 await expect.poll(async () => (await transforms()).mover?.x, {timeout: 10000}).toBeGreaterThan(260);
 const view = async () => { const b = await canvas.locator('canvas').boundingBox(), s = Math.min((b.width - 80) / 960, (b.height - 90) / 540); return {at: (x, y) => ({x: b.x + (b.width - 960 * s) / 2 + x * s, y: b.y + (b.height - 540 * s) / 2 + y * s})}; };
 const press = async (x, y) => { const p = (await view()).at(x, y); await page.mouse.click(p.x, p.y); };
 await press(480, 420);
 await expect.poll(async () => Math.round((await transforms()).button?.rotation ?? NaN)).toBe(15);
 await press(480, 420);
 await expect.poll(async () => Math.round((await transforms()).button?.rotation ?? NaN)).toBe(30);
 await page.keyboard.press('Alt+KeyC');
 const consoleLog = page.getByTestId('script-console');
 await expect(consoleLog.locator('[data-level]')).toHaveText(['start mover button null', 'score 1', 'score 2']);
 await page.getByRole('button', {name: 'Stop', exact: true}).click();
 await expect.poll(async () => (await transforms()).mover?.x).toBe(200);
 await expect.poll(async () => Math.round((await transforms()).button?.rotation ?? NaN)).toBe(0);
 console.log('PASS Preview runs scripts in the sandbox: update moves an object, onClick writes a global and rotates, game.log reaches the console; Stop restores the scene');

 // An endless loop is stopped by the time limit; the editor stays responsive.
 if (!await panel.isVisible()) await page.keyboard.press('Alt+KeyC');
 await panel.getByRole('button', {name: 'Clear', exact: true}).click();
 await replace('export function update(self: GameObject) {\n  while (true) { self.x += 1; }\n}\n');
 await expect(status).toHaveText('Ready · runs in Preview and exported games');
 await page.getByRole('button', {name: 'Play', exact: true}).click();
 await expect(page.getByTestId('editor-shell').getByRole('alert')).toContainText('Scripts stopped: Mover.update ran longer than 250 ms (endless loop?)', {timeout: 10000});
 if (!await panel.isVisible()) await page.keyboard.press('Alt+KeyC');
 await expect(consoleLog.locator('[data-level="error"]')).toHaveText(['Scripts stopped: Mover.update ran longer than 250 ms (endless loop?)']);
 await page.getByRole('button', {name: 'Dismiss message', exact: true}).click();
 await press(480, 420);
 await expect.poll(async () => Math.round((await transforms()).button?.rotation ?? NaN)).toBe(0);
 await page.getByRole('button', {name: 'Stop', exact: true}).click();
 if (!await panel.isVisible()) await page.keyboard.press('Alt+KeyC');
 await replace(mover);
 await expect(status).toHaveText('Ready · runs in Preview and exported games');
 saved = await save();
 console.log('PASS an endless loop is stopped by the sandbox time limit with a clear message; the editor keeps working');

 // Scene script: one per scene with its own params; it starts before the objects' scripts.
 await panel.getByRole('button', {name: 'New script', exact: true}).click();
 await expect(status).toHaveText('Ready · runs in Preview and exported games');
 await replace(director);
 await panel.getByRole('button', {name: 'Rename', exact: true}).click();
 await panel.getByRole('textbox', {name: 'Script name', exact: true}).fill('Director');
 await panel.getByRole('textbox', {name: 'Script name', exact: true}).press('Enter');
 const sceneSection = panel.getByTestId('scene-script');
 await sceneSection.locator('summary').click();
 await sceneSection.getByRole('combobox', {name: 'Scene script', exact: true}).selectOption({label: 'Director'});
 const sceneParams = sceneSection.getByTestId('script-params-scene');
 await expect(sceneParams.getByRole('spinbutton', {name: 'lives', exact: true})).toHaveValue('3');
 await sceneParams.getByRole('spinbutton', {name: 'lives', exact: true}).fill('5');
 await sceneParams.getByRole('spinbutton', {name: 'lives', exact: true}).press('Enter');
 await sceneParams.getByRole('combobox', {name: 'hero', exact: true}).selectOption({label: 'mover'});
 await panel.getByRole('button', {name: 'Clear', exact: true}).click();
 await page.getByRole('button', {name: 'Play', exact: true}).click();
 await press(480, 420);
 if (!await panel.isVisible()) await page.keyboard.press('Alt+KeyC');
 const sceneName = project.scenes[0].name;
 await expect(consoleLog.locator('[data-level]')).toHaveText([`scene ${sceneName} 5 mover`, 'start mover button null', 'score 6']);
 await page.getByRole('button', {name: 'Stop', exact: true}).click();
 saved = await save();
 const directorScript = saved.extensions['scripts.library'].items.find(x => x.name === 'Director');
 expect(saved.extensions['scripts.library'].scenes).toEqual({[project.entrySceneId]: {scriptId: directorScript.id, params: {lives: 5}, refs: {hero: 'mover'}}});
 console.log('PASS a scene script (no object) with its own params runs first for the whole scene and sets up the game');

 // Export: the same scripts run in the browser game.
 const exportDir = join(temp, 'export');
 await mkdir(exportDir);
 await page.keyboard.press('Escape');
 await page.getByRole('button', {name: 'Export', exact: true}).click();
 await choose(exportDir);
 await page.getByRole('button', {name: 'Export HTML…', exact: true}).click();
 await expect(page.getByTestId('build-status')).toHaveAttribute('data-phase', /complete|failed/, {timeout: 60000});
 expect(await page.getByTestId('build-status').innerText()).not.toMatch(/Error/);
 const output = await page.getByTestId('build-output').innerText();
 const exported = JSON.parse(await readFile(join(output, 'project.json'), 'utf8'));
 expect(exported.runtimes).toContain('scripts');
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
 game = await (await browser.newContext({viewport: {width: 960, height: 540}})).newPage();
 const gameErrors = [], gameLogs = [];
 game.on('pageerror', e => gameErrors.push(e.message));
 game.on('console', m => { if (m.type() === 'error') gameErrors.push(m.text().slice(0, 300)); else if (m.text().startsWith('[script]')) gameLogs.push(m.text()); });
 await game.goto(`http://127.0.0.1:${server.address().port}`);
 await game.getByRole('button', {name: 'Start', exact: true}).click({timeout: 30000});
 const stage = game.locator('#game'), poses = async () => JSON.parse(await stage.getAttribute('data-poses') ?? '{}');
 await expect.poll(async () => (await poses()).mover?.x ?? 0, {timeout: 10000}).toBeGreaterThan(260);
 const gameAt = async (x, y) => { const box = await stage.locator('canvas').boundingBox(), s = Math.min(box.width / 960, box.height / 540); return {x: box.x + (box.width - 960 * s) / 2 + x * s, y: box.y + (box.height - 540 * s) / 2 + y * s}; };
 const tap = async (x, y) => { const p = await gameAt(x, y); await game.mouse.click(p.x, p.y); };
 await tap(480, 420);
 await expect.poll(async () => JSON.parse(await stage.getAttribute('data-texts') ?? '{}')['label-x']).toBe('score 6');
 expect(Math.round((await poses()).button.rotation)).toBe(15);
 expect(gameLogs).toEqual([`[script] scene ${sceneName} 5 mover`, '[script] start mover button null', '[script] score 6']);
 expect(gameErrors).toEqual([]);
 expect(errors).toEqual([]);
 await mkdir(join(root, 'outputs'), {recursive: true});
 await page.keyboard.press('Alt+KeyC');
 await page.screenshot({path: join(root, 'outputs/editor-scripts.png')});
 console.log('PASS exported HTML runs the scripts (QuickJS loaded with the game): movement, clicks, globals in text, console logs');
} catch (error) {
 await mkdir(join(root, 'outputs'), {recursive: true});
 const page = app ? await app.firstWindow().catch(() => null) : null;
 await page?.screenshot({path: join(root, 'outputs/scripts-failure.png')}).catch(() => {});
 await game?.screenshot({path: join(root, 'outputs/scripts-game-failure.png')}).catch(() => {});
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
