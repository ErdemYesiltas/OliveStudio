// Input map: Input panel capture, keyboard/mouse actions and a key-pair axis in editor Preview (canvas focus only),
// then the exported game with keyboard, mouse and an emulated gamepad (button + stick axis).
import {_electron as electron, chromium, expect} from '@playwright/test';
import {createServer} from 'node:http';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {dirname, extname, join, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(join(root, 'apps/editor-desktop/package.json'));
const temp = await mkdtemp(join(tmpdir(), 'rewrite-input-'));
const env = {...process.env};
delete env.ELECTRON_RUN_AS_NODE;
let app, browser, server;
const t = (id, x, y) => ({id: `${id}-t`, type: 'scene.transform2d', version: 1, data: {x, y, rotation: 0, scaleX: 1, scaleY: 1}});
const shape = (id, name, x, y, extra = []) => ({id, name, parentId: null, active: true, components: [t(id, x, y), {id: `${id}-s`, type: 'pixi.shape', version: 1, data: {width: 120, height: 60, color: '#79a7d5', rounded: 8, alpha: 1}}, ...extra]});
const rule = (id, trigger, actions, condition) => ({id, trigger, actions, ...(condition ? {condition} : {})});
const project = {
 formatVersion: 1, name: 'Input', entrySceneId: 'main', modules: {}, providers: {render: 'pixi'},
 scenes: [
  {formatVersion: 1, id: 'main', name: 'Main', entities: [
   shape('ctl', 'Controller', 480, 270, [{id: 'ctl-b', type: 'interactions.bindings', version: 1, data: {rules: [
    rule('r-jump', {type: 'input.pressed', sourceId: 'jump', event: ''}, [{id: 'a-jump', type: 'global.add', targetId: 'v-score', value: true, amount: 1}]),
    rule('r-win', {type: 'global.change', sourceId: 'v-score', event: ''}, [{id: 'a-win', type: 'scene.change', targetId: 'win', value: true}], {globalId: 'v-score', op: '>=', value: 2}),
    rule('r-axis', {type: 'global.change', sourceId: 'v-move', event: ''}, [{id: 'a-axis', type: 'scene.change', targetId: 'right', value: true}], {globalId: 'v-move', op: '>=', value: 1}),
   ]}}]),
   {id: 'label', name: 'Label', parentId: null, active: true, components: [t('label', 480, 80), {id: 'label-text', type: 'pixi.text', version: 1, data: {alpha: 1, text: 'score {score} move {move}', fontSize: 28, color: '#ffffff', font: ''}}]},
  ]},
  {formatVersion: 1, id: 'win', name: 'Win', entities: [shape('won', 'Won', 480, 270)]},
  {formatVersion: 1, id: 'right', name: 'Right', entities: [shape('went', 'Went right', 480, 270)]},
 ],
 extensions: {
  'interactions.globals': {version: 1, items: [{id: 'v-score', name: 'score', type: 'number', initial: 0}, {id: 'v-move', name: 'move', type: 'number', initial: 0}]},
  'input.map': {version: 1, deadzone: 0.2, actions: [
   {id: 'jump', name: 'jump', kind: 'button', bindings: [{type: 'key', code: 'Space'}, {type: 'mouse', button: 0}, {type: 'gamepadButton', index: 0}]},
   {id: 'move', name: 'move_x', kind: 'axis', globalId: 'v-move', bindings: [{type: 'keyAxis', negative: 'ArrowLeft', positive: 'ArrowRight'}, {type: 'gamepadAxis', index: 0, invert: false}]},
  ]},
 },
};
const file = join(temp, 'Input.pixieditor');

try {
 await writeFile(file, JSON.stringify(project));
 app = await electron.launch({executablePath: process.env.REWRITE_EXECUTABLE || require('electron'), args: [...(process.env.REWRITE_EXECUTABLE ? [] : [join(root, 'apps/editor-desktop/out/main/index.js')]), '--no-hub', `--user-data-dir=${join(temp, 'user')}`], env});
 const page = await app.firstWindow();
 page.setDefaultTimeout(15000);
 const errors = [];
 page.on('pageerror', e => errors.push(e.message));
 const canvas = page.getByTestId('pixi-canvas'), shell = page.getByTestId('editor-shell');
 await expect(canvas).toHaveAttribute('data-ready', 'true', {timeout: 30000});
 const menu = label => app.evaluate(({Menu}, text) => Menu.getApplicationMenu().items.flatMap(m => m.submenu?.items ?? []).find(i => i.label === text).click(), label);
 const choose = path => app.evaluate(({dialog}, target) => {
  dialog.showOpenDialog = async () => ({canceled: false, filePaths: [target]});
  dialog.showSaveDialog = async () => ({canceled: false, filePath: target});
  dialog.showMessageBox = async () => ({response: 1, checkboxChecked: false});
 }, path);
 await choose(file);
 await menu('Open…');
 await expect(page.locator('header strong').first()).toHaveText(/^Main/);
 const scene = async () => JSON.parse(await canvas.getAttribute('data-interactions')).sceneId;

 // Input panel: actions are listed; Listen captures the next key; Undo removes it.
 await page.getByRole('button', {name: 'Input', exact: true}).click();
 const panel = page.getByTestId('input-panel'), jump = panel.locator('[data-action="jump"]');
 await expect(panel.locator('[data-action]')).toHaveCount(2);
 await jump.getByRole('button', {name: 'Listen…', exact: true}).click();
 await expect(jump.getByRole('status')).toBeVisible();
 await page.keyboard.press('KeyW');
 await expect(jump.getByRole('list')).toContainText('W');
 await menu('Undo');
 await expect(jump.getByRole('list')).not.toContainText('W');
 await jump.getByRole('button', {name: 'Listen…', exact: true}).click();
 await page.keyboard.press('Escape');
 await expect(jump.getByRole('status')).toHaveCount(0);
 await page.keyboard.press('Escape');
 await expect(page.getByLabel('Unsaved changes', {exact: true})).toHaveCount(0);
 console.log('PASS Input panel lists actions, captures a key binding with Undo and cancels with Escape');

 // Preview: keys only reach the game when the canvas has focus.
 const point = async (x, y) => { const b = await canvas.locator('canvas').boundingBox(), s = Math.min((b.width - 80) / 960, (b.height - 90) / 540); return {x: b.x + (b.width - 960 * s) / 2 + x * s, y: b.y + (b.height - 540 * s) / 2 + y * s}; };
 await page.getByRole('button', {name: 'Play', exact: true}).click();
 await expect(shell).toHaveAttribute('data-mode', 'playing');
 await page.evaluate(() => (document.activeElement instanceof HTMLElement) && document.activeElement.blur());
 await page.keyboard.down('ArrowRight'); await page.waitForTimeout(150); await page.keyboard.up('ArrowRight');
 expect(await scene()).toBe('main');
 // Click on empty canvas: focuses it and presses the mouse binding of `jump` (score 1); Space makes 2 → win.
 const empty = await point(80, 480);
 await page.mouse.click(empty.x, empty.y);
 await page.waitForTimeout(150);
 expect(await scene()).toBe('main');
 await page.keyboard.press('Space');
 await expect.poll(scene).toBe('win');
 await page.getByRole('button', {name: 'Stop', exact: true}).click();
 // New Preview session: axis from a held key pair writes the global; its condition changes scene.
 await page.getByRole('button', {name: 'Play', exact: true}).click();
 await canvas.focus();
 await page.keyboard.down('ArrowRight');
 await expect.poll(scene).toBe('right');
 await page.keyboard.up('ArrowRight');
 await page.getByRole('button', {name: 'Stop', exact: true}).click();
 // After Stop the editor owns the keys again (W selects the move tool, no game input).
 await expect(shell).toHaveAttribute('data-mode', 'edit');
 console.log('PASS Preview input: canvas-focused keys, mouse binding, key-pair axis global, per-session reset');

 // Export and play with keyboard, mouse and an emulated gamepad.
 const exportDir = join(temp, 'export');
 await mkdir(exportDir);
 await page.getByRole('button', {name: 'Export', exact: true}).click();
 await choose(exportDir);
 await page.getByRole('button', {name: 'Export HTML…', exact: true}).click();
 await expect(page.getByTestId('build-status')).toHaveAttribute('data-phase', 'complete', {timeout: 30000});
 const output = await page.getByTestId('build-output').innerText();
 const bundle = JSON.parse(await readFile(join(output, 'project.json'), 'utf8'));
 expect(bundle.runtimes).toContain('input');
 expect(bundle.project.extensions['input.map'].actions).toHaveLength(2);
 server = createServer(async (req, res) => {
  try {
   const path = resolve(output, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/$/, '/index.html'));
   if (!path.startsWith(resolve(output) + sep)) throw Error('outside');
   res.setHeader('Content-Type', {'.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json'}[extname(path)] ?? 'application/octet-stream');
   res.end(await readFile(path));
  } catch { res.statusCode = 404; res.end(); }
 });
 await new Promise(r => server.listen(0, '127.0.0.1', r));
 browser = await chromium.launch({channel: 'chrome', headless: true, args: ['--enable-unsafe-swiftshader']});
 const play = async () => {
  const game = await browser.newPage({viewport: {width: 1100, height: 700}});
  const gameErrors = [];
  game.on('pageerror', e => gameErrors.push(e.message));
  // Emulated standard gamepad: tests drive window.__pad.
  await game.addInitScript(() => {
   window.__pad = {buttons: Array.from({length: 17}, () => ({pressed: false, value: 0})), axes: [0, 0, 0, 0]};
   navigator.getGamepads = () => [window.__pad];
  });
  await game.goto(`http://127.0.0.1:${server.address().port}`);
  await game.getByRole('button', {name: 'Start', exact: true}).click({timeout: 30000});
  const view = game.locator('#game');
  await expect(view).toHaveAttribute('data-scene-id', 'main');
  return {game, view, gameErrors, texts: async () => JSON.parse(await view.getAttribute('data-texts') ?? '{}')['label-text']};
 };
 let {game, view, gameErrors, texts} = await play();
 await expect.poll(texts).toBe('score 0 move 0');
 await game.mouse.click(60, 60);
 await expect.poll(texts).toBe('score 1 move 0');
 await game.keyboard.press('Space');
 await expect(view).toHaveAttribute('data-scene-id', 'win');
 expect(gameErrors).toEqual([]);
 await game.close();
 ({game, view, gameErrors, texts} = await play());
 await game.evaluate(() => { window.__pad.buttons[0] = {pressed: true, value: 1}; });
 await expect.poll(texts).toBe('score 1 move 0');
 await game.evaluate(() => { window.__pad.buttons[0] = {pressed: false, value: 0}; window.__pad.axes[0] = 0.1; });
 await page.waitForTimeout(100);
 expect(await texts()).toBe('score 1 move 0');
 await game.evaluate(() => { window.__pad.axes[0] = 1; });
 await expect(view).toHaveAttribute('data-scene-id', 'right');
 expect(gameErrors).toEqual([]);
 expect(errors).toEqual([]);
 await mkdir(join(root, 'outputs'), {recursive: true});
 await page.screenshot({path: join(root, 'outputs/editor-input.png')});
 console.log('PASS exported game: mouse and keyboard actions, gamepad button, stick axis with deadzone, global text and conditions');
} catch (error) {
 await mkdir(join(root, 'outputs'), {recursive: true});
 const page = app ? await app.firstWindow().catch(() => null) : null;
 await page?.screenshot({path: join(root, 'outputs/input-failure.png')}).catch(() => {});
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
