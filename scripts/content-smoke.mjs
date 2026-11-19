// Dalga 2 content: sprite-sheet animation, custom easing curves, project globals with conditions and
// `{name}` text, the audio mixer and imported fonts — in the editor, through save and in exported HTML.
import {_electron as electron, chromium, expect} from '@playwright/test';
import {createServer} from 'node:http';
import {access, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {dirname, extname, join, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(join(root, 'apps/editor-desktop/package.json'));
const sharp = require('sharp');
const temp = await mkdtemp(join(tmpdir(), 'rewrite-content-'));
const env = {...process.env};
delete env.ELECTRON_RUN_AS_NODE;
const fontCandidates = ['/System/Library/Fonts/Supplemental/Andale Mono.ttf', '/System/Library/Fonts/Supplemental/Arial.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 'C:/Windows/Fonts/arial.ttf'];
const bezier = ([x1, y1, x2, y2], p) => { let lo = 0, hi = 1, t = p; for (let i = 0; i < 60; i++) { const u = 1 - t, x = 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t; if (x < p) lo = t; else hi = t; t = (lo + hi) / 2; } const u = 1 - t; return 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t; };
const RED = [220, 60, 60], GREEN = [60, 200, 90];
let app, browser, server;

try {
 // A 4-frame horizontal sheet: red, green, blue, yellow.
 const colors = [RED, GREEN, [60, 90, 220], [230, 200, 60]];
 await sharp({create: {width: 128, height: 32, channels: 4, background: '#000000'}}).composite(colors.map((c, i) => ({input: {create: {width: 32, height: 32, channels: 4, background: {r: c[0], g: c[1], b: c[2], alpha: 1}}}, left: i * 32, top: 0}))).png().toFile(join(temp, 'sheet.png'));
 await cp(join(root, 'modules/audio/testdata/tone.mp3'), join(temp, 'tone.mp3'));
 let fontSource;
 for (const candidate of fontCandidates) { try { await access(candidate); fontSource = candidate; break; } catch { /* try the next one */ } }
 if (fontSource) await cp(fontSource, join(temp, 'face.ttf'));
 const file = join(temp, 'content.pixieditor');

 app = await electron.launch({executablePath: process.env.REWRITE_EXECUTABLE || require('electron'), args: [...(process.env.REWRITE_EXECUTABLE ? [] : [join(root, 'apps/editor-desktop/out/main/index.js')]), '--no-hub', `--user-data-dir=${join(temp, 'user')}`], env});
 const page = await app.firstWindow();
 page.setDefaultTimeout(15000);
 const errors = [];
 page.on('pageerror', e => errors.push(e.message));
 const canvas = page.getByTestId('pixi-canvas'), shell = page.getByTestId('editor-shell');
 await expect(canvas).toHaveAttribute('data-ready', 'true', {timeout: 30000});
 const menu = label => app.evaluate(({Menu}, text) => Menu.getApplicationMenu().items.flatMap(m => m.submenu?.items ?? []).find(i => i.label === text).click(), label);
 const choose = path => app.evaluate(({dialog}, target) => {
  dialog.showOpenDialog = async () => ({canceled: false, filePaths: [target]});
  dialog.showSaveDialog = async () => ({canceled: false, filePath: target});
  dialog.showMessageBox = async () => ({response: 1, checkboxChecked: false});
 }, path);
 const data = async key => JSON.parse(await canvas.getAttribute(`data-${key}`));
 const save = async () => { await choose(file); await menu('Save'); await expect(page.getByLabel('Unsaved changes', {exact: true})).toHaveCount(0); return JSON.parse(await readFile(file, 'utf8')); };
 const open = async () => {
  const before = (await data('audio')).sessionId;
  await choose(file); await menu('Open…');
  await expect.poll(async () => (await data('audio')).sessionId, {timeout: 30000}).not.toBe(before);
  await expect(shell).toHaveAttribute('aria-busy', 'false');
 };

 // Real imports through the Library and the asset worker.
 await page.getByRole('button', {name: 'Library', exact: true}).click();
 for (const [name, label] of [['sheet.png', 'Import image…'], ['tone.mp3', 'Import audio…'], ...(fontSource ? [['face.ttf', 'Import font…']] : [])]) {
  await choose(join(temp, name));
  await page.getByRole('button', {name: label, exact: true}).click();
  await expect(page.getByTestId('asset-list').getByText(name.split('.')[0], {exact: true})).toBeVisible({timeout: 30000});
 }
 await page.keyboard.press('Escape');
 const saved = await save(), assets = saved.extensions['assets.registry'].items, id = type => assets.find(a => a.type === type)?.id;
 expect(id('pixi.texture') && id('audio.clip')).toBeTruthy();
 if (fontSource) expect(assets.find(a => a.type === 'font.face').metadata).toMatchObject({format: 'ttf'});

 const t = (eid, x, y) => ({id: `${eid}-t`, type: 'scene.transform2d', version: 1, data: {x, y, rotation: 0, scaleX: 1, scaleY: 1}});
 const curve = [0.42, 0, 0.58, 1];
 saved.scenes[0].entities = [
  {id: 'flip', name: 'Flip', parentId: null, active: true, components: [t('flip', 200, 200), {id: 'flip-fb', type: 'pixi.flipbook', version: 1, data: {assetId: id('pixi.texture'), columns: 4, rows: 1, frames: 4, fps: 4, loop: true, autoplay: true, width: 96, height: 96, anchorX: 0.5, anchorY: 0.5, alpha: 1}}]},
  {id: 'label', name: 'Label', parentId: null, active: true, components: [t('label', 480, 80), {id: 'label-text', type: 'pixi.text', version: 1, data: {alpha: 1, text: 'Score {score}', fontSize: 36, color: '#ffffff', font: id('font.face') ?? ''}}]},
  {id: 'button', name: 'Button', parentId: null, active: true, components: [t('button', 480, 300), {id: 'button-s', type: 'pixi.shape', version: 1, data: {width: 140, height: 70, color: '#d9976e', rounded: 10, alpha: 1}}, {id: 'button-b', type: 'interactions.bindings', version: 1, data: {rules: [
   {id: 'r1', trigger: {type: 'pointer.click', sourceId: 'button', event: ''}, actions: [{id: 'a1', type: 'global.add', targetId: 'v-score', value: true, amount: 5}]},
   {id: 'r2', trigger: {type: 'global.change', sourceId: 'v-score', event: ''}, condition: {globalId: 'v-score', op: '>=', value: 10}, actions: [{id: 'a2', type: 'scene.change', targetId: 'win', value: true}]},
  ]}}]},
  {id: 'music', name: 'Music', parentId: null, active: true, components: [t('music', 800, 450), {id: 'music-a', type: 'audio.source', version: 1, data: {assetId: id('audio.clip'), volume: 1, loop: false, rate: 1, autoplay: false, bus: 'music'}}]},
  {id: 'anim', name: 'Anim', parentId: null, active: true, components: [t('anim', 100, 450), {id: 'anim-s', type: 'pixi.shape', version: 1, data: {width: 40, height: 40, color: '#79a7d5', rounded: 4, alpha: 1}}, {id: 'anim-p', type: 'animation.player', version: 1, data: {activeClipId: 'clip', autoplay: true, clips: [{id: 'clip', name: 'Move', duration: 1, repeat: 0, yoyo: false, markers: [], tracks: [{id: 'track', entityId: 'anim', componentId: 'anim-t', property: 'x', keys: [{id: 'k0', time: 0, value: 100, ease: 'curve', curve}, {id: 'k1', time: 1, value: 300, ease: 'linear'}]}]}]}}]},
 ];
 saved.scenes.push({formatVersion: 1, id: 'win', name: 'Win', entities: [{id: 'won', name: 'Won', parentId: null, active: true, components: [t('won', 480, 270), {id: 'won-s', type: 'pixi.shape', version: 1, data: {width: 200, height: 100, color: '#bada88', rounded: 12, alpha: 1}}]}]});
 saved.extensions['interactions.globals'] = {version: 1, items: [{id: 'v-score', name: 'score', type: 'number', initial: 0}]};
 saved.extensions['audio.mixer'] = {version: 1, master: 0.5, music: 0.4, sfx: 1, ui: 1};
 await writeFile(file, JSON.stringify(saved));
 await open();
 await expect.poll(async () => (await data('visuals')).every(v => v.ready)).toBe(true);

 const view = async () => { const b = await canvas.locator('canvas').boundingBox(), s = Math.min((b.width - 80) / 960, (b.height - 90) / 540); return {b, at: (x, y) => ({x: b.x + (b.width - 960 * s) / 2 + x * s, y: b.y + (b.height - 540 * s) / 2 + y * s})}; };
 const pixel = async (x, y) => {
  const {b, at} = await view(), p = at(x, y), buffer = await canvas.locator('canvas').screenshot(), ratio = (await sharp(buffer).metadata()).width / b.width;
  return [...await sharp(buffer).extract({left: Math.round((p.x - b.x) * ratio), top: Math.round((p.y - b.y) * ratio), width: 1, height: 1}).removeAlpha().raw().toBuffer()];
 };
 const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= 6);
 await expect.poll(async () => near(await pixel(200, 200), RED)).toBe(true);
 console.log('PASS sprite sheet shows frame 0 while editing');

 // Paused Preview: at least 15 steps (0.25 s) → flipbook frame 1; the curve is checked at the exact runtime time.
 await page.getByRole('button', {name: 'Play', exact: true}).click();
 await page.getByRole('button', {name: 'Pause / Resume', exact: true}).click();
 for (let i = 0; i < 15; i++) await page.getByRole('button', {name: 'Step', exact: true}).click();
 await expect.poll(async () => near(await pixel(200, 200), GREEN)).toBe(true);
 const runtime = Number(await canvas.getAttribute('data-runtime-time'));
 expect(runtime).toBeGreaterThanOrEqual(0.25);
 expect((await data('transforms')).anim.x).toBeCloseTo(100 + 200 * bezier(curve, Math.min(1, runtime)), 1);
 await page.getByRole('button', {name: 'Stop', exact: true}).click();
 console.log('PASS Preview advances sprite-sheet frames and samples the bezier curve on the shared clock');

 // Globals: two clicks add 5 each; the condition changes scene; a new Play resets the score.
 const click = async (x, y) => { const p = (await view()).at(x, y); await page.mouse.click(p.x, p.y); };
 await page.getByRole('button', {name: 'Play', exact: true}).click();
 await expect(shell).toHaveAttribute('data-mode', 'playing');
 await click(480, 300);
 await page.waitForTimeout(200);
 expect((await data('interactions')).sceneId).toBe(saved.entrySceneId);
 await click(480, 300);
 await expect.poll(async () => (await data('interactions')).sceneId).toBe('win');
 await page.getByRole('button', {name: 'Stop', exact: true}).click();
 await page.getByRole('button', {name: 'Play', exact: true}).click();
 await click(480, 300);
 await page.waitForTimeout(300);
 expect((await data('interactions')).sceneId).toBe(saved.entrySceneId);
 await page.getByRole('button', {name: 'Stop', exact: true}).click();
 console.log('PASS globals, conditions and per-session reset in Preview');

 if (fontSource) {
  const family = `pixi-font-${id('font.face')}`;
  await expect.poll(() => page.evaluate(name => [...document.fonts].some(f => f.family.replace(/"/g, '') === name && f.status === 'loaded'), family)).toBe(true);
  console.log('PASS imported font registered for editor text');
 } else console.log('SKIP font checks: no system font file found');

 // Curve editor in the Timeline: presets change the stored curve, one Undo restores it.
 await page.getByRole('button', {name: 'Layers', exact: true}).click();
 await page.getByRole('button', {name: 'Select Anim', exact: true}).click();
 await page.keyboard.press('Escape');
 await page.getByRole('button', {name: 'Timeline', exact: true}).click();
 await page.getByRole('button', {name: 'Keyframe 1.1', exact: true}).click();
 const editor = page.getByTestId('curve-editor');
 await expect(editor).toHaveAttribute('data-curve', curve.join(','));
 await editor.getByRole('button', {name: 'Overshoot', exact: true}).click();
 await expect(editor).toHaveAttribute('data-curve', '0.34,1.56,0.64,1');
 await menu('Undo');
 await expect(editor).toHaveAttribute('data-curve', curve.join(','));
 await page.keyboard.press('Escape');
 console.log('PASS curve editor presets with Undo');

 // Globals and Mixer panels edit project settings: a global's type changes its initial-value editor; Undo removes it.
 await page.getByRole('button', {name: 'Globals', exact: true}).click();
 const globals = page.getByTestId('globals-panel');
 await expect(globals.locator('[data-global]')).toHaveCount(1);
 await globals.getByRole('button', {name: '+ Global', exact: true}).click();
 await expect(globals.locator('[data-global]')).toHaveCount(2);
 const added = globals.locator('[data-global]').nth(1), addedName = await added.getAttribute('data-global');
 await globals.getByRole('combobox', {name: `Type ${addedName}`, exact: true}).selectOption('boolean');
 await expect(added).toHaveAttribute('data-type', 'boolean');
 await expect(globals.getByRole('combobox', {name: `Initial value ${addedName}`, exact: true})).toHaveValue('false');
 await globals.getByRole('combobox', {name: `Type ${addedName}`, exact: true}).selectOption('string');
 await globals.getByRole('textbox', {name: `Initial value ${addedName}`, exact: true}).fill('knight');
 await globals.getByRole('textbox', {name: `Initial value ${addedName}`, exact: true}).press('Enter');
 const typed = await save();
 expect(typed.extensions['interactions.globals'].items[1]).toMatchObject({name: addedName, type: 'string', initial: 'knight'});
 for (let i = 0; i < 4; i++) await menu('Undo');
 await expect(globals.locator('[data-global]')).toHaveCount(1);
 await page.keyboard.press('Escape');
 await page.getByRole('button', {name: 'Mixer', exact: true}).click();
 const master = page.getByTestId('mixer-panel').getByRole('slider', {name: 'Master', exact: true});
 await master.focus();
 await page.keyboard.press('ArrowLeft');
 await page.keyboard.press('Escape');
 const after = await save();
 expect(after.extensions['audio.mixer'].master).toBeCloseTo(0.49, 5);
 expect(after.extensions['interactions.globals'].items.map(v => v.name)).toEqual(['score']);
 console.log('PASS Globals (typed) and Mixer panels write project settings');

 // Exported HTML: globals, text templates, conditions, flipbook frames, fonts and the mix travel with the game.
 const exportDir = join(temp, 'export');
 await mkdir(exportDir);
 await page.getByRole('button', {name: 'Export', exact: true}).click();
 await choose(exportDir);
 await page.getByRole('button', {name: 'Export HTML…', exact: true}).click();
 await expect(page.getByTestId('build-status')).toHaveAttribute('data-phase', 'complete', {timeout: 30000});
 const output = await page.getByTestId('build-output').innerText();
 const bundle = JSON.parse(await readFile(join(output, 'project.json'), 'utf8'));
 expect(bundle.project.extensions['interactions.globals'].items).toHaveLength(1);
 expect(bundle.project.extensions['audio.mixer'].master).toBeCloseTo(0.49, 5);
 expect(bundle.runtimes).toContain('flipbook');
 if (fontSource) expect(Object.values(bundle.files[id('font.face')])).toEqual([expect.stringMatching(/font\.ttf$/)]);
 server = createServer(async (req, res) => {
  try {
   const path = resolve(output, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/$/, '/index.html'));
   if (!path.startsWith(resolve(output) + sep)) throw Error('outside');
   res.setHeader('Content-Type', {'.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.ttf': 'font/ttf'}[extname(path)] ?? 'application/octet-stream');
   res.end(await readFile(path));
  } catch { res.statusCode = 404; res.end(); }
 });
 await new Promise(r => server.listen(0, '127.0.0.1', r));
 browser = await chromium.launch({channel: 'chrome', headless: true, args: ['--enable-unsafe-swiftshader']});
 const game = await browser.newPage({viewport: {width: 1100, height: 700}});
 const gameErrors = [];
 game.on('pageerror', e => gameErrors.push(e.message));
 game.on('console', m => m.type() === 'error' && gameErrors.push(m.text()));
 await game.goto(`http://127.0.0.1:${server.address().port}`);
 await game.getByRole('button', {name: 'Start', exact: true}).click({timeout: 30000});
 const stage = game.locator('#game');
 await expect.poll(async () => JSON.parse(await stage.getAttribute('data-texts') ?? '{}')['label-text']).toBe('Score 0');
 const gameClick = async (x, y) => { const b = await stage.locator('canvas').boundingBox(); await game.mouse.click(b.x + x * b.width / 960, b.y + y * b.height / 540); };
 await gameClick(480, 300);
 await expect.poll(async () => JSON.parse(await stage.getAttribute('data-texts'))['label-text']).toBe('Score 5');
 await gameClick(480, 300);
 await expect(stage).toHaveAttribute('data-scene-id', 'win');
 if (fontSource) expect(await game.evaluate(name => [...document.fonts].some(f => f.family.replace(/"/g, '') === name && f.status === 'loaded'), `pixi-font-${id('font.face')}`)).toBe(true);
 expect(gameErrors).toEqual([]);
 expect(errors).toEqual([]);
 expect((await readdir(output))).toContain('index.html');
 await mkdir(join(root, 'outputs'), {recursive: true});
 await page.screenshot({path: join(root, 'outputs/editor-content.png')});
 console.log('PASS exported game: globals, {score} text, condition scene change, sprite-sheet runtime, font file and mix');
} catch (error) {
 await mkdir(join(root, 'outputs'), {recursive: true});
 const page = app ? await app.firstWindow().catch(() => null) : null;
 await page?.screenshot({path: join(root, 'outputs/content-failure.png')}).catch(() => {});
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
