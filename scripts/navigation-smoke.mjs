// Pathfinding: a Nav Grid shows its blocked cells in the editor; in Preview and the exported game a scripted agent
// walks around a wall (through the gap) and counts onArrive, a rule-driven agent walks to a point and its Arrived rule
// hides a flag, and a follower chases the walker.
import {_electron as electron, chromium, expect} from '@playwright/test';
import {createServer} from 'node:http';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {dirname, extname, join, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(join(root, 'apps/editor-desktop/package.json'));
const sharp = require('sharp');
const {transform} = createRequire(join(root, 'modules/scripts/package.json'))('sucrase');
const compile = source => transform(source, {transforms: ['typescript', 'imports'], production: true, disableESTransforms: true}).code;
const temp = await mkdtemp(join(tmpdir(), 'rewrite-navigation-'));
const env = {...process.env};
delete env.ELECTRON_RUN_AS_NODE;
let app, browser, server, game;
const walkerScript = `export function start(self: GameObject) {
  game.navigation.moveTo(self, 800, 150);
}
export function onArrive(self: GameObject) {
  globals.arrived = globals.arrived + 1;
}`;
try {
 const file = join(temp, 'navigation.pixieditor');
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
 const shape = (id, color, kind = 'ellipse', size = 28) => ({id: `${id}-s`, type: 'pixi.shape', version: 1, data: {alpha: 1, kind, width: size, height: size, color, rounded: 0, sides: 5, innerRadius: .5, strokeColor: '#ffffff', strokeWidth: 0}});
 const agent = (id, data = {}) => ({id: `${id}-a`, type: 'navigation.agent', version: 1, data: {speed: 400, arriveDistance: 2, follow: '', repath: .2, face: false, ...data}});
 const entity = (id, x, y, ...components) => ({id, name: id, parentId: null, active: true, components: [t(id, x, y), ...components]});
 project.scenes[0].entities = [
  entity('nav', 480, 270, {id: 'nav-g', type: 'navigation.grid', version: 1, data: {cellSize: 24, width: 960, height: 540, clearance: 16, diagonal: true, show: true}}),
  entity('wall', 480, 200, {id: 'wall-c', type: 'physics.boxCollider2d', version: 1, data: {width: 40, height: 380, offsetX: 0, offsetY: 0, sensor: false, chamfer: 0}}),
  entity('flag', 860, 480, shape('flag', '#40c060', 'rect', 40)),
  entity('walker', 150, 150, shape('walker', '#f2b84b'), agent('walker'), {id: 'walker-b', type: 'scripts.behaviour', version: 1, data: {scriptId: 's-walker', params: {}, refs: {}}}),
  entity('runner', 150, 480, shape('runner', '#5bc0eb'), agent('runner'), {id: 'runner-r', type: 'interactions.bindings', version: 1, data: {rules: [
   {id: 'go', trigger: {type: 'scene.start', sourceId: sceneId, event: ''}, actions: [{id: 'go-1', type: 'navigation.moveTo', targetId: 'runner', value: true, x: 760, y: 480}]},
   {id: 'done', trigger: {type: 'navigation.arrived', sourceId: 'runner', event: ''}, actions: [{id: 'done-1', type: 'entity.active', targetId: 'flag', value: false}]},
  ]}}),
  entity('chaser', 150, 300, shape('chaser', '#c38df2'), agent('chaser', {follow: 'walker', speed: 450})),
 ];
 project.extensions['interactions.globals'] = {version: 1, items: [{id: 'g-arrived', name: 'arrived', type: 'number', initial: 0}]};
 project.extensions['scripts.library'] = {version: 1, items: [{id: 's-walker', name: 'Walker', source: walkerScript, code: compile(walkerScript)}]};
 await writeFile(file, JSON.stringify(project));
 await choose(file); await menu('Open…');
 await expect.poll(async () => Object.keys(JSON.parse(await canvas.getAttribute('data-transforms') ?? '{}'))).toContain('chaser');
 const view = async () => { const b = await canvas.locator('canvas').boundingBox(), s = Math.min((b.width - 80) / 960, (b.height - 90) / 540); return {b, at: (x, y) => ({x: b.x + (b.width - 960 * s) / 2 + x * s, y: b.y + (b.height - 540 * s) / 2 + y * s})}; };
 const pixel = async (x, y) => {
  const {b, at} = await view(), p = at(x, y), buffer = await canvas.locator('canvas').screenshot(), ratio = (await sharp(buffer).metadata()).width / b.width;
  return [...await sharp(buffer).extract({left: Math.round((p.x - b.x) * ratio), top: Math.round((p.y - b.y) * ratio), width: 1, height: 1}).removeAlpha().raw().toBuffer()];
 };
 const tinted = ([r, g, b]) => r > g + 20 && r > b + 10;
 await expect.poll(async () => tinted(await pixel(470, 190))).toBe(true);
 expect(tinted(await pixel(470, 470))).toBe(false);
 expect(tinted(await pixel(310, 190))).toBe(false);
 console.log('PASS editor: the Nav Grid tints the wall and its clearance, the gap below stays open');

 const where = async id => JSON.parse(await canvas.getAttribute('data-transforms'))[id];
 await page.getByRole('button', {name: 'Play', exact: true}).click();
 let lowest = 0;
 await expect.poll(async () => { const w = await where('walker'); lowest = Math.max(lowest, w.y); return Math.hypot(w.x - 800, w.y - 150) < 3; }, {timeout: 15000, intervals: [50]}).toBe(true);
 expect(lowest).toBeGreaterThan(390);
 await expect.poll(async () => { const r = await where('runner'); return Math.hypot(r.x - 760, r.y - 480) < 3; }).toBe(true);
 await expect.poll(async () => { const [r, g] = await pixel(860, 480); return g > r + 60; }, {message: 'flag hidden'}).toBe(false);
 await expect.poll(async () => { const c = await where('chaser'), w = await where('walker'); return Math.hypot(c.x - w.x, c.y - w.y) < 40; }).toBe(true);
 await page.keyboard.press('F3');
 await expect(canvas.locator('[data-debug-overlay]')).toContainText('arrived = 1');
 await page.keyboard.press('F3');
 await page.getByRole('button', {name: 'Stop', exact: true}).click();
 await expect.poll(async () => (await where('walker')).x).toBe(150);
 console.log('PASS Preview: the scripted agent goes through the gap and runs onArrive once, the rule agent arrives and hides the flag, the follower catches up');

 const exportDir = join(temp, 'export');
 await mkdir(exportDir);
 await page.getByRole('button', {name: 'Export', exact: true}).click();
 await choose(exportDir);
 await page.getByRole('button', {name: 'Export HTML…', exact: true}).click();
 await expect(page.getByTestId('build-status')).toHaveAttribute('data-phase', /complete|failed/, {timeout: 30000});
 expect(await page.getByTestId('build-status').innerText()).not.toMatch(/Error/);
 const output = await page.getByTestId('build-output').innerText();
 const bundle = JSON.parse(await readFile(join(output, 'project.json'), 'utf8'));
 expect(bundle.runtimes).toEqual(expect.arrayContaining(['navigation', 'scripts']));
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
 const pose = async id => JSON.parse(await stage.getAttribute('data-poses') ?? '{}')[id];
 await expect.poll(async () => { const w = await pose('walker'); return w && Math.hypot(w.x - 800, w.y - 150) < 3; }, {timeout: 15000}).toBe(true);
 await expect.poll(async () => (await pose('flag'))?.active).toBe(false);
 await expect.poll(async () => { const c = await pose('chaser'), w = await pose('walker'); return Math.hypot(c.x - w.x, c.y - w.y) < 40; }).toBe(true);
 expect(gameErrors).toEqual([]);
 expect(errors).toEqual([]);
 console.log('PASS exported game: the navigation chunk walks the same agents and fires the same rules');
} catch (error) {
 await mkdir(join(root, 'outputs'), {recursive: true});
 const page = app ? await app.firstWindow().catch(() => null) : null;
 await page?.screenshot({path: join(root, 'outputs/navigation-failure.png')}).catch(() => {});
 await game?.screenshot({path: join(root, 'outputs/navigation-game-failure.png')}).catch(() => {});
 throw error;
} finally {
 await browser?.close().catch(() => {});
 if (server) await new Promise(r => server.close(r));
 if (app) { await app.evaluate(({BrowserWindow}) => { for (const w of BrowserWindow.getAllWindows()) w.destroy(); }).catch(() => {}); await app.close().catch(() => {}); }
 await rm(temp, {recursive: true, force: true, maxRetries: 3});
}
