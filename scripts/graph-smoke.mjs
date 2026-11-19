// Logic graph: build nodes in the editor (add, Connect to, drag-to-connect, move by header, remove a link, undo),
// and run a graph (click → add to a global → branch on it → hide a lamp → delay → show it) in Preview and in the
// exported game, checked with pixels.
import {_electron as electron, chromium, expect} from '@playwright/test';
import {createServer} from 'node:http';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {dirname, extname, join, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(join(root, 'apps/editor-desktop/package.json')), sharp = require('sharp');
const temp = await mkdtemp(join(tmpdir(), 'rewrite-graph-'));
const env = {...process.env};
delete env.ELECTRON_RUN_AS_NODE;
let app, browser, server, game;
const near = (p, c, d = 40) => Math.abs(p[0] - c[0]) < d && Math.abs(p[1] - c[1]) < d && Math.abs(p[2] - c[2]) < d;
const WHITE = [255, 255, 255];

try {
 const file = join(temp, 'graph.pixieditor');
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
 const box = (id, w, color) => ({id: `${id}-s`, type: 'pixi.shape', version: 1, data: {alpha: 1, kind: 'rect', width: w, height: w, color, rounded: 0, sides: 5, innerRadius: .5, strokeColor: '#ffffff', strokeWidth: 0}});
 const node = (id, kind, x, y, more) => ({id, kind, x, y, ...more});
 project.extensions['pixi.render'] = {version: 1, background: '#101820'};
 project.extensions['interactions.globals'] = {version: 1, items: [{id: 'g-score', name: 'score', type: 'number', initial: 0}]};
 project.scenes[0].entities = [
  {id: 'button', name: 'Button', parentId: null, active: true, components: [t('button', 200, 270), box('button', 100, '#06d6a0')]},
  {id: 'lamp', name: 'Lamp', parentId: null, active: true, components: [t('lamp', 700, 270), box('lamp', 100, '#ffffff')]},
  {id: 'brain', name: 'Brain', parentId: null, active: true, components: [t('brain', 40, 40), {id: 'brain-g', type: 'interactions.graph', version: 1, data: {
   nodes: [node('click', 'event', 20, 20, {trigger: {type: 'pointer.click', sourceId: 'button', event: ''}}), node('add', 'action', 280, 20, {action: {id: 'a1', type: 'global.add', targetId: 'g-score', value: true, amount: 1}}),
    node('check', 'branch', 540, 20, {condition: {globalId: 'g-score', op: '>=', value: 2}}), node('off', 'action', 800, 20, {action: {id: 'a2', type: 'entity.active', targetId: 'lamp', value: false}}),
    node('wait', 'delay', 800, 260, {seconds: .5}), node('on', 'action', 1060, 260, {action: {id: 'a3', type: 'entity.active', targetId: 'lamp', value: true}})],
   links: [{id: 'l1', from: 'click', port: 'next', to: 'add'}, {id: 'l2', from: 'add', port: 'next', to: 'check'}, {id: 'l3', from: 'check', port: 'true', to: 'off'}, {id: 'l4', from: 'off', port: 'next', to: 'wait'}, {id: 'l5', from: 'wait', port: 'next', to: 'on'}]}}]},
  {id: 'scratch', name: 'Scratch', parentId: null, active: true, components: [t('scratch', 60, 500)]},
 ];
 await writeFile(file, JSON.stringify(project));
 await choose(file); await menu('Open…');
 await expect.poll(async () => Object.keys(JSON.parse(await canvas.getAttribute('data-transforms') ?? '{}'))).toContain('brain');

 // Editor: build a small graph on Scratch.
 await page.getByRole('button', {name: 'Layers', exact: true}).click(); await page.getByRole('button', {name: 'Select Scratch', exact: true}).click(); await page.keyboard.press('Escape');
 await page.keyboard.press('Alt+KeyN');
 const panel = page.getByTestId('graph-panel');
 await panel.getByRole('button', {name: 'Add a logic graph', exact: true}).click();
 await panel.getByRole('button', {name: '+ Event', exact: true}).click();
 await panel.getByRole('button', {name: '+ Action', exact: true}).click();
 await panel.getByRole('button', {name: '+ Delay', exact: true}).click();
 const event = panel.getByRole('group', {name: 'Event 1', exact: true}), action = panel.getByRole('group', {name: 'Action 2', exact: true}), delay = panel.getByRole('group', {name: 'Delay 3', exact: true});
 await event.getByRole('combobox', {name: 'Event 1 When', exact: true}).selectOption('pointer.click');
 await event.getByRole('combobox', {name: 'Event 1 Source', exact: true}).selectOption('button');
 await event.getByRole('combobox', {name: 'Event 1 Connect next to', exact: true}).selectOption({label: 'Action 2'});
 await expect(panel.locator('.graph-unlink')).toHaveCount(1);
 // Drag from Action 2's output dot to Delay 3's input dot.
 const from = await action.locator('.graph-port.out').boundingBox(), to = await delay.locator('[data-graph-input]').boundingBox();
 await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2); await page.mouse.down();
 await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {steps: 8}); await page.mouse.up();
 await expect(panel.locator('.graph-unlink')).toHaveCount(2);
 // Move Delay 3 by its header.
 const before = await delay.boundingBox(), header = await delay.locator('header span').boundingBox();
 await page.mouse.move(header.x + 5, header.y + 5); await page.mouse.down(); await page.mouse.move(header.x + 125, header.y + 65, {steps: 6}); await page.mouse.up();
 await expect.poll(async () => Math.round((await delay.boundingBox()).x - before.x)).toBe(120);
 await panel.getByRole('button', {name: 'Remove link Event 1 next → Action 2', exact: true}).dispatchEvent('click');
 await expect(panel.locator('.graph-unlink')).toHaveCount(1);
 await menu('Undo');
 await expect(panel.locator('.graph-unlink')).toHaveCount(2);
 console.log('PASS editor: add nodes, Connect to, drag-to-connect, move by header, remove a link, undo');
 await page.keyboard.press('Escape');
 await page.getByRole('button', {name: 'Layers', exact: true}).click(); await page.getByRole('button', {name: 'Select Brain', exact: true}).click(); await page.keyboard.press('Escape');
 await page.keyboard.press('Alt+KeyN'); await expect(panel.getByRole('group', {name: 'Delay 5', exact: true})).toBeVisible();
 await mkdir(join(root, 'outputs'), {recursive: true}); await page.screenshot({path: join(root, 'outputs/editor-graph.png')});
 await page.keyboard.press('Escape');

 // Preview: two clicks hide the lamp (branch true), the delay shows it again.
 const at = async (x, y) => { const b = await canvas.locator('canvas').boundingBox(), s = Math.min((b.width - 80) / 960, (b.height - 90) / 540); return {x: b.x + (b.width - 960 * s) / 2 + x * s, y: b.y + (b.height - 540 * s) / 2 + y * s}; };
 const pixel = async (x, y) => { const b = await canvas.locator('canvas').boundingBox(), p = await at(x, y), shot = await canvas.locator('canvas').screenshot(), ratio = (await sharp(shot).metadata()).width / b.width; return [...await sharp(shot).extract({left: Math.round((p.x - b.x) * ratio), top: Math.round((p.y - b.y) * ratio), width: 1, height: 1}).removeAlpha().raw().toBuffer()]; };
 await page.getByRole('button', {name: 'Play', exact: true}).click();
 await expect.poll(async () => near(await pixel(700, 270), WHITE)).toBe(true);
 const button = await at(200, 270);
 await page.mouse.click(button.x, button.y);
 await page.waitForTimeout(150);
 expect(near(await pixel(700, 270), WHITE)).toBe(true);
 await page.mouse.click(button.x, button.y);
 await expect.poll(async () => near(await pixel(700, 270), WHITE), {timeout: 2000}).toBe(false);
 await expect.poll(async () => near(await pixel(700, 270), WHITE), {timeout: 3000}).toBe(true);
 await page.getByRole('button', {name: 'Stop', exact: true}).click();
 console.log('PASS Preview: event → action → branch → action → delay → action');

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
 await game.goto(`http://127.0.0.1:${server.address().port}`);
 await game.getByRole('button', {name: 'Start', exact: true}).click({timeout: 30000});
 const stage = game.locator('#game');
 const gameAt = async (x, y) => { const b = await stage.locator('canvas').boundingBox(), s = Math.min(b.width / 960, b.height / 540); return {x: b.x + (b.width - 960 * s) / 2 + x * s, y: b.y + (b.height - 540 * s) / 2 + y * s}; };
 const lampActive = async () => JSON.parse(await stage.getAttribute('data-poses') ?? '{}').lamp?.active;
 await expect.poll(lampActive).toBe(true);
 const tap = await gameAt(200, 270);
 await game.mouse.click(tap.x, tap.y); await game.waitForTimeout(150);
 expect(await lampActive()).toBe(true);
 await game.mouse.click(tap.x, tap.y);
 await expect.poll(lampActive, {timeout: 2000}).toBe(false);
 await expect.poll(lampActive, {timeout: 3000}).toBe(true);
 expect(gameErrors).toEqual([]);
 expect(errors).toEqual([]);
 console.log('PASS exported game: the same graph flow');
} catch (error) {
 await mkdir(join(root, 'outputs'), {recursive: true});
 const page = app ? await app.firstWindow().catch(() => null) : null;
 await page?.screenshot({path: join(root, 'outputs/graph-failure.png')}).catch(() => {});
 throw error;
} finally {
 await browser?.close().catch(() => {});
 if (server) await new Promise(r => server.close(r));
 if (app) { await app.evaluate(({BrowserWindow}) => { for (const w of BrowserWindow.getAllWindows()) w.destroy(); }).catch(() => {}); await app.close().catch(() => {}); }
 await rm(temp, {recursive: true, force: true, maxRetries: 3});
}
