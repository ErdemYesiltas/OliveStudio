// Script API: game.spawn copies a hidden scene object (with its body, tween and script, references remapped to the
// copy) and a prefab by name, obj.destroy removes copies, obj.text edits a label, game.pointer and onPointerDown/Up
// follow the mouse. Checked in Preview and in the exported HTML game.
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
const temp = await mkdtemp(join(tmpdir(), 'rewrite-spawn-'));
const env = {...process.env};
delete env.ELECTRON_RUN_AS_NODE;
let app, browser, server, game;

const gunScript = `export function onPointerDown(self: SceneSelf, x: number, y: number) {
  if (y < 200) return;
  const bullet = game.spawn('Bullet', x, y);
  self.state.shots = (self.state.shots ?? 0) + 1;
  const label = game.find('Label'); label.text = 'Shots ' + self.state.shots;
  game.log('shot', bullet.name, Math.round(bullet.x), Math.round(bullet.y), game.pointer.down, label.text);
}
export function onPointerUp(self: SceneSelf, x: number, y: number) { if (y < 200) return; const spark = game.spawn('Spark', x, y + 60); game.log('spark', spark.name, game.pointer.down); }`;
const bulletScript = `export function start(self: GameObject) { if (!self.active) return; self.body.velocity = { x: 420, y: 0 }; game.log('bullet start'); }
export function update(self: GameObject) { if (self.active && self.x > 900) { game.log('bullet gone'); self.destroy(); } }`;
const compile = source => transform(source, {transforms: ['typescript', 'imports'], production: true, disableESTransforms: true}).code;

