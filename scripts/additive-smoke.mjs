// Additive scenes: a rule adds the HUD scene to the running Main scene (its objects, rules, tween and script join with
// their own IDs), the HUD script adds a third scene with game.addScene, adding twice does nothing, Remove added scene
// takes the HUD out (the third scene stays) and adding again brings a fresh copy. Main has no scripts of its own, so
// the HUD script also checks the sandbox kept ready for scripted objects that join later. Preview and exported HTML.
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
const temp = await mkdtemp(join(tmpdir(), 'rewrite-additive-'));
const env = {...process.env};
delete env.ELECTRON_RUN_AS_NODE;
let app, browser, server, game;
const panelScript = `export function start(self: GameObject) { game.log('panel start'); game.addScene('Extra'); }
export function update(self: GameObject, dt: number) {
  if (self.x < 600) self.x += 240 * dt;
  if (!self.state.seen && game.find('Badge').active) { self.state.seen = true; game.log('badge on'); }
}`;
const compile = source => transform(source, {transforms: ['typescript', 'imports'], production: true, disableESTransforms: true}).code;
const t = (id, x, y) => ({id: `${id}-t`, type: 'scene.transform2d', version: 1, data: {x, y, rotation: 0, scaleX: 1, scaleY: 1}});
const rect = (id, w, h, color) => ({id: `${id}-s`, type: 'pixi.shape', version: 1, data: {alpha: 1, kind: 'rect', width: w, height: h, color, rounded: 8, sides: 5, innerRadius: .5, strokeColor: '#ffffff', strokeWidth: 0}});
const click = (id, actions) => ({id: `${id}-r`, type: 'interactions.bindings', version: 1, data: {rules: [{id: `${id}-rule`, trigger: {type: 'pointer.click', sourceId: id, event: ''}, actions}]}});
const MAIN = ['button', 'close', 'title'];

