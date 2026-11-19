// Mixer bus effects: in the Mixer panel the music bus gets a low-pass (800 Hz) and the sfx bus a reverb (50 %, 1.5 s);
// the mix is saved; Preview routes the playing voices through their bus (live diagnostics) and Stop clears it; the
// exported game builds the real Web Audio nodes (a 800 Hz low-pass filter, a 1.5 s convolver impulse) and a change of
// mix in the editor is undoable. Checked in Preview and in the exported HTML game (Chrome Web Audio).
import {_electron as electron, chromium, expect} from '@playwright/test';
import {createServer} from 'node:http';
import {copyFile, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {dirname, extname, join, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(join(root, 'apps/editor-desktop/package.json'));
const temp = await mkdtemp(join(tmpdir(), 'rewrite-fx-'));
const env = {...process.env};
delete env.ELECTRON_RUN_AS_NODE;
let app, browser, server, game;

try {
 const file = join(temp, 'fx.pixieditor');
 await copyFile(join(root, 'modules/audio/testdata/tone.mp3'), join(temp, 'tone.mp3'));
 app = await electron.launch({executablePath: process.env.REWRITE_EXECUTABLE || require('electron'), args: [...(process.env.REWRITE_EXECUTABLE ? [] : [join(root, 'apps/editor-desktop/out/main/index.js')]), '--no-hub', `--user-data-dir=${join(temp, 'user')}`, '--autoplay-policy=no-user-gesture-required'], env});
 const page = await app.firstWindow();
 page.setDefaultTimeout(15000);
 const errors = [];
 page.on('pageerror', e => errors.push(e.message));
 const canvas = page.getByTestId('pixi-canvas');
 await expect(canvas).toHaveAttribute('data-ready', 'true', {timeout: 30000});
 const menu = label => app.evaluate(({Menu}, text) => Menu.getApplicationMenu().items.flatMap(m => m.submenu?.items ?? []).find(i => i.label === text).click(), label);
 const choose = path => app.evaluate(({dialog}, target) => { dialog.showOpenDialog = async () => ({canceled: false, filePaths: [target]}); dialog.showSaveDialog = async () => ({canceled: false, filePath: target}); dialog.showMessageBox = async () => ({response: 1, checkboxChecked: false}); }, path);
 const save = async () => { await choose(file); await menu('Save'); await expect(page.getByLabel('Unsaved changes', {exact: true})).toHaveCount(0); return JSON.parse(await readFile(file, 'utf8')); };
 await page.getByRole('button', {name: 'Library', exact: true}).click();
 await choose(join(temp, 'tone.mp3'));
 await page.getByRole('button', {name: 'Import audio…', exact: true}).click();
 await expect(page.getByTestId('asset-list').getByText('tone', {exact: true})).toBeVisible({timeout: 30000});
 await page.keyboard.press('Escape');
 const project = await save(), tone = project.extensions['assets.registry'].items.find(a => a.type === 'audio.clip').id;
 const t = (id, x, y) => ({id: `${id}-t`, type: 'scene.transform2d', version: 1, data: {x, y, rotation: 0, scaleX: 1, scaleY: 1}});
 const source = (id, data) => ({id, type: 'audio.source', version: 1, data: {assetId: tone, volume: 1, rate: 1, loop: true, autoplay: true, bus: 'sfx', bpm: 0, beatOffset: 0, pitchJitter: 0, volumeJitter: 0, ...data}});
 project.scenes[0].entities = [
  {id: 'music', name: 'music', parentId: null, active: true, components: [t('music', 100, 100), source('music-src', {bus: 'music'})]},
  {id: 'hit', name: 'hit', parentId: null, active: true, components: [t('hit', 300, 100), source('hit-src', {bus: 'sfx'})]},
 ];
 await writeFile(file, JSON.stringify(project));
 await choose(file); await menu('Open…');
 await expect.poll(async () => Object.keys(JSON.parse(await canvas.getAttribute('data-transforms') ?? '{}'))).toContain('hit');

 // Mixer panel: low-pass on music, reverb on sfx.
 await page.keyboard.press('Alt+KeyM');
 const fx = page.getByTestId('mixer-panel').getByTestId('mixer-effects');
 const lowpass = fx.getByRole('spinbutton', {name: 'Low-pass (Hz) Music', exact: true});
 await expect(lowpass).toHaveValue('20000');
 await lowpass.fill('800'); await lowpass.press('Enter');
 await fx.getByRole('slider', {name: 'Reverb Effects', exact: true}).fill('0.5');
 const seconds = fx.getByRole('spinbutton', {name: 'Reverb length (s) Effects', exact: true});
 await seconds.fill('1.5'); await seconds.press('Enter');
 const saved = await save();
 expect(saved.extensions['audio.mixer'].effects).toEqual({music: {lowpass: 800, reverb: 0, reverbSeconds: 2}, sfx: {lowpass: 20000, reverb: .5, reverbSeconds: 1.5}});
 await menu('Undo');
 await expect(seconds).toHaveValue('2');
 await menu('Redo');
 await expect(seconds).toHaveValue('1.5');
 await page.keyboard.press('Escape');
 console.log('PASS Mixer panel: per-bus low-pass and reverb, saved with the mix, undoable');

 // Preview: voices run through their bus effects; Stop clears them.
 const effects = async () => JSON.parse(await canvas.getAttribute('data-audio') ?? '{}').effects ?? {};
 await page.getByRole('button', {name: 'Play', exact: true}).click();
 await expect.poll(async () => { const e = await effects(); return [e.music?.lowpass, e.music?.voices, e.sfx?.reverb, e.sfx?.reverbSeconds, e.sfx?.voices]; }, {timeout: 15000}).toEqual([800, 1, .5, 1.5, 1]);
 await page.getByRole('button', {name: 'Stop', exact: true}).click();
 console.log('PASS Preview: the music voice goes through the 800 Hz low-pass, the effects voice through the 1.5 s reverb');

 // Export: the real Web Audio graph in Chrome.
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
   res.setHeader('Content-Type', {'.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.webp': 'image/webp', '.wasm': 'application/wasm', '.mp3': 'audio/mpeg'}[extname(path)] ?? 'application/octet-stream');
   res.end(await readFile(path));
  } catch { res.statusCode = 404; res.end(); }
 });
 await new Promise(r => server.listen(0, '127.0.0.1', r));
 browser = await chromium.launch({channel: 'chrome', headless: true, args: ['--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required']});
 game = await (await browser.newContext({viewport: {width: 960, height: 540}})).newPage();
 await game.addInitScript(() => {
  const seen = window.__fx = {filters: [], convolvers: []}, proto = (window.AudioContext || window.webkitAudioContext).prototype;
  const filter = proto.createBiquadFilter, convolver = proto.createConvolver;
  proto.createBiquadFilter = function () { const n = filter.call(this); seen.filters.push(n); return n; };
  proto.createConvolver = function () { const n = convolver.call(this); seen.convolvers.push(n); return n; };
 });
 const gameErrors = [];
 game.on('pageerror', e => gameErrors.push(e.message));
 game.on('console', m => { if (m.type() === 'error') gameErrors.push(m.text().slice(0, 300)); });
 await game.goto(`http://127.0.0.1:${server.address().port}`);
 await game.getByRole('button', {name: 'Start', exact: true}).click({timeout: 30000});
 const stage = game.locator('#game'), gameEffects = async () => JSON.parse(await stage.getAttribute('data-audio-effects') ?? '{}');
 await expect.poll(async () => { const e = await gameEffects(); return [e.music?.voices, e.sfx?.voices]; }, {timeout: 15000}).toEqual([1, 1]);
 const graph = await game.evaluate(() => ({filters: window.__fx.filters.map(f => [f.type, Math.round(f.frequency.value)]), reverbs: window.__fx.convolvers.map(c => c.buffer ? Math.round(c.buffer.duration * 10) / 10 : null)}));
 expect(graph.filters).toContainEqual(['lowpass', 800]);
 expect(graph.reverbs).toContain(1.5);
 expect(gameErrors).toEqual([]);
 expect(errors).toEqual([]);
 console.log('PASS exported game: Chrome Web Audio has the 800 Hz low-pass and the 1.5 s reverb impulse, both voices routed');
} catch (error) {
 await mkdir(join(root, 'outputs'), {recursive: true});
 const page = app ? await app.firstWindow().catch(() => null) : null;
 await page?.screenshot({path: join(root, 'outputs/fx-failure.png')}).catch(() => {});
 throw error;
} finally {
 await browser?.close().catch(() => {});
 if (server) await new Promise(r => server.close(r));
 if (app) { await app.evaluate(({BrowserWindow}) => { for (const w of BrowserWindow.getAllWindows()) w.destroy(); }).catch(() => {}); await app.close().catch(() => {}); }
 await rm(temp, {recursive: true, force: true, maxRetries: 3});
}
