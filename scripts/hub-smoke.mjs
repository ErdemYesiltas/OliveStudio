// The Hub (start screen): shown at launch, example catalogue with thumbnails and search, Create copies an example
// (and its asset sidecar) to the chosen file and opens it, every example plays without errors, the Sky Hopper hero
// runs and jumps with the keyboard, recent projects (thumbnail after save, open, remove, reveal) persist across a
// relaunch, File → Hub… reopens it and Escape continues to the editor.
import {_electron as electron, expect} from '@playwright/test';
import {mkdtemp, readFile, rm, stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(join(root, 'apps/editor-desktop/package.json'));
const temp = await mkdtemp(join(tmpdir(), 'rewrite-hub-'));
const env = {...process.env};
delete env.ELECTRON_RUN_AS_NODE;
let app;
const launch = () => electron.launch({executablePath: process.env.REWRITE_EXECUTABLE || require('electron'), args: [...(process.env.REWRITE_EXECUTABLE ? [] : [join(root, 'apps/editor-desktop/out/main/index.js')]), `--user-data-dir=${join(temp, 'user')}`], env});
const close = async () => { if (!app) return; await app.evaluate(({BrowserWindow}) => { for (const w of BrowserWindow.getAllWindows()) w.destroy(); }).catch(() => {}); await app.close().catch(() => {}); app = undefined; };
const exists = path => stat(path).then(() => true, () => false);

try {
 app = await launch();
 let page = await app.firstWindow();
 page.setDefaultTimeout(20000);
 const errors = [];
 page.on('pageerror', e => errors.push(e.message));
 const hub = page.getByTestId('hub');
 await expect(hub).toBeVisible({timeout: 30000});
 await expect(hub.getByRole('heading', {name: 'Projects'})).toBeVisible();
 await expect(hub.getByText('No recent projects yet.', {exact: false})).toBeVisible();

 // Examples: six cards with thumbnails, searchable.
 await hub.getByRole('button', {name: 'Examples', exact: true}).click();
 const cards = hub.getByTestId('hub-examples').getByRole('listitem');
 await expect(cards).toHaveCount(12);
 await expect(cards.locator('img')).toHaveCount(12);
 await expect.poll(() => cards.locator('img').evaluateAll(list => list.every(i => i.complete && i.naturalWidth > 0))).toBe(true);
 await page.screenshot({path: join(root, 'outputs/hub-examples.png')});
 await expect(cards.locator('h3')).toHaveText(['Sky Hopper', 'Brick Breaker', 'Tap Tycoon', 'Physics Playground', 'Interactive Demo', 'Neon Garden', 'Grid Snake', 'Desert Dash', 'Pair Up', 'Gravity Well', 'The Lighthouse', 'Maze Escape']);
 await hub.getByRole('searchbox', {name: 'Search examples'}).fill('brick');
 await expect(cards).toHaveCount(1);
 await hub.getByRole('searchbox', {name: 'Search examples'}).fill('');
 console.log('PASS Hub at launch: empty recent list, twelve example cards with thumbnails, search');

 // Create every example through the Hub and play it briefly: no page or script errors.
 const choose = path => app.evaluate(({dialog}, target) => { dialog.showSaveDialog = async () => ({canceled: false, filePath: target}); dialog.showOpenDialog = async () => ({canceled: false, filePaths: [target]}); dialog.showMessageBox = async () => ({response: 1, checkboxChecked: false}); }, path);
 const canvas = page.getByTestId('pixi-canvas');
 const transforms = async () => JSON.parse(await canvas.getAttribute('data-transforms') ?? '{}');
 const consoleErrors = async () => { await page.keyboard.press('Alt+KeyC'); const lines = await page.getByTestId('script-console').locator('[data-level=error]').allInnerTexts(); await page.keyboard.press('Escape'); return lines; };
 const examples = [['Sky Hopper', 'hero'], ['Brick Breaker', 'ball'], ['Tap Tycoon', 'coin'], ['Physics Playground', 'bob'], ['Neon Garden', 'core'], ['Grid Snake', 'food'], ['Desert Dash', 'runner'], ['Pair Up', 'card-0'], ['Gravity Well', 'sun'], ['The Lighthouse', 'story'], ['Maze Escape', 'explorer'], ['Interactive Demo', null]];
 const stagePoint = async (x, y) => { const b = await canvas.locator('canvas').boundingBox(), k = Math.min((b.width - 80) / 960, (b.height - 90) / 540); return {x: b.x + (b.width - 960 * k) / 2 + x * k, y: b.y + (b.height - 540 * k) / 2 + y * k}; };
 const hold = async (key, ms) => { await canvas.click({position: {x: 8, y: 8}}); await page.keyboard.down(key); await page.waitForTimeout(ms); await page.keyboard.up(key); };
 const checks = {
  'Tap Tycoon': async () => { const coins = async () => JSON.parse(await canvas.getAttribute('data-interactions') ?? '{}').globals?.coins; await expect.poll(coins).toBe(0); const at = await stagePoint(480, 290); for (let i = 0; i < 3; i++) await page.mouse.click(at.x, at.y); await expect.poll(coins).toBe(3); return 'taps on the coin count through the sparkle effect drawn over it'; },
  'Grid Snake': async () => { const x = (await transforms())['seg-0'].x; await expect.poll(async () => (await transforms())['seg-0'].x).toBeGreaterThan(x + 50); await hold('ArrowDown', 80); const y = (await transforms())['seg-0'].y; await expect.poll(async () => (await transforms())['seg-0'].y).toBeGreaterThan(y + 50); return 'moves on its grid and turns with the arrows'; },
  'Desert Dash': async () => { const ground = (await transforms()).runner.y; await hold('Space', 100); await expect.poll(async () => (await transforms()).runner.y, {timeout: 2000}).toBeLessThan(ground - 60); return 'jumps over the scrolling cacti'; },
  'Gravity Well': async () => { const a = (await transforms())['planet-0']; await expect.poll(async () => { const b = (await transforms())['planet-0']; return Math.hypot(b.x - a.x, b.y - a.y); }).toBeGreaterThan(40); const p = (await transforms())['planet-0']; expect(Math.abs(Math.hypot(p.x - 480, p.y - 270) - 130)).toBeLessThan(40); return 'planets orbit the sun'; },
  'The Lighthouse': async () => { const state = async () => Object.values(JSON.parse(await canvas.getAttribute('data-interactions') ?? '{}').states ?? {})[0]; await expect.poll(state).toBe('Intro'); const at = await stagePoint(340, 470); await page.mouse.click(at.x, at.y); await expect.poll(state).toBe('Stairs'); return 'a choice moves the story state machine'; },
  'Maze Escape': async () => { const x = (await transforms()).explorer.x; await hold('ArrowRight', 600); await expect.poll(async () => (await transforms()).explorer.x).toBeGreaterThan(x + 60); return 'the explorer walks with the arrows'; },
 };
 for (const [title, probe] of examples) {
  const file = join(temp, `${title.replace(/ /g, '')}.pixieditor`);
  if (!await hub.isVisible()) { await app.evaluate(({Menu}) => Menu.getApplicationMenu().items.flatMap(m => m.submenu?.items ?? []).find(i => i.label === 'Hub…').click()); await expect(hub).toBeVisible(); }
  await hub.getByRole('button', {name: 'Examples', exact: true}).click();
  await choose(file);
  await hub.getByRole('button', {name: `Create ${title}`, exact: true}).click();
  await expect(hub).toBeHidden();
  await expect.poll(() => exists(file)).toBe(true);
  expect(JSON.parse(await readFile(file, 'utf8')).name).toBe(title.replace(/ /g, ''));
  if (probe) await expect.poll(async () => Object.keys(await transforms())).toContain(probe);
  else { await expect.poll(async () => Object.keys(await transforms()).length).toBeGreaterThan(3); expect(await exists(file + '.assets')).toBe(true); await expect(canvas).toHaveAttribute('data-missing-assets', '[]', {timeout: 20000}); }
  await page.getByRole('button', {name: 'Play', exact: true}).click();
  await expect.poll(async () => Number(await canvas.getAttribute('data-runtime-time') ?? 0)).toBeGreaterThan(1);
  if (title === 'Sky Hopper') {
   // Keyboard play: run right, then jump.
   const start = (await transforms()).hero;
   await canvas.click({position: {x: 20, y: 20}});
   await page.keyboard.down('ArrowRight'); await page.waitForTimeout(700); await page.keyboard.up('ArrowRight');
   await expect.poll(async () => (await transforms()).hero.x).toBeGreaterThan(start.x + 80);
   const before = (await transforms()).hero.y;
   await page.keyboard.down('Space'); await page.waitForTimeout(120); await page.keyboard.up('Space');
   await expect.poll(async () => (await transforms()).hero.y, {timeout: 3000}).toBeLessThan(before - 40);
  }
  const extra = checks[title] ? await checks[title]() : '';
  expect(await consoleErrors()).toEqual([]);
  await page.getByRole('button', {name: 'Stop', exact: true}).click();
  console.log(`PASS ${title}: created from the Hub, opened and played${title === 'Sky Hopper' ? ' (runs and jumps with the keyboard)' : extra ? ` (${extra})` : ''}`);
 }

 // Recent projects: newest first, thumbnails after a save, open from the list, remove, Escape continues.
 const sky = join(temp, 'SkyHopper.pixieditor');
 await app.evaluate(({Menu}) => Menu.getApplicationMenu().items.flatMap(m => m.submenu?.items ?? []).find(i => i.label === 'Hub…').click());
 await expect(hub).toBeVisible();
 const rows = hub.getByTestId('hub-projects').getByRole('listitem');
 await expect(rows).toHaveCount(12);
 await expect(rows.first()).toContainText('InteractiveDemo');
 await expect(rows.locator('img')).toHaveCount(12);
 await hub.getByRole('button', {name: 'Open SkyHopper', exact: true}).click();
 await expect(hub).toBeHidden();
 await expect.poll(async () => Object.keys(await transforms())).toContain('hero');
 // Created projects start with the example's picture; a save replaces it with the project's own stage.
 const skyThumb = join(temp, 'user', 'hub-thumbnails', createHash('sha256').update(resolve(sky)).digest('hex').slice(0, 32) + '.png'), exampleThumb = await readFile(skyThumb);
 expect(exampleThumb.equals(await readFile(join(root, 'examples/platformer/thumbnail.png')))).toBe(true);
 await choose(sky);
 await app.evaluate(({Menu}) => Menu.getApplicationMenu().items.flatMap(m => m.submenu?.items ?? []).find(i => i.label === 'Save').click());
 await expect.poll(async () => (await readFile(skyThumb)).equals(exampleThumb)).toBe(false);
 await app.evaluate(({Menu}) => Menu.getApplicationMenu().items.flatMap(m => m.submenu?.items ?? []).find(i => i.label === 'Hub…').click());
 await expect(rows.first()).toContainText('SkyHopper');
 await expect.poll(() => rows.first().locator('img').count()).toBe(1);
 await hub.getByRole('button', {name: 'Remove NeonGarden from list', exact: true}).click();
 await expect(rows).toHaveCount(11);
 await hub.getByRole('searchbox', {name: 'Search projects'}).fill('tycoon');
 await expect(rows).toHaveCount(1);
 await page.keyboard.press('Escape');
 await expect(hub).toBeHidden();
 await expect(page.getByTestId('editor-shell')).toBeVisible();
 expect(errors).toEqual([]);
 console.log('PASS recent projects: newest first, open from the list, thumbnail after save, remove, search, Escape to the editor');

 // Relaunch: the Hub comes back with the same list.
 await close();
 app = await launch();
 page = await app.firstWindow(); page.setDefaultTimeout(20000);
 const again = page.getByTestId('hub');
 await expect(again).toBeVisible({timeout: 30000});
 await expect(again.getByTestId('hub-projects').getByRole('listitem')).toHaveCount(11);
 await expect(again.getByTestId('hub-projects').getByRole('listitem').first()).toContainText('SkyHopper');
 console.log('PASS relaunch: the Hub opens with the remembered projects');
} catch (error) {
 const page = app ? await app.firstWindow().catch(() => null) : null;
 await page?.screenshot({path: join(root, 'outputs/hub-failure.png')}).catch(() => {});
 throw error;
} finally {
 await close();
 await rm(temp, {recursive: true, force: true, maxRetries: 3});
}
