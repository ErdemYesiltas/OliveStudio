// Dalga 1 authoring: multi-selection (Layers modifiers, canvas marquee), group move, align/distribute,
// multi-object Inspector, editor-only hide/lock, object clipboard, duplicate/delete/nudge keys,
// Layers drag/drop and the project stage size through save and HTML export.
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
const temp = await mkdtemp(join(tmpdir(), 'rewrite-authoring-'));
const env = {...process.env};
delete env.ELECTRON_RUN_AS_NODE;
const shape = (id, name, x, y, color, parentId = null, rotation = 0) => ({id, name, parentId, active: true, components: [
 {id: `${id}-t`, type: 'scene.transform2d', version: 1, data: {x, y, rotation, scaleX: 1, scaleY: 1}},
 {id: `${id}-s`, type: 'pixi.shape', version: 1, data: {width: 60, height: 40, color, rounded: 0, alpha: 1}},
]});
const entities = [shape('a', 'Alpha', 200, 150, '#e14c4c'), shape('b', 'Beta', 420, 230, '#4079dd'), shape('c', 'Gamma', 700, 180, '#3fa36b'), shape('p', 'Parent', 600, 420, '#d9a441', null, 30)];
const project = {formatVersion: 1, name: 'Authoring', entrySceneId: 'scene', scenes: [{formatVersion: 1, id: 'scene', name: 'Authoring', entities}], modules: {}, providers: {render: 'pixi'}, extensions: {}};
const file = join(temp, 'Authoring.pixieditor');
let app, browser, server;

