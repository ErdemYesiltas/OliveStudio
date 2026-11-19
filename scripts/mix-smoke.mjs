// Reactive audio (RxJS): real MP3s with a ducking rule added in the Mixer panel, BPM on the music source, rules on
// beats/bars and sound end, a Fade sound out action, and a scene script using game.audio / sound handles (live volume,
// fades, beat$). Checked in Preview (live voice gains, no restarts) and in the exported HTML game.
import {_electron as electron, chromium, expect} from '@playwright/test';
import {createServer} from 'node:http';
import {copyFile, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {dirname, extname, join, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(join(root, 'apps/editor-desktop/package.json'));
const {transform} = createRequire(join(root, 'modules/scripts/package.json'))('sucrase');
const temp = await mkdtemp(join(tmpdir(), 'rewrite-mix-'));
const env = {...process.env};
delete env.ELECTRON_RUN_AS_NODE;
let app, browser, server, game;

const dj = `export function start(self: SceneSelf) {
  const music = game.find('music')!.sound();
  music.beat$.pipe(rx.take(1)).subscribe(() => game.log('first beat'));
  game.on('soundEnd').subscribe(o => game.log('ended', o.name));
  game.audio.bus('ui').volume = 0.5;
}
export function onGlobal(self: SceneSelf, name: string, value: number) { if (name === 'bars' && value === 1) game.log('bar rule'); }
`;

try {
 const file = join(temp, 'mix.pixieditor');
 await copyFile(join(root, 'modules/audio/testdata/tone.mp3'), join(temp, 'tone.mp3'));
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
 await page.getByRole('button', {name: 'Library', exact: true}).click();
 await choose(join(temp, 'tone.mp3'));
 await page.getByRole('button', {name: 'Import audio…', exact: true}).click();
 await expect(page.getByTestId('asset-list').getByText('tone', {exact: true})).toBeVisible({timeout: 30000});
 await page.keyboard.press('Escape');
 const project = await save(), tone = project.extensions['assets.registry'].items.find(a => a.type === 'audio.clip').id;
 const t = (id, x, y) => ({id: `${id}-t`, type: 'scene.transform2d', version: 1, data: {x, y, rotation: 0, scaleX: 1, scaleY: 1}});
 const shape = (id, color) => ({id: `${id}-s`, type: 'pixi.shape', version: 1, data: {alpha: 1, kind: 'rect', width: 80, height: 80, color, rounded: 0, sides: 5, innerRadius: .5, strokeColor: '#ffffff', strokeWidth: 0}});
 const source = (id, data) => ({id, type: 'audio.source', version: 1, data: {assetId: tone, volume: 1, rate: 1, loop: false, autoplay: false, bus: 'sfx', bpm: 0, beatOffset: 0, pitchJitter: 0, volumeJitter: 0, ...data}});
 const rule = (id, trigger, actions) => ({id, type: 'interactions.bindings', version: 1, data: {rules: [{id: `${id}-r`, trigger, actions}]}});
 project.scenes[0].entities = [
  {id: 'music', name: 'music', parentId: null, active: true, components: [t('music', 100, 100), source('music-src', {bus: 'music', loop: true, autoplay: true, bpm: 240, volume: .8}),
   rule('music-rules', {type: 'audio.beat', sourceId: 'music-src', event: 'bar'}, [{id: 'm1', type: 'global.add', targetId: 'v-bars', value: true, amount: 1}])]},
  {id: 'shot', name: 'shot', parentId: null, active: true, components: [t('shot', 300, 270), shape('shot', '#e04040'), source('shot-src', {pitchJitter: .1}),
   rule('shot-rules', {type: 'pointer.click', sourceId: 'shot', event: ''}, [{id: 's1', type: 'audio.play', targetId: 'shot-src', value: true}])]},
  {id: 'fader', name: 'fader', parentId: null, active: true, components: [t('fader', 660, 270), shape('fader', '#4060e0'),
   rule('fader-rules', {type: 'pointer.click', sourceId: 'fader', event: ''}, [{id: 'f1', type: 'audio.fadeOut', targetId: 'music-src', value: true, amount: .5}])]},
  // Spatial: 420 px right of the camera centre (480, 270) → linear gain 1 − 320/1000 (× 0.5: the scene script halves the ui bus), pan 420/550.
  {id: 'bird', name: 'bird', parentId: null, active: true, components: [t('bird', 900, 270), source('bird-src', {bus: 'ui', loop: true, autoplay: true, spatial: true, minDistance: 100, maxDistance: 1100, rolloff: 'linear', panAmount: 1, pan: 0})]},
 ];
 project.extensions['interactions.globals'] = {version: 1, items: [{id: 'v-bars', name: 'bars', type: 'number', initial: 0}]};
 project.extensions['scripts.library'] = {version: 1, items: [{id: 's-dj', name: 'Dj', source: dj, code: transform(dj, {transforms: ['typescript', 'imports'], production: true, disableESTransforms: true}).code}], scenes: {[project.entrySceneId]: {scriptId: 's-dj', params: {}, refs: {}}}};
 await writeFile(file, JSON.stringify(project));
 await choose(file); await menu('Open…');
 await expect.poll(async () => Object.keys(JSON.parse(await canvas.getAttribute('data-transforms') ?? '{}'))).toContain('fader');

 // Mixer panel: a ducking rule (effects turn the music down to 30 %).
 await page.keyboard.press('Alt+KeyM');
 const mixer = page.getByTestId('mixer-panel');
 await mixer.getByRole('button', {name: 'Add ducking', exact: true}).click();
 const duck = mixer.getByTestId('mixer-ducking');
 await expect(duck.getByRole('combobox', {name: 'When playing 1', exact: true})).toHaveValue('sfx');
 await expect(duck.getByRole('combobox', {name: 'Turn down 1', exact: true})).toHaveValue('music');
 const attack = duck.getByRole('spinbutton', {name: 'Attack (s) 1', exact: true});
 await attack.fill('0.05'); await attack.press('Enter');
 let saved = await save();
 expect(saved.extensions['audio.mixer'].ducking).toEqual([expect.objectContaining({trigger: 'sfx', target: 'music', amount: .3, attack: .05, release: .5})]);
 await page.keyboard.press('Escape');
 console.log('PASS Mixer panel adds a ducking rule (sfx → music 30 %, attack/release) saved with the project mix');

 // Spatial sound authoring: the distance fields show only for spatial sources, the selected source draws its range rings.
 await page.getByRole('button', {name: 'Layers', exact: true}).click();
 await page.getByRole('button', {name: 'Select bird', exact: true}).click();
 await page.keyboard.press('Escape');
 await expect(canvas).toHaveAttribute('data-decorations', '2');
 await page.getByRole('button', {name: 'Properties', exact: true}).click();
 const props = page.getByTestId('properties');
 await props.locator('summary').filter({hasText: /^Audio Source$/}).click();
 await expect(props.getByRole('spinbutton', {name: 'maxDistance', exact: true})).toHaveValue('1100');
 await props.getByRole('checkbox', {name: 'spatial', exact: true}).uncheck();
 await expect(props.getByRole('spinbutton', {name: 'maxDistance', exact: true})).toHaveCount(0);
 await expect(canvas).toHaveAttribute('data-decorations', '0');
 await page.keyboard.press('Escape');
 await menu('Undo');
 await expect(canvas).toHaveAttribute('data-decorations', '2');
 await page.getByRole('button', {name: 'Layers', exact: true}).click();
 await page.getByRole('button', {name: 'Select shot', exact: true}).click();
 await page.keyboard.press('Escape');
 await expect(canvas).toHaveAttribute('data-decorations', '0');
 console.log('PASS spatial sound authoring: Spatial reveals min/max distance and rolloff, the selected source shows its range rings, one undo step');

 // Preview: music plays (live gain 0.8), a click plays the effect and ducks the music; the fade action stops it.
 const audio = async () => JSON.parse(await canvas.getAttribute('data-audio') ?? '{}').sources ?? {};
 const view = async () => { const b = await canvas.locator('canvas').boundingBox(), s = Math.min((b.width - 80) / 960, (b.height - 90) / 540); return {at: (x, y) => ({x: b.x + (b.width - 960 * s) / 2 + x * s, y: b.y + (b.height - 540 * s) / 2 + y * s})}; };
 const press = async (x, y) => { const p = (await view()).at(x, y); await page.mouse.click(p.x, p.y); };
 await page.getByRole('button', {name: 'Play', exact: true}).click();
 await expect.poll(async () => (await audio())['music-src']?.state, {timeout: 15000}).toBe('playing');
 expect((await audio())['music-src'].volume).toBeCloseTo(.8);
 await expect.poll(async () => (await audio())['bird-src']?.state, {timeout: 15000}).toBe('playing');
 expect((await audio())['bird-src'].volume).toBeCloseTo(.68 * .5, 3); expect((await audio())['bird-src'].pan).toBeCloseTo(420 / 550, 3);
 expect((await audio())['music-src'].pan).toBe(0);
 await press(300, 270);
 await expect.poll(async () => (await audio())['shot-src']?.state).toBe('playing');
 await expect.poll(async () => Math.round((await audio())['music-src'].volume * 100)).toBe(24);
 await expect.poll(async () => Math.round((await audio())['music-src'].volume * 100), {timeout: 10000}).toBe(80);
 await press(660, 270);
 await expect.poll(async () => (await audio())['music-src']?.state, {timeout: 5000}).toBe('stopped');
 await page.keyboard.press('Alt+KeyC');
 const logs = page.getByTestId('script-console').locator('[data-level]');
 await expect(logs).toHaveText(['first beat', 'bar rule', 'ended shot']);
 await page.getByRole('button', {name: 'Stop', exact: true}).click();
 await page.keyboard.press('Escape');
 console.log('PASS Preview: spatial gain/pan from the camera centre, live gain, ducking down and back on game time, beat/bar rule, sound-end stream, Fade sound out stops the music');

 // Export: the same mix in the browser game.
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
   res.setHeader('Content-Type', {'.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.webp': 'image/webp', '.mp3': 'audio/mpeg'}[extname(path)] ?? 'application/octet-stream');
   res.end(await readFile(path));
  } catch { res.statusCode = 404; res.end(); }
 });
 await new Promise(r => server.listen(0, '127.0.0.1', r));
 browser = await chromium.launch({channel: 'chrome', headless: true, args: ['--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required']});
 game = await (await browser.newContext({viewport: {width: 960, height: 540}})).newPage();
 const gameErrors = [], gameLogs = [];
 game.on('pageerror', e => gameErrors.push(e.message));
 game.on('console', m => { if (m.type() === 'error') gameErrors.push(m.text().slice(0, 300)); else if (m.text().startsWith('[script]')) gameLogs.push(m.text()); });
 await game.goto(`http://127.0.0.1:${server.address().port}`);
 await game.getByRole('button', {name: 'Start', exact: true}).click({timeout: 30000});
 const stage = game.locator('#game'), sources = async () => JSON.parse(await stage.getAttribute('data-audio') ?? '{}');
 await expect.poll(async () => (await sources())['music-src']?.state, {timeout: 15000}).toBe('playing');
 await expect.poll(async () => (await sources())['bird-src']?.state, {timeout: 15000}).toBe('playing');
 expect((await sources())['bird-src'].volume).toBeCloseTo(.68 * .5, 3); expect((await sources())['bird-src'].pan).toBeCloseTo(420 / 550, 3);
 const at = async (x, y) => { const b = await stage.locator('canvas').boundingBox(), s = Math.min(b.width / 960, b.height / 540); return {x: b.x + (b.width - 960 * s) / 2 + x * s, y: b.y + (b.height - 540 * s) / 2 + y * s}; };
 const tap = async (x, y) => { const p = await at(x, y); await game.mouse.click(p.x, p.y); };
 await tap(300, 270);
 await expect.poll(async () => Math.round((await sources())['music-src'].volume * 100)).toBe(24);
 await expect.poll(async () => Math.round((await sources())['music-src'].volume * 100), {timeout: 10000}).toBe(80);
 await tap(660, 270);
 await expect.poll(async () => (await sources())['music-src']?.state, {timeout: 5000}).toBe('stopped');
 expect(gameLogs).toEqual(['[script] first beat', '[script] bar rule', '[script] ended shot']);
 expect(gameErrors).toEqual([]);
 expect(errors).toEqual([]);
 await mkdir(join(root, 'outputs'), {recursive: true});
 await page.keyboard.press('Alt+KeyM');
 await page.screenshot({path: join(root, 'outputs/editor-mixer.png')});
 console.log('PASS exported game: the same spatial gain/pan, ducking, beats, sound-end stream and fade-out with real MP3 playback');
} catch (error) {
 await mkdir(join(root, 'outputs'), {recursive: true});
 const page = app ? await app.firstWindow().catch(() => null) : null;
 await page?.screenshot({path: join(root, 'outputs/mix-failure.png')}).catch(() => {});
 await game?.screenshot({path: join(root, 'outputs/mix-game-failure.png')}).catch(() => {});
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
