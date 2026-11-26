import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, nativeTheme, net, protocol, shell } from 'electron';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { localize } from './locales/catalog.mjs';
import { localNetwork } from './network-desktop.mjs';

const scheme = 'olive-studio';
const editorURL = `${scheme}://editor/`;
const renderer = join(import.meta.dirname, app.isPackaged ? 'renderer' : 'dist');
const serverBundle = join(import.meta.dirname, app.isPackaged ? 'network-server/server.mjs' : 'dist/network-server/server.mjs');
const network = localNetwork(serverBundle);
const testClients = new Map();
const aiJobs = new Map();
let testClientSequence = 0;
const gameExportModule = () => import(pathToFileURL(join(import.meta.dirname,
  app.isPackaged ? 'game-export.cjs' : 'dist/game-export.cjs')).href);
const profile = process.env.OLIVESTUDIO_USER_DATA ?? process.env.OLIVESTUDIO_PROTOTYPE_USER_DATA ??
  join(app.getPath('appData'), 'OliveStudio Prototype');
mkdirSync(profile, { recursive: true });
app.setPath('userData', profile);

protocol.registerSchemesAsPrivileged([{
  scheme,
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
}]);

function serveEditor(request) {
  const url = new URL(request.url);
  if (url.host !== 'editor' || !['GET', 'HEAD'].includes(request.method)) {
    return new Response(null, { status: 404 });
  }
  let file;
  try {
    const path = decodeURIComponent(url.pathname);
    const client = /^\/game-test\/([a-f0-9-]{36})\/(.*)$/.exec(path);
    if (client) {
      const slot = testClients.get(client[1]);
      if (!slot) return new Response(null, { status: 404 });
      const relative = client[2];
      if (relative === 'project.json') return new Response(request.method === 'HEAD' ? null : slot.text, {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });
      if (relative && (!/^(assets|assetpack)\//.test(relative) || relative.split('/').some(part => !part || part === '.' || part === '..'))) return new Response(null, { status: 404 });
      const area = relative.startsWith('assetpack/') ? renderer : join(renderer, 'game-runtime');
      file = resolve(area, relative || 'game.html');
      if (!file.startsWith(area + sep)) return new Response(null, { status: 404 });
    } else {
      file = resolve(renderer, path === '/' ? 'index.html' : '.' + path);
    }
  } catch {
    return new Response(null, { status: 400 });
  }
  if (!file.startsWith(renderer + sep)) return new Response(null, { status: 404 });
  return net.fetch(pathToFileURL(file).href, {
    method: request.method,
    headers: request.headers,
  }).catch(() => new Response(null, { status: 404 }));
}

let window;
let importing = false;
let hubBridge;

const themeFile = join(profile, 'appearance.json');
const recentsFile = join(profile, 'recent-scenes.json');
const recoveryDirectory = join(profile, 'recovery');
const recoveryId = /^[a-f0-9-]{36}$/;
const recoveryLimit = 8;
const galleryPath = app.isPackaged ? join(import.meta.dirname, 'examples', 'object-gallery.json') :
  resolve(import.meta.dirname, '../../examples/object-gallery/object-gallery.json');
let recentScenes = [];
const sceneTickets = new Map();
const configFiles = new Map();
const runFile = promisify(execFile);
const git = async (directory, args) => (await runFile('git', ['--literal-pathspecs', ...args], {
  cwd: directory, timeout: 20000, maxBuffer: 128 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' },
})).stdout;
const themeLabels = { dark: 'themeDark', light: 'themeLight', system: 'themeSystem' };
const defaultTheme = 'dark';
const editorBackground = () => nativeTheme.shouldUseDarkColors ? '#191b1a' : '#eef0eb';

async function readTheme() {
  try {
    const theme = JSON.parse(await readFile(themeFile, 'utf8'))?.theme;
    if (typeof theme === 'string' && Object.hasOwn(themeLabels, theme)) return theme;
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn('Could not read editor appearance:', error);
  }
  return defaultTheme;
}

function persistProfile(file, value) {
  const directory = mkdtempSync(join(profile, '.preferences-'));
  try {
    const temporary = join(directory, basename(file));
    writeFileSync(temporary, JSON.stringify(value) + '\n', { mode: 0o600 });
    renameSync(temporary, file);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

async function readRecents() {
  try {
    const items = JSON.parse(await readFile(recentsFile, 'utf8'));
    return Array.isArray(items) ? items.filter(item => item && typeof item.id === 'string' &&
      typeof item.path === 'string' && isAbsolute(item.path) && typeof item.pinned === 'boolean' &&
      Number.isFinite(item.lastOpened) && item.lastOpened > 0 && item.lastOpened <= 8.64e15).slice(0, 50) : [];
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn('Could not read recent scenes:', error);
    return [];
  }
}

function updateRecents(items) {
  const sorted = items.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.lastOpened - a.lastOpened).slice(0, 50);
  persistProfile(recentsFile, sorted);
  recentScenes = sorted;
}

function rememberScene(path) {
  const existing = recentScenes.find(item => item.path === path);
  updateRecents([...recentScenes.filter(item => item !== existing),
    { id: existing?.id ?? crypto.randomUUID(), path, lastOpened: Date.now(), pinned: existing?.pinned ?? false }]);
}

async function recoveryEntries() {
  const files = await readdir(recoveryDirectory).catch(error => {
    if (error.code !== 'ENOENT') throw error;
    return [];
  });
  const entries = await Promise.all(files.filter(name => recoveryId.test(name.slice(0, -5)) && name.endsWith('.json'))
    .map(async name => {
      const file = join(recoveryDirectory, name);
      const handle = await open(file).catch(error => {
        if (error.code !== 'ENOENT') throw error;
      });
      if (!handle) return null;
      try {
        const meta = await handle.stat();
        if (!meta.isFile()) return null;
        const header = Buffer.alloc(4096);
        const { bytesRead } = await handle.read(header);
        const newline = header.subarray(0, bytesRead).indexOf(10);
        if (newline < 0) return null;
        const projectName = JSON.parse(header.toString('utf8', 0, newline));
        return typeof projectName === 'string' ? { id: name.slice(0, -5), name: projectName, at: meta.mtimeMs } : null;
      } catch { return null; } finally { await handle.close(); }
    }));
  return entries.filter(Boolean).sort((a, b) => b.at - a.at);
}

async function readScene(path) {
  const text = await readFile(path, 'utf8');
  const configText = await readFile(configPath(path), 'utf8').catch(error => {
    if (error.code !== 'ENOENT') throw error;
  });
  const recentToken = crypto.randomUUID();
  if (sceneTickets.size >= 10) sceneTickets.delete(sceneTickets.keys().next().value);
  sceneTickets.set(recentToken, path);
  return { name: basename(path), text, configText, configToken: registerConfig(path), recentToken };
}

function configPath(path) {
  return join(dirname(path), basename(path).replace(/\.json$/i, '') + '.config.json');
}

function registerConfig(path) {
  if (configFiles.size >= 64) configFiles.delete(configFiles.keys().next().value);
  const token = crypto.randomUUID();
  configFiles.set(token, path);
  return token;
}

async function writeAtomic(path, text) {
  const directory = await mkdtemp(join(dirname(path), '.olivestudio-'));
  try {
    const temporary = join(directory, 'document.json');
    await writeFile(temporary, text, { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, path);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function installCommands(t) {
  const filters = [{ name: t('sceneFileType'), extensions: ['json'] }];
  const assetPack = () => import(pathToFileURL(
    join(import.meta.dirname, app.isPackaged ? 'asset-import.cjs' : 'dist/asset-import.cjs'),
  ).href);
  const fromEditor = event => {
    if (!window || event.sender !== window.webContents || event.senderFrame?.url !== editorURL) {
      throw new Error(t('fileCommandDenied'));
    }
    return window;
  };
  const hubPath = join(import.meta.dirname, app.isPackaged ? 'localhub.cjs' : 'dist/localhub.cjs');
  const { default: localHub } = await import(pathToFileURL(hubPath).href);
  hubBridge = localHub?.registerLocalHub?.({ window: () => window, sender: fromEditor, memory: false });
  ipcMain.handle('olive:localhub-available', event => { fromEditor(event); return !!hubBridge; });
  ipcMain.handle('olive:open-scene', async event => {
    const parent = fromEditor(event);
    const result = await dialog.showOpenDialog(parent, { title: t('openScene'), filters, properties: ['openFile'] });
    if (result.canceled || !result.filePaths[0]) return null;
    return readScene(result.filePaths[0]);
  });
  ipcMain.handle('olive:import-translations', async event => {
    const selection = await dialog.showOpenDialog(fromEditor(event), { filters, properties: ['openFile', 'multiSelections'] });
    if (selection.canceled) return [];
    return Promise.all(selection.filePaths.slice(0, 64).map(async path => {
      if ((await stat(path)).size > 4 * 1024 * 1024) throw new Error(t('translationFileLimit'));
      return { name: basename(path), folder: basename(dirname(path)), text: await readFile(path, 'utf8') };
    }));
  });
  ipcMain.handle('olive:export-translations', async (event, files) => {
    const parent = fromEditor(event);
    if (!Array.isArray(files) || files.length > 64 || files.some(file => typeof file?.name !== 'string' ||
      !/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?\.json$/.test(file.name) ||
      typeof file.text !== 'string' || file.text.length > 4 * 1024 * 1024)) throw new Error(t('fileCommandDenied'));
    const selection = await dialog.showOpenDialog(parent, { properties: ['openDirectory', 'createDirectory'] });
    if (selection.canceled || !selection.filePaths[0]) return null;
    const folder = await mkdtemp(join(selection.filePaths[0], 'translations-'));
    await Promise.all(files.map(file => writeAtomic(join(folder, file.name), file.text)));
    return folder;
  });
  ipcMain.handle('olive:save-config', async (event, token, draft, text) => {
    fromEditor(event);
    if (typeof text !== 'string' || text.length > 1024 * 1024) throw new Error(t('fileCommandDenied'));
    const project = configFiles.get(token);
    const path = project && configPath(project);
    if (path) await writeAtomic(path, text);
    else if (token === undefined && typeof draft === 'string' && /^[\da-f-]{36}$/.test(draft)) {
      const directory = join(profile, 'config-drafts');
      mkdirSync(directory, { recursive: true });
      await writeAtomic(join(directory, draft + '.json'), text);
    } else throw new Error(t('fileCommandDenied'));
  });
  ipcMain.handle('olive:hub-list', async event => {
    fromEditor(event);
    return Promise.all(recentScenes.map(async item => ({
      ...item, name: basename(item.path), exists: await stat(item.path).then(info => info.isFile(), () => false),
    })));
  });
  ipcMain.handle('olive:recovery-list', event => {
    fromEditor(event);
    return recoveryEntries();
  });
  ipcMain.handle('olive:recovery-write', async (event, id, name, text) => {
    fromEditor(event);
    if (typeof id !== 'string' || !recoveryId.test(id) || typeof name !== 'string' || name.length > 255 ||
        typeof text !== 'string' || Buffer.byteLength(text) > 128 * 1024 * 1024) throw new Error('Invalid recovery checkpoint');
    await mkdir(recoveryDirectory, { recursive: true, mode: 0o700 });
    await writeAtomic(join(recoveryDirectory, id + '.json'), JSON.stringify(name) + '\n' + text);
    const copies = await recoveryEntries();
    await Promise.all(copies.slice(recoveryLimit).map(copy => rm(join(recoveryDirectory, copy.id + '.json'), { force: true })));
  });
  ipcMain.handle('olive:recovery-open', async (event, id) => {
    fromEditor(event);
    if (typeof id !== 'string' || !recoveryId.test(id)) return null;
    const file = await readFile(join(recoveryDirectory, id + '.json'), 'utf8').catch(error => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    if (!file) return null;
    const headerEnd = file.indexOf('\n');
    if (headerEnd < 0) return null;
    return { name: t('recoveredFile').replace('{name}', JSON.parse(file.slice(0, headerEnd))), text: file.slice(headerEnd + 1), recovered: true };
  });
  ipcMain.handle('olive:recovery-remove', async (event, id) => {
    fromEditor(event);
    if (typeof id === 'string' && recoveryId.test(id)) await rm(join(recoveryDirectory, id + '.json'), { force: true });
  });
  ipcMain.handle('olive:project-history', async (event, token, action, value) => {
    fromEditor(event);
    const path = configFiles.get(token);
    if (!path) throw new Error(t('gitSaveFirst'));
    const directory = dirname(path), file = basename(path), config = basename(configPath(path));
    const repo = await git(directory, ['rev-parse', '--show-toplevel']).then(trueValue => !!trueValue.trim(), error => {
      if (error.code === 'ENOENT') throw new Error(t('gitUnavailable'));
      return false;
    });
    if (action === 'init') {
      if (!repo) await git(directory, ['init', '-b', 'main']);
      return true;
    }
    if (action === 'status') {
      if (!repo) return { repo, commits: [] };
      const branch = (await git(directory, ['symbolic-ref', '--short', 'HEAD']).catch(() => '')).trim();
      const changed = (await git(directory, ['status', '--porcelain', '--', file, config])).trim();
      const output = await git(directory, ['log', '-n', '50', '--date=iso-strict', '--pretty=format:%H%x1f%ad%x1f%s', '--', file, config]).catch(() => '');
      return { repo, branch, changed, commits: output.split('\n').filter(Boolean).map(line => {
        const [hash, timestamp, ...summary] = line.split('\x1f');
        return { hash, timestamp, summary: summary.join(' ') };
      }) };
    }
    if (!repo) throw new Error(t('gitNoRepository'));
    if (action === 'commit') {
      if (typeof value !== 'string' || !value.trim() || value.length > 2000) throw new Error(t('gitMessage'));
      const files = (await Promise.all([file, config].map(async item => await stat(join(directory, item)).then(meta => meta.isFile() ? item : null, () => null))))
        .filter(Boolean);
      if (!files.includes(file)) throw new Error(t('gitSaveFirst'));
      await git(directory, ['add', '--', ...files]);
      await git(directory, ['commit', '--only', '-m', value.trim(), '--', ...files]);
      return true;
    }
    if (action === 'show' && typeof value === 'string' && /^[a-f0-9]{40,64}$/.test(value)) {
      const text = await git(directory, ['show', `${value}:./${file}`]);
      const configText = await git(directory, ['show', `${value}:./${config}`]).catch(() => undefined);
      return { name: t('recoveredFile').replace('{name}', file), text, configText, recovered: true };
    }
    throw new Error(t('fileCommandDenied'));
  });
  ipcMain.handle('olive:hub-open', (event, id) => {
    fromEditor(event);
    const item = recentScenes.find(item => item.id === id);
    return item ? readScene(item.path) : null;
  });
  ipcMain.handle('olive:ai-status', async (event, provider, url) => {
    fromEditor(event);
    if (provider !== 'lm' && provider !== 'comfy') throw new Error(t('fileCommandDenied'));
    const { localModels } = await gameExportModule();
    return localModels(provider, url);
  });
  ipcMain.handle('olive:ai-request', async (event, id, provider, url, request) => {
    fromEditor(event);
    if (typeof id !== 'string' || !recoveryId.test(id) || aiJobs.has(id) || aiJobs.size >= 4)
      throw new Error(t('aiJobUnavailable'));
    if (provider !== 'lm' && provider !== 'comfy') throw new Error(t('fileCommandDenied'));
    const controller = new AbortController();
    aiJobs.set(id, controller);
    try {
      const { localChat, localGenerate } = await gameExportModule();
      controller.signal.throwIfAborted();
      return await (provider === 'lm' ? localChat(url, request, controller.signal) : localGenerate(url, request, controller.signal));
    } finally { aiJobs.delete(id); }
  });
  ipcMain.handle('olive:ai-cancel', (event, id) => {
    fromEditor(event);
    if (typeof id === 'string') aiJobs.get(id)?.abort();
  });
  ipcMain.handle('olive:hub-remember', (event, token) => {
    fromEditor(event);
    const path = sceneTickets.get(token);
    if (path) {
      sceneTickets.delete(token);
      rememberScene(path);
    }
  });
  ipcMain.handle('olive:hub-action', (event, id, action) => {
    fromEditor(event);
    const item = recentScenes.find(item => item.id === id);
    if (!item) return;
    if (action === 'remove') updateRecents(recentScenes.filter(entry => entry !== item));
    else if (action === 'pin') updateRecents(recentScenes.map(entry =>
      entry === item ? { ...entry, pinned: !entry.pinned } : entry));
    else if (action === 'reveal') shell.showItemInFolder(item.path);
  });
  ipcMain.handle('olive:hub-example', async event => {
    fromEditor(event);
    return { name: 'object-gallery.json', text: await readFile(galleryPath, 'utf8') };
  });
  ipcMain.handle('olive:import-assets', async (event, dropped) => {
    const parent = fromEditor(event);
    if (importing) return [];
    importing = true;
    try {
      let paths = dropped;
      if (paths === undefined) {
        const result = await dialog.showOpenDialog(parent, {
          title: t('importAssets'), properties: ['openFile', 'multiSelections'],
          filters: [{ name: t('assets'), extensions: ['png', 'jpg', 'jpeg', 'webp', 'wav', 'mp3', 'json', 'atlas'] }],
        });
        if (result.canceled) return [];
        paths = result.filePaths;
      }
      if (!Array.isArray(paths) || paths.some(path => typeof path !== 'string' || !path)) {
        throw new Error(t('assetDropError'));
      }
      if (!paths.length) return [];
      const { importAssets } = await assetPack();
      return await importAssets([...new Set(paths)], t);
    } finally {
      importing = false;
    }
  });
  ipcMain.handle('olive:export-bundles', async (event, assets) => {
    const parent = fromEditor(event);
    const result = await dialog.showOpenDialog(parent, {
      title: t('exportBundles'), properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const { exportBundles } = await assetPack();
    return exportBundles(result.filePaths[0], assets, t);
  });
  let exportingGame = false;
  ipcMain.handle('olive:export-targets', async event => {
    fromEditor(event);
    const { exportTargets } = await gameExportModule();
    return exportTargets();
  });
  ipcMain.handle('olive:export-game', async (event, text, options) => {
    const parent = fromEditor(event);
    if (exportingGame || !options || typeof options.title !== 'string' ||
        typeof options.format !== 'string') throw new Error(t('fileCommandDenied'));
    exportingGame = true;
    try {
      const { exportGame, getExportTarget } = await gameExportModule();
      const layout = getExportTarget(options.format)?.layout;
      if (!layout) throw new Error(t('exportUnknownTarget'));
      const zip = layout === 'zip';
      const result = zip
        ? await dialog.showSaveDialog(parent, {
          title: t('exportWindow'), defaultPath: join(app.getPath('documents'), (basename(options.title.trim()) || 'game') + '.zip'),
          filters: [{ name: 'ZIP', extensions: ['zip'] }],
        })
        : await dialog.showOpenDialog(parent, { title: t('exportWindow'), properties: ['openDirectory', 'createDirectory'] });
      const target = zip ? result.filePath : result.filePaths[0];
      if (result.canceled || !target) return null;
      return await exportGame(renderer, serverBundle, target, text, options, bytes => {
        const image = nativeImage.createFromBuffer(bytes);
        const { width, height } = image.getSize();
        return width * height * 4;
      });
    } finally { exportingGame = false; }
  });
  const closeTests = () => {
    for (const { window } of testClients.values()) if (!window.isDestroyed()) window.close();
  };
  const stopNetwork = () => { closeTests(); return network.stop(); };
  app.on('before-quit', () => { void stopNetwork(); hubBridge?.dispose(); });
  ipcMain.handle('olive:network', async (event, action, value) => {
    fromEditor(event);
    switch (action) {
      case 'status': return network.status();
      case 'start': {
        const { validateNetworkDocument } = await gameExportModule();
        const { rules } = validateNetworkDocument(value);
        return network.start(rules);
      }
      case 'stop': return stopNetwork();
      case 'latency':
        if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 2000) break;
        return network.latency(value);
      case 'drop':
        if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(value)) break;
        return network.drop(value);
      case 'client': {
        if (testClients.size >= 4) throw new Error(t('networkClientLimit'));
        const { validateNetworkDocument } = await gameExportModule();
        const { rules } = validateNetworkDocument(value);
        const status = await network.start(rules);
        if (!status.running) throw new Error(status.error || t('networkServerUnavailable'));
        const { text } = validateNetworkDocument(value, status.endpoint);
        const id = crypto.randomUUID();
        const peer = new BrowserWindow({
          width: 820, height: 540, title: t('networkTestClient'),
          webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, partition: 'network-' + id },
        });
        peer.webContents.session.protocol.handle(scheme, serveEditor);
        testClients.set(id, { window: peer, text });
        peer.once('closed', () => testClients.delete(id));
        peer.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        peer.webContents.on('will-navigate', e => e.preventDefault());
        try {
          await peer.loadURL(editorURL + 'game-test/' + id + '/?name=' + encodeURIComponent(t('networkPeerName', { index: ++testClientSequence })));
          return status;
        } catch (error) {
          peer.close();
          throw error;
        }
      }
    }
    throw new Error(t('fileCommandDenied'));
  });
  ipcMain.handle('olive:save-scene', async (event, name, text) => {
    const parent = fromEditor(event);
    if (typeof name !== 'string' || typeof text !== 'string') throw new Error(t('fileCommandDenied'));
    const result = await dialog.showSaveDialog(parent, {
      title: t('saveDialog'), defaultPath: join(app.getPath('documents'), basename(name)), filters,
    });
    if (result.canceled || !result.filePath) return null;
    const { config } = JSON.parse(text);
    await writeAtomic(result.filePath, text);
    await writeAtomic(configPath(result.filePath), JSON.stringify(config, null, 2) + '\n');
    try { rememberScene(result.filePath); }
    catch (error) { console.warn('Could not record saved scene:', error); }
    return { name: basename(result.filePath), configToken: registerConfig(result.filePath) };
  });
  const fileItem = (key, accelerator, command) => ({
    label: t(key), accelerator,
    click: () => window?.webContents.send('olive:file-command', command),
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { label: t('fileMenu'), submenu: [
      fileItem('hubTitle', 'CmdOrCtrl+Shift+H', 'hub'),
      { type: 'separator' },
      fileItem('newScene', 'CmdOrCtrl+N', 'new'),
      fileItem('openScene', 'CmdOrCtrl+O', 'open'),
      fileItem('saveScene', 'CmdOrCtrl+S', 'save'),
      fileItem('exportWindow', undefined, 'export-game'),
      { type: 'separator' }, { role: 'close' },
    ] },
    { label: t('editMenu'), submenu: [
      fileItem('undo', 'CmdOrCtrl+Z', 'undo'), fileItem('redo', 'CmdOrCtrl+Shift+Z', 'redo'),
      { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
    ] },
    { label: t('viewMenu'), submenu: [
      fileItem('settingsTitle', undefined, 'settings'),
      { label: t('panelsMenu'), submenu: [
        ...[['hierarchy', 'hierarchy'], ['scene', 'scene'], ['inspector', 'inspector'],
          ['assets', 'assets'], ['bundles', 'assetBundles']].map(([id, key]) => fileItem(key, undefined, `panel-${id}`)),
        { type: 'separator' }, fileItem('resetPanelLayout', undefined, 'panel-reset'),
      ] },
      { label: t('themeMenu'), submenu: Object.entries(themeLabels).map(([theme, key]) => ({
        id: `theme-${theme}`, label: t(key), type: 'radio', checked: theme === nativeTheme.themeSource,
        click: () => {
          const previous = nativeTheme.themeSource;
          if (previous === theme) return;
          try {
            persistProfile(themeFile, { theme });
            nativeTheme.themeSource = theme;
          } catch (error) {
            const item = Menu.getApplicationMenu()?.getMenuItemById(`theme-${previous}`);
            if (item) item.checked = true;
            dialog.showErrorBox(t('themeSaveError'), String(error));
          }
        },
      })) },
      { type: 'separator' }, { role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' },
      { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
      { type: 'separator' }, { role: 'togglefullscreen' },
    ] },
    { role: 'windowMenu' },
  ]));
}

async function openEditor(t) {
  window = new BrowserWindow({
    title: t('windowTitle'),
    backgroundColor: editorBackground(),
    width: 1320,
    height: 850,
    minWidth: 760,
    minHeight: 560,
    show: false,
    webPreferences: {
      sandbox: true, contextIsolation: true, nodeIntegration: false,
      preload: join(import.meta.dirname, 'preload.cjs'),
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-prevent-unload', event => {
    const choice = dialog.showMessageBoxSync(window, {
      type: 'warning', message: t('unsaved'), detail: t('discardOnClose'),
      buttons: [t('cancel'), t('discardChanges')], defaultId: 0, cancelId: 0,
    });
    if (choice === 1) event.preventDefault();
  });
  window.once('ready-to-show', () => window?.show());
  window.once('closed', () => {
    window = undefined;
    for (const controller of aiJobs.values()) controller.abort();
    void network.stop();
    for (const item of testClients.values()) item.window.close();
  });
  await window.loadURL(editorURL);
}

app.whenReady().then(async () => {
  const { t } = localize(app.getPreferredSystemLanguages());
  const [theme, recents] = await Promise.all([readTheme(), readRecents()]);
  nativeTheme.themeSource = theme;
  recentScenes = recents;
  nativeTheme.on('updated', () => window?.setBackgroundColor(editorBackground()));
  protocol.handle(scheme, serveEditor);
  await installCommands(t);
  app.on('activate', () => {
    if (!window) void openEditor(t);
  });
  return openEditor(t);
}).catch(error => {
  console.error(error);
  app.exit(1);
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
