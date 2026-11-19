// Dalga B: smart guides while dragging, prefab variants, the localization table ({@key} texts, preview and runtime
// language), and export-time texture atlases for sprite-only textures.
import {_electron as electron, chromium, expect} from '@playwright/test';
import {createServer} from 'node:http';
import {mkdir, mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {dirname, extname, join, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(join(root, 'apps/editor-desktop/package.json'));
const sharp = require('sharp');
const temp = await mkdtemp(join(tmpdir(), 'rewrite-productivity-'));
const env = {...process.env};
delete env.ELECTRON_RUN_AS_NODE;
const RED = [220, 60, 60], BLUE = [60, 90, 220];
const near = (a, b, tolerance = 10) => a.every((v, i) => Math.abs(v - b[i]) <= tolerance);
let app, browser, server, game;

try {
 for (const [name, c] of [['red', RED], ['blue', BLUE]]) await sharp({create: {width: 48, height: 48, channels: 4, background: {r: c[0], g: c[1], b: c[2], alpha: 1}}}).png().toFile(join(temp, `${name}.png`));
 const file = join(temp, 'productivity.pixieditor');
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
 const save = async () => { await choose(file); await menu('Save'); await expect(page.getByLabel('Unsaved changes', {exact: true})).toHaveCount(0); await expect.poll(() => readFile(file, 'utf8').then(() => true, () => false)).toBe(true); return JSON.parse(await readFile(file, 'utf8')); };

 await page.getByRole('button', {name: 'Library', exact: true}).click();
 for (const name of ['red', 'blue']) {
  await choose(join(temp, `${name}.png`));
  await page.getByRole('button', {name: 'Import image…', exact: true}).click();
  await expect(page.getByTestId('asset-list').getByText(name, {exact: true})).toBeVisible({timeout: 30000});
 }
 await page.keyboard.press('Escape');
 const project = await save(), textures = project.extensions['assets.registry'].items, tex = name => textures.find(a => a.name === name).id;
 const t = (id, x, y) => ({id: `${id}-t`, type: 'scene.transform2d', version: 1, data: {x, y, rotation: 0, scaleX: 1, scaleY: 1}});
 const shape = (id, color) => ({id: `${id}-s`, type: 'pixi.shape', version: 1, data: {alpha: 1, kind: 'rect', width: 100, height: 100, color, rounded: 0, sides: 5, innerRadius: .5, strokeColor: '#ffffff', strokeWidth: 0}});
 const entity = (id, x, y, ...components) => ({id, name: id, parentId: null, active: true, components: [t(id, x, y), ...components]});
 const sprite = (id, x, asset) => entity(id, x, 460, {id: `${id}-p`, type: 'pixi.sprite', version: 1, data: {assetId: asset, width: 48, height: 48, anchorX: .5, anchorY: .5, alpha: 1, tint: '#ffffff'}});
 project.scenes[0].entities = [
  entity('A', 300, 200, shape('A', '#cc8844')), entity('B', 600, 350, shape('B', '#44aa66')),
  entity('label', 480, 60, {id: 'label-x', type: 'pixi.text', version: 1, data: {alpha: 1, text: '{@title}', fontSize: 32, color: '#ffffff', font: ''}}),
  entity('lang', 820, 460, shape('lang', '#888888'), {id: 'lang-b', type: 'interactions.bindings', version: 1, data: {rules: [{id: 'r', trigger: {type: 'pointer.click', sourceId: 'lang', event: ''}, actions: [{id: 'x', type: 'language.set', targetId: 'en', value: true}]}]}}),
  sprite('s1', 150, tex('red')), sprite('s2', 250, tex('blue')),
 ];
 await writeFile(file, JSON.stringify(project));
 await choose(file); await menu('Open…');
 await expect.poll(async () => Object.keys(JSON.parse(await canvas.getAttribute('data-transforms') ?? '{}'))).toContain('B');

 // Smart guides: dragging B's centre near A's centre (x 300) snaps to it and draws the guide.
 const view = async () => { const b = await canvas.locator('canvas').boundingBox(), s = Math.min((b.width - 80) / 960, (b.height - 90) / 540); return {b, s, at: (x, y) => ({x: b.x + (b.width - 960 * s) / 2 + x * s, y: b.y + (b.height - 540 * s) / 2 + y * s})}; };
 const {at} = await view(), from = at(600, 350), to = at(302, 350);
 await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, {steps: 12});
 await expect.poll(async () => JSON.parse(await canvas.getAttribute('data-guides') ?? '[]')).toContainEqual({axis: 'x', value: 300});
 await page.mouse.up();
 await expect.poll(async () => JSON.parse(await canvas.getAttribute('data-guides') ?? '[]')).toEqual([]);
 let saved = await save();
 expect(saved.scenes[0].entities.find(e => e.id === 'B').components[0].data).toMatchObject({x: 300, y: 350});
 console.log('PASS smart guides snap a dragged object to another object\'s centre and clear on release');

 // Prefab variant from the Prefabs panel.
 await page.getByRole('button', {name: 'Layers', exact: true}).click();
 await page.getByRole('button', {name: 'Select A', exact: true}).click();
 await page.keyboard.press('Escape');
 await page.getByRole('button', {name: 'Properties', exact: true}).click();
 await page.getByRole('button', {name: 'Create prefab from selection', exact: true}).click();
 const library = page.getByTestId('prefab-library');
 await expect(library).toBeVisible();
 await library.getByRole('button', {name: 'Create variant', exact: true}).click();
 await expect(library.getByTestId('prefab-variant')).toContainText('Variant of');
 await expect(library.getByTestId('prefab-variant')).toHaveAttribute('data-overrides', '0');
 await page.keyboard.press('Escape');
 saved = await save();
 const prefabs = saved.extensions['prefabs.registry'].items;
 expect(prefabs).toHaveLength(2);
 expect(prefabs[1]).toMatchObject({name: 'A variant', variant: {baseId: prefabs[0].id}});
 console.log('PASS Prefabs panel creates a variant linked to its base');

 // Localization table: add Turkish and a "title" string, preview language Turkish.
 await page.getByRole('button', {name: 'Localization', exact: true}).click();
 const panel = page.getByTestId('localization-panel');
 await panel.getByRole('button', {name: 'Add language', exact: true}).click();
 await expect(panel.locator('[data-language]')).toHaveCount(2);
 await panel.getByRole('button', {name: 'Add string', exact: true}).click();
 await panel.getByRole('textbox', {name: 'title en', exact: true}).fill('Hello');
 await panel.getByRole('textbox', {name: 'title en', exact: true}).press('Enter');
 await panel.getByRole('textbox', {name: 'title tr', exact: true}).fill('Merhaba');
 await panel.getByRole('textbox', {name: 'title tr', exact: true}).press('Enter');
 await panel.getByRole('combobox', {name: 'Preview language', exact: true}).selectOption('tr');
 await page.keyboard.press('Escape');
 saved = await save();
 expect(saved.extensions['interactions.strings']).toMatchObject({defaultLanguage: 'en', languages: [{id: 'en'}, {id: 'tr'}], entries: [{key: 'title', values: {en: 'Hello', tr: 'Merhaba'}}]});
 await menu('Undo');
 await expect(page.getByLabel('Unsaved changes', {exact: true})).toBeVisible();
 await menu('Redo');
 console.log('PASS Localization panel edits languages and strings as undoable project data');

 // Export: atlas page for the two sprite-only textures; the game starts in the browser language and switches.
 const exportDir = join(temp, 'export');
 await mkdir(exportDir);
 await page.getByRole('button', {name: 'Export', exact: true}).click();
 await choose(exportDir);
 await page.getByRole('button', {name: 'Export HTML…', exact: true}).click();
 await expect(page.getByTestId('build-status')).toHaveAttribute('data-phase', /complete|failed/, {timeout: 30000});
 expect(await page.getByTestId('build-status').innerText()).not.toMatch(/Error/);
 const output = await page.getByTestId('build-output').innerText();
 const bundle = JSON.parse(await readFile(join(output, 'project.json'), 'utf8'));
 expect(bundle.atlas.pages).toEqual(['./game-assets/atlas/page-0.webp']);
 expect(Object.keys(bundle.atlas.frames).sort()).toEqual([tex('red'), tex('blue')].sort());
 expect(bundle.files[tex('red')]).toEqual({});
 expect(await readdir(join(output, 'game-assets', tex('red'))).catch(() => [])).toEqual([]);
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
 const context = await browser.newContext({viewport: {width: 960, height: 540}, locale: 'tr-TR'});
 game = await context.newPage();
 const gameErrors = [];
 game.on('pageerror', e => gameErrors.push(e.message));
 game.on('console', m => { if (m.type() === 'error') gameErrors.push(m.text().slice(0, 300)); });
 await game.goto(`http://127.0.0.1:${server.address().port}`);
 await game.getByRole('button', {name: 'Start', exact: true}).click({timeout: 30000});
 const stage = game.locator('#game');
 await expect(stage).toHaveAttribute('data-language', 'tr');
 await expect.poll(async () => JSON.parse(await stage.getAttribute('data-texts') ?? '{}')['label-x']).toBe('Merhaba');
 const gameAt = async (x, y) => { const box = await stage.locator('canvas').boundingBox(), s = Math.min(box.width / 960, box.height / 540); return {x: box.x + (box.width - 960 * s) / 2 + x * s, y: box.y + (box.height - 540 * s) / 2 + y * s}; };
 const gamePixel = async (x, y) => { const p = await gameAt(x, y), buffer = await game.screenshot(); return [...await sharp(buffer).extract({left: Math.round(p.x), top: Math.round(p.y), width: 1, height: 1}).removeAlpha().raw().toBuffer()]; };
 await expect.poll(async () => near(await gamePixel(150, 460), RED)).toBe(true);
 await expect.poll(async () => near(await gamePixel(250, 460), BLUE)).toBe(true);
 await expect.poll(async () => near(await gamePixel(150 + 22, 460 + 22), RED)).toBe(true);
 const button = await gameAt(820, 460); await game.mouse.click(button.x, button.y);
 await expect(stage).toHaveAttribute('data-language', 'en');
 await expect.poll(async () => JSON.parse(await stage.getAttribute('data-texts') ?? '{}')['label-x']).toBe('Hello');
 expect(gameErrors).toEqual([]);
 expect(errors).toEqual([]);
 await mkdir(join(root, 'outputs'), {recursive: true});
 await game.screenshot({path: join(root, 'outputs/game-productivity.png')});
 console.log('PASS export: sprite textures in one atlas page render correctly; game starts in Turkish and the action switches to English');
} catch (error) {
 await mkdir(join(root, 'outputs'), {recursive: true});
 const page = app ? await app.firstWindow().catch(() => null) : null;
 await page?.screenshot({path: join(root, 'outputs/productivity-failure.png')}).catch(() => {});
 await game?.screenshot({path: join(root, 'outputs/productivity-game-failure.png')}).catch(() => {});
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
