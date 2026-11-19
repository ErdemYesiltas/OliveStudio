// Right-to-left languages: Arabic is RTL by its code (Localization panel shows Auto (RTL), Kurdish can be set to RTL),
// translation fields follow the language's direction, and Preview in Arabic mirrors text alignment and layout rows.
// The exported game in an Arabic browser starts in Arabic with <html dir="rtl" lang="ar">, isolates RTL paragraphs,
// mirrors a layout row (first child on the right); the Language rule switches to English and everything flips back.
import {_electron as electron, chromium, expect} from '@playwright/test';
import {createServer} from 'node:http';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {dirname, extname, join, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(join(root, 'apps/editor-desktop/package.json'));
const sharp = createRequire(join(root, 'modules/html-export/package.json'))('sharp');
const temp = await mkdtemp(join(tmpdir(), 'rewrite-rtl-'));
const env = {...process.env};
delete env.ELECTRON_RUN_AS_NODE;
let app, browser, server, game;
const t = (id, x, y) => ({id: `${id}-t`, type: 'scene.transform2d', version: 1, data: {x, y, rotation: 0, scaleX: 1, scaleY: 1}});
const rect = (id, w, color) => ({id: `${id}-s`, type: 'pixi.shape', version: 1, data: {alpha: 1, kind: 'rect', width: w, height: w, color, rounded: 0, sides: 5, innerRadius: .5, strokeColor: '#ffffff', strokeWidth: 0}});
const text = (id, value, align) => ({id: `${id}-x`, type: 'pixi.text', version: 1, data: {alpha: 1, text: value, fontSize: 30, color: '#ffffff', font: '', fontWeight: 'normal', fontStyle: 'normal', align, letterSpacing: 0, strokeColor: '#000000', strokeWidth: 0}});
/** Which colour (r, g or b) is brightest at a stage point of a page screenshot. */
const colourAt = async (png, box, x, y) => {
 const meta = await sharp(png).metadata(), scale = meta.width / box.pageWidth, s = Math.min(box.width / 960, box.height / 540);
 const px = Math.round((box.x + (box.width - 960 * s) / 2 + x * s) * scale), py = Math.round((box.y + (box.height - 540 * s) / 2 + y * s) * scale);
 const {data} = await sharp(png).extract({left: px, top: py, width: 1, height: 1}).raw().toBuffer({resolveWithObject: true});
 const [r, g, b] = data; return r > 180 && g < 90 && b < 90 ? 'red' : g > 150 && r < 90 && b < 120 ? 'green' : b > 180 && r < 90 ? 'blue' : `${r},${g},${b}`;
};

try {
 const file = join(temp, 'rtl.pixieditor');
 app = await electron.launch({executablePath: process.env.REWRITE_EXECUTABLE || require('electron'), args: [...(process.env.REWRITE_EXECUTABLE ? [] : [join(root, 'apps/editor-desktop/out/main/index.js')]), '--no-hub', `--user-data-dir=${join(temp, 'user')}`], env});
 const page = await app.firstWindow();
 page.setDefaultTimeout(15000);
 const errors = [];
 page.on('pageerror', e => errors.push(e.message));
 const canvas = page.getByTestId('pixi-canvas');
 await expect(canvas).toHaveAttribute('data-ready', 'true', {timeout: 30000});
 const menu = label => app.evaluate(({Menu}, label) => Menu.getApplicationMenu().items.flatMap(m => m.submenu?.items ?? []).find(i => i.label === label).click(), label);
 const choose = path => app.evaluate(({dialog}, target) => { dialog.showOpenDialog = async () => ({canceled: false, filePaths: [target]}); dialog.showSaveDialog = async () => ({canceled: false, filePath: target}); dialog.showMessageBox = async () => ({response: 1, checkboxChecked: false}); }, path);
 const save = async () => { await choose(file); await menu('Save'); await expect(page.getByLabel('Unsaved changes', {exact: true})).toHaveCount(0); return JSON.parse(await readFile(file, 'utf8')); };
 await choose(file); await menu('Save');
 await expect.poll(() => readFile(file, 'utf8').then(() => true, () => false)).toBe(true);
 const project = JSON.parse(await readFile(file, 'utf8'));
 project.scenes[0].entities = [
  {id: 'title', name: 'Title', parentId: null, active: true, components: [t('title', 480, 80), text('title', '{@greeting}', 'left')]},
  {id: 'row', name: 'Row', parentId: null, active: true, components: [t('row', 480, 300), {id: 'row-l', type: 'layout.container', version: 1, data: {width: 420, height: 120, anchorX: .5, anchorY: .5, direction: 'row', justify: 'space-between', align: 'center', wrap: false, gap: 0, padding: 10, background: '#222233', backgroundAlpha: 1, borderRadius: 0, borderWidth: 0, borderColor: '#ffffff', clip: false}}]},
  {id: 'a', name: 'A', parentId: 'row', active: true, components: [t('a', 0, 0), rect('a', 80, '#ff2020')]},
  {id: 'b', name: 'B', parentId: 'row', active: true, components: [t('b', 0, 0), rect('b', 80, '#20d040')]},
  {id: 'c', name: 'C', parentId: 'row', active: true, components: [t('c', 0, 0), rect('c', 80, '#2040ff')]},
  {id: 'flip', name: 'English', parentId: null, active: true, components: [t('flip', 860, 480), rect('flip', 70, '#ffd166'), {id: 'flip-r', type: 'interactions.bindings', version: 1, data: {rules: [{id: 'en', trigger: {type: 'pointer.click', sourceId: 'flip', event: ''}, actions: [{id: 'l', type: 'language.set', targetId: 'en', value: true}]}]}}]},
 ];
 project.extensions['interactions.strings'] = {version: 1, defaultLanguage: 'en', languages: [{id: 'en', name: 'English'}, {id: 'ar', name: 'Arabic'}, {id: 'ku', name: 'Kurdish'}], entries: [{key: 'greeting', values: {en: 'Hello, world!', ar: 'مرحبا بالعالم 2026!', ku: 'سڵاو'}}]};
 await writeFile(file, JSON.stringify(project));
 await choose(file); await menu('Open…');
 await expect.poll(async () => Object.keys(JSON.parse(await canvas.getAttribute('data-transforms') ?? '{}'))).toContain('row');

 // Localization panel: direction per language; Arabic text fields are right to left.
 await page.keyboard.press('Alt+KeyG');
 const panel = page.getByTestId('localization-panel');
 await expect(panel.getByRole('combobox', {name: 'Direction ar', exact: true}).locator('option:checked')).toHaveText('Auto (RTL)');
 await expect(panel.getByRole('combobox', {name: 'Direction ku', exact: true}).locator('option:checked')).toHaveText('Auto (LTR)');
 await expect(panel.getByRole('textbox', {name: 'greeting ar', exact: true})).toHaveAttribute('dir', 'rtl');
 await expect(panel.getByRole('textbox', {name: 'greeting en', exact: true})).toHaveAttribute('dir', 'ltr');
 await panel.getByRole('combobox', {name: 'Direction ku', exact: true}).selectOption('rtl');
 await expect(panel.getByRole('textbox', {name: 'greeting ku', exact: true})).toHaveAttribute('dir', 'rtl');
 expect((await save()).extensions['interactions.strings'].languages.find(l => l.id === 'ku')).toEqual({id: 'ku', name: 'Kurdish', direction: 'rtl'});
 await panel.getByRole('combobox', {name: 'Preview language', exact: true}).selectOption('ar');
 await page.keyboard.press('Escape');
 console.log('PASS Localization panel: Auto direction from the code, RTL override, right-to-left translation fields');

 // Preview in Arabic: the canvas is right to left; Stop goes back.
 await page.getByRole('button', {name: 'Play', exact: true}).click();
 await expect(canvas).toHaveAttribute('data-direction', 'rtl');
 await page.getByRole('button', {name: 'Stop', exact: true}).click();
 await expect(canvas).toHaveAttribute('data-direction', 'ltr');
 console.log('PASS Preview: Arabic mirrors the canvas, Stop restores');

 // Export, played in an Arabic browser.
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
 game = await (await browser.newContext({viewport: {width: 960, height: 540}, locale: 'ar-EG'})).newPage();
 const gameErrors = [];
 game.on('pageerror', e => gameErrors.push(e.message));
 game.on('console', m => { if (m.type() === 'error') gameErrors.push(m.text().slice(0, 300)); });
 await game.goto(`http://127.0.0.1:${server.address().port}`);
 await game.getByRole('button', {name: 'Start', exact: true}).click({timeout: 30000});
 const stage = game.locator('#game'), texts = async () => JSON.parse(await stage.getAttribute('data-texts') ?? '{}')['title-x'];
 await expect(stage).toHaveAttribute('data-direction', 'rtl');
 expect(await game.evaluate(() => [document.documentElement.dir, document.documentElement.lang])).toEqual(['rtl', 'ar']);
 await expect.poll(texts).toBe('⁨مرحبا بالعالم 2026!⁩');
 const box = async () => ({...await stage.locator('canvas').boundingBox(), pageWidth: 960});
 await game.waitForTimeout(300);
 let shot = await game.screenshot();
 await mkdir(join(root, 'outputs'), {recursive: true});
 await writeFile(join(root, 'outputs/rtl-game.png'), shot);
 expect([await colourAt(shot, await box(), 330, 300), await colourAt(shot, await box(), 630, 300)]).toEqual(['blue', 'red']);
 const flip = await box(), s = Math.min(flip.width / 960, flip.height / 540);
 await game.mouse.click(flip.x + (flip.width - 960 * s) / 2 + 860 * s, flip.y + (flip.height - 540 * s) / 2 + 480 * s);
 await expect(stage).toHaveAttribute('data-direction', 'ltr');
 await expect.poll(texts).toBe('Hello, world!');
 expect(await game.evaluate(() => [document.documentElement.dir, document.documentElement.lang])).toEqual(['ltr', 'en']);
 await game.waitForTimeout(300);
 shot = await game.screenshot();
 expect([await colourAt(shot, await box(), 330, 300), await colourAt(shot, await box(), 630, 300)]).toEqual(['red', 'blue']);
 expect(gameErrors).toEqual([]);
 expect(errors).toEqual([]);
 console.log('PASS exported game: Arabic browser → RTL page, isolated text, mirrored row; Language rule → English flips back');
} catch (error) {
 await mkdir(join(root, 'outputs'), {recursive: true});
 const page = app ? await app.firstWindow().catch(() => null) : null;
 await page?.screenshot({path: join(root, 'outputs/rtl-failure.png')}).catch(() => {});
 await game?.screenshot({path: join(root, 'outputs/rtl-game-failure.png')}).catch(() => {});
 throw error;
} finally {
 await browser?.close().catch(() => {});
 if (server) await new Promise(r => server.close(r));
 if (app) { await app.evaluate(({BrowserWindow}) => { for (const w of BrowserWindow.getAllWindows()) w.destroy(); }).catch(() => {}); await app.close().catch(() => {}); }
 await rm(temp, {recursive: true, force: true, maxRetries: 3});
}
