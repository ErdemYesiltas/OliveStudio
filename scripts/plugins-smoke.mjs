// User plugins: only enabled, valid plugins load (as editor modules with a panel); a broken one is reported, a disabled
// one never runs; Settings lists them with their state and enabling / disabling is saved for the next start.
import {_electron as electron, expect} from '@playwright/test';
import {cp, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(join(root, 'apps/editor-desktop/package.json'));
const temp = await mkdtemp(join(tmpdir(), 'rewrite-plugins-'));
const env = {...process.env};
delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
 const user = join(temp, 'user'), plugins = join(user, 'plugins');
 await mkdir(plugins, {recursive: true});
 await cp(join(root, 'scripts/fixtures/plugins/hello-panel'), join(plugins, 'hello-panel'), {recursive: true});
 await mkdir(join(plugins, 'broken-one'));
 await writeFile(join(plugins, 'broken-one', 'plugin.json'), JSON.stringify({id: 'something-else', name: 'Broken one', main: 'main.js'}));
 await writeFile(join(plugins, 'broken-one', 'main.js'), 'throw Error("must not load");');
 await mkdir(join(plugins, 'quiet'));
 await writeFile(join(plugins, 'quiet', 'plugin.json'), JSON.stringify({id: 'quiet', name: 'Quiet', version: '0.1.0', main: 'main.js'}));
 await writeFile(join(plugins, 'quiet', 'main.js'), 'throw Error("disabled plugins must not load");');
 await writeFile(join(user, 'plugins.json'), JSON.stringify({enabled: ['broken-one', 'hello-panel']}));

 app = await electron.launch({executablePath: process.env.REWRITE_EXECUTABLE || require('electron'), args: [...(process.env.REWRITE_EXECUTABLE ? [] : [join(root, 'apps/editor-desktop/out/main/index.js')]), '--no-hub', `--user-data-dir=${user}`], env});
 const page = await app.firstWindow();
 page.setDefaultTimeout(15000);
 const errors = [];
 page.on('pageerror', e => errors.push(e.message));
 await expect(page.getByTestId('pixi-canvas')).toHaveAttribute('data-ready', 'true', {timeout: 30000});
 await page.getByRole('button', {name: 'Hello', exact: true}).click();
 await expect(page.getByTestId('hello-panel')).toContainText('Hello from a plugin! This scene has');
 await page.keyboard.press('Escape');
 console.log('PASS an enabled plugin loads as an editor module and adds its panel');

 await page.getByRole('button', {name: 'Editor settings', exact: true}).click(); await page.getByRole('menuitem', {name: /^Settings…/}).click();
 const dialog = page.getByTestId('settings-dialog');
 await dialog.getByRole('searchbox', {name: 'Search settings', exact: true}).fill('plugin');
 const list = dialog.getByTestId('plugin-settings');
 await expect(list.locator('[data-plugin="hello-panel"]')).toContainText('Running');
 await expect(list.locator('[data-plugin="broken-one"]')).toContainText('must match the folder name');
 await expect(list.locator('[data-plugin="quiet"]').getByRole('checkbox')).not.toBeChecked();
 await list.locator('[data-plugin="hello-panel"]').getByRole('checkbox').click();
 await expect(list.locator('[data-plugin="hello-panel"]').getByRole('checkbox')).not.toBeChecked();
 await expect(list).toContainText('Restart OliveStudio to apply');
 await expect.poll(async () => JSON.parse(await readFile(join(user, 'plugins.json'), 'utf8')).enabled).toEqual(['broken-one']);
 await list.locator('[data-plugin="quiet"]').getByRole('checkbox').click();
 await expect(list.locator('[data-plugin="quiet"]').getByRole('checkbox')).toBeChecked();
 await expect.poll(async () => JSON.parse(await readFile(join(user, 'plugins.json'), 'utf8')).enabled).toEqual(['broken-one', 'quiet']);
 expect(errors).toEqual([]);
 console.log('PASS Settings lists plugins with state and problems; enabling and disabling is saved for the next start');
} catch (error) {
 await mkdir(join(root, 'outputs'), {recursive: true});
 const page = app ? await app.firstWindow().catch(() => null) : null;
 await page?.screenshot({path: join(root, 'outputs/plugins-failure.png')}).catch(() => {});
 throw error;
} finally {
 if (app) { await app.evaluate(({BrowserWindow}) => { for (const w of BrowserWindow.getAllWindows()) w.destroy(); }).catch(() => {}); await app.close().catch(() => {}); }
 await rm(temp, {recursive: true, force: true, maxRetries: 3});
}
