// Concave polygon colliders and the collision matrix: a U-shaped static cup holds a ball inside it (not on its hull),
// the debug outline keeps the authored outline; in the Physics panel the collision matrix switches Default × Ghost off,
// so a Ghost-layer box falls through the floor while the ball still lands. Preview and exported HTML.
import {_electron as electron, chromium, expect} from '@playwright/test';
import {createServer} from 'node:http';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {dirname, extname, join, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(join(root, 'apps/editor-desktop/package.json'));
const temp = await mkdtemp(join(tmpdir(), 'rewrite-concave-'));
const env = {...process.env};
delete env.ELECTRON_RUN_AS_NODE;
let app, browser, server, game;
const t = (id, x, y) => ({id: `${id}-t`, type: 'scene.transform2d', version: 1, data: {x, y, rotation: 0, scaleX: 1, scaleY: 1}});
const shape = (id, kind, w, h, color) => ({id: `${id}-s`, type: 'pixi.shape', version: 1, data: {alpha: 1, kind, width: w, height: h, color, rounded: 0, sides: 5, innerRadius: .5, strokeColor: '#ffffff', strokeWidth: 0}});
const rigid = (id, layer = 0) => ({id: `${id}-rb`, type: 'physics.rigidBody2d', version: 1, data: {bodyType: 'dynamic', density: .001, friction: .1, restitution: 0, airFriction: .01, lockRotation: false, velocityX: 0, velocityY: 0, angularVelocity: 0, frictionStatic: .5, gravityScale: 1, mass: 0, layer, mask: 65535, group: 0, draggable: false, bullet: false}});
const box = (id, w, h) => ({id: `${id}-c`, type: 'physics.boxCollider2d', version: 1, data: {width: w, height: h, offsetX: 0, offsetY: 0, sensor: false}});

try {
 const file = join(temp, 'concave.pixieditor');
 app = await electron.launch({executablePath: process.env.REWRITE_EXECUTABLE || require('electron'), args: [...(process.env.REWRITE_EXECUTABLE ? [] : [join(root, 'apps/editor-desktop/out/main/index.js')]), '--no-hub', `--user-data-dir=${join(temp, 'user')}`], env});
 const page = await app.firstWindow();
 page.setDefaultTimeout(15000);
 const errors = [];
 page.on('pageerror', e => errors.push(e.message));
 const canvas = page.getByTestId('pixi-canvas');
 await expect(canvas).toHaveAttribute('data-ready', 'true', {timeout: 30000});
 const menu = label => app.evaluate(({Menu}, label) => Menu.getApplicationMenu().items.flatMap(m => m.submenu?.items ?? []).find(i => i.label === label).click(), label);
 const choose = path => app.evaluate(({dialog}, target) => { dialog.showOpenDialog = async () => ({canceled: false, filePaths: [target]}); dialog.showSaveDialog = async () => ({canceled: false, filePath: target}); dialog.showMessageBox = async () => ({response: 1, checkboxChecked: false}); }, path);
 const save = async () => { await choose(file); await menu('Save'); await expect(page.getByLabel('Unsaved changes', {exact: true})).toHaveCount(0); return JSON.parse(await readFile(file, 'utf8')); };
 await choose(file); await menu('Save');
 await expect.poll(() => readFile(file, 'utf8').then(() => true, () => false)).toBe(true);
 const project = JSON.parse(await readFile(file, 'utf8'));
 project.scenes[0].entities = [
  {id: 'cup', name: 'Cup', parentId: null, active: true, components: [t('cup', 300, 380), {id: 'cup-c', type: 'physics.polygonCollider2d', version: 1, data: {points: '-80,-80 -60,-80 -60,60 60,60 60,-80 80,-80 80,80 -80,80', offsetX: 0, offsetY: 0, sensor: false}}]},
  {id: 'ball', name: 'Ball', parentId: null, active: true, components: [t('ball', 300, 120), shape('ball', 'ellipse', 40, 40, '#ffd166'), rigid('ball'), {id: 'ball-c', type: 'physics.circleCollider2d', version: 1, data: {radius: 20, offsetX: 0, offsetY: 0, sensor: false}}]},
  {id: 'ghost', name: 'Ghost', parentId: null, active: true, components: [t('ghost', 700, 120), shape('ghost', 'rect', 40, 40, '#a0a0ff'), rigid('ghost', 1), box('ghost', 40, 40)]},
  {id: 'floor', name: 'Floor', parentId: null, active: true, components: [t('floor', 700, 500), shape('floor', 'rect', 300, 20, '#8d99ae'), box('floor', 300, 20)]},
 ];
 project.extensions['physics.world'] = {gravityX: 0, gravityY: 980, timeScale: 1, sleeping: false, positionIterations: 8, velocityIterations: 6, walls: false, layers: ['Default', 'Ghost']};
 await writeFile(file, JSON.stringify(project));
 await choose(file); await menu('Open…');
 await expect.poll(async () => Object.keys(JSON.parse(await canvas.getAttribute('data-transforms') ?? '{}'))).toContain('cup');

 // Physics panel: the collision matrix (lower triangle with the diagonal).
 await page.keyboard.press('Alt+KeyY');
 const panel = page.getByTestId('physics-panel');
 const pair = (a, b) => panel.getByRole('checkbox', {name: `Collide ${a} × ${b}`, exact: true});
 await expect(panel.getByTestId('physics-matrix').getByRole('checkbox')).toHaveCount(3);
 await expect(pair('Default', 'Ghost')).toBeChecked();
 await pair('Default', 'Ghost').uncheck();
 await expect(pair('Default', 'Ghost')).not.toBeChecked();
 await expect(pair('Ghost', 'Ghost')).toBeChecked();
 expect((await save()).extensions['physics.world'].collisions).toEqual([65535 & ~2, 65535 & ~1]);
 await panel.getByRole('checkbox', {name: 'Debug colliders', exact: true}).check();
 await page.keyboard.press('Escape');
 console.log('PASS Physics panel: collision matrix pair switched off for both layers and saved');

 // Preview: the ball lands inside the cup; the ghost falls through the floor.
 const poses = async () => JSON.parse(await canvas.getAttribute('data-transforms') ?? '{}');
 await page.getByRole('button', {name: 'Play', exact: true}).click();
 await expect.poll(async () => (await poses()).ghost?.y ?? 0, {timeout: 10000}).toBeGreaterThan(560);
 await expect.poll(async () => { const b = (await poses()).ball; return b && b.y > 380 && b.y < 425 && Math.abs(b.x - 300) < 45; }, {timeout: 10000}).toBe(true);
 await mkdir(join(root, 'outputs'), {recursive: true});
 await page.screenshot({path: join(root, 'outputs/editor-concave.png')});
 await page.getByRole('button', {name: 'Stop', exact: true}).click();
 console.log('PASS Preview: the ball rests inside the concave cup; the Ghost layer passes through Default');

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
 const stage = game.locator('#game'), gamePoses = async () => JSON.parse(await stage.getAttribute('data-poses') ?? '{}');
 await expect.poll(async () => (await gamePoses()).ghost?.y ?? 0, {timeout: 10000}).toBeGreaterThan(560);
 await expect.poll(async () => { const b = (await gamePoses()).ball; return b && b.y > 380 && b.y < 425 && Math.abs(b.x - 300) < 45; }, {timeout: 10000}).toBe(true);
 expect(gameErrors).toEqual([]);
 expect(errors).toEqual([]);
 console.log('PASS exported game: the same cup and matrix');
} catch (error) {
 await mkdir(join(root, 'outputs'), {recursive: true});
 const page = app ? await app.firstWindow().catch(() => null) : null;
 await page?.screenshot({path: join(root, 'outputs/concave-failure.png')}).catch(() => {});
 await game?.screenshot({path: join(root, 'outputs/concave-game-failure.png')}).catch(() => {});
 throw error;
} finally {
 await browser?.close().catch(() => {});
 if (server) await new Promise(r => server.close(r));
 if (app) { await app.evaluate(({BrowserWindow}) => { for (const w of BrowserWindow.getAllWindows()) w.destroy(); }).catch(() => {}); await app.close().catch(() => {}); }
 await rm(temp, {recursive: true, force: true, maxRetries: 3});
}
