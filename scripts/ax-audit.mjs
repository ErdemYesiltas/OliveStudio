// Accessibility-tree audit (VoiceOver preparation, not a VoiceOver test): opens the end-to-end example,
// walks the main panels and dialogs, and lists interactive nodes that Chromium exposes to assistive
// technology without an accessible name. Writes outputs/beta/ax-audit.json.
// Usage: [REWRITE_EXECUTABLE=…] node scripts/ax-audit.mjs
import {_electron as electron, expect} from '@playwright/test';
import {cp, mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(join(root, 'apps/editor-desktop/package.json'));
const name = 'Interactive demo.pixieditor';
const interactive = new Set(['button', 'checkbox', 'combobox', 'textbox', 'searchbox', 'slider', 'spinbutton', 'link', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'tab', 'switch', 'radio', 'option', 'treeitem', 'listbox']);
const temp = await mkdtemp(join(tmpdir(), 'rewrite-ax-'));
const env = {...process.env};
delete env.ELECTRON_RUN_AS_NODE;
let app;

try {
  const file = join(temp, 'project', name);
  await mkdir(dirname(file), {recursive: true});
  await cp(join(root, 'examples/end-to-end', name), file);
  await cp(join(root, 'examples/end-to-end', `${name}.assets/sources`), `${file}.assets/sources`, {recursive: true});
  app = await electron.launch({executablePath: process.env.REWRITE_EXECUTABLE || require('electron'), args: [...(process.env.REWRITE_EXECUTABLE ? [] : [join(root, 'apps/editor-desktop/out/main/index.js')]), '--no-hub', `--user-data-dir=${join(temp, 'user')}`], env});
  const page = await app.firstWindow();
  page.setDefaultTimeout(30000);
  const canvas = page.getByTestId('pixi-canvas'), shell = page.getByTestId('editor-shell');
  await expect(canvas).toHaveAttribute('data-ready', 'true');
  const menu = label => app.evaluate(({Menu}, text) => Menu.getApplicationMenu().items.flatMap(m => m.submenu?.items ?? []).find(i => i.label === text).click(), label);
  await app.evaluate(({dialog}, target) => {
    dialog.showOpenDialog = async () => ({canceled: false, filePaths: [target]});
    dialog.showMessageBox = async () => ({response: 1, checkboxChecked: false});
  }, file);
  await menu('Open…');
  await expect(page.getByText('Interactive demo', {exact: true}).first()).toBeVisible();
  await expect(shell).toHaveAttribute('aria-busy', 'false');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Accessibility.enable');

  const audit = async state => {
    const {nodes} = await cdp.send('Accessibility.getFullAXTree');
    const unnamed = [];
    let controls = 0;
    for (const node of nodes) {
      const role = node.role?.value;
      if (node.ignored || !interactive.has(role)) continue;
      controls++;
      if ((node.name?.value ?? '').trim()) continue;
      let hint = null;
      if (node.backendDOMNodeId) {
        const {node: dom} = await cdp.send('DOM.describeNode', {backendNodeId: node.backendDOMNodeId}).catch(() => ({node: null}));
        if (dom) {
          const attrs = Object.fromEntries((dom.attributes ?? []).reduce((pairs, value, i, all) => (i % 2 ? pairs : [...pairs, [value, all[i + 1]]]), []));
          hint = {tag: dom.localName, id: attrs.id ?? null, class: attrs.class ?? null, testid: attrs['data-testid'] ?? null, type: attrs.type ?? null};
        }
      }
      unnamed.push({role, hint});
    }
    return {state, controls, unnamed};
  };

  if (process.env.AX_SELFTEST === '1') {
    // Negative control: an injected nameless button must be reported.
    await page.evaluate(() => document.body.append(Object.assign(document.createElement('button'), {id: 'ax-selftest'})));
    const probe = await audit('self-test');
    await page.evaluate(() => document.getElementById('ax-selftest').remove());
    if (!probe.unnamed.some(u => u.hint?.id === 'ax-selftest')) throw Error('Self-test: injected unnamed button was not reported');
    console.log('PASS self-test: injected unnamed button reported');
  }
  const states = [await audit('project open')];
  await page.getByRole('button', {name: 'Layers', exact: true}).click();
  states.push(await audit('Layers'));
  await page.getByRole('button', {name: 'Select Button', exact: true}).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', {name: 'Properties', exact: true}).click();
  for (const summary of await page.locator('details > summary').all()) await summary.click().catch(() => {});
  states.push(await audit('Properties (Button, all sections expanded)'));
  await page.keyboard.press('Escape');
  await page.getByRole('button', {name: 'Library', exact: true}).click();
  states.push(await audit('Library'));
  await page.keyboard.press('Escape');
  if (await page.getByRole('button', {name: 'Timeline', exact: true}).isVisible()) {
    await page.getByRole('button', {name: 'Timeline', exact: true}).click();
    states.push(await audit('Timeline'));
    await page.keyboard.press('Escape');
  }
  await page.keyboard.press('Meta+K');
  states.push(await audit('Find panel'));
  await page.keyboard.press('Escape');
  const settings = page.getByRole('button', {name: /settings/i}).first();
  if (await settings.isVisible()) {
    await settings.click();
    states.push(await audit('Settings'));
    await page.keyboard.press('Escape');
  }
  await page.getByRole('button', {name: 'Play', exact: true}).click();
  states.push(await audit('Preview playing'));
  await page.getByRole('button', {name: 'Stop', exact: true}).click();

  const total = states.reduce((n, s) => n + s.unnamed.length, 0);
  await mkdir(join(root, 'outputs/beta'), {recursive: true});
  await writeFile(join(root, 'outputs/beta/ax-audit.json'), JSON.stringify({measuredAt: new Date().toISOString(), executable: process.env.REWRITE_EXECUTABLE ? process.env.REWRITE_EXECUTABLE.replace(root + '/', '') : 'source build', states}, null, 2) + '\n');
  for (const s of states) console.log(`${s.state}: ${s.controls} interactive nodes, ${s.unnamed.length} unnamed`);
  if (total) {
    console.log(JSON.stringify(states.flatMap(s => s.unnamed.map(u => ({state: s.state, ...u}))), null, 1));
    throw Error(`${total} interactive nodes without an accessible name`);
  }
  console.log('PASS accessibility tree: every interactive node in the audited states has a name');
} finally {
  if (app) {
    await app.evaluate(({BrowserWindow}) => { for (const w of BrowserWindow.getAllWindows()) w.destroy(); }).catch(() => {});
    await app.close().catch(() => {});
  }
  await rm(temp, {recursive: true, force: true, maxRetries: 3});
}
