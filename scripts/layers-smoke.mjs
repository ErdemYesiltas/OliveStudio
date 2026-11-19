// Layers and Properties: Group (⌘G) keeps world poses and Ungroup restores them, batch rename with numbers and
// padding, colour labels (saved, stripped from the HTML export), and per-component Copy / Paste values / Paste as new
// and Move up/down in Properties — each one undo step.
import {_electron as electron, expect} from '@playwright/test';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(join(root, 'apps/editor-desktop/package.json'));
const temp = await mkdtemp(join(tmpdir(), 'rewrite-layers-'));
const env = {...process.env};
delete env.ELECTRON_RUN_AS_NODE;
const shape = (id, name, x, y, color, rotation = 0) => ({id, name, parentId: null, active: true, components: [
 {id: `${id}-t`, type: 'scene.transform2d', version: 1, data: {x, y, rotation, scaleX: 1, scaleY: 1}},
 {id: `${id}-s`, type: 'pixi.shape', version: 1, data: {width: 80, height: 40, color, rounded: 0, alpha: 1}},
]});
const entities = [shape('a', 'Brick 1', 200, 200, '#e14c4c'), shape('b', 'Brick 2', 400, 200, '#e14c4c'), shape('c', 'Brick 3', 600, 200, '#e14c4c'), shape('w', 'Wall', 400, 400, '#3fa36b', 30)];
const project = {formatVersion: 1, name: 'Layers', entrySceneId: 'scene', scenes: [{formatVersion: 1, id: 'scene', name: 'Layers', entities}], modules: {}, providers: {render: 'pixi'}, extensions: {}};
const file = join(temp, 'Layers.pixieditor');
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
 await expect.poll(async () => Object.keys(JSON.parse(await canvas.getAttribute('data-transforms') ?? '{}')).length).toBe(4);
 await page.getByRole('button', {name: 'Layers', exact: true}).click(); await page.getByRole('button', {name: 'Pin Layers', exact: true}).click();
 await page.getByRole('button', {name: 'Properties', exact: true}).click(); await page.getByRole('button', {name: 'Pin Properties', exact: true}).click();
 const layers = page.getByTestId('layers-panel'), row = name => layers.getByRole('button', {name: `Select ${name}`, exact: true});
 const save = async () => { await choose(file); await menu('Save'); await expect(page.getByLabel('Unsaved changes', {exact: true})).toHaveCount(0); return JSON.parse(await readFile(file, 'utf8')).scenes[0].entities; };
 const names = async () => (await layers.locator('[data-entity-select]').allInnerTexts()).map(t => t.replace(/^[◇◌]\s*/, '').trim());
 const pick = async (...list) => { await row(list[0]).click(); for (const n of list.slice(1)) await row(n).click({modifiers: ['Meta']}); };
 const near = v => Math.round(v * 1000) / 1000;

 // Group: a new parent at the centre of the origins; world positions unchanged; Ungroup puts them back.
 await pick('Brick 1', 'Brick 2', 'Brick 3');
 await menu('Group');
 await expect.poll(names).toEqual(['Group', 'Brick 1', 'Brick 2', 'Brick 3', 'Wall']);
 let saved = await save(), group = saved.find(e => e.name === 'Group'), g = group.components[0].data;
 expect([g.x, g.y]).toEqual([400, 200]);
 for (const [id, x] of [['a', 200], ['b', 400], ['c', 600]]) { const e = saved.find(e => e.id === id), t = e.components[0].data; expect(e.parentId).toBe(group.id); expect([near(g.x + t.x), near(g.y + t.y)]).toEqual([x, 200]); }
 await menu('Undo'); await expect.poll(names).toEqual(['Brick 1', 'Brick 2', 'Brick 3', 'Wall']);
 await menu('Redo'); await expect.poll(names).toEqual(['Group', 'Brick 1', 'Brick 2', 'Brick 3', 'Wall']);
 await row('Group').click();
 await layers.getByRole('button', {name: 'Ungroup', exact: true}).click();
 await expect.poll(names).toEqual(['Brick 1', 'Brick 2', 'Brick 3', 'Wall']);
 saved = await save();
 expect(saved.filter(e => ['a', 'b', 'c'].includes(e.id)).map(e => [e.parentId, near(e.components[0].data.x)])).toEqual([[null, 200], [null, 400], [null, 600]]);
 console.log('PASS Group (⌘G) wraps the selection at its centre keeping world poses, Undo/Redo, Ungroup restores');

 // Batch rename: pattern suggested from the names, {nn} padding from a start number; one Undo.
 await pick('Brick 1', 'Brick 2', 'Brick 3');
 await layers.getByRole('button', {name: 'Rename objects…', exact: true}).click();
 const pattern = layers.getByRole('textbox', {name: 'Name pattern', exact: true});
 await expect(pattern).toHaveValue('Brick {n}');
 await pattern.fill('Tile {nn}'); await layers.getByRole('spinbutton', {name: 'First number', exact: true}).fill('8');
 await layers.getByRole('button', {name: 'Rename', exact: true}).click();
 await expect.poll(names).toEqual(['Tile 08', 'Tile 09', 'Tile 10', 'Wall']);
 await menu('Undo'); await expect.poll(names).toEqual(['Brick 1', 'Brick 2', 'Brick 3', 'Wall']);
 await menu('Redo'); await expect.poll(names).toEqual(['Tile 08', 'Tile 09', 'Tile 10', 'Wall']);
 console.log('PASS batch rename: suggested pattern, {nn} padding from 8, one Undo step');

 // Colour labels: on the rows, saved as an editor-only component, absent from the HTML export.
 await pick('Tile 08', 'Tile 10');
 await layers.getByRole('combobox', {name: 'Colour label', exact: true}).selectOption('red');
 await expect(layers.locator('[data-entity-id="a"]')).toHaveAttribute('data-label', 'red');
 await expect(layers.locator('[data-entity-id="c"]')).toHaveAttribute('data-label', 'red');
 await expect(layers.locator('[data-entity-id="b"]')).not.toHaveAttribute('data-label', /./);
 saved = await save();
 expect(saved.find(e => e.id === 'a').components.find(c => c.type === 'editor.label').data).toEqual({color: 'red'});
 const exportDir = join(temp, 'export'); await mkdir(exportDir);
 await page.getByRole('button', {name: 'Export', exact: true}).click();
 await choose(exportDir);
 await page.getByRole('button', {name: 'Export HTML…', exact: true}).click();
 await expect(page.getByTestId('build-status')).toHaveAttribute('data-phase', 'complete', {timeout: 30000});
 const exported = await readFile(join(await page.getByTestId('build-output').innerText(), 'project.json'), 'utf8');
 expect(exported).not.toContain('editor.label');
 await page.keyboard.press('Escape');
 console.log('PASS colour labels mark rows, are saved with the project and stripped from the HTML export');

 // Properties: copy the Wall's Transform and Shape, paste their values onto a tile; add Effects and reorder.
 const props = page.getByTestId('properties');
 const open = async name => { const d = props.locator('details', {has: page.locator('summary', {hasText: new RegExp(`^${name}$`)})}); if (await d.getAttribute('open') === null) await d.locator('summary').click(); };
 await row('Wall').click();
 await props.getByRole('button', {name: 'Copy Transform component', exact: true}).click();
 await row('Tile 08').click();
 await props.getByRole('button', {name: 'Paste Transform component', exact: true}).click();
 await expect.poll(async () => { const t = JSON.parse(await canvas.getAttribute('data-transforms')).a; return [t.x, t.y, Math.round(t.rotation)]; }).toEqual([400, 400, 30]);
 await row('Wall').click();
 await open('Shape'); await props.getByRole('button', {name: 'Copy Shape component', exact: true}).click();
 await row('Tile 09').click();
 await props.getByRole('button', {name: 'Paste Shape component', exact: true}).click();
 saved = await save();
 expect(saved.find(e => e.id === 'b').components.find(c => c.type === 'pixi.shape').data.color).toBe('#3fa36b');
 expect(saved.find(e => e.id === 'b').components.filter(c => c.type === 'pixi.shape')).toHaveLength(1);
 await menu('Undo');
 await expect.poll(async () => (await save()).find(e => e.id === 'b').components.find(c => c.type === 'pixi.shape').data.color).toBe('#e14c4c');
 await row('Tile 09').click();
 await props.getByRole('combobox', {name: 'Add component', exact: true}).selectOption({label: 'Effects'});
 await open('Effects'); await props.getByRole('button', {name: 'Move Effects up', exact: true}).click();
 saved = await save();
 expect(saved.find(e => e.id === 'b').components.map(c => c.type)).toEqual(['scene.transform2d', 'pixi.effects', 'pixi.shape']);
 await expect(props.getByRole('button', {name: 'Move Effects up', exact: true})).toBeDisabled();
 // Number fields: arithmetic and changes of the current value, arrow steps; a mixed selection changes each object.
 const pose = async id => JSON.parse(await canvas.getAttribute('data-transforms'))[id];
 await row('Wall').click();
 const x = props.getByRole('spinbutton', {name: 'x', exact: true});
 for (const [typed, expected] of [['+50', 450], ['*2', 900], ['480/2', 240]]) { await x.fill(typed); await x.press('Enter'); await expect(x).toHaveValue(String(expected)); await expect.poll(async () => (await pose('w')).x).toBe(expected); }
 await x.press('ArrowUp'); await expect(x).toHaveValue('241'); await expect.poll(async () => (await pose('w')).x).toBe(241);
 await x.press('Shift+ArrowUp'); await x.press('Enter'); await expect.poll(async () => (await pose('w')).x).toBe(251);
 await pick('Tile 08', 'Tile 09');
 const y = props.getByRole('spinbutton', {name: 'y', exact: true});
 await expect(y).toHaveValue('');
 await y.fill('+10'); await y.press('Enter');
 await expect.poll(async () => [(await pose('a')).y, (await pose('b')).y]).toEqual([410, 210]);
 await expect(y).toHaveValue('');
 await page.waitForTimeout(100);
 expect([(await pose('a')).y, (await pose('b')).y]).toEqual([410, 210]);
 await menu('Undo');
 await expect.poll(async () => [(await pose('a')).y, (await pose('b')).y]).toEqual([400, 200]);
 console.log('PASS number fields: +50, *2, 480/2, arrow steps, and +10 on a mixed selection changes each object (one Undo)');
 expect(errors).toEqual([]);
 await mkdir(join(root, 'outputs'), {recursive: true});
 await page.screenshot({path: join(root, 'outputs/editor-layers.png')});
 console.log('PASS Properties: copy a component, paste its values (one Undo) and reorder components');
} catch (error) {
 await mkdir(join(root, 'outputs'), {recursive: true});
 const page = app ? await app.firstWindow().catch(() => null) : null;
 await page?.screenshot({path: join(root, 'outputs/layers-failure.png')}).catch(() => {});
 throw error;
} finally {
 if (app) { await app.evaluate(({BrowserWindow}) => { for (const w of BrowserWindow.getAllWindows()) w.destroy(); }).catch(() => {}); await app.close().catch(() => {}); }
 await rm(temp, {recursive: true, force: true, maxRetries: 3});
}