try {
 await writeFile(file, JSON.stringify(project));
 app = await electron.launch({executablePath: process.env.REWRITE_EXECUTABLE || require('electron'), args: [...(process.env.REWRITE_EXECUTABLE ? [] : [join(root, 'apps/editor-desktop/out/main/index.js')]), '--no-hub', `--user-data-dir=${join(temp, 'user')}`], env});
 const page = await app.firstWindow();
 page.setDefaultTimeout(15000);
 const errors = [];
 page.on('pageerror', e => errors.push(e.message));
 const canvas = page.getByTestId('pixi-canvas');
 await expect(canvas).toHaveAttribute('data-ready', 'true', {timeout: 30000});
 const menu = label => app.evaluate(({Menu}, text) => Menu.getApplicationMenu().items.flatMap(m => m.submenu?.items ?? []).find(i => i.label === text).click(), label);
 // Role menu items (Copy/Paste) run webContents.copy()/paste() on the focused page; MenuItem.click() alone does not.
 const edit = action => app.evaluate(({BrowserWindow}, name) => BrowserWindow.getAllWindows()[0].webContents[name](), action);
 const choose = path => app.evaluate(({dialog}, target) => {
  dialog.showOpenDialog = async () => ({canceled: false, filePaths: [target]});
  dialog.showSaveDialog = async () => ({canceled: false, filePath: target});
  dialog.showMessageBox = async () => ({response: 1, checkboxChecked: false});
 }, path);
 await choose(file);
 await menu('Open…');
 await expect(page.getByText('Authoring', {exact: true}).first()).toBeVisible();
 await page.getByRole('button', {name: 'Layers', exact: true}).click();
 await page.getByRole('button', {name: 'Pin Layers', exact: true}).click();
 await page.getByRole('button', {name: 'Properties', exact: true}).click();
 await page.getByRole('button', {name: 'Pin Properties', exact: true}).click();

 const selection = async () => JSON.parse(await canvas.getAttribute('data-selection') ?? '[]').sort();
 const poses = async () => JSON.parse(await canvas.getAttribute('data-transforms'));
 const count = async () => Object.keys(await poses()).length;
 const clean = () => expect(page.getByLabel('Unsaved changes', {exact: true})).toHaveCount(0);
 const row = name => page.getByRole('button', {name: `Select ${name}`, exact: true});
 const view = async () => {
  const b = await canvas.locator('canvas').boundingBox(), stage = (await canvas.getAttribute('data-stage') ?? '960x540').split('x').map(Number);
  const s = Math.min((b.width - 80) / stage[0], (b.height - 90) / stage[1]);
  return {b, s, at: (x, y) => ({x: b.x + (b.width - stage[0] * s) / 2 + x * s, y: b.y + (b.height - stage[1] * s) / 2 + y * s})};
 };
 const pixel = async (x, y) => {
  // Device-pixel screenshot: CSS-scaled captures can colour-convert on some compositor states.
  const {b, at} = await view(), p = at(x, y), buffer = await canvas.locator('canvas').screenshot(), ratio = (await sharp(buffer).metadata()).width / b.width;
  return [...await sharp(buffer).extract({left: Math.round((p.x - b.x) * ratio), top: Math.round((p.y - b.y) * ratio), width: 1, height: 1}).removeAlpha().raw().toBuffer()];
 };
 const red = [225, 76, 76];

 // Layers modifiers: Cmd toggles, Shift selects a range; the last clicked object is primary.
 await row('Alpha').click();
 await row('Gamma').click({modifiers: ['Meta']});
 expect(await selection()).toEqual(['a', 'c']);
 await expect(page.getByTestId('properties')).toHaveAttribute('data-multi', '2');
 await row('Alpha').click();
 await row('Gamma').click({modifiers: ['Shift']});
 expect(await selection()).toEqual(['a', 'b', 'c']);
 console.log('PASS Layers Cmd/Shift multi-selection and multi-object Inspector');

 // Align left / distribute horizontally: equal-size shapes end with equal x / equal gaps; one Undo each.
 await page.getByRole('button', {name: 'Align left', exact: true}).click();
 await expect.poll(async () => { const p = await poses(); return [p.a.x, p.b.x, p.c.x]; }).toEqual([200, 200, 200]);
 await menu('Undo');
 await expect.poll(async () => { const p = await poses(); return [p.a.x, p.b.x, p.c.x]; }).toEqual([200, 420, 700]);
 await page.getByRole('button', {name: 'Distribute horizontally', exact: true}).click();
 await expect.poll(async () => { const p = await poses(); return Math.round(p.b.x); }).toBe(450);
 await menu('Undo');
 await expect.poll(async () => (await poses()).b.x).toBe(420);
 await clean();
 console.log('PASS align and distribute by rendered bounds, one Undo step each');

 // Inspector edits every selected object at once.
 await page.getByRole('textbox', {name: 'y', exact: true}).or(page.getByLabel('y', {exact: true})).first().fill('260');
 await page.keyboard.press('Enter');
 await expect.poll(async () => { const p = await poses(); return [p.a.y, p.b.y, p.c.y]; }).toEqual([260, 260, 260]);
 await menu('Undo');
 await expect.poll(async () => { const p = await poses(); return [p.a.y, p.b.y, p.c.y]; }).toEqual([150, 230, 180]);
 console.log('PASS mixed-value Inspector field applies to all selected objects');

 // Group move on the canvas: all selected objects move together; one Undo restores them.
 let {at} = await view();
 const start = at(200, 150);
 await page.mouse.move(start.x, start.y);
 await page.mouse.down();
 await page.mouse.move(start.x + 40, start.y + 20, {steps: 5});
 await page.mouse.up();
 await expect.poll(async () => { const p = await poses(); return [p.a.x > 200, p.b.x > 420, p.c.x > 700, p.p.x]; }).toEqual([true, true, true, 600]);
 await menu('Undo');
 await expect.poll(async () => { const p = await poses(); return [p.a.x, p.b.x, p.c.x]; }).toEqual([200, 420, 700]);
 console.log('PASS group move with a single Undo step');

 // Marquee on empty canvas selects the objects it touches.
 ({at} = await view());
 const m0 = at(150, 110), m1 = at(460, 260);
 await page.mouse.move(m0.x, m0.y);
 await page.mouse.down();
 await page.mouse.move(m1.x, m1.y, {steps: 6});
 await page.mouse.up();
 expect(await selection()).toEqual(['a', 'b']);
 // A plain click on empty canvas clears the selection.
 const empty = at(80, 500);
 await page.mouse.click(empty.x, empty.y);
 expect(await selection()).toEqual([]);
 console.log('PASS canvas marquee selection and empty-click clear');

 // Hide/lock are editor-only: no document change, invisible/unclickable while editing, unchanged in Preview.
 expect(await pixel(200, 150)).toEqual(red);
 await page.getByRole('button', {name: 'Hide Alpha', exact: true}).click();
 await expect.poll(() => pixel(200, 150)).not.toEqual(red);
 await clean();
 await page.getByRole('button', {name: 'Play', exact: true}).click();
 await expect.poll(() => pixel(200, 150)).toEqual(red);
 await page.getByRole('button', {name: 'Stop', exact: true}).click();
 await expect.poll(() => pixel(200, 150)).not.toEqual(red);
 await page.getByRole('button', {name: 'Hide Alpha', exact: true}).click();
 await page.getByRole('button', {name: 'Lock Beta', exact: true}).click();
 ({at} = await view());
 const beta = at(420, 230);
 await page.mouse.click(beta.x, beta.y);
 expect(await selection()).toEqual([]);
 await page.getByRole('button', {name: 'Lock Beta', exact: true}).click();
 await page.mouse.click(beta.x, beta.y);
 expect(await selection()).toEqual(['b']);
 await clean();
 console.log('PASS editor-only hide/lock: no history, Preview unaffected, locked objects ignore canvas clicks');

 // Arrow nudge from the canvas focus, Shift for 10 units.
 await page.keyboard.press('ArrowRight');
 await page.keyboard.press('Shift+ArrowDown');
 await expect.poll(async () => { const p = await poses(); return [p.b.x, p.b.y]; }).toEqual([421, 240]);
 await menu('Undo');
 await menu('Undo');
 await expect.poll(async () => { const p = await poses(); return [p.b.x, p.b.y]; }).toEqual([420, 230]);

 // Object clipboard: copy/paste keeps the pose with new IDs; a text field keeps the normal clipboard.
 await edit('copy');
 await edit('paste');
 await expect.poll(count).toBe(5);
 const pasted = await selection();
 expect(pasted).toHaveLength(1);
 expect(pasted[0]).not.toBe('b');
 expect((await poses())[pasted[0]]).toMatchObject({x: 420, y: 230});
 const search = page.getByRole('searchbox', {name: 'Search objects', exact: true});
 await search.fill('Gamma');
 await search.selectText();
 await edit('copy');
 await search.fill('');
 await search.focus();
 await edit('paste');
 await expect(search).toHaveValue('Gamma');
 expect(await count()).toBe(5);
 await search.fill('');
 // Duplicate (Cmd+D menu) and Delete key on the selection.
 await row('Gamma').click();
 await menu('Duplicate');
 await expect.poll(count).toBe(6);
 await page.locator('body').click({position: {x: 5, y: 5}}).catch(() => {});
 await page.evaluate(() => (document.activeElement instanceof HTMLElement) && document.activeElement.blur());
 await page.keyboard.press('Backspace');
 await expect.poll(count).toBe(5);
 await menu('Undo');
 await menu('Undo');
 await menu('Undo');
 await expect.poll(count).toBe(4);
 console.log('PASS object copy/paste with new IDs, text-field clipboard untouched, Duplicate and Delete keys');

 // Layers drag/drop: into Parent (world pose preserved), then before Alpha at the root.
 const parentRow = page.locator('[data-entity-id="p"]'), gammaRow = page.locator('[data-entity-id="c"]');
 const worldBefore = await pixel(700, 180);
 await gammaRow.dragTo(parentRow);
 await expect.poll(() => page.locator('[data-entity-id="c"]').evaluate(el => el.style.paddingLeft)).toBe('12px');
 expect(await pixel(700, 180)).toEqual(worldBefore);
 await page.locator('[data-entity-id="c"]').dragTo(page.locator('[data-entity-id="a"]'), {targetPosition: {x: 40, y: 2}});
 await expect.poll(() => page.locator('[data-entity-id]').evaluateAll(rows => rows.map(r => r.dataset.entityId))).toEqual(['c', 'a', 'b', 'p']);
 expect(await pixel(700, 180)).toEqual(worldBefore);
 console.log('PASS Layers drag/drop reparent and reorder with preserved world pose');

 // Project stage size: portrait preset reaches the editor frame, the saved file and the exported player.
 await page.getByRole('button', {name: 'Scenes', exact: true}).click();
 await page.getByRole('combobox', {name: 'Stage size preset', exact: true}).selectOption('1080x1920');
 await expect(canvas).toHaveAttribute('data-stage', '1080x1920');
 await menu('Undo');
 await expect(canvas).toHaveAttribute('data-stage', '960x540');
 await menu('Redo');
 await expect(canvas).toHaveAttribute('data-stage', '1080x1920');
 await page.keyboard.press('Escape');
 await menu('Save');
 await clean();
 const saved = JSON.parse(await readFile(file, 'utf8'));
 expect(saved.stage).toEqual({width: 1080, height: 1920});
 expect(saved.scenes[0].entities.find(e => e.id === 'c').parentId).toBeNull();

 const exportDir = join(temp, 'export');
 await mkdir(exportDir);
 await page.getByRole('button', {name: 'Export', exact: true}).click();
 await choose(exportDir);
 await page.getByRole('button', {name: 'Export HTML…', exact: true}).click();
 await expect(page.getByTestId('build-status')).toHaveAttribute('data-phase', 'complete', {timeout: 30000});
 const output = await page.getByTestId('build-output').innerText();
 expect((await readdir(output))).toContain('index.html');
 expect(JSON.parse(await readFile(join(output, 'project.json'), 'utf8')).project.stage).toEqual({width: 1080, height: 1920});
 server = createServer(async (req, res) => {
  try {
   const path = resolve(output, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/$/, '/index.html'));
   if (!path.startsWith(resolve(output) + sep)) throw Error('outside');
   res.setHeader('Content-Type', {'.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json'}[extname(path)] ?? 'application/octet-stream');
   res.end(await readFile(path));
  } catch { res.statusCode = 404; res.end(); }
 });
 await new Promise(r => server.listen(0, '127.0.0.1', r));
 browser = await chromium.launch({channel: 'chrome', headless: true, args: ['--enable-unsafe-swiftshader']});
 const game = await browser.newPage({viewport: {width: 1200, height: 800}});
 await game.goto(`http://127.0.0.1:${server.address().port}`);
 await game.getByRole('button', {name: 'Start', exact: true}).click({timeout: 30000});
 const box = await game.locator('#game canvas').boundingBox();
 expect(Math.abs(box.width / box.height - 1080 / 1920)).toBeLessThan(0.01);
 expect(Math.abs(box.height - 800)).toBeLessThan(1);
 expect(await game.locator('#game').getAttribute('data-stage')).toBe('1080x1920');
 expect(errors).toEqual([]);
 await mkdir(join(root, 'outputs'), {recursive: true});
 await page.screenshot({path: join(root, 'outputs/editor-authoring.png')});
 console.log('PASS project stage size: editor frame, Undo/Redo, saved file and portrait HTML export');
} catch (error) {
 await mkdir(join(root, 'outputs'), {recursive: true});
 const page = app ? await app.firstWindow().catch(() => null) : null;
 await page?.screenshot({path: join(root, 'outputs/authoring-failure.png')}).catch(() => {});
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