try {
 const file = join(temp, 'additive.pixieditor');
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
 const main = project.scenes[0];
 main.name = 'Main';
 main.entities = [
  {id: 'button', name: 'Open HUD', parentId: null, active: true, components: [t('button', 120, 60), rect('button', 140, 50, '#06d6a0'), click('button', [{id: 'b1', type: 'scene.add', targetId: 'hud', value: true}])]},
  {id: 'close', name: 'Close HUD', parentId: null, active: true, components: [t('close', 320, 60), rect('close', 140, 50, '#ef476f'), click('close', [{id: 'c1', type: 'scene.remove', targetId: 'hud', value: true}])]},
  {id: 'title', name: 'Title', parentId: null, active: true, components: [t('title', 700, 60), rect('title', 200, 40, '#3a86ff')]},
 ];
 project.scenes.push({formatVersion: 1, id: 'hud', name: 'HUD', entities: [
  {id: 'hud-panel', name: 'Panel', parentId: null, active: true, components: [t('hud-panel', 480, 420), rect('hud-panel', 300, 80, '#222a44'), {id: 'hud-panel-b', type: 'scripts.behaviour', version: 1, data: {scriptId: 's-panel', params: {}, refs: {}}},
   {id: 'hud-panel-r', type: 'interactions.bindings', version: 1, data: {rules: [{id: 'on-start', trigger: {type: 'scene.start', sourceId: 'hud', event: ''}, actions: [{id: 's1', type: 'entity.active', targetId: 'hud-badge', value: true}]}]}}]},
  {id: 'hud-badge', name: 'Badge', parentId: 'hud-panel', active: false, components: [t('hud-badge', 100, 0), rect('hud-badge', 30, 30, '#ffd166'),
   {id: 'hud-badge-tw', type: 'tween.player', version: 1, data: {duration: .3, delay: 0, ease: 'linear', repeat: 100, yoyo: true, autoplay: true, tracks: [{id: 'hud-badge-k', entityId: 'hud-badge', componentId: 'hud-badge-t', property: 'scaleX', from: 1, to: 2}]}}]},
 ]}, {formatVersion: 1, id: 'extra', name: 'Extra', entities: [
  {id: 'extra-star', name: 'Star', parentId: null, active: true, components: [t('extra-star', 860, 300), rect('extra-star', 40, 40, '#ffbe0b')]},
 ]});
 project.extensions['scripts.library'] = {version: 1, items: [{id: 's-panel', name: 'Panel', source: panelScript, code: compile(panelScript)}]};
 await writeFile(file, JSON.stringify(project));
 await choose(file); await menu('Open…');
 await expect.poll(async () => Object.keys(JSON.parse(await canvas.getAttribute('data-transforms') ?? '{}'))).toContain('title');
 const transforms = async () => JSON.parse(await canvas.getAttribute('data-transforms') ?? '{}');
 const added = async () => JSON.parse(await canvas.getAttribute('data-added-scenes') ?? '[]');
 const consoleLines = async () => { await page.keyboard.press('Alt+KeyC'); const lines = await page.getByTestId('script-console').locator('[data-level]').allInnerTexts(); await page.keyboard.press('Escape'); return lines; };

 // The Scenes flow shows Main → HUD (rule) and HUD → Extra (script).
 await page.getByRole('button', {name: 'Scenes', exact: true}).click();
 await expect.poll(async () => JSON.parse(await page.getByTestId('scene-flow').getAttribute('data-edges') ?? '[]')).toEqual(expect.arrayContaining([['Main', 'HUD'], ['HUD', 'Extra']]));
 await page.keyboard.press('Escape');

 const at = async (x, y) => { const b = await canvas.locator('canvas').boundingBox(), s = Math.min((b.width - 80) / 960, (b.height - 90) / 540); return {x: b.x + (b.width - 960 * s) / 2 + x * s, y: b.y + (b.height - 540 * s) / 2 + y * s}; };
 await page.getByRole('button', {name: 'Play', exact: true}).click();
 await expect.poll(async () => Number(await canvas.getAttribute('data-runtime-time') ?? 0)).toBeGreaterThan(.2);
 expect(Object.keys(await transforms()).sort()).toEqual([...MAIN].sort());
 const open = await at(120, 60), close = await at(320, 60);
 await page.mouse.click(open.x, open.y);
 await expect.poll(async () => Object.keys(await transforms()).sort()).toEqual([...MAIN, 'extra-star', 'hud-badge', 'hud-panel'].sort());
 await expect.poll(added).toEqual(['hud', 'extra']);
 await expect.poll(async () => (await transforms())['hud-panel'].x).toBeGreaterThan(560);
 await expect.poll(async () => (await transforms())['hud-badge'].scaleX).toBeGreaterThan(1.05);
 await expect.poll(consoleLines).toEqual(expect.arrayContaining(['panel start', 'badge on']));
 await page.mouse.click(open.x, open.y);
 await page.waitForTimeout(300);
 expect(Object.keys(await transforms()).filter(id => id.startsWith('hud-')).sort()).toEqual(['hud-badge', 'hud-panel']);
 await page.mouse.click(close.x, close.y);
 await expect.poll(async () => Object.keys(await transforms()).sort()).toEqual([...MAIN, 'extra-star'].sort());
 await expect.poll(added).toEqual(['extra']);
 await page.mouse.click(open.x, open.y);
 await expect.poll(async () => Object.keys(await transforms())).toContain('hud-panel');
 expect((await transforms())['hud-panel'].x).toBeLessThan(560);
 expect((await consoleLines()).filter(l => /error/i.test(l))).toEqual([]);
 await page.getByRole('button', {name: 'Stop', exact: true}).click();
 await expect.poll(async () => Object.keys(await transforms()).sort()).toEqual([...MAIN].sort());
 console.log('PASS Preview: a rule adds the HUD scene (rules, tween, script), its script adds a third scene, adding twice is a no-op, remove takes it out, Stop restores');

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
 const stage = game.locator('#game'), poses = async () => JSON.parse(await stage.getAttribute('data-poses') ?? '{}'), gameAdded = async () => JSON.parse(await stage.getAttribute('data-added-scenes') ?? '[]');
 await expect.poll(async () => Object.keys(await poses())).toContain('title');
 const gameAt = async (x, y) => { const b = await stage.locator('canvas').boundingBox(), s = Math.min(b.width / 960, b.height / 540); return {x: b.x + (b.width - 960 * s) / 2 + x * s, y: b.y + (b.height - 540 * s) / 2 + y * s}; };
 const gOpen = await gameAt(120, 60), gClose = await gameAt(320, 60);
 await game.mouse.click(gOpen.x, gOpen.y);
 await expect.poll(async () => Object.keys(await poses()).sort()).toEqual([...MAIN, 'extra-star', 'hud-badge', 'hud-panel'].sort());
 await expect.poll(gameAdded).toEqual(['hud', 'extra']);
 await expect.poll(async () => (await poses())['hud-panel'].x).toBeGreaterThan(560);
 await expect.poll(async () => (await poses())['hud-badge'].scaleX).toBeGreaterThan(1.05);
 await expect.poll(async () => (await poses())['hud-badge'].active).toBe(true);
 await expect.poll(() => gameLogs).toEqual(expect.arrayContaining(['[script] panel start', '[script] badge on']));
 await game.mouse.click(gOpen.x, gOpen.y);
 await game.waitForTimeout(300);
 expect(Object.keys(await poses()).filter(id => id.startsWith('hud-')).sort()).toEqual(['hud-badge', 'hud-panel']);
 await game.mouse.click(gClose.x, gClose.y);
 await expect.poll(async () => Object.keys(await poses()).sort()).toEqual([...MAIN, 'extra-star'].sort());
 await expect.poll(gameAdded).toEqual(['extra']);
 expect(gameErrors).toEqual([]);
 expect(errors).toEqual([]);
 await mkdir(join(root, 'outputs'), {recursive: true});
 await game.screenshot({path: join(root, 'outputs/additive-game.png')});
 console.log('PASS exported game: the same additive HUD, nested add from a script, no duplicate, remove');
} catch (error) {
 await mkdir(join(root, 'outputs'), {recursive: true});
 const page = app ? await app.firstWindow().catch(() => null) : null;
 await page?.screenshot({path: join(root, 'outputs/additive-failure.png')}).catch(() => {});
 await game?.screenshot({path: join(root, 'outputs/additive-game-failure.png')}).catch(() => {});
 throw error;
} finally {
 await browser?.close().catch(() => {});
 if (server) await new Promise(r => server.close(r));
 if (app) { await app.evaluate(({BrowserWindow}) => { for (const w of BrowserWindow.getAllWindows()) w.destroy(); }).catch(() => {}); await app.close().catch(() => {}); }
 await rm(temp, {recursive: true, force: true, maxRetries: 3});
}
