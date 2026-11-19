// Floating toolbar for the selection: icon-only buttons with tooltips; text style (bold, italic, align, size, colour,
// outline, font) and shape style (fill, outline, corner, opacity) controls follow the selected object, change every
// selected object with the same component in one undo step, and the exported game draws the text style.
import {_electron as electron, chromium, expect} from '@playwright/test';
import {createServer} from 'node:http';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {dirname, extname, join, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(join(root, 'apps/editor-desktop/package.json'));
const temp = await mkdtemp(join(tmpdir(), 'rewrite-context-'));
const env = {...process.env};
delete env.ELECTRON_RUN_AS_NODE;
let app, browser, server;

try {
 const file = join(temp, 'context.pixieditor');
 app = await electron.launch({executablePath: process.env.REWRITE_EXECUTABLE || require('electron'), args: [...(process.env.REWRITE_EXECUTABLE ? [] : [join(root, 'apps/editor-desktop/out/main/index.js')]), '--no-hub', `--user-data-dir=${join(temp, 'user')}`], env});
 const page = await app.firstWindow();
 page.setDefaultTimeout(15000);
 const errors = [];
 page.on('pageerror', e => errors.push(e.message));
 await expect(page.getByTestId('pixi-canvas')).toHaveAttribute('data-ready', 'true', {timeout: 30000});
 const menu = label => app.evaluate(({Menu}, text) => Menu.getApplicationMenu().items.flatMap(m => m.submenu?.items ?? []).find(i => i.label === text).click(), label);
 const choose = path => app.evaluate(({dialog}, target) => {
  dialog.showOpenDialog = async () => ({canceled: false, filePaths: [target]});
  dialog.showSaveDialog = async () => ({canceled: false, filePath: target});
  dialog.showMessageBox = async () => ({response: 1, checkboxChecked: false});
 }, path);
 const save = async () => { await choose(file); await menu('Save'); await expect(page.getByLabel('Unsaved changes', {exact: true})).toHaveCount(0); await expect.poll(() => readFile(file, 'utf8').then(() => true, () => false)).toBe(true); return JSON.parse(await readFile(file, 'utf8')); };
 const t = (id, x, y) => ({id: `${id}-t`, type: 'scene.transform2d', version: 1, data: {x, y, rotation: 0, scaleX: 1, scaleY: 1}});
 const shape = (id, color) => ({id: `${id}-s`, type: 'pixi.shape', version: 1, data: {alpha: 1, kind: 'rect', width: 100, height: 80, color, rounded: 0, sides: 5, innerRadius: .5, strokeColor: '#ffffff', strokeWidth: 0}});
 const entity = (id, x, y, ...components) => ({id, name: id, parentId: null, active: true, components: [t(id, x, y), ...components]});
 const project = await save();
 // An older text without the style fields: the toolbar and the renderer fill the defaults in.
 project.scenes[0].entities = [entity('Title', 480, 120, {id: 'title-x', type: 'pixi.text', version: 1, data: {alpha: 1, text: 'Hello', fontSize: 40, color: '#ffffff', font: ''}}), entity('BoxA', 300, 360, shape('BoxA', '#cc3333')), entity('BoxB', 640, 360, shape('BoxB', '#3366cc'))];
 await writeFile(file, JSON.stringify(project));
 await choose(file); await menu('Open…');
 const pick = async (name, modifiers = []) => { await page.getByRole('button', {name: 'Layers', exact: true}).click(); await page.getByRole('button', {name: `Select ${name}`, exact: true}).click({modifiers}); await page.keyboard.press('Escape'); };
 const bar = page.locator('.context-tools'), style = bar.getByRole('group', {name: 'Style of the selected object', exact: true});

 // Icon-only buttons with tooltips.
 await pick('Title');
 await expect(style).toHaveAttribute('data-component', 'pixi.text');
 for (const [name, tip] of [['Duplicate selected', 'Duplicate (⌘D)'], ['Delete selected', 'Delete (⌫)'], ['Move tool (W)', 'Move tool (W)']]) {
  const button = bar.getByRole('button', {name, exact: true});
  await expect(button).toHaveAttribute('data-tip', tip);
  expect((await button.innerText()).trim()).toBe('');
 }
 await expect(bar.getByRole('button', {name: 'Bold', exact: true})).toHaveAttribute('data-tip', 'Bold');
 await expect(bar.locator('[data-tip="Font size"] input')).toHaveCount(1);
 // The tooltip is the data-tip text, shown on hover and keyboard focus.
 expect(await page.evaluate(() => [...document.styleSheets].flatMap(s => [...s.cssRules]).some(r => r.selectorText?.includes('.context-tools [data-tip]:hover::after') && r.style.content === 'attr(data-tip)'))).toBe(true);
 console.log('PASS the selection toolbar is icon-only; every control has a tooltip');

 // Text style.
 await style.getByRole('button', {name: 'Bold', exact: true}).click();
 await expect(style.getByRole('button', {name: 'Bold', exact: true})).toHaveAttribute('aria-pressed', 'true');
 await style.getByRole('button', {name: 'Italic', exact: true}).click();
 await style.getByRole('radio', {name: 'Align left', exact: true}).click();
 await style.getByRole('spinbutton', {name: 'Font size', exact: true}).fill('56');
 await style.getByRole('spinbutton', {name: 'Font size', exact: true}).press('Enter');
 await style.getByRole('spinbutton', {name: 'Outline width', exact: true}).fill('4');
 await style.getByRole('spinbutton', {name: 'Outline width', exact: true}).press('Enter');
 await style.locator('input[type=color][aria-label="Text colour"]').fill('#ffcc00');
 await style.locator('input[type=color][aria-label="Text colour"]').blur();
 await expect(style.getByRole('combobox', {name: 'Font', exact: true})).toHaveValue('');
 let saved = await save();
 expect(saved.scenes[0].entities.find(e => e.id === 'Title').components[1].data).toMatchObject({fontWeight: 'bold', fontStyle: 'italic', align: 'left', fontSize: 56, strokeWidth: 4, color: '#ffcc00'});
 await menu('Undo');
 saved = await save();
 expect(saved.scenes[0].entities.find(e => e.id === 'Title').components[1].data.color).toBe('#ffffff');
 await menu('Redo');
 console.log('PASS text: bold, italic, align, size, outline and colour from the toolbar, one undo step each');

 // Shape style for two selected shapes: fill and corner in one step each, corner only for rectangles.
 await pick('BoxA');
 await expect(style).toHaveAttribute('data-component', 'pixi.shape');
 await expect(style.getByRole('button', {name: 'Bold', exact: true})).toHaveCount(0);
 await pick('BoxB', ['Meta']);
 await style.locator('input[type=color][aria-label="Fill colour"]').fill('#22aa55');
 await style.locator('input[type=color][aria-label="Fill colour"]').blur();
 await style.getByRole('spinbutton', {name: 'Corner radius', exact: true}).fill('12');
 await style.getByRole('spinbutton', {name: 'Corner radius', exact: true}).press('Enter');
 await style.getByRole('spinbutton', {name: 'Outline width', exact: true}).fill('3');
 await style.getByRole('spinbutton', {name: 'Outline width', exact: true}).press('Enter');
 saved = await save();
 for (const id of ['BoxA', 'BoxB']) expect(saved.scenes[0].entities.find(e => e.id === id).components[1].data).toMatchObject({color: '#22aa55', rounded: 12, strokeWidth: 3});
 await menu('Undo'); await menu('Undo');
 saved = await save();
 for (const id of ['BoxA', 'BoxB']) expect(saved.scenes[0].entities.find(e => e.id === id).components[1].data).toMatchObject({color: '#22aa55', rounded: 0, strokeWidth: 0});
 console.log('PASS shapes: fill, corner and outline apply to every selected shape in one undo step each');

 // Live edits: the canvas follows a value while it is typed (before Enter/blur); Escape rolls it back without an undo
 // step, and committing keeps the whole edit as one undo step. The same goes for Properties fields.
 const canvas = page.getByTestId('pixi-canvas'), unsaved = page.getByLabel('Unsaved changes', {exact: true});
 const opacity = async id => JSON.parse(await canvas.getAttribute('data-opacities'))[id], position = async id => JSON.parse(await canvas.getAttribute('data-transforms'))[id];
 await pick('BoxA');
 // Closing the Layers popover hands focus back to its button a moment later; wait for it so it cannot blur the field.
 await expect(page.getByRole('button', {name: 'Layers', exact: true})).toBeFocused();
 const alpha = style.getByRole('spinbutton', {name: 'Opacity', exact: true});
 await alpha.fill('0.5');
 await expect.poll(() => opacity('BoxA')).toBe(0.5);
 await expect(unsaved).toHaveCount(1);
 await alpha.fill('0.3');
 await expect.poll(() => opacity('BoxA')).toBe(0.3);
 await alpha.press('Escape');
 await expect(unsaved).toHaveCount(0);
 await expect.poll(() => opacity('BoxA')).toBe(1);
 await expect(alpha).toHaveValue('1');
 await expect(unsaved).toHaveCount(0);
 await alpha.fill('0.6'); await expect.poll(() => opacity('BoxA')).toBe(0.6);
 await alpha.fill('0.4'); await expect.poll(() => opacity('BoxA')).toBe(0.4);
 await alpha.press('Enter');
 saved = await save();
 expect(saved.scenes[0].entities.find(e => e.id === 'BoxA').components[1].data.alpha).toBe(0.4);
 await menu('Undo');
 await expect.poll(() => opacity('BoxA')).toBe(1);
 saved = await save();
 const fill = style.locator('input[type=color][aria-label="Fill colour"]');
 await fill.fill('#ff8800');
 await expect(unsaved).toHaveCount(1);
 await fill.press('Escape');
 await expect(unsaved).toHaveCount(0);
 await page.getByRole('button', {name: 'Properties', exact: true}).click();
 const x = page.getByTestId('properties').getByRole('spinbutton', {name: 'x', exact: true});
 await x.fill('123');
 await expect.poll(async () => (await position('BoxA')).x).toBe(123);
 await x.fill('140');
 await expect.poll(async () => (await position('BoxA')).x).toBe(140);
 await x.press('Enter');
 await page.keyboard.press('Escape');
 saved = await save();
 expect(saved.scenes[0].entities.find(e => e.id === 'BoxA').components[0].data.x).toBe(140);
 await menu('Undo');
 await expect.poll(async () => (await position('BoxA')).x).toBe(300);
 saved = await save();
 expect(saved.scenes[0].entities.find(e => e.id === 'BoxA').components[0].data.x).toBe(300);
 expect(errors).toEqual([]);
 console.log('PASS live edits: toolbar and Properties values show on the canvas while typing; Escape rolls back, Enter keeps one undo step');

 // Exported game draws the text style.
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
   res.setHeader('Content-Type', {'.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.webp': 'image/webp'}[extname(path)] ?? 'application/octet-stream');
   res.end(await readFile(path));
  } catch { res.statusCode = 404; res.end(); }
 });
 await new Promise(r => server.listen(0, '127.0.0.1', r));
 browser = await chromium.launch({channel: 'chrome', headless: true, args: ['--enable-unsafe-swiftshader']});
 const game = await (await browser.newContext({viewport: {width: 960, height: 540}})).newPage();
 const gameErrors = [];
 game.on('pageerror', e => gameErrors.push(e.message));
 await game.goto(`http://127.0.0.1:${server.address().port}`);
 await game.getByRole('button', {name: 'Start', exact: true}).click({timeout: 30000});
 const bundle = JSON.parse(await readFile(join(output, 'project.json'), 'utf8'));
 expect(bundle.project.scenes[0].entities.find(e => e.id === 'Title').components[1].data).toMatchObject({fontWeight: 'bold', fontStyle: 'italic', strokeWidth: 4});
 expect(gameErrors).toEqual([]);
 expect(errors).toEqual([]);
 await mkdir(join(root, 'outputs'), {recursive: true});
 await pick('Title');
 await page.screenshot({path: join(root, 'outputs/editor-context-toolbar.png')});
 console.log('PASS the exported game keeps the text style and starts cleanly');
} catch (error) {
 await mkdir(join(root, 'outputs'), {recursive: true});
 const page = app ? await app.firstWindow().catch(() => null) : null;
 await page?.screenshot({path: join(root, 'outputs/context-failure.png')}).catch(() => {});
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
