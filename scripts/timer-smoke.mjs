// Timers: a repeating autostart Timer drives a state machine (Timer finished) and a script's onTimer, which stops it
// with self.stop('timer') after three ticks; a button rule starts a one-shot timer whose end moves the machine on.
// Checked in Preview and in the exported HTML game.
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
const temp = await mkdtemp(join(tmpdir(), 'rewrite-timer-'));
const env = {...process.env};
delete env.ELECTRON_RUN_AS_NODE;
let app, browser, server, game;
const clockScript = `export function onTimer(self: GameObject) {
  self.state.n = (self.state.n ?? 0) + 1;
  game.log('tick', self.state.n);
  if (self.state.n === 3) self.stop('timer');
}`;
const compile = source => transform(source, {transforms: ['typescript', 'imports'], production: true, disableESTransforms: true}).code;

try {
 const file = join(temp, 'timer.pixieditor');
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
 const timer = (id, seconds, repeat, autostart) => ({id: `${id}-timer`, type: 'interactions.timer', version: 1, data: {seconds, repeat, autostart}});
 const state = (id, name) => ({id, name, actions: []}), go = (id, from, to, sourceId) => ({id, from, to, trigger: {type: 'timer.done', sourceId, event: ''}});
 project.scenes[0].entities = [
  {id: 'clock', name: 'Clock', parentId: null, active: true, components: [t('clock', 100, 100), timer('clock', .5, true, true), {id: 'clock-b', type: 'scripts.behaviour', version: 1, data: {scriptId: 's-clock', params: {}, refs: {}}}]},
  {id: 'delay', name: 'Delay', parentId: null, active: true, components: [t('delay', 100, 200), timer('delay', .4, false, false)]},
  {id: 'button', name: 'Button', parentId: null, active: true, components: [t('button', 480, 300), {id: 'button-s', type: 'pixi.shape', version: 1, data: {alpha: 1, kind: 'rect', width: 160, height: 60, color: '#06d6a0', rounded: 10, sides: 5, innerRadius: .5, strokeColor: '#ffffff', strokeWidth: 0}},
   {id: 'button-r', type: 'interactions.bindings', version: 1, data: {rules: [{id: 'go', trigger: {type: 'pointer.click', sourceId: 'button', event: ''}, actions: [{id: 'go-1', type: 'timer.start', targetId: 'delay-timer', value: true}]}]}}]},
  {id: 'flow', name: 'Flow', parentId: null, active: true, components: [t('flow', 100, 300), {id: 'flow-sm', type: 'interactions.stateMachine', version: 1, data: {initial: 'idle', states: [state('idle', 'Idle'), state('one', 'One'), state('two', 'Two'), state('three', 'Three'), state('done', 'Done')],
   transitions: [go('t1', 'idle', 'one', 'clock-timer'), go('t2', 'one', 'two', 'clock-timer'), go('t3', 'two', 'three', 'clock-timer'), go('t4', 'three', 'done', 'delay-timer')]}}]},
 ];
 project.extensions['scripts.library'] = {version: 1, items: [{id: 's-clock', name: 'Clock', source: clockScript, code: compile(clockScript)}]};
 await writeFile(file, JSON.stringify(project));
 await choose(file); await menu('Open…');
 await expect.poll(async () => Object.keys(JSON.parse(await canvas.getAttribute('data-transforms') ?? '{}'))).toContain('flow');

 // Preview.
 const machine = async () => JSON.parse(await canvas.getAttribute('data-interactions') ?? '{}').states?.['flow-sm'];
 const timers = async () => JSON.parse(await canvas.getAttribute('data-timers') ?? '{}');
 const consoleLines = async () => { await page.keyboard.press('Alt+KeyC'); const lines = await page.getByTestId('script-console').locator('[data-level]').allInnerTexts(); await page.keyboard.press('Escape'); return lines; };
 await page.getByRole('button', {name: 'Play', exact: true}).click();
 await expect.poll(machine, {timeout: 4000}).toBe('Three');
 await expect.poll(async () => (await timers())['clock-timer']?.running).toBe(false);
 await page.waitForTimeout(800);
 expect(await machine()).toBe('Three');
 expect((await timers())['delay-timer']).toMatchObject({running: false});
 const b = await canvas.locator('canvas').boundingBox(), s = Math.min((b.width - 80) / 960, (b.height - 90) / 540);
 await page.mouse.click(b.x + (b.width - 960 * s) / 2 + 480 * s, b.y + (b.height - 540 * s) / 2 + 300 * s);
 await expect.poll(async () => (await timers())['delay-timer']?.running).toBe(true);
 await expect.poll(machine).toBe('Done');
 const ticks = (await consoleLines()).filter(l => l.startsWith('tick'));
 expect(ticks).toEqual(['tick 1', 'tick 2', 'tick 3']);
 await page.getByRole('button', {name: 'Stop', exact: true}).click();
 console.log('PASS Preview: repeating timer drives a state machine and onTimer, self.stop(\'timer\'), a rule starts a one-shot timer');

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
 const gameErrors = [], gameLogs = [];
 game.on('pageerror', e => gameErrors.push(e.message));
 game.on('console', m => { if (m.type() === 'error') gameErrors.push(m.text().slice(0, 300)); else if (m.text().startsWith('[script]')) gameLogs.push(m.text()); });
 await game.goto(`http://127.0.0.1:${server.address().port}`);
 await game.getByRole('button', {name: 'Start', exact: true}).click({timeout: 30000});
 const stage = game.locator('#game');
 const gameMachine = async () => JSON.parse(await stage.getAttribute('data-states') ?? '{}')['flow-sm'];
 await expect.poll(gameMachine, {timeout: 4000}).toBe('Three');
 await game.waitForTimeout(800);
 expect(await gameMachine()).toBe('Three');
 const g = await stage.locator('canvas').boundingBox(), k = Math.min(g.width / 960, g.height / 540);
 await game.mouse.click(g.x + (g.width - 960 * k) / 2 + 480 * k, g.y + (g.height - 540 * k) / 2 + 300 * k);
 await expect.poll(gameMachine).toBe('Done');
 expect(gameLogs.filter(l => l.includes('tick'))).toEqual(['[script] tick 1', '[script] tick 2', '[script] tick 3']);
 expect(gameErrors).toEqual([]);
 expect(errors).toEqual([]);
 console.log('PASS exported game: the same timers, state machine, onTimer and rule start');
} catch (error) {
 await mkdir(join(root, 'outputs'), {recursive: true});
 const page = app ? await app.firstWindow().catch(() => null) : null;
 await page?.screenshot({path: join(root, 'outputs/timer-failure.png')}).catch(() => {});
 await game?.screenshot({path: join(root, 'outputs/timer-game-failure.png')}).catch(() => {});
 throw error;
} finally {
 await browser?.close().catch(() => {});
 if (server) await new Promise(r => server.close(r));
 if (app) { await app.evaluate(({BrowserWindow}) => { for (const w of BrowserWindow.getAllWindows()) w.destroy(); }).catch(() => {}); await app.close().catch(() => {}); }
 await rm(temp, {recursive: true, force: true, maxRetries: 3});
}
