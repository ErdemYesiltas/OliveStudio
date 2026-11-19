// Add menu and Settings: every module-contributed object through the toolbar Add menu (one undo step each), shape
// kinds with per-kind fields, module settings (grid, search, reset, persistence), then texture-backed Pixi objects
// rendered in the editor, advanced by the Preview clock and drawn the same way in exported HTML.
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
const temp = await mkdtemp(join(tmpdir(), 'rewrite-create-'));
const env = {...process.env};
delete env.ELECTRON_RUN_AS_NODE;
const RED = [220, 60, 60], GREEN = [60, 200, 90], BLUE = [60, 90, 220];
const near = (a, b, tolerance = 8) => a.every((v, i) => Math.abs(v - b[i]) <= tolerance);
const ITEMS = [
 [null, 'Container', 'Container', []], ['Shapes', 'Rectangle', 'Rectangle', ['pixi.shape']], ['Shapes', 'Rounded rectangle', 'Rounded rectangle', ['pixi.shape']],
 ['Shapes', 'Circle', 'Circle', ['pixi.shape']], ['Shapes', 'Ellipse', 'Ellipse', ['pixi.shape']], ['Shapes', 'Triangle', 'Triangle', ['pixi.shape']],
 ['Shapes', 'Polygon', 'Polygon', ['pixi.shape']], ['Shapes', 'Star', 'Star', ['pixi.shape']], ['Shapes', 'Line', 'Line', ['pixi.shape']],
 ['Sprites', 'Sprite', 'Sprite', ['pixi.sprite']], ['Sprites', 'Animated sprite', 'Animated sprite', ['pixi.flipbook']], ['Sprites', 'Tiling sprite', 'Tiling sprite', ['pixi.tilingSprite']],
 ['Sprites', 'Nine-slice sprite', 'Nine-slice sprite', ['pixi.nineSlice']], ['Text', 'Text', 'Text', ['pixi.text']], ['Text', 'Bitmap text', 'Bitmap text', ['pixi.bitmapText']], ['Meshes', 'Mesh plane', 'Mesh plane', ['pixi.mesh']],
 ['Meshes', 'Rope', 'Rope', ['pixi.rope']], ['Effects', 'Particles', 'Particles', ['pixi.particles']], [null, 'Spine skeleton', 'Spine', ['spine.renderer']], ['Audio', 'Sound', 'Sound', ['audio.source']], ['Audio', 'Audio listener', 'Audio listener', ['audio.listener']], ['Logic', 'State machine', 'State machine', ['interactions.stateMachine']],
];
let app, browser, server;

