// Wave A visuals: effects (colour filter), shape masks (normal and inverse), bitmap text with global templates, and
// play/stop actions for particles and sprite sheets — in the editor, in Preview and in exported HTML.
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
const temp = await mkdtemp(join(tmpdir(), 'rewrite-visuals-'));
const env = {...process.env};
delete env.ELECTRON_RUN_AS_NODE;
const RED = [220, 60, 60], GREEN = [60, 200, 90], BLUE = [60, 90, 220], WHITE = [255, 255, 255];
const hex = c => '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
const near = (a, b, tolerance = 10) => a.every((v, i) => Math.abs(v - b[i]) <= tolerance);
const gray = p => Math.max(...p) - Math.min(...p) <= 12 && !near(p, RED, 40);
let app, browser, server, game;

try {
 // Two-frame sheet: frame 0 red, frame 1 green.
 await sharp({create: {width: 64, height: 32, channels: 4, background: {r: RED[0], g: RED[1], b: RED[2], alpha: 1}}}).composite([{input: {create: {width: 32, height: 32, channels: 4, background: {r: GREEN[0], g: GREEN[1], b: GREEN[2], alpha: 1}}}, left: 32, top: 0}]).png().toFile(join(temp, 'sheet.png'));
 const file = join(temp, 'visuals.pixieditor');
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

 await page.getByRole('button', {name: 'Library', exact: true}).click();
 await choose(join(temp, 'sheet.png'));
 await page.getByRole('button', {name: 'Import image…', exact: true}).click();
 await expect(page.getByTestId('asset-list').getByText('sheet', {exact: true})).toBeVisible({timeout: 30000});
 await page.keyboard.press('Escape');
 await choose(file); await menu('Save');
 await expect.poll(() => readFile(file, 'utf8').then(() => true, () => false)).toBe(true);
 const project = JSON.parse(await readFile(file, 'utf8')), sheet = project.extensions['assets.registry'].items.find(a => a.type === 'pixi.texture').id;
 const t = (id, x, y) => ({id: `${id}-t`, type: 'scene.transform2d', version: 1, data: {x, y, rotation: 0, scaleX: 1, scaleY: 1}});
 const shape = (id, color, size = 100) => ({id: `${id}-s`, type: 'pixi.shape', version: 1, data: {alpha: 1, kind: 'rect', width: size, height: size, color: hex(color), rounded: 0, sides: 5, innerRadius: .5, strokeColor: '#ffffff', strokeWidth: 0}});
 const entity = (id, x, y, ...components) => ({id, name: id, parentId: null, active: true, components: [t(id, x, y), ...components]});
 const effects = {blendMode: 'normal', blur: 0, brightness: 1, contrast: 1, saturation: 0, hue: 0, noise: 0, shadowAlpha: 0, shadowColor: '#000000', shadowX: 4, shadowY: 4, shadowBlur: 2, glowStrength: 0, glowColor: '#ffd27a', glowDistance: 12, outlineWidth: 0, outlineColor: '#ffffff', pixelate: 0};
 const mask = inverse => ({id: `m-${inverse}`, type: 'pixi.mask', version: 1, data: {shape: 'rect', width: 100, height: 100, offsetX: 0, offsetY: 0, radius: 0, inverse}});
 const click = (id, actions) => ({id: `${id}-b`, type: 'interactions.bindings', version: 1, data: {rules: [{id: `${id}-r`, trigger: {type: 'pointer.click', sourceId: id, event: ''}, actions}]}});
 project.scenes[0].entities = [
  entity('gray', 120, 100, shape('gray', RED), {id: 'gray-e', type: 'pixi.effects', version: 1, data: effects}),
  entity('masked', 300, 100, shape('masked', BLUE, 200), mask(false)),
  entity('inverse', 520, 100, shape('inverse', BLUE, 200), mask(true)),
  entity('label', 780, 100, {id: 'label-b', type: 'pixi.bitmapText', version: 1, data: {alpha: 1, text: 'Score {score}', fontSize: 32, color: '#ffffff', font: '', letterSpacing: 0, align: 'center'}}),
  entity('spark', 200, 330, {id: 'spark-p', type: 'pixi.particles', version: 1, data: {assetId: '', alpha: 1, tint: '#ffffff', count: 10, lifetime: 1, speed: 0, direction: 0, spread: 0, gravity: 0, size: 40, endScale: 1, endAlpha: 1, seed: 1, emission: 'continuous', autoplay: false}}),
  entity('flip', 400, 330, {id: 'flip-f', type: 'pixi.flipbook', version: 1, data: {assetId: sheet, columns: 2, rows: 1, frames: 2, fps: 2, loop: false, autoplay: false, width: 80, height: 80, anchorX: .5, anchorY: .5, alpha: 1}}),
  entity('go', 600, 330, shape('go', GREEN, 80), click('go', [{id: 'go-1', type: 'particles.play', targetId: 'spark-p', value: true}, {id: 'go-2', type: 'flipbook.play', targetId: 'flip-f', value: true}])),
  entity('halt', 780, 330, shape('halt', [120, 120, 120], 80), click('halt', [{id: 'halt-1', type: 'particles.stop', targetId: 'spark-p', value: true}, {id: 'halt-2', type: 'flipbook.stop', targetId: 'flip-f', value: true}])),
 ];
 project.extensions['interactions.globals'] = {version: 1, items: [{id: 'v-score', name: 'score', type: 'number', initial: 7}]};
 await writeFile(file, JSON.stringify(project));
 await choose(file); await menu('Open…');
 await expect.poll(async () => JSON.parse(await canvas.getAttribute('data-visuals') ?? '[]').length, {timeout: 30000}).toBe(2);
 await expect.poll(async () => JSON.parse(await canvas.getAttribute('data-visuals')).every(v => v.ready)).toBe(true);

 const view = async () => { const b = await canvas.locator('canvas').boundingBox(), s = Math.min((b.width - 80) / 960, (b.height - 90) / 540); return {b, at: (x, y) => ({x: b.x + (b.width - 960 * s) / 2 + x * s, y: b.y + (b.height - 540 * s) / 2 + y * s})}; };
 const pixel = async (x, y) => {
  const {b, at} = await view(), p = at(x, y), buffer = await canvas.locator('canvas').screenshot(), ratio = (await sharp(buffer).metadata()).width / b.width;
  return [...await sharp(buffer).extract({left: Math.round((p.x - b.x) * ratio), top: Math.round((p.y - b.y) * ratio), width: 1, height: 1}).removeAlpha().raw().toBuffer()];
 };
 const stillChecks = [['grayscale', 120, 100, gray], ['mask inside', 300, 100, p => near(p, BLUE)], ['mask outside', 370, 100, p => !near(p, BLUE, 40)], ['inverse inside', 520, 100, p => !near(p, BLUE, 40)], ['inverse outside', 590, 100, p => near(p, BLUE)], ['idle particles', 200, 330, p => !near(p, WHITE, 40)], ['sheet frame 0', 400, 330, p => near(p, RED)]];
 for (const [label, x, y, ok] of stillChecks) await expect.poll(async () => ok(await pixel(x, y)), {message: label}).toBe(true);
 console.log('PASS editor: saturation filter, mask and inverse mask, idle particles and sheet hold frame 0');

 // Preview: "go" starts particles and the sheet; "halt" stops emission (particles finish) and freezes the sheet.
 await page.getByRole('button', {name: 'Play', exact: true}).click();
 const press = async (x, y) => { const p = (await view()).at(x, y); await page.mouse.click(p.x, p.y); };
 await press(600, 330);
 await expect.poll(async () => near(await pixel(200, 330), WHITE, 20)).toBe(true);
 await expect.poll(async () => near(await pixel(400, 330), GREEN)).toBe(true);
 await press(780, 330);
 await expect.poll(async () => !near(await pixel(200, 330), WHITE, 40), {timeout: 5000}).toBe(true);
 expect(near(await pixel(400, 330), GREEN)).toBe(true);
 await page.getByRole('button', {name: 'Stop', exact: true}).click();
 await expect.poll(async () => near(await pixel(400, 330), RED)).toBe(true);
 console.log('PASS Preview: particles start and stop by actions, sprite sheet plays and freezes, Stop restores');

 // Export: effects chunk, bitmap text template, same pixels and actions in Chrome.
 const exportDir = join(temp, 'export');
 await mkdir(exportDir);
 await page.getByRole('button', {name: 'Export', exact: true}).click();
 await choose(exportDir);
 await page.getByRole('button', {name: 'Export HTML…', exact: true}).click();
 await expect(page.getByTestId('build-status')).toHaveAttribute('data-phase', /complete|failed/, {timeout: 30000});
 expect(await page.getByTestId('build-status').innerText()).not.toMatch(/Error/);
 const output = await page.getByTestId('build-output').innerText();
 const bundle = JSON.parse(await readFile(join(output, 'project.json'), 'utf8'));
 expect(bundle.runtimes).toEqual(expect.arrayContaining(['effects', 'objects', 'flipbook']));
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
 game = await browser.newPage({viewport: {width: 960, height: 540}});
 const gameErrors = [];
 game.on('pageerror', e => gameErrors.push(e.message));
 game.on('console', m => { if (m.type() === 'error') gameErrors.push(m.text().slice(0, 300)); });
 await game.goto(`http://127.0.0.1:${server.address().port}`);
 await game.getByRole('button', {name: 'Start', exact: true}).click({timeout: 30000});
 const stage = game.locator('#game');
 await expect(stage).toHaveAttribute('data-scene-id', project.entrySceneId);
 await expect.poll(async () => JSON.parse(await stage.getAttribute('data-texts') ?? '{}')['label-b']).toBe('Score 7');
 const at = async (x, y) => { const box = await stage.locator('canvas').boundingBox(), s = Math.min(box.width / 960, box.height / 540); return {x: box.x + (box.width - 960 * s) / 2 + x * s, y: box.y + (box.height - 540 * s) / 2 + y * s}; };
 const gamePixel = async (x, y) => { const p = await at(x, y), buffer = await game.screenshot(); return [...await sharp(buffer).extract({left: Math.round(p.x), top: Math.round(p.y), width: 1, height: 1}).removeAlpha().raw().toBuffer()]; };
 for (const [label, x, y, ok] of stillChecks) await expect.poll(async () => ok(await gamePixel(x, y)), {message: `game ${label}`}).toBe(true);
 const go = await at(600, 330); await game.mouse.click(go.x, go.y);
 await expect.poll(async () => near(await gamePixel(200, 330), WHITE, 20)).toBe(true);
 await expect.poll(async () => near(await gamePixel(400, 330), GREEN)).toBe(true);
 expect(gameErrors).toEqual([]);
 expect(errors).toEqual([]);
 await mkdir(join(root, 'outputs'), {recursive: true});
 await page.screenshot({path: join(root, 'outputs/editor-visuals.png')});
 await game.screenshot({path: join(root, 'outputs/game-visuals.png')});
 console.log('PASS exported game: effects chunk, masks, bitmap text template, particle and sprite-sheet actions');
} catch (error) {
 await mkdir(join(root, 'outputs'), {recursive: true});
 const page = app ? await app.firstWindow().catch(() => null) : null;
 await page?.screenshot({path: join(root, 'outputs/visuals-failure.png')}).catch(() => {});
 await game?.screenshot({path: join(root, 'outputs/visuals-game-failure.png')}).catch(() => {});
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
