// Sound Lab: generate effects in the editor, add one to the Library and one as a sound object (one undo step), save
// and check the project holds real WAV assets with their sources and the object points at its sound.
import {_electron as electron, expect} from '@playwright/test';
import {mkdir, mkdtemp, readFile, readdir, rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(join(root, 'apps/editor-desktop/package.json'));
const temp = await mkdtemp(join(tmpdir(), 'rewrite-soundlab-'));
const env = {...process.env};
delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
 const file = join(temp, 'sounds.pixieditor');
 app = await electron.launch({executablePath: process.env.REWRITE_EXECUTABLE || require('electron'), args: [...(process.env.REWRITE_EXECUTABLE ? [] : [join(root, 'apps/editor-desktop/out/main/index.js')]), '--no-hub', `--user-data-dir=${join(temp, 'user')}`], env});
 const page = await app.firstWindow();
 page.setDefaultTimeout(20000);
 const errors = [];
 page.on('pageerror', e => errors.push(e.message));
 await expect(page.getByTestId('pixi-canvas')).toHaveAttribute('data-ready', 'true', {timeout: 30000});
 const menu = label => app.evaluate(({Menu}, text) => Menu.getApplicationMenu().items.flatMap(m => m.submenu?.items ?? []).find(i => i.label === text).click(), label);
 const choose = path => app.evaluate(({dialog}, target) => { dialog.showOpenDialog = async () => ({canceled: false, filePaths: [target]}); dialog.showSaveDialog = async () => ({canceled: false, filePath: target}); dialog.showMessageBox = async () => ({response: 1, checkboxChecked: false}); }, path);
 const open = async () => { const lab = page.getByTestId('sound-lab'); if (!await lab.isVisible()) await page.keyboard.press('Alt+KeyU'); await expect(lab).toBeVisible(); return lab; };
 let lab = await open();
 await lab.getByRole('button', {name: 'Explosion', exact: true}).click();
 await expect(lab.getByRole('textbox', {name: 'Sound name', exact: true})).toHaveValue('Explosion 1');
 await expect(lab.getByTestId('sfx-duration')).toHaveText(/^\d\.\d\d s$/);
 const duration = Number((await lab.getByTestId('sfx-duration').innerText()).split(' ')[0]);
 await lab.getByRole('spinbutton', {name: 'Volume', exact: true}).fill('0.5');
 await lab.getByRole('button', {name: 'Add to Library', exact: true}).click();
 await expect(page.getByText('Added Explosion 1 to the Library', {exact: true})).toBeVisible();
 lab = await open();
 await lab.getByRole('button', {name: 'Jump', exact: true}).click();
 await lab.getByRole('button', {name: 'Add as sound object', exact: true}).click();
 await expect(page.getByText('Added Jump 1 to the Library and the scene', {exact: true})).toBeVisible();
 console.log('PASS Sound Lab: presets, edit, add to the Library and as a sound object');

 await choose(file); await menu('Save');
 await expect.poll(() => readFile(file, 'utf8').then(t => JSON.parse(t).extensions['assets.registry']?.items?.length ?? 0, () => 0)).toBe(2);
 const project = JSON.parse(await readFile(file, 'utf8')), items = project.extensions['assets.registry'].items;
 const explosion = items.find(a => a.name === 'Explosion 1'), jump = items.find(a => a.name === 'Jump 1');
 expect(explosion.type).toBe('audio.clip'); expect(jump.type).toBe('audio.clip');
 expect(Math.abs(explosion.metadata.duration - duration)).toBeLessThan(.02);
 const object = project.scenes[0].entities.find(e => e.name === 'Jump 1');
 expect(object.components.find(c => c.type === 'audio.source').data.assetId).toBe(jump.id);
 expect((await readdir(file + '.assets/sources')).filter(f => f.endsWith('.wav'))).toHaveLength(2);
 console.log('PASS saved project: two WAV clips with sources, the object plays Jump 1');

 await menu('Undo');
 await choose(file); await menu('Save');
 await expect.poll(() => readFile(file, 'utf8').then(t => JSON.parse(t).extensions['assets.registry'].items.length, () => 0)).toBe(1);
 const undone = JSON.parse(await readFile(file, 'utf8'));
 expect(undone.scenes[0].entities.some(e => e.name === 'Jump 1')).toBe(false);
 expect(errors).toEqual([]);
 console.log('PASS one Undo removes the sound object and its clip together');
} catch (error) {
 await mkdir(join(root, 'outputs'), {recursive: true});
 const page = app ? await app.firstWindow().catch(() => null) : null;
 await page?.screenshot({path: join(root, 'outputs/soundlab-failure.png')}).catch(() => {});
 throw error;
} finally {
 if (app) { await app.evaluate(({BrowserWindow}) => { for (const w of BrowserWindow.getAllWindows()) w.destroy(); }).catch(() => {}); await app.close().catch(() => {}); }
 await rm(temp, {recursive: true, force: true, maxRetries: 3});
}
