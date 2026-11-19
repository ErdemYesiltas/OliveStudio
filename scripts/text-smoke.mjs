// Text line wrapping: a long Text with wordWrap at 300 px renders as several lines in the editor and in the exported
// game (measured from real pixels); Properties shows Wrap lines / Wrap width, and turning wrapping off gives one wide
// line (undoable).
import {_electron as electron, chromium, expect} from '@playwright/test';
import {createServer} from 'node:http';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {dirname, extname, join, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(join(root, 'apps/editor-desktop/package.json')), sharp = require('sharp');
const temp = await mkdtemp(join(tmpdir(), 'rewrite-text-'));
const env = {...process.env};
delete env.ELECTRON_RUN_AS_NODE;
let app, browser, server, game;

/** Bright pixels in a screenshot of the stage: their bounding box in stage pixels. */
async function inked(shot, scale) {
 const {data, info} = await sharp(shot).removeAlpha().raw().toBuffer({resolveWithObject: true});
 let top = Infinity, bottom = -1, left = Infinity, right = -1;
 for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) { const i = (y * info.width + x) * 3; if (data[i] > 200 && data[i + 1] > 200 && data[i + 2] > 200) { top = Math.min(top, y); bottom = Math.max(bottom, y); left = Math.min(left, x); right = Math.max(right, x); } }
 return {width: (right - left) / scale, height: (bottom - top) / scale};
}

