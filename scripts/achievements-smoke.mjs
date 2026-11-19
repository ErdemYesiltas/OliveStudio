// Achievements and leaderboards: defined in the panel; a script unlocks one and submits scores, another unlocks by
// itself from a global; toasts show in Preview and the exported game, which keeps progress in browser storage.
import {_electron as electron, chromium, expect} from '@playwright/test';
import {createServer} from 'node:http';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {dirname, extname, join, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(join(root, 'apps/editor-desktop/package.json'));
const {transform} = createRequire(join(root, 'modules/scripts/package.json'))('sucrase');
const compile = source => transform(source, {transforms: ['typescript', 'imports'], production: true, disableESTransforms: true}).code;
const temp = await mkdtemp(join(tmpdir(), 'rewrite-achievements-'));
const env = {...process.env};
delete env.ELECTRON_RUN_AS_NODE;
let app, browser, server, game;
const buttonScript = `export function onClick(self: GameObject) {
  globals.coins = globals.coins + 1;
  if (globals.coins === 1) game.achievements.unlock('Clicker');
  game.leaderboard.submit('Best', globals.coins, 'Tester');
  globals.rank = game.leaderboard.top('Best').length;
}`;
try {
 const file = join(temp, 'achievements.pixieditor');
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
 const project = JSON.parse(await readFile(file, 'utf8')), sceneId = project.entrySceneId;
 const t = (id, x, y) => ({id: `${id}-t`, type: 'scene.transform2d', version: 1, data: {x, y, rotation: 0, scaleX: 1, scaleY: 1}});
 project.scenes[0].entities = [{id: 'button', name: 'Button', parentId: null, active: true, components: [t('button', 200, 200), {id: 'button-s', type: 'pixi.shape', version: 1, data: {alpha: 1, kind: 'rect', width: 100, height: 100, color: '#5bc0eb', rounded: 0, sides: 5, innerRadius: .5, strokeColor: '#ffffff', strokeWidth: 0}}, {id: 'button-b', type: 'scripts.behaviour', version: 1, data: {scriptId: 's-button', params: {}, refs: {}}}]}];
 project.extensions['interactions.globals'] = {version: 1, items: [{id: 'g-coins', name: 'coins', type: 'number', initial: 0}, {id: 'g-rank', name: 'rank', type: 'number', initial: 0}]};
 project.extensions['achievements'] = {version: 1, items: [{id: 'a-click', name: 'Clicker', description: 'Click once', hidden: false}, {id: 'a-rich', name: 'Rich', description: 'Three coins', hidden: false, condition: {globalId: 'g-coins', op: '>=', value: 3}}], boards: [{id: 'b-best', name: 'Best', order: 'high', globalId: 'g-coins'}]};
 project.extensions['scripts.library'] = {version: 1, items: [{id: 's-button', name: 'Button', source: buttonScript, code: compile(buttonScript)}]};
 await writeFile(file, JSON.stringify(project));
 await choose(file); await menu('Open…');
 await expect.poll(async () => Object.keys(JSON.parse(await canvas.getAttribute('data-transforms') ?? '{}'))).toContain('button');

 await page.keyboard.press('Alt+KeyX');
 const panel = page.getByTestId('achievements-panel');
 await expect(panel.locator('[data-achievement]')).toHaveCount(2);
 await expect(panel.locator('[data-board="Best"]')).toBeVisible();
 await expect(panel.getByRole('combobox', {name: 'Unlocks 2'})).toHaveValue('g-coins');
 await page.keyboard.press('Escape');
 console.log('PASS the Achievements panel lists achievements (one unlocking by itself) and the leaderboard');

 const view = async () => { const b = await canvas.locator('canvas').boundingBox(), s = Math.min((b.width - 80) / 960, (b.height - 90) / 540); return {at: (x, y) => ({x: b.x + (b.width - 960 * s) / 2 + x * s, y: b.y + (b.height - 540 * s) / 2 + y * s})}; };
 await page.getByRole('button', {name: 'Play', exact: true}).click();
 const p = (await view()).at(200, 200);
 await page.mouse.click(p.x, p.y);
 await expect(canvas.locator('[data-achievement-toast="Clicker"]')).toBeVisible();
 await page.mouse.click(p.x, p.y); await page.mouse.click(p.x, p.y);
 await expect(canvas.locator('[data-achievement-toast="Rich"]')).toBeVisible();
 await page.keyboard.press('F3');
 await expect(canvas.locator('[data-debug-overlay]')).toContainText('rank = 3');
 await page.keyboard.press('F3');
 await page.getByRole('button', {name: 'Stop', exact: true}).click();
 await page.getByRole('button', {name: 'Play', exact: true}).click();
 await page.mouse.click(p.x, p.y);
 await page.waitForTimeout(500);
 await expect(canvas.locator('[data-achievement-toast="Clicker"]')).toHaveCount(0);
 await page.getByRole('button', {name: 'Stop', exact: true}).click();
 console.log('PASS Preview: a script unlocks Clicker, Rich unlocks by itself, scores are kept, unlocks are remembered across Play');

 const exportDir = join(temp, 'export');
 await mkdir(exportDir);
 await page.getByRole('button', {name: 'Export', exact: true}).click();
 await choose(exportDir);
 await page.getByRole('button', {name: 'Export HTML…', exact: true}).click();
 await expect(page.getByTestId('build-status')).toHaveAttribute('data-phase', /complete|failed/, {timeout: 30000});
 expect(await page.getByTestId('build-status').innerText()).not.toMatch(/Error/);
 const output = await page.getByTestId('build-output').innerText();
 const bundle = JSON.parse(await readFile(join(output, 'project.json'), 'utf8'));
 expect(bundle.runtimes).toEqual(expect.arrayContaining(['achievements', 'scripts']));
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
 game = await browser.newPage({viewport: {width: 960, height: 540}});
 const gameErrors = [];
 game.on('pageerror', e => gameErrors.push(e.message));
 game.on('console', m => { if (m.type() === 'error') gameErrors.push(m.text().slice(0, 300)); });
 await game.goto(`http://127.0.0.1:${server.address().port}`);
 await game.getByRole('button', {name: 'Start', exact: true}).click({timeout: 30000});
 const stage = game.locator('#game');
 await expect(stage).toHaveAttribute('data-scene-id', sceneId);
 const at = async (x, y) => { const b = await stage.locator('canvas').boundingBox(), s = Math.min(b.width / 960, b.height / 540); return {x: b.x + (b.width - 960 * s) / 2 + x * s, y: b.y + (b.height - 540 * s) / 2 + y * s}; };
 const q = await at(200, 200);
 for (let i = 0; i < 3; i++) await game.mouse.click(q.x, q.y);
 await expect(stage.locator('[data-achievement-toast="Clicker"]')).toBeVisible();
 await expect(stage.locator('[data-achievement-toast="Rich"]')).toBeVisible();
 const saved = await game.evaluate(name => JSON.parse(localStorage.getItem(`olive:achievements:${name}`) ?? 'null'), bundle.project.name);
 expect(Object.keys(saved.unlocked).sort()).toEqual(['a-click', 'a-rich']);
 expect(saved.boards['b-best'].map(s => s.score)).toEqual([3, 2, 1]);
 expect(gameErrors).toEqual([]);
 expect(errors).toEqual([]);
 console.log('PASS exported game: the achievements chunk shows the same toasts and keeps progress in browser storage');
} catch (error) {
 await mkdir(join(root, 'outputs'), {recursive: true});
 const page = app ? await app.firstWindow().catch(() => null) : null;
 await page?.screenshot({path: join(root, 'outputs/achievements-failure.png')}).catch(() => {});
 await game?.screenshot({path: join(root, 'outputs/achievements-game-failure.png')}).catch(() => {});
 throw error;
} finally {
 await browser?.close().catch(() => {});
 if (server) await new Promise(r => server.close(r));
 if (app) { await app.evaluate(({BrowserWindow}) => { for (const w of BrowserWindow.getAllWindows()) w.destroy(); }).catch(() => {}); await app.close().catch(() => {}); }
 await rm(temp, {recursive: true, force: true, maxRetries: 3});
}
