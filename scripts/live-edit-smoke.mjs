// Live edit (hot reload): while Preview runs, Properties stays editable and changes reach the running game — a shape
// is patched in place, a moving physics body restarts from its new position — edits survive Stop, and the setting
// turns it off.
import {_electron as electron, expect} from '@playwright/test';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(join(root, 'apps/editor-desktop/package.json'));
const sharp = require('sharp');
const temp = await mkdtemp(join(tmpdir(), 'rewrite-live-edit-'));
const env = {...process.env};
delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
 const file = join(temp, 'live-edit.pixieditor');
 app = await electron.launch({executablePath: process.env.REWRITE_EXECUTABLE || require('electron'), args: [...(process.env.REWRITE_EXECUTABLE ? [] : [join(root, 'apps/editor-desktop/out/main/index.js')]), '--no-hub', `--user-data-dir=${join(temp, 'user')}`], env});
 const page = await app.firstWindow();
 page.setDefaultTimeout(15000);
 const errors = [];
 page.on('pageerror', e => errors.push(e.message));
 page.on('console', m => { if (process.env.DEBUG_CONSOLE && m.type() !== 'log') console.log('[console]', m.type(), m.text().slice(0, 1500)); });
 const canvas = page.getByTestId('pixi-canvas');
 await expect(canvas).toHaveAttribute('data-ready', 'true', {timeout: 30000});
 const menu = label => app.evaluate(({Menu}, text) => Menu.getApplicationMenu().items.flatMap(m => m.submenu?.items ?? []).find(i => i.label === text).click(), label);
 const choose = path => app.evaluate(({dialog}, target) => { dialog.showOpenDialog = async () => ({canceled: false, filePaths: [target]}); dialog.showSaveDialog = async () => ({canceled: false, filePath: target}); dialog.showMessageBox = async () => ({response: 1, checkboxChecked: false}); }, path);
 await choose(file); await menu('Save');
 await expect.poll(() => readFile(file, 'utf8').then(() => true, () => false)).toBe(true);
 const project = JSON.parse(await readFile(file, 'utf8'));
 const t = (id, x, y) => ({id: `${id}-t`, type: 'scene.transform2d', version: 1, data: {x, y, rotation: 0, scaleX: 1, scaleY: 1}});
 const shape = (id, color, w = 80) => ({id: `${id}-s`, type: 'pixi.shape', version: 1, data: {alpha: 1, kind: 'rect', width: w, height: 80, color, rounded: 0, sides: 5, innerRadius: .5, strokeColor: '#ffffff', strokeWidth: 0}});
 project.scenes[0].entities = [
  {id: 'box', name: 'Box', parentId: null, active: true, components: [t('box', 200, 200), shape('box', '#e04040')]},
  {id: 'crate', name: 'Crate', parentId: null, active: true, components: [t('crate', 300, 420), shape('crate', '#5bc0eb', 40), {id: 'crate-rb', type: 'physics.rigidBody2d', version: 1, data: {bodyType: 'dynamic', density: .001, friction: 0, restitution: 0, airFriction: 0, lockRotation: true, velocityX: 60, velocityY: 0, angularVelocity: 0, frictionStatic: 0, gravityScale: 0, mass: 0, layer: 0, mask: 65535, group: 0, draggable: false, bullet: false}}, {id: 'crate-c', type: 'physics.boxCollider2d', version: 1, data: {width: 40, height: 40, offsetX: 0, offsetY: 0, sensor: false, chamfer: 0}}]},
 ];
 await writeFile(file, JSON.stringify(project));
 await choose(file); await menu('Open…');
 await expect.poll(async () => Object.keys(JSON.parse(await canvas.getAttribute('data-transforms') ?? '{}'))).toContain('crate');
 const view = async () => { const b = await canvas.locator('canvas').boundingBox(), s = Math.min((b.width - 80) / 960, (b.height - 90) / 540); return {b, at: (x, y) => ({x: b.x + (b.width - 960 * s) / 2 + x * s, y: b.y + (b.height - 540 * s) / 2 + y * s})}; };
 const pixel = async (x, y) => {
  const {b, at} = await view(), p = at(x, y), buffer = await canvas.locator('canvas').screenshot(), ratio = (await sharp(buffer).metadata()).width / b.width;
  return [...await sharp(buffer).extract({left: Math.round((p.x - b.x) * ratio), top: Math.round((p.y - b.y) * ratio), width: 1, height: 1}).removeAlpha().raw().toBuffer()];
 };
 const red = ([r, g, b]) => r > g + 80 && r > b + 80;
 const where = async id => JSON.parse(await canvas.getAttribute('data-transforms'))[id];
 const select = async name => { await page.getByRole('button', {name: 'Layers', exact: true}).click(); await page.getByRole('button', {name: `Select ${name}`, exact: true}).click(); await page.keyboard.press('Escape'); await page.getByRole('button', {name: 'Properties', exact: true}).click(); };
 const props = page.getByTestId('properties');

 await page.getByRole('button', {name: 'Play', exact: true}).click();
 await expect.poll(async () => (await where('crate')).x).toBeGreaterThan(320);
 expect(red(await pixel(120, 200))).toBe(false);
 await select('Box');
 await props.locator('details.component > summary').filter({hasText: /^Shape/}).click();
 const width = props.getByRole('spinbutton', {name: 'width', exact: true}).first();
 await expect(width).toBeEnabled();
 await width.fill('200'); await width.press('Enter');
 await expect.poll(async () => red(await pixel(120, 200))).toBe(true);
 await expect(canvas).toHaveAttribute('data-live-edits', /[1-9]/);
 console.log('PASS Preview: Properties stays editable and a shape change shows in the running game');

 await page.keyboard.press('Escape');
 await select('Crate');
 const x = props.getByRole('spinbutton', {name: 'x', exact: true});
 await x.fill('700'); await x.press('Enter');
 await expect.poll(async () => (await where('crate')).x).toBeGreaterThan(690);
 const a = (await where('crate')).x; await page.waitForTimeout(300);
 expect((await where('crate')).x).toBeGreaterThan(a);
 await page.keyboard.press('Escape');
 await page.getByRole('button', {name: 'Stop', exact: true}).click();
 await expect.poll(async () => (await where('box')) && (await where('crate')).x).toBe(700);
 expect(red(await pixel(120, 200))).toBe(true);
 console.log('PASS a physics body restarts from its new position and keeps moving; edits stay after Stop');

 await page.getByRole('button', {name: 'Editor settings', exact: true}).click(); await page.getByRole('menuitem', {name: /^Settings…/}).click();
 const dialog = page.getByTestId('settings-dialog');
 await dialog.getByRole('searchbox', {name: 'Search settings', exact: true}).fill('Preview runs');
 await dialog.locator('[data-setting="studio.liveEdit"]').locator('input[type=checkbox]').uncheck();
 await page.keyboard.press('Escape');
 await page.getByRole('button', {name: 'Play', exact: true}).click();
 await select('Box');
 await expect(props).toBeVisible();
 await expect(props.getByRole('spinbutton', {name: 'x', exact: true}).and(props.locator('input:enabled'))).toHaveCount(0);
 await page.keyboard.press('Escape');
 await page.getByRole('button', {name: 'Stop', exact: true}).click();
 expect(errors).toEqual([]);
 console.log('PASS turning the setting off locks Properties during Preview again');
} catch (error) {
 await mkdir(join(root, 'outputs'), {recursive: true});
 const page = app ? await app.firstWindow().catch(() => null) : null;
 await page?.screenshot({path: join(root, 'outputs/live-edit-failure.png')}).catch(() => {});
 throw error;
} finally {
 if (app) { await app.evaluate(({BrowserWindow}) => { for (const w of BrowserWindow.getAllWindows()) w.destroy(); }).catch(() => {}); await app.close().catch(() => {}); }
 await rm(temp, {recursive: true, force: true, maxRetries: 3});
}
