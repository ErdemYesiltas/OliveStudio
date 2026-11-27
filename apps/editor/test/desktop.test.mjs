import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { _electron, expect } from '@playwright/test';

const require = createRequire(new URL('../package.json', import.meta.url));

async function launchEditor(profile, { hub = false } = {}) {
  const installed = process.env.OLIVESTUDIO_TEST_APP;
  const editor = await _electron.launch({
    executablePath: installed ?? require('electron'),
    args: [
      ...(installed ? [] : [fileURLToPath(new URL('../desktop.mjs', import.meta.url))]),
      '--enable-unsafe-swiftshader',
    ],
    env: { ...process.env, OLIVESTUDIO_USER_DATA: profile },
  });
  if (!hub) {
    try {
      await (await editor.firstWindow()).getByRole('button', { name: 'Continue to Editor' }).click({ timeout: 5000 });
    } catch (error) {
      await editor.close();
      throw error;
    }
  }
  return editor;
}

test('native File menu, canceled saves, and closing a dirty scene', { timeout: 30_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'olive-files-test-'));
  const path = join(directory, 'local-scene.json');
  let editor;
  try {
    editor = await launchEditor(join(directory, 'profile'));
    const page = await editor.firstWindow();
    await expect(page.locator('canvas')).toBeVisible();
    assert.equal(page.url(), 'olive-studio://editor/');

    await editor.evaluate(({ dialog }, path) => {
      let saveAttempts = 0;
      dialog.showSaveDialog = async () => (++saveAttempts === 1 ? { canceled: true } : { canceled: false, filePath: path });
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
      dialog.showMessageBoxSync = () => 0;
    }, path);

    const save = page.getByRole('button', { name: 'Save Scene' });
    const dirty = page.getByRole('img', { name: 'Unsaved changes' });
    const position = page.getByRole('spinbutton', { name: 'Position X' });
    await position.fill('125');
    await position.press('Enter');
    await expect(dirty).toBeVisible();
    await save.click();
    await expect(save).toBeEnabled();
    await expect(dirty).toBeVisible();
    await assert.rejects(readFile(path), { code: 'ENOENT' });

    const command = label => editor.evaluate(({ BrowserWindow, Menu }, label) => {
      const window = BrowserWindow.getAllWindows()[0];
      const menu = Menu.getApplicationMenu().items.find(item => item.label === 'File').submenu;
      const item = menu.items.find(item => item.label === label);
      item.click(undefined, window, undefined);
    }, label);

    await position.fill('150');
    await command('Save Scene');
    await expect(dirty).toHaveCount(0);
    const saved = JSON.parse(await readFile(path, 'utf8'));
    assert.equal(saved.objects[0].children[0].position.x, 150);
    await expect(page.getByText('local-scene.json')).toBeVisible();

    await command('New Scene');
    await expect(page.getByRole('button', { name: 'Camera 2D', exact: true })).toBeVisible();
    await command('Open Scene');
    await expect(page.getByText('local-scene.json')).toBeVisible();
    await page.getByRole('button', { name: 'Olive Crystal', exact: true }).click();
    await expect(position).toHaveValue('150');

    await position.fill('175');
    await position.press('Enter');
    await expect(dirty).toBeVisible();
    const intercepted = await editor.evaluate(({ BrowserWindow }) => new Promise(resolve => {
      const window = BrowserWindow.getAllWindows()[0];
      window.webContents.once('will-prevent-unload', () => resolve(true));
      window.close();
    }));
    assert.equal(intercepted, true);
    await expect(dirty).toBeVisible();
    assert.equal(page.isClosed(), false);
  } finally {
    if (editor) {
      await editor.evaluate(({ dialog }) => { dialog.showMessageBoxSync = () => 1; }).catch(() => {});
      await editor.close();
    }
    await rm(directory, { recursive: true, force: true });
  }
});

