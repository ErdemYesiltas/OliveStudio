// Export and Hub: the finished HTML build shows its size by group and the largest files; Make ZIP writes a valid
// archive with index.html at the root; Hub projects can be pinned to the top and stay there when others are opened.
import {_electron as electron, expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {mkdir, mkdtemp, rm, stat, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(join(root, 'apps/editor-desktop/package.json'));
const temp = await mkdtemp(join(tmpdir(), 'rewrite-ship-'));
const env = {...process.env};
delete env.ELECTRON_RUN_AS_NODE;
const project = name => ({formatVersion: 1, name, entrySceneId: 's', modules: {}, providers: {render: 'pixi'}, extensions: {}, scenes: [{formatVersion: 1, id: 's', name: 'Main', entities: [
 {id: 'box', name: 'Box', parentId: null, active: true, components: [{id: 'box-t', type: 'scene.transform2d', version: 1, data: {x: 480, y: 270, rotation: 0, scaleX: 1, scaleY: 1}}, {id: 'box-s', type: 'pixi.shape', version: 1, data: {width: 100, height: 60, color: '#3f7be0', rounded: 0, alpha: 1}}]},
]}]});
let app;
try {
 const alpha = join(temp, 'Alpha.pixieditor'), beta = join(temp, 'Beta.pixieditor'), gamma = join(temp, 'Gamma.pixieditor');
 for (const [file, name] of [[alpha, 'Alpha'], [beta, 'Beta'], [gamma, 'Gamma']]) await writeFile(file, JSON.stringify(project(name)));
 app = await electron.launch({executablePath: process.env.REWRITE_EXECUTABLE || require('electron'), args: [...(process.env.REWRITE_EXECUTABLE ? [] : [join(root, 'apps/editor-desktop/out/main/index.js')]), '--no-hub', `--user-data-dir=${join(temp, 'user')}`], env});
 const page = await app.firstWindow();
 page.setDefaultTimeout(15000);
 const errors = [];
 page.on('pageerror', e => errors.push(e.message));
 const canvas = page.getByTestId('pixi-canvas');
 await expect(canvas).toHaveAttribute('data-ready', 'true', {timeout: 30000});
 const menu = label => app.evaluate(({Menu}, text) => Menu.getApplicationMenu().items.flatMap(m => m.submenu?.items ?? []).find(i => i.label === text).click(), label);
 const choose = path => app.evaluate(({dialog}, target) => { dialog.showOpenDialog = async () => ({canceled: false, filePaths: [target]}); dialog.showSaveDialog = async () => ({canceled: false, filePath: target}); dialog.showMessageBox = async () => ({response: 1, checkboxChecked: false}); }, path);
 // Opened = the Hub list has it at the top (the main process records every open).
 const open = async file => { await choose(file); await menu('Open…'); await expect.poll(() => page.evaluate(() => window.platform.hub.list().then(l => l.find(p => !p.pinned)?.path ?? l[0]?.path))).toBe(file); };

 // Export: size report and ZIP.
 await open(alpha);
 const out = join(temp, 'export'); await mkdir(out);
 await page.getByRole('button', {name: 'Export', exact: true}).click();
 await choose(out);
 await page.getByRole('button', {name: 'Export HTML…', exact: true}).click();
 await expect(page.getByTestId('build-status')).toHaveAttribute('data-phase', 'complete', {timeout: 60000});
 const report = page.getByTestId('build-report');
 await expect(report).toBeVisible();
 expect(Number(await report.getAttribute('data-total'))).toBeGreaterThan(100000);
 const groups = await report.locator('[data-group]').evaluateAll(rows => rows.map(r => [r.getAttribute('data-group'), Number(r.getAttribute('data-bytes'))]));
 expect(groups.map(g => g[0])).toEqual(expect.arrayContaining(['Engine and runtimes', 'Project data', 'Page']));
 expect(groups.find(g => g[0] === 'Engine and runtimes')[1]).toBeGreaterThan(groups.find(g => g[0] === 'Project data')[1]);
 await page.getByRole('button', {name: 'Make ZIP (itch.io, web hosts)', exact: true}).click();
 const zip = page.getByTestId('build-zip');
 await expect(zip).toHaveText(/\.zip$/, {timeout: 30000});
 const zipPath = await zip.innerText(), output = await page.getByTestId('build-output').innerText();
 expect(zipPath).toBe(output + '.zip');
 expect((await stat(zipPath)).size).toBeGreaterThan(50000);
 execFileSync('unzip', ['-tq', zipPath]);
 const listing = execFileSync('unzip', ['-Z1', zipPath], {encoding: 'utf8'}).split('\n');
 expect(listing).toEqual(expect.arrayContaining(['index.html', 'project.json']));
 await page.keyboard.press('Escape');
 console.log('PASS Export: size report by group, Make ZIP writes a valid archive with index.html at the root');

 // Hub: open Beta then Gamma (newest first), pin Alpha; it stays first when Beta is opened again; unpin.
 await open(beta); await open(gamma);
 const hub = page.getByTestId('hub'), rows = () => hub.getByTestId('hub-projects').locator('[role=listitem] strong').allInnerTexts().then(list => list.map(s => s.trim()));
 const openHub = async () => { await menu('Hub…'); await expect(hub).toBeVisible(); };
 await openHub();
 await expect.poll(rows).toEqual(['Gamma', 'Beta', 'Alpha']);
 await hub.getByRole('button', {name: 'Pin Alpha', exact: true}).click();
 await expect.poll(rows).toEqual(['Alpha', 'Gamma', 'Beta']);
 await expect(hub.getByRole('button', {name: 'Unpin Alpha', exact: true})).toHaveAttribute('aria-pressed', 'true');
 await page.keyboard.press('Escape');
 await open(beta);
 await openHub();
 await expect.poll(rows).toEqual(['Alpha', 'Beta', 'Gamma']);
 await hub.getByRole('button', {name: 'Unpin Alpha', exact: true}).click();
 await expect.poll(rows).toEqual(['Beta', 'Gamma', 'Alpha']);
 expect(errors).toEqual([]);
 await mkdir(join(root, 'outputs'), {recursive: true});
 await page.screenshot({path: join(root, 'outputs/editor-ship.png')});
 console.log('PASS Hub: pinned projects stay on top of the recent list; unpin returns them to their place');
} catch (error) {
 await mkdir(join(root, 'outputs'), {recursive: true});
 const page = app ? await app.firstWindow().catch(() => null) : null;
 await page?.screenshot({path: join(root, 'outputs/ship-failure.png')}).catch(() => {});
 throw error;
} finally {
 if (app) { await app.evaluate(({BrowserWindow}) => { for (const w of BrowserWindow.getAllWindows()) w.destroy(); }).catch(() => {}); await app.close().catch(() => {}); }
 await rm(temp, {recursive: true, force: true, maxRetries: 3});
}
