// Localization on i18next: i18next JSON import (nested and language folders) and export, AI translation of missing
// texts with a fake LM Studio (plural categories of the target language, placeholders kept, refused when changed,
// review marks and approval), and the exported game rendering plural forms and {{global}} interpolation.
import {_electron as electron, chromium, expect} from '@playwright/test';
import {createServer} from 'node:http';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {dirname, extname, join, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(join(root, 'apps/editor-desktop/package.json'));
const temp = await mkdtemp(join(tmpdir(), 'rewrite-localization-'));
const env = {...process.env};
delete env.ELECTRON_RUN_AS_NODE;
let app, browser, server, lm, game;
const requests = [];

try {
 // Fake LM Studio: translation requests get "TR …" texts (placeholders kept), plural keys Turkish forms, and "hello"
 // loses its {{name}} placeholder (the editor must refuse it).
 lm = createServer((req, res) => {
  const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => {
   if (req.url === '/api/v0/models') { res.writeHead(200, {'Content-Type': 'application/json'}); return res.end(JSON.stringify({data: [{id: 'fake-qwen', type: 'llm', state: 'loaded', capabilities: ['tool_use']}]})); }
   if (req.url !== '/v1/chat/completions') { res.writeHead(404); return res.end(); }
   const body = JSON.parse(Buffer.concat(chunks).toString()); requests.push(body);
   const user = body.messages.at(-1).content, keys = JSON.parse(/^Requested keys: (.*)$/m.exec(user)[1]), source = JSON.parse(user.slice(user.indexOf('\n', user.indexOf('Source texts:')) + 1));
   const out = {};
   for (const key of keys) {
    const plural = /^(.*)_(one|other)$/.exec(key);
    if (plural && source[plural[1]]?.plural) out[key] = plural[2] === 'one' ? '{{count}} altın' : '{{count}} altın';
    else if (key === 'hello') out[key] = 'Merhaba';
    else out[key] = `TR ${typeof source[key] === 'string' ? source[key] : source[key].text}`;
   }
   res.writeHead(200, {'Content-Type': 'text/event-stream'});
   const text = '```json\n' + JSON.stringify(out) + '\n```';
   for (const part of text.match(/[\s\S]{1,40}/g)) res.write(`data: ${JSON.stringify({choices: [{delta: {content: part}}]})}\n\n`);
   res.write(`data: ${JSON.stringify({choices: [{delta: {}, finish_reason: 'stop'}]})}\n\n`); res.end('data: [DONE]\n\n');
  });
 });
 await new Promise(r => lm.listen(0, '127.0.0.1', r));

 const file = join(temp, 'strings.pixieditor');
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
 await menu('Settings…');
 const address = page.getByTestId('settings-dialog').getByRole('textbox', {name: 'LM Studio address', exact: true});
 await address.fill(`http://127.0.0.1:${lm.address().port}`); await address.press('Enter'); await page.keyboard.press('Escape');

 // A text using a plural form and an interpolated string, with two globals.
 const project = await save();
 project.scenes[0].entities = [{id: 'hud', name: 'hud', parentId: null, active: true, components: [
  {id: 'hud-t', type: 'scene.transform2d', version: 1, data: {x: 480, y: 270, rotation: 0, scaleX: 1, scaleY: 1}},
  {id: 'hud-x', type: 'pixi.text', version: 1, data: {alpha: 1, text: '{@coins:coins} · {@hud.score}', fontSize: 32, color: '#ffffff', font: ''}},
 ]}];
 project.extensions['interactions.globals'] = {version: 1, items: [{id: 'v1', name: 'coins', type: 'number', initial: 3}, {id: 'v2', name: 'score', type: 'number', initial: 40}]};
 await writeFile(file, JSON.stringify(project));
 await choose(file); await menu('Open…');

 // i18next JSON import: en.json (nested keys) and tr/translation.json (language from the folder).
 const locales = join(temp, 'locales');
 await mkdir(join(locales, 'tr'), {recursive: true});
 await writeFile(join(locales, 'en.json'), JSON.stringify({hud: {score: 'Score: {{score}}'}, coins_one: '{{count}} coin', coins_other: '{{count}} coins', play: 'Play', hello: 'Hi {{name}}', 'bad key': 'x'}));
 await writeFile(join(locales, 'tr', 'translation.json'), JSON.stringify({play: 'Oyna'}));
 await page.keyboard.press('Alt+KeyG');
 const panel = page.getByTestId('localization-panel');
 await choose(join(locales, 'en.json'), join(locales, 'tr', 'translation.json'));
 await panel.getByRole('button', {name: 'Import i18next JSON…', exact: true}).click();
 await expect(panel.getByTestId('localization-message')).toContainText('en: +5 / 0 (skipped bad key) · tr: +0 / 1');
 await expect(panel.locator('[data-language]')).toHaveCount(2);
 await expect(panel.getByRole('textbox', {name: 'Language name tr', exact: true})).toHaveValue('Turkish');
 await expect(panel.locator('[data-language="tr"]')).toHaveAttribute('data-missing', '3');
 let saved = await save();
 expect(saved.extensions['interactions.strings'].entries.map(e => e.key)).toEqual(['hud.score', 'coins_one', 'coins_other', 'play', 'hello']);
 console.log('PASS i18next JSON import: nested keys flattened, language from the file or folder name, bad keys reported, one undo step');

 // AI translation of the missing Turkish texts.
 await panel.getByRole('textbox', {name: 'Note hud.score', exact: true}).fill('Top bar, short');
 await panel.getByRole('textbox', {name: 'Note hud.score', exact: true}).press('Enter');
 await panel.getByRole('button', {name: 'Translate missing texts with AI tr', exact: true}).click();
 const status = panel.getByTestId('translate-status');
 await expect(status).toHaveAttribute('data-phase', 'done', {timeout: 30000});
 await expect(status).toContainText('3 texts translated to Turkish'); await expect(status).toContainText('Not written (placeholders changed or missing): hello');
 const request = requests.at(-1);
 expect(request.reasoning_effort).toBe('none');
 expect(request.messages[0].content).toContain('from English (en) to Turkish (tr)'); expect(request.messages[0].content).toContain('<key>_one, <key>_other');
 expect(request.messages[0].content).toContain('Game translation:');
 expect(request.messages[1].content).toContain('"note": "Top bar, short"');
 await expect(panel.locator('[data-key="hud.score"]')).toHaveAttribute('data-review', 'tr');
 await expect(panel.getByRole('textbox', {name: 'hud.score tr', exact: true})).toHaveValue('TR Score: {{score}}');
 await expect(panel.getByRole('textbox', {name: 'coins_other tr', exact: true})).toHaveValue('{{count}} altın');
 await expect(panel.getByRole('textbox', {name: 'hello tr', exact: true})).toHaveValue('');
 await panel.getByRole('button', {name: 'Approve hud.score tr', exact: true}).click();
 await expect(panel.locator('[data-key="hud.score"]')).toHaveAttribute('data-review', '');
 await panel.getByRole('textbox', {name: 'coins_one tr', exact: true}).fill('{{count}} altın!');
 await panel.getByRole('textbox', {name: 'coins_one tr', exact: true}).press('Enter');
 await expect(panel.locator('[data-key="coins_one"]')).toHaveAttribute('data-review', '');
 await expect(panel.getByText('1 AI translations to review')).toBeVisible();
 saved = await save();
 expect(saved.extensions['interactions.strings'].entries.find(e => e.key === 'coins_other')).toMatchObject({values: {en: '{{count}} coins', tr: '{{count}} altın'}, review: ['tr']});
 await panel.getByRole('button', {name: 'Approve all', exact: true}).click();
 await expect(panel.locator('[data-review="tr"]')).toHaveCount(0);
 console.log('PASS AI translation: missing texts and every Turkish plural category, notes and the translation skill in the prompt, changed placeholders refused, review marks, approve and edit');

 // i18next JSON export: one file per language.
 const exportStrings = join(temp, 'exported');
 await mkdir(exportStrings);
 await choose(exportStrings);
 await panel.getByRole('button', {name: 'Export i18next JSON…', exact: true}).click();
 await expect(panel.getByTestId('localization-message')).toContainText(`Exported to ${exportStrings}`);
 expect(JSON.parse(await readFile(join(exportStrings, 'tr.json'), 'utf8'))).toEqual({'hud.score': 'TR Score: {{score}}', coins_one: '{{count}} altın!', coins_other: '{{count}} altın', play: 'Oyna'});
 expect(Object.keys(JSON.parse(await readFile(join(exportStrings, 'en.json'), 'utf8')))).toHaveLength(5);
 await page.keyboard.press('Escape');
 console.log('PASS i18next JSON export writes en.json and tr.json');

 // Exported game: i18next plural forms and interpolation with game globals, in the player's language.
 const exportDir = join(temp, 'export');
 await mkdir(exportDir);
 await page.getByRole('button', {name: 'Export', exact: true}).click();
 await choose(exportDir);
 await page.getByRole('button', {name: 'Export HTML…', exact: true}).click();
 await expect(page.getByTestId('build-status')).toHaveAttribute('data-phase', /complete|failed/, {timeout: 60000});
 expect(await page.getByTestId('build-status').innerText()).not.toMatch(/Error/);
 const output = await page.getByTestId('build-output').innerText();
 server = createServer(async (req, res) => {
  try {
   const path = resolve(output, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/$/, '/index.html'));
   if (!path.startsWith(resolve(output) + sep)) throw Error('outside');
   res.setHeader('Content-Type', {'.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.webp': 'image/webp'}[extname(path)] ?? 'application/octet-stream');
   res.end(await readFile(path));
  } catch { res.statusCode = 404; res.end(); }
 });
 await new Promise(r => server.listen(0, '127.0.0.1', r));
 browser = await chromium.launch({channel: 'chrome', headless: true, args: ['--enable-unsafe-swiftshader']});
 for (const [locale, expected] of [['tr-TR', '3 altın · TR Score: 40'], ['en-US', '3 coins · Score: 40']]) {
  game = await (await browser.newContext({viewport: {width: 960, height: 540}, locale})).newPage();
  const gameErrors = [];
  game.on('pageerror', e => gameErrors.push(e.message));
  game.on('console', m => { if (m.type() === 'error') gameErrors.push(m.text().slice(0, 300)); });
  await game.goto(`http://127.0.0.1:${server.address().port}`);
  await game.getByRole('button', {name: 'Start', exact: true}).click({timeout: 30000});
  await expect.poll(async () => JSON.parse(await game.locator('#game').getAttribute('data-texts') ?? '{}')['hud-x']).toBe(expected);
  expect(gameErrors).toEqual([]);
 }
 expect(errors).toEqual([]);
 await mkdir(join(root, 'outputs'), {recursive: true});
 await page.keyboard.press('Alt+KeyG');
 await page.screenshot({path: join(root, 'outputs/editor-localization.png')});
 console.log('PASS exported game: i18next plural form by a global and {{score}} interpolation, in Turkish and English');
} catch (error) {
 await mkdir(join(root, 'outputs'), {recursive: true});
 const page = app ? await app.firstWindow().catch(() => null) : null;
 await page?.screenshot({path: join(root, 'outputs/localization-failure.png')}).catch(() => {});
 throw error;
} finally {
 await browser?.close().catch(() => {});
 if (server) await new Promise(r => server.close(r));
 if (lm) await new Promise(r => lm.close(r));
 if (app) {
  await app.evaluate(({BrowserWindow}) => { for (const w of BrowserWindow.getAllWindows()) w.destroy(); }).catch(() => {});
  await app.close().catch(() => {});
 }
 await rm(temp, {recursive: true, force: true, maxRetries: 3});
}