test('native themes update the editor, follow the system, and persist by profile', { timeout: 30_000 }, async () => {
  const profile = await mkdtemp(join(tmpdir(), 'olive-theme-test-'));
  const appearance = join(profile, 'appearance.json');
  let editor;
  try {
    await writeFile(appearance, JSON.stringify({ theme: 'unknown' }));
    editor = await launchEditor(profile);
    const page = await editor.firstWindow();
    await page.emulateMedia({ colorScheme: null });
    await expect(page.locator('canvas')).toBeVisible();
    await expect(page.locator('.asset-card img')).toBeVisible();
    await expect.poll(() => page.locator('html').evaluate(el => getComputedStyle(el).colorScheme)).toBe('dark');

    const setTheme = theme => editor.evaluate(({ BrowserWindow, Menu, nativeTheme }, theme) => {
      const menu = Menu.getApplicationMenu();
      const item = menu.getMenuItemById('theme-' + theme);
      item.click(undefined, BrowserWindow.getAllWindows()[0], undefined);
      return { source: nativeTheme.themeSource, dark: nativeTheme.shouldUseDarkColors, checked: item.checked };
    }, theme);
    const canvas = page.locator('canvas');
    const element = await canvas.elementHandle();
    const initial = await element.evaluate(el => [el.width, el.height]);

    assert.deepEqual(await setTheme('light'), { source: 'light', dark: false, checked: true });
    await expect.poll(() => page.locator('html').evaluate(el => getComputedStyle(el).colorScheme)).toBe('light');
    await expect(page.locator('.panel.stage')).toHaveCSS('background-color', 'rgb(248, 249, 246)');
    await expect(page.getByRole('region', { name: 'Assets', exact: true })).toHaveCSS('background-color', 'rgb(248, 249, 246)');
    assert.deepEqual(await element.evaluate(el => [el.width, el.height]), initial);
    assert.equal(await element.evaluate(el => el.isConnected), true);
    await expect(page.getByRole('img', { name: 'Unsaved changes' })).toHaveCount(0);

    const system = await setTheme('system');
    assert.equal(system.source, 'system');
    assert.equal(system.checked, true);
    await expect.poll(() => page.locator('html').evaluate(el => getComputedStyle(el).colorScheme))
      .toBe(system.dark ? 'dark' : 'light');
    assert.deepEqual(JSON.parse(await readFile(appearance, 'utf8')), { theme: 'system' });
    await setTheme('light');
    await editor.close();
    editor = undefined;

    editor = await launchEditor(profile);
    const reopened = await editor.firstWindow();
    await reopened.emulateMedia({ colorScheme: null });
    await expect.poll(() => reopened.locator('html').evaluate(el => getComputedStyle(el).colorScheme)).toBe('light');
    assert.equal(await editor.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('theme-light').checked), true);
  } finally {
    await editor?.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test('Finder-style drops and native imports are packed into the scene and survive reopening', { timeout: 30_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'olive-import-test-'));
  const scenePath = join(directory, 'portable.json');
  const imagePath = join(directory, 'drop preview.png');
  const audioPath = join(directory, 'opening.wav');
  const invalidPath = join(directory, 'broken.png');
  const fixture = name => readFile(new URL('../raw-assets/' + name, import.meta.url));
  let editor;
  try {
    await writeFile(imagePath, await fixture('images{m}/olive-crystal.png'));
    await writeFile(audioPath, await fixture('sounds{m}/chime.wav'));
    await writeFile(invalidPath, 'invalid image');
    editor = await launchEditor(join(directory, 'profile'));
    const page = await editor.firstWindow();
    await expect(page.getByText('2 assets', { exact: true })).toBeVisible();
    const assets = page.getByRole('region', { name: 'Assets', exact: true });
    await expect(assets.getByRole('button', { name: 'Import Assets' })).toBeEnabled();
    const bounds = await assets.boundingBox();
    const cdp = await page.context().newCDPSession(page);
    const drag = {
      x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2,
      data: { items: [], files: [imagePath], dragOperationsMask: 1 },
    };
    for (const type of ['dragEnter', 'dragOver', 'drop']) await cdp.send('Input.dispatchDragEvent', { type, ...drag });
    await expect(assets.getByText('drop preview.png', { exact: true })).toBeVisible();
    await expect(assets.getByText('3 assets', { exact: true })).toBeVisible();
    const dirty = page.getByRole('img', { name: 'Unsaved changes' });
    await expect(dirty).toBeVisible();
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(assets.getByText('drop preview.png', { exact: true })).toHaveCount(0);
    await expect(dirty).toHaveCount(0);
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect(assets.getByText('drop preview.png', { exact: true })).toBeVisible();

    await editor.evaluate(({ dialog }, paths) => {
      const openPaths = [paths.audioPath, paths.invalidPath, paths.scenePath];
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [openPaths.shift()] });
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: paths.scenePath });
      dialog.showMessageBoxSync = () => 1;
    }, { audioPath, invalidPath, scenePath });
    const importButton = assets.getByRole('button', { name: 'Import Assets', exact: true });
    await importButton.click();
    await expect(assets.getByText('4 assets', { exact: true })).toBeVisible();
    await importButton.click();
    await expect(page.getByRole('alert')).toContainText('Could not import assets');
    await expect(assets.getByText('4 assets', { exact: true })).toBeVisible();
    await assets.getByRole('button', { name: /^Assign project\/.+\/drop preview\.png$/ }).click();
    await page.getByRole('button', { name: 'Save Scene', exact: true }).click();
    await expect(dirty).toHaveCount(0);
    const saved = JSON.parse(await readFile(scenePath, 'utf8'));
    assert.equal(saved.assets.length, 2);
    assert.equal(saved.objects[0].children[0].texture, saved.assets.find(a => a.alias.endsWith('drop preview.png')).alias);
    await rm(imagePath);
    await rm(audioPath);

    await page.getByRole('button', { name: 'New Scene', exact: true }).click();
    await expect(assets.getByText('2 assets', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Open Scene', exact: true }).click();
    await expect(assets.getByText('4 assets', { exact: true })).toBeVisible();
    const imported = assets.locator('article').filter({ hasText: 'drop preview.png' });
    await expect.poll(() => imported.locator('img').evaluate(img => img.naturalWidth)).toBe(48);
    await assets.getByRole('button', { name: /^Preview project\/.+\/opening\.wav$/ }).click();
    await expect(assets.getByText('Playing', { exact: true })).toBeVisible();
  } finally {
    await editor?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('scene gestures, hierarchy drops, and inspector edits are undoable', { timeout: 30_000 }, async () => {
  const profile = await mkdtemp(join(tmpdir(), 'olive-gestures-test-'));
  let editor;
  try {
    editor = await launchEditor(profile);
    await editor.evaluate(({ dialog }) => { dialog.showMessageBoxSync = () => 1; });
    const page = await editor.firstWindow();
    page.setDefaultTimeout(5000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));

    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();
    await expect(page.getByText('2 assets', { exact: true })).toBeVisible();
    await expect.poll(() => page.locator('.asset-card img').evaluate(img => img.naturalWidth)).toBe(48);
    const rect = await canvas.boundingBox();
    const ratio = Math.min(rect.width / 960, rect.height / 540);
    const point = (x, y) => ({
      x: rect.x + (rect.width - 960 * ratio) / 2 + x * ratio,
      y: rect.y + (rect.height - 540 * ratio) / 2 + y * ratio,
    });
    const toolbar = page.getByRole('group', { name: 'Scene Tools' });
    const use = name => toolbar.getByRole('button', { name, exact: true }).click();
    const inspector = page.getByRole('complementary', { name: 'Inspector', exact: true });
    const value = name => inspector.getByRole('spinbutton', { name, exact: true });
    const history = name => page.getByRole('button', { name, exact: true }).click();
    const hierarchy = page.getByRole('complementary', { name: 'Hierarchy', exact: true });
    const object = name => hierarchy.getByRole('button', { name, exact: true });
    const drag = async (from, to) => {
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(to.x, to.y, { steps: 8 });
      await page.mouse.up();
    };

    // Clear the crystal's quick controls before picking the title below it.
    const blank = point(100, 100);
    await page.mouse.click(blank.x, blank.y);
    const title = point(480, 350);
    await page.mouse.click(title.x, title.y);
    await expect(object('Scene Title')).toHaveAttribute('aria-pressed', 'true');
    const origin = point(480, 226);
    await page.mouse.click(origin.x, origin.y);
    await expect(object('Olive Crystal')).toHaveAttribute('aria-pressed', 'true');

    await use('Move');
    const guides = page.getByRole('button', { name: 'Smart Guides', exact: true });
    if (await guides.getAttribute('aria-pressed') === 'true') await guides.click();
    await drag(origin, point(520, 246));
    await expect.poll(async () => Math.abs(Number(await value('Position X').inputValue()) - 520)).toBeLessThan(2);
    await expect.poll(async () => Math.abs(Number(await value('Position Y').inputValue()) - 246)).toBeLessThan(2);
    await history('Undo');
    await expect(value('Position X')).toHaveValue('480');
    await history('Redo');
    assert.ok(Math.abs(Number(await value('Position X').inputValue()) - 520) < 2);
    await history('Undo');
    await expect(value('Position X')).toHaveValue('480');

    await use('Rotate');
    await drag(point(505, 226), point(480, 251));
    await expect.poll(async () => Math.abs(Number(await value('Rotation').inputValue()) - 90)).toBeLessThan(5);
    await history('Undo');
    await expect(value('Rotation')).toHaveValue('0');

    await use('Scale');
    await drag(point(505, 226), point(530, 226));
    assert.ok(Math.abs(Number(await value('Scale X').inputValue()) - 6) < 0.25);
    assert.ok(Math.abs(Number(await value('Scale Y').inputValue()) - 6) < 0.25);
    await history('Undo');
    await expect(value('Scale X')).toHaveValue('3');
    await expect(page.getByRole('img', { name: 'Unsaved changes' })).toHaveCount(0);

    await use('Move');
    await page.mouse.move(origin.x, origin.y);
    await page.mouse.down();
    const far = point(550, 270);
    await page.mouse.move(far.x, far.y, { steps: 5 });
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await expect(value('Position X')).toHaveValue('480');

    const rowButton = name => page.getByRole('button', { name, exact: true });
    const row = name => hierarchy.locator('.tree-row').filter({ has: rowButton(name) });
    const titleRow = await row('Scene Title').boundingBox();
    await row('Olive Crystal').dragTo(row('Scene Title'), { targetPosition: { x: 70, y: titleRow.height - 3 } });
    const ids = async () => hierarchy.locator('.tree-object span').allTextContents();
    assert.deepEqual(await ids(), ['Scene Group', 'Scene Title', 'Olive Crystal']);
    await history('Undo');
    assert.deepEqual(await ids(), ['Scene Group', 'Olive Crystal', 'Scene Title']);

    await row('Olive Crystal').dragTo(hierarchy.getByRole('button', { name: 'Scene Root' }));
    await expect(hierarchy.locator('.panel-body > .object-list > li > .tree-row').filter({ has: rowButton('Olive Crystal') })).toHaveCount(1);
    await row('Olive Crystal').dragTo(row('Scene Group'));
    await expect(hierarchy.locator('.object-list .object-list .tree-row').filter({ has: rowButton('Olive Crystal') })).toHaveCount(1);
    assert.deepEqual(await ids(), ['Scene Group', 'Scene Title', 'Olive Crystal']);
    await history('Undo');
    await expect(hierarchy.locator('.panel-body > .object-list > li > .tree-row').filter({ has: rowButton('Olive Crystal') })).toHaveCount(1);
    await object('Scene Group').click();
    const add = page.getByRole('button', { name: 'Add Sprite', exact: true });
    await add.click();
    await expect(object('Sprite')).toBeVisible();
    await history('Undo');
    await expect(object('Sprite')).toHaveCount(0);
    await history('Redo');
    await expect(object('Sprite')).toHaveAttribute('aria-pressed', 'true');

    const xInput = value('Position X');
    await xInput.fill('200');
    await xInput.press('Enter');
    await history('Undo');
    await expect(xInput).toHaveValue('32');
    await history('Redo');
    await expect(xInput).toHaveValue('200');

    await page.getByRole('button', { name: 'Assign images/olive-crystal.png' }).click();
    await inspector.locator('summary[data-tip=Texture]').click();
    const textureInput = inspector.getByRole('button', { name: 'Texture', exact: true });
    await expect(textureInput).toHaveAttribute('value', 'images/olive-crystal.png');
    await history('Undo');
    await expect(textureInput).toHaveAttribute('value', '');
    await history('Redo');
    await expect(textureInput).toHaveAttribute('value', 'images/olive-crystal.png');

    await page.getByRole('button', { name: 'Delete Selected Object' }).click();
    await expect(object('Sprite')).toHaveCount(0);
    await history('Undo');
    await expect(object('Sprite')).toHaveAttribute('aria-pressed', 'true');
    await history('Redo');
    await expect(object('Sprite')).toHaveCount(0);
    assert.deepEqual(errors, []);
  } finally {
    await editor?.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test('asset browser organizes portable assets and drops centered sprites', { timeout: 35_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'olive-asset-browser-'));
  const scenePath = join(directory, 'organized.json');
  const imagePath = join(directory, 'forest.png');
  const audioPath = join(directory, 'unused.wav');
  let editor;
  try {
    await writeFile(imagePath, await readFile(new URL('../raw-assets/images{m}/olive-crystal.png', import.meta.url)));
    await writeFile(audioPath, await readFile(new URL('../raw-assets/sounds{m}/chime.wav', import.meta.url)));
    editor = await launchEditor(join(directory, 'profile'));
    await editor.evaluate(({ dialog }, paths) => {
      const open = [[paths.imagePath, paths.audioPath], [paths.scenePath]];
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: open.shift() });
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: paths.scenePath });
      dialog.showMessageBoxSync = () => 1;
    }, { imagePath, audioPath, scenePath });

    const page = await editor.firstWindow();
    page.setDefaultTimeout(5000);
    const panel = page.getByRole('region', { name: 'Assets', exact: true });
    const tree = panel.getByRole('navigation', { name: 'Asset Folders' });
    const folder = name => tree.getByRole('button', { name, exact: true });
    const asset = name => panel.locator('.asset-items').getByRole('button', { name, exact: true });
    const undo = () => page.getByRole('button', { name: 'Undo', exact: true }).click();
    const redo = () => page.getByRole('button', { name: 'Redo', exact: true }).click();
    const create = async name => {
      await panel.getByRole('button', { name: 'New Folder', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'New Folder' });
      await dialog.getByLabel('Folder Name').fill(name);
      await dialog.getByRole('button', { name: 'Apply' }).click();
      await expect(folder(name)).toBeVisible();
    };
    const context = async (target, action) => {
      await target.click({ button: 'right' });
      await panel.locator('.asset-context').getByRole('button', { name: action, exact: true }).click();
    };
    await expect(panel.getByText('2 assets', { exact: true })).toBeVisible();
    await folder('Project').click();
    await create('Art');
    await create('Textures');
    await create('Empty');

    await folder('Art').click();
    await panel.getByRole('button', { name: 'Import Assets' }).click();
    await expect(asset('forest.png')).toBeVisible();
    await expect(asset('unused.wav')).toBeVisible();
    const path = panel.getByRole('navigation', { name: 'Destination Folder' });
    await expect(path).toContainText('Project');
    await expect(path).toContainText('Art');
    await panel.getByRole('button', { name: 'List View' }).click();
    await expect(panel.locator('.asset-items')).toHaveAttribute('data-layout', 'list');
    const filter = panel.getByRole('combobox', { name: 'Asset Type' });
    await filter.selectOption('audio');
    await expect(asset('forest.png')).toHaveCount(0);
    await expect(asset('unused.wav')).toBeVisible();
    await filter.selectOption('all');
    const search = panel.getByRole('searchbox', { name: 'Search assets' });
    await search.fill('textures');
    await expect(panel.getByText('No assets match this search.')).toBeVisible();
    await search.fill('art/forest');
    await expect(asset('forest.png')).toBeVisible();
    await search.clear();
    await asset('forest.png').click();
    const inspector = page.getByRole('complementary', { name: 'Inspector' });
    await expect(inspector.getByRole('region', { name: 'Asset Preview' })).toContainText('48 × 48 px');
    await inspector.getByRole('button', { name: 'Assign Texture', exact: true }).click();

    await context(asset('forest.png'), 'Rename');
    const rename = page.getByRole('dialog', { name: 'Rename' });
    await rename.getByLabel('Asset Name').fill('Sapling');
    await rename.getByRole('button', { name: 'Apply' }).click();
    await expect(asset('Sapling.png')).toBeVisible();
    await asset('Sapling.png').locator('..').dragTo(folder('Textures'));
    await expect(asset('Sapling.png')).toHaveCount(0);
    await folder('Textures').click();
    await expect(asset('Sapling.png')).toBeVisible();

    await context(asset('Sapling.png'), 'Delete');
    await expect(panel.getByRole('alert')).toContainText('Used by Olive Crystal');
    await expect(asset('Sapling.png')).toBeVisible();

    await folder('Art').click();
    page.once('dialog', dialog => dialog.accept());
    await context(asset('unused.wav'), 'Delete');
    await expect(asset('unused.wav')).toHaveCount(0);
    await undo();
    await expect(asset('unused.wav')).toBeVisible();
    await redo();
    await expect(asset('unused.wav')).toHaveCount(0);
    page.once('dialog', dialog => dialog.accept());
    await context(folder('Empty'), 'Delete');
    await expect(folder('Empty')).toHaveCount(0);
    await undo();
    await expect(folder('Empty')).toBeVisible();

    await page.getByRole('button', { name: 'Save Scene', exact: true }).click();
    await expect(page.getByRole('img', { name: 'Unsaved changes' })).toHaveCount(0);
    const saved = JSON.parse(await readFile(scenePath, 'utf8'));
    const alias = saved.assets[0].alias;
    assert.equal(saved.objects[0].children[0].texture, alias);
    assert.equal(saved.assetLibrary.entries[0].name, 'Sapling.png');
    await page.getByRole('button', { name: 'Open Scene', exact: true }).click();
    await expect(panel.locator('.asset-items')).toHaveAttribute('data-layout', 'list');
    await folder('Textures').click();
    await expect(asset('Sapling.png')).toBeVisible();
    await page.getByRole('button', { name: 'Olive Crystal', exact: true }).click();
    await inspector.locator('summary[data-tip=Texture]').click();
    await expect(inspector.getByRole('button', { name: 'Texture', exact: true })).toHaveAttribute('value', alias);

    const canvas = page.locator('canvas');
    const bounds = await canvas.boundingBox();
    const ratio = Math.min(bounds.width / 960, bounds.height / 540);
    const coordinates = (x, y) => ({
      x: (bounds.width - 960 * ratio) / 2 + x * ratio,
      y: (bounds.height - 540 * ratio) / 2 + y * ratio,
    });
    for (const [x, y] of [[225, 185], [480, 226]]) {
      await asset('Sapling.png').locator('..').dragTo(canvas, { targetPosition: coordinates(x, y) });
      await expect(page.getByRole('complementary', { name: 'Hierarchy' })
        .getByRole('button', { name: 'Sapling.png', exact: true })).toHaveAttribute('aria-pressed', 'true');
      const positionX = Number(await inspector.getByRole('spinbutton', { name: 'Position X' }).inputValue());
      const positionY = Number(await inspector.getByRole('spinbutton', { name: 'Position Y' }).inputValue());
      assert.ok(Math.abs(positionX - x) < 3 && Math.abs(positionY - y) < 3);
      await undo();
      await expect(page.getByRole('complementary', { name: 'Hierarchy' })
        .getByRole('button', { name: 'Sapling.png', exact: true })).toHaveCount(0);
    }
    const resize = page.getByRole('separator', { name: 'Resize Assets Panel' });
    await resize.focus();
    const initial = Number(await resize.getAttribute('aria-valuenow'));
    await resize.press('ArrowUp');
    await expect(resize).toHaveAttribute('aria-valuenow', String(initial + 4));
    await editor.close();
    editor = undefined;
    editor = await launchEditor(join(directory, 'profile'));
    const reopened = await editor.firstWindow();
    await expect(reopened.locator('.asset-items')).toHaveAttribute('data-layout', 'list');
    await expect(reopened.getByRole('separator', { name: 'Resize Assets Panel' }))
      .toHaveAttribute('aria-valuenow', String(initial + 4));
  } finally {
    await editor?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('AssetPack exports configured bundles and stable aliases to a new directory', { timeout: 30_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'olive-bundle-test-'));
  const image = join(directory, 'forest.png');
  const sound = join(directory, 'chime.wav');
  const scenePath = join(directory, 'bundles.json');
  let editor;
  try {
    const imageBytes = await readFile(new URL('../raw-assets/images{m}/olive-crystal.png', import.meta.url));
    const soundBytes = await readFile(new URL('../raw-assets/sounds{m}/chime.wav', import.meta.url));
    await writeFile(image, imageBytes);
    await writeFile(sound, soundBytes);
    editor = await launchEditor(join(directory, 'profile'));
    await editor.evaluate(({ dialog }, paths) => {
      const files = [[paths.image, paths.sound], [paths.directory], [paths.scenePath]];
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: files.shift() });
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: paths.scenePath });
      dialog.showMessageBoxSync = () => 1;
    }, { image, sound, directory, scenePath });

    const page = await editor.firstWindow();
    page.setDefaultTimeout(5000);
    const panel = page.getByRole('region', { name: 'Assets', exact: true });
    const bundles = page.getByRole('region', { name: 'Asset Bundles', exact: true });
    const openBundles = async () => {
      if (!await bundles.isVisible()) await panel.getByRole('button', { name: 'Asset Bundles', exact: true }).click();
      await expect(panel).toBeVisible();
      await expect(bundles).toBeVisible();
    };
    const openSave = name => page.getByRole('button', { name, exact: true }).click();
    await panel.getByRole('button', { name: 'Import Assets' }).click();
    await expect(panel.getByText('4 assets', { exact: true })).toBeVisible();
    await openBundles();

    const input = bundles.getByLabel('Bundle Name');
    await input.fill('UI-Icons');
    await bundles.getByRole('button', { name: 'Create Bundle' }).click();
    await expect(bundles.getByText('ui-icons', { exact: true })).toBeVisible();
    await input.fill('ui-icons');
    await bundles.getByRole('button', { name: 'Create Bundle' }).click();
    await expect(bundles.getByRole('alert')).toContainText('A bundle already uses that name.');
    await bundles.getByRole('button', { name: 'Close Asset Bundles Panel' }).click();

    await panel.getByRole('button', { name: 'forest.png', exact: true }).click();
    const membership = page.getByRole('complementary', { name: 'Inspector' }).getByRole('combobox', { name: 'Asset Bundle', exact: true });
    await membership.selectOption({ label: 'ui-icons' });
    const id = await membership.inputValue();
    await openSave('Undo');
    await expect(membership).toHaveValue('');
    await openSave('Redo');
    await expect(membership).toHaveValue(id);

    await openBundles();
    await bundles.getByRole('button', { name: 'Rename ui-icons Bundle' }).click();
    await input.fill('interface');
    await bundles.getByRole('button', { name: 'Apply' }).click();
    await expect(bundles.locator('.bundle-row').filter({ hasText: 'interface' })).toContainText('1 asset');
    await bundles.getByRole('button', { name: 'Export Bundles' }).click();
    const result = bundles.getByRole('status');
    await expect(result).toContainText('Exported to');
    const output = (await result.textContent()).replace(/^Exported to /, '');
    assert.equal(output.startsWith(join(directory, 'assetpack-')), true);
    const manifest = JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8'));
    const named = manifest.bundles.find(bundle => bundle.name === 'interface');
    const unassigned = manifest.bundles.find(bundle => bundle.name === 'default');
    assert.equal(manifest.bundles.length, 2);
    assert.equal(named.assets.length, 1);
    assert.equal(unassigned.assets.length, 1);
    assert.match(named.assets[0].alias[0], /^project\/.+\/forest\.png$/);
    assert.match(unassigned.assets[0].alias[0], /^project\/.+\/chime\.wav$/);
    assert.deepEqual(await readFile(join(output, named.assets[0].src[0])), imageBytes);
    assert.deepEqual(await readFile(join(output, unassigned.assets[0].src[0])), soundBytes);

    await bundles.getByRole('button', { name: 'Delete interface Bundle' }).click();
    await expect(bundles.getByText('interface', { exact: true })).toHaveCount(0);
    await bundles.getByRole('button', { name: 'Close Asset Bundles Panel' }).click();
    await expect(membership).toHaveValue('');
    await openSave('Undo');
    await expect(membership).toHaveValue(id);
    await openSave('Save Scene');
    await expect(page.getByText('bundles.json', { exact: true })).toBeVisible();
    await openSave('Open Scene');
    await panel.getByRole('button', { name: 'forest.png', exact: true }).click();
    await expect(membership.locator('option:checked')).toHaveText('interface');
    const saved = JSON.parse(await readFile(scenePath, 'utf8'));
    assert.equal(saved.assetLibrary.bundles[0].id, id);
    assert.equal(saved.assetLibrary.entries.find(entry => entry.alias === named.assets[0].alias[0]).bundleId, id);

    await panel.getByRole('navigation', { name: 'Asset Folders' }).getByRole('button', { name: 'Project', exact: true }).click();
    const forest = panel.getByRole('button', { name: 'forest.png', exact: true });
    const chime = panel.getByRole('button', { name: 'chime.wav', exact: true });
    await forest.click();
    await chime.click({ modifiers: ['Shift'] });
    await expect(panel.getByText('2 assets selected', { exact: true })).toBeVisible();
    await expect(membership).toHaveValue('mixed');
    await expect(bundles).toHaveCount(0);
    await forest.click({ button: 'right' });
    await panel.locator('.asset-context').getByRole('button', { name: 'Send to Bundle', exact: true }).click();
    await panel.getByRole('group', { name: 'Bundle Destinations' }).getByRole('button', { name: 'interface', exact: true }).click();
    await expect(panel.getByText('Assigned to interface.')).toBeVisible();
    await expect(membership).toHaveValue(id);
    await openBundles();
    await expect(bundles.getByText('Project assets ready to assign: 2')).toBeVisible();
    await expect(bundles.locator('.bundle-row').filter({ hasText: 'interface' })).toContainText('2 assets');
    await bundles.getByRole('button', { name: 'Close Asset Bundles Panel' }).click();
    await expect(membership).toHaveValue(id);
    await openSave('Undo');
    await expect(membership).toHaveValue('mixed');
    await openSave('Redo');
    await expect(membership).toHaveValue(id);

    await chime.click({ modifiers: [process.platform === 'darwin' ? 'Meta' : 'Control'] });
    await expect(chime).toHaveAttribute('aria-pressed', 'false');
    await panel.getByRole('button', { name: 'Select Multiple Assets' }).click();
    await panel.getByRole('checkbox', { name: 'Select chime.wav' }).check();
    await expect(panel.getByText('2 assets selected', { exact: true })).toBeVisible();
    await chime.click({ button: 'right' });
    await panel.locator('.asset-context').getByRole('button', { name: 'Send to Bundle', exact: true }).click();
    await panel.getByRole('group', { name: 'Bundle Destinations' }).getByRole('button', { name: 'New Bundle…', exact: true }).click();
    await expect(bundles).toBeVisible();
    await expect(input).toBeFocused();
    await input.fill('gameplay');
    await expect(bundles.getByRole('checkbox', { name: 'Add the selected assets to the new bundle' })).toBeChecked();
    await bundles.getByRole('button', { name: 'Create Bundle' }).click();
    await expect(bundles.locator('.bundle-row').filter({ hasText: 'gameplay' })).toContainText('2 assets');
    await bundles.getByRole('button', { name: 'Close Asset Bundles Panel' }).click();
    await openSave('Undo');
    await expect(membership.locator('option:checked')).toHaveText('interface');
    await expect(membership.locator('option').filter({ hasText: 'gameplay' })).toHaveCount(0);
  } finally {
    await editor?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('bundle JSON rows accept drops, show their members, and reveal files in Assets', { timeout: 20_000 }, async () => {
  const profile = await mkdtemp(join(tmpdir(), 'olive-value-drop-'));
  const image = join(profile, 'forest.png');
  const audio = join(profile, 'wind.wav');
  let editor;
  try {
    await Promise.all([
      readFile(new URL('../raw-assets/images{m}/olive-crystal.png', import.meta.url)).then(data => writeFile(image, data)),
      readFile(new URL('../raw-assets/sounds{m}/chime.wav', import.meta.url)).then(data => writeFile(audio, data)),
    ]);
    editor = await launchEditor(profile);
    await editor.evaluate(({ dialog }, paths) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: paths });
      dialog.showMessageBoxSync = () => 1;
    }, [image, audio]);
    const page = await editor.firstWindow();
    page.setDefaultTimeout(5000);
    const button = (scope, name) => scope.getByRole('button', { name, exact: true });
    const assets = page.getByRole('region', { name: 'Assets', exact: true });
    const bundles = page.getByRole('region', { name: 'Asset Bundles', exact: true });
    const asset = name => button(assets, name).locator('..');

    await button(assets, 'Import Assets').click();
    await expect(button(assets, 'wind.wav')).toBeVisible();
    if (!await bundles.isVisible()) await button(assets, 'Asset Bundles').click();
    await bundles.getByLabel('Bundle Name').fill('gameplay');
    await button(bundles, 'Create Bundle').click();
    const bundleRow = bundles.getByRole('listitem').filter({ hasText: 'gameplay' });
    const defaultRow = bundles.getByRole('listitem').filter({ hasText: 'Default' });
    await expect(bundles.locator('.bundle-thumbnail svg')).toHaveCount(2);
    await button(assets, 'forest.png').click();
    await button(assets, 'wind.wav').click({ modifiers: [process.platform === 'darwin' ? 'Meta' : 'Control'] });
    await expect(assets.getByText('2 assets selected', { exact: true })).toBeVisible();
    const bounds = await bundleRow.boundingBox();
    const action = await button(bundleRow, 'Delete gameplay Bundle').boundingBox();
    assert.ok(bounds && action);
    const actionPosition = { x: action.x + action.width / 2 - bounds.x, y: action.y + action.height / 2 - bounds.y };
    await asset('forest.png').dragTo(bundleRow, { targetPosition: actionPosition, steps: 8 });
    await expect(bundleRow).toContainText('2 assets');
    await button(page, 'Undo').click();
    await expect(bundleRow).toContainText('0 assets');
    await button(page, 'Redo').click();
    await expect(bundleRow).toContainText('2 assets');
    await asset('chime.wav').dragTo(bundleRow, { targetPosition: actionPosition, steps: 8 });
    await expect(bundleRow).toContainText('2 assets');
    await asset('forest.png').dragTo(defaultRow, { targetPosition: { x: 42, y: 21 }, steps: 8 });
    await expect(bundleRow).toContainText('0 assets');

    const gameplay = button(bundleRow, 'gameplay');
    await gameplay.click();
    await expect(bundleRow.getByText('No assets in this bundle.')).toBeVisible();
    await gameplay.click();
    await expect(gameplay).toHaveAttribute('aria-expanded', 'false');

    const defaultBundle = button(defaultRow, 'Default');
    const members = defaultRow.getByRole('list', { name: 'Assets in Default', exact: true });
    await expect(members).toBeHidden();
    await defaultBundle.click();
    await expect(defaultBundle).toHaveAttribute('aria-expanded', 'true');
    await expect(members.getByRole('button')).toHaveText(['forest.png', 'wind.wav']);
    await assets.getByRole('combobox', { name: 'Asset Type' }).selectOption('image');
    await assets.getByRole('searchbox', { name: 'Search assets' }).fill('forest');
    await expect(button(assets, 'wind.wav')).toBeHidden();
    await button(assets, 'Minimize Assets Panel').click();
    await expect(assets).toBeHidden();
    await button(members, 'wind.wav').click();
    await expect(button(assets, 'wind.wav')).toHaveAttribute('aria-pressed', 'true');
    await expect(button(assets, 'wind.wav')).toBeFocused();
    await expect(button(assets, 'wind.wav')).toBeInViewport();
    await expect(assets.getByRole('searchbox', { name: 'Search assets' })).toHaveValue('');
    await expect(assets.getByRole('combobox', { name: 'Asset Type' })).toHaveValue('all');
    await defaultBundle.click();
    await expect(members).toBeHidden();
  } finally {
    await editor?.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test('panel drops assign compatible values to object, timeline and script fields', { timeout: 30_000 }, async () => {
  const profile = await mkdtemp(join(tmpdir(), 'olive-reference-drop-'));
  const image = join(profile, 'forest.png');
  let editor;
  try {
    await writeFile(image, await readFile(new URL('../raw-assets/images{m}/olive-crystal.png', import.meta.url)));
    editor = await launchEditor(profile);
    await editor.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
      dialog.showMessageBoxSync = () => 1;
    }, image);
    const page = await editor.firstWindow();
    page.setDefaultTimeout(5000);
    const button = (scope, name) => scope.getByRole('button', { name, exact: true });
    const assets = page.getByRole('region', { name: 'Assets', exact: true });
    const hierarchy = page.getByRole('complementary', { name: 'Hierarchy' });
    const inspector = page.getByRole('complementary', { name: 'Inspector' });
    const asset = name => button(assets, name).locator('..');
    const object = name => button(hierarchy, name);
    const row = name => object(name).locator('..');
    const openPanel = async name => {
      await button(page, 'Panels').click();
      await page.getByRole('checkbox', { name, exact: true }).check();
      await page.keyboard.press('Escape');
    };
    await button(assets, 'Import Assets').click();
    await button(assets, 'forest.png').click();
    await asset('forest.png').dragTo(row('Olive Crystal'), { steps: 8 });
    const texture = inspector.locator('.texture-trigger');
    if (!await texture.isVisible()) await inspector.locator('details[data-inspector-section="texture"] > summary').click();
    await expect(texture).toContainText('forest.png');
    await asset('chime.wav').dragTo(texture, { steps: 8 });
    await expect(texture).toContainText('forest.png');
    await asset('olive-crystal.png').dragTo(texture, { steps: 8 });
    await expect(texture).toContainText('olive-crystal.png');

    await button(hierarchy, 'Camera 2D').click();
    const target = inspector.getByRole('combobox', { name: 'Follow Target' });
    await row('Olive Crystal').dragTo(target, { steps: 8 });
    await expect(target.locator('option:checked')).toHaveText('Olive Crystal');

    await openPanel('Timeline');
    await object('Olive Crystal').click();
    await object('Scene Title').click({ modifiers: ['Shift'] });
    const timeline = page.getByRole('region', { name: 'Timeline', exact: true });
    await row('Olive Crystal').dragTo(timeline.getByRole('combobox', { name: 'Tween property' }), { steps: 8 });
    const tracks = timeline.getByRole('combobox', { name: 'Track', exact: true }).locator('option');
    await expect(tracks).toHaveCount(2);
    await expect(tracks).toHaveText([/Olive Crystal/, /Scene Title/]);

    await openPanel('Scripts');
    const scripts = page.getByTestId('scripts-panel');
    await button(scripts, 'New script').click();
    await scripts.locator('.value-drag-handle').dragTo(scripts.getByTestId('scene-script').locator('summary'), { steps: 8 });
    const sceneScript = scripts.getByRole('combobox', { name: 'Scene script', exact: true });
    await expect(sceneScript.locator('option:checked')).toHaveText('Script');
  } finally {
    await editor?.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test('asset Inspector previews animation files and creates portable scene objects', { timeout: 45_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'olive-animation-test-'));
  const file = name => join(directory, name);
  const sceneFile = file('animations.json');
  const canvasLabel = 'Animation preview';
  let editor;
  try {
    const rig = new URL('../../../modules/spine/testdata/', import.meta.url);
    const image = await readFile(new URL('../raw-assets/images{m}/olive-crystal.png', import.meta.url));
    const rigJson = await readFile(new URL('rig.json', rig), 'utf8');
    const rigAtlas = (await readFile(new URL('rig.atlas', rig), 'utf8')).replaceAll('64', '48').replace('rig.png', 'textures/spine/rig.png');
    const pageFile = 'textures/spine/rig.png';
    await mkdir(file('textures/spine'), { recursive: true });
    const frame = x => ({
      frame: { x, y: 0, w: 24, h: 48 }, rotated: false, trimmed: false,
      sourceSize: { w: 24, h: 48 }, spriteSourceSize: { x: 0, y: 0, w: 24, h: 48 },
    });
    await Promise.all([
      writeFile(file('rig.json'), rigJson),
      writeFile(file('shared-textures.atlas'), rigAtlas),
      writeFile(file('wrong-atlas.json'), rigJson),
      writeFile(file('wrong-atlas.atlas'), rigAtlas.replace('\ntile\n', '\nother\n')),
      writeFile(file('other.atlas'), ''),
      writeFile(file(pageFile), image),
      writeFile(file('sheet.png'), image),
      writeFile(file('missing.json'), JSON.stringify({ frames: { left: frame(0) }, meta: { image: 'missing.png' } })),
      writeFile(file('sheet.json'), JSON.stringify({
        frames: { left: frame(0), right: frame(24) },
        animations: { walk: ['left', 'right'], idle: ['left'] },
        meta: { image: 'sheet.png', scale: '1', size: { w: 48, h: 48 } },
      })),
    ]);
    editor = await launchEditor(file('profile'));
    await editor.evaluate(({ dialog }, paths) => {
      const selections = [[paths.missing], [paths.mismatched], paths.assets, [paths.ambiguous], [paths.directory], [paths.sceneFile]];
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: selections.shift() });
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: paths.sceneFile });
      dialog.showMessageBoxSync = () => 1;
    }, { missing: file('missing.json'), mismatched: file('wrong-atlas.json'), ambiguous: file('ambiguous.json'),
      assets: ['rig.json', pageFile, 'sheet.json', 'sheet.png'].map(file), directory, sceneFile });

    const page = await editor.firstWindow();
    page.setDefaultTimeout(5000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const panel = page.getByRole('region', { name: 'Assets', exact: true });
    const inspector = page.getByRole('complementary', { name: 'Inspector' });
    const hierarchy = page.getByRole('complementary', { name: 'Hierarchy' });
    const preview = inspector.getByRole('region', { name: 'Asset Preview' });
    const asset = name => panel.locator('.asset-items').getByRole('button', { name, exact: true });
    const object = name => hierarchy.getByRole('button', { name, exact: true });
    const button = (scope, name) => scope.getByRole('button', { name, exact: true });
    const combo = (scope, name) => scope.getByRole('combobox', { name, exact: true });
    const stage = page.getByRole('region', { name: 'Scene', exact: true }).locator('canvas');

    await asset('chime.wav').click();
    await button(preview, 'Play Audio').click();
    await expect(button(preview, 'Stop Audio')).toBeEnabled();
    await button(preview, 'Stop Audio').click();
    await button(panel, 'Import Assets').click();
    await expect(page.getByRole('alert')).toContainText('missing.png');
    await expect(panel.getByText('2 assets', { exact: true })).toBeVisible();
    await button(panel, 'Import Assets').click();
    await expect(page.getByRole('alert')).toContainText('Could not load wrong-atlas.json with wrong-atlas.atlas');
    await expect(panel.getByText('2 assets', { exact: true })).toBeVisible();
    await button(panel, 'Import Assets').click();
    await expect(panel.getByText('4 assets', { exact: true })).toBeVisible();
    await Promise.all([writeFile(file('ambiguous.json'), rigJson), writeFile(file('another-match.atlas'), rigAtlas)]);
    await button(panel, 'Import Assets').click();
    await expect(page.getByRole('alert')).toContainText('More than one atlas matches ambiguous.json');
    await expect(panel.getByText('4 assets', { exact: true })).toBeVisible();
    await combo(panel, 'Asset Type').selectOption('animated');
    await expect(asset('chime.wav')).toHaveCount(0);
    await asset('rig.json').click();
    await expect(preview.locator(`canvas[aria-label="${canvasLabel}"]`)).toBeVisible();
    await combo(preview, 'Skin').selectOption('warm');
    await combo(preview, 'Animation').selectOption('still');
    await button(preview, 'Play Animation').click();
    await button(preview, 'Pause Animation').click();
    await button(preview, 'Stop Animation').click();
    await preview.getByRole('checkbox', { name: 'Loop', exact: true }).uncheck();

    await button(preview, 'Add to Scene').click();
    await expect(object('rig.json')).toHaveAttribute('aria-pressed', 'true');
    await expect(preview).toHaveCount(0);
    await expect(combo(inspector, 'Skin')).toHaveValue('warm');
    await expect(combo(inspector, 'Animation')).toHaveValue('still');
    await combo(inspector, 'Animation').selectOption('sway');
    const playing = inspector.getByRole('checkbox', { name: 'Play in Scene' });
    await expect(playing).toBeChecked();
    const firstFrame = await stage.screenshot();
    await page.waitForTimeout(220);
    assert.deepEqual(await stage.screenshot(), firstFrame);
    await playing.uncheck();
    const pausedFrame = await stage.screenshot();
    assert.deepEqual(await stage.screenshot(), pausedFrame);

    await asset('sheet.json').click();
    await expect(preview.locator(`canvas[aria-label="${canvasLabel}"]`)).toBeVisible();
    await expect(combo(preview, 'Animation')).toHaveValue('walk');
    await button(preview, 'Play Animation').click();
    await button(preview, 'Stop Animation').click();
    await combo(preview, 'Animation').selectOption('idle');
    await asset('sheet.json').locator('..').dragTo(stage);
    await expect(object('sheet.json')).toHaveAttribute('aria-pressed', 'true');
    await combo(inspector, 'Animation').selectOption('walk');
    const editFrame = await stage.screenshot();
    await page.waitForTimeout(220);
    assert.deepEqual(await stage.screenshot(), editFrame);
    await button(page, 'Play Game').click();
    await expect(page.getByRole('tab', { name: 'Live', exact: true })).toHaveAttribute('aria-selected', 'true');
    const liveCanvas = page.locator('#viewport-pane-live canvas');
    const liveFrame = await liveCanvas.screenshot();
    await expect.poll(async () => (await liveCanvas.screenshot()).equals(liveFrame)).toBe(false);
    await asset('sheet.json').click();
    await button(preview, 'Play Animation').click();
    await expect(button(preview, 'Pause Animation')).toBeVisible();
    await page.getByRole('tab', { name: 'Edit', exact: true }).click();
    await expect(button(preview, 'Play Animation')).toBeEnabled();
    await button(preview, 'Play Animation').click();
    await page.getByRole('tab', { name: 'Live', exact: true }).click();
    await expect(button(preview, 'Play Animation')).toBeEnabled();
    await button(preview, 'Play Animation').click();
    await expect(button(preview, 'Pause Animation')).toBeVisible();
    await button(page, 'Stop Game').click();
    await object('sheet.json').click();
    await combo(inspector, 'Animation').selectOption('idle');

    for (const name of ['Graphics', 'Bitmap Text', 'Tiling Sprite', 'Nine-Slice Sprite', 'Tilemap',
      'Mesh Plane', 'Mesh Rope', 'Particles', 'Animated Sprite', 'Spine']) {
      await button(hierarchy, 'More Objects').click();
      await button(hierarchy, `Add ${name}`).click();
      await expect(object(name)).toHaveAttribute('aria-pressed', 'true');
    }
    await object('Graphics').click();
    await combo(inspector, 'Shape').selectOption('ellipse');
    await object('Tilemap').click();
    await button(inspector, 'Texture').click();
    await button(page.getByRole('dialog', { name: 'Choose a texture' }), 'olive-crystal.png').click();
    const tiles = inspector.getByRole('textbox', { name: 'Tile Indices' });
    await tiles.fill('0, 4, -1, 8');
    await tiles.blur();
    await object('Particles').click();
    await playing.uncheck();
    await object('Mesh Rope').click();
    const bend = inspector.getByRole('spinbutton', { name: 'Bend' });
    await bend.fill('36');
    await bend.press('Enter');
    await button(page, 'Save Scene').click();
    await expect(page.getByRole('img', { name: 'Unsaved changes' })).toHaveCount(0);
    const saved = JSON.parse(await readFile(sceneFile, 'utf8'));
    assert.deepEqual(saved.assets.map(asset => asset.media.kind), ['spine', 'sheet']);
    assert.deepEqual(saved.assets[0].media.files.map(asset => asset.name), ['rig.atlas', pageFile]);
    assert.equal(saved.objects.find(node => node.label === 'rig.json').skin, 'warm');
    assert.equal(saved.objects.find(node => node.label === 'rig.json').loop, false);
    assert.equal(saved.objects.find(node => node.label === 'sheet.json').animation, 'idle');
    assert.equal(saved.objects.find(node => node.type === 'Graphics').shape, 'ellipse');
    assert.deepEqual(saved.objects.find(node => node.type === 'Tilemap').tiles, [0, 4, -1, 8]);
    assert.equal(saved.objects.find(node => node.type === 'Particles').playing, false);
    assert.equal(saved.objects.find(node => node.type === 'MeshRope').bend, 36);

    const bundles = page.getByRole('region', { name: 'Asset Bundles', exact: true });
    if (!await bundles.isVisible()) await button(panel, 'Asset Bundles').click();
    await button(bundles, 'Export Bundles').click();
    const exported = bundles.getByRole('status');
    await expect(exported).toContainText('Exported to');
    const destination = (await exported.textContent()).replace(/^Exported to /, '');
    const manifest = JSON.parse(await readFile(join(destination, 'manifest.json'), 'utf8'));
    const atlas = manifest.bundles[0].assets.find(asset => asset.alias[0].endsWith('/rig.atlas'));
    assert.ok(atlas);
    assert.ok((await readFile(join(destination, atlas.src[0]))).includes(pageFile));
    assert.deepEqual(await readFile(join(destination, atlas.src[0], '..', pageFile)), image);
    await Promise.all(['rig.json', 'shared-textures.atlas', pageFile, 'sheet.json', 'sheet.png'].map(name => rm(file(name))));

    await button(page, 'New Scene').click();
    await button(page, 'Open Scene').click();
    await object('rig.json').click();
    await expect(combo(inspector, 'Skin')).toHaveValue('warm');
    await asset('rig.json').click();
    await expect(preview.locator(`canvas[aria-label="${canvasLabel}"]`)).toBeVisible();
    assert.deepEqual(errors, []);
  } finally {
    await editor?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('Particle Inspector migrates legacy settings and previews a saved Aperion burst', { timeout: 30_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'olive-particles-test-'));
  const scenePath = join(directory, 'particles.json');
  let editor;
  try {
    await writeFile(scenePath, JSON.stringify({ version: 1, objects: [{
      type: 'Particles', id: 'existing-emitter', label: 'Existing Emitter', position: { x: 480, y: 270 },
      count: 36, lifetime: 2, speed: 85, size: 9, direction: -90, spread: 45, playing: false,
    }] }));
    editor = await launchEditor(join(directory, 'profile'));
    await editor.evaluate(({ dialog }, scenePath) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [scenePath] });
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: scenePath });
      dialog.showMessageBoxSync = () => 1;
    }, scenePath);

    const page = await editor.firstWindow();
    page.setDefaultTimeout(5000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const inspector = page.getByRole('complementary', { name: 'Inspector' });
    const stage = page.getByRole('region', { name: 'Scene', exact: true }).locator('canvas');
    const playing = inspector.getByRole('checkbox', { name: 'Play in Scene' });
    const mode = inspector.getByRole('combobox', { name: 'Emission Mode' });
    const restart = inspector.getByRole('button', { name: 'Restart Particle Preview' });
    const dirty = page.getByRole('img', { name: 'Unsaved changes' });
    const button = name => page.getByRole('button', { name, exact: true });
    const numeric = name => inspector.getByRole('spinbutton', { name, exact: true });
    const setNumber = async (name, value) => {
      const input = numeric(name);
      await input.fill(String(value));
      await input.press('Enter');
    };

    await button('Open Scene').click();
    await button('Existing Emitter').click();
    await expect(mode).toHaveValue('continuous');
    await expect(numeric('Particle Count')).toHaveValue('36');
    await expect(playing).not.toBeChecked();
    await expect(restart).toBeDisabled();
    await mode.selectOption('burst');
    await setNumber('Particles per Wave', 24);
    await inspector.locator('summary[data-tip="Spawn Shape"]').click();
    await inspector.getByRole('combobox', { name: 'Shape Type' }).selectOption('circle');
    await setNumber('Radius', 30);
    await inspector.locator('summary[data-tip="Particle Motion"]').click();
    await setNumber('Gravity', 120);

    const still = await stage.screenshot();
    await playing.check();
    await expect.poll(async () => (await stage.screenshot()).equals(still)).toBe(false);
    await playing.uncheck();
    const paused = await stage.screenshot();
    assert.deepEqual(await stage.screenshot(), paused);
    await playing.check();

    await button('Save Scene').click();
    await expect(dirty).toHaveCount(0);
    const saved = JSON.parse(await readFile(scenePath, 'utf8')).objects[0];
    assert.equal(saved.emission, 'burst');
    assert.equal(saved.waveSize, 24);
    assert.equal(saved.spawnShape, 'circle');
    assert.equal(saved.spawnRadius, 30);
    assert.equal(saved.gravity, 120);
    assert.equal(saved.speed, 85);
    await restart.click();
    await expect(dirty).toHaveCount(0);
    await button('Delete Selected Object').click();
    await button('Undo').click();
    await button('Existing Emitter').click();
    await expect(mode).toHaveValue('burst');
    assert.deepEqual(errors, []);
  } finally {
    await editor?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('Inspector shows section and field labels and restores the last section per object', { timeout: 30_000 }, async () => {
  const profile = await mkdtemp(join(tmpdir(), 'olive-inspector-test-'));
  let editor;
  try {
    editor = await launchEditor(profile);
    await editor.evaluate(({ dialog }) => { dialog.showMessageBoxSync = () => 1; });
    const page = await editor.firstWindow();
    page.setDefaultTimeout(5000);
    const inspector = page.getByRole('complementary', { name: 'Inspector' });
    const heading = label => inspector.locator('summary').filter({ hasText: label });
    const hierarchy = page.getByRole('complementary', { name: 'Hierarchy' });
    const object = name => hierarchy.getByRole('button', { name, exact: true });
    const panel = page.getByRole('region', { name: 'Assets', exact: true });

    await expect(heading('Transform').getByText('Transform', { exact: true })).toBeVisible();
    await expect(inspector.locator('.property-label').getByText('Position X', { exact: true })).toBeVisible();
    await heading('Texture').click();
    await expect(inspector.getByRole('button', { name: 'Texture', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Add Sprite', exact: true }).click();
    await heading('Appearance').click();
    await inspector.getByRole('checkbox', { name: 'Visibility' }).focus();

    await object('Olive Crystal').click();
    await expect(heading('Texture')).toBeFocused();
    await expect(heading('Texture')).toBeInViewport();
    await expect(inspector.getByRole('button', { name: 'Texture', exact: true })).toBeVisible();
    await panel.getByRole('button', { name: 'olive-crystal.png', exact: true }).click();
    await expect(inspector.getByRole('region', { name: 'Asset Preview' })).toBeVisible();

    await object('Sprite').click();
    await expect(heading('Appearance')).toBeFocused();
    await expect(inspector.getByRole('checkbox', { name: 'Visibility' })).toBeVisible();
    await object('Olive Crystal').click();
    await expect(heading('Texture')).toBeFocused();
  } finally {
    await editor?.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test('panels close, resize, dock into tabs, and restore across launches', { timeout: 30_000 }, async () => {
  const profile = await mkdtemp(join(tmpdir(), 'olive-docks-test-'));
  let editor;
  try {
    editor = await launchEditor(profile);
    let page = await editor.firstWindow();
    page.setDefaultTimeout(5000);
    const inspector = () => page.getByRole('complementary', { name: 'Inspector', exact: true });
    const hierarchy = () => page.getByRole('complementary', { name: 'Hierarchy', exact: true });
    const button = name => page.getByRole('button', { name, exact: true });
    const heading = name => page.getByRole('heading', { name, exact: true });
    const menu = () => page.getByRole('group', { name: 'Panels', exact: true });
    const tab = name => page.getByRole('tab', { name, exact: true });
    await expect(inspector()).toBeVisible();
    await button('Close Inspector Panel').click();
    await expect(inspector()).toBeHidden();
    await button('Panels').click();
    const inspectorToggle = menu().getByRole('checkbox', { name: 'Inspector' });
    const inspectorRow = menu().locator('label').filter({ hasText: /^Inspector$/ });
    await inspectorRow.getByText('Inspector', { exact: true }).click();
    await expect(inspectorToggle).toBeChecked();
    await expect(inspector()).toBeVisible();
    await inspectorRow.locator('svg').click();
    await expect(inspectorToggle).not.toBeChecked();
    const rowBounds = await inspectorRow.boundingBox();
    await inspectorRow.click({ position: { x: rowBounds.width - 3, y: rowBounds.height / 2 } });
    await expect(inspectorToggle).toBeChecked();
    await inspectorToggle.press('Space');
    await expect(inspectorToggle).not.toBeChecked();
    await inspectorToggle.press('Space');
    await expect(inspector()).toBeVisible();
    await inspectorToggle.press('Escape');

    const divider = page.getByRole('separator', { name: 'Resize Left Dock' });
    const initialWidth = (await hierarchy().boundingBox()).width;
    const dividerBounds = await divider.boundingBox();
    await page.mouse.move(dividerBounds.x + dividerBounds.width / 2, dividerBounds.y + 80);
    await page.mouse.down();
    await page.mouse.move(dividerBounds.x + 60, dividerBounds.y + 80, { steps: 5 });
    await page.mouse.up();
    await expect.poll(async () => (await hierarchy().boundingBox()).width).toBeGreaterThan(initialWidth + 30);
    await heading('Inspector').dragTo(heading('Hierarchy'));
    await expect(tab('Inspector')).toHaveAttribute('aria-selected', 'true');
    await expect(hierarchy()).toBeHidden();
    await tab('Inspector').press('ArrowLeft');
    await expect(tab('Hierarchy')).toBeFocused();
    await expect(hierarchy()).toBeVisible();
    await expect(inspector()).toBeHidden();

    await editor.close();
    editor = await launchEditor(profile);
    page = await editor.firstWindow();
    page.setDefaultTimeout(5000);
    await expect(tab('Hierarchy')).toHaveAttribute('aria-selected', 'true');
    await tab('Inspector').click();
    await expect(inspector()).toBeVisible();

    const source = await tab('Inspector').boundingBox();
    await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
    await page.mouse.down();
    await page.mouse.move(source.x + source.width / 2 + 14, source.y + source.height / 2 + 14, { steps: 5 });
    const destination = await page.locator('.dock-destinations [data-dock="right"]').boundingBox();
    assert.ok(destination);
    const x = destination.x + destination.width / 2;
    const y = destination.y + destination.height / 2;
    await page.mouse.move(x, y, { steps: 8 });
    await page.mouse.move(x + 1, y);
    await page.mouse.up();
    await expect(tab('Inspector')).toHaveCount(0);
    await expect(inspector()).toBeVisible();
    await expect(hierarchy()).toBeVisible();
    await expect(page.locator('.dock-pane[data-dock="right"] .inspector')).toBeVisible();

    await button('Panels').click();
    await button('Reset Panel Layout').click();
    await expect(page.getByRole('separator', { name: 'Resize Left Dock' })).toHaveAttribute('aria-valuenow', '18');
  } finally {
    await editor?.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test('scene canvas stays inside its panel when the side docks are widened', { timeout: 15_000 }, async () => {
  const profile = await mkdtemp(join(tmpdir(), 'olive-canvas-docks-test-'));
  let editor;
  try {
    editor = await launchEditor(profile);
    const page = await editor.firstWindow();
    const stage = page.getByRole('region', { name: 'Scene', exact: true });
    await expect(stage.locator('canvas')).toBeVisible();

    const left = page.getByRole('separator', { name: 'Resize Left Dock' });
    const right = page.getByRole('separator', { name: 'Resize Right Dock' });
    for (let step = 0; step < 5; step++) {
      await left.press('ArrowRight');
      await right.press('ArrowLeft');
    }
    await expect(left).toHaveAttribute('aria-valuenow', '35');
    await expect(right).toHaveAttribute('aria-valuenow', '40');

    const bounds = await stage.locator('.stage-area').boundingBox();
    const canvas = await stage.locator('canvas').boundingBox();
    assert.ok(canvas.width > 0 && bounds.height > bounds.width, 'the scene panel is taller than it is wide');
    assert.ok(canvas.x >= bounds.x && canvas.x + canvas.width <= bounds.x + bounds.width);
    assert.ok(canvas.y >= bounds.y && canvas.y + canvas.height <= bounds.y + bounds.height);
  } finally {
    await editor?.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test('Settings edits and saves a mobile portrait PixiJS profile', { timeout: 20_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'olive-settings-test-'));
  const file = join(directory, 'settings.json');
  let editor;
  try {
    editor = await launchEditor(join(directory, 'profile'));
    await editor.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
      dialog.showMessageBoxSync = () => 1;
    }, file);
    const page = await editor.firstWindow();
    page.setDefaultTimeout(5000);
    const settings = page.getByRole('dialog', { name: 'Settings' });
    const button = name => page.getByRole('button', { name, exact: true });
    const canvas = page.getByRole('region', { name: 'Scene', exact: true }).locator('canvas');
    await button('Settings').click();
    const categories = settings.getByRole('navigation', { name: 'Settings categories' });
    await categories.getByRole('button', { name: 'Rendering', exact: true }).click();
    await expect(settings.getByLabel('Resolution', { exact: true })).toBeVisible();
    await expect(settings.getByLabel('Width', { exact: true })).toHaveCount(0);
    const search = settings.getByRole('searchbox', { name: 'Search settings' });
    await search.fill('envelop');
    await expect(settings.getByLabel('Scale Mode')).toBeVisible();
    await expect(settings.getByLabel('Resolution', { exact: true })).toHaveCount(0);
    await search.fill('no-matching-setting');
    await expect(settings.getByRole('status')).toContainText('No settings match your search.');
    await settings.getByRole('button', { name: 'Clear search' }).click();
    await expect(search).toBeFocused();
    await settings.getByRole('button', { name: 'Mobile', exact: true }).click();
    await settings.getByLabel('Orientation').selectOption('portrait');
    const width = settings.getByRole('spinbutton', { name: 'Width', exact: true });
    await expect(width).toHaveAttribute('placeholder', '960');
    for (const [name, value] of [['Width', '400'], ['Height', '800']]) {
      const input = settings.getByRole('spinbutton', { name, exact: true });
      await input.fill(value);
      await input.press('Enter');
    }
    await settings.getByLabel('Scale Mode').selectOption('ENVELOP');
    await settings.getByRole('button', { name: 'Dismiss' }).click();
    const device = page.getByRole('combobox', { name: 'Preview Device', exact: true });
    const orientation = page.getByRole('combobox', { name: 'Preview Orientation', exact: true });
    await expect(device).toHaveValue('desktop');
    await device.selectOption('mobile');
    await orientation.selectOption('portrait');
    await expect(canvas).toHaveAttribute('width', '400');
    await expect(canvas).toHaveAttribute('height', '800');
    await button('Save Scene').click();
    await expect(page.getByText('settings.json', { exact: true })).toBeVisible();
    const saved = JSON.parse(await readFile(file, 'utf8')).config;
    const configFile = join(directory, 'settings.config.json');
    assert.deepEqual(JSON.parse(await readFile(configFile, 'utf8')), saved);
    assert.deepEqual(saved.profiles, { mobile: { portrait: { renderer: { width: 400, height: 800, scaleMode: 'ENVELOP' } } } });
    await button('Open Scene').click();
    await expect(canvas).toHaveAttribute('height', '800');
    await button('Settings').click();
    await settings.getByRole('button', { name: 'Tablet', exact: true }).click();
    await expect(width).toHaveAttribute('placeholder', '960');
    await settings.getByRole('button', { name: 'Mobile', exact: true }).click();
    await expect(width).toHaveValue('400');
    await settings.getByRole('button', { name: 'Inherit Width', exact: true }).click();
    await expect(width).toHaveAttribute('placeholder', '960');
    await settings.getByRole('button', { name: 'Dismiss' }).click();
    await button('Play Game').click();
    await expect(button('Pause Game')).toBeEnabled();
    await button('Pause Game').click();
    await orientation.selectOption('landscape');
    await expect(button('Resume Game')).toBeEnabled();
    await device.selectOption('tablet');
    await expect(button('Pause Game')).toBeEnabled();
    await device.selectOption('mobile');
    await orientation.selectOption('portrait');
    await button('Pause Game').click();
    await button('Settings').click();
    await width.fill('432');
    await width.press('Enter');
    await settings.getByRole('button', { name: 'Dismiss' }).click();
    await expect(button('Pause Game')).toBeEnabled();
    await expect(canvas).toHaveAttribute('width', '432');
    assert.equal(JSON.parse(await readFile(configFile, 'utf8')).profiles.mobile.portrait.renderer.width, 432);
    assert.equal(JSON.parse(await readFile(file, 'utf8')).config.profiles.mobile.portrait.renderer.width, 400);
    await button('Stop Game').click();
    await button('Open Scene').click();
    await expect(canvas).toHaveAttribute('width', '432');
  } finally {
    await editor?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('Hub creates, opens, and remembers native projects and ships examples', { timeout: 25_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'olive-native-hub-'));
  const profile = join(directory, 'profile');
  const project = join(directory, 'first-project.json');
  const existing = join(directory, 'existing.json');
  let editor;
  try {
    await writeFile(existing, JSON.stringify({ version: 1, objects: [] }));
    editor = await launchEditor(profile, { hub: true });
    await editor.evaluate(({ dialog }, files) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [files.existing] });
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: files.project });
    }, { existing, project });
    let page = await editor.firstWindow();
    page.setDefaultTimeout(5000);
    const hub = () => page.getByRole('dialog', { name: 'OliveStudio Hub' });
    const button = name => hub().getByRole('button', { name, exact: true });
    const showHub = () => page.getByRole('button', { name: 'OliveStudio Hub', exact: true }).click();
    await expect(hub()).toBeVisible();
    await button('Open Project').click();
    await expect(hub()).toBeHidden();
    await expect(page.getByText('existing.json', { exact: true })).toBeVisible();

    await showHub();
    await expect(button('Open existing.json')).toBeVisible();
    await button('New Project').click();
    await expect(hub()).toBeHidden();
    await expect(page.getByText('first-project.json', { exact: true })).toBeVisible();
    assert.deepEqual(JSON.parse(await readFile(project, 'utf8')).objects.map(node => node.type), ['Camera2D']);
    await showHub();
    await button('Pin first-project.json').click();
    await expect(button('Unpin first-project.json')).toBeVisible();
    const search = hub().getByRole('searchbox', { name: 'Search recent projects' });
    await search.fill('existing');
    await expect(button('Open existing.json')).toBeVisible();
    await expect(button('Open first-project.json')).toHaveCount(0);

    await button('Examples').click();
    await button('Open Object Gallery').click();
    await expect(hub()).toBeHidden();
    await expect(page.getByRole('button', { name: 'Container • Object Gallery', exact: true })).toBeVisible();
    for (const name of ['Positional Chime', 'Gallery Listener', 'Gallery Camera', 'Amber Lantern Light', 'Gallery Slider']) {
      await expect(page.getByRole('button', { name, exact: true })).toBeAttached();
    }
    await editor.close();
    editor = await launchEditor(profile, { hub: true });
    page = await editor.firstWindow();
    page.setDefaultTimeout(5000);
    await expect(button('Unpin first-project.json')).toBeVisible();
    await button('Open first-project.json').click();
    await expect(page.getByText('first-project.json', { exact: true })).toBeVisible();
    await showHub();
    await button('Remove first-project.json from recent projects').click();
    await expect(button('Open first-project.json')).toHaveCount(0);
    assert.deepEqual(JSON.parse(await readFile(project, 'utf8')).objects.map(node => node.type), ['Camera2D']);
    await hub().getByRole('checkbox', { name: 'Show Hub at startup' }).uncheck();
    await button('Continue to Editor').click();
    await editor.close();
    editor = await launchEditor(profile, { hub: true });
    page = await editor.firstWindow();
    await expect(page.locator('canvas')).toBeVisible();
    await expect(hub()).toBeHidden();
  } finally {
    await editor?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('viewport rulers, grid snap, and smart guides align scene movement', { timeout: 20_000 }, async () => {
  const profile = await mkdtemp(join(tmpdir(), 'olive-grid-test-'));
  let editor;
  try {
    editor = await launchEditor(profile);
    await editor.evaluate(({ dialog }) => { dialog.showMessageBoxSync = () => 1; });
    const page = await editor.firstWindow();
    page.setDefaultTimeout(5000);
    const stage = page.getByRole('region', { name: 'Scene', exact: true });
    const button = name => stage.getByRole('button', { name, exact: true });
    const canvas = stage.locator('canvas');
    const rulers = stage.getByRole('img', { name: 'Rulers', exact: true });
    const position = axis => page.getByRole('spinbutton', { name: `Position ${axis}`, exact: true });
    await expect(rulers.locator('[data-axis="x"] [data-major="true"] small').first()).toBeVisible();
    await expect(rulers.locator('[data-axis="y"] [data-major="true"] small').first()).toBeVisible();
    await button('Rulers').click();
    await expect(rulers).toHaveCount(0);
    await button('Rulers').click();
    await expect(rulers).toBeVisible();

    const noGrid = await canvas.screenshot();
    await button('Grid').click();
    await expect(button('Grid')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => (await canvas.screenshot()).equals(noGrid)).toBe(false);

    const rect = await canvas.boundingBox();
    const point = (x, y) => [rect.x + x * rect.width / 960, rect.y + y * rect.height / 540];
    const drag = async (x, y) => {
      await page.mouse.move(...point(480, 226));
      await page.mouse.down();
      await page.mouse.move(...point(x, y), { steps: 8 });
      await page.mouse.up();
    };
    const undo = () => page.getByRole('button', { name: 'Undo', exact: true }).click();
    await button('Move').click();
    await drag(475, 265);
    await expect(position('X')).toHaveValue('480');
    await expect(position('Y')).toHaveValue('270');
    await undo();
    await expect(position('Y')).toHaveValue('226');

    await page.keyboard.down('Alt');
    await drag(475, 265);
    await page.keyboard.up('Alt');
    await expect.poll(async () => Math.abs(Number(await position('Y').inputValue()) - 265)).toBeLessThan(2);
    await undo();
    await expect(position('Y')).toHaveValue('226');

    await stage.getByLabel('Grid Spacing').selectOption('64');
    await button('Snap to Grid').click();
    await button('Grid').click();
    await drag(515, 265);
    await expect(position('X')).toHaveValue('512');
    await expect(position('Y')).toHaveValue('256');
    await stage.locator('.canvas').press('ArrowRight');
    await expect(position('X')).toHaveValue('576');
  } finally {
    await editor?.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test('Inspector aligns property rows and edits typed values with the texture picker and slider', { timeout: 20_000 }, async () => {
  const profile = await mkdtemp(join(tmpdir(), 'olive-inspector-controls-'));
  let editor;
  try {
    editor = await launchEditor(profile);
    await editor.evaluate(({ dialog }) => { dialog.showMessageBoxSync = () => 1; });
    const page = await editor.firstWindow();
    page.setDefaultTimeout(5000);
    const inspector = page.getByRole('complementary', { name: 'Inspector' });
    const section = name => inspector.locator(`summary[data-tip="${name}"]`);
    const input = name => inspector.getByRole('spinbutton', { name, exact: true });
    const x = await input('Position X').boundingBox();
    const y = await input('Position Y').boundingBox();
    const scale = await input('Scale X').boundingBox();
    const label = await inspector.getByText('Position X', { exact: true }).boundingBox();
    assert.ok(label.x + label.width < x.x && x.y < y.y && y.y < scale.y);
    assert.equal(x.x, y.x);
    assert.equal(x.x, scale.x);

    await section('Texture').click();
    const texture = inspector.getByRole('button', { name: 'Texture', exact: true });
    const picker = page.getByRole('dialog', { name: 'Choose a texture' });
    await texture.click();
    await picker.getByRole('button', { name: 'Clear Texture', exact: true }).click();
    await expect(texture).toHaveAttribute('value', '');
    await texture.click();
    const search = picker.getByRole('searchbox', { name: 'Search textures' });
    await expect(search).toBeFocused();
    await search.fill('chime');
    await expect(picker.getByRole('status')).toContainText('No textures match');
    await search.fill('crystal');
    const card = picker.getByRole('button', { name: 'olive-crystal.png', exact: true });
    await expect(card.locator('img')).toBeVisible();
    await card.click();
    await expect(texture).toHaveAttribute('value', 'images/olive-crystal.png');
    await expect(texture).toBeFocused();

    await section('Appearance').click();
    await inspector.getByLabel('Tint', { exact: true }).fill('#7a5cef');
    await expect(inspector.getByText('#7A5CEF', { exact: true })).toBeVisible();
    const opacity = input('Opacity');
    const slider = inspector.getByRole('slider', { name: 'Opacity', exact: true });
    await opacity.fill('0.6');
    await opacity.press('Enter');
    await expect(slider).toHaveValue('0.6');
    const track = await slider.boundingBox();
    await page.mouse.move(track.x + track.width * 0.6, track.y + track.height / 2);
    await page.mouse.down();
    await page.mouse.move(track.x + track.width * 0.25, track.y + track.height / 2, { steps: 6 });
    await page.mouse.up();
    await expect.poll(async () => Number(await opacity.inputValue())).toBeLessThan(0.6);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(opacity).toHaveValue('0.6');
  } finally {
    await editor?.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test('Globals bind input, update scene text, and restore versioned game saves', { timeout: 30_000 }, async () => {
  const profile = await mkdtemp(join(tmpdir(), 'olive-globals-saves-'));
  const fixture = join(profile, 'globals.json');
  const saved = join(profile, 'globals-project.json');
  let editor;
  try {
    await writeFile(fixture, JSON.stringify({
      version: 2, startup: 'main',
      inputMap: { version: 1, deadzone: 0.2, actions: [{ id: 'axis', name: 'move_x', kind: 'axis',
        bindings: [{ type: 'keyAxis', negative: 'ArrowLeft', positive: 'ArrowRight' }] }] },
      scenes: [{ id: 'main', name: 'Scoreboard', objects: [
        { id: 'score', type: 'Text', label: 'Label', text: 'Score {score}', position: { x: 100, y: 100 } },
      ] }],
    }));
    editor = await launchEditor(profile);
    await editor.evaluate(({ dialog }, paths) => {
      const open = [paths.fixture, paths.saved];
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [open.shift()] });
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: paths.saved });
      dialog.showMessageBoxSync = () => 1;
    }, { fixture, saved });
    const page = await editor.firstWindow();
    const button = (scope, name) => scope.getByRole('button', { name, exact: true });
    const openPanel = async name => {
      await button(page, 'Panels').click();
      await page.getByRole('checkbox', { name, exact: true }).check();
    };
    await button(page, 'Open Scene').click();
    await expect(button(page, 'Label')).toBeVisible();
    await openPanel('Globals');
    const globals = page.getByRole('region', { name: 'Globals', exact: true });
    const input = (name, role = 'spinbutton') => globals.getByRole(role, { name, exact: true });
    const enter = async (field, value) => { await field.fill(value); await field.press('Enter'); };
    await button(globals, 'Add Global').click();
    await enter(input('Global Name 1', 'textbox'), 'score');
    await enter(input('Initial Value for score'), '5');
    await button(globals, 'Add Global').click();
    await enter(input('Global Name 2', 'textbox'), 'movement');
    await openPanel('Input Map');
    const inputMap = page.getByRole('region', { name: 'Input Map', exact: true });
    await inputMap.getByRole('combobox', { name: 'Write move_x to Global' }).selectOption({ label: 'movement' });
    await page.getByRole('tab', { name: 'Globals', exact: true }).click();
    await openPanel('Scenes');
    const scenes = page.getByRole('region', { name: 'Scenes', exact: true });
    const canvas = page.getByRole('region', { name: 'Scene', exact: true }).locator('canvas');
    await button(page, 'Save Scene').click();
    await expect(page.getByRole('img', { name: 'Unsaved changes' })).toHaveCount(0);
    await button(scenes, 'Play Scene Flow').click();
    await expect(input('Current Value for score')).toHaveValue('5');
    await canvas.click();
    await page.keyboard.down('ArrowLeft');
    await expect(input('Current Value for movement')).toHaveValue('-1');
    await page.keyboard.up('ArrowLeft');
    await expect(input('Current Value for movement')).toHaveValue('0');
    const initial = await canvas.screenshot();
    await enter(input('Current Value for score'), '12');
    const changed = await canvas.screenshot();
    assert.ok(!initial.equals(changed));
    await globals.getByRole('combobox', { name: 'Game Save Slot' }).selectOption('2');
    await button(globals, 'Save Game Slot').click();
    await expect(globals.getByRole('status')).toHaveText('Saved to slot 2.');
    await button(scenes, 'Stop Scene Flow').click();
    await button(page, 'Open Scene').click();
    await expect(button(scenes, 'Play Scene Flow')).toBeEnabled();
    await button(scenes, 'Play Scene Flow').click();
    await expect(input('Current Value for score')).toHaveValue('5');
    await globals.getByRole('combobox', { name: 'Game Save Slot' }).selectOption('2');
    await button(globals, 'Load Game Slot').click();
    await expect(input('Current Value for score')).toHaveValue('12');
    assert.ok(changed.equals(await canvas.screenshot()));
    await expect(page.getByRole('img', { name: 'Unsaved changes' })).toHaveCount(0);
    await button(scenes, 'Stop Scene Flow').click();
    await enter(input('Save Revision'), '2');
    await button(scenes, 'Play Scene Flow').click();
    await button(globals, 'Load Game Slot').click();
    await expect(globals.getByRole('status')).toHaveText('Slot 2 belongs to a different save revision.');
    await expect(input('Current Value for score')).toHaveValue('5');
  } finally {
    await editor?.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test('Edit and Live preserve separate canvases and the game clock pauses, steps, and resumes', { timeout: 30_000 }, async () => {
  const profile = await mkdtemp(join(tmpdir(), 'olive-viewport-modes-'));
  const path = join(profile, 'clock.json');
  let editor;
  try {
    await writeFile(path, JSON.stringify({
      version: 2, startup: 'main',
      scenes: [{ id: 'main', name: 'Clock', objects: [
        { type: 'Graphics', id: 'box', label: 'Box' },
        { type: 'Particles', id: 'clock-particles', label: 'Clock Particles', position: { x: 240, y: 160 },
          spread: 0, frequency: 0.025, size: 24 },
      ] }],
      globals: { version: 1, items: [{ id: 'elapsed', name: 'elapsed', type: 'number', initial: 0 }] },
      scripts: {
        version: 1,
        items: [{ id: 'clock', name: 'Clock', source: 'export function update(self, dt) { globals.elapsed += dt; }',
          code: 'exports.update = function(self, dt) { globals.elapsed += dt; };' }],
        scenes: { main: { scriptId: 'clock', params: {}, refs: {} } },
      },
    }));
    editor = await launchEditor(profile);
    await editor.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
      dialog.showMessageBoxSync = () => 1;
    }, path);
    const page = await editor.firstWindow();
    page.setDefaultTimeout(5000);
    const scene = page.getByRole('region', { name: 'Scene', exact: true });
    const modes = scene.getByRole('tablist', { name: 'Canvas mode' });
    const edit = modes.getByRole('tab', { name: 'Edit' });
    const live = modes.getByRole('tab', { name: 'Live' });
    const editPane = scene.getByRole('tabpanel', { name: 'Edit' });
    const livePane = scene.getByRole('tabpanel', { name: 'Live' });
    const button = (scope, name) => scope.getByRole('button', { name, exact: true });
    const canvas = scene.locator('canvas');

    await button(page, 'Open Scene').click();
    await button(page, 'Box').click();
    await expect(edit).toHaveAttribute('aria-selected', 'true');
    await expect(editPane.locator('canvas')).toBeVisible();
    const editClock = button(editPane, 'Edit Game Clock');
    await expect(editClock).toHaveAttribute('aria-pressed', 'false');
    const waitForFrames = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const initialFrame = await canvas.screenshot();
    await waitForFrames();
    assert.ok((await canvas.screenshot()).equals(initialFrame), 'Edit renders a frozen scene by default');
    await editClock.click();
    await expect(editClock).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => (await canvas.screenshot()).equals(initialFrame)).toBe(false);
    await editClock.click();
    await expect(editClock).toHaveAttribute('aria-pressed', 'false');
    const pausedFrame = await canvas.screenshot();
    await waitForFrames();
    assert.ok((await canvas.screenshot()).equals(pausedFrame), 'Turning off the Edit clock freezes the current frame');
    await editClock.click();
    await expect.poll(async () => (await canvas.screenshot()).equals(pausedFrame)).toBe(false);
    await editClock.click();
    await expect(page.getByRole('img', { name: 'Unsaved changes' })).toHaveCount(0);
    await button(editPane, 'Zoom In').click();
    const editZoom = await button(editPane, 'Reset Zoom').textContent();
    await canvas.evaluate(element => { element.dataset.viewportProbe = 'edit'; });
    await edit.press('ArrowRight');
    await expect(live).toBeFocused();
    await expect(livePane.getByText('Press Play to preview the game.')).toBeVisible();
    await button(scene, 'Close Live Preview').click();
    await expect(edit).toBeFocused();

    await button(scene, 'Play Game').click();
    await expect(live).toHaveAttribute('aria-selected', 'true');
    await expect(editPane).toBeHidden();
    await expect(livePane.locator('canvas')).toBeVisible();
    await expect(livePane.locator('canvas')).not.toHaveAttribute('data-viewport-probe', 'edit');
    await livePane.locator('canvas').evaluate(element => { element.dataset.viewportProbe = 'live'; });
    await expect(livePane.getByLabel('Live game canvas')).toBeFocused();
    await expect(livePane.getByRole('button', { name: 'Zoom In', exact: true })).toHaveCount(0);
    await expect(button(livePane, 'Edit Game Clock')).toHaveCount(0);

    await button(page, 'Panels').click();
    await page.getByRole('checkbox', { name: 'Globals', exact: true }).check();
    await page.keyboard.press('Escape');
    const elapsed = page.getByRole('spinbutton', { name: 'Current Value for elapsed', exact: true });
    const readElapsed = async () => Number(await elapsed.inputValue());
    await expect.poll(readElapsed).toBeGreaterThan(0);
    const speed = scene.getByRole('slider', { name: 'Game Speed' });
    await speed.press('End');
    await expect(speed).toHaveValue('2');
    await button(scene, 'Pause Game').click();
    const before = await readElapsed();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await readElapsed(), before);
    await button(scene, 'Step Game').click();
    await expect.poll(readElapsed).toBeGreaterThan(before);
    assert.ok(Math.abs((await readElapsed()) - before - 1 / 60) < 0.001);
    await edit.click();
    await expect(editPane.locator('canvas')).toHaveAttribute('data-viewport-probe', 'edit');
    await expect(button(editPane, 'Reset Zoom')).toHaveText(editZoom);
    await expect(page.getByRole('spinbutton', { name: 'Position X', exact: true })).toBeEnabled();
    await expect(button(scene, 'Stop Game')).toBeEnabled();
    await live.click();
    await expect(livePane.locator('canvas')).toHaveAttribute('data-viewport-probe', 'live');
    const stepped = await readElapsed();
    await button(scene, 'Resume Game').click();
    await expect.poll(readElapsed).toBeGreaterThan(stepped);
    const resumed = await readElapsed();
    await edit.click();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await live.click();
    await expect.poll(readElapsed).toBeGreaterThan(resumed);
    await expect(livePane.locator('canvas')).toHaveAttribute('data-viewport-probe', 'live');

    await button(scene, 'Close Live Preview').click();
    await expect(edit).toHaveAttribute('aria-selected', 'true');
    await expect(editPane.locator('canvas')).toHaveAttribute('data-viewport-probe', 'edit');
    await expect(button(editPane, 'Reset Zoom')).toHaveText(editZoom);

    await button(page, 'Panels').click();
    await page.getByRole('checkbox', { name: 'Scenes', exact: true }).check();
    await page.keyboard.press('Escape');
    const scenes = page.getByRole('region', { name: 'Scenes', exact: true });
    await button(scene, 'Close Scene Panel').click();
    await expect(scene).toBeHidden();
    await button(scenes, 'Play Scene Flow').click();
    await expect(livePane.locator('canvas')).toBeVisible();
    await button(scene, 'Stop Game').click();
    await expect(editPane.locator('canvas')).toBeVisible();
    await expect(button(scenes, 'Play Scene Flow')).toBeEnabled();
  } finally {
    await editor?.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test('Input Map captures controls, resolves live buttons and axes, and saves bindings', { timeout: 30_000 }, async () => {
  const profile = await mkdtemp(join(tmpdir(), 'olive-input-map-'));
  const saved = join(profile, 'input-map.json');
  let editor;
  try {
    editor = await launchEditor(profile);
    await editor.evaluate(({ dialog }, saved) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: saved });
      dialog.showMessageBoxSync = () => 1;
    }, saved);
    const page = await editor.firstWindow();
    await page.evaluate(() => {
      globalThis.testPad = { button: false, axis: 0 };
      Object.defineProperty(navigator, 'getGamepads', { value: () => [{
        connected: true, buttons: [{ pressed: globalThis.testPad.button }], axes: [0, globalThis.testPad.axis],
      }] });
    });
    const button = (scope, name) => scope.getByRole('button', { name, exact: true });
    const scene = page.getByRole('region', { name: 'Scene', exact: true });
    const canvas = scene.locator('canvas');
    await button(page, 'Panels').click();
    await page.getByRole('checkbox', { name: 'Input Map', exact: true }).check();
    const panel = page.getByRole('region', { name: 'Input Map', exact: true });
    async function setName(index, name) {
      const input = panel.getByRole('textbox', { name: 'Action Name ' + index, exact: true });
      await input.fill(name);
      await input.press('Enter');
    }
    const listen = () => button(panel, 'Listen for jump').click();
    await button(panel, 'Add Input Action').click();
    await setName(1, 'jump');
    await listen();
    await page.keyboard.press('Space');
    await expect(panel.getByText('Space', { exact: true })).toBeVisible();
    await listen();
    await panel.getByRole('status').click();
    await expect(panel.getByText('Mouse Button 1', { exact: true })).toBeVisible();
    await button(panel, 'Bind Touch to jump').click();
    await listen();
    await panel.getByRole('status').waitFor();
    await page.evaluate(() => { globalThis.testPad.button = true; });
    await expect(panel.getByText('Gamepad Button 0', { exact: true })).toBeVisible();
    await page.evaluate(() => { globalThis.testPad.button = false; });
    await button(panel, 'Add Input Action').click();
    await setName(2, 'move_x');
    await panel.getByRole('combobox', { name: 'Action Type for move_x' }).selectOption('axis');
    await button(panel, 'Listen for move_x Key Pair').click();
    await page.keyboard.press('ArrowLeft');
    await expect(panel.getByRole('status')).toContainText('positive');
    await page.keyboard.press('ArrowRight');
    await panel.getByRole('combobox', { name: 'Gamepad Axis for move_x' }).selectOption('1:yes');
    await button(page, 'Panels').click();
    await page.getByRole('checkbox', { name: 'Scenes', exact: true }).check();
    const scenes = page.getByRole('region', { name: 'Scenes', exact: true });
    await button(scenes, 'Play Scene Flow').click();
    const jump = panel.getByRole('status', { name: 'Live Value for jump' });
    const axis = panel.getByRole('status', { name: 'Live Value for move_x' });
    await expect(jump).toHaveText('Released');
    await canvas.click();
    await page.keyboard.down('Space');
    await expect(jump).toHaveText('Pressed');
    await page.keyboard.up('Space');
    await expect(jump).toHaveText('Released');
    await page.mouse.down();
    await expect(jump).toHaveText('Pressed');
    await page.mouse.up();
    await expect(jump).toHaveText('Released');
    await canvas.dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 4, button: 0 });
    await expect(jump).toHaveText('Pressed');
    await canvas.dispatchEvent('pointerup', { pointerType: 'touch', pointerId: 4, button: 0 });
    await expect(jump).toHaveText('Released');
    await page.keyboard.down('ArrowLeft');
    await expect(axis).toHaveText('-1');
    await page.keyboard.up('ArrowLeft');
    await expect(axis).toHaveText('0');
    await page.evaluate(() => Object.assign(globalThis.testPad, { axis: 0.75, button: true }));
    await expect(axis).toHaveText('-0.75');
    await expect(jump).toHaveText('Pressed');
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await expect(axis).toHaveText('0');
    await expect(jump).toHaveText('Released');
    await button(scenes, 'Stop Scene Flow').click();
    await expect(jump).toHaveCount(0);
    await button(page, 'Save Scene').click();
    await expect(page.getByRole('img', { name: 'Unsaved changes' })).toHaveCount(0);
    const doc = JSON.parse(await readFile(saved, 'utf8'));
    assert.deepEqual(doc.inputMap.actions.map(action => [action.name, action.bindings.map(binding => binding.type)]),
      [['jump', ['key', 'mouse', 'touch', 'gamepadButton']], ['move_x', ['keyAxis', 'gamepadAxis']]]);
  } finally {
    await editor?.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test('Flexbox places percentage-sized items, wraps rows, and keeps its positions in game preview', { timeout: 30_000 }, async () => {
  const profile = await mkdtemp(join(tmpdir(), 'olive-flex-layout-'));
  const path = join(profile, 'layout.json');
  const saved = join(profile, 'saved-layout.json');
  let editor;
  try {
    const colors = ['#ef2020', '#10df30', '#2040ef'];
    const children = ['Red Chip', 'Green Chip', 'Blue Chip'].map((label, i) => ({
      id: 'chip-' + i, type: 'Graphics', label, position: { x: 700, y: 400 }, width: 40, height: 30, fill: colors[i],
      layoutItem: {
        grow: 0, shrink: 0, alignSelf: 'auto', margin: 0, width: 40, widthUnit: '%', height: 0, fit: 'none',
      },
    }));
    await writeFile(path, JSON.stringify({
      version: 1,
      objects: [{
        id: 'tray', type: 'Container', label: 'Chip Tray', position: { x: 100, y: 100 }, children,
        layout: {
          width: 300, height: 160, anchorX: 0, anchorY: 0, direction: 'row', justify: 'flex-start', align: 'flex-start',
          wrap: true, gap: 10, padding: 0, background: '#2a3038', backgroundAlpha: 0, borderColor: '#ffffff',
          borderWidth: 0, borderRadius: 0, clip: false,
        },
      }],
    }));
    editor = await launchEditor(profile);
    await editor.evaluate(({ dialog }, paths) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [paths.path] });
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: paths.saved });
      dialog.showMessageBoxSync = () => 1;
    }, { path, saved });
    const page = await editor.firstWindow();
    const button = (scope, name) => scope.getByRole('button', { name, exact: true });
    const hierarchy = page.getByRole('complementary', { name: 'Hierarchy' });
    const inspector = page.getByRole('complementary', { name: 'Inspector' });
    const canvas = page.getByRole('region', { name: 'Scene', exact: true }).locator('canvas');
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const clickAt = async (x, y) => {
      const rect = await canvas.boundingBox();
      await page.mouse.click(rect.x + x * rect.width / 960, rect.y + y * rect.height / 540);
    };
    await button(page, 'Open Scene').click();
    await expect(button(hierarchy, 'Chip Tray')).toBeVisible();
    await clickAt(284, 115);
    await expect(button(hierarchy, 'Green Chip')).toHaveAttribute('aria-pressed', 'true');
    await expect(inspector.getByRole('spinbutton', { name: 'Position X' })).toBeDisabled();
    await expect(inspector.getByRole('combobox', { name: 'Width Unit' })).toHaveValue('%');
    await button(hierarchy, 'Scene Root').click();
    await clickAt(154, 153);
    await expect(button(hierarchy, 'Blue Chip')).toHaveAttribute('aria-pressed', 'true');
    await button(hierarchy, 'Chip Tray').click();
    await inspector.getByRole('combobox', { name: 'Direction' }).selectOption('column');
    await clickAt(154, 153);
    await expect(button(hierarchy, 'Green Chip')).toHaveAttribute('aria-pressed', 'true');

    await button(page, 'Panels').click();
    await page.getByRole('checkbox', { name: 'Scenes', exact: true }).check();
    const scenes = page.getByRole('region', { name: 'Scenes', exact: true });
    await button(scenes, 'Play Scene Flow').click();
    const liveCanvas = page.getByRole('tabpanel', { name: 'Live', exact: true }).locator('canvas');
    const screenshot = (await liveCanvas.screenshot()).toString('base64');
    const pixel = await page.evaluate(async encoded => {
      const img = new Image();
      img.src = 'data:image/png;base64,' + encoded;
      await img.decode();
      const buffer = document.createElement('canvas');
      buffer.width = img.width;
      buffer.height = img.height;
      const context = buffer.getContext('2d');
      context.drawImage(img, 0, 0);
      return Array.from(context.getImageData(Math.floor(154 * img.width / 960),
        Math.floor(195 * img.height / 540), 1, 1).data);
    }, screenshot);
    assert.ok(pixel[2] > 200 && pixel[0] < 50 && pixel[1] < 90, `Expected Blue Chip, saw ${pixel}`);
    await button(scenes, 'Stop Scene Flow').click();
    await button(page, 'Save Scene').click();
    const file = JSON.parse(await readFile(saved, 'utf8'));
    assert.equal(file.objects[0].layout.direction, 'column');
    assert.deepEqual(file.objects[0].children[2].position, { x: 700, y: 400 });
    assert.equal(file.objects[0].children[2].layoutItem.widthUnit, '%');
    assert.deepEqual(errors, []);
  } finally {
    await editor?.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test('Pixi UI widgets, filters and layout persist and run in Live', { timeout: 30_000 }, async () => {
  const profile = await mkdtemp(join(tmpdir(), 'olive-pixi-ecosystem-'));
  const path = join(profile, 'ui.json');
  let editor;
  try {
    await writeFile(path, JSON.stringify({
      version: 2, startup: 'main',
      globals: { version: 1, items: [{ id: 'pressed', name: 'pressed', type: 'boolean', initial: false }] },
      scenes: [{ id: 'main', name: 'UI', objects: [{
        id: 'tray', type: 'Container', label: 'UI Tray', position: { x: 100, y: 100 }, children: [],
        layout: {
          width: 300, height: 120, anchorX: 0, anchorY: 0, direction: 'column', justify: 'flex-start', align: 'flex-start',
          wrap: false, gap: 0, padding: 0, background: '#27343e', backgroundAlpha: 0, borderColor: '#ffffff',
          borderWidth: 0, borderRadius: 0, clip: false,
        },
      }] }],
    }));
    editor = await launchEditor(profile);
    await editor.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
      dialog.showMessageBoxSync = () => 1;
    }, path);
    const page = await editor.firstWindow();
    page.setDefaultTimeout(5000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const button = (scope, name) => scope.getByRole('button', { name, exact: true });
    const inspector = page.getByRole('complementary', { name: 'Inspector' });
    const scene = page.getByRole('region', { name: 'Scene', exact: true });
    const combo = name => inspector.getByRole('combobox', { name, exact: true });
    await button(page, 'Open Scene').click();
    await button(page, 'UI Tray').click();
    await combo('Overflow').selectOption('scroll');
    await button(page, 'More Objects').click();
    await button(page, 'Add UI Widget').click();
    for (const kind of ['slider', 'progress', 'list', 'scrollBox', 'radio', 'checkbox', 'switch', 'button']) {
      await combo('Widget Type').selectOption(kind);
      await expect(scene.locator('canvas')).toBeVisible();
    }
    await combo('Global Binding').selectOption('pressed');
    await combo('Content Position').selectOption('left top');
    await inspector.locator('summary[data-tip="Filters"]').click();
    await inspector.getByRole('checkbox', { name: 'Enable Filters' }).check();
    const unfiltered = await scene.locator('canvas').screenshot();
    const thickness = inspector.getByRole('spinbutton', { name: 'Outline Thickness' });
    await thickness.fill('5');
    await thickness.press('Enter');
    assert.ok(!(await scene.locator('canvas').screenshot()).equals(unfiltered));
    await button(page, 'Save Scene').click();
    await expect(page.getByRole('img', { name: 'Unsaved changes' })).toHaveCount(0);
    const saved = JSON.parse(await readFile(path, 'utf8'));
    const [tray] = saved.scenes[0].objects;
    const [widget] = tray.children;
    assert.equal(tray.layout.overflow, 'scroll');
    assert.equal(widget.layoutItem.objectPosition, 'left top');
    assert.equal(widget.effects.outlineWidth, 5);
    assert.equal(widget.widget.globalId, 'pressed');

    await button(page, 'Panels').click();
    await page.getByRole('checkbox', { name: 'Globals', exact: true }).check();
    await page.keyboard.press('Escape');
    await button(scene, 'Play Game').click();
    const pressed = page.getByRole('checkbox', { name: 'Current Value for pressed', exact: true });
    await expect(pressed).not.toBeChecked();
    const canvas = scene.getByRole('tabpanel', { name: 'Live' }).locator('canvas');
    await expect(canvas).toBeVisible();
    const rect = await canvas.boundingBox();
    assert.ok(rect);
    await page.mouse.click(rect.x + rect.width * 150 / 960, rect.y + rect.height * 120 / 540);
    await expect(pressed).toBeChecked();
    await button(scene, 'Stop Game').click();
    assert.deepEqual(errors, []);
  } finally {
    await editor?.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test('game camera follows and zooms while the HUD stays anchored across device profiles', { timeout: 30_000 }, async () => {
  const profile = await mkdtemp(join(tmpdir(), 'olive-camera-hud-'));
  const path = join(profile, 'camera.json');
  let editor;
  try {
    await writeFile(path, JSON.stringify({
      version: 1,
      config: { profiles: { mobile: { portrait: { renderer: { width: 720, height: 640 } } } } },
      objects: [
        { type: 'Graphics', id: 'hero', label: 'Hero', position: { x: 180, y: 160 }, width: 42, height: 42, fill: '#10ef20' },
        { type: 'Graphics', id: 'hud', label: 'Score Badge', position: { x: 900, y: 24 }, width: 40, height: 32, fill: '#fb1030' },
        { type: 'Camera2D', id: 'fallback', label: 'Fallback Camera', position: { x: 30, y: 40 } },
        { type: 'Camera2D', id: 'preferred', label: 'Preferred Camera', camera: { priority: 10 } },
      ],
    }));
    editor = await launchEditor(profile);
    await editor.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
      dialog.showMessageBoxSync = () => 1;
    }, path);
    const page = await editor.firstWindow();
    const button = (scope, name) => scope.getByRole('button', { name, exact: true });
    const hierarchy = page.getByRole('complementary', { name: 'Hierarchy' });
    const inspector = page.getByRole('complementary', { name: 'Inspector' });
    const scene = page.getByRole('region', { name: 'Scene', exact: true });
    const canvas = scene.locator('canvas:visible');
    const readCamera = async () => JSON.parse(await canvas.getAttribute('data-game-camera') ?? 'null');
    async function pixel(x, y, logicalWidth, logicalHeight) {
      const image = (await canvas.screenshot()).toString('base64');
      return page.evaluate(async ({ image, x, y, logicalWidth, logicalHeight }) => {
        const img = new Image();
        img.src = 'data:image/png;base64,' + image;
        await img.decode();
        const target = document.createElement('canvas');
        target.width = img.width;
        target.height = img.height;
        const context = target.getContext('2d');
        context.drawImage(img, 0, 0);
        return Array.from(context.getImageData(Math.floor(x * img.width / logicalWidth),
          Math.floor(y * img.height / logicalHeight), 1, 1).data).slice(0, 3);
      }, { image, x, y, logicalWidth, logicalHeight });
    }
    async function colorAt(x, y, width, height, expected) {
      const actual = await pixel(x, y, width, height);
      assert.ok(actual.every((channel, index) => Math.abs(channel - expected[index]) <= 3),
        `Expected ${expected.join(', ')} near (${x}, ${y}), saw ${actual.join(', ')}`);
    }
    await button(page, 'Open Scene').click();
    await button(hierarchy, 'Score Badge').click();
    await inspector.getByText('Screen Space / HUD', { exact: true }).click();
    await inspector.getByRole('checkbox', { name: 'Screen Space', exact: true }).check();
    await inspector.getByRole('combobox', { name: 'Screen Anchor' }).selectOption('top-right');
    await button(hierarchy, 'Preferred Camera').click();
    await inspector.getByRole('combobox', { name: 'Follow Target' }).selectOption('hero');
    const zoom = inspector.getByRole('spinbutton', { name: 'Camera Zoom' });
    await zoom.fill('2');
    await zoom.press('Enter');
    await button(page, 'Panels').click();
    await page.getByRole('checkbox', { name: 'Scenes', exact: true }).check();
    const scenes = page.getByRole('region', { name: 'Scenes', exact: true });
    await button(scenes, 'Play Scene Flow').click();
    await expect.poll(readCamera).toEqual({ x: 180, y: 160, zoom: 2, rotation: 0 });
    await colorAt(920, 40, 960, 540, [251, 16, 48]);
    await colorAt(505, 295, 960, 540, [16, 239, 32]);
    await button(scene, 'Shake Game Camera').click();
    await expect.poll(async () => (await readCamera()).x).not.toBe(180);
    await colorAt(920, 40, 960, 540, [251, 16, 48]);
    await button(scenes, 'Stop Scene Flow').click();
    await expect(canvas).not.toHaveAttribute('data-game-camera', /.+/);
    await scene.getByRole('combobox', { name: 'Preview Device' }).selectOption('mobile');
    await scene.getByRole('combobox', { name: 'Preview Orientation' }).selectOption('portrait');
    await expect(canvas).toHaveAttribute('width', '720');
    await button(scenes, 'Play Scene Flow').click();
    await expect.poll(readCamera).toMatchObject({ x: 180, y: 160, zoom: 2 });
    await colorAt(680, 40, 720, 640, [251, 16, 48]);
  } finally {
    await editor?.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test('Prefab authoring places linked copies, isolates source editing, and preserves instance overrides', { timeout: 30_000 }, async () => {
  const profile = await mkdtemp(join(tmpdir(), 'olive-prefab-authoring-'));
  const saved = join(profile, 'prefabs.json');
  let editor;
  try {
    editor = await launchEditor(profile);
    await editor.evaluate(({ dialog }, saved) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [saved] });
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: saved });
      dialog.showMessageBoxSync = () => 1;
    }, saved);
    const page = await editor.firstWindow();
    const button = (scope, name) => scope.getByRole('button', { name, exact: true });
    const scene = page.getByRole('region', { name: 'Scene', exact: true });
    const hierarchy = page.getByRole('complementary', { name: 'Hierarchy' });
    const inspector = page.getByRole('complementary', { name: 'Inspector' });
    const rename = async label => {
      const input = inspector.getByRole('textbox', { name: 'Name', exact: true });
      await input.fill(label);
      await input.press('Enter');
    };
    await button(page, 'Panels').click();
    await page.getByRole('checkbox', { name: 'Prefabs', exact: true }).check();
    const panel = page.getByRole('region', { name: 'Prefabs', exact: true });
    await button(panel, 'Create Prefab from Selection').click();
    await button(panel, 'Instantiate Prefab').click();
    await rename('Local Crystal');
    await button(panel, 'Edit Prefab').click();
    await expect(scene.getByText('Editing prefab Olive Crystal', { exact: true })).toBeVisible();
    await expect(button(hierarchy, 'Local Crystal')).toHaveCount(0);
    await rename('Shared Crystal');
    await button(scene, 'Save Prefab').click();
    await expect(button(hierarchy, 'Shared Crystal')).toBeVisible();
    await expect(button(hierarchy, 'Local Crystal')).toBeVisible();
    await button(panel, 'Create Variant').click();
    await expect(button(panel, 'Shared Crystal Variant')).toHaveAttribute('aria-pressed', 'true');
    await button(page, 'Save Scene').click();
    await expect(page.getByRole('img', { name: 'Unsaved changes' })).toHaveCount(0);
    const file = JSON.parse(await readFile(saved, 'utf8'));
    assert.equal(file.prefabs[1].base, file.prefabs[0].id);
    assert.equal(file.scenes[0].objects.at(-1).label, 'Local Crystal');
    await button(page, 'Open Scene').click();
    await expect(button(hierarchy, 'Local Crystal')).toBeVisible();
    await button(hierarchy, 'Local Crystal').click();
    await button(panel, 'Revert Prefab Overrides').click();
    await expect(button(hierarchy, 'Local Crystal')).toHaveCount(0);
  } finally {
    await editor?.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test('required scene camera controls startup, active preview and saved layer effects', { timeout: 25_000 }, async () => {
  const profile = await mkdtemp(join(tmpdir(), 'olive-viewport-depth-'));
  const path = join(profile, 'depth.json');
  let editor;
  try {
    const layer = (id, x, y, fill) => ({
      type: 'Container', id, label: id, position: { x, y }, skew: { x: 6, y: -4 },
      children: [{ type: 'Graphics', id: id + '-card', label: 'Card', width: 400, height: 230, fill }],
    });
    await writeFile(path, JSON.stringify({
      version: 2, startup: 'intro', scenes: [
        { id: 'intro', name: 'Introduction', objects: [layer('Opening', 160, 110, '#dba39e')] },
        { id: 'workshop', name: 'Workshop', objects: [
          layer('Back', 170, 105, '#95bd6c'), layer('Middle', 220, 143, '#df9d77'), layer('Front', 290, 180, '#508cb6'),
          { type: 'AudioSource', id: 'test-source', label: 'Test Source', visible: false },
          { type: 'AudioListener', id: 'test-listener', label: 'Test Listener', visible: false },
          { type: 'Light2D', id: 'test-light', label: 'Test Light', visible: false },
          { type: 'Camera2D', id: 'workshop-camera', label: 'Camera 2D', visible: false,
            position: { x: 430, y: 245 }, camera: { zoom: 1.2, perspective: { enabled: false }, shakeAmplitude: 15 } },
        ] },
      ],
    }));
    editor = await launchEditor(profile);
    await editor.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
      dialog.showMessageBoxSync = () => 1;
    }, path);
    const page = await editor.firstWindow();
    page.setDefaultTimeout(5000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (/initialize shader|gl\.getProgramInfoLog\(\)|shader.*compil/i.test(message.text())) errors.push(message.text());
    });
    const button = (name, where = page) => where.getByRole('button', { name, exact: true });
    await button('Open Scene').click();
    await button('Panels').click();
    await page.getByRole('checkbox', { name: 'Scenes', exact: true }).check();
    const scenes = page.getByRole('region', { name: 'Scenes', exact: true });
    await button('Workshop', scenes).click();
    await page.getByRole('tab', { name: 'Hierarchy', exact: true }).click();
    const hierarchy = page.getByRole('complementary', { name: 'Hierarchy' });
    const camera = button('Camera 2D', hierarchy);
    await expect(camera).toHaveCount(1);
    await camera.click();
    await expect(button('Delete Selected Object', hierarchy)).toBeDisabled();
    await camera.press('Backspace');
    await expect(camera).toHaveCount(1);
    const edit = page.getByRole('tabpanel', { name: 'Edit', exact: true });
    const canvas = edit.locator('canvas');
    const shake = page.locator('[data-inspector-section="cameraShake"]');
    await shake.locator(':scope > summary').click();
    const steady = await canvas.screenshot();
    await expect(shake.getByRole('spinbutton', { name: 'Shake Strength' })).toHaveValue('15');
    const duration = shake.getByRole('spinbutton', { name: 'Shake Duration' });
    await duration.fill('2');
    await duration.press('Enter');
    await expect(shake.getByRole('form', { name: 'Test Preview' })).toHaveCount(0);
    await button('Preview Shake', shake).click();
    await expect(canvas).toHaveAttribute('data-effect-preview', 'shake');
    assert.ok(!(await canvas.screenshot()).equals(steady), 'Shake changes the Edit view');
    await button('Stop Shake Preview', shake).click();
    assert.ok((await canvas.screenshot()).equals(steady), 'Stopping shake restores the frame');
    await expect(shake.locator(':scope > summary')).toHaveText('Shake');
    await shake.getByRole('checkbox', { name: 'Use Depth' }).check();
    await shake.getByRole('combobox', { name: 'Depth Distribution' }).selectOption('power2.in');
    await button('Apply Depth Distribution', shake).click();
    await button('Save Scene').click();
    await expect(page.getByRole('img', { name: 'Unsaved changes' })).toHaveCount(0);
    await shake.locator(':scope > summary .property-label').click();
    await expect(shake).not.toHaveAttribute('open');
    await button('Preview Shake', shake).click();
    await expect(shake).not.toHaveAttribute('open');
    assert.ok(!(await canvas.screenshot()).equals(steady), 'Layered shake moves the world layers in Edit');
    await button('Stop Shake Preview', shake).click();
    assert.ok((await canvas.screenshot()).equals(steady), 'Stopping layered shake restores the world layers');
    const zoomFX = page.locator('[data-inspector-section="cameraZoomEffect"]');
    await button('Preview Zoom', zoomFX).click();
    await expect(canvas).toHaveAttribute('data-effect-preview', 'zoom');
    assert.ok(!(await canvas.screenshot()).equals(steady), 'Zoom preview changes the camera framing');
    await button('Stop Zoom Preview', zoomFX).click();
    await expect(canvas).not.toHaveAttribute('data-effect-preview', 'zoom');
    assert.ok((await canvas.screenshot()).equals(steady), 'Stopping zoom preview restores the Edit view');
    await expect(page.getByRole('img', { name: 'Unsaved changes' })).toHaveCount(0);
    await button('Scene Root', hierarchy).click();
    const setEditView = async mode => {
      await button('View', edit).click();
      await button(mode, edit).click();
      await expect(canvas).toHaveAttribute('data-edit-view', mode.toLowerCase());
    };
    await expect(canvas).toHaveAttribute('data-edit-view', 'normal');
    const normal = await canvas.screenshot();
    await setEditView('Camera');
    const cameraFrame = await canvas.screenshot();
    assert.ok(!normal.equals(cameraFrame), 'Edit Camera uses the authored camera position and zoom');
    await expect(page.getByRole('img', { name: 'Unsaved changes' })).toHaveCount(0);
    await camera.click();
    await button('Scene Root', hierarchy).click();
    await setEditView('Normal');
    const addEffect = page.getByRole('combobox', { name: 'Add Effect', exact: true });
    const back = button('Back', hierarchy);
    await back.click();
    await addEffect.selectOption('outline');
    const outlines = page.locator('[data-inspector-section="effectOutline"]');
    const outline = outlines.first();
    await outline.locator('summary').click();
    await expect(outline.getByRole('checkbox', { name: 'Enabled' })).toBeChecked();
    await button('Scene Root', hierarchy).click();
    const singleOutline = await canvas.screenshot();
    assert.ok(!singleOutline.equals(normal), 'Attaching an outline updates its object');
    await back.click();
    await addEffect.selectOption('outline');
    await expect(outlines).toHaveCount(2);
    const secondOutline = outlines.nth(1);
    await secondOutline.locator('summary').click();
    await secondOutline.getByRole('slider', { name: 'Outline Thickness' }).press('End');
    await button('Scene Root', hierarchy).click();
    assert.ok(!(await canvas.screenshot()).equals(singleOutline), 'The second outline changes the combined result');
    await back.click();
    await button('Remove Outline 2', secondOutline).click();
    await expect(outlines).toHaveCount(1);
    await button('Scene Root', hierarchy).click();
    assert.ok((await canvas.screenshot()).equals(singleOutline), 'Removing the second outline keeps the first');
    await back.click();
    await outline.locator('summary').click();
    await button('Remove Outline', outline).click();
    await expect(outlines).toHaveCount(0);
    await button('Scene Root', hierarchy).click();
    assert.ok((await canvas.screenshot()).equals(normal), 'Removing an outline restores its object');
    await setEditView('Camera');
    const selectCamera = () => camera.click();
    const clearSelection = () => button('Scene Root', hierarchy).click();
    const perspective = page.locator('[data-inspector-section="cameraCurve"]').first();
    const enabled = perspective.getByRole('checkbox', { name: 'Enabled' });
    await selectCamera();
    await perspective.locator('summary').click();
    await enabled.check();
    await expect(perspective.getByRole('checkbox', { name: 'Use Depth' })).toBeChecked();
    const distance = perspective.getByRole('slider', { name: 'Layer Distance' });
    await distance.press('End');
    await clearSelection();
    const linear = await canvas.screenshot();
    assert.ok(!linear.equals(cameraFrame), 'Migrated Curve reframes the layers');
    await selectCamera();
    await perspective.getByRole('combobox', { name: 'Depth Distribution' }).selectOption('power2.in');
    await clearSelection();
    const eased = await canvas.screenshot();
    assert.ok(!eased.equals(linear), 'Selecting a preset applies the layer distribution immediately');
    await selectCamera();
    const depthExpression = perspective.getByRole('textbox', { name: 'Ease Expression' });
    await depthExpression.fill('sine.in');
    await depthExpression.press('Enter');
    await clearSelection();
    assert.ok(!(await canvas.screenshot()).equals(eased), 'Committing an expression immediately applies its distribution');
    await selectCamera();
    await enabled.uncheck();
    await clearSelection();
    assert.ok((await canvas.screenshot()).equals(cameraFrame), 'Disabling perspective restores the base camera frame');

    const curveSection = page.locator('[data-inspector-section="cameraCurve"]').last();
    const direction = curveSection.getByRole('combobox', { name: 'Curve Direction' });
    const angle = curveSection.getByRole('slider', { name: 'Curve Angle' });
    await selectCamera();
    await addEffect.selectOption('curve');
    await curveSection.locator('summary').click();
    await expect(curveSection.getByRole('checkbox', { name: 'Use Depth' })).not.toBeChecked();
    await expect(direction).toHaveValue('concave');
    await expect(angle).toHaveValue('0');
    await angle.press('End');
    await expect(angle).toHaveValue('90');
    await clearSelection();
    const concave = await canvas.screenshot();
    assert.ok(!cameraFrame.equals(concave));

    await selectCamera();
    await direction.selectOption('convex');
    await clearSelection();
    const convex = await canvas.screenshot();
    assert.ok(!convex.equals(concave));
    assert.ok(!convex.equals(cameraFrame));
    await button('Save Scene').click();
    await expect(page.getByRole('img', { name: 'Unsaved changes' })).toHaveCount(0);
    const saved = JSON.parse(await readFile(path, 'utf8'));
    const rig = saved.scenes.find(scene => scene.id === 'workshop').objects.find(node => node.type === 'Camera2D');
    const settingsOnly = ({ effectId: _effectId, ...effect }) => effect;
    assert.deepEqual(settingsOnly(rig.camera.postFXs.find(effect => effect.type === 'curve' && effect.enabled)),
      { type: 'curve', enabled: true, angle: 90, direction: 'convex', useDepth: false, scale: 0, distance: 0, distribution: 'none' });
    assert.deepEqual(rig.camera.postFXs.find(effect => effect.type === 'shake'),
      { type: 'shake', enabled: true, amplitude: 15, duration: 2, rotation: 0, useDepth: true, distribution: 'power2.in' });
    assert.equal(rig.camera.shakeAmplitude, undefined);
    assert.deepEqual(rig.camera.postFXs.find(effect => effect.type === 'zoom'),
      { type: 'zoom', enabled: true, value: 1.2, min: 0.05, max: 20 });
    assert.equal(rig.camera.zoom, undefined);

    await selectCamera();
    await angle.press('Home');
    await clearSelection();
    assert.ok((await canvas.screenshot()).equals(cameraFrame), 'Zero degrees restores the uncurved view');
    await button('Undo').click();
    await clearSelection();
    assert.ok((await canvas.screenshot()).equals(convex), 'Undo restores the convex view');

    const depth = page.locator('[data-inspector-section="cameraDepth"]');
    const filter = depth.getByRole('combobox', { name: 'Blur Filter' });
    await selectCamera();
    await addEffect.selectOption('depth');
    await depth.locator('summary').click();
    await expect(filter).toHaveValue('none');
    const frames = [convex];
    for (const kind of ['gaussian', 'kawase', 'motion']) {
      await filter.selectOption(kind);
      await clearSelection();
      const frame = await canvas.screenshot();
      assert.ok(frames.every(previous => !frame.equals(previous)), kind + ' changes the curved scene');
      frames.push(frame);
      await selectCamera();
    }
    await depth.getByRole('slider', { name: 'Blur Strength' }).press('Home');
    await clearSelection();
    assert.ok((await canvas.screenshot()).equals(convex), 'Zero blur preserves camera curvature');
    await selectCamera();
    await depth.getByRole('slider', { name: 'Blur Strength' }).press('End');
    await depth.getByRole('checkbox', { name: 'Use Depth' }).check();
    await expect(depth.getByRole('img', { name: 'Depth Distribution' })).toBeVisible();
    await clearSelection();
    const depthFrame = await canvas.screenshot();
    await selectCamera();
    await addEffect.selectOption('tiltShift');
    const tiltShift = page.locator('[data-inspector-section="cameraTiltShift"]');
    await clearSelection();
    assert.ok(!(await canvas.screenshot()).equals(depthFrame), 'Tilt Shift adds an optical focus band');
    await selectCamera();
    await tiltShift.locator('summary').click();
    await tiltShift.getByRole('checkbox', { name: 'Enabled' }).uncheck();
    await clearSelection();
    assert.ok((await canvas.screenshot()).equals(depthFrame), 'Removing Tilt Shift restores the depth view');
    for (const [label, type] of [['Test Source', 'audioGain'], ['Test Listener', 'listenerOffset'], ['Test Light', 'lightPulse']]) {
      await button(label, hierarchy).click();
      await addEffect.selectOption(type);
      await expect(addEffect).toBeEnabled();
    }
    const pulse = page.locator('[data-inspector-section="effectLightPulse"]');
    await pulse.locator('summary').click();
    const unlit = await canvas.screenshot();
    await button('Preview Light Pulse', pulse).click();
    await expect(canvas).toHaveAttribute('data-effect-preview', 'lightPulse');
    assert.ok(!(await canvas.screenshot()).equals(unlit), 'Light Pulse can be previewed with scene lighting off');
    await button('Stop Light Pulse Preview', pulse).click();
    assert.ok((await canvas.screenshot()).equals(unlit), 'Stopping Light Pulse restores the scene lighting');
    await selectCamera();
    await addEffect.selectOption('zoom');
    const zoomEffects = page.locator('[data-inspector-section="cameraZoomEffect"]');
    await expect(zoomEffects).toHaveCount(2);
    const secondZoom = zoomEffects.nth(1);
    await secondZoom.locator(':scope > summary').click();
    const zoomValue = secondZoom.getByRole('spinbutton', { name: 'Camera Zoom' });
    await zoomValue.fill('1.6');
    await zoomValue.press('Enter');
    await button('Save Scene').click();
    await expect(page.getByRole('img', { name: 'Unsaved changes' })).toHaveCount(0);
    const updatedProject = JSON.parse(await readFile(path, 'utf8'));
    const settings = updatedProject.scenes.find(scene => scene.id === 'workshop').objects.find(node => node.type === 'Camera2D').camera;
    assert.deepEqual(settingsOnly(settings.postFXs.find(effect => effect.type === 'depth')),
      { type: 'depth', enabled: true, filter: 'motion', strength: 100, useDepth: true, scale: 16, distance: 32, distribution: 'none' });
    assert.deepEqual(settings.postFXs.find(effect => effect.type === 'curve' && !effect.enabled),
      { type: 'curve', enabled: false, angle: 0, direction: 'concave', useDepth: true, scale: 16, distance: 240, distribution: 'sine.in' });
    assert.equal(settings.postFXs.some(effect => effect.type === 'perspective'), false);
    assert.equal(settings.perspective, undefined);
    const savedZooms = settings.postFXs.filter(effect => effect.type === 'zoom');
    assert.deepEqual(savedZooms.map(effect => effect.value), [1.2, 1.6]);
    assert.ok(savedZooms[1].effectId);
    const objects = updatedProject.scenes.find(scene => scene.id === 'workshop').objects;
    assert.deepEqual(objects.find(node => node.id === 'test-source').effects.map(settingsOnly),
      [{ type: 'audioGain', enabled: true, gain: 1.5 }]);
    assert.deepEqual(objects.find(node => node.id === 'test-listener').effects.map(settingsOnly),
      [{ type: 'listenerOffset', enabled: true, x: 32, y: 0 }]);
    assert.deepEqual(objects.find(node => node.id === 'test-light').effects.map(settingsOnly),
      [{ type: 'lightPulse', enabled: true, amount: 0.4, frequency: 1 }]);
    await clearSelection();
    await setEditView('Normal');
    assert.ok((await canvas.screenshot()).equals(normal), 'Normal bypasses the pose and camera effects');
    await expect(page.getByRole('img', { name: 'Unsaved changes' })).toHaveCount(0);

    await page.getByRole('tab', { name: 'Scenes', exact: true }).click();
    await button('Play Game').click();
    await expect(scenes.getByRole('status')).toHaveText('Playing Introduction');
    await button('Stop Game').click();
    await button('Play Options').click();
    await button('Play from Active Scene').click();
    await expect(scenes.getByRole('status')).toHaveText('Playing Workshop');
    const live = page.getByRole('tabpanel', { name: 'Live', exact: true });
    await expect(button('View', live)).toHaveCount(0);
    const liveCanvas = live.locator('canvas');
    await expect(liveCanvas).toHaveAttribute('data-game-camera', /"zoom":1\.6/);
    await button('Pause Game').click();
    await page.getByRole('tab', { name: 'Hierarchy', exact: true }).click();
    await selectCamera();
    const pausedFrame = await liveCanvas.screenshot();
    const pausedPose = await liveCanvas.getAttribute('data-game-camera');
    await button('Preview Shake', shake).click();
    assert.ok(!(await liveCanvas.screenshot()).equals(pausedFrame), 'Layered shake moves the world layers in paused Live');
    await expect(liveCanvas).toHaveAttribute('data-game-camera', pausedPose);
    await button('Stop Shake Preview', shake).click();
    assert.ok((await liveCanvas.screenshot()).equals(pausedFrame), 'Stopping layered shake restores the paused game frame');
    const liveZoom = zoomEffects.first();
    await button('Preview Zoom', liveZoom).click();
    await expect(liveCanvas).toHaveAttribute('data-effect-preview', 'zoom');
    await expect(liveCanvas).toHaveAttribute('data-game-camera', /"zoom":1\.2/);
    await button('Stop Zoom Preview', liveZoom).click();
    await expect(liveCanvas).toHaveAttribute('data-game-camera', /"zoom":1\.6/);
    await expect(button('Resume Game')).toBeVisible();
    assert.deepEqual(errors, []);
  } finally {
    await editor?.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test('camera Curve bulges textured layers around a shared center in Edit and Live', { timeout: 25_000 }, async () => {
  const profile = await mkdtemp(join(tmpdir(), 'olive-curve-textures-'));
  const path = join(profile, 'curve.json');
  const sharp = require('sharp');
  const asset = async (name, content) => ({
    alias: `project/27670c9e-9a88-4830-8627-f24dfaf726a1/${name}.png`,
    data: (await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">${content}</svg>`))
      .png().toBuffer()).toString('base64'),
  });
  const backdrop = await asset('backdrop', '<rect width="100" height="100" fill="#2040d0"/><rect x="33" width="3" height="100" fill="#10c050"/>');
  const props = await asset('props', '<rect x="3" width="15" height="100" fill="#ff5020"/><rect x="82" width="15" height="100" fill="#ffd020"/>');
  let editor;
  try {
    await writeFile(path, JSON.stringify({ version: 1, assets: [backdrop, props], config: { renderer: { width: 960, height: 540 } },
      objects: [
        { type: 'Sprite', id: 'back', label: 'Backdrop', texture: backdrop.alias, anchor: { x: 0, y: 0 }, scale: { x: 9.6, y: 5.4 } },
        { type: 'Container', id: 'front', label: 'Props', position: { x: 230, y: 130 }, children: [
          { type: 'Sprite', id: 'markers', label: 'Markers', texture: props.alias, anchor: { x: 0, y: 0 }, scale: { x: 5, y: 2.8 } },
        ] },
        { type: 'Camera2D', id: 'camera', label: 'Camera 2D', position: { x: 480, y: 270 },
          camera: { postFXs: [{ type: 'curve', angle: 90, direction: 'convex', useDepth: false }] } },
      ],
    }));
    editor = await launchEditor(profile);
    await editor.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
      dialog.showMessageBoxSync = () => 1;
    }, path);
    const page = await editor.firstWindow();
    page.setDefaultTimeout(5000);
    const button = (name, where = page) => where.getByRole('button', { name, exact: true });
    const edit = page.getByRole('tabpanel', { name: 'Edit', exact: true });
    const canvas = edit.locator('canvas');
    const red = [255, 80, 32], blue = [32, 64, 208], yellow = [255, 208, 32], green = [16, 192, 80];
    async function markerColorError(view, markers) {
      const { info, data } = await sharp(await view.screenshot()).raw().toBuffer({ resolveWithObject: true });
      const errors = markers.flatMap(([x, expected]) => {
        const offset = (Math.floor(330 * info.height / 540) * info.width + Math.floor(x * info.width / 960)) * info.channels;
        return expected.map((channel, component) => Math.abs(data[offset + component] - channel));
      });
      return Math.max(...errors);
    }
    await button('Open Scene').click();
    const straight = [[280, red], [480, blue], [680, yellow]];
    const convex = [[230, red], [480, blue], [730, yellow]];
    const concave = [[325, red], [480, blue], [635, yellow]];
    await expect.poll(() => markerColorError(canvas, straight)).toBeLessThanOrEqual(4);
    await button('Camera 2D', page.getByRole('complementary', { name: 'Hierarchy' })).click();
    const curve = page.locator('[data-inspector-section="cameraCurve"]');
    await curve.locator(':scope > summary .property-label').click();
    const useDepth = curve.getByRole('checkbox', { name: 'Use Depth' });
    await expect(useDepth).not.toBeChecked();
    await button('Preview Curve', curve).click();
    await expect(canvas).toHaveAttribute('data-effect-preview', 'curve');
    await expect.poll(() => markerColorError(canvas, [...convex, [283, green]])).toBeLessThanOrEqual(4);
    const angle = curve.getByRole('spinbutton', { name: 'Curve Angle' });
    await angle.fill('0');
    await angle.press('Enter');
    await expect.poll(() => markerColorError(canvas, straight)).toBeLessThanOrEqual(4);
    await expect(canvas).toHaveAttribute('data-effect-preview', 'curve');
    await angle.fill('90');
    await angle.press('Enter');
    await expect.poll(() => markerColorError(canvas, convex)).toBeLessThanOrEqual(4);
    await button('Stop Curve Preview', curve).click();

    await useDepth.check();
    const applyDistribution = button('Apply Depth Distribution', curve.locator(':scope > .fields > .effect-fields'));
    await expect(applyDistribution).toBeEnabled();
    await applyDistribution.click();
    await expect(applyDistribution).toBeEnabled();
    await button('View', edit).click();
    await button('Camera', edit).click();
    await expect.poll(() => markerColorError(canvas, [...convex, [283, blue]])).toBeLessThanOrEqual(4);
    await curve.getByRole('combobox', { name: 'Curve Direction' }).selectOption('concave');
    await expect.poll(() => markerColorError(canvas, concave)).toBeLessThanOrEqual(4);
    await button('Play Game').click();
    const live = page.getByRole('tabpanel', { name: 'Live', exact: true }).locator('canvas');
    await expect.poll(() => markerColorError(live, concave)).toBeLessThanOrEqual(4);
    const required = curve.locator('[data-inspector-section="requiredEffects"]');
    const depth = required.locator('[data-inspector-section="cameraDepth"]');
    await depth.locator(':scope > summary .property-label').click();
    await button('Pause Game').click();
    const scale = depth.getByRole('spinbutton', { name: 'Layer Scale' });
    await expect(scale).toHaveValue('0');
    const baseline = await live.screenshot();
    await scale.fill('80');
    await scale.press('Enter');
    await expect(scale).toHaveValue('80');
    await expect.poll(async () => (await live.screenshot()).equals(baseline)).toBe(false);
    await expect(button('Resume Game')).toBeVisible();
    await curve.locator(':scope > .fields > .field').getByRole('checkbox', { name: 'Enabled' }).uncheck();
    await expect(required).toHaveCount(0);
  } finally {
    await editor?.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test('camera Framing crops the world in Preview and Live while the HUD stays visible', { timeout: 25_000 }, async () => {
  const profile = await mkdtemp(join(tmpdir(), 'olive-camera-framing-'));
  const path = join(profile, 'framing.json');
  let editor;
  try {
    await writeFile(path, JSON.stringify({ version: 1, config: { renderer: { width: 960, height: 540, background: '#101010' } },
      objects: [
        { type: 'Graphics', id: 'world', label: 'World', position: { x: 0, y: 0 }, width: 960, height: 540, fill: '#00ff00' },
        { type: 'Graphics', id: 'hud', label: 'HUD', position: { x: 50, y: 50 }, width: 60, height: 40, fill: '#ff00ff',
          screenSpace: { anchor: 'top-left' } },
        { type: 'Camera2D', id: 'camera', label: 'Camera 2D', position: { x: 480, y: 270 },
          camera: { postFXs: [{ type: 'zoom', value: 2 }] } },
      ],
    }));
    editor = await launchEditor(profile);
    await editor.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
      dialog.showMessageBoxSync = () => 1;
    }, path);
    const page = await editor.firstWindow();
    page.setDefaultTimeout(5000);
    const button = (name, where = page) => where.getByRole('button', { name, exact: true });
    const sharp = require('sharp');
    async function colorAt(canvas, x, y, expected) {
      const { info, data } = await sharp(await canvas.screenshot()).raw().toBuffer({ resolveWithObject: true });
      const offset = (Math.floor(y * info.height / 540) * info.width + Math.floor(x * info.width / 960)) * info.channels;
      const actual = [...data.subarray(offset, offset + 3)];
      assert.ok(actual.every((channel, index) => Math.abs(channel - expected[index]) <= 5),
        `Expected ${expected} at ${x}, ${y} but saw ${actual}`);
    }
    await button('Open Scene').click();
    const hierarchy = page.getByRole('complementary', { name: 'Hierarchy' });
    await button('Camera 2D', hierarchy).click();
    await page.getByRole('combobox', { name: 'Add Effect' }).selectOption('framing');
    const framing = page.locator('[data-inspector-section="cameraFraming"]');
    await framing.locator(':scope > summary .property-label').click();
    const edit = page.getByRole('tabpanel', { name: 'Edit', exact: true }).locator('canvas');
    const rendererSize = await edit.evaluate(canvas => [canvas.width, canvas.height]);
    const ratios = framing.getByRole('combobox', { name: 'Aspect Ratio Preset' });
    await expect(ratios).toHaveValue('16:9');
    for (const [ratio, width, height] of [['32:9', '960', '270'], ['4:3', '720', '540'], ['9:20', '243', '540'], ['1:1', '540', '540']]) {
      await ratios.selectOption(ratio);
      await expect(ratios).toHaveValue(ratio);
      await expect(framing.getByRole('spinbutton', { name: 'Frame Width' })).toHaveValue(width);
      await expect(framing.getByRole('spinbutton', { name: 'Frame Height' })).toHaveValue(height);
    }
    await button('Save Scene').click();
    await expect(page.getByRole('img', { name: 'Unsaved changes' })).toHaveCount(0);
    const saved = JSON.parse(await readFile(path, 'utf8'));
    const camera = saved.objects.find(node => node.type === 'Camera2D');
    assert.equal(camera.camera.postFXs.find(effect => effect.type === 'framing').aspectRatio, '1:1');
    assert.deepEqual(await edit.evaluate(canvas => [canvas.width, canvas.height]), rendererSize);
    for (const [name, value] of [['Frame Width', '400'], ['Frame Height', '200']]) {
      const field = framing.getByRole('spinbutton', { name });
      await field.fill(value);
      await field.press('Enter');
    }
    await expect(ratios).toHaveValue('');
    await expect(ratios.locator('option:checked')).toHaveText('Custom');
    await colorAt(edit, 120, 270, [0, 255, 0]);
    await button('Preview Framing', framing).click();
    await expect(edit).toHaveAttribute('data-effect-preview', 'framing');
    await colorAt(edit, 120, 270, [16, 16, 16]);
    await colorAt(edit, 440, 230, [0, 255, 0]);
    await colorAt(edit, 65, 65, [255, 0, 255]);
    await button('Stop Framing Preview', framing).click();
    await colorAt(edit, 120, 270, [0, 255, 0]);
    await button('Play Game').click();
    const live = page.getByRole('tabpanel', { name: 'Live', exact: true }).locator('canvas');
    await expect.poll(async () => JSON.parse(await live.getAttribute('data-game-camera') ?? 'null')).toMatchObject({
      zoom: 2, frame: { x: 280, y: 170, width: 400, height: 200 },
    });
    await colorAt(live, 120, 270, [16, 16, 16]);
    await colorAt(live, 440, 230, [0, 255, 0]);
    await colorAt(live, 65, 65, [255, 0, 255]);
  } finally {
    await editor?.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test('camera filter catalog renders and previews Shockwave', { timeout: 50_000 }, async () => {
  const profile = await mkdtemp(join(tmpdir(), 'olive-camera-filters-'));
  const path = join(profile, 'filters.json');
  const texture = 'project/27670c9e-9a88-4830-8627-f24dfaf726a1/strip.png';
  const sharp = require('sharp');
  const data = (await sharp({ create: { width: 4, height: 2, channels: 3, background: '#ea8655' } })
    .png().toBuffer()).toString('base64');
  const kinds = ['colorGrade', 'fog', 'bloom', 'glow', 'dropShadow', 'outline', 'heatHaze', 'distortion', 'lut',
    'gradient', 'crt', 'oldFilm', 'rgbSplit', 'glitch', 'vignette', 'zoomBlur', 'radialBlur', 'shockwave',
    'bulgePinch', 'reflection', 'parallax'];
  let editor;
  try {
    await writeFile(path, JSON.stringify({ version: 1, assets: [{ alias: texture, data }], objects: [
      { type: 'Graphics', id: 'back', label: 'Back', position: { x: 200, y: 120 }, width: 560, height: 280, fill: '#6494ce' },
      { type: 'Graphics', id: 'front', label: 'Front', position: { x: 370, y: 200 }, width: 240, height: 140, fill: '#efaf54' },
      { type: 'Camera2D', id: 'camera', label: 'Camera 2D', position: { x: 480, y: 270 },
        camera: { postFXs: [{ type: 'lut', settings: { texture } }] } },
    ] }));
    editor = await launchEditor(profile);
    await editor.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
      dialog.showMessageBoxSync = () => 1;
    }, path);
    const page = await editor.firstWindow();
    page.setDefaultTimeout(5000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (/initialize shader|gl\.getProgramInfoLog\(\)|shader.*compil/i.test(message.text())) errors.push(message.text());
    });
    const button = (name, where = page) => where.getByRole('button', { name, exact: true });
    await button('Open Scene').click();
    const edit = page.getByRole('tabpanel', { name: 'Edit', exact: true });
    const canvas = edit.locator('canvas');
    const normal = await canvas.screenshot();
    await button('View', edit).click();
    await button('Camera', edit).click();
    await expect(canvas).toHaveAttribute('data-edit-view', 'camera');
    await expect.poll(async () => (await canvas.screenshot()).equals(normal)).toBe(false);
    const hierarchy = page.getByRole('complementary', { name: 'Hierarchy' });
    await button('Camera 2D', hierarchy).click();
    const add = page.getByRole('combobox', { name: 'Add Effect' });
    const section = kind => page.locator(`[data-inspector-section="cameraFx_${kind}"]`);
    await section('lut').locator('summary').click();
    await expect(section('lut').getByRole('button', { name: 'LUT Image' })).toHaveAttribute('value', texture);
    await button('Remove Color LUT', section('lut')).click();
    for (const kind of kinds) {
      if (kind === 'lut') continue;
      await add.selectOption(kind);
      const current = section(kind);
      await current.locator('summary').click();
      if (kind === 'fog' || kind === 'parallax') await expect(current.getByRole('checkbox', { name: 'Use Depth' })).toBeChecked();
      if (kind === 'shockwave') {
        const steady = await canvas.screenshot();
        const amplitude = current.getByRole('spinbutton', { name: 'Amplitude' });
        await amplitude.fill('75');
        await amplitude.press('Enter');
        await button('Preview Shockwave', current).click();
        await expect(canvas).toHaveAttribute('data-effect-preview', 'shockwave');
        await expect.poll(async () => (await canvas.screenshot()).equals(steady)).toBe(false);
        await button('Stop Shockwave Preview', current).click();
        await expect(canvas).not.toHaveAttribute('data-effect-preview', 'shockwave');
      } else await canvas.screenshot();
      await current.getByRole('button', { name: /^Remove / }).click();
    }
    assert.deepEqual(errors, []);
  } finally {
    await editor?.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test('camera previews run independently and snapshots become selected project assets', { timeout: 25_000 }, async () => {
  const profile = await mkdtemp(join(tmpdir(), 'olive-parallel-fx-'));
  const path = join(profile, 'snapshot.json');
  let editor;
  try {
    await writeFile(path, JSON.stringify({ version: 1, objects: [
      { type: 'Graphics', id: 'card', label: 'Card', position: { x: 420, y: 200 }, width: 120, height: 120, fill: '#ff5020' },
      { type: 'Camera2D', id: 'camera', label: 'Camera 2D', position: { x: 480, y: 270 }, camera: { postFXs: [
        { type: 'move', x: 610, y: 270, duration: 0.25, ease: 'none' },
        { type: 'rotate', angle: 40, duration: 0.35, ease: 'none' },
      ] } },
    ] }));
    editor = await launchEditor(profile);
    await editor.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
      dialog.showMessageBoxSync = () => 1;
    }, path);
    const page = await editor.firstWindow();
    page.setDefaultTimeout(5000);
    const button = (name, where = page) => where.getByRole('button', { name, exact: true });
    const inspector = page.getByRole('complementary', { name: 'Inspector' });
    await button('Open Scene').click();
    await button('Camera 2D', page.getByRole('complementary', { name: 'Hierarchy' })).click();
    const add = inspector.getByRole('combobox', { name: 'Add Effect' });
    await expect(add.locator('optgroup[label="Motion"] option[value="move"]')).toHaveCount(1);
    await expect(add.locator('optgroup[label="Lens and Depth"] option[value="curve"]')).toHaveCount(1);
    const move = inspector.locator('[data-inspector-section="cameraMoveEffect"]');
    const rotate = inspector.locator('[data-inspector-section="cameraRotateEffect"]');
    await rotate.locator(':scope > summary .property-label').click();
    await button('Play Game').click();
    await button('Pause Game').click();
    const canvas = page.getByRole('tabpanel', { name: 'Live' }).locator('canvas');
    await button('Preview Move', move).click();
    await button('Preview Rotate', rotate).click();
    await expect(canvas).toHaveAttribute('data-effect-previews', 'move,rotate');
    await expect(canvas).toHaveAttribute('data-game-camera', /"x":610.*"rotation":40/);
    await new Promise(resolve => setTimeout(resolve, 420));
    await expect(canvas).toHaveAttribute('data-game-camera', /"x":610.*"rotation":40/);
    await button('Stop Move Preview', move).click();
    await expect(canvas).toHaveAttribute('data-effect-previews', 'rotate');
    const looped = canvas.evaluate(element => new Promise(resolve => {
      let atEnd = false;
      const observer = new MutationObserver(() => {
        const rotation = JSON.parse(element.dataset.gameCamera ?? '{}').rotation;
        if (atEnd && rotation < 14) { observer.disconnect(); resolve(true); }
        if (rotation > 30) atEnd = true;
      });
      observer.observe(element, { attributeFilter: ['data-game-camera'] });
      setTimeout(() => { observer.disconnect(); resolve(false); }, 3000);
    }));
    await rotate.getByRole('combobox', { name: 'Preview Playback' }).selectOption('loop');
    assert.equal(await looped, true, 'Loop returns to the beginning of the camera effect');
    await button('Stop Rotate Preview', rotate).click();
    await expect(canvas).not.toHaveAttribute('data-effect-preview');

    const snapshots = page.getByRole('region', { name: 'Assets', exact: true }).locator('.asset-entry').filter({ hasText: /^snapshot-.*\.png$/ });
    const preview = inspector.getByRole('region', { name: 'Asset Preview' });
    await button('Capture Snapshot').click();
    await expect(snapshots).toHaveCount(1);
    await expect(snapshots.first()).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => preview.locator('img').evaluate(image => [image.naturalWidth, image.naturalHeight])).toEqual([960, 540]);
    await page.getByRole('tab', { name: 'Edit', exact: true }).click();
    await button('Capture Snapshot').click();
    await expect(snapshots).toHaveCount(2);
    await expect(snapshots.and(page.locator('[aria-pressed="true"]'))).toHaveCount(1);
    await expect(preview.locator('img')).toBeVisible();
    const media = preview.locator('.asset-preview-media');
    const dockedHeight = (await media.boundingBox()).height;
    await button('Maximize Inspector Panel').click();
    const expanded = await media.boundingBox();
    const image = await media.locator('img').boundingBox();
    const metadata = await preview.locator('.asset-metadata').boundingBox();
    assert.ok(expanded.height > dockedHeight, 'Maximize provides more space for the image');
    assert.ok(image.y >= expanded.y && image.y + image.height <= expanded.y + expanded.height);
    assert.ok(metadata.y >= expanded.y + expanded.height, 'Asset metadata has its own row below the image');
    await button('Restore Inspector Panel').click();
    assert.equal((await media.boundingBox()).height, dockedHeight);
    await button('Save Scene').click();
    await expect(page.getByRole('img', { name: 'Unsaved changes' })).toHaveCount(0);
    const saved = JSON.parse(await readFile(path, 'utf8'));
    assert.ok(saved.assetLibrary.entries.every(entry => entry.folderId === null));
    const { data, info } = await require('sharp')(Buffer.from(saved.assets[1].data, 'base64'))
      .raw().toBuffer({ resolveWithObject: true });
    const offset = (220 * info.width + 440) * info.channels;
    assert.ok(data[offset] > 245 && data[offset + 1] < 90 && data[offset + 2] < 45, 'The PNG contains the game artwork');
  } finally {
    await editor?.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test('camera motion effects and their ease curves preview in Edit and paused Live', { timeout: 30_000 }, async () => {
  const profile = await mkdtemp(join(tmpdir(), 'olive-camera-motion-'));
  const path = join(profile, 'motion.json');
  let editor;
  try {
    await writeFile(path, JSON.stringify({ version: 1, objects: [
      { type: 'Graphics', id: 'target', label: 'Focus Card', position: { x: 650, y: 380 },
        width: 160, height: 90, fill: '#71abd7' },
      { type: 'Camera2D', id: 'camera', label: 'Camera 2D', position: { x: 480, y: 270 }, rotation: 30 },
    ] }));
    editor = await launchEditor(profile);
    await editor.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
      dialog.showMessageBoxSync = () => 1;
    }, path);
    const page = await editor.firstWindow();
    page.setDefaultTimeout(3500);
    const button = (name, where = page) => where.getByRole('button', { name, exact: true });
    await button('Open Scene').click();
    const hierarchy = page.getByRole('complementary', { name: 'Hierarchy' });
    const inspector = page.getByRole('complementary', { name: 'Inspector' });
    const addEffect = inspector.getByRole('combobox', { name: 'Add Effect' });
    await button('Focus Card', hierarchy).click();
    await addEffect.selectOption('outline');
    await button('Camera 2D', hierarchy).click();
    const edit = page.getByRole('tabpanel', { name: 'Edit' }).locator('canvas');
    const section = name => inspector.locator(`[data-inspector-section="camera${name}Effect"]`);
    for (const name of ['Move', 'Follow', 'Focus', 'Rotate']) {
      const kind = name.toLowerCase();
      await addEffect.selectOption(kind);
      const effect = section(name);
      await effect.locator(':scope > summary').click();
      const duration = effect.getByRole('spinbutton', { name: 'Transition Duration' });
      await duration.fill('0');
      await duration.press('Enter');
      if (name === 'Follow' || name === 'Focus') await effect.getByRole('combobox', { name: `${name} Target` }).selectOption('target');
      const steady = await edit.screenshot();
      await button(`Preview ${name}`, effect).click();
      await expect(edit).toHaveAttribute('data-effect-preview', kind);
      assert.ok(!(await edit.screenshot()).equals(steady), `${name} changes the Edit camera`);
      await button(`Stop ${name} Preview`, effect).click();
      await expect(edit).not.toHaveAttribute('data-effect-preview');
      assert.ok((await edit.screenshot()).equals(steady), `${name} restores the Edit camera`);
    }
    const rotate = section('Rotate');
    const graph = rotate.locator('.ease-graph');
    await graph.locator('summary').click();
    await graph.getByRole('combobox', { name: 'Ease Visualizer' }).selectOption('none');
    await expect(graph.getByRole('img', { name: 'Ease Visualizer' })).toBeVisible();
    await button('Play Ease Curve', graph).click();
    await expect(graph.getByText('Value 100%')).toBeVisible();
    const expression = graph.getByRole('textbox', { name: 'Ease Expression' });
    await expression.fill('sine.in(0.4)');
    await expression.press('Enter');
    await expect(expression).toHaveAttribute('aria-invalid', 'true');
    await expression.fill('back.in(0.4)');
    await expression.press('Enter');
    await expect(graph.getByRole('spinbutton', { name: 'Overshoot' })).toHaveValue('0.4');
    await graph.getByRole('slider', { name: 'Progress' }).fill('0.5');
    await expect(graph.getByText('Value 7%')).toBeVisible();
    await expression.fill('cubic-bezier(0.4, 0, 1, 1)');
    await expression.press('Enter');
    const handle = graph.locator('.ease-handle').first();
    await handle.scrollIntoViewIfNeeded();
    const position = await handle.boundingBox();
    assert.ok(position);
    await page.mouse.move(position.x + position.width / 2, position.y + position.height / 2);
    await page.mouse.down();
    await page.mouse.move(position.x + position.width / 2 + 14, position.y + position.height / 2 - 6);
    await page.mouse.up();
    const custom = await expression.inputValue();
    assert.notEqual(custom, 'cubic-bezier(0.4, 0, 1, 1)');
    await button('Apply Ease to Effect', graph).click();
    await expect(rotate.locator('.ease-expression').first().getByRole('textbox')).toHaveValue(custom);
    const angle = rotate.getByRole('spinbutton', { name: 'View Angle' });
    await button('Preview Rotate', rotate).click();
    const originalAngle = await edit.screenshot();
    await angle.fill('18');
    await angle.press('Enter');
    await expect(edit).toHaveAttribute('data-effect-preview', 'rotate');
    await expect.poll(async () => (await edit.screenshot()).equals(originalAngle)).toBe(false);
    const enabled = rotate.getByRole('checkbox', { name: 'Enabled' });
    await enabled.uncheck();
    await expect(edit).not.toHaveAttribute('data-effect-preview');
    await expect(button('Preview Rotate', rotate)).toBeEnabled();
    await enabled.check();
    const reset = button('Reset Rotate Preview', rotate);
    const transition = rotate.getByRole('spinbutton', { name: 'Transition Duration' });
    await expect(reset).toBeDisabled();
    await transition.fill('1');
    await transition.press('Enter');
    await button('Preview Rotate', rotate).click();
    await page.waitForTimeout(1150);
    const settled = await edit.screenshot();
    await reset.click();
    await expect.poll(async () => (await edit.screenshot()).equals(settled)).toBe(false);
    await expect(edit).toHaveAttribute('data-effect-preview', 'rotate');
    await expect(angle).toHaveValue('18');
    await expect(transition).toHaveValue('1');
    await button('Stop Rotate Preview', rotate).click();
    await transition.fill('0');
    await transition.press('Enter');
    await angle.fill('-25');
    await angle.press('Enter');
    const editTab = page.getByRole('tab', { name: 'Edit', exact: true });
    const liveTab = page.getByRole('tab', { name: 'Live', exact: true });
    await button('Preview Rotate', rotate).click();
    await expect(edit).toHaveAttribute('data-effect-preview', 'rotate');
    await button('Play Game').click();
    const live = page.getByRole('tabpanel', { name: 'Live' }).locator('canvas');
    await expect(live).toHaveAttribute('data-game-camera');
    await expect(button('Preview Rotate', rotate)).toBeEnabled();
    await expect(live).not.toHaveAttribute('data-effect-preview');
    await button('Pause Game').click();
    const before = await live.getAttribute('data-game-camera');
    await button('Preview Rotate', rotate).click();
    await expect(live).toHaveAttribute('data-effect-preview', 'rotate');
    await expect(live).toHaveAttribute('data-game-camera', /"rotation":-25/);
    // The old preview expired after one second for an instant rotation.
    await new Promise(resolve => setTimeout(resolve, 1300));
    await expect(live).toHaveAttribute('data-effect-preview', 'rotate');
    await expect(live).toHaveAttribute('data-game-camera', /"rotation":-25/);
    await editTab.click();
    await expect(edit).not.toHaveAttribute('data-effect-preview');
    await button('Preview Rotate', rotate).click();
    await expect(edit).toHaveAttribute('data-effect-preview', 'rotate');
    await liveTab.click();
    await expect(live).not.toHaveAttribute('data-effect-preview');
    await expect(live).toHaveAttribute('data-game-camera', before);
    await expect(button('Resume Game')).toBeVisible();
    await button('Preview Rotate', rotate).click();
    await expect(live).toHaveAttribute('data-effect-preview', 'rotate');
    await expect(angle).toBeEnabled();
    await angle.fill('18');
    await angle.press('Enter');
    await expect(live).toHaveAttribute('data-game-camera', /"rotation":18/);
    await expect(live).toHaveAttribute('data-effect-preview', 'rotate');
    await reset.click();
    await expect(live).toHaveAttribute('data-effect-preview', 'rotate');
    await enabled.uncheck();
    await expect(live).not.toHaveAttribute('data-effect-preview');
    await expect(live).toHaveAttribute('data-game-camera', /"rotation":0/);
    await expect(button('Preview Rotate', rotate)).toBeEnabled();
    await angle.fill('25');
    await angle.press('Enter');
    await enabled.check();
    await expect(live).toHaveAttribute('data-game-camera', /"rotation":25/);
    await expect(live).not.toHaveAttribute('data-effect-preview');
    await button('Focus Card', hierarchy).click();
    const outline = inspector.locator('[data-inspector-section="effectOutline"]');
    await outline.locator('summary').click();
    const thickness = outline.getByRole('spinbutton', { name: 'Outline Thickness' });
    const thinOutline = await live.screenshot();
    await thickness.fill('12');
    await thickness.press('Enter');
    await expect.poll(async () => (await live.screenshot()).equals(thinOutline)).toBe(false);
    await expect(button('Resume Game')).toBeVisible();
    await button('Stop Game').click();
    await expect(angle).toHaveValue('25');
    await button('Remove Focus', section('Focus').locator(':scope > summary')).click();
    await expect(section('Focus')).toHaveCount(0);
    const settings = name => inspector.locator(`[data-inspector-section="camera${name}Effect"] > .fields > .effect-fields`);
    if (await section('Follow').getAttribute('open') === null) await section('Follow').locator(':scope > summary .property-label').click();
    if (await rotate.getAttribute('open') === null) await rotate.locator(':scope > summary .property-label').click();
    await settings('Follow').getByRole('combobox', { name: 'Follow Mode' }).selectOption('tracking');
    await settings('Follow').getByRole('combobox', { name: 'Follow Target' }).selectOption('target');
    await expect(settings('Follow').getByRole('spinbutton', { name: 'Smoothing' })).toHaveValue('0');
    await settings('Rotate').getByRole('combobox', { name: 'Rotation Source' }).selectOption('object');
    await addEffect.selectOption('viewport');
    await expect(inspector.locator('[data-inspector-section="cameraViewportRelative"] summary')).toBeVisible();
    await button('Play Game').click();
    await expect.poll(async () => JSON.parse(await live.getAttribute('data-game-camera') ?? 'null'))
      .toMatchObject({ x: 650, y: 380 });
    const trackingFrame = JSON.parse(await live.getAttribute('data-game-camera'));
    assert.ok(Math.abs(trackingFrame.rotation - 30) < 0.001);
  } finally {
    await editor?.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test('project scenes migrate a legacy file, remap copied tracks, and preview additive and stacked links with transitions', { timeout: 30_000 }, async () => {
  const profile = await mkdtemp(join(tmpdir(), 'olive-project-scenes-'));
  const legacy = join(profile, 'legacy.json');
  const saved = join(profile, 'project.json');
  let editor;
  try {
    await writeFile(legacy, JSON.stringify({
      version: 1,
      objects: [{ type: 'Graphics', id: 'shape', label: 'Legacy Shape', position: { x: 400, y: 250 } }],
      timeline: [{ id: 'shift', target: 'shape', property: 'x', keys: [{ id: 'key-1', time: 0, value: 400 }] }],
    }));
    editor = await launchEditor(profile);
    await editor.evaluate(({ dialog }, paths) => {
      const files = [paths.legacy, paths.saved];
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [files.shift()] });
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: paths.saved });
      dialog.showMessageBoxSync = () => 1;
    }, { legacy, saved });
    const page = await editor.firstWindow();
    const button = (scope, name) => scope.getByRole('button', { name, exact: true });
    const dirty = page.getByRole('img', { name: 'Unsaved changes' });
    await button(page, 'Open Scene').click();
    await expect(button(page, 'Legacy Shape')).toBeVisible();
    await button(page, 'Panels').click();
    await page.getByRole('checkbox', { name: 'Scenes', exact: true }).check();
    const scenes = page.getByRole('region', { name: 'Scenes', exact: true });
    await expect(button(scenes, 'legacy')).toHaveAttribute('aria-pressed', 'true');
    await button(scenes, 'Duplicate Scene').click();
    await expect(button(scenes, 'legacy Copy')).toHaveAttribute('aria-pressed', 'true');
    const name = scenes.getByRole('textbox', { name: 'Scene Name' });
    await name.fill('Overlay');
    await name.press('Enter');
    await button(scenes, 'legacy').click();
    const mode = scenes.getByRole('combobox', { name: 'Scene Link Action' });
    const transition = scenes.getByRole('combobox', { name: 'Scene Transition', exact: true });
    await button(scenes, 'Add Scene Link').click();
    await button(scenes, 'Remove Scene Link').click();
    await expect(button(scenes, 'Remove Scene Link')).toHaveCount(0);
    for (const action of ['add', 'remove', 'replace']) {
      await mode.selectOption(action);
      if (action === 'add') await transition.selectOption('fade');
      if (action === 'remove') await transition.selectOption('slide');
      await button(scenes, 'Add Scene Link').click();
    }
    const loadEffect = scenes.getByRole('combobox', { name: 'Scene Transition · Load Overlay', exact: true });
    await loadEffect.selectOption('squeeze');
    const loadDuration = scenes.getByRole('spinbutton', { name: 'Transition Duration (ms) · Load Overlay', exact: true });
    await loadDuration.fill('450');
    await loadDuration.press('Enter');
    await mode.selectOption('push');
    await transition.selectOption('fade');
    await scenes.getByRole('combobox', { name: 'Back Transition', exact: true }).selectOption('zoom');
    await button(scenes, 'Add Scene Link').click();
    await button(scenes, 'Overlay').click();
    await expect(button(scenes, 'Delete Scene')).toBeDisabled();
    await button(scenes, 'Set Startup Scene').click();
    await button(scenes, 'legacy').click();
    await button(scenes, 'Play Scene Flow').click();
    await expect(scenes.getByRole('status')).toHaveText('Playing legacy');
    const canvas = page.locator('#viewport-pane-live canvas');
    await button(scenes, 'Load Overlay').click();
    await expect(scenes.getByText('Loaded alongside: Overlay')).toBeVisible();
    await expect(canvas).toHaveAttribute('data-scene-transition', 'squeeze');
    await expect(canvas).not.toHaveAttribute('data-scene-transition', /./);
    await button(scenes, 'Unload Overlay').click();
    await expect(canvas).toHaveAttribute('data-scene-transition', 'slide');
    await expect(scenes.getByText('Loaded alongside: Overlay')).toHaveCount(0);
    await expect(canvas).not.toHaveAttribute('data-scene-transition', /./);
    await button(scenes, 'Push Overlay').click();
    await expect(scenes.getByRole('status')).toHaveText('Playing Overlay');
    await button(scenes, 'Back to legacy').click();
    await expect(canvas).toHaveAttribute('data-scene-transition', 'zoom');
    await expect(scenes.getByRole('status')).toHaveText('Playing legacy');
    await button(scenes, 'Open Overlay').click();
    await expect(scenes.getByRole('status')).toHaveText('Playing Overlay');
    await button(scenes, 'Stop Scene Flow').click();
    await expect(button(scenes, 'legacy')).toHaveAttribute('aria-pressed', 'true');
    await button(page, 'Save Scene').click();
    await expect(dirty).toHaveCount(0);
    const doc = JSON.parse(await readFile(saved, 'utf8'));
    assert.equal(doc.version, 2);
    assert.equal(doc.startup, doc.scenes[1].id);
    assert.equal(doc.scenes[0].timeline[0].target, 'shape');
    assert.deepEqual(doc.scenes[0].links.find(link => link.mode === 'push').transition, { kind: 'fade', ms: 300 });
    assert.deepEqual(doc.scenes[0].links.find(link => link.mode === 'push').backTransition, { kind: 'zoom', ms: 300 });
    assert.deepEqual(doc.scenes[0].links.find(link => link.mode === 'add').transition, { kind: 'squeeze', ms: 450 });
    assert.deepEqual(doc.scenes[0].links.find(link => link.mode === 'remove').transition, { kind: 'slide', ms: 300 });
    assert.notEqual(doc.scenes[1].objects[0].id, 'shape');
    assert.equal(doc.scenes[1].timeline[0].target, doc.scenes[1].objects[0].id);
    await button(page, 'Open Scene').click();
    await expect(button(scenes, 'Overlay')).toHaveAttribute('aria-pressed', 'true');
    await button(scenes, 'legacy').click();
    await expect(dirty).toHaveCount(0);
  } finally {
    await editor?.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test('shared object selection supports batch edits, marquee, group move, pivot, and locks', { timeout: 30_000 }, async () => {
  const profile = await mkdtemp(join(tmpdir(), 'olive-object-selection-'));
  let editor;
  try {
    editor = await launchEditor(profile);
    await editor.evaluate(({ dialog }) => { dialog.showMessageBoxSync = () => 1; });
    const page = await editor.firstWindow();
    const hierarchy = page.getByRole('complementary', { name: 'Hierarchy' });
    const inspector = page.getByRole('complementary', { name: 'Inspector' });
    const scene = page.getByRole('region', { name: 'Scene', exact: true });
    const button = (scope, name) => scope.getByRole('button', { name, exact: true });
    const number = name => inspector.getByRole('spinbutton', { name, exact: true });
    const crystal = button(hierarchy, 'Olive Crystal');
    const title = button(hierarchy, 'Scene Title');
    const assertSelected = async () => {
      await expect(crystal).toHaveAttribute('aria-pressed', 'true');
      await expect(title).toHaveAttribute('aria-pressed', 'true');
      await expect(inspector.getByText('2 objects selected', { exact: true })).toBeVisible();
    };
    await crystal.click();
    await title.click({ modifiers: ['Meta'] });
    await assertSelected();
    await expect(number('Position Y')).toHaveAttribute('placeholder', 'Mixed');
    await number('Rotation').fill('15');
    await number('Rotation').press('Enter');
    await expect(number('Rotation')).toHaveValue('15');
    await button(page, 'Undo').click();
    await assertSelected();
    await expect(number('Rotation')).toHaveValue('0');

    await button(hierarchy, 'Scene Root').click();
    const canvas = await scene.locator('canvas').boundingBox();
    const at = (x, y) => [canvas.x + x * canvas.width / 960, canvas.y + y * canvas.height / 540];
    await page.mouse.move(...at(360, 132));
    await page.mouse.down();
    await page.mouse.move(...at(610, 410), { steps: 6 });
    await page.mouse.up();
    await assertSelected();
    await button(scene, 'Move').click();
    await page.mouse.move(...at(480, 226));
    await page.mouse.down();
    await page.mouse.move(...at(540, 226), { steps: 6 });
    await page.mouse.up();
    await assertSelected();
    await expect.poll(async () => Number(await number('Position X').inputValue())).toBeCloseTo(540, 0);
    await button(page, 'Undo').click();
    await expect(number('Position X')).toHaveValue('480');
    await assertSelected();

    await crystal.click();
    const quick = scene.getByRole('group', { name: 'Quick Object Settings' });
    const before = (await quick.boundingBox()).x;
    await button(inspector, 'Top Left Pivot').click();
    await expect(number('Pivot X')).toHaveValue('-24');
    await expect(number('Position X')).toHaveValue('408');
    await expect.poll(async () => (await quick.boundingBox()).x).toBe(before);
    await button(inspector, 'Flip Horizontal').click();
    await expect(number('Scale X')).toHaveValue('-3');
    await button(inspector, 'Lock Selection').click();
    await expect(number('Position X')).toBeDisabled();
    await button(inspector, 'Unlock Selection').click();
    await expect(number('Position X')).toBeEnabled();
  } finally {
    await editor?.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test('Director timeline previews a tween and saves keyframes without changing the authored scene', { timeout: 25_000 }, async () => {
  const profile = await mkdtemp(join(tmpdir(), 'olive-director-timeline-'));
  const path = join(profile, 'timeline.json');
  let editor;
  try {
    editor = await launchEditor(profile);
    await editor.evaluate(({ dialog }, path) => {
      dialog.showMessageBoxSync = () => 1;
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
    }, path);
    const page = await editor.firstWindow();
    const button = (scope, name) => scope.getByRole('button', { name, exact: true });
    await button(page, 'Panels').click();
    await page.getByRole('checkbox', { name: 'Timeline', exact: true }).check();
    const timeline = page.getByRole('region', { name: 'Timeline', exact: true });
    const scene = page.getByRole('region', { name: 'Scene', exact: true });
    const quick = scene.getByRole('group', { name: 'Quick Object Settings' });
    await button(timeline, 'Add Track').click();
    const lastValue = timeline.getByRole('spinbutton', { name: 'Value 2', exact: true });
    await lastValue.fill('280');
    await lastValue.press('Enter');
    await timeline.getByRole('combobox', { name: 'Easing 2', exact: true }).selectOption('easeInOut');
    const lastTime = timeline.getByRole('spinbutton', { name: 'Time (s) 2', exact: true });
    await lastTime.fill('2');
    await lastTime.press('Enter');
    const scrubber = timeline.getByRole('slider', { name: 'Timeline position' });
    const home = (await quick.boundingBox()).x;
    await button(timeline, 'Play Timeline').click();
    await expect.poll(async () => Number(await scrubber.inputValue())).toBeGreaterThan(0.1);
    await button(timeline, 'Pause Timeline').click();
    const paused = await scrubber.inputValue();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(scrubber).toHaveValue(paused);
    await scrubber.press('End');
    await expect(scrubber).toHaveValue('2');
    await expect.poll(async () => (await quick.boundingBox()).x).toBeLessThan(home - 40);
    await button(timeline, 'Stop Timeline').click();
    await expect(scrubber).toHaveValue('0');
    await expect.poll(async () => (await quick.boundingBox()).x).toBe(home);

    await button(page, 'Save Scene').click();
    await expect(page.getByRole('img', { name: 'Unsaved changes' })).toHaveCount(0);
    const saved = JSON.parse(await readFile(path, 'utf8'));
    assert.equal(saved.objects[0].children[0].position.x, 480);
    assert.equal(saved.timeline[0].target, 'sample-sprite');
    assert.deepEqual(saved.timeline[0].keys.map(({ time, value, ease }) => [time, value, ease]),
      [[0, 480, 'linear'], [2, 280, 'easeInOut']]);
  } finally {
    await editor?.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test('scene audio plays and pauses a spatial source and tracks the listener', { timeout: 25_000 }, async () => {
  const profile = await mkdtemp(join(tmpdir(), 'olive-spatial-audio-test-'));
  const path = join(profile, 'spatial.json');
  let editor;
  try {
    editor = await launchEditor(profile);
    await editor.evaluate(({ dialog }, path) => {
      dialog.showMessageBoxSync = () => 1;
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
    }, path);
    const page = await editor.firstWindow();
    const button = (scope, name) => scope.getByRole('button', { name, exact: true });
    const inspector = page.getByRole('complementary', { name: 'Inspector' });
    const assets = page.getByRole('region', { name: 'Assets', exact: true });
    const hierarchy = page.getByRole('complementary', { name: 'Hierarchy' });
    const scene = page.getByRole('region', { name: 'Scene', exact: true });
    async function setNumber(name, value) {
      const input = inspector.getByRole('spinbutton', { name, exact: true });
      await input.fill(String(value));
      await input.press('Enter');
    }

    await button(assets, 'chime.wav').click();
    await button(inspector, 'Add to Scene').click();
    await expect(inspector.getByRole('combobox', { name: 'Clip' })).toHaveValue('sounds/chime.wav');
    await setNumber('Position X', 100);
    await setNumber('Position Y', 100);
    await inspector.getByRole('checkbox', { name: 'Autoplay', exact: true }).check();
    await inspector.getByRole('checkbox', { name: 'Loop', exact: true }).check();
    await inspector.getByRole('checkbox', { name: 'Spatial', exact: true }).check();
    await setNumber('Full Volume Radius', 20);
    await setNumber('Maximum Radius', 220);
    await button(hierarchy, 'More Objects').click();
    await button(hierarchy, 'Add Audio Listener').click();
    await setNumber('Position X', 100);
    await setNumber('Position Y', 100);

    const voice = () => page.evaluate(() => {
      const [howl] = globalThis.Howler?._howls ?? [];
      const [sound] = howl?._sounds ?? [];
      return sound && { playing: howl.playing(), gain: howl.volume(), pan: Math.round(sound._panner?.pan?.value * 100) / 100 };
    });
    await button(scene, 'Play Scene Audio').click();
    await expect.poll(voice).toEqual({ playing: true, gain: 1, pan: 0 });
    await setNumber('Position X', 200);
    await expect.poll(voice).toEqual({ playing: true, gain: 0.6, pan: -0.91 });
    await button(scene, 'Pause Scene Audio').click();
    await expect.poll(voice).toMatchObject({ playing: false });
    await button(scene, 'Resume Scene Audio').click();
    await expect.poll(voice).toMatchObject({ playing: true });
    await button(scene, 'Stop Scene Audio').click();
    await expect.poll(voice).toBeUndefined();

    await button(page, 'Save Scene').click();
    await expect(page.getByRole('img', { name: 'Unsaved changes' })).toHaveCount(0);
    const saved = JSON.parse(await readFile(path, 'utf8'));
    assert.equal(saved.objects.find(node => node.type === 'AudioSource').maxDistance, 220);
    assert.equal(saved.objects.find(node => node.type === 'AudioListener').position.x, 200);
  } finally {
    await editor?.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test('viewport navigation places the tools, zooms at the pointer, and frames the selection', { timeout: 20_000 }, async () => {
  const profile = await mkdtemp(join(tmpdir(), 'olive-navigation-test-'));
  let editor;
  try {
    editor = await launchEditor(profile);
    const page = await editor.firstWindow();
    const stage = page.getByRole('region', { name: 'Scene', exact: true });
    const canvas = stage.locator('canvas');
    const controls = stage.getByRole('group', { name: 'Viewport alignment' });
    const tools = stage.getByRole('group', { name: 'Scene Tools' });
    const button = (scope, name) => scope.getByRole('button', { name, exact: true });
    const viewport = await stage.locator('.canvas').boundingBox();
    const initial = await canvas.boundingBox();
    const move = await button(tools, 'Move').boundingBox();
    const rotate = await button(tools, 'Rotate').boundingBox();
    const alignment = await controls.boundingBox();
    assert.ok(move.x + move.width <= viewport.x && move.x === rotate.x && move.y < rotate.y);
    assert.ok(alignment.y + alignment.height <= viewport.y && alignment.x > move.x);

    const reset = button(controls, 'Reset Zoom');
    await button(controls, 'Zoom In').click();
    await expect(reset).toHaveText('125%');
    assert.ok((await canvas.boundingBox()).width > initial.width);
    await button(controls, 'Zoom Out').click();
    await expect(reset).toHaveText('100%');

    const pointer = { x: Math.round(initial.x + initial.width * 0.7), y: Math.round(initial.y + initial.height * 0.6) };
    await page.mouse.move(pointer.x, pointer.y);
    await page.mouse.wheel(0, -150);
    await expect.poll(async () => (await canvas.boundingBox()).width).toBeGreaterThan(initial.width);
    const zoomed = await canvas.boundingBox();
    assert.ok(Math.abs(zoomed.x + (pointer.x - initial.x) * zoomed.width / initial.width - pointer.x) < 1);
    assert.ok(Math.abs(zoomed.y + (pointer.y - initial.y) * zoomed.height / initial.height - pointer.y) < 1);
    await reset.click();
    await expect(reset).toHaveText('100%');

    await button(page, 'Olive Crystal').click();
    await button(tools, 'Frame Selection').click();
    const framed = await canvas.boundingBox();
    assert.ok(Math.abs(framed.x + 480 * framed.width / 960 - viewport.x - viewport.width / 2) < 2);
    assert.ok(Math.abs(framed.y + 226 * framed.height / 540 - viewport.y - viewport.height / 2) < 2);
    assert.equal(await page.getByText('Unsaved changes', { exact: true }).count(), 0);
  } finally {
    await editor?.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test('viewport quick controls follow the selection and transform tools draw distinct gizmos', { timeout: 20_000 }, async () => {
  const profile = await mkdtemp(join(tmpdir(), 'olive-gizmo-test-'));
  let editor;
  try {
    editor = await launchEditor(profile);
    await editor.evaluate(({ dialog }) => { dialog.showMessageBoxSync = () => 1; });
    const page = await editor.firstWindow();
    page.setDefaultTimeout(5000);
    const stage = page.getByRole('region', { name: 'Scene', exact: true });
    const inspector = page.getByRole('complementary', { name: 'Inspector' });
    const hierarchy = page.getByRole('complementary', { name: 'Hierarchy' });
    const button = (scope, name) => scope.getByRole('button', { name, exact: true });
    const quick = stage.getByRole('group', { name: 'Quick Object Settings' });
    const canvas = stage.locator('canvas');

    await button(hierarchy, 'Scene Root').click();
    await expect(button(stage, 'Skew')).toHaveCount(0);
    await button(hierarchy, 'Scene Title').click();
    const content = quick.getByRole('textbox', { name: 'Quick Text', exact: true });
    await content.fill('Field Notes');
    await content.press('Enter');
    await inspector.locator('summary[data-tip="Text"]').click();
    await expect(inspector.getByRole('textbox', { name: 'Content', exact: true })).toHaveValue('Field Notes');
    const size = quick.getByRole('spinbutton', { name: 'Quick Font Size', exact: true });
    await size.fill('48');
    await size.press('Enter');
    await expect(inspector.getByRole('spinbutton', { name: 'Font Size', exact: true })).toHaveValue('48');
    await button(quick, 'Align Right').click();
    await expect(inspector.getByRole('combobox', { name: 'Alignment', exact: true })).toHaveValue('right');

    await button(hierarchy, 'Olive Crystal').click();
    await expect(content).toHaveCount(0);
    await expect(quick.getByLabel('Quick Tint')).toBeVisible();
    const canvasBounds = await canvas.boundingBox();
    const originalMenu = await quick.boundingBox();
    assert.ok(originalMenu.y >= canvasBounds.y + (226 + 72) * canvasBounds.height / 540);
    const y = inspector.getByRole('spinbutton', { name: 'Position Y', exact: true });
    await y.fill('250');
    await y.press('Enter');
    await expect.poll(async () => (await quick.boundingBox()).y).toBeGreaterThan(originalMenu.y + 8);
    await button(page, 'Undo').click();
    await expect(y).toHaveValue('226');
    await button(stage, 'Move').click();
    await expect(button(stage, 'Move')).toHaveCSS('border-top-color', 'rgb(112, 202, 255)');
    const moveGizmo = await canvas.screenshot();
    await button(stage, 'Rotate').click();
    await expect(button(stage, 'Rotate')).toHaveCSS('border-top-color', 'rgb(255, 191, 104)');
    const rotateGizmo = await canvas.screenshot();
    assert.ok(!moveGizmo.equals(rotateGizmo));

    await button(stage, 'Skew').click();
    await expect(button(stage, 'Skew')).toHaveCSS('border-top-color', 'rgb(220, 155, 255)');
    assert.ok(!(await canvas.screenshot()).equals(rotateGizmo));
    const rect = await canvas.boundingBox();
    const point = (x, y) => [rect.x + x * rect.width / 960, rect.y + y * rect.height / 540];
    const topHandle = 154 - 19 / Math.min(rect.width / 960, rect.height / 540);
    await page.mouse.move(...point(480, topHandle));
    await page.mouse.down();
    await page.mouse.move(...point(530, topHandle + 20), { steps: 8 });
    await page.mouse.up();
    const skewX = inspector.getByRole('spinbutton', { name: 'Skew X', exact: true });
    const skewY = inspector.getByRole('spinbutton', { name: 'Skew Y', exact: true });
    await expect.poll(async () => Number(await skewX.inputValue())).toBeLessThan(-5);
    await expect(skewY).toHaveValue('0');
    await button(page, 'Undo').click();
    await expect(skewX).toHaveValue('0');
  } finally {
    await editor?.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test('Scripts edit TypeScript, attach behaviours, and debug QuickJS Preview', { timeout: 45_000 }, async () => {
  const profile = await mkdtemp(join(tmpdir(), 'olive-scripts-'));
  const saved = join(profile, 'script-project.json');
  const fixture = join(profile, 'script-fixture.json');
  let editor;
  try {

    const source = [
      'export function update(self: GameObject) {',
      '  const increment = 10;',
      '  self.x += increment;',
      "  game.log('preview x', self.x);",
      '}',
    ].join('\n');
    const compiled = '"use strict"; Object.defineProperty(exports, "__esModule", {value: true}); ' +
      source.replace('export function update(self: GameObject)', 'function update(self)') + ' exports.update = update;';
    await writeFile(fixture, JSON.stringify({
      version: 2, startup: 'main',
      scripts: { version: 1, items: [{ id: 'movement', name: 'Script', source, code: compiled }] },
      scenes: [{ id: 'main', name: 'Movement', objects: [
        { id: 'target', type: 'Text', label: 'Script Target', text: 'Movement', position: { x: 100, y: 100 } },
        { id: 'missing', type: 'Container', label: 'Missing Behaviour', behaviour: { scriptId: 'removed', params: {}, refs: {} } },
      ] }],
    }));
    editor = await launchEditor(profile);
    await editor.evaluate(({ dialog }, paths) => {
      const filePaths = [paths.fixture, paths.saved];
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: paths.saved });
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePaths.shift()] });
      dialog.showMessageBoxSync = () => 1;
    }, { saved, fixture });
    const page = await editor.firstWindow();
    const button = (name) => page.getByRole('button', { name, exact: true });
    const openPanel = async name => {
      await button('Panels').click();
      await page.getByRole('checkbox', { name, exact: true }).check();
    };
    await button('Open Scene').click();
    await button('Script Target').click();
    await openPanel('Scripts');
    const code = page.getByTestId('script-editor');
    await expect(code.locator('.view-lines')).toContainText('preview');
    const literal = code.locator('.view-line span').filter({ hasText: /^10$/ });
    await literal.last().dblclick();
    await page.keyboard.insertText('20');
    await expect(code.locator('.view-lines')).toContainText('20;');
    await button('Attach to selected').click();
    await expect(page.getByTestId('script-status')).toHaveText('Ready for Preview');
    const original = await page.getByRole('spinbutton', { name: 'Position X' }).inputValue();
    const line = code.locator('.view-line').filter({ hasText: 'self.x += increment' });
    await line.scrollIntoViewIfNeeded();
    const lineBox = await line.boundingBox();
    const gutter = await code.locator('.glyph-margin').boundingBox();
    assert.ok(lineBox && gutter);
    await page.mouse.click(gutter.x + gutter.width / 2, lineBox.y + lineBox.height / 2);
    await expect(page.getByTestId('script-debugger').getByRole('button', { name: 'Script:3', exact: true })).toBeVisible();
    await page.getByRole('textbox', { name: /watch expression/i }).fill('increment');
    await page.getByTestId('script-debugger').getByRole('button', { name: 'Add', exact: true }).click();
    await openPanel('Scenes');
    await button('Play Scene Flow').click();
    await page.getByRole('tab', { name: 'Scripts', exact: true }).click();
    await expect(page.getByTestId('debug-status')).toContainText('Script:3').catch(async error => {
      const output = await page.getByTestId('script-console').innerText();
      const debuggerOutput = await page.getByTestId('script-debugger').innerText();
      throw new Error(`${error.message}\n${output}\n${debuggerOutput}`);
    });
    await expect(page.locator('[data-local="increment"]')).toHaveText('increment20');
    await expect(page.locator('[data-watch="increment"]')).toContainText('20');
    const consoleView = page.getByTestId('script-console');
    await expect(consoleView.locator('[data-level="error"]')).toContainText('Missing Behaviour');
    const log = consoleView.locator('[data-level="info"]');
    await expect(log).toHaveText(['preview x 120']);
    await page.getByTestId('script-debugger').getByRole('button', { name: /step/i }).click();
    await expect(log).toHaveText(['preview x 120', 'preview x 140']);
    await page.getByTestId('script-debugger').getByRole('button', { name: /clear breakpoints/i }).click();
    await button('Continue').click();
    await expect(log.nth(2)).toBeVisible();
    await page.getByRole('tab', { name: 'Scenes', exact: true }).click();
    await button('Stop Scene Flow').click();
    await expect(page.getByRole('spinbutton', { name: 'Position X' })).toHaveValue(original);
    await button('Save Scene').click();
    await expect(page.getByRole('img', { name: 'Unsaved changes' })).toHaveCount(0);
    const project = JSON.parse(await readFile(saved, 'utf8'));
    assert.equal(project.scripts.items[0].source, source.replace('= 10;', '= 20;'));
    assert.equal(project.scenes[0].objects[0].behaviour.scriptId, project.scripts.items[0].id);
    await button('Open Scene').click();
    await page.getByRole('tab', { name: 'Scripts', exact: true }).click();
    await expect(code.locator('.view-lines')).toContainText('preview');
    await button('Close Scripts Panel').click();
    await expect(page.getByRole('region', { name: 'Scripts', exact: true })).toHaveCount(0);
  } finally {
    await editor?.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test('Matter physics authors colliders, reports sensor contacts, and steps exactly once', { timeout: 35_000 }, async () => {
  const profile = await mkdtemp(join(tmpdir(), 'olive-matter-'));
  const fixture = join(profile, 'matter-input.json');
  const saved = join(profile, 'matter-saved.json');
  let editor;
  try {
    const offset = { offsetX: 0, offsetY: 0 };
    await writeFile(fixture, JSON.stringify({
      version: 2, startup: 'main',
      scripts: { version: 1, items: [{
        id: 'contact', name: 'Contact',
        source: "export function onCollision(self: GameObject, other: GameObject) { game.log(other.name, self.body.mass > 0); }",
        code: "exports.onCollision = (self, other) => { game.log(other.name, self.body.mass > 0); };",
      }] },
      scenes: [{ id: 'main', name: 'Physics Playground', objects: [
        { id: 'ball', type: 'Graphics', label: 'Ball', shape: 'ellipse', width: 30, height: 30, position: { x: 420, y: 120 },
          behaviour: { scriptId: 'contact', params: {}, refs: {} } },
        { id: 'sensor', type: 'Graphics', label: 'Trigger Plate', width: 160, height: 16, position: { x: 420, y: 225 },
          physics: { colliders: [{ id: 'trigger-box', kind: 'box', data: { width: 160, height: 16, ...offset, sensor: true } }] } },
        { id: 'floor', type: 'Graphics', label: 'Ground', width: 350, height: 30, position: { x: 420, y: 350 },
          physics: { colliders: [{ id: 'floor-box', kind: 'box', data: { width: 350, height: 30, ...offset, sensor: false } }] } },
      ] }],
    }));
    editor = await launchEditor(profile);
    await editor.evaluate(({ dialog }, paths) => {
      const files = [paths.fixture, paths.saved];
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [files.shift()] });
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: paths.saved });
      dialog.showMessageBoxSync = () => 1;
    }, { fixture, saved });
    const page = await editor.firstWindow();
    const button = (name, scope = page) => scope.getByRole('button', { name, exact: true });
    const openPanel = async name => {
      await button('Panels').click();
      await page.getByRole('checkbox', { name, exact: true }).check();
    };

    await button('Open Scene').click();
    await button('Ball').click();
    const inspector = page.getByRole('complementary', { name: 'Inspector' });
    await inspector.locator('summary').filter({ hasText: 'Physics 2D' }).click();
    await inspector.getByRole('combobox', { name: 'Rigid Body Type' }).selectOption('dynamic');
    await inspector.getByRole('combobox', { name: 'Add Collider' }).selectOption('circle');
    await button('Fit to Visual', inspector).click();
    await expect(inspector.getByRole('spinbutton', { name: 'Collider Radius' })).toHaveValue('15');

    await openPanel('Physics');
    const physics = page.getByRole('region', { name: 'Physics', exact: true });
    const gravity = physics.getByRole('spinbutton', { name: 'Gravity Y' });
    await gravity.fill('820');
    await gravity.press('Enter');
    await button('Add Layer', physics).click();
    await physics.getByRole('checkbox', { name: 'Layer 2 Collides With Layer 2', exact: true }).uncheck();
    await button('Show Collider Outlines', physics).click();
    await expect(button('Show Collider Outlines', physics)).toHaveAttribute('aria-pressed', 'true');

    await openPanel('Scenes');
    await button('Play Scene Flow').click();
    await page.getByRole('tab', { name: 'Physics', exact: true }).click();
    const contacts = physics.getByRole('list', { name: 'Recent Contacts' });
    await expect(contacts).toContainText(/Trigger Plate.*Sensor|Ball.*Sensor/);
    await expect(contacts).toContainText('Ground');
    await button('Pause Physics', physics).click();
    const steps = physics.getByRole('status');
    const before = Number((await steps.textContent()).match(/(\d+) steps/)?.[1]);
    assert.ok(before > 0);
    await button('Step Physics', physics).click();
    await expect(steps).toHaveText(`3 bodies · ${before + 1} steps`);

    await openPanel('Scripts');
    await expect(page.getByTestId('script-console')).toContainText('Ground true');
    await page.getByRole('tab', { name: 'Scenes', exact: true }).click();
    await button('Stop Scene Flow').click();
    await button('Save Scene').click();
    await expect(page.getByRole('img', { name: 'Unsaved changes' })).toHaveCount(0);
    const project = JSON.parse(await readFile(saved, 'utf8'));
    assert.equal(project.physics.gravityY, 820);
    assert.deepEqual(project.physics.layers, ['Default', 'Layer 2']);
    assert.equal(project.physics.collisions[1] & 2, 0);
    assert.equal(project.scenes[0].objects[0].position.y, 120);
    assert.equal(project.scenes[0].objects[0].physics.colliders[0].data.radius, 15);
    await button('Open Scene').click();
    await page.getByRole('tab', { name: 'Physics', exact: true }).click();
    await expect(gravity).toHaveValue('820');
  } finally {
    await editor?.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test('Director clips record keys, crossfade, show ghosts, and fire nested game cues', { timeout: 45_000 }, async () => {
  const profile = await mkdtemp(join(tmpdir(), 'olive-cinematics-'));
  const fixture = join(profile, 'cinematic.json');
  const saved = join(profile, 'cinematic-saved.json');
  let editor;
  try {
    const track = (id, start, end) => ({
      id, target: 'card', property: 'x', keys: [{ id: id + '-a', time: 0, value: start }, { id: id + '-b', time: 1, value: end }],
    });
    await writeFile(fixture, JSON.stringify({
      version: 2, startup: 'main', globals: { version: 1, items: [
        { id: 'score', name: 'score', type: 'number', initial: 0 },
        { id: 'finished', name: 'finished', type: 'number', initial: 0 },
        { id: 'directed', name: 'directed', type: 'number', initial: 0 },
      ] },
      scenes: [{ id: 'main', name: 'Opening',
        objects: [{ id: 'card', type: 'Graphics', label: 'Title Card',
          position: { x: 200, y: 150 }, width: 70, height: 45, fill: '#f1eee1' }],
        cinematics: { director: [{ id: 'opening', name: 'Opening Signal', event: 'scene:ready',
          whenExpr: 'sceneId == "main"', source: JSON.stringify({ vars: { zoom: 1.2 }, root: { type: 'sequence', children: [
            { type: 'delay', ms: 30 }, { type: 'camera', zoom: '$zoom', ms: 25 },
            { type: 'global', target: 'directed', value: '7' },
          ] } }) }], clips: [
          { id: 'pan', name: 'Pan', tracks: [track('pan-x', 200, 520)],
            cues: [{ id: 'fade', kind: 'clip', time: 0.8, name: 'Return', target: 'return', fade: 0.12 }] },
          { id: 'return', name: 'Return', tracks: [track('return-x', 90, 90)],
            cues: [{ id: 'finish', kind: 'global', time: 0.2, name: 'Finish', target: 'finished', value: '1' }] },
        ] },
      }],
    }));
    editor = await launchEditor(profile);
    await editor.evaluate(({ dialog }, paths) => {
      let next = paths.fixture;
      dialog.showOpenDialog = async () => {
        const name = next;
        next = paths.saved;
        return { canceled: false, filePaths: [name] };
      };
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: paths.saved });
      dialog.showMessageBoxSync = () => 1;
    }, { fixture, saved });
    const page = await editor.firstWindow();
    const button = (scope, name) => scope.getByRole('button', { name, exact: true });
    const openPanel = async name => {
      const menu = button(page, 'Panels');
      if (await menu.getAttribute('aria-expanded') !== 'true') await menu.click();
      await page.getByRole('checkbox', { name, exact: true }).check();
      await page.keyboard.press('Escape');
    };
    await button(page, 'Open Scene').click();
    await button(page, 'Title Card').click();
    await openPanel('Timeline');
    const timeline = page.getByRole('region', { name: 'Timeline', exact: true });
    const director = timeline.locator('.director-panel');
    await director.locator(':scope > summary').click();
    const composition = director.getByRole('region', { name: 'Opening Signal' });
    await composition.getByText('Start on Event', { exact: false }).click();
    await expect(composition.getByRole('combobox', { name: 'Event Trigger' })).toHaveValue('scene:ready');
    await button(composition, 'Preview Composition').click();
    await expect(composition.getByRole('status')).toHaveText('Preview complete');
    await button(composition, 'Stop Director Preview').click();
    await expect(composition.getByRole('status')).toHaveText('Preview stopped');
    await composition.getByRole('combobox', { name: 'Add Step' }).selectOption('visibility');
    const visibility = composition.getByRole('region', { name: 'Set Visibility' });
    await visibility.getByRole('combobox', { name: 'Cue Target' }).selectOption('card');
    await button(visibility, 'Move Step Up').click();
    await expect(composition.locator('.director-step-list > li > section > header > strong')).toHaveText([
      'Wait', 'Camera', 'Set Visibility', 'Set Global',
    ]);
    await button(composition, 'Advanced JSON').click();
    const source = composition.getByRole('textbox', { name: 'Composition JSON' });
    const authored = JSON.parse(await source.inputValue());
    assert.deepEqual(authored.vars, { zoom: 1.2 });
    assert.deepEqual(authored.root.children[2], { type: 'visibility', target: 'card', visible: true });
    await source.fill('{');
    await button(composition, 'Apply JSON').click();
    await expect(composition.getByRole('alert')).toBeVisible();
    await button(composition, 'Discard Changes').click();
    await button(composition, 'Steps').click();
    await button(composition, 'Add Cue at Playhead').click();
    const directorCue = timeline.getByRole('region', { name: 'Cue 1', exact: true });
    await expect(directorCue.getByRole('combobox', { name: 'Cue Action' })).toHaveValue('director');
    await directorCue.getByRole('button', { name: 'Remove Cue', exact: true }).click();
    await timeline.locator('summary').filter({ hasText: /^Cues$/ }).click();
    await director.locator(':scope > summary').click();
    const select = timeline.getByRole('combobox', { name: 'Clip', exact: true });
    const scrubber = timeline.getByRole('slider', { name: 'Timeline position' });
    const canvas = page.getByRole('region', { name: 'Scene', exact: true }).locator('canvas');
    const viewport = page.getByLabel('Scene viewport', { exact: true });
    const quick = page.getByRole('group', { name: 'Quick Object Settings' });

    await button(timeline, 'New Clip').click();
    const name = timeline.getByRole('textbox', { name: 'Clip Name' });
    await name.fill('Extra');
    await name.press('Enter');
    await expect(select.locator('option:checked')).toHaveText('Extra');
    await select.selectOption('pan');
    await scrubber.fill('0.5');
    await expect(timeline.getByRole('img', { name: 'Keyframe Curve' })).toBeVisible();
    const clean = await canvas.screenshot();
    await timeline.getByRole('checkbox', { name: 'Onion Skin' }).check();
    assert.ok(!clean.equals(await canvas.screenshot()), 'The two neighbouring poses are rendered into the canvas');
    await timeline.getByRole('checkbox', { name: 'Onion Skin' }).uncheck();
    assert.ok(clean.equals(await canvas.screenshot()), 'Turning onion skin off restores the original image');

    await button(timeline, 'Record Keys').click();
    await button(page, 'Move').click();
    await viewport.focus();
    await viewport.press('Shift+ArrowRight');
    const middleValue = timeline.getByRole('spinbutton', { name: 'Value 2', exact: true });
    await expect(middleValue).toHaveValue('370');
    await expect(timeline.getByRole('spinbutton', { name: 'Time (s) 2', exact: true })).toHaveValue('0.5');
    await button(timeline, 'Record Keys').click();

    const fade = timeline.getByRole('spinbutton', { name: 'Crossfade (s)', exact: true });
    await fade.fill('1.2');
    await fade.press('Enter');
    const x = (await quick.boundingBox()).x;
    await select.selectOption('return');
    const afterSwitch = (await quick.boundingBox()).x;
    assert.ok(afterSwitch > x - 65, 'Crossfade begins at the sampled position');
    await expect.poll(async () => (await quick.boundingBox()).x).toBeLessThan(x - 100);
    await expect(button(timeline, 'Play Timeline')).toBeEnabled();
    await expect(scrubber).toHaveValue('1');
    await button(timeline, 'Stop Timeline').click();
    const curve = timeline.getByRole('img', { name: 'Keyframe Curve' });
    await curve.scrollIntoViewIfNeeded();
    const key = await curve.locator('[data-key="1"]').boundingBox();
    assert.ok(key);
    await page.keyboard.down('Alt');
    await page.mouse.move(key.x + key.width / 2, key.y + key.height / 2);
    await page.mouse.down();
    await page.mouse.move(key.x + key.width / 2, key.y + key.height / 2 + 16);
    await page.mouse.up();
    await page.keyboard.up('Alt');
    await expect.poll(async () => Number(await timeline.getByRole('spinbutton', { name: 'Value 1', exact: true }).inputValue())).toBeLessThan(90);
    await expect(timeline.getByRole('spinbutton', { name: 'Time (s) 1', exact: true })).toHaveValue('0');

    await select.selectOption('pan');
    await scrubber.fill('0.5');
    await timeline.locator('summary').filter({ hasText: /^Cues$/ }).click();
    await button(timeline, 'Add Cue').click();
    const cue = timeline.getByRole('region', { name: 'Cue 2', exact: true });
    await cue.getByRole('combobox', { name: 'Cue Action' }).selectOption('global');
    await cue.getByRole('combobox', { name: 'Cue Target' }).selectOption('score');
    const cueValue = cue.getByRole('textbox', { name: 'Value', exact: true });
    await cueValue.fill('9');
    await cueValue.blur();
    await button(timeline, 'Stop Timeline').click();
    await select.selectOption('timeline');
    await timeline.locator('summary').filter({ hasText: /^Nested Clips$/ }).click();
    await timeline.getByRole('combobox', { name: 'Add Nested Clip' }).selectOption('pan');
    const nested = timeline.getByRole('region', { name: 'Nested Clip 1' });
    const nestedStart = nested.getByRole('spinbutton', { name: 'Start Time (s)' });
    await nestedStart.fill('0.2');
    await nestedStart.press('Enter');
    const nestedSpeed = nested.getByRole('spinbutton', { name: 'Playback Speed' });
    await nestedSpeed.fill('2');
    await nestedSpeed.press('Enter');
    await timeline.getByRole('checkbox', { name: 'Play on Scene Start' }).check();
    await scrubber.press('End');

    await openPanel('Globals');
    const initial = page.getByRole('spinbutton', { name: 'Initial Value for score' });
    await expect(initial).toHaveValue('0');
    await openPanel('Scenes');
    await button(page, 'Play Scene Flow').click();
    await page.getByRole('tab', { name: 'Globals', exact: true }).click();
    await expect(page.getByRole('spinbutton', { name: 'Current Value for score' })).toHaveValue('9');
    await expect(page.getByRole('spinbutton', { name: 'Current Value for finished' })).toHaveValue('1');
    await expect(page.getByRole('spinbutton', { name: 'Current Value for directed' })).toHaveValue('7');
    await expect.poll(async () => {
      const view = await page.locator('canvas[data-game-camera]').getAttribute('data-game-camera');
      return Number(JSON.parse(view).zoom.toFixed(4));
    }).toBe(1.2);
    await page.getByRole('tab', { name: 'Scenes', exact: true }).click();
    await button(page, 'Stop Scene Flow').click();

    await button(page, 'Save Scene').click();
    await expect(page.getByRole('img', { name: 'Unsaved changes' })).toHaveCount(0);
    const project = JSON.parse(await readFile(saved, 'utf8'));
    assert.equal(project.scenes[0].objects[0].position.x, 200);
    const library = project.scenes[0].cinematics;
    assert.equal(library.autoplay, 'timeline');
    const savedDirector = JSON.parse(library.director[0].source);
    assert.equal(savedDirector.root.children[2].target, 'card');
    assert.equal(savedDirector.vars.zoom, 1.2);
    assert.deepEqual(library.main.nested.map(({ clip, start, speed }) => ({ clip, start, speed })), [{ clip: 'pan', start: 0.2, speed: 2 }]);
    assert.equal(library.clips[0].tracks[0].keys.find(key => key.time === 0.5).value, 370);
    await button(page, 'Open Scene').click();
    await page.getByRole('tab', { name: 'Timeline', exact: true }).click();
    await expect(select.locator('option')).toHaveText(['Main Timeline', 'Pan', 'Return', 'Extra']);
  } finally {
    await editor?.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test('Lighting renders colored lights and collider shadows under the camera without darkening HUD', { timeout: 35_000 }, async () => {
  const profile = await mkdtemp(join(tmpdir(), 'olive-lighting-'));
  const fixture = join(profile, 'lighting.json');
  const saved = join(profile, 'lighting-saved.json');
  let editor;
  try {
    await writeFile(fixture, JSON.stringify({
      version: 2, startup: 'lit', scenes: [{ id: 'lit', name: 'Lighting Test',
        lighting: { enabled: true, ambient: '#202020' },
        objects: [
          { type: 'Graphics', id: 'floor', label: 'Floor', width: 960, height: 540, fill: '#ffffff', position: { x: 0, y: 0 } },
          { type: 'Graphics', id: 'wall', label: 'Shadow Wall', width: 40, height: 240, fill: '#fafafa', position: { x: 430, y: 140 },
            physics: { colliders: [{ id: 'wall-box', kind: 'box', data: { width: 40, height: 240, offsetX: 20, offsetY: 120, sensor: false } }] } },
          { type: 'Light2D', id: 'lamp', label: 'Warm Lamp', position: { x: 260, y: 260 },
            light: { color: '#ff4010', radius: 850, intensity: 1, flicker: 0, shadows: true } },
          { type: 'Graphics', id: 'hud', label: 'Badge', width: 55, height: 40, fill: '#30c8ff', position: { x: 20, y: 20 },
            screenSpace: { anchor: 'top-left' } },
          { type: 'Camera2D', id: 'camera', label: 'Camera', position: { x: 480, y: 270 }, camera: { zoom: 1.25 } },
        ],
      }],
    }));
    editor = await launchEditor(profile);
    await editor.evaluate(({ dialog }, paths) => {
      const queue = [paths.fixture, paths.saved];
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [queue.shift()] });
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: paths.saved });
      dialog.showMessageBoxSync = () => 1;
    }, { fixture, saved });
    const page = await editor.firstWindow();
    const button = (name, scope = page) => scope.getByRole('button', { name, exact: true });
    const openPanel = async name => {
      if (await button('Panels').getAttribute('aria-expanded') !== 'true') await button('Panels').click();
      await page.getByRole('checkbox', { name, exact: true }).check();
      await page.keyboard.press('Escape');
    };
    const canvas = page.getByRole('region', { name: 'Scene', exact: true }).locator('canvas');
    const inspector = page.getByRole('complementary', { name: 'Inspector' });
    async function pixels(points) {
      const image = (await canvas.screenshot()).toString('base64');
      return page.evaluate(async ({ image, points }) => {
        const img = new Image();
        img.src = 'data:image/png;base64,' + image;
        await img.decode();
        const target = document.createElement('canvas');
        target.width = img.width;
        target.height = img.height;
        const context = target.getContext('2d');
        context.drawImage(img, 0, 0);
        return points.map(([x, y]) => Array.from(context.getImageData(
          Math.floor(x * img.width / 960), Math.floor(y * img.height / 540), 1, 1).data).slice(0, 3));
      }, { image, points });
    }
    const near = [315, 260], behind = [580, 260], hud = [35, 30], far = [890, 440];
    const closeTo = (actual, wanted) => actual.every((channel, i) => Math.abs(channel - wanted[i]) <= 4);

    await button('Open Scene').click();
    await expect(button('Warm Lamp')).toBeVisible();
    await openPanel('Lighting');
    const lighting = page.getByRole('region', { name: 'Lighting', exact: true });
    const [lit, shaded, badge] = await pixels([near, behind, hud]);
    assert.ok(lit[0] > 170 && lit[0] > lit[1] + 80, `Colored point light, saw ${lit}`);
    assert.ok(closeTo(shaded, [32, 32, 32]), `Static collider shadow, saw ${shaded}`);
    assert.ok(closeTo(badge, [48, 200, 255]), `HUD stays unlit, saw ${badge}`);
    await button('Preview Lighting in Editor', lighting).click();
    assert.ok(closeTo((await pixels([behind]))[0], [255, 255, 255]));
    await button('Preview Lighting in Editor', lighting).click();

    await button('Shadow Wall').click();
    await inspector.locator('summary').filter({ hasText: /^Shadows$/ }).click();
    await inspector.getByRole('combobox', { name: 'Shadow Caster' }).selectOption('off');
    assert.ok((await pixels([behind]))[0][0] > 100);
    await inspector.getByRole('combobox', { name: 'Shadow Caster' }).selectOption('bounds');
    assert.ok(closeTo((await pixels([behind]))[0], [32, 32, 32]));
    await button('Warm Lamp').click();
    await inspector.getByRole('checkbox', { name: 'Cast Shadows' }).uncheck();
    assert.ok((await pixels([behind]))[0][0] > 100);
    await inspector.getByRole('checkbox', { name: 'Cast Shadows' }).check();
    await lighting.getByLabel('Ambient Color').fill('#282828');
    assert.ok(closeTo((await pixels([far]))[0], [40, 40, 40]));

    await openPanel('Scenes');
    await button('Play Scene Flow').click();
    await expect(canvas).toHaveAttribute('data-game-camera', /1\.25/);
    const place = ([x, y]) => [480 + (x - 480) * 1.25, 270 + (y - 270) * 1.25];
    const [cameraLit, cameraShadow, cameraHud] = await pixels([place(near), place(behind), hud]);
    assert.ok(cameraLit[0] > 170 && cameraLit[0] > cameraLit[1] + 80);
    assert.ok(closeTo(cameraShadow, [40, 40, 40]), `Zoomed shadow, saw ${cameraShadow}`);
    assert.ok(closeTo(cameraHud, [48, 200, 255]));
    await button('Stop Scene Flow').click();
    await page.getByRole('tab', { name: 'Hierarchy', exact: true }).click();

    await button('Add Point Light 2D', lighting).click();
    await expect(button('Point Light 2D')).toBeVisible();
    const radius = inspector.getByRole('spinbutton', { name: 'Light Radius', exact: true });
    await radius.fill('290');
    await radius.press('Enter');
    await button('Save Scene').click();
    await expect(page.getByRole('img', { name: 'Unsaved changes' })).toHaveCount(0);
    const document = JSON.parse(await readFile(saved, 'utf8'));
    assert.deepEqual(document.scenes[0].lighting, { enabled: true, ambient: '#282828' });
    assert.equal(document.scenes[0].objects.find(node => node.id === 'wall').shadowCaster, 'bounds');
    assert.equal(document.scenes[0].objects.find(node => node.label === 'Point Light 2D').light.radius, 290);
    await button('Open Scene').click();
    await expect(button('Point Light 2D')).toBeVisible();
    await expect(lighting.getByLabel('Ambient Color')).toHaveValue('#282828');
  } finally {
    await editor?.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test('Game export writes playable HTML, ZIP, offline PWA and Capacitor targets and blocks missing assets', { timeout: 55_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'olive-game-build-'));
  const fixture = join(root, 'example.json');
  const broken = join(root, 'broken.json');
  const zip = join(root, 'game.zip');
  const gameSaveKey = '5305fc15-a0ea-445d-b484-ebb644c85d96';
  const project = {
    version: 2, startup: 'main',
    gameSave: { key: gameSaveKey, revision: 1 },
    globals: { version: 1, items: [{ id: 'score', name: 'score', type: 'number', initial: 2 }] },
    scripts: { version: 1, items: [{
      id: 'switch', name: 'Switch',
      source: 'export function start() { game.log("scene ready"); } export function onInput(self: SceneSelf, action: string) { if (action === "next") game.pushScene("Next"); }',
      code: 'exports.start = () => game.log("scene ready"); exports.onInput = (self, action) => { if (action === "next") game.pushScene("Next"); };',
    }, {
      id: 'back', name: 'Back',
      source: 'export function onInput(self: SceneSelf, action: string) { if (action === "back") game.popScene(); }',
      code: 'exports.onInput = (self, action) => { if (action === "back") game.popScene(); };',
    }], scenes: { main: { scriptId: 'switch', params: {}, refs: {} }, next: { scriptId: 'back', params: {}, refs: {} } } },
    inputMap: { version: 1, deadzone: 0.2, actions: [
      { id: 'next', name: 'next', kind: 'button', bindings: [{ type: 'key', code: 'KeyN' }] },
      { id: 'back', name: 'back', kind: 'button', bindings: [{ type: 'key', code: 'KeyB' }] },
    ] },
    scenes: [
      { id: 'main', name: 'Opening', links: [{ mode: 'push', target: 'next', transition: { kind: 'fade', ms: 100 } }], objects: [
        { id: 'crystal', type: 'Sprite', label: 'Crystal', texture: 'images/olive-crystal.png',
          position: { x: 400, y: 200 }, scale: { x: 3, y: 3 } },
      ], cinematics: { autoplay: 'timeline', main: { cues: [
        { id: 'score-cue', kind: 'global', target: 'score', value: '7', name: 'Set score', time: 0.1 },
      ] } } },
      { id: 'next', name: 'Next', objects: [
        { id: 'card', type: 'Graphics', label: 'Next Card', fill: '#dead91', width: 960, height: 540, position: { x: 0, y: 0 } },
      ] },
    ],
  };
  const routes = new Map();
  let editor;
  const server = createServer(async (req, res) => {
    try {
      const [, route, ...parts] = new URL(req.url, 'http://127.0.0.1').pathname.split('/');
      const folder = routes.get(route);
      if (!folder) { res.writeHead(404).end(); return; }
      const file = resolve(folder, parts.map(decodeURIComponent).join('/') || 'index.html');
      if (!file.startsWith(folder + sep)) { res.writeHead(404).end(); return; }
      const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json',
        '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.wav': 'audio/wav', '.mp3': 'audio/mpeg' };
      res.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream');
      const bytes = await readFile(file);
      res.end(bytes);
    } catch { res.writeHead(404).end(); }
  });
  try {
    await writeFile(fixture, JSON.stringify(project));
    await writeFile(broken, JSON.stringify({
      version: 1, objects: [{ type: 'Sprite', id: 'lost', label: 'Lost image', texture: 'images/missing.png' }],
    }));
    editor = await launchEditor(join(root, 'profile'));
    await editor.evaluate(({ dialog }, paths) => {
      const scenes = [paths.fixture, paths.broken];
      dialog.showOpenDialog = async (_window, options) => ({ canceled: false,
        filePaths: [options.properties.includes('openDirectory') ? paths.root : scenes.shift()] });
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: paths.zip });
      dialog.showMessageBoxSync = () => 1;
    }, { fixture, broken, root, zip });
    const page = await editor.firstWindow();
    page.setDefaultTimeout(8000);
    const button = (scope, name) => scope.getByRole('button', { name, exact: true });
    await button(page, 'Open Scene').click();
    await expect(button(page, 'Crystal')).toBeVisible();
    await button(page, 'Export Game').click();
    const modal = page.getByRole('dialog', { name: 'Export Game' });
    const format = modal.getByRole('combobox');
    const action = button(modal, 'Export');
    await modal.getByLabel('Game Title').fill('Olive < Test');
    async function build(target) {
      await format.selectOption(target);
      await action.click();
      const status = modal.getByRole('status');
      await expect(status).toContainText('Exported to');
      return (await status.innerText()).replace(/^Exported to /, '');
    }
    const html = await build('html');
    assert.equal(JSON.parse(await readFile(join(html, 'config.json'), 'utf8')).renderer.width, 960);
    assert.ok((await readFile(join(html, 'index.html'), 'utf8')).includes('Olive &lt; Test'));
    assert.ok((await readFile(join(html, 'project.json'), 'utf8')).includes('images/olive-crystal.png'));
    assert.equal(JSON.parse(await readFile(join(html, 'compatibility.json'), 'utf8')).target, 'html');

    assert.equal(await build('zip'), zip);
    execFileSync('unzip', ['-tq', zip]);
    const archive = execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8' }).split('\n');
    assert.ok(archive.includes('index.html') && archive.includes('project.json') && archive.includes('compatibility.json'));
    const expanded = join(root, 'expanded');
    execFileSync('unzip', ['-q', zip, '-d', expanded]);

    const pwa = await build('pwa');
    const manifest = JSON.parse(await readFile(join(pwa, 'manifest.webmanifest'), 'utf8'));
    assert.equal(manifest.name, 'Olive < Test');
    for (const icon of manifest.icons) {
      const png = await readFile(join(pwa, icon.src));
      assert.equal(png.readUInt32BE(16), Number(icon.sizes.split('x')[0]));
    }
    await format.selectOption('capacitor');
    const appId = modal.getByLabel('Application ID');
    await appId.fill('bad');
    await expect(action).toBeDisabled();
    await appId.fill('com.olive.exporttest');
    const capacitor = await build('capacitor');
    assert.deepEqual(JSON.parse(await readFile(join(capacitor, 'capacitor.config.json'), 'utf8')), {
      appId: 'com.olive.exporttest', appName: 'Olive < Test', webDir: 'www',
    });
    const mobile = JSON.parse(await readFile(join(capacitor, 'package.json'), 'utf8'));
    assert.ok(mobile.dependencies['@capacitor/ios'] && mobile.dependencies['@capacitor/android']);

    routes.set('html', html);
    routes.set('zip', expanded);
    routes.set('pwa', pwa);
    routes.set('mobile', join(capacitor, 'www'));
    await new Promise((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', done); });
    const origin = `http://127.0.0.1:${server.address().port}`;
    const gameWindow = editor.waitForEvent('window');
    await editor.evaluate(({ BrowserWindow }, url) => {
      const tab = new BrowserWindow({ width: 900, height: 640, webPreferences: { sandbox: true } });
      void tab.loadURL(url);
    }, origin + '/html/');
    const game = await gameWindow;
    game.setDefaultTimeout(8000);
    const play = button(game, 'Play');
    const ready = game.waitForEvent('console', { predicate: message => message.text() === 'scene ready', timeout: 8000 });
    await play.click();
    await ready;
    await expect(game.locator('canvas')).toBeVisible();
    await game.getByText('Game Saves', { exact: true }).click();
    const save = button(game, 'Save Game Slot');
    await expect.poll(async () => {
      await save.click();
      return game.evaluate(key => JSON.parse(localStorage.getItem('olive.game-save.' + key + '.1'))?.values?.score, gameSaveKey);
    }).toBe(7);
    await game.getByText('Game Saves', { exact: true }).click();
    await game.locator('#game').focus();
    await game.keyboard.press('KeyN');
    await game.getByText('Game Saves', { exact: true }).click();
    await expect.poll(async () => {
      await save.click();
      return game.evaluate(key => JSON.parse(localStorage.getItem('olive.game-save.' + key + '.1'))?.main, gameSaveKey);
    }).toBe('next');
    await game.getByText('Game Saves', { exact: true }).click();
    await game.locator('#game').focus();
    await game.keyboard.press('KeyB');
    await game.getByText('Game Saves', { exact: true }).click();
    await expect.poll(async () => {
      await save.click();
      return game.evaluate(key => JSON.parse(localStorage.getItem('olive.game-save.' + key + '.1'))?.main, gameSaveKey);
    }).toBe('main');

    for (const path of ['zip', 'mobile', 'pwa']) {
      await game.goto(origin + '/' + path + '/');
      await play.click();
      await expect(game.locator('canvas')).toBeVisible();
    }
    await expect.poll(() => game.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    await new Promise(resolve => server.close(resolve));
    await game.reload();
    await play.click();
    await expect(game.locator('canvas')).toBeVisible();
    await game.close();

    await button(modal, 'Dismiss').click();
    await button(page, 'Open Scene').click();
    await expect(button(page, 'Lost image')).toBeVisible();
    await button(page, 'Export Game').click();
    await expect(modal.getByRole('region', { name: 'Compatibility Report' })).toContainText('images/missing.png');
    await expect(action).toBeDisabled();
  } finally {
    if (server.listening) server.close();
    await editor?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('Colyseus previews two players, simulates latency and reconnects the same seat', { timeout: 45_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'olive-colyseus-'));
  const fixture = join(root, 'online.json');
  let editor;
  let external;
  try {
    await writeFile(fixture, JSON.stringify({
      version: 1, objects: [{ id: 'avatar', type: 'Graphics', label: 'Avatar', width: 28, height: 28, fill: '#de2157',
        position: { x: 200, y: 160 } }],
    }));
    editor = await launchEditor(join(root, 'profile'));
    await editor.evaluate(({ dialog }, paths) => {
      dialog.showOpenDialog = async (_window, options) => ({ canceled: false,
        filePaths: [options.properties.includes('openDirectory') ? paths.root : paths.fixture] });
      dialog.showMessageBoxSync = () => 1;
    }, { fixture, root });
    const page = await editor.firstWindow();
    page.setDefaultTimeout(8000);
    const button = (scope, name) => scope.getByRole('button', { name, exact: true });
    const openPanel = async name => {
      const menu = button(page, 'Panels');
      if (await menu.getAttribute('aria-expanded') !== 'true') await menu.click();
      await page.getByRole('checkbox', { name, exact: true }).check();
      await page.keyboard.press('Escape');
    };
    await button(page, 'Open Scene').click();
    await button(page, 'Avatar').click();
    await openPanel('Multiplayer');
    const panel = page.getByRole('region', { name: 'Multiplayer', exact: true });
    await button(panel, 'Set Up Movement Keys').click();
    await expect(panel.getByRole('checkbox', { name: 'Enable Multiplayer' })).toBeChecked();
    await expect(page.getByRole('spinbutton', { name: 'Player Speed', exact: true })).toHaveValue('220');

    await openPanel('Scenes');
    await button(page, 'Play Scene Flow').click();
    const canvas = page.getByRole('region', { name: 'Scene', exact: true }).locator('canvas');
    await expect(canvas).toHaveAttribute('data-multiplayer', 'connected', { timeout: 14000 });
    const room = panel.getByRole('region', { name: 'Room game' });
    await expect(room.getByRole('rowheader', { name: 'Editor Player' })).toBeVisible();

    const newWindow = editor.waitForEvent('window', { timeout: 12000 });
    await button(panel, 'Open Test Client').click();
    const peer = await newWindow.catch(async error => {
      const errors = await panel.getByRole('alert').allTextContents();
      throw new Error([error.message, ...errors].join('\n'));
    });
    peer.setDefaultTimeout(8000);
    await button(peer, 'Play').click();
    const peerCanvas = peer.locator('canvas');
    await expect(peerCanvas).toHaveAttribute('data-multiplayer', 'connected');
    await expect(room).toContainText('2/4 connected');
    const peerRow = room.getByRole('row', { name: /Test Client 1/ });
    const seat = await peerRow.getAttribute('data-player');
    const xCell = peerRow.getByRole('cell').first();
    const startingX = Number(await xCell.innerText());
    await peer.locator('#game').focus();
    await peer.keyboard.down('ArrowRight');
    try {
      await expect.poll(async () => Number(await xCell.innerText())).toBeGreaterThan(startingX + 15);
    } finally { await peer.keyboard.up('ArrowRight'); }

    const latency = panel.getByRole('spinbutton', { name: 'Simulated Latency (ms)' });
    await latency.fill('400');
    await latency.press('Enter');
    await expect(latency).toHaveValue('400');
    await button(panel, 'Drop Test Client 1').click();
    await expect(peerCanvas).toHaveAttribute('data-multiplayer', 'reconnecting', { timeout: 8000 });
    await expect(peerCanvas).toHaveAttribute('data-multiplayer', 'connected', { timeout: 12000 });
    await expect(peerRow).toHaveAttribute('data-player', seat);
    await expect(room).toContainText('2/4 connected');
    await button(panel, 'Stop Local Server').click();
    await expect(panel.getByText('Server Offline', { exact: true })).toBeVisible();
    await expect.poll(() => peer.isClosed()).toBe(true);

    await button(page, 'Export Game').click();
    const modal = page.getByRole('dialog', { name: 'Export Game', exact: true });
    await expect(modal.getByRole('region', { name: 'Compatibility Report' })).toContainText('Colyseus room and rules');
    await button(modal, 'Export').click();
    const status = modal.getByRole('status');
    await expect(status).toContainText('Exported to');
    const output = (await status.innerText()).replace(/^Exported to /, '');
    const server = join(output, 'server');
    const rules = JSON.parse(await readFile(join(server, 'rules.json'), 'utf8'));
    assert.deepEqual(rules.spawn, { x: 200, y: 160 });
    external = spawn(process.execPath, [join(server, 'server.mjs'), '--host', '127.0.0.1', '--port', '0'],
      { stdio: ['ignore', 'pipe', 'pipe'] });
    const endpoint = await new Promise((resolve, reject) => {
      let stderr = '';
      const timer = setTimeout(() => reject(new Error(stderr || 'Exported server startup timed out')), 7000);
      external.stderr.on('data', chunk => { stderr += chunk; });
      external.on('error', error => { clearTimeout(timer); reject(error); });
      external.on('exit', code => { clearTimeout(timer); reject(new Error(stderr || `Exported server exited ${code}`)); });
      external.stdout.on('data', chunk => {
        const match = String(chunk).match(/ws:\/\/127\.0\.0\.1:(\d+)/);
        if (match) { clearTimeout(timer); resolve(Number(match[1])); }
      });
    });
    assert.ok(endpoint > 0);
  } finally {
    if (external?.exitCode === null) {
      const exit = new Promise(resolve => external.once('exit', resolve));
      external.kill('SIGTERM');
      await exit;
    }
    await editor?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('dock panels minimize to their rail, maximize to the window, and restore their dock', { timeout: 30_000 }, async () => {
  const profile = await mkdtemp(join(tmpdir(), 'olive-panel-modes-'));
  let editor;
  try {
    editor = await launchEditor(profile);
    let page = await editor.firstWindow();
    const button = (name, scope = page) => scope.getByRole('button', { name, exact: true });
    const inspector = () => page.getByRole('complementary', { name: 'Inspector', exact: true });
    const hierarchy = () => page.getByRole('complementary', { name: 'Hierarchy', exact: true });
    const rails = () => page.locator('.dock-rail');
    const original = await inspector().boundingBox();
    assert.ok(original);

    const separator = name => page.getByRole('separator', { name, exact: true });
    const left = separator('Resize Left Dock');
    const right = separator('Resize Right Dock');
    const lowerRight = separator('Resize Lower Right Dock');
    const lower = separator('Resize Assets Panel');
    const assets = () => page.locator('#dock-content-assets .panel');
    const bundles = () => page.locator('#dock-content-bundles .panel');
    const scene = () => page.locator('#dock-content-scene');
    const rail = (name) => rails().filter({ has: page.getByRole('group', { name, exact: true }) });
    const sceneWidth = (await scene().boundingBox()).width;
    const assetsWidth = (await assets().boundingBox()).width;
    const bundlesWidth = (await bundles().boundingBox()).width;
    const lowerSize = await lower.getAttribute('aria-valuenow');
    await right.dblclick();
    await expect(inspector()).toBeHidden();
    await expect(bundles()).toBeVisible();
    await expect(rail('Right Dock')).toHaveAttribute('data-vertical', 'true');
    assert.equal((await rail('Right Dock').boundingBox()).width, 33);
    assert.ok((await scene().boundingBox()).width > sceneWidth);
    assert.equal((await bundles().boundingBox()).width, bundlesWidth);
    await right.dblclick();
    await expect(inspector()).toBeVisible();
    assert.equal((await scene().boundingBox()).width, sceneWidth);
    await lowerRight.dblclick();
    await expect(bundles()).toBeHidden();
    await expect(inspector()).toBeVisible();
    await expect(rail('Lower Right Dock')).toHaveAttribute('data-vertical', 'true');
    assert.ok((await assets().boundingBox()).width > assetsWidth);
    assert.equal((await scene().boundingBox()).width, sceneWidth);
    await lowerRight.dblclick();
    await expect(bundles()).toBeVisible();
    await lower.dblclick();
    await expect(assets()).toBeHidden();
    await expect(bundles()).toBeHidden();
    await expect(button('Close Assets Panel', rails())).toBeVisible();
    await expect(rail('Lower Right Dock')).not.toHaveAttribute('data-vertical', 'true');
    await lower.dblclick();
    await expect(assets()).toBeVisible();
    await expect(bundles()).toBeVisible();
    await expect(lower).toHaveAttribute('aria-valuenow', lowerSize);
    await left.press('Enter');
    await expect(hierarchy()).toBeHidden();
    await expect(rail('Left Dock')).toHaveAttribute('data-vertical', 'true');
    assert.equal(await button('Hierarchy', rail('Left Dock')).locator('span').evaluate(label => getComputedStyle(label).writingMode), 'vertical-rl');
    assert.ok((await scene().boundingBox()).width > sceneWidth);
    await left.press('Enter');
    await expect(hierarchy()).toBeVisible();
    assert.equal((await scene().boundingBox()).width, sceneWidth);

    await button('Minimize Inspector Panel').click();
    await expect(inspector()).toBeHidden();
    const entry = page.locator('.dock-rail-item').filter({ has: page.getByRole('button', { name: 'Inspector', exact: true }) });
    await expect(entry.getByRole('button')).toHaveCount(2);
    await button('Panels').click();
    await expect(page.getByRole('checkbox', { name: 'Inspector', exact: true })).toBeChecked();
    await page.keyboard.press('Escape');
    await button('Inspector', entry).click();
    await expect(inspector()).toBeVisible();
    await expect(rails()).toHaveCount(0);

    await button('Maximize Inspector Panel').click();
    await expect(hierarchy()).toBeHidden();
    await expect(button('Panels')).toBeHidden();
    const screen = await page.locator('.editor').boundingBox();
    const full = await inspector().boundingBox();
    assert.deepEqual(full, screen);
    const controls = inspector().locator('.dock-window-controls');
    await expect(controls.getByRole('button')).toHaveCount(2);
    await expect(button('Maximize Inspector Panel')).toHaveCount(0);
    await button('Restore Inspector Panel', controls).click();
    await expect(hierarchy()).toBeVisible();
    assert.deepEqual(await inspector().boundingBox(), original);

    await button('Minimize Inspector Panel').click();
    await editor.close();
    editor = await launchEditor(profile);
    page = await editor.firstWindow();
    await expect(inspector()).toBeHidden();
    await button('Close Inspector Panel', rails()).click();
    await expect(rails()).toHaveCount(0);
    await button('Panels').click();
    await expect(page.getByRole('checkbox', { name: 'Inspector', exact: true })).not.toBeChecked();
    await page.getByRole('checkbox', { name: 'Inspector', exact: true }).check();
    await page.keyboard.press('Escape');

    await button('Maximize Inspector Panel').click();
    await button('Close Inspector Panel').click();
    await expect(inspector()).toBeHidden();
    await expect(hierarchy()).toBeVisible();
    await button('Panels').click();
    await expect(page.getByRole('checkbox', { name: 'Inspector', exact: true })).not.toBeChecked();
  } finally {
    await editor?.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test('minimized dock titles keep their order in one scrolling row', { timeout: 30_000 }, async () => {
  const profile = await mkdtemp(join(tmpdir(), 'olive-panel-rail-'));
  let editor;
  try {
    editor = await launchEditor(profile);
    let page = await editor.firstWindow();
    await page.evaluate(() => {
      const key = 'olive.panel-layout.v1';
      const layout = JSON.parse(localStorage.getItem(key));
      for (const panel of layout.panels) {
        if (['prefabs', 'globals', 'scripts', 'physics', 'lighting', 'network'].includes(panel.id)) {
          panel.dock = 'right';
          panel.open = true;
        }
        if (panel.id === 'timeline') panel.open = true;
      }
      layout.sizes.right = 15;
      localStorage.setItem(key, JSON.stringify(layout));
    });
    await editor.close();
    editor = await launchEditor(profile);
    page = await editor.firstWindow();

    const rail = page.locator('.dock-rail').filter({ has: page.getByRole('tablist', { name: 'Right Dock', exact: true }) });
    const titles = rail.locator('.dock-rail-item > button');
    const expectedOrder = ['Inspector', 'Prefabs', 'Globals', 'Scripts', 'Physics', 'Lighting', 'Multiplayer'];
    await expect(titles).toHaveText(expectedOrder);
    await rail.getByRole('tab', { name: 'Scripts' }).click();
    await page.getByRole('button', { name: 'Minimize Scripts Panel' }).click();

    await expect(titles).toHaveText(expectedOrder);
    assert.equal(await titles.evaluateAll(buttons => new Set(buttons.map(button => button.getBoundingClientRect().top)).size), 1);
    const minimized = rail.locator('.dock-rail-item[data-minimized]');
    await expect(minimized.getByRole('button')).toHaveCount(2);
    await expect(minimized.getByRole('button', { name: 'Close Scripts Panel' })).toBeVisible();

    const viewport = rail.locator('.dock-rail-viewport');
    const scrollPosition = () => viewport.evaluate(element => element.scrollLeft);
    const left = rail.getByRole('button', { name: 'Scroll Right Dock Left' });
    const right = rail.getByRole('button', { name: 'Scroll Right Dock Right' });
    await viewport.evaluate(element => { element.scrollLeft = 0; });
    await expect(left).toHaveCount(0);
    await expect(right).toBeVisible();
    await right.click();
    await expect.poll(scrollPosition).toBeGreaterThan(0);
    await expect(left).toBeVisible();
    await expect.poll(scrollPosition).toBeGreaterThan(
      await viewport.evaluate(element => element.clientWidth - 26),
    );
    await viewport.evaluate(element => { element.scrollLeft = element.scrollWidth; });
    await expect(right).toHaveCount(0);
    const end = await scrollPosition();
    await left.click();
    await expect.poll(scrollPosition).toBeLessThan(end);

    await minimized.getByRole('button', { name: 'Scripts', exact: true }).click();
    await expect(rail.getByRole('tab', { name: 'Scripts', selected: true })).toBeVisible();
    await expect(titles).toHaveText(expectedOrder);
    await expect(page.getByRole('tablist', { name: 'Lower Dock', exact: true }).getByRole('tab')).toHaveCount(2);
    await expect(page.getByRole('button', { name: /^Scroll Lower Dock/ })).toHaveCount(0);

    await page.getByRole('separator', { name: 'Resize Right Dock' }).dblclick();
    const vertical = page.locator('.dock-rail[data-vertical]').filter({ has: page.getByRole('group', { name: 'Right Dock', exact: true }) });
    await expect(vertical.locator('.dock-rail-item > button')).toHaveText(expectedOrder);
    const down = vertical.getByRole('button', { name: 'Scroll Right Dock Down' });
    const up = vertical.getByRole('button', { name: 'Scroll Right Dock Up' });
    const verticalViewport = vertical.locator('.dock-rail-viewport');
    await expect(down).toBeVisible();
    await down.click();
    await expect.poll(() => verticalViewport.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    await expect(up).toBeVisible();
  } finally {
    await editor?.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test('integrated authoring tools drive Live content and persist portable assets', { timeout: 45_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'olive-integrated-tools-'));
  const fixture = join(directory, 'content.json');
  let editor;
  try {
    const code = 'exports.start = () => { game.achievements.unlock("First Step"); };';
    await writeFile(fixture, JSON.stringify({
      version: 2, startup: 'main',
      content: {
        dialogues: { version: 1, items: [{ id: 'intro', name: 'Welcome', start: 'hello',
          lines: [{ id: 'hello', speaker: 'Guide', text: 'Hello traveler', next: '', event: '', choices: [] }] }] },
        achievements: { version: 1, items: [{ id: 'first', name: 'First Step', description: 'Start the game', hidden: false }], boards: [] },
      },
      scripts: { version: 1, items: [{ id: 'start', name: 'Start', source: code, code }],
        scenes: { main: { scriptId: 'start', params: {}, refs: {} } } },
      tests: { version: 1, proofs: [], items: [{ id: 'placement', name: 'Check placement', sceneId: 'main', frames: 2, seed: 10, events: [],
        assertions: [{ frame: 2, entityId: 'sign', field: 'x', op: '==', expected: 200 }] }] },
      scenes: [{ id: 'main', name: 'Start', objects: [
        { id: 'sign', type: 'Graphics', label: 'Welcome Sign', position: { x: 200, y: 160 },
          logicGraph: { nodes: [
            { id: 'scene-start', kind: 'event', x: 20, y: 20, trigger: { type: 'scene.start', sourceId: 'main', event: '' } },
            { id: 'dialogue', kind: 'action', x: 340, y: 20, action: { id: 'show', type: 'dialogue.start', targetId: 'intro', value: true } },
          ], links: [{ id: 'first', from: 'scene-start', port: 'next', to: 'dialogue' }] },
        },
      ] }],
    }));
    editor = await launchEditor(join(directory, 'profile'));
    await editor.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
      dialog.showMessageBoxSync = () => 1;
    }, fixture);
    const page = await editor.firstWindow();
    const button = (name, scope = page) => scope.getByRole('button', { name, exact: true });
    const panel = async name => {
      await button('Panels').click();
      await page.getByRole('checkbox', { name, exact: true }).check();
      await page.keyboard.press('Escape');
      return page.getByRole('region', { name, exact: true });
    };
    await button('Open Scene').click();
    await button('Welcome Sign').click();
    const content = await panel('Game Content');
    await expect(content.getByRole('option', { name: 'Welcome', exact: true })).toBeVisible();
    const audio = await panel('Audio Studio');
    await button('Sound Lab', audio).click();
    await button('Add to Library', audio).click();
    const shaders = await panel('Shaders');
    await shaders.getByRole('combobox', { name: 'New shader…' }).selectOption({ index: 1 });
    await expect(shaders.getByRole('status')).toHaveText('Compiles');
    await button('Apply to selection', shaders).click();
    await panel('Scripts');
    await page.getByText('Behaviors', { exact: true }).click();
    await button('New behavior graph').click();
    await button('Attach graph to selection').click();
    await page.getByText('Profiler', { exact: true }).click();
    const profiler = page.getByTestId('profiler');
    await profiler.getByRole('button', { name: /resume/i }).click();
    await button('Play Game').click();
    await expect(profiler).toHaveAttribute('data-frames', /[1-9]/);
    await expect(page.locator('[data-dialogue-box]')).toBeVisible();
    await expect(page.locator('[data-achievement-toast="First Step"]')).toBeVisible();
    await expect(page.getByTestId('behavior-states')).toHaveText('idle');
    await page.getByRole('tab', { name: 'Edit', exact: true }).click();
    await expect(page.locator('[data-dialogue-box]')).toBeHidden();
    await page.getByRole('tab', { name: 'Live', exact: true }).click();
    await expect(page.locator('[data-dialogue-box]')).toBeVisible();
    await button('Stop Game').click();
    await expect(page.locator('[data-dialogue-box]')).toHaveCount(0);
    await page.getByText('Test Studio', { exact: true }).click();
    const tests = page.getByRole('region', { name: 'Test Studio', exact: true });
    await button('Run scenario', tests).click();
    await expect(tests.getByRole('status')).toContainText('Passed');
    await button('Save Scene').click();
    await expect.poll(async () => {
      const saved = JSON.parse(await readFile(fixture, 'utf8'));
      return { shader: !!saved.scenes[0].objects.find(node => node.id === 'sign').shader,
        graph: !!saved.behaviorGraphs?.items.length, audio: (saved.assets ?? []).some(asset => asset.alias.endsWith('.wav')),
        test: saved.tests?.proofs[0]?.passed };
    }).toEqual({ shader: true, graph: true, audio: true, test: true });
    await button('OliveStudio Hub').click();
    await button('Recovery').click();
    await button('Save checkpoint').click();
    const recovery = page.getByRole('region', { name: 'Recovery', exact: true });
    await recovery.locator('button.hub-project').filter({ hasText: 'content.json' }).first().click();
    await expect(page.getByRole('dialog', { name: 'OliveStudio Hub' })).toBeHidden();
    await expect(page.getByText('Recovered content.json', { exact: true })).toBeVisible();
  } finally {
    await editor?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('AI proposes local scene edits and applies them only after approval', { timeout: 30_000 }, async () => {
  const profile = await mkdtemp(join(tmpdir(), 'olive-ai-approval-'));
  let editor;
  let chatBody;
  const server = createServer(async (request, response) => {
    if (request.url === '/api/v0/models') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ data: [{ id: 'olive-model', type: 'llm', state: 'loaded' }] }));
    } else if (request.url === '/v1/chat/completions') {
      const parts = [];
      for await (const chunk of request) parts.push(chunk);
      chatBody = JSON.parse(Buffer.concat(parts).toString());
      const content = JSON.stringify([{ action: 'rename', id: 'sample-sprite', label: 'Approved Crystal' }]);
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      response.end('data: ' + JSON.stringify({ choices: [{ delta: { content }, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n');
    } else response.writeHead(404).end();
  });
  try {
    await new Promise((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', done); });
    editor = await launchEditor(profile);
    const page = await editor.firstWindow();
    const button = name => page.getByRole('button', { name, exact: true });
    await button('Panels').click();
    await page.getByRole('checkbox', { name: 'AI Studio', exact: true }).check();
    await page.keyboard.press('Escape');
    const panel = page.getByRole('region', { name: 'AI Studio' });
    await panel.getByLabel('LM Studio address').fill('http://127.0.0.1:' + server.address().port);
    await button('Connect').click();
    await expect(panel.getByRole('combobox', { name: /Model/ })).toHaveValue('olive-model');
    await panel.getByRole('textbox', { name: 'Ask the assistant' }).fill('Rename the crystal.');
    await button('Propose scene edits').click();
    await expect(button('Apply proposal')).toBeEnabled();
    await expect(button('Olive Crystal')).toBeVisible();
    assert.match(chatBody.messages[0].content, /sample-sprite/);
    await button('Apply proposal').click();
    await expect(button('Approved Crystal')).toBeVisible();
    await button('AI Activity').click();
    await expect(panel.getByText(/Done · Approved/)).toBeVisible();
  } finally {
    if (editor) {
      await editor.evaluate(({ dialog }) => { dialog.showMessageBoxSync = () => 1; }).catch(() => {});
      await editor.close();
    }
    await new Promise(done => server.close(done));
    await rm(profile, { recursive: true, force: true });
  }
});
