// Cutscene cues: timeline markers run rule actions — an autoplay clip hides an object and opens a dialogue on cue —
// edited in the Timeline panel, played in Preview and in the exported game.
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
const temp = await mkdtemp(join(tmpdir(), 'rewrite-cutscene-'));
const env = {...process.env};
delete env.ELECTRON_RUN_AS_NODE;
let app, browser, server, game;
try {
 const file = join(temp, 'cutscene.pixieditor');
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
 const shape = (id, color) => ({id: `${id}-s`, type: 'pixi.shape', version: 1, data: {alpha: 1, kind: 'rect', width: 80, height: 80, color, rounded: 0, sides: 5, innerRadius: .5, strokeColor: '#ffffff', strokeWidth: 0}});
 const clip = {id: 'clip-1', name: 'Intro', duration: 1, repeat: 0, yoyo: false, clips: [], tracks: [{id: 'tr', entityId: 'hero', componentId: 'hero-t', property: 'x', keys: [{id: 'k0', time: 0, value: 200, ease: 'linear'}, {id: 'k1', time: 1, value: 600, ease: 'linear'}]}], markers: [
  {id: 'm1', time: .3, name: 'Hide gem', cue: {id: 'cue-1', type: 'entity.active', targetId: 'gem', value: false}},
  {id: 'm2', time: .6, name: 'Talk', cue: {id: 'cue-2', type: 'dialogue.start', targetId: 'd-hi', value: true}},
 ]};
 project.scenes[0].entities = [
  {id: 'director', name: 'Director', parentId: null, active: true, components: [t('director', 0, 0), {id: 'director-a', type: 'animation.player', version: 1, data: {activeClipId: 'clip-1', autoplay: true, clips: [clip]}}]},
  {id: 'hero', name: 'Hero', parentId: null, active: true, components: [t('hero', 200, 300), shape('hero', '#5bc0eb')]},
  {id: 'gem', name: 'Gem', parentId: null, active: true, components: [t('gem', 760, 160), shape('gem', '#40c060')]},
 ];
 project.extensions['dialogue.library'] = {version: 1, items: [{id: 'd-hi', name: 'Hello', start: 'a', lines: [{id: 'a', speaker: 'Hero', text: 'Here we go.', next: '', choices: [], event: ''}]}]};
 await writeFile(file, JSON.stringify(project));
 await choose(file); await menu('Open…');
 await expect.poll(async () => Object.keys(JSON.parse(await canvas.getAttribute('data-transforms') ?? '{}'))).toContain('gem');

 // Timeline panel: the marker shows its cue and target.
 const view = async () => { const b = await canvas.locator('canvas').boundingBox(), s = Math.min((b.width - 80) / 960, (b.height - 90) / 540); return {b, at: (x, y) => ({x: b.x + (b.width - 960 * s) / 2 + x * s, y: b.y + (b.height - 540 * s) / 2 + y * s})}; };
 await page.getByRole('button', {name: 'Layers', exact: true}).click();
 await page.getByRole('button', {name: 'Select Director', exact: true}).click();
 await page.keyboard.press('Escape');
 await page.keyboard.press('Alt+KeyT');
 await page.getByTestId('marker-rail').locator('[data-item-id="m2"]').click();
 const cue = page.getByTestId('cue-editor');
 await expect(cue.getByRole('combobox', {name: 'Cue (cutscene action)'})).toHaveValue('dialogue.start');
 await expect(cue.getByRole('combobox', {name: 'Cue target'})).toHaveValue('d-hi');
 await page.getByTestId('marker-rail').locator('[data-item-id="m1"]').click();
 await expect(cue.getByRole('combobox', {name: 'Cue (cutscene action)'})).toHaveValue('entity.active');
 await page.keyboard.press('Escape');
 console.log('PASS Timeline panel shows each marker’s cue (action and target)');

 const where = async id => JSON.parse(await canvas.getAttribute('data-transforms'))[id];
 await page.getByRole('button', {name: 'Play', exact: true}).click();
 const box = canvas.locator('[data-dialogue-box]');
 await expect(box).toBeVisible({timeout: 5000});
 await expect(box).toContainText('Hero');
 expect((await where('hero')).x).toBeGreaterThan(300);
 await expect.poll(async () => { const [r, g] = await (async () => { const {b, at} = await view(), p = at(760, 160), buffer = await canvas.locator('canvas').screenshot(), ratio = (await sharp(buffer).metadata()).width / b.width; return [...await sharp(buffer).extract({left: Math.round((p.x - b.x) * ratio), top: Math.round((p.y - b.y) * ratio), width: 1, height: 1}).removeAlpha().raw().toBuffer()]; })(); return g > r + 60; }, {message: 'gem hidden'}).toBe(false);
 await page.getByRole('button', {name: 'Stop', exact: true}).click();
 console.log('PASS Preview: the clip moves the hero and its cues hide the gem and open the dialogue on time');

 const exportDir = join(temp, 'export');
 await mkdir(exportDir);
 await page.getByRole('button', {name: 'Export', exact: true}).click();
 await choose(exportDir);
 await page.getByRole('button', {name: 'Export HTML…', exact: true}).click();
 await expect(page.getByTestId('build-status')).toHaveAttribute('data-phase', /complete|failed/, {timeout: 30000});
 expect(await page.getByTestId('build-status').innerText()).not.toMatch(/Error/);
 const output = await page.getByTestId('build-output').innerText();
 const bundle = JSON.parse(await readFile(join(output, 'project.json'), 'utf8'));
 expect(bundle.runtimes).toEqual(expect.arrayContaining(['gsap', 'dialogue']));
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
 await expect(stage.locator('[data-dialogue-box]')).toBeVisible({timeout: 5000});
 await expect.poll(async () => JSON.parse(await stage.getAttribute('data-poses') ?? '{}').gem?.active).toBe(false);
 expect(gameErrors).toEqual([]);
 expect(errors).toEqual([]);
 console.log('PASS exported game: the same cues run from the timeline');
} catch (error) {
 await mkdir(join(root, 'outputs'), {recursive: true});
 const page = app ? await app.firstWindow().catch(() => null) : null;
 await page?.screenshot({path: join(root, 'outputs/cutscene-failure.png')}).catch(() => {});
 await game?.screenshot({path: join(root, 'outputs/cutscene-game-failure.png')}).catch(() => {});
 throw error;
} finally {
 await browser?.close().catch(() => {});
 if (server) await new Promise(r => server.close(r));
 if (app) { await app.evaluate(({BrowserWindow}) => { for (const w of BrowserWindow.getAllWindows()) w.destroy(); }).catch(() => {}); await app.close().catch(() => {}); }
 await rm(temp, {recursive: true, force: true, maxRetries: 3});
}
