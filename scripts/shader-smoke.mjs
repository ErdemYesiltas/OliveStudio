// Custom shaders: create one from a preset in the Shaders panel, apply it to the selection, tune a uniform in the
// Inspector, break and fix the code (errors by line, broken shaders are not drawn), Preview, and the exported game.
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
const temp = await mkdtemp(join(tmpdir(), 'rewrite-shader-'));
const env = {...process.env};
delete env.ELECTRON_RUN_AS_NODE;
const RED = [220, 60, 60], GREEN = [60, 200, 90];
const hex = c => '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
const near = (a, b, tolerance = 12) => a.every((v, i) => Math.abs(v - b[i]) <= tolerance);
const reddish = ([r, g, b]) => r > g + 80 && r > b + 80;
const gray = p => Math.max(...p) - Math.min(...p) <= 12 && !near(p, RED, 40);
let app, browser, server, game;
try {
 const file = join(temp, 'shader.pixieditor');
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
 const shape = (id, color) => ({id: `${id}-s`, type: 'pixi.shape', version: 1, data: {alpha: 1, kind: 'rect', width: 120, height: 120, color: hex(color), rounded: 0, sides: 5, innerRadius: .5, strokeColor: '#ffffff', strokeWidth: 0}});
 project.scenes[0].entities = [
  {id: 'box', name: 'Box', parentId: null, active: true, components: [t('box', 200, 200), shape('box', RED)]},
  {id: 'other', name: 'Other', parentId: null, active: true, components: [t('other', 520, 200), shape('other', GREEN)]},
 ];
 await writeFile(file, JSON.stringify(project));
 await choose(file); await menu('Open…');
 await expect.poll(async () => Object.keys(JSON.parse(await canvas.getAttribute('data-transforms') ?? '{}'))).toContain('other');
 const view = async () => { const b = await canvas.locator('canvas').boundingBox(), s = Math.min((b.width - 80) / 960, (b.height - 90) / 540); return {b, at: (x, y) => ({x: b.x + (b.width - 960 * s) / 2 + x * s, y: b.y + (b.height - 540 * s) / 2 + y * s})}; };
 const pixel = async (x, y) => {
  const {b, at} = await view(), p = at(x, y), buffer = await canvas.locator('canvas').screenshot(), ratio = (await sharp(buffer).metadata()).width / b.width;
  return [...await sharp(buffer).extract({left: Math.round((p.x - b.x) * ratio), top: Math.round((p.y - b.y) * ratio), width: 1, height: 1}).removeAlpha().raw().toBuffer()];
 };
 await expect.poll(async () => reddish(await pixel(165, 250))).toBe(true);

 const panel = page.getByTestId('shader-panel');
 const openPanel = async () => { if (!await panel.isVisible()) await page.keyboard.press('Alt+KeyH'); await expect(panel).toBeVisible(); };
 await openPanel();
 await panel.getByRole('combobox', {name: 'New shader'}).selectOption({label: 'Grayscale'});
 await expect(panel.getByRole('listbox', {name: 'Project shaders'}).getByRole('option', {name: 'Grayscale'})).toHaveAttribute('aria-selected', 'true');
 await expect(panel.getByTestId('shader-status')).toContainText('Compiles · 1 controls · used by 0 objects');
 await expect(panel.getByRole('button', {name: 'Apply to selection'})).toBeDisabled();
 await page.keyboard.press('Escape');
 const p = (await view()).at(200, 200); await page.mouse.click(p.x, p.y);
 await openPanel();
 await panel.getByRole('button', {name: 'Apply to selection'}).click();
 await expect.poll(async () => gray(await pixel(165, 250))).toBe(true);
 { const [r, g, b] = await pixel(520, 250); expect(g > r + 80 && g > b + 80).toBe(true); }
 await expect(panel.getByTestId('shader-status')).toContainText('used by 1 objects');
 await expect(panel.getByRole('button', {name: 'Delete'})).toBeDisabled();
 console.log('PASS preset shader created, applied to the selected object only (it turns gray)');

 await page.keyboard.press('Escape');
 await page.keyboard.press('Alt+KeyP');
 const inspector = page.getByTestId('shader-inspector');
 await page.locator('details.component > summary').filter({hasText: /^Custom shader/}).click();
 await expect(inspector).toBeVisible();
 await expect(inspector.getByRole('combobox', {name: 'Shader'})).toHaveValue(/.+/);
 await inspector.getByRole('spinbutton', {name: 'uAmount'}).fill('0');
 await expect.poll(async () => reddish(await pixel(165, 250))).toBe(true);
 await inspector.getByRole('spinbutton', {name: 'uAmount'}).fill('1');
 await expect.poll(async () => gray(await pixel(165, 250))).toBe(true);
 console.log('PASS the Inspector shows the shader’s uniform and tuning it changes the drawing');

 await page.keyboard.press('Escape');
 await openPanel();
 const code = panel.getByTestId('shader-source'), good = await code.inputValue();
 await code.fill(good.replace('float g =', 'float g = missing +'));
 await expect(panel.getByTestId('shader-status')).toHaveAttribute('data-ok', 'false');
 await expect(panel.getByTestId('shader-status')).toContainText('Line 5');
 await expect.poll(async () => reddish(await pixel(165, 250))).toBe(true);
 await code.fill(good.replace('mix(c.rgb, vec3(g) * c.a, uAmount)', 'mix(c.rgb, vec3(g) * c.a, uAmount) * vec3(0.0, 1.0, 0.0)'));
 await expect(panel.getByTestId('shader-status')).toHaveAttribute('data-ok', 'true');
 await expect.poll(async () => { const [r, g, b] = await pixel(165, 250); return r < 20 && b < 20 && g > 60; }).toBe(true);
 await code.fill(good);
 await expect.poll(async () => gray(await pixel(165, 250))).toBe(true);
 console.log('PASS code edits update live; an error is reported by line and the object draws without the shader');

 await page.keyboard.press('Escape');
 await page.getByRole('button', {name: 'Play', exact: true}).click();
 await expect.poll(async () => gray(await pixel(165, 250))).toBe(true);
 await page.getByRole('button', {name: 'Stop', exact: true}).click();
 console.log('PASS Preview draws the shader');

 const exportDir = join(temp, 'export');
 await mkdir(exportDir);
 await choose(file); await menu('Save');
 await expect.poll(async () => JSON.parse(await readFile(file, 'utf8')).extensions['pixi.shaders']?.items.length).toBe(1);
 const saved = JSON.parse(await readFile(file, 'utf8'));
 expect(saved.extensions['pixi.shaders'].items).toHaveLength(1);
 expect(saved.scenes[0].entities.find(e => e.id === 'box').components.find(c => c.type === 'pixi.shader').data).toMatchObject({values: {uAmount: 1}});
 await page.getByRole('button', {name: 'Export', exact: true}).click();
 await choose(exportDir);
 await page.getByRole('button', {name: 'Export HTML…', exact: true}).click();
 await expect(page.getByTestId('build-status')).toHaveAttribute('data-phase', /complete|failed/, {timeout: 30000});
 expect(await page.getByTestId('build-status').innerText()).not.toMatch(/Error/);
 const output = await page.getByTestId('build-output').innerText();
 const bundle = JSON.parse(await readFile(join(output, 'project.json'), 'utf8'));
 expect(bundle.runtimes).toContain('effects');
 expect(bundle.project.extensions['pixi.shaders'].items[0].name).toBe('Grayscale');
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
 game = await browser.newPage({viewport: {width: 960, height: 540}});
 const gameErrors = [];
 game.on('pageerror', e => gameErrors.push(e.message));
 game.on('console', m => { if (m.type() === 'error') gameErrors.push(m.text().slice(0, 300)); });
 await game.goto(`http://127.0.0.1:${server.address().port}`);
 await game.getByRole('button', {name: 'Start', exact: true}).click({timeout: 30000});
 const stage = game.locator('#game');
 await expect(stage).toHaveAttribute('data-scene-id', project.entrySceneId);
 const at = async (x, y) => { const box = await stage.locator('canvas').boundingBox(), s = Math.min(box.width / 960, box.height / 540); return {x: box.x + (box.width - 960 * s) / 2 + x * s, y: box.y + (box.height - 540 * s) / 2 + y * s}; };
 const gamePixel = async (x, y) => { const q = await at(x, y), buffer = await game.screenshot(); return [...await sharp(buffer).extract({left: Math.round(q.x), top: Math.round(q.y), width: 1, height: 1}).removeAlpha().raw().toBuffer()]; };
 await expect.poll(async () => gray(await gamePixel(165, 250))).toBe(true);
 expect(near(await gamePixel(520, 250), GREEN)).toBe(true);
 expect(gameErrors).toEqual([]);
 expect(errors).toEqual([]);
 console.log('PASS exported game: the shader library ships with the effects chunk and draws the same');
} catch (error) {
 await mkdir(join(root, 'outputs'), {recursive: true});
 const page = app ? await app.firstWindow().catch(() => null) : null;
 await page?.screenshot({path: join(root, 'outputs/shader-failure.png')}).catch(() => {});
 await game?.screenshot({path: join(root, 'outputs/shader-game-failure.png')}).catch(() => {});
 throw error;
} finally {
 await browser?.close().catch(() => {});
 if (server) await new Promise(r => server.close(r));
 if (app) { await app.evaluate(({BrowserWindow}) => { for (const w of BrowserWindow.getAllWindows()) w.destroy(); }).catch(() => {}); await app.close().catch(() => {}); }
 await rm(temp, {recursive: true, force: true, maxRetries: 3});
}
