import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, nativeTheme, net, protocol, shell, utilityProcess } from 'electron';
import { mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { localize } from './locales/catalog.mjs';
import { localNetwork } from './network-desktop.mjs';
import { installEditorCommands, persistProfile } from './editor-host.mjs';

const scheme = 'olive-studio';
const editorURL = `${scheme}://editor/`;
const renderer = join(import.meta.dirname, app.isPackaged ? 'renderer' : 'dist');
const serverBundle = join(import.meta.dirname, app.isPackaged ? 'network-server/server.mjs' : 'dist/network-server/server.mjs');
const network = localNetwork(serverBundle, (file, args, options) => utilityProcess.fork(file, args, options));
const testClients = new Map();
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
let editorCommands;

const themeFile = join(profile, 'appearance.json');
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

async function installCommands(t) {
  const sender = event => {
    if (!window || event.sender !== window.webContents || event.senderFrame?.url !== editorURL) throw new Error(t('fileCommandDenied'));
    return window;
  };
  const bundle = name => import(pathToFileURL(join(import.meta.dirname, app.isPackaged ? name : 'dist/' + name)).href);
  const { default: localHub } = await bundle('localhub.cjs');
  const hubBridge = localHub?.registerLocalHub?.({ window: () => window, sender, memory: false });
  editorCommands = installEditorCommands({
    ipcMain, dialog, sender, t, profile, renderer, serverBundle, network, gameExportModule,
    documents: app.getPath('documents'),
    galleryPath: app.isPackaged ? join(import.meta.dirname, 'examples', 'object-gallery.json') :
      resolve(import.meta.dirname, '../../examples/object-gallery/object-gallery.json'),
    theatrePath: app.isPackaged ? join(import.meta.dirname, 'examples', 'moonlight-theatre.json') :
      resolve(import.meta.dirname, '../../examples/moonlight-theatre/moonlight-theatre.json'),
    tavernPath: app.isPackaged ? join(import.meta.dirname, 'examples', 'the-poison-apple.json') :
      resolve(import.meta.dirname, '../../examples/the-poison-apple/the-poison-apple.json'),
    photoPath: app.isPackaged ? join(import.meta.dirname, 'examples', '3d-photo.json') :
      resolve(import.meta.dirname, '../../examples/3d-photo/3d-photo.json'),
    rigPath: app.isPackaged ? join(import.meta.dirname, 'examples', 'skeleton2d.json') :
      resolve(import.meta.dirname, '../../examples/skeleton2d/skeleton2d.json'),
    assetPack: () => bundle('asset-import.cjs'),
    hubAvailable: () => !!hubBridge, openScene: (path, readScene) => readScene(path),
    restore: file => file, reveal: path => shell.showItemInFolder(path),
    textureSize: bytes => {
      const { width, height } = nativeImage.createFromBuffer(bytes).getSize();
      return width * height * 4;
    },
    clientCount: () => testClients.size,
    closeClients: () => {
      for (const { window } of testClients.values()) if (!window.isDestroyed()) window.close();
    },
    async openClient(text) {
      const id = crypto.randomUUID();
      const peer = new BrowserWindow({
        width: 820, height: 540, title: t('networkTestClient'),
        webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, partition: 'network-' + id },
      });
      peer.webContents.session.protocol.handle(scheme, serveEditor);
      testClients.set(id, { window: peer, text });
      peer.once('closed', () => testClients.delete(id));
      peer.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      peer.webContents.on('will-navigate', event => event.preventDefault());
      try {
        await peer.loadURL(editorURL + 'game-test/' + id + '/?name=' + encodeURIComponent(t('networkPeerName', { index: ++testClientSequence })));
      } catch (error) {
        peer.close();
        throw error;
      }
    },
  });
  app.on('before-quit', () => { editorCommands.close(); hubBridge?.dispose(); });
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
            persistProfile(profile, themeFile, { theme });
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
      preload: join(import.meta.dirname, app.isPackaged ? 'preload.cjs' : 'dist/preload.cjs'),
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
    editorCommands.close();
  });
  await window.loadURL(editorURL);
}

app.whenReady().then(async () => {
  const { t } = localize(app.getPreferredSystemLanguages());
  const theme = await readTheme();
  nativeTheme.themeSource = theme;
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
