// Library organisation: Add files… (any supported type, one dialog), folders (create, rename, nest, add into the open
// folder, drag assets onto a folder), tags (preview editor, bulk, tag filter), kind/usage filters and sorting, the
// preview with usage, deleting with a used-by warning and undo; saved in the editor-only assets.library section.
import {_electron as electron, expect} from '@playwright/test';
import {mkdtemp, readFile, rm, writeFile, mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(join(root, 'apps/editor-desktop/package.json'));
const sharp = require('sharp');
const temp = await mkdtemp(join(tmpdir(), 'rewrite-library-'));
const env = {...process.env};
delete env.ELECTRON_RUN_AS_NODE;
let app;
/** 0.25 s of 16-bit mono silence. */
const wav = () => { const samples = 11025, b = Buffer.alloc(44 + samples * 2); b.write('RIFF', 0); b.writeUInt32LE(36 + samples * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(44100, 24); b.writeUInt32LE(88200, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(samples * 2, 40); return b; };

try {
 for (const [name, color, size] of [['hero', '#cc3333', 64], ['coin', '#ddbb22', 32], ['tree', '#33aa55', 48]]) await sharp({create: {width: size, height: size, channels: 4, background: color}}).png().toFile(join(temp, `${name}.png`));
 await writeFile(join(temp, 'jump.wav'), wav());
 const file = join(temp, 'library.pixieditor');
 app = await electron.launch({executablePath: process.env.REWRITE_EXECUTABLE || require('electron'), args: [...(process.env.REWRITE_EXECUTABLE ? [] : [join(root, 'apps/editor-desktop/out/main/index.js')]), '--no-hub', `--user-data-dir=${join(temp, 'user')}`], env});
 const page = await app.firstWindow();
 page.setDefaultTimeout(15000);
 const errors = [];
 page.on('pageerror', e => errors.push(e.message));
 await expect(page.getByTestId('pixi-canvas')).toHaveAttribute('data-ready', 'true', {timeout: 30000});
 const menu = label => app.evaluate(({Menu}, text) => Menu.getApplicationMenu().items.flatMap(m => m.submenu?.items ?? []).find(i => i.label === text).click(), label);
 const choose = (...paths) => app.evaluate(({dialog}, targets) => {
  dialog.showOpenDialog = async () => ({canceled: false, filePaths: targets});
  dialog.showSaveDialog = async () => ({canceled: false, filePath: targets[0]});
  dialog.showMessageBox = async () => ({response: 1, checkboxChecked: false});
 }, paths);
 const save = async () => { await choose(file); await menu('Save'); await expect(page.getByLabel('Unsaved changes', {exact: true})).toHaveCount(0); await expect.poll(() => readFile(file, 'utf8').then(() => true, () => false)).toBe(true); return JSON.parse(await readFile(file, 'utf8')); };
 const open = async () => { if (!await page.locator('.asset-library').isVisible()) await page.keyboard.press('Alt+KeyB'); return page.locator('.asset-library'); };
 let lib = await open();
 const cards = () => lib.getByTestId('asset-list').locator('[data-asset-name]');
 const names = async () => (await cards().evaluateAll(list => list.map(c => c.getAttribute('data-asset-name')))).sort();
 const folder = key => lib.locator(`[data-folder="${key}"]`);

 // Add files…: images and a sound in one dialog, each through its importer.
 await choose(join(temp, 'hero.png'), join(temp, 'coin.png'), join(temp, 'jump.wav'));
 await lib.getByRole('button', {name: 'Add files…', exact: true}).click();
 await expect(cards()).toHaveCount(3, {timeout: 30000});
 await expect(folder('unfiled')).toContainText('3');
 console.log('PASS Add files… imports images and sounds from one dialog');

 // Folders: create (renaming at once), add files into the open folder, nest, rename.
 await lib.getByRole('button', {name: 'New folder', exact: true}).click();
 const folderName = lib.getByRole('textbox', {name: 'Folder name', exact: true});
 await folderName.fill('Characters'); await folderName.press('Enter');
 await expect(lib.getByTestId('library-breadcrumb')).toContainText('Characters');
 await choose(join(temp, 'tree.png'));
 await lib.getByRole('button', {name: 'Add files…', exact: true}).click();
 await expect.poll(names).toEqual(['tree']);
 await lib.getByRole('button', {name: 'New folder', exact: true}).click();
 await folderName.fill('Enemies'); await folderName.press('Enter');
 await expect(lib.getByTestId('library-breadcrumb')).toContainText('Characters / Enemies');
 await lib.getByRole('button', {name: 'Rename folder', exact: true}).click();
 await folderName.fill('Foes'); await folderName.press('Enter');
 await expect(lib.getByTestId('library-breadcrumb')).toContainText('Characters / Foes');
 console.log('PASS folders: new, add into the open folder, nested, renamed');

 // Bulk: select two unfiled images, move them into Characters, tag them.
 await folder('unfiled').click();
 await lib.getByRole('checkbox', {name: 'Select hero', exact: true}).check();
 await lib.getByRole('checkbox', {name: 'Select coin', exact: true}).check();
 const bulk = lib.getByTestId('library-bulk');
 await expect(bulk).toContainText('2 selected');
 await bulk.getByRole('textbox', {name: 'Add tag…', exact: true}).fill('pixel, ui');
 await bulk.getByRole('textbox', {name: 'Add tag…', exact: true}).press('Enter');
 const characters = await lib.locator('.library-folder', {hasText: 'Characters'}).getAttribute('data-folder');
 await bulk.getByRole('combobox', {name: 'Move to…', exact: true}).selectOption(characters);
 await expect.poll(names).toEqual(['jump']);
 await folder(characters).click();
 await expect.poll(names).toEqual(['coin', 'hero', 'tree']);
 await expect(lib.getByTestId('library-bulk')).toHaveCount(0);
 console.log('PASS bulk tag and move; a folder shows its subfolders\' assets too');

 // Drag an asset onto a folder.
 const tree = lib.locator('[data-asset-name="tree"] .asset-thumbnail'), target = folder('unfiled');
 await tree.scrollIntoViewIfNeeded(); await target.scrollIntoViewIfNeeded();
 const from = await tree.boundingBox(), to = await target.boundingBox();
 await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2); await page.mouse.down();
 await page.mouse.move(from.x + from.width / 2 + 10, from.y + from.height / 2 + 10, {steps: 4});
 await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {steps: 12}); await page.mouse.up();
 await expect.poll(names).toEqual(['coin', 'hero']);
 // dnd-kit swallows the first click right after a drop.
 await expect(async () => { await folder('unfiled').click(); await expect(folder('unfiled')).toHaveAttribute('aria-current', 'true', {timeout: 500}); }).toPass({timeout: 5000});
 await expect.poll(names).toEqual(['jump', 'tree']);
 console.log('PASS dragging an asset onto a folder files it there');

 // Preview: tags editor, folder select, usage; filters by tag, kind and usage; sorting.
 await folder('all').click();
 await lib.getByRole('button', {name: 'Preview hero', exact: true}).click();
 const preview = lib.getByTestId('asset-preview');
 await expect(preview.getByTestId('asset-preview-info')).toContainText('Image · PNG · 64×64 px');
 await preview.getByRole('textbox', {name: 'Add tag', exact: true}).fill('Player');
 await preview.getByRole('textbox', {name: 'Add tag', exact: true}).press('Enter');
 await expect(preview.locator('.library-tag')).toHaveText(['pixel', 'ui', 'player']);
 await preview.getByRole('button', {name: 'Remove tag ui', exact: true}).click();
 await expect(preview.getByTestId('asset-usage')).toHaveAttribute('data-count', '0');
 await lib.getByRole('button', {name: 'Place hero', exact: true}).click();
 await expect(preview.getByTestId('asset-usage')).toHaveAttribute('data-count', '1');
 await expect(preview.getByTestId('asset-usage')).toContainText('Used by 1');
 const tags = lib.getByRole('group', {name: 'Filter by tag', exact: true});
 await tags.getByRole('button', {name: /^player/}).click();
 await expect.poll(names).toEqual(['hero']);
 await tags.getByRole('button', {name: /^player/}).click();
 await lib.getByRole('group', {name: 'Filters', exact: true}).getByRole('button', {name: 'Sounds', exact: true}).click();
 await expect.poll(names).toEqual(['jump']);
 await lib.getByRole('group', {name: 'Filters', exact: true}).getByRole('button', {name: 'Sounds', exact: true}).click();
 await lib.getByRole('combobox', {name: 'Usage', exact: true}).selectOption('unused');
 await expect.poll(names).toEqual(['coin', 'jump', 'tree']);
 await lib.getByRole('combobox', {name: 'Usage', exact: true}).selectOption('');
 await lib.getByRole('textbox', {name: 'Search assets', exact: true}).fill('pix');
 await expect.poll(names).toEqual(['coin', 'hero']);
 await lib.getByRole('textbox', {name: 'Search assets', exact: true}).fill('');
 await lib.getByRole('combobox', {name: 'Sort', exact: true}).selectOption('name');
 await expect.poll(() => cards().evaluateAll(list => list.map(c => c.getAttribute('data-asset-name')))).toEqual(['coin', 'hero', 'jump', 'tree']);
 console.log('PASS preview tags, info and usage; tag, kind, usage and text filters; sorting');

 // Delete: an unused asset goes at once (undo brings it back); a used one warns first.
 await lib.getByRole('button', {name: 'Preview coin', exact: true}).click();
 await preview.getByRole('button', {name: 'Delete coin', exact: true}).click();
 await expect(lib.getByTestId('library-confirm')).not.toContainText('used');
 await lib.getByTestId('library-confirm').getByRole('button', {name: 'Delete', exact: true}).click();
 await expect.poll(names).toEqual(['hero', 'jump', 'tree']);
 await menu('Undo');
 await expect.poll(names).toEqual(['coin', 'hero', 'jump', 'tree']);
 await lib.getByRole('button', {name: 'Preview hero', exact: true}).click();
 await preview.getByRole('button', {name: 'Delete hero', exact: true}).click();
 await expect(lib.getByTestId('library-confirm')).toContainText('They are used 1 times');
 await lib.getByTestId('library-confirm').getByRole('button', {name: 'Cancel', exact: true}).click();
 console.log('PASS delete: unused at once with undo; used assets warn before deleting');

 const saved = await save(), library = saved.extensions['assets.library'], byName = Object.fromEntries(saved.extensions['assets.registry'].items.map(a => [a.name, a.id]));
 expect(library.folders.map(f => f.name).sort()).toEqual(['Characters', 'Foes']);
 expect(library.items[byName.hero]).toEqual({folderId: characters, tags: ['pixel', 'player']});
 expect(library.items[byName.tree]).toEqual({folderId: null, tags: []});
 expect(errors).toEqual([]);
 await mkdir(join(root, 'outputs'), {recursive: true});
 await page.screenshot({path: join(root, 'outputs/editor-library.png')});
 console.log('PASS the Library organisation is saved in the project (assets.library)');
} catch (error) {
 await mkdir(join(root, 'outputs'), {recursive: true});
 const page = app ? await app.firstWindow().catch(() => null) : null;
 await page?.screenshot({path: join(root, 'outputs/library-failure.png')}).catch(() => {});
 throw error;
} finally {
 if (app) {
  await app.evaluate(({BrowserWindow}) => { for (const w of BrowserWindow.getAllWindows()) w.destroy(); }).catch(() => {});
  await app.close().catch(() => {});
 }
 await rm(temp, {recursive: true, force: true, maxRetries: 3});
}
