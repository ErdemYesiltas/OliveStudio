// Mobile project export: Settings → Mobile app sets the app ID and name (invalid IDs are refused), Export mobile
// project writes the HTML game in www/ plus a Capacitor project (config, pinned package.json, README, toolchain report).
// Native iOS/Android builds are not part of this suite (they need Xcode/Gradle and network; see docs/MOBILE.md).
import {_electron as electron, expect} from '@playwright/test';
import {mkdir, mkdtemp, readFile, readdir, rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(join(root, 'apps/editor-desktop/package.json'));
const sharp = require('sharp');
const temp = await mkdtemp(join(tmpdir(), 'rewrite-mobile-'));
const env = {...process.env};
delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
 app = await electron.launch({executablePath: process.env.REWRITE_EXECUTABLE || require('electron'), args: [...(process.env.REWRITE_EXECUTABLE ? [] : [join(root, 'apps/editor-desktop/out/main/index.js')]), '--no-hub', `--user-data-dir=${join(temp, 'user')}`], env});
 const page = await app.firstWindow();
 page.setDefaultTimeout(20000);
 const errors = [];
 page.on('pageerror', e => errors.push(e.message));
 await expect(page.getByTestId('pixi-canvas')).toHaveAttribute('data-ready', 'true', {timeout: 30000});
 const choose = path => app.evaluate(({dialog}, target) => { dialog.showOpenDialog = async () => ({canceled: false, filePaths: [target]}); dialog.showSaveDialog = async () => ({canceled: false, filePath: target}); dialog.showMessageBox = async () => ({response: 1, checkboxChecked: false}); }, path);
 if (process.env.REWRITE_MOBILE_PROJECT) { const menu = label => app.evaluate(({Menu}, text) => Menu.getApplicationMenu().items.flatMap(m => m.submenu?.items ?? []).find(i => i.label === text).click(), label); await choose(process.env.REWRITE_MOBILE_PROJECT); await menu('Open…'); await expect.poll(async () => Object.keys(JSON.parse(await page.getByTestId('pixi-canvas').getAttribute('data-transforms') ?? '{}')).length).toBeGreaterThan(2); }
 else { await page.getByRole('button', {name: 'Add', exact: true}).click(); await page.getByTestId('add-menu').getByRole('menuitem', {name: 'Container', exact: true}).click(); }

 // An app icon from the Library.
 const iconFile = join(temp, 'appicon.png');
 await sharp({create: {width: 256, height: 256, channels: 4, background: '#e0a020'}}).png().toFile(iconFile);
 if (!await page.locator('.asset-library').isVisible()) await page.keyboard.press('Alt+KeyB');
 await choose(iconFile);
 await page.locator('.asset-library').getByRole('button', {name: 'Add files…', exact: true}).click();
 await expect(page.locator('.asset-library [data-asset-name="appicon"]')).toHaveCount(1, {timeout: 30000});
 await page.keyboard.press('Escape');
 await page.getByRole('button', {name: 'Editor settings', exact: true}).click(); await page.getByRole('menuitem', {name: /^Settings…/}).click();
 const settings = page.getByTestId('mobile-settings');
 await expect(settings.getByRole('textbox', {name: 'App ID', exact: true})).toHaveValue(/^com\.example\./);
 await settings.getByRole('textbox', {name: 'App ID', exact: true}).fill('Bad ID'); await settings.getByRole('textbox', {name: 'App ID', exact: true}).press('Enter');
 await expect(page.getByText(/App ID must be reverse-DNS/)).toBeVisible();
 await settings.getByRole('textbox', {name: 'App ID', exact: true}).fill('com.studio.skyhop'); await settings.getByRole('textbox', {name: 'App ID', exact: true}).press('Enter');
 await settings.getByRole('textbox', {name: 'App name', exact: true}).fill('Sky Hop'); await settings.getByRole('textbox', {name: 'App name', exact: true}).press('Enter');
 await expect(settings.getByRole('textbox', {name: 'App ID', exact: true})).toHaveValue('com.studio.skyhop');
 await settings.getByRole('combobox', {name: 'App icon', exact: true}).selectOption({label: 'appicon'});
 await settings.getByLabel('Splash colour', {exact: true}).fill('#203040');
 await expect(settings.getByRole('combobox', {name: 'App icon', exact: true}).locator('option:checked')).toHaveText('appicon');
 await page.keyboard.press('Escape');
 console.log('PASS Settings → Mobile app: default ID, invalid ID refused, ID, name, icon and splash colour saved');

 const out = join(temp, 'export'); await mkdir(out);
 await page.getByRole('button', {name: 'Export', exact: true}).click();
 await choose(out);
 await page.getByRole('button', {name: 'Export mobile project…', exact: true}).click();
 await expect(page.getByTestId('build-status')).toHaveAttribute('data-phase', /complete|failed/, {timeout: 90000});
 expect(await page.getByTestId('build-status').innerText()).toContain('Mobile project complete');
 const output = await page.getByTestId('build-output').innerText();
 expect(output).toMatch(/Pixi-Mobile-/);
 expect((await readdir(output)).sort()).toEqual(['README.md', 'capacitor.config.json', 'mobile-tools.json', 'package.json', 'resources', 'tools', 'www']);
 expect((await readdir(join(output, 'tools'))).sort()).toEqual(['android-gradle.mjs', 'apply-assets.mjs']);
 const iosIcon = await sharp(join(output, 'resources/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png')).metadata();
 expect([iosIcon.width, iosIcon.hasAlpha]).toEqual([1024, false]);
 const splash = await sharp(join(output, 'resources/android/app/src/main/res/drawable-port-xxxhdpi/splash.png')).raw().toBuffer({resolveWithObject: true});
 expect([splash.info.width, splash.info.height, ...splash.data.slice(0, 3)]).toEqual([1280, 1920, 0x20, 0x30, 0x40]);
 expect(await readdir(join(output, 'www'))).toEqual(expect.arrayContaining(['index.html', 'project.json']));
 expect(JSON.parse(await readFile(join(output, 'capacitor.config.json'), 'utf8'))).toEqual({appId: 'com.studio.skyhop', appName: 'Sky Hop', webDir: 'www'});
 const pkg = JSON.parse(await readFile(join(output, 'package.json'), 'utf8'));
 expect(pkg.devDependencies['@capacitor/cli']).toBe('8.6.0');
 expect(pkg.scripts.ios).toContain('node tools/apply-assets.mjs');
 const tools = JSON.parse(await readFile(join(output, 'mobile-tools.json'), 'utf8'));
 expect(Object.keys(tools).sort()).toEqual(['androidSdk', 'iosSimulators', 'jdk', 'signingIdentities', 'xcode']);
 expect(await readFile(join(output, 'README.md'), 'utf8')).toContain('com.studio.skyhop');
 expect(errors).toEqual([]);
 console.log(`PASS Export mobile project: www/ game, Capacitor config, pinned packages, icon and splash resources, README, toolchain (${tools.xcode ?? 'no Xcode'}, ${tools.signingIdentities} signing identities)`);
 if (process.env.REWRITE_KEEP_MOBILE) console.log('OUTPUT ' + output);
} catch (error) {
 await mkdir(join(root, 'outputs'), {recursive: true});
 const page = app ? await app.firstWindow().catch(() => null) : null;
 await page?.screenshot({path: join(root, 'outputs/mobile-failure.png')}).catch(() => {});
 throw error;
} finally {
 if (app) { await app.evaluate(({BrowserWindow}) => { for (const w of BrowserWindow.getAllWindows()) w.destroy(); }).catch(() => {}); await app.close().catch(() => {}); }
 if (!process.env.REWRITE_KEEP_MOBILE) await rm(temp, {recursive: true, force: true, maxRetries: 3});
}
