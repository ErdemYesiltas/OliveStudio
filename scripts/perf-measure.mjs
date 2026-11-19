// Large-scene performance measurement: generated projects of visible Pixi shapes (default 6000 and
// 10000, the per-scene limit) opened in a fresh profile each. Records open time, frame rate and frame
// intervals while idle, while panning the camera and during Preview, plus GC-settled heap and process
// memory. Writes outputs/beta/perf.json. Frame rates are bounded by the display refresh rate.
// Usage: [REWRITE_EXECUTABLE=…] [PERF_COUNTS=6000,10000] node scripts/perf-measure.mjs
import {_electron as electron, expect} from '@playwright/test';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(join(root, 'apps/editor-desktop/package.json'));
const counts = (process.env.PERF_COUNTS ?? '6000,10000').split(',').map(Number);
const env = {...process.env};
delete env.ELECTRON_RUN_AS_NODE;
const colors = ['#d9976e', '#79a7d5', '#4c776b', '#ffd078', '#bada88', '#9bb6cf'];

function project(count) {
  const entities = Array.from({length: count}, (_, i) => {
    const column = i % 96, row = Math.floor(i / 96);
    return {
      id: `e${i}`, name: `Shape ${i}`, active: true,
      // Every tenth shape is nested under the previous one, so transforms compose through a parent.
      parentId: i % 10 === 9 ? `e${i - 1}` : null,
      components: [
        {id: `t${i}`, type: 'scene.transform2d', version: 1, data: i % 10 === 9 ? {x: 4, y: 4, rotation: 15, scaleX: 0.8, scaleY: 0.8} : {x: 5 + column * 10, y: 5 + (row % 54) * 10, rotation: (i * 7) % 360, scaleX: 1, scaleY: 1}},
        {id: `s${i}`, type: 'pixi.shape', version: 1, data: {width: 8, height: 6, color: colors[i % colors.length], rounded: 2, alpha: 0.9}},
      ],
    };
  });
  return {formatVersion: 1, name: `Perf ${count}`, entrySceneId: 'perf', scenes: [{formatVersion: 1, id: 'perf', name: `Perf ${count}`, entities}], modules: {}, providers: {render: 'pixi'}, extensions: {}};
}