try {
 // 64×64 texture: left half red, right half green.
 await sharp({create: {width: 64, height: 64, channels: 4, background: {r: RED[0], g: RED[1], b: RED[2], alpha: 1}}}).composite([{input: {create: {width: 32, height: 64, channels: 4, background: {r: GREEN[0], g: GREEN[1], b: GREEN[2], alpha: 1}}}, left: 32, top: 0}]).png().toFile(join(temp, 'halves.png'));
 const file = join(temp, 'create.pixieditor');
 const launch = async () => {
  app = await electron.launch({executablePath: process.env.REWRITE_EXECUTABLE || require('electron'), args: [...(process.env.REWRITE_EXECUTABLE ? [] : [join(root, 'apps/editor-desktop/out/main/index.js')]), '--no-hub', `--user-data-dir=${join(temp, 'user')}`], env});
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  await expect(page.getByTestId('pixi-canvas')).toHaveAttribute('data-ready', 'true', {timeout: 30000});
  return page;
 };
 let page = await launch();
 const errors = [];
 page.on('pageerror', e => errors.push(e.message));
 const menu = label => app.evaluate(({Menu}, text) => Menu.getApplicationMenu().items.flatMap(m => m.submenu?.items ?? []).find(i => i.label === text).click(), label);
 const choose = path => app.evaluate(({dialog}, target) => {
  dialog.showOpenDialog = async () => ({canceled: false, filePaths: [target]});
  dialog.showSaveDialog = async () => ({canceled: false, filePath: target});
  dialog.showMessageBox = async () => ({response: 1, checkboxChecked: false});
 }, path);
 const save = async () => { await choose(file); await menu('Save'); await expect(page.getByLabel('Unsaved changes', {exact: true})).toHaveCount(0); await expect.poll(() => readFile(file, 'utf8').then(() => true, () => false)).toBe(true); return JSON.parse(await readFile(file, 'utf8')); };
 const add = async (group, label) => {
  await page.getByRole('button', {name: 'Add', exact: true}).click();
  // Submenus by keyboard (ArrowRight, Enter): a pointer moving diagonally over other categories can switch Radix submenus.
  if (group) {
   const trigger = page.getByRole('menuitem', {name: group, exact: true}), sub = page.getByRole('menu', {name: group});
   await expect(async () => { if (!await sub.isVisible()) { await trigger.focus(); await page.keyboard.press('ArrowRight'); } await expect(sub).toBeVisible({timeout: 1000}); }).toPass({timeout: 10000});
   await sub.getByRole('menuitem', {name: label, exact: true}).focus();
   await page.keyboard.press('Enter');
  } else await page.getByTestId('add-menu').getByRole('menuitem', {name: label, exact: true}).click();
  await expect(page.getByTestId('add-menu')).toHaveCount(0);
 };

 // Add menu: categories in order, single-item categories inline, submenus for the rest.
 await page.getByRole('button', {name: 'Add', exact: true}).click();
 const top = page.getByTestId('add-menu').getByRole('menuitem');
 await expect(top).toHaveText(['Container', 'Camera', 'Layout', 'Shapes', 'Sprites', 'Text', 'Meshes', 'Effects', 'Spine skeleton', 'Audio', 'Logic']);
 const shapes = page.getByRole('menu', {name: 'Shapes'});
 await expect(async () => { if (!await shapes.isVisible()) { await page.getByRole('menuitem', {name: 'Shapes', exact: true}).focus(); await page.keyboard.press('ArrowRight'); } await expect(shapes).toBeVisible({timeout: 1000}); }).toPass({timeout: 10000});
 await expect(shapes.getByRole('menuitem')).toHaveCount(8);
 await page.keyboard.press('Escape'); await page.keyboard.press('Escape');

 // Panel shortcuts (Option + letter) and distinct panel icons.
 const triggers = page.locator('[data-panel-trigger]');
 const shortcuts = await triggers.evaluateAll(nodes => nodes.map(n => [n.getAttribute('aria-label'), n.getAttribute('aria-keyshortcuts'), n.querySelector('svg')?.getAttribute('class')]));
 expect(shortcuts.length).toBeGreaterThanOrEqual(13);
 expect(shortcuts.every(([, key]) => /^Alt\+[A-Z]$/.test(key ?? ''))).toBe(true);
 expect(new Set(shortcuts.map(([, key]) => key)).size).toBe(shortcuts.length);
 const icon = label => shortcuts.find(([name]) => name === label)[2];
 expect(icon('Prefabs')).not.toBe(icon('Export')); expect(icon('Scenes')).not.toBe(icon('Layers'));
 await page.keyboard.press('Alt+KeyL');
 await expect(page.getByTestId('layers-list')).toBeVisible();
 await page.keyboard.press('Escape');
 await expect(page.getByTestId('layers-list')).toHaveCount(0);
 await page.keyboard.press('Alt+KeyP');
 await expect(page.getByRole('dialog', {name: 'Properties'})).toBeVisible();
 await page.keyboard.press('Alt+KeyP');
 await expect(page.getByRole('dialog', {name: 'Properties'})).toHaveCount(0);
 await page.getByRole('button', {name: 'Editor settings', exact: true}).click(); await page.getByRole('menuitem', {name: /^Settings…/}).click();
 await page.getByTestId('settings-dialog').getByRole('searchbox').focus(); await page.keyboard.press('Alt+KeyL');
 await expect(page.getByTestId('layers-list')).toHaveCount(0);
 await page.keyboard.press('Escape');
 console.log('PASS every panel has a unique Option shortcut; it toggles the panel and is ignored while typing or in a dialog; icons are distinct');

 // Star: centred in the view, one undo step; fields follow the shape kind.
 const before = (await save()).scenes[0].entities.length;
 await add('Shapes', 'Star');
 await page.getByRole('button', {name: 'Properties', exact: true}).click();
 await expect(page.getByRole('textbox', {name: 'Object name', exact: true})).toHaveValue('Star');
 await page.locator('details.component > summary').filter({hasText: /^Shape/}).click();
 await expect(page.getByLabel('kind', {exact: true})).toHaveValue('star');
 await expect(page.getByLabel('sides', {exact: true})).toBeVisible();
 await expect(page.getByLabel('innerRadius', {exact: true})).toBeVisible();
 await expect(page.getByLabel('rounded', {exact: true})).toHaveCount(0);
 await page.getByLabel('kind', {exact: true}).selectOption('rect');
 await expect(page.getByLabel('rounded', {exact: true})).toBeVisible();
 await expect(page.getByLabel('sides', {exact: true})).toHaveCount(0);
 await page.keyboard.press('Escape');
 await menu('Undo'); await menu('Undo');
 expect((await save()).scenes[0].entities.length).toBe(before);
 console.log('PASS Add menu groups items by category; Star adds in one undo step and its fields follow the shape kind');

 for (const [group, label] of ITEMS) await add(group, label);
 const added = (await save()).scenes[0].entities.slice(before);
 expect(added.map(e => e.name)).toEqual(ITEMS.map(i => i[2]));
 expect(added.map(e => e.components.filter(c => c.type !== 'scene.transform2d').map(c => c.type))).toEqual(ITEMS.map(i => i[3]));
 expect(added.filter(e => e.components.some(c => c.type === 'pixi.shape')).map(e => e.components.find(c => c.type === 'pixi.shape').data.kind)).toEqual(['rect', 'rect', 'ellipse', 'ellipse', 'triangle', 'polygon', 'star', 'line']);
 expect(errors).toEqual([]);
 console.log(`PASS all ${ITEMS.length} Add menu items create entities with their module components`);

 // Settings: module sections, live grid, search, reset all, persisted on this machine.
 await menu('Settings…');
 const dialog = page.getByTestId('settings-dialog');
 for (const section of ['Viewport', 'Physics', 'Audio', 'Input', 'Recovery']) await expect(dialog.getByRole('region', {name: section, exact: true})).toBeVisible();
 await dialog.getByRole('switch', {name: 'Show grid', exact: true}).check();
 await expect(page.locator('.viewport-navigation button[aria-label="Show grid"]')).toHaveAttribute('aria-pressed', 'true');
 await dialog.getByRole('combobox', {name: 'Grid step', exact: true}).selectOption('64');
 await expect(page.getByLabel('Grid spacing', {exact: true})).toHaveValue('64');
 await dialog.getByRole('switch', {name: 'Collider outlines', exact: true}).check();
 // VS Code layout: the section tree jumps to a section and follows the scroll; @modified and the filter show changed settings.
 const tree = dialog.getByRole('navigation', {name: 'Settings sections', exact: true});
 await tree.getByRole('button', {name: 'Physics', exact: true}).click();
 await expect(tree.getByRole('button', {name: 'Physics', exact: true})).toHaveAttribute('aria-current', 'true');
 await expect.poll(() => dialog.getByTestId('settings-content').evaluate(box => { const s = box.querySelector('section[data-section="module.physics"]'); return Math.abs(s.offsetTop - box.offsetTop - box.scrollTop); })).toBeLessThan(4);
 await dialog.getByTestId('settings-content').evaluate(box => { box.style.scrollBehavior = 'auto'; box.scrollTop = 0; box.dispatchEvent(new Event('scroll')); });
 await expect(tree.locator('[aria-current="true"]')).toHaveText('Game (this project)');
 await expect(dialog.getByText('3 modified', {exact: true})).toBeVisible();
 await dialog.getByRole('searchbox', {name: 'Search settings', exact: true}).fill('@modified');
 await expect(dialog.locator('[data-setting]')).toHaveCount(3);
 await expect(dialog.locator('[data-setting][data-modified="true"]')).toHaveCount(3);
 await expect(dialog.locator('[data-project-section]')).toHaveCount(0);
 await dialog.getByRole('searchbox', {name: 'Search settings', exact: true}).fill('');
 await dialog.getByRole('button', {name: 'Show modified settings only', exact: true}).click();
 await expect(dialog.locator('[data-setting]')).toHaveCount(3);
 await dialog.getByRole('button', {name: 'Show modified settings only', exact: true}).click();
 await dialog.getByRole('searchbox', {name: 'Search settings', exact: true}).fill('volume');
 await expect(dialog.locator('[data-setting]')).toHaveCount(1);
 await dialog.getByRole('slider', {name: 'Library preview volume', exact: true}).fill('60');
 await expect(dialog.locator('[data-setting="audio.previewVolume"] output')).toHaveText('60%');
 await dialog.getByRole('searchbox', {name: 'Search settings', exact: true}).fill('');
 await dialog.getByRole('button', {name: 'Reset Show grid', exact: true}).click();
 await expect(page.locator('.viewport-navigation button[aria-label="Show grid"]')).toHaveAttribute('aria-pressed', 'false');
 await page.keyboard.press('Escape');
 await expect(dialog).toHaveCount(0);
 await expect(page.getByLabel('Unsaved changes', {exact: true})).toHaveCount(0);
 const stored = JSON.parse(await page.evaluate(() => localStorage.getItem('rewrite:settings')));
 expect(stored).toMatchObject({'pixi.gridStep': '64', 'physics.debugOutlines': true, 'audio.previewVolume': 60});
 expect(stored['pixi.gridVisible']).toBeUndefined();
 console.log('PASS Settings shows module sections, applies the grid live, searches, resets and stays out of the project');

 // Settings survive a restart; Reset all returns to defaults.
 await app.evaluate(({BrowserWindow}) => { for (const w of BrowserWindow.getAllWindows()) w.destroy(); }).catch(() => {});
 await app.close().catch(() => {});
 page = await launch();
 page.on('pageerror', e => errors.push(e.message));
 await page.getByRole('button', {name: 'Continue without restoring', exact: true}).click();
 await page.getByRole('button', {name: 'Editor settings', exact: true}).click();
 await page.getByRole('menuitem', {name: /^Settings…/}).click();
 const again = page.getByTestId('settings-dialog');
 await expect(again.getByRole('switch', {name: 'Collider outlines', exact: true})).toBeChecked();
 await expect(again.getByRole('combobox', {name: 'Grid step', exact: true})).toHaveValue('64');
 await again.getByRole('button', {name: 'Reset all to defaults', exact: true}).click();
 await expect(again.getByRole('switch', {name: 'Collider outlines', exact: true})).not.toBeChecked();
 await expect(again.getByRole('button', {name: 'Reset all to defaults', exact: true})).toBeDisabled();
 await page.keyboard.press('Escape');
 console.log('PASS settings persist across restarts and Reset all restores defaults');

 // Texture-backed objects: import the image, place each object, check pixels while editing.
 const canvas2 = page.getByTestId('pixi-canvas');
 const menu2 = label => app.evaluate(({Menu}, text) => Menu.getApplicationMenu().items.flatMap(m => m.submenu?.items ?? []).find(i => i.label === text).click(), label);
 await page.getByRole('button', {name: 'Library', exact: true}).click();
 await choose(join(temp, 'halves.png'));
 await page.getByRole('button', {name: 'Import image…', exact: true}).click();
 await expect(page.getByTestId('asset-list').getByText('halves', {exact: true})).toBeVisible({timeout: 30000});
 await page.keyboard.press('Escape');
 await rm(file, {force: true}); await choose(file); await menu2('Save');
 await expect(page.getByLabel('Unsaved changes', {exact: true})).toHaveCount(0);
 await expect.poll(() => readFile(file, 'utf8').then(() => true, () => false)).toBe(true);
 const project = JSON.parse(await readFile(file, 'utf8')), texture = project.extensions['assets.registry'].items.find(a => a.type === 'pixi.texture').id;
 const t = (id, x, y) => ({id: `${id}-t`, type: 'scene.transform2d', version: 1, data: {x, y, rotation: 0, scaleX: 1, scaleY: 1}});
 const entity = (id, x, y, type, data) => ({id, name: id, parentId: null, active: true, components: [t(id, x, y), {id: `${id}-c`, type, version: 1, data}]});
 const look = {assetId: texture, alpha: 1, tint: '#ffffff'};
 project.scenes[0].entities = [
  entity('tiling', 200, 100, 'pixi.tilingSprite', {...look, width: 256, height: 64, anchorX: .5, anchorY: .5, tileScale: 1, scrollX: 64, scrollY: 0}),
  entity('nine', 600, 100, 'pixi.nineSlice', {...look, width: 300, height: 100, anchorX: .5, anchorY: .5, left: 16, top: 16, right: 16, bottom: 16}),
  entity('mesh', 200, 260, 'pixi.mesh', {...look, width: 256, height: 64, columns: 8, rows: 4, amplitude: 0, waveLength: 200, speed: 1}),
  entity('rope', 600, 260, 'pixi.rope', {...look, length: 256, thickness: 48, points: 16, amplitude: 0, waveLength: 200, speed: 1}),
  entity('particles', 200, 440, 'pixi.particles', {...look, assetId: '', count: 80, lifetime: 1.5, speed: 60, direction: -90, spread: 90, gravity: 0, size: 6, endScale: 0.5, endAlpha: 0, seed: 3}),
  entity('star', 600, 440, 'pixi.shape', {alpha: 1, kind: 'star', width: 120, height: 120, color: '#3c5adc', rounded: 0, sides: 5, innerRadius: 0.5, strokeColor: '#ffffff', strokeWidth: 0}),
 ];
 await writeFile(file, JSON.stringify(project));
 await choose(file); await menu2('Open…');
 await expect.poll(async () => JSON.parse(await canvas2.getAttribute('data-visuals') ?? '[]').length, {timeout: 30000}).toBe(5);
 await expect.poll(async () => JSON.parse(await canvas2.getAttribute('data-visuals')).every(v => v.ready)).toBe(true);
 const view = async () => { const b = await canvas2.locator('canvas').boundingBox(), s = Math.min((b.width - 80) / 960, (b.height - 90) / 540); return {b, at: (x, y) => ({x: b.x + (b.width - 960 * s) / 2 + x * s, y: b.y + (b.height - 540 * s) / 2 + y * s})}; };
 const pixel = async (x, y) => {
  const {b, at} = await view(), p = at(x, y), buffer = await canvas2.locator('canvas').screenshot(), ratio = (await sharp(buffer).metadata()).width / b.width;
  return [...await sharp(buffer).extract({left: Math.round((p.x - b.x) * ratio), top: Math.round((p.y - b.y) * ratio), width: 1, height: 1}).removeAlpha().raw().toBuffer()];
 };
 const checks = [['tiling left', 88, 100, RED], ['tiling right', 120, 100, GREEN], ['nine-slice left edge', 458, 100, RED], ['nine-slice right edge', 742, 100, GREEN], ['mesh left', 104, 260, RED], ['mesh right', 296, 260, GREEN], ['rope left', 504, 260, RED], ['rope right', 696, 260, GREEN], ['star', 600, 440, BLUE]];
 for (const [label, x, y, color] of checks) await expect.poll(async () => near(await pixel(x, y), color), {message: label}).toBe(true);
 console.log('PASS tiling, nine-slice, mesh plane, rope and star render their texture/colour while editing; particles are ready');

 // Paused Preview: 30 steps (0.5 s) scroll the tiling sprite by 32 px → the left sample turns green.
 await page.getByRole('button', {name: 'Play', exact: true}).click();
 await page.getByRole('button', {name: 'Pause / Resume', exact: true}).click();
 for (let i = 0; i < 30; i++) await page.getByRole('button', {name: 'Step', exact: true}).click();
 expect(Number(await canvas2.getAttribute('data-runtime-time'))).toBeGreaterThanOrEqual(0.5);
 await expect.poll(async () => near(await pixel(88, 100), GREEN)).toBe(true);
 await page.getByRole('button', {name: 'Stop', exact: true}).click();
 await expect.poll(async () => near(await pixel(88, 100), RED)).toBe(true);
 console.log('PASS Preview drives tiling scroll from the runtime clock; Stop returns to the authored pose');

 // Export: one `objects` runtime chunk, the same pixels in the browser game.
 const exportDir = join(temp, 'export');
 await mkdir(exportDir);
 await page.getByRole('button', {name: 'Export', exact: true}).click();
 await choose(exportDir);
 await page.getByRole('button', {name: 'Export HTML…', exact: true}).click();
 await expect(page.getByTestId('build-status')).toHaveAttribute('data-phase', /complete|failed/, {timeout: 30000});
 expect(await page.getByTestId('build-status').innerText()).not.toMatch(/Error/);
 const output = await page.getByTestId('build-output').innerText();
 const bundle = JSON.parse(await readFile(join(output, 'project.json'), 'utf8'));
 expect(bundle.runtimes).toContain('objects');
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
 const game = await browser.newPage({viewport: {width: 960, height: 540}});
 const gameErrors = [];
 game.on('pageerror', e => gameErrors.push(e.message));
 await game.goto(`http://127.0.0.1:${server.address().port}`);
 await game.getByRole('button', {name: 'Start', exact: true}).click({timeout: 30000});
 await expect(game.locator('#game')).toHaveAttribute('data-scene-id', project.entrySceneId);
 const gamePixel = async (x, y) => {
  const box = await game.locator('#game canvas').boundingBox(), s = Math.min(box.width / 960, box.height / 540), buffer = await game.screenshot();
  const px = Math.round(box.x + (box.width - 960 * s) / 2 + x * s), py = Math.round(box.y + (box.height - 540 * s) / 2 + y * s);
  return [...await sharp(buffer).extract({left: px, top: py, width: 1, height: 1}).removeAlpha().raw().toBuffer()];
 };
 for (const [label, x, y, color] of checks.filter(c => !c[0].startsWith('tiling'))) await expect.poll(async () => near(await gamePixel(x, y), color), {message: `game ${label}`}).toBe(true);
 expect(gameErrors).toEqual([]);
 expect(errors).toEqual([]);
 await mkdir(join(root, 'outputs'), {recursive: true});
 await page.screenshot({path: join(root, 'outputs/editor-create.png')});
 await game.screenshot({path: join(root, 'outputs/game-objects.png')});
 console.log('PASS exported game ships the objects chunk and draws nine-slice, mesh, rope and star like the editor');
} catch (error) {
 await mkdir(join(root, 'outputs'), {recursive: true});
 const page = app ? await app.firstWindow().catch(() => null) : null;
 await page?.screenshot({path: join(root, 'outputs/create-failure.png')}).catch(() => {});
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
