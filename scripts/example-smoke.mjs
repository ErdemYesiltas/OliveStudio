// Portable example acceptance: the retained end-to-end example is copied with only its
// source sidecar into an unrelated folder, opened without any cache, played in Preview,
// exported to HTML and played again in a separate Chrome. Both traces must match.
import {_electron as electron, chromium, expect} from '@playwright/test';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {dirname, extname, join, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(join(root, 'apps/editor-desktop/package.json'));
const example = join(root, 'examples/end-to-end');
const name = 'Interactive demo.pixieditor';
const temp = await mkdtemp(join(tmpdir(), 'rewrite-example-'));
const env = {...process.env};
delete env.ELECTRON_RUN_AS_NODE;
const sha = data => createHash('sha256').update(data).digest('hex');
let app, page, browser, server, game;

try {
  // Only the project file and NAME.pixieditor.assets/sources travel; there is no cache to copy.
  expect((await readdir(join(example, `${name}.assets`))).filter(entry => entry !== '.DS_Store')).toEqual(['sources']);
  const moved = join(temp, 'Somewhere else', 'Moved example');
  const file = join(moved, name);
  await mkdir(moved, {recursive: true});
  await cp(join(example, name), file);
  await cp(join(example, `${name}.assets/sources`), `${file}.assets/sources`, {recursive: true});
  const sourceBefore = await readFile(file, 'utf8');

  app = await electron.launch({executablePath: process.env.REWRITE_EXECUTABLE || require('electron'), args: [...(process.env.REWRITE_EXECUTABLE ? [] : [join(root, 'apps/editor-desktop/out/main/index.js')]), '--no-hub', `--user-data-dir=${join(temp, 'user')}`], env});
  page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const canvas = page.getByTestId('pixi-canvas'), shell = page.getByTestId('editor-shell');
  await expect(canvas).toHaveAttribute('data-ready', 'true', {timeout: 30000});
  const data = async key => JSON.parse(await canvas.getAttribute(`data-${key}`));
  const menu = label => app.evaluate(({Menu}, text) => {
    const group = Menu.getApplicationMenu().items.find(m => m.submenu?.items.some(i => i.label === text));
    group.submenu.items.find(i => i.label === text).click();
  }, label);
  const choose = path => app.evaluate(({dialog}, target) => {
    dialog.showOpenDialog = async () => ({canceled: false, filePaths: [target]});
    dialog.showSaveDialog = async () => ({canceled: false, filePath: target});
    dialog.showMessageBox = async () => ({response: 1, checkboxChecked: false});
  }, path);

  const session = (await data('audio')).sessionId;
  await choose(file);
  await menu('Open…');
  await expect.poll(async () => (await data('audio')).sessionId, {timeout: 30000}).not.toBe(session);
  await expect(shell).toHaveAttribute('aria-busy', 'false');
  await expect.poll(async () => (await data('visuals')).every(v => v.ready), {timeout: 30000}).toBe(true);
  await expect(page.getByLabel('Unsaved changes', {exact: true})).toHaveCount(0);
  console.log('PASS source-only relocated open without cache');

  const clickScene = async (x, y) => {
    const b = await canvas.locator('canvas').boundingBox(), s = Math.min((b.width - 80) / 960, (b.height - 90) / 540);
    await page.mouse.click(b.x + (b.width - 960 * s) / 2 + x * s, b.y + (b.height - 540 * s) / 2 + y * s);
  };
  const poses = () => data('transforms');
  const preview = {};
  await page.getByRole('button', {name: 'Play', exact: true}).click();
  await expect(shell).toHaveAttribute('data-mode', 'playing');
  preview.startScene = (await data('interactions')).sceneId;
  await clickScene(180, 180);
  await expect.poll(async () => (await poses()).button.x).toBe(380);
  preview.buttonAfterClick = (await poses()).button.x;
  await expect.poll(async () => (await data('audio')).sources.voice?.starts ?? 0).toBeGreaterThan(0);
  preview.clickAudio = true;
  await expect.poll(async () => (await data('physics')).events.some(e => e.phase === 'enter')).toBe(true);
  preview.collision = true;
  await expect.poll(async () => (await data('spine')).events.length, {timeout: 15000}).toBeGreaterThan(0);
  preview.spineEvent = true;
  await clickScene(800, 440);
  await expect.poll(async () => (await data('interactions')).sceneId).toBe('second');
  preview.afterNext = 'second';
  preview.backX = (await poses()).back.x;
  await clickScene(480, 270);
  await expect.poll(async () => (await data('interactions')).sceneId).toBe('first');
  preview.afterBack = 'first';
  preview.buttonAfterReturn = (await poses()).button.x;
  await page.getByRole('button', {name: 'Stop', exact: true}).click();
  expect((await poses()).button.x).toBe(180);
  await expect(page.getByLabel('Unsaved changes', {exact: true})).toHaveCount(0);
  console.log('PASS Preview click/tween/audio/physics/Spine/scene round trip');

  const exportDir = join(temp, 'export');
  await mkdir(exportDir);
  await page.getByRole('button', {name: 'Export', exact: true}).click();
  await choose(exportDir);
  await page.getByRole('button', {name: 'Export HTML…', exact: true}).click();
  await expect(page.getByTestId('build-status')).toHaveAttribute('data-phase', 'complete', {timeout: 30000});
  const output = await page.getByTestId('build-output').innerText();
  const projectJson = await readFile(join(output, 'project.json'));
  const bundle = JSON.parse(projectJson);
  const assetFiles = {};
  for (const entries of Object.values(bundle.files)) for (const path of Object.values(entries)) assetFiles[path] = sha(await readFile(join(output, path)));
  const exportRecord = {projectJsonSha256: sha(projectJson), runtimes: bundle.runtimes, scenes: bundle.project.scenes.map(s => s.id), assetFiles};
  const expected = JSON.parse(await readFile(join(example, 'expected-export.json'), 'utf8'));
  expect(exportRecord).toEqual(expected);
  expect(await readFile(file, 'utf8')).toBe(sourceBefore);
  if (process.env.REWRITE_RETAIN_DEMO === '1') {
    await rm(join(root, 'outputs/example-html'), {recursive: true, force: true});
    await cp(output, join(root, 'outputs/example-html'), {recursive: true});
    console.log('DEMO outputs/example-html');
  }
  console.log('PASS HTML export matches the recorded example export');

  server = createServer(async (req, res) => {
    try {
      const path = resolve(output, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/$/, '/index.html'));
      if (!path.startsWith(resolve(output) + sep)) throw Error('outside');
      res.setHeader('Content-Type', {'.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.mp3': 'audio/mpeg', '.atlas': 'text/plain'}[extname(path)] ?? 'application/octet-stream');
      res.end(await readFile(path));
    } catch {
      res.statusCode = 404;
      res.end('Not found');
    }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  browser = await chromium.launch({channel: 'chrome', headless: true, args: ['--enable-unsafe-swiftshader']});
  game = await browser.newPage({viewport: {width: 1100, height: 800}});
  const browserErrors = [];
  game.on('console', m => m.type() === 'error' && browserErrors.push(m.text()));
  game.on('pageerror', e => browserErrors.push(e.message));
  await game.addInitScript(() => {
    window.__starts = 0;
    const create = AudioContext.prototype.createBufferSource;
    AudioContext.prototype.createBufferSource = function () {
      const source = create.call(this), start = source.start;
      source.start = function (...args) {
        if (source.buffer?.duration > 0.01) window.__starts++;
        return start.apply(this, args);
      };
      return source;
    };
  });
  await game.goto(`http://127.0.0.1:${server.address().port}`);
  await game.getByRole('button', {name: 'Start', exact: true}).click({timeout: 30000});
  const view = game.locator('#game');
  const gamePoses = async () => JSON.parse(await view.getAttribute('data-poses'));
  const gameClick = async (x, y) => {
    const b = await view.locator('canvas').boundingBox();
    await game.mouse.click(b.x + x * b.width / 960, b.y + y * b.height / 540);
  };
  const html = {};
  html.startScene = await view.getAttribute('data-scene-id');
  await gameClick(180, 180);
  await expect.poll(async () => (await gamePoses()).button.x).toBe(380);
  html.buttonAfterClick = (await gamePoses()).button.x;
  await expect.poll(() => game.evaluate(() => window.__starts)).toBeGreaterThan(0);
  html.clickAudio = true;
  await expect.poll(async () => (await gamePoses())['physics-flag'].active).toBe(true);
  html.collision = true;
  await expect.poll(async () => (await gamePoses())['spine-flag'].active, {timeout: 15000}).toBe(true);
  html.spineEvent = true;
  await gameClick(800, 440);
  await expect(view).toHaveAttribute('data-scene-id', 'second');
  html.afterNext = 'second';
  html.backX = (await gamePoses()).back.x;
  await gameClick(480, 270);
  await expect(view).toHaveAttribute('data-scene-id', 'first');
  html.afterBack = 'first';
  html.buttonAfterReturn = (await gamePoses()).button.x;
  expect(browserErrors).toEqual([]);
  expect(errors).toEqual([]);
  expect(html).toEqual(preview);
  await mkdir(join(root, 'outputs'), {recursive: true});
  await writeFile(join(root, 'outputs/example-parity.json'), JSON.stringify({example: relative(root, example), measured: {preview: 'editor diagnostics: tween pose, decoded clip starts, Matter enter events, Spine events, runtime scene id', html: 'player poses/active flags set by the collision and Spine rules, decoded clip starts, scene id'}, preview, html, export: exportRecord}, null, 2) + '\n');
  console.log('PASS Preview and separate Chrome HTML traces match');

  // Background policy: a hidden page pauses the session, so no clock time passes and the
  // Spine event (every 2 s) starts no audio; becoming visible resumes both.
  const setHidden = hidden => game.evaluate(value => {
    Object.defineProperty(document, 'visibilityState', {configurable: true, get: () => value ? 'hidden' : 'visible'});
    Object.defineProperty(document, 'hidden', {configurable: true, get: () => value});
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
  const clock = async () => Number(await view.getAttribute('data-runtime-time'));
  await setHidden(true);
  const hiddenAt = {time: await clock(), starts: await game.evaluate(() => window.__starts)};
  await game.waitForTimeout(2500);
  expect(await clock()).toBe(hiddenAt.time);
  expect(await game.evaluate(() => window.__starts)).toBe(hiddenAt.starts);
  await setHidden(false);
  await expect.poll(clock).toBeGreaterThan(hiddenAt.time);
  await expect.poll(() => game.evaluate(() => window.__starts), {timeout: 5000}).toBeGreaterThan(hiddenAt.starts);
  // The resumed clock continues from the paused time instead of catching up.
  expect(await clock() - hiddenAt.time).toBeLessThan(2.4);
  console.log('PASS hidden page pauses clock and audio, visible page resumes without catch-up');

  // Phone-sized touch viewport: the 16:9 scene must letterbox inside the viewport in both
  // orientations, keep device-density backing pixels and map taps through the scaled canvas.
  const phone = await browser.newContext({viewport: {width: 390, height: 844}, deviceScaleFactor: 3, isMobile: true, hasTouch: true});
  const mobile = await phone.newPage();
  const mobileErrors = [];
  mobile.on('pageerror', e => mobileErrors.push(e.message));
  mobile.on('console', m => m.type() === 'error' && mobileErrors.push(m.text()));
  await mobile.goto(`http://127.0.0.1:${server.address().port}`);
  await mobile.getByRole('button', {name: 'Start', exact: true}).tap({timeout: 30000});
  const stage = mobile.locator('#game');
  await expect(mobile.getByRole('button', {name: 'Start', exact: true})).toBeHidden();
  const fit = async () => {
    const viewport = mobile.viewportSize();
    const box = await stage.locator('canvas').boundingBox();
    const backing = await stage.locator('canvas').evaluate(c => [c.width, c.height]);
    expect(box.x).toBeGreaterThanOrEqual(-0.5);
    expect(box.y).toBeGreaterThanOrEqual(-0.5);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 0.5);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 0.5);
    expect(Math.abs(box.width / box.height - 16 / 9)).toBeLessThan(0.01);
    // Letterboxed on one axis, filling the other, centered.
    expect(Math.min(Math.abs(box.width - viewport.width), Math.abs(box.height - viewport.height))).toBeLessThan(1);
    expect(Math.abs(box.x * 2 + box.width - viewport.width)).toBeLessThan(1);
    expect(Math.abs(box.y * 2 + box.height - viewport.height)).toBeLessThan(1);
    expect(backing).toEqual([1920, 1080]);
    return box;
  };
  const tapScene = async (x, y) => {
    const box = await stage.locator('canvas').boundingBox();
    await mobile.touchscreen.tap(box.x + x * box.width / 960, box.y + y * box.height / 540);
  };
  const mobilePoses = async () => JSON.parse(await stage.getAttribute('data-poses'));
  const portrait = await fit();
  await tapScene(180, 180);
  await expect.poll(async () => (await mobilePoses()).button.x).toBe(380);
  await tapScene(800, 440);
  await expect(stage).toHaveAttribute('data-scene-id', 'second');
  await mobile.setViewportSize({width: 844, height: 390});
  const landscape = await fit();
  await tapScene(480, 270);
  await expect(stage).toHaveAttribute('data-scene-id', 'first');
  expect(mobileErrors).toEqual([]);
  await mobile.screenshot({path: join(root, 'outputs/html-game-landscape.png')});
  await phone.close();
  console.log(`PASS phone touch viewport letterboxes and maps taps: portrait ${Math.round(portrait.width)}x${Math.round(portrait.height)}, landscape ${Math.round(landscape.width)}x${Math.round(landscape.height)}`);
} catch (error) {
  await mkdir(join(root, 'outputs'), {recursive: true});
  if (game) await game.screenshot({path: join(root, 'outputs/example-html-failure.png')}).catch(() => {});
  if (page) await page.screenshot({path: join(root, 'outputs/example-failure.png')}).catch(() => {});
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