try {
 const file = join(temp, 'spawn.pixieditor');
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
 const shape = (id, w, color) => ({id: `${id}-s`, type: 'pixi.shape', version: 1, data: {alpha: 1, kind: 'ellipse', width: w, height: w, color, rounded: 0, sides: 5, innerRadius: .5, strokeColor: '#ffffff', strokeWidth: 0}});
 const pulse = id => ({id: `${id}-tw`, type: 'tween.player', version: 1, data: {duration: .3, delay: 0, ease: 'linear', repeat: 100, yoyo: true, autoplay: true, tracks: [{id: `${id}-k`, entityId: id, componentId: `${id}-t`, property: 'scaleX', from: 1, to: 2}]}});
 project.scenes[0].entities = [
  {id: 'bullet', name: 'Bullet', parentId: null, active: false, components: [t('bullet', 100, 100), shape('bullet', 20, '#ffd166'),
   {id: 'bullet-rb', type: 'physics.rigidBody2d', version: 1, data: {bodyType: 'dynamic', density: .001, friction: 0, restitution: 0, airFriction: 0, lockRotation: true, velocityX: 0, velocityY: 0, angularVelocity: 0, frictionStatic: 0, gravityScale: 0, mass: 0, layer: 0, mask: 65535, group: 0, draggable: false, bullet: false}},
   {id: 'bullet-c', type: 'physics.circleCollider2d', version: 1, data: {radius: 10, offsetX: 0, offsetY: 0, sensor: true}},
   {id: 'bullet-b', type: 'scripts.behaviour', version: 1, data: {scriptId: 's-bullet', params: {}, refs: {}}}]},
  {id: 'glow', name: 'Glow', parentId: 'bullet', active: true, components: [t('glow', 0, 0), shape('glow', 34, '#ffe8a3'), pulse('glow')]},
  {id: 'button', name: 'Button', parentId: null, active: true, components: [t('button', 120, 60), {id: 'button-s', type: 'pixi.shape', version: 1, data: {alpha: 1, kind: 'rect', width: 120, height: 50, color: '#06d6a0', rounded: 10, sides: 5, innerRadius: .5, strokeColor: '#ffffff', strokeWidth: 0}},
   {id: 'button-r', type: 'interactions.bindings', version: 1, data: {rules: [{id: 'drop', trigger: {type: 'pointer.click', sourceId: 'button', event: ''}, actions: [{id: 'd1', type: 'entity.spawn', targetId: 'coin', value: true, x: 0, y: 90}, {id: 'd2', type: 'entity.spawn', targetId: 'prefab:0b9a7a8e-55f1-4bf0-9a54-3d2f0f2a9a11', value: false, x: 700, y: 120}]}]}}]},
  {id: 'coin', name: 'Coin', parentId: null, active: false, components: [t('coin', 300, 120), shape('coin', 40, '#ffd166'),
   {id: 'coin-r', type: 'interactions.bindings', version: 1, data: {rules: [{id: 'pick', trigger: {type: 'pointer.click', sourceId: 'coin', event: ''}, actions: [{id: 'p1', type: 'entity.destroy', targetId: 'coin', value: true}]}]}}]},
  {id: 'label', name: 'Label', parentId: null, active: true, components: [t('label', 480, 40), {id: 'label-x', type: 'pixi.text', version: 1, data: {alpha: 1, text: 'Ready', fontSize: 28, color: '#ffffff', font: '', fontWeight: 'normal', fontStyle: 'normal', align: 'center', letterSpacing: 0, strokeColor: '#000000', strokeWidth: 0}}]},
 ];
 const spark = {id: 'spark', name: 'Spark', parentId: null, active: true, components: [t('spark', 0, 0), shape('spark', 30, '#ef476f'), pulse('spark')]};
 project.extensions['prefabs.registry'] = {version: 1, items: [{id: '0b9a7a8e-55f1-4bf0-9a54-3d2f0f2a9a11', name: 'Spark', rootId: 'spark', revision: 1, entities: [spark]}]};
 project.extensions['scripts.library'] = {version: 1, items: [{id: 's-gun', name: 'Gun', source: gunScript, code: compile(gunScript)}, {id: 's-bullet', name: 'Bullet', source: bulletScript, code: compile(bulletScript)}], scenes: {[project.entrySceneId]: {scriptId: 's-gun', params: {}, refs: {}}}};
 await writeFile(file, JSON.stringify(project));
 await choose(file); await menu('Open…');
 await expect.poll(async () => Object.keys(JSON.parse(await canvas.getAttribute('data-transforms') ?? '{}'))).toContain('label');
 const transforms = async () => JSON.parse(await canvas.getAttribute('data-transforms') ?? '{}');
 const consoleLines = async () => { await page.keyboard.press('Alt+KeyC'); const lines = await page.getByTestId('script-console').locator('[data-level]').allInnerTexts(); await page.keyboard.press('Escape'); return lines; };

 // Inspector: the Spawn object action edits its place and offset.
 await page.getByRole('button', {name: 'Layers', exact: true}).click(); await page.getByRole('button', {name: 'Select Button', exact: true}).click(); await page.keyboard.press('Escape');
 await page.getByRole('button', {name: 'Properties', exact: true}).click();
 const props = page.getByTestId('properties');
 if (!await props.getByRole('combobox', {name: 'Spawn place 1.1', exact: true}).count()) await props.locator('summary').filter({hasText: /^Interactions$/}).click();
 await expect(props.getByRole('combobox', {name: 'Spawn place 1.1', exact: true}).locator('option:checked')).toHaveText('At this object');
 await expect(props.getByRole('combobox', {name: 'Spawn place 1.2', exact: true}).locator('option:checked')).toHaveText('At a world position');
 await expect(props.getByLabel('Action y 1.1', {exact: true})).toHaveValue('90');
 await page.keyboard.press('Escape');
 console.log('PASS Inspector: Spawn object place and offset');

 // Preview.
 const at = async (x, y) => { const b = await canvas.locator('canvas').boundingBox(), s = Math.min((b.width - 80) / 960, (b.height - 90) / 540); return {x: b.x + (b.width - 960 * s) / 2 + x * s, y: b.y + (b.height - 540 * s) / 2 + y * s}; };
 await page.getByRole('button', {name: 'Play', exact: true}).click();
 await expect.poll(async () => Number(await canvas.getAttribute('data-runtime-time') ?? 0)).toBeGreaterThan(.2);
 const point = await at(200, 300);
 await page.mouse.move(point.x, point.y); await page.mouse.down();
 const fresh = async () => Object.entries(await transforms()).filter(([id]) => !['bullet', 'glow', 'label', 'button', 'coin'].includes(id));
 await expect.poll(async () => (await fresh()).length).toBe(2);
 const copyId = (await fresh()).find(([, p]) => Math.abs(p.y - 300) < 1 && p.x > 100)[0], glowId = (await fresh()).find(([, p]) => p.x === 0 && p.y === 0)[0];
 await page.mouse.up();
 await expect.poll(async () => (await fresh()).length).toBe(3);
 // The copy moves on its own body and its child pulses on its own (remapped) tween; the hidden template stays put.
 await expect.poll(async () => (await transforms())[copyId]?.x ?? 0).toBeGreaterThan(260);
 await expect.poll(async () => (await transforms())[glowId]?.scaleX ?? 1).toBeGreaterThan(1.05);
 expect((await transforms()).bullet).toMatchObject({x: 100, y: 100});
 expect((await transforms()).glow).toMatchObject({scaleX: 1});
 // It destroys itself past x = 900; the prefab copy stays.
 await expect.poll(async () => Object.keys(await transforms()).includes(copyId), {timeout: 6000}).toBe(false);
 expect(Object.keys(await transforms())).not.toContain(glowId);
 expect((await fresh()).length).toBe(1);
 const sparkPose = (await fresh())[0][1];
 expect(sparkPose.x).toBeCloseTo(200, 1); expect(sparkPose.y).toBeCloseTo(360, 1);
 const lines = await consoleLines();
 expect(lines).toEqual(expect.arrayContaining(['shot Bullet 200 300 true Shots 1', 'spark Spark false', 'bullet start', 'bullet gone']));
 expect(lines.some(l => /error/i.test(l))).toBe(false);
 await page.getByRole('button', {name: 'Stop', exact: true}).click();
 await expect.poll(async () => Object.keys(await transforms()).sort()).toEqual(['bullet', 'button', 'coin', 'glow', 'label']);
 // Rules: the button spawns the hidden coin below itself and the Spark prefab at a point; clicking a coin copy
 // runs its own (remapped) destroy rule.
 await page.getByRole('button', {name: 'Play', exact: true}).click();
 await expect.poll(async () => Number(await canvas.getAttribute('data-runtime-time') ?? 0)).toBeGreaterThan(.2);
 const button = await at(120, 60); await page.mouse.click(button.x, button.y);
 await expect.poll(async () => (await fresh()).length).toBe(2);
 const near = (list, x, y) => list.find(([, p]) => Math.abs(p.x - x) < 1 && Math.abs(p.y - y) < 1);
 const coinCopy = near(await fresh(), 120, 150), ruleSpark = near(await fresh(), 700, 120);
 expect(coinCopy && ruleSpark).toBeTruthy();
 const coinAt = await at(120, 150); await page.mouse.click(coinAt.x, coinAt.y);
 await expect.poll(async () => Object.keys(await transforms()).includes(coinCopy[0])).toBe(false);
 expect(Object.keys(await transforms())).toContain(ruleSpark[0]);
 expect((await transforms()).coin).toMatchObject({x: 300, y: 120});
 await page.getByRole('button', {name: 'Stop', exact: true}).click();
 console.log('PASS Preview rules: Spawn object (near the rule object and a prefab at a point) and Destroy object on a copy');
 console.log('PASS Preview: spawn a hidden object with a child (own body, remapped tween, script) and a prefab, destroy, text, pointer hooks; Stop restores');

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
 const stage = game.locator('#game'), poses = async () => JSON.parse(await stage.getAttribute('data-poses') ?? '{}');
 await expect.poll(async () => Object.keys(await poses())).toContain('label');
 const gameAt = async (x, y) => { const b = await stage.locator('canvas').boundingBox(), s = Math.min(b.width / 960, b.height / 540); return {x: b.x + (b.width - 960 * s) / 2 + x * s, y: b.y + (b.height - 540 * s) / 2 + y * s}; };
 const tap = await gameAt(200, 300);
 await game.mouse.move(tap.x, tap.y); await game.mouse.down(); await game.mouse.up();
 const gameFresh = async () => Object.entries(await poses()).filter(([id]) => !['bullet', 'glow', 'label', 'button', 'coin'].includes(id));
 await expect.poll(async () => (await gameFresh()).length).toBe(3);
 const bulletId = (await gameFresh()).find(([, p]) => Math.abs(p.y - 300) < 1 && p.x > 100)[0], gameGlow = (await gameFresh()).find(([, p]) => p.x === 0 && p.y === 0)[0];
 await expect.poll(async () => (await poses())[gameGlow]?.scaleX ?? 1).toBeGreaterThan(1.05);
 expect((await poses()).glow).toMatchObject({scaleX: 1});
 await expect.poll(async () => Object.keys(await poses()).includes(bulletId), {timeout: 6000}).toBe(false);
 await expect.poll(() => gameLogs).toEqual(expect.arrayContaining(['[script] shot Bullet 200 300 true Shots 1', '[script] bullet start', '[script] bullet gone']));
 const tapButton = await gameAt(120, 60); await game.mouse.click(tapButton.x, tapButton.y);
 const gameNear = async (x, y) => (await gameFresh()).find(([, p]) => Math.abs(p.x - x) < 1 && Math.abs(p.y - y) < 1);
 await expect.poll(async () => Boolean(await gameNear(120, 150) && await gameNear(700, 120))).toBe(true);
 const gameCoin = (await gameNear(120, 150))[0], tapCoin = await gameAt(120, 150);
 await game.mouse.click(tapCoin.x, tapCoin.y);
 await expect.poll(async () => Object.keys(await poses()).includes(gameCoin)).toBe(false);
 expect(gameErrors).toEqual([]);
 expect(errors).toEqual([]);
 console.log('PASS exported game rules: Spawn object near the button and a prefab at a point, Destroy object on the copy');
 console.log('PASS exported game: the same spawn of an object and a shipped prefab, remapped tween, destroy, text and pointer');
} catch (error) {
 await mkdir(join(root, 'outputs'), {recursive: true});
 const page = app ? await app.firstWindow().catch(() => null) : null;
 await page?.screenshot({path: join(root, 'outputs/spawn-failure.png')}).catch(() => {});
 await game?.screenshot({path: join(root, 'outputs/spawn-game-failure.png')}).catch(() => {});
 throw error;
} finally {
 await browser?.close().catch(() => {});
 if (server) await new Promise(r => server.close(r));
 if (app) { await app.evaluate(({BrowserWindow}) => { for (const w of BrowserWindow.getAllWindows()) w.destroy(); }).catch(() => {}); await app.close().catch(() => {}); }
 await rm(temp, {recursive: true, force: true, maxRetries: 3});
}
