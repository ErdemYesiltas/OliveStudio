// Script debugger in the real editor: F9 sets a breakpoint (red glyph, listed), Play pauses at the end of the frame
// where the line ran with that line's locals and watches, the paused line is highlighted, Objects shows live state,
// Continue and Step frame run one more frame (and stop again), removing the breakpoint lets the game run on.
import {_electron as electron, expect} from '@playwright/test';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(join(root, 'apps/editor-desktop/package.json'));
const {transform} = createRequire(join(root, 'modules/scripts/package.json'))('sucrase');
const temp = await mkdtemp(join(tmpdir(), 'rewrite-debugger-'));
const env = {...process.env};
delete env.ELECTRON_RUN_AS_NODE;
let app;
const source = `export function update(self: GameObject, dt: number) {
  const speed = 120;
  self.state.frames = (self.state.frames ?? 0) + 1;
  self.x += speed * dt;
}`;
const compile = s => transform(s, {transforms: ['typescript', 'imports'], production: true, disableESTransforms: true}).code;

try {
 const file = join(temp, 'debug.pixieditor');
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
 project.scenes[0].entities = [{id: 'box', name: 'Box', parentId: null, active: true, components: [
  {id: 'box-t', type: 'scene.transform2d', version: 1, data: {x: 100, y: 270, rotation: 0, scaleX: 1, scaleY: 1}},
  {id: 'box-s', type: 'pixi.shape', version: 1, data: {alpha: 1, kind: 'rect', width: 40, height: 40, color: '#ffd166', rounded: 0, sides: 5, innerRadius: .5, strokeColor: '#ffffff', strokeWidth: 0}},
  {id: 'box-b', type: 'scripts.behaviour', version: 1, data: {scriptId: 's-move', params: {}, refs: {}}},
 ]}];
 project.extensions['scripts.library'] = {version: 1, items: [{id: 's-move', name: 'Mover', source, code: compile(source)}]};
 await writeFile(file, JSON.stringify(project));
 await choose(file); await menu('Open…');
 await expect.poll(async () => Object.keys(JSON.parse(await canvas.getAttribute('data-transforms') ?? '{}'))).toContain('box');
 const shell = page.getByTestId('editor-shell');
 const panel = async () => { if (!await page.getByTestId('script-debugger').isVisible()) await page.keyboard.press('Alt+KeyC'); await expect(page.getByTestId('script-debugger')).toBeVisible(); return page.getByTestId('script-debugger'); };

 // F9 on line 4 sets a breakpoint; add two watches.
 let debug = await panel();
 await expect(debug.getByTestId('debug-status')).toHaveText(/Not running/);
 await page.getByTestId('script-editor').locator('.view-line').filter({hasText: 'self.x += speed * dt;'}).click();
 await page.keyboard.press('F9');
 await expect(page.getByTestId('script-editor').locator('.script-breakpoint')).toHaveCount(1);
 await expect(debug.getByRole('button', {name: 'Mover:4', exact: true})).toBeVisible();
 for (const expression of ['self.state.frames', 'globals']) { await debug.getByRole('textbox', {name: 'Watch expression', exact: true}).fill(expression); await debug.getByRole('textbox', {name: 'Watch expression', exact: true}).press('Enter'); }
 await expect(debug.locator('[data-watch]')).toHaveCount(2);
 console.log('PASS F9 breakpoint (glyph and list) and watch expressions');

 // Play: the first frame stops at line 4.
 await page.getByRole('button', {name: 'Play', exact: true}).click();
 await expect(shell).toHaveAttribute('data-mode', 'paused');
 debug = await panel();
 await expect(debug.getByTestId('debug-status')).toHaveText('Paused at Mover:4 · Mover.update');
 await expect(debug.locator('[data-local="speed"] span')).toHaveText('120');
 await expect(debug.locator('[data-local="self"] span')).toHaveText('Box (object)');
 await expect(debug.locator('[data-local="dt"] span')).not.toHaveText('');
 await expect(debug.locator('[data-watch="self.state.frames"] span')).toHaveText('1');
 await expect(page.getByTestId('script-editor').locator('.script-hit-line')).toHaveCount(1);
 await expect(debug.locator('[data-object="Box"] code')).toHaveText('{frames: 1}');
 const at = JSON.parse(await canvas.getAttribute('data-transforms')).box.x;
 await mkdir(join(root, 'outputs'), {recursive: true}); await page.screenshot({path: join(root, 'outputs/editor-debugger.png')});
 console.log('PASS Play pauses at the breakpoint with locals, watches, highlighted line and object state');

 // Continue and Step frame: one more frame each, stopping again.
 await debug.getByRole('button', {name: 'Continue', exact: true}).click();
 await expect(debug.locator('[data-watch="self.state.frames"] span')).toHaveText('2');
 await expect(shell).toHaveAttribute('data-mode', 'paused');
 await debug.getByRole('button', {name: 'Step frame', exact: true}).click();
 await expect(debug.locator('[data-watch="self.state.frames"] span')).toHaveText('3');
 await expect(debug.getByTestId('debug-status')).toHaveText('Paused at Mover:4 · Mover.update');
 console.log('PASS Continue and Step frame run one frame and stop again');

 // Remove the breakpoint and continue: the game runs on and Objects follows it live.
 await debug.getByRole('button', {name: 'Remove breakpoint Mover:4', exact: true}).click();
 await expect(page.getByTestId('script-editor').locator('.script-breakpoint')).toHaveCount(0);
 await debug.getByRole('button', {name: 'Continue', exact: true}).click();
 await expect(shell).toHaveAttribute('data-mode', 'playing');
 await expect(debug.getByTestId('debug-status')).toHaveText(/Running/);
 await expect.poll(async () => JSON.parse(await canvas.getAttribute('data-transforms')).box.x).toBeGreaterThan(at + 40);
 await expect.poll(async () => Number((await debug.locator('[data-object="Box"] code').innerText()).match(/\d+/)?.[0] ?? 0)).toBeGreaterThan(10);
 await page.getByRole('button', {name: 'Stop', exact: true}).click();
 debug = await panel();
 await expect(debug.getByTestId('debug-status')).toHaveText(/Not running/);
 expect(errors).toEqual([]);
 console.log('PASS without the breakpoint the game runs on; Stop detaches the debugger');
} catch (error) {
 await mkdir(join(root, 'outputs'), {recursive: true});
 const page = app ? await app.firstWindow().catch(() => null) : null;
 await page?.screenshot({path: join(root, 'outputs/debugger-failure.png')}).catch(() => {});
 throw error;
} finally {
 if (app) { await app.evaluate(({BrowserWindow}) => { for (const w of BrowserWindow.getAllWindows()) w.destroy(); }).catch(() => {}); await app.close().catch(() => {}); }
 await rm(temp, {recursive: true, force: true, maxRetries: 3});
}
