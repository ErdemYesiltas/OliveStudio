// Timeline onion skin and animation cross-fades. The Timeline panel's Onion skin shows the moving object at earlier
// and later times around the playhead (static objects get no ghost; frames, spacing and Off follow the controls).
// A rule cross-fades the box from its Walk clip to Jump over 0.6 s: y travels through the values in between instead
// of jumping, x (not in Jump) stays where it was. Checked in Preview and in the exported HTML game.
import {_electron as electron, chromium, expect} from '@playwright/test';
import {createServer} from 'node:http';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {dirname, extname, join, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(join(root, 'apps/editor-desktop/package.json'));
const temp = await mkdtemp(join(tmpdir(), 'rewrite-onion-'));
const env = {...process.env};
delete env.ELECTRON_RUN_AS_NODE;
let app, browser, server, game;
const t = (id, x, y) => ({id: `${id}-t`, type: 'scene.transform2d', version: 1, data: {x, y, rotation: 0, scaleX: 1, scaleY: 1}});
const rect = (id, w, color) => ({id: `${id}-s`, type: 'pixi.shape', version: 1, data: {alpha: 1, kind: 'rect', width: w, height: w, color, rounded: 6, sides: 5, innerRadius: .5, strokeColor: '#ffffff', strokeWidth: 0}});
const key = (id, time, value) => ({id, time, value, ease: 'linear'});
const walk = {id: 'walk', name: 'Walk', duration: 1, repeat: 0, yoyo: false, markers: [], clips: [], tracks: [{id: 'wx', entityId: 'box', componentId: 'box-t', property: 'x', keys: [key('w1', 0, 100), key('w2', 1, 500)]}]};
const jump = {id: 'jump', name: 'Jump', duration: 1, repeat: 0, yoyo: false, markers: [], clips: [], tracks: [{id: 'jy', entityId: 'box', componentId: 'box-t', property: 'y', keys: [key('j1', 0, 50), key('j2', 1, 50)]}]};
/** Samples the box pose every frame for a while (Preview: data-transforms, game: data-poses). */
const sample = (target, attribute, ms) => target.evaluate(async ({attribute, ms}) => {
 const el = document.querySelector(`[${attribute}]`), out = [], end = performance.now() + ms;
 while (performance.now() < end) { const box = JSON.parse(el.getAttribute(attribute) ?? '{}').box; if (box) out.push([box.x, box.y]); await new Promise(r => requestAnimationFrame(r)); }
 return out;
}, {attribute, ms});
const checkFade = samples => {
 const ys = samples.map(s => s[1]);
 expect(ys.some(y => y > 70 && y < 180)).toBe(true);
 expect(ys.at(-1)).toBeCloseTo(50, 3);
 for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeLessThanOrEqual(ys[i - 1] + 1e-6);
 const xs = samples.map(s => s[0]);
 expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(1e-6);
};

try {
 const file = join(temp, 'onion.pixieditor');
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
 project.scenes[0].entities = [
  {id: 'box', name: 'Box', parentId: null, active: true, components: [t('box', 100, 200), rect('box', 60, '#3a86ff'),
   {id: 'box-player', type: 'animation.player', version: 1, data: {activeClipId: 'walk', autoplay: true, clips: [walk, jump]}},
   {id: 'box-r', type: 'interactions.bindings', version: 1, data: {rules: [{id: 'go', trigger: {type: 'pointer.click', sourceId: 'button', event: ''}, actions: [{id: 'f', type: 'animation.crossFade', targetId: 'box-player', value: true, to: 'Jump', amount: .6}]}]}}]},
  {id: 'eye', name: 'Eye', parentId: 'box', active: true, components: [t('eye', 10, -10), rect('eye', 12, '#ffffff')]},
  {id: 'wall', name: 'Wall', parentId: null, active: true, components: [t('wall', 480, 420), rect('wall', 120, '#8d99ae')]},
  {id: 'button', name: 'Button', parentId: null, active: true, components: [t('button', 860, 60), rect('button', 80, '#06d6a0')]},
 ];
 await writeFile(file, JSON.stringify(project));
 await choose(file); await menu('Open…');
 await expect.poll(async () => Object.keys(JSON.parse(await canvas.getAttribute('data-transforms') ?? '{}'))).toContain('wall');

 // Onion skin in the Timeline panel.
 await page.getByRole('button', {name: 'Layers', exact: true}).click();
 await page.getByRole('button', {name: 'Select Box', exact: true}).click();
 await page.keyboard.press('Escape');
 await page.keyboard.press('Alt+KeyT');
 const timeline = page.getByTestId('animation-timeline');
 await expect(timeline).toBeVisible();
 await timeline.getByRole('slider', {name: 'Clip time', exact: true}).fill('0.5');
 await expect.poll(async () => JSON.parse(await canvas.getAttribute('data-transforms')).box.x).toBeCloseTo(300, 3);
 await timeline.getByRole('checkbox', {name: 'Onion skin', exact: true}).check();
 const onion = async () => JSON.parse(await canvas.getAttribute('data-onion-frames') ?? '[]');
 await expect.poll(async () => (await onion()).map(f => f.time)).toEqual([.3, .4, .7, .6]);
 const frames = await onion();
 expect(frames.map(f => Math.round(f.poses.box.x))).toEqual([220, 260, 380, 340]);
 expect(frames.every(f => !('wall' in f.poses) && !('button' in f.poses))).toBe(true);
 await expect(canvas).toHaveAttribute('data-onion', '4');
 await mkdir(join(root, 'outputs'), {recursive: true});
 await page.screenshot({path: join(root, 'outputs/editor-onion.png')});
 await timeline.getByRole('combobox', {name: 'Onion frames after', exact: true}).selectOption('0');
 await timeline.getByRole('combobox', {name: 'Onion spacing (frames at 60 fps)', exact: true}).selectOption('15');
 await expect.poll(async () => (await onion()).map(f => f.time)).toEqual([0, .25]);
 await timeline.getByRole('slider', {name: 'Clip time', exact: true}).fill('0.1');
 await expect.poll(async () => (await onion()).map(f => f.time)).toEqual([]);
 await timeline.getByRole('slider', {name: 'Clip time', exact: true}).fill('0.8');
 await expect.poll(async () => (await onion()).map(f => f.time)).toEqual([.3, .55]);
 await timeline.getByRole('checkbox', {name: 'Onion skin', exact: true}).uncheck();
 await expect(canvas).toHaveAttribute('data-onion', '0');
 await timeline.getByRole('button', {name: 'Reset pose', exact: true}).click();
 await page.keyboard.press('Escape');
 console.log('PASS onion skin: ghosts of the moving object before/after the playhead (statics excluded), frames, spacing, clip ends, Off');

 // Cross-fade rule in Preview.
 const at = async (x, y) => { const b = await canvas.locator('canvas').boundingBox(), s = Math.min((b.width - 80) / 960, (b.height - 90) / 540); return {x: b.x + (b.width - 960 * s) / 2 + x * s, y: b.y + (b.height - 540 * s) / 2 + y * s}; };
 await page.getByRole('button', {name: 'Play', exact: true}).click();
 await expect.poll(async () => JSON.parse(await canvas.getAttribute('data-transforms')).box.x).toBeGreaterThan(200);
 const button = await at(860, 60);
 await page.mouse.click(button.x, button.y);
 checkFade(await sample(page, 'data-transforms', 1200));
 await page.getByRole('button', {name: 'Stop', exact: true}).click();
 console.log('PASS Preview: Cross-fade to clip blends y from the Walk pose to Jump over 0.6 s; x stays');

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
 const stage = game.locator('#game');
 await expect.poll(async () => JSON.parse(await stage.getAttribute('data-poses') ?? '{}').box?.x ?? 0).toBeGreaterThan(200);
 const gameAt = async (x, y) => { const b = await stage.locator('canvas').boundingBox(), s = Math.min(b.width / 960, b.height / 540); return {x: b.x + (b.width - 960 * s) / 2 + x * s, y: b.y + (b.height - 540 * s) / 2 + y * s}; };
 const tap = await gameAt(860, 60);
 await game.mouse.click(tap.x, tap.y);
 checkFade(await sample(game, 'data-poses', 1200));
 expect(gameErrors).toEqual([]);
 expect(errors).toEqual([]);
 console.log('PASS exported game: the same cross-fade');
} catch (error) {
 await mkdir(join(root, 'outputs'), {recursive: true});
 const page = app ? await app.firstWindow().catch(() => null) : null;
 await page?.screenshot({path: join(root, 'outputs/onion-failure.png')}).catch(() => {});
 await game?.screenshot({path: join(root, 'outputs/onion-game-failure.png')}).catch(() => {});
 throw error;
} finally {
 await browser?.close().catch(() => {});
 if (server) await new Promise(r => server.close(r));
 if (app) { await app.evaluate(({BrowserWindow}) => { for (const w of BrowserWindow.getAllWindows()) w.destroy(); }).catch(() => {}); await app.close().catch(() => {}); }
 await rm(temp, {recursive: true, force: true, maxRetries: 3});
}
