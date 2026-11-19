// Version control: start git for the project's folder, commit, see unsaved changes, Save & commit, compare an old
// version with the open project, and go back to it.
import {_electron as electron, expect} from '@playwright/test';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(join(root, 'apps/editor-desktop/package.json'));
const temp = await mkdtemp(join(tmpdir(), 'rewrite-git-'));
const env = {...process.env};
delete env.ELECTRON_RUN_AS_NODE;
Object.assign(env, {GIT_AUTHOR_NAME: 'OliveStudio Test', GIT_AUTHOR_EMAIL: 'test@example.invalid', GIT_COMMITTER_NAME: 'OliveStudio Test', GIT_COMMITTER_EMAIL: 'test@example.invalid', GIT_CONFIG_NOSYSTEM: '1'});
let app;
try {
 await mkdir(join(temp, 'game'));
 const file = join(temp, 'game', 'game.pixieditor');
 app = await electron.launch({executablePath: process.env.REWRITE_EXECUTABLE || require('electron'), args: [...(process.env.REWRITE_EXECUTABLE ? [] : [join(root, 'apps/editor-desktop/out/main/index.js')]), '--no-hub', `--user-data-dir=${join(temp, 'user')}`], env});
 const page = await app.firstWindow();
 page.setDefaultTimeout(15000);
 const errors = [];
 page.on('pageerror', e => errors.push(e.message));
 const canvas = page.getByTestId('pixi-canvas');
 await expect(canvas).toHaveAttribute('data-ready', 'true', {timeout: 30000});
 const menu = label => app.evaluate(({Menu}, text) => Menu.getApplicationMenu().items.flatMap(m => m.submenu?.items ?? []).find(i => i.label === text).click(), label);
 const choose = path => app.evaluate(({dialog}, target) => { dialog.showOpenDialog = async () => ({canceled: false, filePaths: [target]}); dialog.showSaveDialog = async () => ({canceled: false, filePath: target}); dialog.showMessageBox = async () => ({response: 1, checkboxChecked: false}); }, path);
 const panel = page.getByTestId('version-control');
 const open = async () => { if (!await panel.isVisible()) await page.keyboard.press('Alt+KeyW'); await expect(panel).toBeVisible(); };
 await open();
 await expect(panel).toContainText('Save the project first');
 await page.keyboard.press('Escape');
 await choose(file); await menu('Save');
 await expect.poll(() => readFile(file, 'utf8').then(() => true, () => false)).toBe(true);
 const project = JSON.parse(await readFile(file, 'utf8'));
 const t = (id, x, y) => ({id: `${id}-t`, type: 'scene.transform2d', version: 1, data: {x, y, rotation: 0, scaleX: 1, scaleY: 1}});
 const shape = (id, color) => ({id: `${id}-s`, type: 'pixi.shape', version: 1, data: {alpha: 1, kind: 'rect', width: 80, height: 80, color, rounded: 0, sides: 5, innerRadius: .5, strokeColor: '#ffffff', strokeWidth: 0}});
 project.scenes[0].entities = [{id: 'box', name: 'Box', parentId: null, active: true, components: [t('box', 200, 200), shape('box', '#e04040')]}, {id: 'ball', name: 'Ball', parentId: null, active: true, components: [t('ball', 500, 200), shape('ball', '#5bc0eb')]}];
 await writeFile(file, JSON.stringify(project));
 await choose(file); await menu('Open…');
 await expect.poll(async () => Object.keys(JSON.parse(await canvas.getAttribute('data-transforms') ?? '{}'))).toContain('ball');

 await open();
 await panel.getByRole('button', {name: 'Start version control'}).click();
 await expect(panel).toHaveAttribute('data-repo', 'true');
 await expect(panel.getByTestId('vc-changes')).toContainText('game.pixieditor');
 await panel.getByRole('textbox', {name: 'Describe the change'}).fill('First version');
 await panel.getByRole('button', {name: 'Commit', exact: true}).click();
 await expect(panel.getByTestId('vc-log').locator('li')).toHaveCount(1);
 await expect(panel.getByTestId('vc-log')).toContainText('First version');
 await expect(panel).toContainText('Everything is committed.');
 console.log('PASS start version control in the project folder and commit it');

 await page.keyboard.press('Escape');
 const view = async () => { const b = await canvas.locator('canvas').boundingBox(), s = Math.min((b.width - 80) / 960, (b.height - 90) / 540); return {at: (x, y) => ({x: b.x + (b.width - 960 * s) / 2 + x * s, y: b.y + (b.height - 540 * s) / 2 + y * s})}; };
 { const p = (await view()).at(200, 200); await page.mouse.click(p.x, p.y); }
 await page.keyboard.press('Delete');
 await expect.poll(async () => Object.keys(JSON.parse(await canvas.getAttribute('data-transforms') ?? '{}'))).not.toContain('box');
 await open();
 await expect(panel).toContainText('unsaved changes');
 await panel.getByRole('textbox', {name: 'Describe the change'}).fill('Remove the box');
 await panel.getByRole('button', {name: 'Save & commit'}).click();
 await expect(panel.getByTestId('vc-log').locator('li')).toHaveCount(2);
 await expect(panel.getByTestId('vc-log').locator('li').first()).toContainText('Remove the box');
 await panel.getByTestId('vc-log').locator('li').nth(1).getByRole('button', {name: 'Compare'}).click();
 await expect(panel.getByTestId('vc-compare')).toContainText('Box');
 console.log('PASS Save & commit, history, and comparing the first version shows the removed object');

 await panel.getByTestId('vc-log').locator('li').nth(1).getByRole('button', {name: 'Go back'}).click();
 await expect.poll(async () => Object.keys(JSON.parse(await canvas.getAttribute('data-transforms') ?? '{}'))).toContain('box');
 await open();
 await expect(panel.getByTestId('vc-changes')).toContainText('game.pixieditor');
 expect(JSON.parse(await readFile(file, 'utf8')).scenes[0].entities.map(e => e.id)).toContain('box');
 expect(errors).toEqual([]);
 console.log('PASS going back restores the first version in the editor and on disk (as a change to commit)');
} catch (error) {
 await mkdir(join(root, 'outputs'), {recursive: true});
 const page = app ? await app.firstWindow().catch(() => null) : null;
 await page?.screenshot({path: join(root, 'outputs/git-failure.png')}).catch(() => {});
 throw error;
} finally {
 if (app) { await app.evaluate(({BrowserWindow}) => { for (const w of BrowserWindow.getAllWindows()) w.destroy(); }).catch(() => {}); await app.close().catch(() => {}); }
 await rm(temp, {recursive: true, force: true, maxRetries: 3});
}
