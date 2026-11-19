// Matter physics, full feature set: a kinematic platform moved by a tween carries a crate, a ghost on its own layer
// falls through the ground and the stage walls, a pendulum hangs from a world point (joint), a brick lands on a tilemap
// with solid collision, a rule pushes a ball, the pointer drags the ball, and scripts use body/mass, raycasts and
// onCollision(self, other, contact). Authoring: layer names, layer/mask editor, joint target, new collider types.
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
const temp = await mkdtemp(join(tmpdir(), 'rewrite-physics-world-'));
const env = {...process.env};
delete env.ELECTRON_RUN_AS_NODE;
let app, browser, server, game;

const ballScript = `export function start(self: GameObject) { game.log('mass', self.body.mass > 0); }
export function onCollision(self: GameObject, other: GameObject, contact: Contact) {
  if (other.name === 'ground' && !self.state.landed) { self.state.landed = true; game.log('landed', other.name, contact.normalY !== 0); }
}`;
const sceneScript = `export function start() {
  const hit = game.physics.raycast(360, 0, 360, 540);
  game.log('ray', hit ? hit.object.name : 'none', hit ? Math.round(hit.y / 10) * 10 : 0);
}`;
const compile = source => transform(source, {transforms: ['typescript', 'imports'], production: true, disableESTransforms: true}).code;