async function measure(count) {
  const temp = await mkdtemp(join(tmpdir(), 'rewrite-perf-'));
  let app;
  try {
    const file = join(temp, `perf-${count}.pixieditor`);
    await writeFile(file, JSON.stringify(project(count)));
    app = await electron.launch({executablePath: process.env.REWRITE_EXECUTABLE || require('electron'), args: [...(process.env.REWRITE_EXECUTABLE ? [] : [join(root, 'apps/editor-desktop/out/main/index.js')]), '--no-hub', `--user-data-dir=${join(temp, 'user')}`], env});
    const page = await app.firstWindow();
    page.setDefaultTimeout(120000);
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const canvas = page.getByTestId('pixi-canvas'), shell = page.getByTestId('editor-shell');
    await expect(canvas).toHaveAttribute('data-ready', 'true');
    await app.evaluate(({BrowserWindow}) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1440, 900); w.center(); w.focus(); });
    const menu = label => app.evaluate(({Menu}, text) => Menu.getApplicationMenu().items.flatMap(m => m.submenu?.items ?? []).find(i => i.label === text).click(), label);
    await app.evaluate(({dialog}, target) => {
      dialog.showOpenDialog = async () => ({canceled: false, filePaths: [target]});
      dialog.showMessageBox = async () => ({response: 1, checkboxChecked: false});
    }, file);
    const frames = ms => page.evaluate(duration => new Promise(done => {
      const times = [], start = performance.now();
      const tick = now => {
        times.push(now);
        if (now - start < duration) return requestAnimationFrame(tick);
        const gaps = times.slice(1).map((t, i) => t - times[i]).sort((a, b) => a - b);
        done({fps: +(gaps.length / ((times.at(-1) - times[0]) / 1000)).toFixed(1), p50: +gaps[Math.floor(gaps.length / 2)].toFixed(1), p95: +gaps[Math.floor(gaps.length * 0.95)].toFixed(1), max: +gaps.at(-1).toFixed(1)});
      };
      requestAnimationFrame(tick);
    }), ms);

    const opened = Date.now();
    await menu('Open…');
    await expect(page.getByText(`Perf ${count}`, {exact: true}).first()).toBeVisible();
    await expect(shell).toHaveAttribute('aria-busy', 'false');
    await expect.poll(async () => Object.keys(JSON.parse(await canvas.getAttribute('data-transforms'))).length).toBe(count);
    const openMs = Date.now() - opened;
    if (await page.getByRole('button', {name: 'Dismiss message'}).isVisible()) await page.getByRole('button', {name: 'Dismiss message'}).click();
    await page.waitForTimeout(1000);

    const idle = await frames(3000);
    const box = await canvas.locator('canvas').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const panning = frames(3000);
    const end = Date.now() + 3000;
    let wheels = 0;
    while (Date.now() < end) {
      await page.mouse.wheel(wheels % 60 < 30 ? 30 : -30, wheels % 40 < 20 ? 20 : -20);
      wheels++;
    }
    const pan = await panning;
    const camera = await canvas.getAttribute('data-camera');

    await page.getByRole('button', {name: 'Play', exact: true}).click();
    await expect(shell).toHaveAttribute('data-mode', 'playing');
    await page.waitForTimeout(500);
    const cdp = await page.context().newCDPSession(page);
    let hot;
    if (process.env.PERF_PROFILE === '1') {
      // Self time per function during Preview, to locate per-frame cost.
      await cdp.send('Profiler.enable');
      await cdp.send('Profiler.start');
    }
    const preview = await frames(3000);
    if (process.env.PERF_PROFILE === '1') {
      const {profile} = await cdp.send('Profiler.stop');
      const self = new Map(), dt = new Map();
      profile.samples.forEach((id, i) => dt.set(id, (dt.get(id) ?? 0) + (profile.timeDeltas[i] ?? 0)));
      let total = 0;
      for (const node of profile.nodes) {
        const t = dt.get(node.id) ?? 0, f = node.callFrame;
        const key = `${f.functionName || '(anonymous)'} ${f.url.split('/').pop()}:${f.lineNumber + 1}`;
        self.set(key, (self.get(key) ?? 0) + t);
        total += t;
      }
      hot = [...self].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([fn, us]) => ({fn: fn.slice(0, 120), ms: Math.round(us / 1000), pct: +(us / total * 100).toFixed(1)}));
    }
    await page.getByRole('button', {name: 'Stop', exact: true}).click();

    await cdp.send('HeapProfiler.collectGarbage');
    const heapMB = +((await cdp.send('Runtime.getHeapUsage')).usedSize / 2 ** 20).toFixed(1);
    const metrics = await app.evaluate(({app: electronApp}) => electronApp.getAppMetrics().map(m => ({type: m.type, kb: m.memory.workingSetSize})));
    const workingSetMB = {};
    for (const m of metrics) workingSetMB[m.type] = +(((workingSetMB[m.type] ?? 0) * 1024 + m.kb) / 1024).toFixed(1);
    const result = {count, openMs, idle, pan: {...pan, wheelEvents: wheels}, preview, heapMB, workingSetMB, totalWorkingSetMB: +(metrics.reduce((s, m) => s + m.kb, 0) / 1024).toFixed(1), cameraAfterPan: JSON.parse(camera ?? 'null'), pageErrors: errors, ...(hot ? {previewProfile: hot} : {})};
    console.log(`${count}: open ${openMs} ms, idle ${idle.fps} fps, pan ${pan.fps} fps (p95 ${pan.p95} ms), preview ${preview.fps} fps (p95 ${preview.p95} ms), heap ${heapMB} MB`);
    return result;
  } finally {
    if (app) {
      await app.evaluate(({BrowserWindow}) => { for (const w of BrowserWindow.getAllWindows()) w.destroy(); }).catch(() => {});
      await app.close().catch(() => {});
    }
    await rm(temp, {recursive: true, force: true, maxRetries: 3});
  }
}

const results = [];
for (const count of counts) results.push(await measure(count));
const display = await (async () => {
  const app = await electron.launch({executablePath: process.env.REWRITE_EXECUTABLE || require('electron'), args: [...(process.env.REWRITE_EXECUTABLE ? [] : [join(root, 'apps/editor-desktop/out/main/index.js')]), '--no-hub', `--user-data-dir=${await mkdtemp(join(tmpdir(), 'rewrite-display-'))}`], env});
  const info = await app.evaluate(({screen}) => { const d = screen.getPrimaryDisplay(); return {refreshRate: d.displayFrequency, scaleFactor: d.scaleFactor, size: d.size}; });
  await app.close();
  return info;
})();
await mkdir(join(root, 'outputs/beta'), {recursive: true});
const executable = process.env.REWRITE_EXECUTABLE ? process.env.REWRITE_EXECUTABLE.replace(root + '/', '') : 'source build';
await writeFile(join(root, 'outputs/beta/perf.json'), JSON.stringify({measuredAt: new Date().toISOString(), executable, display, window: [1440, 900], results}, null, 2) + '\n');
const failures = results.flatMap(r => r.pageErrors.map(e => `${r.count}: ${e}`));
if (failures.length) throw Error(failures.join('\n'));
console.log('PASS perf measurement written to outputs/beta/perf.json');
