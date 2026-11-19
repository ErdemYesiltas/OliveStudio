// RxJS timeline: in the Timeline panel add a colour track and a visibility track for another object, a marker with a
// message and an action, a nested clip with an offset, drag a key in the value graph (one undo step) and play the
// preview; then a scene script drives the timeline with RxJS (timer → speed/play, markers$, complete$) in Preview and in
// the exported HTML game, where rules, marker actions, nested clips, colours and visibility give the same result.
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
const temp = await mkdtemp(join(tmpdir(), 'rewrite-timeline-'));
const env = {...process.env};
delete env.ELECTRON_RUN_AS_NODE;
let app, browser, server, game;

const director = `export function start(self: SceneSelf) {
  const tl = game.find('hero')!.timeline();
  tl.markers$.subscribe(name => game.log('marker$', name));
  tl.complete$.subscribe(() => game.log('done', tl.time));
  game.on('message').subscribe(m => game.log('message', m.message));
  game.on('global').pipe(rx.filter(v => v.name === 'score')).subscribe(v => game.log('score', v.value));
  rx.timer(100).subscribe(() => { tl.speed(2); tl.play(); });
}
`;

try {
 const file = join(temp, 'timeline.pixieditor');
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
 const save = async () => { await choose(file); await menu('Save'); await expect(page.getByLabel('Unsaved changes', {exact: true})).toHaveCount(0); return JSON.parse(await readFile(file, 'utf8')); };
 await choose(file); await menu('Save');
 await expect.poll(() => readFile(file, 'utf8').then(() => true, () => false)).toBe(true);
 const project = JSON.parse(await readFile(file, 'utf8'));
 const t = (id, x, y) => ({id: `${id}-t`, type: 'scene.transform2d', version: 1, data: {x, y, rotation: 0, scaleX: 1, scaleY: 1}});
 const shape = (id, color) => ({id: `${id}-s`, type: 'pixi.shape', version: 1, data: {alpha: 1, kind: 'rect', width: 60, height: 60, color, rounded: 0, sides: 5, innerRadius: .5, strokeColor: '#ffffff', strokeWidth: 0}});
 const k = (id, time, value) => ({id, time, value, ease: 'linear'});
 const player = (id, clipId, name, duration, tracks) => ({id, type: 'animation.player', version: 1, data: {activeClipId: clipId, autoplay: false, clips: [{id: clipId, name, duration, repeat: 0, yoyo: false, tracks, markers: [], clips: []}]}});
 project.scenes[0].entities = [
  {id: 'hero', name: 'hero', parentId: null, active: true, components: [t('hero', 100, 150), shape('hero', '#000000'), player('player', 'main', 'Main', 1, [{id: 'hx', entityId: 'hero', componentId: 'hero-t', property: 'x', keys: [k('h1', 0, 100), k('h2', 1, 300)]}]),
   {id: 'rules', type: 'interactions.bindings', version: 1, data: {rules: [{id: 'r1', trigger: {type: 'animation.marker', sourceId: 'player', event: 'boom'}, actions: [{id: 'a1', type: 'global.add', targetId: 'v-score', value: true, amount: 1}]}]}}]},
  {id: 'ghost', name: 'ghost', parentId: null, active: true, components: [t('ghost', 600, 150), shape('ghost', '#888888')]},
  {id: 'child', name: 'child', parentId: null, active: true, components: [t('child', 0, 300), shape('child', '#3c5adc'), player('child-player', 'spin', 'Spin', 1, [{id: 'cx', entityId: 'child', componentId: 'child-t', property: 'x', keys: [k('c1', 0, 0), k('c2', 1, 100)]}])]},
  {id: 'bonus', name: 'bonus', parentId: null, active: true, components: [t('bonus', 0, 420), shape('bonus', '#44aa66'), player('bonus-player', 'pop', 'Pop', .2, [{id: 'bx', entityId: 'bonus', componentId: 'bonus-t', property: 'x', keys: [k('b1', 0, 0), k('b2', .2, 50)]}])]},
  {id: 'label', name: 'label', parentId: null, active: true, components: [t('label', 480, 60), {id: 'label-x', type: 'pixi.text', version: 1, data: {alpha: 1, text: 'score {score}', fontSize: 28, color: '#ffffff', font: ''}}]},
 ];
 project.extensions['interactions.globals'] = {version: 1, items: [{id: 'v-score', name: 'score', type: 'number', initial: 0}]};
 project.extensions['scripts.library'] = {version: 1, items: [{id: 's-dir', name: 'Director', source: director, code: transform(director, {transforms: ['typescript', 'imports'], production: true, disableESTransforms: true}).code}], scenes: {[project.entrySceneId]: {scriptId: 's-dir', params: {}, refs: {}}}};
 await writeFile(file, JSON.stringify(project));
 await choose(file); await menu('Open…');
 await expect.poll(async () => Object.keys(JSON.parse(await canvas.getAttribute('data-transforms') ?? '{}'))).toContain('bonus');

 // Timeline panel: colour track, visibility track for another object, marker with message + action, nested clip.
 await page.getByRole('button', {name: 'Layers', exact: true}).click();
 await page.getByRole('button', {name: 'Select hero', exact: true}).click();
 await page.keyboard.press('Escape');
 await page.keyboard.press('Alt+KeyT');
 const timeline = page.getByTestId('animation-timeline');
 await expect(timeline).toBeVisible();
 await timeline.getByRole('button', {name: 'Add track', exact: true}).click();
 await timeline.getByRole('combobox', {name: 'Track property', exact: true}).selectOption({label: 'pixi.shape · color'});
 await expect(timeline.locator('.animation-row[data-kind="color"]')).toHaveCount(1);
 await timeline.getByRole('button', {name: 'Keyframe 2.2', exact: true}).click();
 await timeline.locator('input[type="color"][aria-label="Keyframe value"]').fill('#ff0000');
 await timeline.getByRole('button', {name: 'Add track', exact: true}).click();
 await timeline.getByRole('combobox', {name: 'Track target', exact: true}).selectOption({label: 'ghost'});
 await timeline.getByRole('combobox', {name: 'Track property', exact: true}).selectOption({label: 'Object · Visible'});
 await expect(timeline.locator('.animation-row[data-kind="bool"]')).toHaveCount(1);
 await timeline.getByRole('slider', {name: 'Clip time', exact: true}).fill('0.5');
 await timeline.getByRole('button', {name: 'Add marker', exact: true}).click();
 const field = async (name, value) => { const box = timeline.getByRole('textbox', {name, exact: true}); await box.fill(value); await box.press('Enter'); };
 await field('Marker name', 'boom');
 await field('Marker message', 'boom');
 await timeline.getByRole('combobox', {name: 'Marker action', exact: true}).selectOption({label: 'Start clip'});
 await timeline.getByRole('combobox', {name: 'Marker target', exact: true}).selectOption({label: 'bonus'});
 await timeline.getByRole('button', {name: 'Add nested clip', exact: true}).click();
 await timeline.getByRole('combobox', {name: 'Nested clip', exact: true}).selectOption({label: 'child · Spin'});
 const nestedStart = timeline.getByRole('spinbutton', {name: 'Nested start', exact: true});
 await nestedStart.fill('0.25'); await nestedStart.press('Enter');
 await expect(timeline.getByTestId('nested-rail').getByRole('button', {name: 'Nested clip 1', exact: true})).toHaveAttribute('data-time', '0.25');
 console.log('PASS Timeline panel: colour and visibility tracks, marker message + action, nested clip with an offset');

 // Value graph: dragging a key is one undo step; preview playback runs and pauses.
 await timeline.getByRole('button', {name: '1. hero · x', exact: true}).click();
 const graph = timeline.getByTestId('track-graph');
 await expect(graph).toBeVisible();
 const handle = graph.getByRole('button', {name: 'Graph keyframe 2', exact: true});
 await handle.scrollIntoViewIfNeeded();
 const box = await handle.boundingBox();
 await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
 await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 30, {steps: 5}); await page.mouse.up();
 let saved = await save(), main = saved.scenes[0].entities.find(e => e.id === 'hero').components.find(c => c.id === 'player').data.clips[0];
 expect(main.tracks[0].keys.find(x => x.id === 'h2').value).toBeLessThan(300);
 await menu('Undo');
 saved = await save(); main = saved.scenes[0].entities.find(e => e.id === 'hero').components.find(c => c.id === 'player').data.clips[0];
 expect(main.tracks[0].keys.find(x => x.id === 'h2').value).toBe(300);
 expect(main.tracks.map(tr => [tr.entityId, tr.componentId, tr.property, tr.keys.map(x => x.value)])).toEqual([['hero', 'hero-t', 'x', [100, 300]], ['hero', 'hero-s', 'color', ['#000000', '#ff0000']], ['ghost', '@entity', 'active', [true, false]]]);
 expect(main.markers).toEqual([expect.objectContaining({time: .5, name: 'boom', message: 'boom', action: {service: 'animation', method: 'play', targetId: 'bonus-player'}})]);
 expect(main.clips).toEqual([expect.objectContaining({playerId: 'child-player', clipId: 'spin', start: .25, speed: 1})]);
 if (!await timeline.isVisible()) await page.keyboard.press('Alt+KeyT');
 await timeline.getByRole('combobox', {name: 'Preview speed', exact: true}).selectOption('0.5');
 await timeline.getByRole('button', {name: '▶ Play preview', exact: true}).click();
 await expect(timeline).toHaveAttribute('data-playing', 'true');
 await expect.poll(async () => Number(await timeline.getAttribute('data-preview-time'))).toBeGreaterThan(.2);
 await timeline.getByRole('button', {name: '⏸ Pause preview', exact: true}).click();
 await expect(timeline).toHaveAttribute('data-playing', 'false');
 await timeline.getByRole('button', {name: 'Reset pose', exact: true}).click();
 await page.keyboard.press('Escape');
 console.log('PASS value graph drag is one undo step; the panel previews playback at a chosen speed and pauses');

 // Preview: the scene script starts the timeline with RxJS; marker → rule, action and message; nested and colour tracks.
 const transforms = async () => JSON.parse(await canvas.getAttribute('data-transforms') ?? '{}');
 await page.getByRole('button', {name: 'Play', exact: true}).click();
 await expect.poll(async () => Math.round((await transforms()).hero?.x ?? 0), {timeout: 10000}).toBe(300);
 await expect.poll(async () => Math.round((await transforms()).bonus?.x ?? 0)).toBe(50);
 await expect.poll(async () => Math.round((await transforms()).child?.x ?? -1)).toBe(75);
 await page.keyboard.press('Alt+KeyC');
 const consoleLog = page.getByTestId('script-console').locator('[data-level]');
 await expect(consoleLog).toHaveText(['message boom', 'marker$ boom', 'score 1', 'done 1']);
 await page.getByRole('button', {name: 'Stop', exact: true}).click();
 await expect.poll(async () => Math.round((await transforms()).hero?.x ?? 0)).toBe(100);
 console.log('PASS Preview: an RxJS scene script plays the timeline (timer → speed 2 → play); markers reach rules, actions, messages and markers$; complete$ fires once');

 // Export: same results in the browser game (poses, visibility, colour, text and logs).
 const exportDir = join(temp, 'export');
 await mkdir(exportDir);
 await page.keyboard.press('Escape');
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
   res.setHeader('Content-Type', {'.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.webp': 'image/webp'}[extname(path)] ?? 'application/octet-stream');
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
 await expect.poll(async () => Math.round((await poses()).hero?.x ?? 0), {timeout: 10000}).toBe(300);
 await expect.poll(async () => Math.round((await poses()).bonus?.x ?? 0)).toBe(50);
 expect(Math.round((await poses()).child.x)).toBe(75);
 expect((await poses()).ghost.active).toBe(false);
 await expect.poll(async () => JSON.parse(await stage.getAttribute('data-texts') ?? '{}')['label-x']).toBe('score 1');
 const at = async (x, y) => { const b = await stage.locator('canvas').boundingBox(), s = Math.min(b.width / 960, b.height / 540); return {x: Math.round(b.x + (b.width - 960 * s) / 2 + x * s), y: Math.round(b.y + (b.height - 540 * s) / 2 + y * s)}; };
 const pixel = async (x, y) => { const p = await at(x, y), buffer = await game.screenshot(); return [...await sharp(buffer).extract({left: p.x, top: p.y, width: 1, height: 1}).removeAlpha().raw().toBuffer()]; };
 await expect.poll(async () => { const [r, g, b] = await pixel(300, 150); return r > 200 && g < 40 && b < 40; }).toBe(true);
 expect(gameLogs).toEqual(['[script] message boom', '[script] marker$ boom', '[script] score 1', '[script] done 1']);
 expect(gameErrors).toEqual([]);
 expect(errors).toEqual([]);
 await mkdir(join(root, 'outputs'), {recursive: true});
 await game.screenshot({path: join(root, 'outputs/game-timeline.png')});
 await page.keyboard.press('Alt+KeyT');
 await page.screenshot({path: join(root, 'outputs/editor-timeline.png')});
 console.log('PASS exported game: same timeline result (nested clip, marker action and rule, hidden object, red colour, script logs)');
} catch (error) {
 await mkdir(join(root, 'outputs'), {recursive: true});
 const page = app ? await app.firstWindow().catch(() => null) : null;
 await page?.screenshot({path: join(root, 'outputs/timeline-failure.png')}).catch(() => {});
 await game?.screenshot({path: join(root, 'outputs/timeline-game-failure.png')}).catch(() => {});
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