try {
 const file = join(temp, 'physics.pixieditor');
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
 await choose(file); await menu('Save');
 await expect.poll(() => readFile(file, 'utf8').then(() => true, () => false)).toBe(true);
 const project = JSON.parse(await readFile(file, 'utf8'));
 const t = (id, x, y) => ({id: `${id}-t`, type: 'scene.transform2d', version: 1, data: {x, y, rotation: 0, scaleX: 1, scaleY: 1}});
 const shape = (id, w, h, color) => ({id: `${id}-s`, type: 'pixi.shape', version: 1, data: {alpha: 1, kind: 'rect', width: w, height: h, color, rounded: 0, sides: 5, innerRadius: .5, strokeColor: '#ffffff', strokeWidth: 0}});
 const body = (id, data = {}) => ({id: `${id}-rb`, type: 'physics.rigidBody2d', version: 1, data: {bodyType: 'dynamic', density: .001, friction: .4, restitution: 0, airFriction: .01, lockRotation: false, velocityX: 0, velocityY: 0, angularVelocity: 0, frictionStatic: .8, gravityScale: 1, mass: 0, layer: 0, mask: 65535, group: 0, draggable: false, bullet: false, ...data}});
 const box = (id, w, h) => ({id: `${id}-box`, type: 'physics.boxCollider2d', version: 1, data: {width: w, height: h, offsetX: 0, offsetY: 0, sensor: false, chamfer: 0}});
 const entity = (id, x, y, ...components) => ({id, name: id, parentId: null, active: true, components: [t(id, x, y), ...components]});
 project.scenes[0].entities = [
  entity('ground', 480, 520, shape('ground', 960, 40, '#556677'), box('ground', 960, 40)),
  entity('kicker', 880, 60, shape('kicker', 60, 60, '#e0a020'), {id: 'kicker-r', type: 'interactions.bindings', version: 1, data: {rules: [{id: 'kick', trigger: {type: 'pointer.click', sourceId: 'kicker', event: ''}, actions: [{id: 'push', type: 'physics.push', targetId: 'ball', value: true, x: 500, y: -400}]}]}}),
  entity('ball', 200, 440, shape('ball', 40, 40, '#e04040'), body('ball', {draggable: true}), {id: 'ball-c', type: 'physics.circleCollider2d', version: 1, data: {radius: 20, offsetX: 0, offsetY: 0, sensor: false}}, {id: 'ball-b', type: 'scripts.behaviour', version: 1, data: {scriptId: 's-ball', params: {}}}),
  entity('platform', 360, 380, shape('platform', 160, 20, '#40a0e0'), body('platform', {bodyType: 'kinematic'}), box('platform', 160, 20),
   {id: 'platform-tw', type: 'tween.player', version: 1, data: {duration: 2, delay: 0, ease: 'linear', repeat: 0, yoyo: false, autoplay: true, tracks: [{id: 'px', entityId: 'platform', componentId: 'platform-t', property: 'x', from: 360, to: 600}]}}),
  entity('crate', 360, 350, shape('crate', 40, 40, '#a07040'), body('crate'), box('crate', 40, 40)),
  entity('ghost', 700, 100, shape('ghost', 40, 40, '#c0c0ff'), body('ghost', {layer: 1, mask: 2}), box('ghost', 40, 40)),
  entity('pendulum', 100, 200, shape('pendulum', 30, 30, '#40e080'), body('pendulum'), box('pendulum', 30, 30),
   {id: 'pendulum-j', type: 'physics.joint2d', version: 1, data: {kind: 'distance', target: '', anchorX: 0, anchorY: 0, targetAnchorX: 100, targetAnchorY: 60, length: 0, stiffness: 1, damping: 0, collideConnected: true}}),
  entity('map', 560, 200, {id: 'map-tm', type: 'pixi.tilemap', version: 1, data: {assetId: '', tileWidth: 32, tileHeight: 32, columns: 4, rows: 1, alpha: 1, tiles: [0, 0, 0, 0], collision: 'solid'}}),
  entity('brick', 600, 100, shape('brick', 20, 20, '#e06060'), body('brick'), box('brick', 20, 20)),
 ];
 project.extensions['physics.world'] = {gravityX: 0, gravityY: 980, timeScale: 1, sleeping: false, positionIterations: 8, velocityIterations: 6, walls: true, layers: ['Default', 'Ghost']};
 project.extensions['scripts.library'] = {version: 1, items: [{id: 's-ball', name: 'Ball', source: ballScript, code: compile(ballScript)}, {id: 's-scene', name: 'Probe', source: sceneScript, code: compile(sceneScript)}], scenes: {[project.entrySceneId]: {scriptId: 's-scene', params: {}, refs: {}}}};
 await writeFile(file, JSON.stringify(project));
 await choose(file); await menu('Open…');
 await expect.poll(async () => Object.keys(JSON.parse(await canvas.getAttribute('data-transforms') ?? '{}'))).toContain('brick');
 const transforms = async () => JSON.parse(await canvas.getAttribute('data-transforms') ?? '{}');
 const runtime = async () => JSON.parse(await canvas.getAttribute('data-physics') ?? '{}').runtime ?? {};

 // Authoring: layer names in the Physics panel, the layer/mask editor and the joint target in Properties, new collider types.
 await page.keyboard.press('Alt+KeyY');
 const panel = page.getByTestId('physics-panel');
 await expect(panel.getByRole('textbox', {name: 'Layer name 1', exact: true})).toHaveValue('Ghost');
 await expect(panel.getByRole('checkbox', {name: 'Walls around the stage', exact: true})).toBeChecked();
 await expect(panel).toContainText('Joints: 1');
 await page.keyboard.press('Escape');
 const pick = async name => { await page.getByRole('button', {name: 'Layers', exact: true}).click(); await page.getByRole('button', {name: `Select ${name}`, exact: true}).click(); await page.keyboard.press('Escape'); };
 await pick('ghost');
 await page.getByRole('button', {name: 'Properties', exact: true}).click();
 const props = page.getByTestId('properties');
 await props.locator('summary').filter({hasText: /^Rigid Body 2D$/}).click();
 await expect(props.getByRole('combobox', {name: 'Layer', exact: true}).locator('option:checked')).toHaveText('1 · Ghost');
 await expect(props.getByRole('checkbox', {name: 'Collides with Default', exact: true})).not.toBeChecked();
 await expect(props.getByRole('checkbox', {name: 'Collides with Ghost', exact: true})).toBeChecked();
 await props.getByRole('checkbox', {name: 'Collides with Default', exact: true}).check();
 await props.getByRole('checkbox', {name: 'Collides with Default', exact: true}).uncheck();
 await expect(props.getByRole('combobox', {name: 'Add component', exact: true}).locator('option')).toContainText(['Capsule Collider 2D', 'Polygon Collider 2D', 'Joint 2D']);
 await page.keyboard.press('Escape');
 await pick('pendulum');
 await page.getByRole('button', {name: 'Properties', exact: true}).click();
 await props.locator('summary').filter({hasText: /^Joint 2D$/}).click();
 await expect(props.getByRole('combobox', {name: 'Connected to', exact: true}).locator('option:checked')).toHaveText('A point in the world');
 await page.keyboard.press('Escape');
 console.log('PASS authoring: layer names and world settings in the Physics panel, layer/mask checkboxes and the joint target in Properties, capsule/polygon/joint components');

 // Preview.
 const view = async () => { const b = await canvas.locator('canvas').boundingBox(), s = Math.min((b.width - 80) / 960, (b.height - 90) / 540); return {at: (x, y) => ({x: b.x + (b.width - 960 * s) / 2 + x * s, y: b.y + (b.height - 540 * s) / 2 + y * s})}; };
 await page.getByRole('button', {name: 'Play', exact: true}).click();
 await expect.poll(async () => (await runtime()).steps ?? 0).toBeGreaterThan(150);
 let p = await transforms();
 expect(p.ghost.y).toBeGreaterThan(600);
 expect(Math.abs(Math.hypot(p.pendulum.x - 100, p.pendulum.y - 60) - 140)).toBeLessThan(8);
 expect(Math.abs(p.brick.y - 190)).toBeLessThan(3);
 await expect.poll(async () => (await transforms()).crate.x, {timeout: 10000}).toBeGreaterThan(520);
 expect((await transforms()).crate.y).toBeLessThan(360);
 expect((await runtime()).joints).toEqual(['pendulum-j']);
 const consoleLog = async () => { await page.keyboard.press('Alt+KeyC'); const lines = await page.getByTestId('script-console').locator('[data-level]').allInnerTexts(); await page.keyboard.press('Escape'); return lines; };
 expect(await consoleLog()).toEqual(expect.arrayContaining(['mass true', 'ray crate 330', 'landed ground true']));
 const before = (await transforms()).ball;
 const kick = (await view()).at(880, 60);
 await page.mouse.click(kick.x, kick.y);
 await expect.poll(async () => (await transforms()).ball.x, {timeout: 5000}).toBeGreaterThan(before.x + 80);
 await expect.poll(async () => (await transforms()).ball.y, {timeout: 5000}).toBeGreaterThan(450);
 const ball = (await transforms()).ball, from = (await view()).at(ball.x, ball.y), to = (await view()).at(300, 250);
 await page.mouse.move(from.x, from.y); await page.mouse.down();
 await expect.poll(async () => (await runtime()).dragging).toBe('ball');
 await page.mouse.move(to.x, to.y, {steps: 12});
 await expect.poll(async () => { const b = (await transforms()).ball; return Math.hypot(b.x - 300, b.y - 250); }, {timeout: 5000}).toBeLessThan(40);
 await page.mouse.up();
 await expect.poll(async () => (await runtime()).dragging).toBeNull();
 await page.getByRole('button', {name: 'Stop', exact: true}).click();
 expect((await transforms()).ball).toMatchObject({x: 200, y: 440});
 console.log('PASS Preview: kinematic platform carries the crate, layer mask lets the ghost through ground and walls, pendulum joint, tilemap collision, rule push, pointer drag, script mass/raycast/onCollision with contact');

 // Export: the same world in the browser game.
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
 const stage = game.locator('#game'), poses = async () => JSON.parse(await stage.getAttribute('data-poses') ?? '{}');
 await expect.poll(async () => (await poses()).ghost?.y ?? 0, {timeout: 10000}).toBeGreaterThan(600);
 await expect.poll(async () => (await poses()).crate.x, {timeout: 10000}).toBeGreaterThan(520);
 p = await poses();
 expect(Math.abs(Math.hypot(p.pendulum.x - 100, p.pendulum.y - 60) - 140)).toBeLessThan(8);
 expect(Math.abs(p.brick.y - 190)).toBeLessThan(3);
 await expect.poll(() => gameLogs).toEqual(expect.arrayContaining(['[script] mass true', '[script] ray crate 330', '[script] landed ground true']));
 const at = async (x, y) => { const b = await stage.locator('canvas').boundingBox(), s = Math.min(b.width / 960, b.height / 540); return {x: b.x + (b.width - 960 * s) / 2 + x * s, y: b.y + (b.height - 540 * s) / 2 + y * s}; };
 const start = (await poses()).ball, kickAt = await at(880, 60);
 await game.mouse.click(kickAt.x, kickAt.y);
 await expect.poll(async () => (await poses()).ball.x, {timeout: 5000}).toBeGreaterThan(start.x + 80);
 await game.waitForTimeout(1500);
 const resting = (await poses()).ball, grab = await at(resting.x, resting.y), drop = await at(300, 250);
 await game.mouse.move(grab.x, grab.y); await game.mouse.down(); await game.mouse.move(drop.x, drop.y, {steps: 12});
 await expect.poll(async () => { const b = (await poses()).ball; return Math.hypot(b.x - 300, b.y - 250); }, {timeout: 5000}).toBeLessThan(40);
 await game.mouse.up();
 expect(gameErrors).toEqual([]);
 expect(errors).toEqual([]);
 console.log('PASS exported game: the same kinematic carry, layers, joint, tilemap collision, rule push, pointer drag and script physics');
} catch (error) {
 await mkdir(join(root, 'outputs'), {recursive: true});
 const page = app ? await app.firstWindow().catch(() => null) : null;
 await page?.screenshot({path: join(root, 'outputs/physics-world-failure.png')}).catch(() => {});
 await game?.screenshot({path: join(root, 'outputs/physics-world-game-failure.png')}).catch(() => {});
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
