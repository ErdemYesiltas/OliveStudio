// Long-session resource measurement on the end-to-end example: repeated Play → click/tween/audio →
// scene change → return → Stop cycles, periodic asset-cache rebuilds (worker restart), and
// GC-settled samples of heap, process memory/count and runtime resources. Writes outputs/beta/soak.json.
// Usage: [REWRITE_EXECUTABLE=…] [SOAK_CYCLES=60] node scripts/soak-measure.mjs
import {_electron as electron, expect} from '@playwright/test';
import {cp, mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(join(root, 'apps/editor-desktop/package.json'));
const cycles = Number(process.env.SOAK_CYCLES ?? 300);
// full: Play/click/scene/Stop + rebuild every 10; playstop: Play/Stop only; scenes: no rebuilds; rebuild: worker restarts only.
const mode = process.env.SOAK_MODE ?? 'full';
if (!['full', 'playstop', 'scenes', 'rebuild'].includes(mode)) throw Error('Unknown SOAK_MODE ' + mode);
const sampleEvery = Math.max(5, Math.round(cycles / 30)), rebuildEvery = 10, warmup = Math.max(sampleEvery, Math.round(cycles / 10));
const name = 'Interactive demo.pixieditor';
const temp = await mkdtemp(join(tmpdir(), 'rewrite-soak-'));
const env = {...process.env};
delete env.ELECTRON_RUN_AS_NODE;
let app;

try {
  const file = join(temp, 'project', name);
  await mkdir(dirname(file), {recursive: true});
  await cp(join(root, 'examples/end-to-end', name), file);
  await cp(join(root, 'examples/end-to-end', `${name}.assets/sources`), `${file}.assets/sources`, {recursive: true});

  app = await electron.launch({executablePath: process.env.REWRITE_EXECUTABLE || require('electron'), args: [...(process.env.REWRITE_EXECUTABLE ? [] : [join(root, 'apps/editor-desktop/out/main/index.js')]), '--no-hub', `--user-data-dir=${join(temp, 'user')}`], env});
  const page = await app.firstWindow();
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const canvas = page.getByTestId('pixi-canvas'), shell = page.getByTestId('editor-shell');
  await expect(canvas).toHaveAttribute('data-ready', 'true');
  const data = async key => JSON.parse(await canvas.getAttribute(`data-${key}`));
  const menu = label => app.evaluate(({Menu}, text) => Menu.getApplicationMenu().items.flatMap(m => m.submenu?.items ?? []).find(i => i.label === text).click(), label);
  await app.evaluate(({dialog}, target) => {
    dialog.showOpenDialog = async () => ({canceled: false, filePaths: [target]});
    dialog.showMessageBox = async () => ({response: 1, checkboxChecked: false});
  }, file);
  const session = (await data('audio')).sessionId;
  await menu('Open…');
  await expect.poll(async () => (await data('audio')).sessionId).not.toBe(session);
  await expect(shell).toHaveAttribute('aria-busy', 'false');
  await expect.poll(async () => (await data('visuals')).every(v => v.ready)).toBe(true);

  const cdp = await page.context().newCDPSession(page);
  // The test window lives on a shared desktop: a stray scroll over it pans the camera. Each cycle
  // starts from the default view (counted when it had moved), and clicks map scene coordinates
  // through the camera actually shown, using the viewport's own camera formula.
  let cameraResets = 0;
  const camera = async () => JSON.parse(await canvas.getAttribute('data-camera') ?? '{}');
  const resetCamera = async () => {
    const view = await camera();
    if (view.zoom === 1 && !view.pan?.x && !view.pan?.y) return;
    cameraResets++;
    await page.getByRole('button', {name: 'Reset view (Shift+F)', exact: true}).click();
    await expect.poll(camera).toEqual({zoom: 1, pan: {x: 0, y: 0}});
  };
  const clickScene = async (x, y) => {
    const view = await camera(), b = await canvas.locator('canvas').boundingBox();
    const s = Math.max(0.01, Math.max(0.01, Math.min((b.width - 80) / 960, (b.height - 90) / 540)) * view.zoom);
    const px = (b.width - 960 * s) / 2 + view.pan.x + x * s, py = (b.height - 540 * s) / 2 + view.pan.y + y * s;
    if (px < 0 || py < 0 || px > b.width || py > b.height) throw Error(`Scene point ${x},${y} is outside the viewport after an external camera change: ${JSON.stringify(view)}`);
    await page.mouse.click(b.x + px, b.y + py);
  };
  const sample = async cycle => {
    await cdp.send('HeapProfiler.collectGarbage');
    await page.waitForTimeout(300);
    await cdp.send('HeapProfiler.collectGarbage');
    // performance.memory is bucketed by Chromium; the CDP heap usage is exact.
    const {usedSize} = await cdp.send('Runtime.getHeapUsage');
    const heap = {used: usedSize, nodes: await page.evaluate(() => document.getElementsByTagName('*').length)};
    const metrics = await app.evaluate(({app: electronApp}) => electronApp.getAppMetrics().map(m => ({type: m.type, pid: m.pid, serviceName: m.serviceName ?? null, kb: m.memory.workingSetSize})));
    const byType = {};
    for (const m of metrics) byType[m.type] = (byType[m.type] ?? 0) + m.kb;
    const spine = await data('spine').catch(() => null);
    return {
      cycle,
      heapMB: +(heap.used / 2 ** 20).toFixed(3),
      domNodes: heap.nodes,
      processes: metrics.length,
      utilityProcesses: metrics.filter(m => m.type === 'Utility').map(m => m.serviceName),
      workingSetMB: Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, +(v / 1024).toFixed(1)])),
      totalWorkingSetMB: +(metrics.reduce((sum, m) => sum + m.kb, 0) / 1024).toFixed(1),
      loadedTextures: Number(await canvas.getAttribute('data-loaded-textures')),
      audioSources: Object.keys((await data('audio')).sources ?? {}).length,
      spineResources: spine?.resources ?? null,
    };
  };
  const library = async () => {
    if (!await page.getByRole('button', {name: 'Import image…', exact: true}).isVisible()) await page.getByRole('button', {name: 'Library', exact: true}).click();
  };
  const rebuild = async () => {
    await library();
    const before = (await page.evaluate(() => window.platform.assets.info())).workerProcessId;
    await page.getByRole('button', {name: 'Rebuild asset cache'}).click();
    await expect.poll(async () => (await page.evaluate(() => window.platform.assets.info())).workerProcessId).not.toBe(before);
    await expect(page.getByRole('button', {name: 'Rebuild asset cache'})).toBeEnabled();
    await page.keyboard.press('Escape');
    await expect.poll(async () => (await data('visuals')).every(v => v.ready)).toBe(true);
  };

  const samples = [await sample(0)];
  const started = Date.now();
  let rebuilds = 0;
  let current = 0;
  try {
  for (let cycle = 1; cycle <= cycles; cycle++) {
    current = cycle;
    await resetCamera();
    if (mode !== 'rebuild') {
      await page.getByRole('button', {name: 'Play', exact: true}).click();
      await expect(shell).toHaveAttribute('data-mode', 'playing');
      if (mode === 'playstop') await page.waitForTimeout(300);
      else {
        await clickScene(180, 180);
        await expect.poll(async () => (await data('transforms')).button?.x).toBe(380);
        await expect.poll(async () => (await data('audio')).sources.voice?.starts ?? 0).toBeGreaterThan(0);
        await clickScene(800, 440);
        await expect.poll(async () => (await data('interactions')).sceneId).toBe('second');
        await clickScene(480, 270);
        await expect.poll(async () => (await data('interactions')).sceneId).toBe('first');
      }
      await page.getByRole('button', {name: 'Stop', exact: true}).click();
      await expect.poll(async () => (await data('transforms')).button.x).toBe(180);
      await expect(page.getByLabel('Unsaved changes', {exact: true})).toHaveCount(0);
    }
    if (mode === 'rebuild' || (mode === 'full' && cycle % rebuildEvery === 0)) {
      await rebuild();
      rebuilds++;
    }
    if (cycle % sampleEvery === 0) {
      samples.push(await sample(cycle));
      const last = samples.at(-1);
      console.log(`cycle ${cycle}: heap ${last.heapMB} MB, total ${last.totalWorkingSetMB} MB, ${last.processes} processes, textures ${last.loadedTextures}`);
    }
  }

  } catch (error) {
    // Keep what was learned: the failing cycle, the screen and the runtime diagnostics.
    await mkdir(join(root, 'outputs/beta'), {recursive: true});
    await page.screenshot({path: join(root, 'outputs/beta/soak-failure.png')}).catch(() => {});
    const failure = {cycle: current, minutes: +((Date.now() - started) / 60000).toFixed(1), error: String(error).slice(0, 500), interactions: await canvas.getAttribute('data-interactions').catch(() => null), camera: await canvas.getAttribute('data-camera').catch(() => null), cameraResets, mode: await shell.getAttribute('data-mode').catch(() => null), text: (await page.locator('body').innerText().catch(() => '')).slice(-1500), pageErrors: errors, samples};
    await writeFile(join(root, 'outputs/beta/soak-failure.json'), JSON.stringify(failure, null, 2) + '\n');
    throw error;
  }
  // Least-squares slope from a starting cycle, per 10 cycles.
  const slope = (key, from = warmup) => {
    const points = samples.filter(s => s.cycle >= from).map(s => [s.cycle, typeof key === 'function' ? key(s) : s[key]]);
    const mx = points.reduce((a, [x]) => a + x, 0) / points.length, my = points.reduce((a, [, y]) => a + y, 0) / points.length;
    const b = points.reduce((a, [x, y]) => a + (x - mx) * (y - my), 0) / points.reduce((a, [x]) => a + (x - mx) ** 2, 0);
    return +(b * 10).toFixed(3);
  };
  const base = samples.find(s => s.cycle >= warmup), last = samples.at(-1);
  const third = (from, to) => Math.max(...samples.filter(s => s.cycle > cycles * from && s.cycle <= cycles * to).map(s => s.heapMB));
  const summary = {
    mode, cycles, rebuilds, cameraResets, minutes: +((Date.now() - started) / 60000).toFixed(1),
    heapMB: {afterWarmup: base.heapMB, end: last.heapMB, slopePer10Cycles: slope('heapMB'), secondHalfSlopePer10Cycles: slope('heapMB', cycles / 2), peakMiddleThird: third(1 / 3, 2 / 3), peakLastThird: third(2 / 3, 1)},
    totalWorkingSetMB: {afterWarmup: base.totalWorkingSetMB, end: last.totalWorkingSetMB, slopePer10Cycles: slope('totalWorkingSetMB')},
    rendererMB: {afterWarmup: base.workingSetMB.Tab, end: last.workingSetMB.Tab, slopePer10Cycles: slope(s => s.workingSetMB.Tab ?? 0)},
    gpuMB: {afterWarmup: base.workingSetMB.GPU, end: last.workingSetMB.GPU},
    processes: {min: Math.min(...samples.map(s => s.processes)), max: Math.max(...samples.map(s => s.processes))},
    domNodes: {min: Math.min(...samples.map(s => s.domNodes)), max: Math.max(...samples.map(s => s.domNodes))},
    loadedTextures: [...new Set(samples.map(s => s.loadedTextures))],
    audioSources: [...new Set(samples.map(s => s.audioSources))],
    pageErrors: errors,
  };
  // Acceptance: the GC-settled JS heap reaches a plateau and nothing lingers. Process working sets
  // are reported, not gated: native allocator growth needs a longer run to separate from a leak.
  const checks = {
    heapPlateau: summary.heapMB.peakLastThird - summary.heapMB.peakMiddleThird < 2,
    heapSecondHalfSlopeBelowHalfMBPer10: summary.heapMB.secondHalfSlopePer10Cycles < 0.5,
    processCountStable: summary.processes.max - summary.processes.min <= 1,
    domStable: summary.domNodes.max - summary.domNodes.min < 50,
    texturesStable: summary.loadedTextures.length === 1,
    audioSourcesStable: summary.audioSources.length === 1,
    noPageErrors: errors.length === 0,
  };
  await mkdir(join(root, 'outputs/beta'), {recursive: true});
  const executable = process.env.REWRITE_EXECUTABLE ? process.env.REWRITE_EXECUTABLE.replace(root + '/', '') : 'source build';
  await writeFile(join(root, `outputs/beta/soak${mode === 'full' ? '' : '-' + mode}.json`), JSON.stringify({measuredAt: new Date().toISOString(), executable, summary, checks, samples}, null, 2) + '\n');
  console.log(JSON.stringify({summary, checks}, null, 2));
  const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([k]) => k);
  if (failed.length) throw Error('Soak checks failed: ' + failed.join(', '));
  console.log(`PASS soak: ${cycles} Play/scene/Stop cycles, ${rebuilds} worker rebuilds, heap ${base.heapMB}→${last.heapMB} MB`);
} finally {
  if (app) {
    await app.evaluate(({BrowserWindow}) => { for (const w of BrowserWindow.getAllWindows()) w.destroy(); }).catch(() => {});
    await app.close().catch(() => {});
  }
  await rm(temp, {recursive: true, force: true, maxRetries: 3});
}
