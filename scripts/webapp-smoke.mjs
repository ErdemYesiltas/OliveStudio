// Background removal and the installable web app. Library: a generated-looking image with a plain green background
// becomes "<name> cutout" (transparent background, the subject and a background-coloured hole inside it kept) and the
// placed sprite switches to it in one undo step. Settings → Web app turns the HTML export into a PWA: manifest,
// icons, head tags and a service worker; in Chrome the worker registers and the game reloads and starts offline.
import {_electron as electron, chromium, expect} from '@playwright/test';
import {createServer} from 'node:http';
import {mkdir, mkdtemp, readFile, readdir, rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {dirname, extname, join, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(join(root, 'apps/editor-desktop/package.json'));
const sharp = createRequire(join(root, 'modules/html-export/package.json'))('sharp');
const temp = await mkdtemp(join(tmpdir(), 'rewrite-webapp-'));
const env = {...process.env};
delete env.ELECTRON_RUN_AS_NODE;
let app, browser, server, game;

try {
 // 96×96: green background, a red 48×48 subject with a green 8×8 hole in its middle.
 const red = await sharp({create: {width: 48, height: 48, channels: 4, background: '#e02020'}}).composite([{input: await sharp({create: {width: 8, height: 8, channels: 4, background: '#10c040'}}).png().toBuffer(), left: 20, top: 20}]).png().toBuffer();
 await sharp({create: {width: 96, height: 96, channels: 4, background: '#10c040'}}).composite([{input: red, left: 24, top: 24}]).png().toFile(join(temp, 'slime.png'));
 const file = join(temp, 'webapp.pixieditor');
 app = await electron.launch({executablePath: process.env.REWRITE_EXECUTABLE || require('electron'), args: [...(process.env.REWRITE_EXECUTABLE ? [] : [join(root, 'apps/editor-desktop/out/main/index.js')]), '--no-hub', `--user-data-dir=${join(temp, 'user')}`], env});
 const page = await app.firstWindow();
 page.setDefaultTimeout(15000);
 const errors = [];
 page.on('pageerror', e => errors.push(e.message));
 const canvas = page.getByTestId('pixi-canvas');
 await expect(canvas).toHaveAttribute('data-ready', 'true', {timeout: 30000});
 const menu = label => app.evaluate(({Menu}, text) => Menu.getApplicationMenu().items.flatMap(m => m.submenu?.items ?? []).find(i => i.label === text).click(), label);
 const choose = path => app.evaluate(({dialog}, target) => { dialog.showOpenDialog = async () => ({canceled: false, filePaths: [target]}); dialog.showSaveDialog = async () => ({canceled: false, filePath: target}); dialog.showMessageBox = async () => ({response: 1, checkboxChecked: false}); }, path);
 const save = async () => { await choose(file); await menu('Save'); await expect(page.getByLabel('Unsaved changes', {exact: true})).toHaveCount(0); return JSON.parse(await readFile(file, 'utf8')); };

 // Library: import, place, cut out.
 const lib = page.locator('.asset-library');
 if (!await lib.isVisible()) await page.keyboard.press('Alt+KeyB');
 await choose(join(temp, 'slime.png'));
 await lib.getByRole('button', {name: 'Add files…', exact: true}).click();
 await expect(lib.locator('[data-asset-name="slime"]')).toHaveCount(1, {timeout: 30000});
 await lib.getByRole('button', {name: 'Place slime', exact: true}).click();
 if (!await lib.isVisible()) await page.keyboard.press('Alt+KeyB');
 await lib.getByRole('button', {name: 'Preview slime', exact: true}).click();
 const cutout = lib.getByTestId('asset-cutout');
 await expect(cutout.getByRole('checkbox', {name: 'Use the cutout in the scenes', exact: true})).toBeChecked();
 await cutout.getByRole('button', {name: 'Make cutout', exact: true}).click();
 await expect(page.getByText('slime cutout added (1 sprite(s) switched)')).toBeVisible({timeout: 30000});
 let saved = await save();
 const registry = saved.extensions['assets.registry'].items, original = registry.find(a => a.name === 'slime'), cut = registry.find(a => a.name === 'slime cutout');
 expect(cut).toBeTruthy();
 const sprite = () => saved.scenes[0].entities.flatMap(e => e.components).find(c => c.type === 'pixi.sprite');
 expect(sprite().data.assetId).toBe(cut.id);
 await menu('Undo');
 saved = await save();
 expect(sprite().data.assetId).toBe(original.id);
 await menu('Redo');
 saved = await save();
 expect(sprite().data.assetId).toBe(cut.id);
 await page.keyboard.press('Escape');
 console.log('PASS Library: Remove background makes "slime cutout" and switches the placed sprite (one undo step)');

 // Settings → Web app.
 await page.getByRole('button', {name: 'Editor settings', exact: true}).click(); await page.getByRole('menuitem', {name: /^Settings…/}).click();
 const web = page.getByTestId('webapp-settings');
 await web.scrollIntoViewIfNeeded();
 await web.getByRole('checkbox', {name: 'Installable web app (PWA)', exact: true}).check();
 const shortName = web.getByRole('textbox', {name: 'Short name', exact: true});
 await shortName.fill('Slime'); await shortName.press('Enter');
 await page.keyboard.press('Escape');
 saved = await save();
 expect(saved.extensions['html.webapp']).toMatchObject({enabled: true, shortName: 'Slime', display: 'fullscreen'});
 console.log('PASS Settings: Web app turned on with a short name');

 // Export and play in Chrome over http://127.0.0.1.
 const exportDir = join(temp, 'export');
 await mkdir(exportDir);
 await page.getByRole('button', {name: 'Export', exact: true}).click();
 await choose(exportDir);
 await page.getByRole('button', {name: 'Export HTML…', exact: true}).click();
 await expect(page.getByTestId('build-status')).toHaveAttribute('data-phase', /complete|failed/, {timeout: 60000});
 expect(await page.getByTestId('build-status').innerText()).not.toMatch(/Error/);
 const output = await page.getByTestId('build-output').innerText();
 expect((await readdir(output)).sort()).toEqual(expect.arrayContaining(['icons', 'index.html', 'manifest.webmanifest', 'sw.js']));
 expect(JSON.parse(await readFile(join(output, 'manifest.webmanifest'), 'utf8'))).toMatchObject({short_name: 'Slime', display: 'fullscreen', start_url: './'});
 expect(await readFile(join(output, 'index.html'), 'utf8')).toContain('rel="manifest"');
 // The cut-out texture: the background is transparent, the subject and the hole inside it stay opaque.
 const cutFile = join(output, 'game-assets', cut.id, cut.revision, 'image.webp');
 const {data, info} = await sharp(cutFile).ensureAlpha().raw().toBuffer({resolveWithObject: true}), alpha = (x, y) => data[(y * info.width + x) * 4 + 3];
 expect([info.width, alpha(2, 2), alpha(30, 30), alpha(47, 47)]).toEqual([96, 0, 255, 255]);
 server = createServer(async (req, res) => {
  try {
   const path = resolve(output, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/$/, '/index.html'));
   if (!path.startsWith(resolve(output) + sep)) throw Error('outside');
   res.setHeader('Content-Type', {'.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.webp': 'image/webp', '.wasm': 'application/wasm', '.png': 'image/png', '.webmanifest': 'application/manifest+json'}[extname(path)] ?? 'application/octet-stream');
   res.end(await readFile(path));
  } catch { res.statusCode = 404; res.end(); }
 });
 await new Promise(r => server.listen(0, '127.0.0.1', r));
 browser = await chromium.launch({channel: 'chrome', headless: true, args: ['--enable-unsafe-swiftshader']});
 const context = await browser.newContext({viewport: {width: 960, height: 540}});
 game = await context.newPage();
 const gameErrors = [];
 game.on('pageerror', e => gameErrors.push(e.message));
 const url = `http://127.0.0.1:${server.address().port}/`;
 await game.goto(url);
 await expect(game.locator('#game')).toHaveAttribute('data-offline', 'registered', {timeout: 30000});
 await game.evaluate(() => navigator.serviceWorker.ready.then(() => true));
 await expect.poll(() => game.evaluate(async () => (await caches.keys()).length), {timeout: 30000}).toBe(1);
 const manifest = await game.evaluate(async () => (await (await fetch('./manifest.webmanifest')).json()).icons.length);
 expect(manifest).toBe(4);
 // Offline: the page, project and assets come from the cache.
 await context.setOffline(true);
 await game.reload();
 await game.getByRole('button', {name: 'Start', exact: true}).click({timeout: 30000});
 await expect.poll(async () => Object.keys(JSON.parse(await game.locator('#game').getAttribute('data-poses') ?? '{}')).length, {timeout: 30000}).toBeGreaterThan(0);
 expect(gameErrors).toEqual([]);
 expect(errors).toEqual([]);
 console.log('PASS exported web app: manifest, icons and service worker; Chrome caches the build and the game starts offline');
} catch (error) {
 await mkdir(join(root, 'outputs'), {recursive: true});
 const page = app ? await app.firstWindow().catch(() => null) : null;
 await page?.screenshot({path: join(root, 'outputs/webapp-failure.png')}).catch(() => {});
 await game?.screenshot({path: join(root, 'outputs/webapp-game-failure.png')}).catch(() => {});
 throw error;
} finally {
 await browser?.close().catch(() => {});
 if (server) await new Promise(r => server.close(r));
 if (app) { await app.evaluate(({BrowserWindow}) => { for (const w of BrowserWindow.getAllWindows()) w.destroy(); }).catch(() => {}); await app.close().catch(() => {}); }
 await rm(temp, {recursive: true, force: true, maxRetries: 3});
}