try {
 const file = join(temp, 'text.pixieditor');
 app = await electron.launch({executablePath: process.env.REWRITE_EXECUTABLE || require('electron'), args: [...(process.env.REWRITE_EXECUTABLE ? [] : [join(root, 'apps/editor-desktop/out/main/index.js')]), '--no-hub', `--user-data-dir=${join(temp, 'user')}`], env});
 const page = await app.firstWindow();
 page.setDefaultTimeout(15000);
 const errors = [];
 page.on('pageerror', e => errors.push(e.message));
 const canvas = page.getByTestId('pixi-canvas');
 await expect(canvas).toHaveAttribute('data-ready', 'true', {timeout: 30000});
 const menu = label => app.evaluate(({Menu}, text) => Menu.getApplicationMenu().items.flatMap(m => m.submenu?.items ?? []).find(i => i.label === text).click(), label);
 const choose = path => app.evaluate(({dialog}, target) => { dialog.showOpenDialog = async () => ({canceled: false, filePaths: [target]}); dialog.showSaveDialog = async () => ({canceled: false, filePath: target}); dialog.showMessageBox = async () => ({response: 1, checkboxChecked: false}); }, path);
 await choose(file); await menu('Save');
 await expect.poll(() => readFile(file, 'utf8').then(() => true, () => false)).toBe(true);
 const project = JSON.parse(await readFile(file, 'utf8'));
 project.extensions['pixi.render'] = {version: 1, background: '#101820'};
 project.scenes[0].entities = [{id: 'story', name: 'Story', parentId: null, active: true, components: [
  {id: 'story-t', type: 'scene.transform2d', version: 1, data: {x: 480, y: 270, rotation: 0, scaleX: 1, scaleY: 1}},
  {id: 'story-x', type: 'pixi.text', version: 1, data: {alpha: 1, text: 'The lamp roars to life and its beam sweeps the waves while the boat turns toward the harbour', fontSize: 28, color: '#ffffff', font: '', fontWeight: 'normal', fontStyle: 'normal', align: 'center', letterSpacing: 0, strokeColor: '#000000', strokeWidth: 0, wordWrap: true, wrapWidth: 300, lineHeight: 36}},
 ]}];
 await writeFile(file, JSON.stringify(project));
 await choose(file); await menu('Open…');
 await expect.poll(async () => Object.keys(JSON.parse(await canvas.getAttribute('data-transforms') ?? '{}'))).toContain('story');
 const deselect = async () => { const b = await canvas.locator('canvas').boundingBox(), s = Math.min((b.width - 80) / 960, (b.height - 90) / 540); await page.mouse.click(b.x + (b.width - 960 * s) / 2 + 40 * s, b.y + (b.height - 540 * s) / 2 + 40 * s); };
 const stageShot = async () => { const b = await canvas.locator('canvas').boundingBox(), s = Math.min((b.width - 80) / 960, (b.height - 90) / 540), shot = await page.screenshot({clip: {x: b.x + (b.width - 960 * s) / 2 + 2, y: b.y + (b.height - 540 * s) / 2 + 2, width: 960 * s - 4, height: 540 * s - 4}}), ratio = (await sharp(shot).metadata()).width / (960 * s - 4); return {shot, scale: s * ratio}; };
 await deselect();
 let box = await inked(...Object.values(await stageShot()));
 expect(box.width).toBeLessThanOrEqual(305);
 expect(box.height).toBeGreaterThan(36 * 3);
 console.log(`PASS editor: wrapped to ${Math.round(box.width)} × ${Math.round(box.height)} px (several lines within 300 px)`);

 // Properties: wrap fields, turning wrapping off gives one line, Undo brings it back.
 await page.getByRole('button', {name: 'Layers', exact: true}).click(); await page.getByRole('button', {name: 'Select Story', exact: true}).click(); await page.keyboard.press('Escape');
 await page.getByRole('button', {name: 'Properties', exact: true}).click();
 const props = page.getByTestId('properties');
 if (!await props.getByRole('checkbox', {name: 'wordWrap', exact: true}).count()) await props.locator('summary').filter({hasText: /^Text$/}).click();
 const wrap = props.getByRole('checkbox', {name: 'wordWrap', exact: true});
 await expect(wrap).toBeChecked();
 await expect(props.getByRole('spinbutton', {name: 'wrapWidth', exact: true})).toHaveValue('300');
 await wrap.uncheck();
 await expect(props.getByRole('spinbutton', {name: 'wrapWidth', exact: true})).toHaveCount(0);
 await page.keyboard.press('Escape');
 await deselect();
 await expect.poll(async () => (await inked(...Object.values(await stageShot()))).height).toBeLessThan(40);
 box = await inked(...Object.values(await stageShot()));
 expect(box.width).toBeGreaterThan(600);
 await menu('Undo');
 await expect.poll(async () => (await inked(...Object.values(await stageShot()))).height).toBeGreaterThan(36 * 3);
 console.log('PASS Properties: Wrap lines and Wrap width; off gives one line, Undo wraps again');

 // Export: the same wrapping in the game.
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
 game = await (await browser.newContext({viewport: {width: 960, height: 540}})).newPage();
 const gameErrors = [];
 game.on('pageerror', e => gameErrors.push(e.message));
 await game.goto(`http://127.0.0.1:${server.address().port}`);
 await game.getByRole('button', {name: 'Start', exact: true}).click({timeout: 30000});
 await expect.poll(async () => JSON.parse(await game.locator('#game').getAttribute('data-poses') ?? '{}').story ?? null).not.toBeNull();
 const shotGame = async () => { const b = await game.locator('#game canvas').boundingBox(), s = Math.min(b.width / 960, b.height / 540), shot = await game.screenshot({clip: {x: b.x + (b.width - 960 * s) / 2, y: b.y + (b.height - 540 * s) / 2, width: 960 * s, height: 540 * s}}), ratio = (await sharp(shot).metadata()).width / (960 * s); return inked(shot, s * ratio); };
 await expect.poll(async () => (await shotGame()).height).toBeGreaterThan(36 * 3);
 expect((await shotGame()).width).toBeLessThanOrEqual(305);
 expect(gameErrors).toEqual([]);
 expect(errors).toEqual([]);
 console.log('PASS exported game: the same wrapped lines');
} catch (error) {
 await mkdir(join(root, 'outputs'), {recursive: true});
 const page = app ? await app.firstWindow().catch(() => null) : null;
 await page?.screenshot({path: join(root, 'outputs/text-failure.png')}).catch(() => {});
 await game?.screenshot({path: join(root, 'outputs/text-game-failure.png')}).catch(() => {});
 throw error;
} finally {
 await browser?.close().catch(() => {});
 if (server) await new Promise(r => server.close(r));
 if (app) { await app.evaluate(({BrowserWindow}) => { for (const w of BrowserWindow.getAllWindows()) w.destroy(); }).catch(() => {}); await app.close().catch(() => {}); }
 await rm(temp, {recursive: true, force: true, maxRetries: 3});
}
