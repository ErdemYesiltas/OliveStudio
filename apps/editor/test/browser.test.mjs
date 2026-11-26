import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { build, createServer as createViteServer } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const texture = 'images/olive-crystal.png';
const sound = 'sounds/chime.wav';

async function browser() {
  return chromium.launch({
    channel: process.env.PLAYWRIGHT_CHROMIUM ? undefined : 'chrome',
    args: ['--enable-unsafe-swiftshader'],
  });
}

function fileInput(page, scene) {
  return page.locator('input[type=file]').setInputFiles({
    name: 'round-trip.json',
    mimeType: 'application/json',
    buffer: Buffer.from(typeof scene === 'string' ? scene : JSON.stringify(scene)),
  });
}

test('development editor, extensible runtime and AssetPack rebuild', { timeout: 60_000 }, async t => {
  const environment = process.env.NODE_ENV;
  t.after(() => {
    if (environment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = environment;
  });
  const server = await createViteServer({ root, server: { host: '127.0.0.1', port: 0 }, logLevel: 'silent' });
  t.after(() => server.close());
  await server.listen();
  const address = 'http://127.0.0.1:' + server.httpServer.address().port;
  const chrome = await browser();
  t.after(() => chrome.close());
  const page = await chrome.newPage({ acceptDownloads: true });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(address);
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.getByText('2 assets', { exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  const newScene = page.getByRole('button', { name: 'New Scene', exact: true });
  await expect(newScene).toHaveText('');
  await newScene.focus();
  await expect(page.locator('.tooltip')).toContainText('Start with an empty scene.');
  await page.keyboard.press('Escape');
  await expect(page.locator('.tooltip')).toHaveCount(0);
  await page.getByRole('button', { name: 'New Scene', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Camera 2D', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add Container' }).click();
  await page.getByRole('button', { name: 'Add Sprite' }).click();
  const inspector = page.getByRole('complementary', { name: 'Inspector' });
  await expect(inspector.getByLabel('Position X')).toHaveValue('32');
  await inspector.locator('summary[data-tip=Transform]').click();
  await expect(inspector.getByLabel('Position X')).toBeHidden();
  await inspector.locator('summary[data-tip=Transform]').click();
  await inspector.getByLabel('Position X').fill('175');
  await inspector.getByLabel('Position X').press('Enter');
  await page.getByRole('button', { name: 'Assign ' + texture }).click();
  await inspector.locator('summary[data-tip=Texture]').click();
  await expect(inspector.getByRole('button', { name: 'Texture', exact: true })).toHaveAttribute('value', texture);
  await page.getByRole('button', { name: 'Container', exact: true }).click();
  await page.getByRole('button', { name: 'Collapse Container' }).click();
  await expect(page.getByRole('button', { name: 'Sprite', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Add Text' }).click();
  await expect(page.getByRole('button', { name: 'Sprite', exact: true })).toBeVisible();
  await inspector.locator('summary[data-tip=Text]').click();
  await inspector.getByLabel('Content').fill('Test text');

  await page.getByRole('button', { name: 'Preview ' + sound }).click();
  await expect(page.getByText('Playing', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Stop ' + sound }).click();
  await expect(page.getByRole('button', { name: 'Preview ' + sound })).toBeVisible();

  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save Scene' }).click();
  const saved = JSON.parse(await readFile(await (await downloaded).path(), 'utf8'));
  assert.equal(saved.objects.length, 1);
  assert.equal(saved.objects[0].children[0].texture, texture);
  assert.equal(saved.objects[0].children[0].position.x, 175);
  assert.equal(saved.objects[0].children[1].text, 'Test text');

  await fileInput(page, saved);
  await expect(page.getByText('round-trip.json', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sprite', exact: true }).click();
  await expect(inspector.getByLabel('Position X')).toHaveValue('175');
  await fileInput(page, '{');
  await expect(page.getByRole('alert')).toContainText('Could not open scene');
  await expect(inspector.getByLabel('Position X')).toHaveValue('175');
  await fileInput(page, { ...saved, config: { audio: { volume: 2 } } });
  await expect(page.getByRole('alert')).toContainText('config.audio.volume');

  const missing = structuredClone(saved);
  missing.objects[0].children[0].texture = 'images/missing.png';
  await fileInput(page, missing);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('button', { name: 'Sprite', exact: true }).click();
  await expect(inspector.getByRole('status')).toContainText('images/missing.png');
  const downloadWithMissing = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save Scene' }).click();
  const preserved = JSON.parse(await readFile(await (await downloadWithMissing).path(), 'utf8'));
  assert.equal(preserved.objects[0].children[0].texture, 'images/missing.png');
  await page.getByRole('button', { name: 'Delete Selected Object' }).click();
  await expect(page.getByRole('button', { name: 'Sprite', exact: true })).toHaveCount(0);
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: 'New Scene', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Text', exact: true })).toBeVisible();

  const statusBefore = await (await page.request.get(address + '/assetpack/status')).json();
  const fixture = join(root, 'raw-assets', `test-rebuild-${process.pid}.png`);
  await writeFile(fixture, '', { flag: 'wx' });
  try {
    await page.getByRole('button', { name: 'Rebuild Asset Pack' }).click();
    await expect(page.getByRole('alert')).toContainText('Empty asset file');
    await expect(page.getByText('2 assets', { exact: true })).toBeVisible();
    const statusAfterFailure = await (await page.request.get(address + '/assetpack/status')).json();
    assert.equal(statusAfterFailure.generation, statusBefore.generation);
    await writeFile(fixture, await readFile(join(root, 'raw-assets/images{m}/olive-crystal.png')));
    await page.getByRole('button', { name: 'Rebuild Asset Pack' }).click();
    await expect(page.getByText('3 assets', { exact: true })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    const statusAfterSuccess = await (await page.request.get(address + '/assetpack/status')).json();
    assert.notEqual(statusAfterSuccess.generation, statusBefore.generation);
  } finally {
    await rm(fixture);
  }

  const independent = await page.evaluate(async () => {
    const { SceneView } = await import('/src/runtime.ts');
    const { emptyScene } = await import('/src/scene.ts');
    const { generation } = await (await fetch('/assetpack/status')).json();
    const sourceFor = () => `/assetpack/${generation}/sounds/chime.wav`;
    const firstStates = [];
    const secondStates = [];
    const firstPlaying = Promise.withResolvers();
    const secondPlaying = Promise.withResolvers();
    const secondEnded = Promise.withResolvers();
    const a = await SceneView.create(emptyScene(), { sourceFor, publishAudio: status => {
      firstStates.push(status.state);
      if (status.state === 'playing') firstPlaying.resolve();
    } }, () => {});
    const b = await SceneView.create(emptyScene(), { sourceFor, publishAudio: status => {
      secondStates.push(status.state);
      if (status.state === 'playing') secondPlaying.resolve();
      if (status.state === 'idle') secondEnded.resolve();
    } }, () => {});
    try {
      const different = a.app.audio !== b.app.audio;
      a.app.audio.play('chime');
      b.app.audio.play('chime');
      const deadline = AbortSignal.timeout(3_000);
      const timedOut = new Promise((_resolve, reject) => {
        deadline.addEventListener('abort', () => reject(new Error('Audio lifecycle timed out')), { once: true });
      });
      await Promise.race([Promise.all([firstPlaying.promise, secondPlaying.promise]), timedOut]);
      a.destroy();
      await Promise.race([secondEnded.promise, timedOut]);
      return { different, removed: !Object.hasOwn(a.app, 'audio'), firstStates, secondStates };
    } finally {
      if (Object.hasOwn(a.app, 'audio')) a.destroy();
      b.destroy();
    }
  });
  assert.deepEqual(independent, {
    different: true, removed: true, firstStates: ['loading', 'playing'], secondStates: ['loading', 'playing', 'idle'],
  });
  assert.deepEqual(errors, []);
});

test('production output loads image and audio from a nested URL', { timeout: 60_000 }, async t => {
  const output = await mkdtemp(join(tmpdir(), 'olive-prototype-browser-'));
  t.after(() => rm(output, { recursive: true, force: true }));
  await build({ root, logLevel: 'silent', build: { outDir: output, emptyOutDir: true } });

  const mime = {
    '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
    '.json': 'application/json', '.png': 'image/png', '.wav': 'audio/wav',
  };
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const prefix = '/tools/editor/';
    if (!path.startsWith(prefix)) {
      res.writeHead(404).end();
      return;
    }
    try {
      const file = join(output, path.slice(prefix.length) || 'index.html');
      const bytes = await readFile(file);
      res.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream' }).end(bytes);
    } catch {
      res.writeHead(404).end();
    }
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));

  const chrome = await browser();
  t.after(() => chrome.close());
  const page = await chrome.newPage();
  const base = `http://127.0.0.1:${server.address().port}/tools/editor/`;
  const manifest = page.waitForResponse(base + 'assetpack/manifest.json');
  const image = page.waitForResponse(base + 'assetpack/' + texture);
  await page.goto(base);
  assert.ok((await manifest).ok());
  assert.ok((await image).ok());
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Rebuild Asset Pack' })).toHaveCount(0);
  const audio = page.waitForResponse(base + 'assetpack/' + sound);
  await page.getByRole('button', { name: 'Preview ' + sound }).click();
  assert.ok((await audio).ok());
  await expect(page.getByText('Playing', { exact: true })).toBeVisible();
});
