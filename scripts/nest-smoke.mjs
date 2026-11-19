// Prefab edit mode and nested prefabs: Edit prefab opens it as its own scene where its structure can change; Save to
// prefab updates every instance; a deck of card instances becomes a prefab of its own, and a change to the card
// reaches the deck's source and every card in the scene.
import {_electron as electron, expect} from '@playwright/test';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(join(root, 'apps/editor-desktop/package.json'));
const temp = await mkdtemp(join(tmpdir(), 'rewrite-nest-'));
const env = {...process.env};
delete env.ELECTRON_RUN_AS_NODE;
const project = {formatVersion: 1, name: 'Nest', entrySceneId: 'main', modules: {}, providers: {render: 'pixi'}, extensions: {}, scenes: [{formatVersion: 1, id: 'main', name: 'Main', entities: [
 {id: 'card', name: 'Card', parentId: null, active: true, components: [{id: 'card-t', type: 'scene.transform2d', version: 1, data: {x: 200, y: 200, rotation: 0, scaleX: 1, scaleY: 1}}, {id: 'card-s', type: 'pixi.shape', version: 1, data: {width: 80, height: 110, color: '#3f7be0', rounded: 8, alpha: 1}}]},
 {id: 'deck', name: 'Deck', parentId: null, active: true, components: [{id: 'deck-t', type: 'scene.transform2d', version: 1, data: {x: 600, y: 300, rotation: 0, scaleX: 1, scaleY: 1}}]},
]}]};
const file = join(temp, 'Nest.pixieditor');
let app;
try {
 await writeFile(file, JSON.stringify(project));
 app = await electron.launch({executablePath: process.env.REWRITE_EXECUTABLE || require('electron'), args: [...(process.env.REWRITE_EXECUTABLE ? [] : [join(root, 'apps/editor-desktop/out/main/index.js')]), '--no-hub', `--user-data-dir=${join(temp, 'user')}`], env});
 const page = await app.firstWindow();
 page.setDefaultTimeout(15000);
 const errors = [];
 page.on('pageerror', e => errors.push(e.message));
 const canvas = page.getByTestId('pixi-canvas');
 await expect(canvas).toHaveAttribute('data-ready', 'true', {timeout: 30000});
 const menu = label => app.evaluate(({Menu}, text) => Menu.getApplicationMenu().items.flatMap(m => m.submenu?.items ?? []).find(i => i.label === text).click(), label);
 const choose = path => app.evaluate(({dialog}, target) => { dialog.showOpenDialog = async () => ({canceled: false, filePaths: [target]}); dialog.showSaveDialog = async () => ({canceled: false, filePath: target}); dialog.showMessageBox = async () => ({response: 1, checkboxChecked: false}); }, path);
 await choose(file); await menu('Open…');
 await expect.poll(async () => Object.keys(JSON.parse(await canvas.getAttribute('data-transforms') ?? '{}')).length).toBe(2);
 const save = async () => { await choose(file); await menu('Save'); await expect(page.getByLabel('Unsaved changes', {exact: true})).toHaveCount(0); return JSON.parse(await readFile(file, 'utf8')); };
 const pin = async name => { await page.getByRole('button', {name, exact: true}).click(); await page.getByRole('button', {name: `Pin ${name}`, exact: true}).click(); };
 await pin('Layers'); await pin('Properties');
 const layers = page.getByTestId('layers-panel'), props = page.getByTestId('properties');
 const row = name => layers.getByRole('button', {name: `Select ${name}`, exact: true});
 const rows = async name => (await layers.locator('[data-entity-select]').allInnerTexts()).filter(t => t.replace(/^[◇◌]\s*/, '').trim() === name).length;
 const library = () => page.getByTestId('prefab-library');
 const openPrefabs = async () => { if (!await library().isVisible()) await page.getByRole('button', {name: 'Prefabs', exact: true}).click(); await expect(library()).toBeVisible(); };

 // A Card prefab and a second instance.
 await row('Card').click();
 await props.getByRole('button', {name: 'Create prefab from selection', exact: true}).click();
 await openPrefabs();
 await library().getByRole('button', {name: 'Instantiate prefab', exact: true}).click();
 await page.keyboard.press('Escape');
 await expect.poll(() => rows('Card')).toBe(2);

 // Edit mode: add a Badge child under the prefab root, Save to prefab: both cards get it.
 await openPrefabs();
 await library().getByRole('button', {name: 'Edit prefab', exact: true}).click();
 const bar = page.getByTestId('prefab-edit-bar');
 await expect(bar).toContainText('Editing prefab: Card');
 await expect.poll(() => rows('Card')).toBe(1);
 await layers.getByRole('button', {name: '+ Entity', exact: true}).click();
 const name = props.getByRole('textbox', {name: 'Object name', exact: true});
 await name.fill('Badge'); await name.press('Enter');
 await props.getByRole('combobox', {name: 'Object parent', exact: true}).selectOption({label: 'Card'});
 await bar.getByRole('button', {name: 'Save to prefab', exact: true}).click();
 await expect(bar).toHaveCount(0);
 await expect.poll(() => rows('Badge')).toBe(2);
 let saved = await save();
 expect(saved.scenes.map(s => s.name)).toEqual(['Main']);
 console.log('PASS Edit prefab: the prefab opens as its own scene, a new child saved to it appears in every instance');

 // Nested: both cards under the Deck, the Deck becomes a prefab, a second deck is placed.
 for (const index of [0, 1]) {
  await layers.locator('[data-entity-select]').filter({hasText: /^\W*Card$/}).nth(index).click();
  await props.getByRole('combobox', {name: 'Object parent', exact: true}).selectOption({label: 'Deck'});
 }
 await row('Deck').click();
 await props.getByRole('button', {name: 'Create prefab from selection', exact: true}).click();
 await openPrefabs();
 await library().getByRole('combobox', {name: 'Prefab source', exact: true}).selectOption({label: 'Deck'});
 await library().getByRole('button', {name: 'Instantiate prefab', exact: true}).click();
 await expect.poll(() => rows('Card')).toBe(4);
 await expect.poll(() => rows('Deck')).toBe(2);

 // A change to the card (edit mode) reaches the deck's source and all four cards.
 await library().getByRole('combobox', {name: 'Prefab source', exact: true}).selectOption({label: 'Card'});
 await library().getByRole('button', {name: 'Edit prefab', exact: true}).click();
 await expect(bar).toContainText('Card');
 await row('Card').click();
 const shape = props.locator('details', {has: page.locator('summary', {hasText: /^Shape$/})});
 if (await shape.getAttribute('open') === null) await shape.locator('summary').click();
 await shape.getByLabel('color', {exact: true}).fill('#e0a020');
 await shape.getByLabel('color', {exact: true}).press('Enter');
 await bar.getByRole('button', {name: 'Save to prefab', exact: true}).click();
 await expect(bar).toHaveCount(0);
 saved = await save();
 const cards = saved.scenes[0].entities.filter(e => e.name === 'Card');
 expect(cards).toHaveLength(4);
 expect(cards.map(c => c.components.find(x => x.type === 'pixi.shape').data.color)).toEqual(['#e0a020', '#e0a020', '#e0a020', '#e0a020']);
 const deckSource = saved.extensions['prefabs.registry'].items.find(p => p.name === 'Deck');
 expect(deckSource.entities.filter(e => e.name === 'Card').map(c => c.components.find(x => x.type === 'pixi.shape').data.color)).toEqual(['#e0a020', '#e0a020']);
 expect(errors).toEqual([]);
 await mkdir(join(root, 'outputs'), {recursive: true});
 await page.screenshot({path: join(root, 'outputs/editor-nest.png')});
 console.log('PASS nested prefabs: a deck of cards is a prefab; editing the card updates the deck source and all four cards');
} catch (error) {
 await mkdir(join(root, 'outputs'), {recursive: true});
 const page = app ? await app.firstWindow().catch(() => null) : null;
 await page?.screenshot({path: join(root, 'outputs/nest-failure.png')}).catch(() => {});
 throw error;
} finally {
 if (app) { await app.evaluate(({BrowserWindow}) => { for (const w of BrowserWindow.getAllWindows()) w.destroy(); }).catch(() => {}); await app.close().catch(() => {}); }
 await rm(temp, {recursive: true, force: true, maxRetries: 3});
}
