import * as vscode from 'vscode';
import { createHash } from 'node:crypto';
import { fork } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { imageSize } from 'image-size';
import { configPath, installEditorCommands, writeAtomic } from '../editor/editor-host.mjs';
import { localize } from '../editor/locales/catalog.mjs';
import { localNetwork } from '../editor/network-desktop.mjs';
import { decode, encode } from './transport.mjs';
import { registerNativeViews } from './nativeViews.mjs';
import { sectionScheme } from './sectionFiles.mjs';
import { scriptScheme } from './scriptFiles.mjs';

const editorType = 'oliveStudio.project';
const bundle = name => vscode.Uri.joinPath(extension.extensionUri, name);
let extension;
let localHub;
const localHubHandlers = new Map();
const webviews = new Set();
const projects = new Map();
const canvases = new Map();
let nativeViews;
let openedRails = false;
const explicitText = new Set();
const inspectedTabs = new WeakSet();
let previousProject;

function localPath(uri) {
  if (uri.scheme !== 'file') throw new Error('OliveStudio requires a local project file.');
  return uri.fsPath;
}

function openProject(uri, options) {
  localPath(uri);
  return vscode.commands.executeCommand('vscode.openWith', uri, editorType, options);
}

async function showProjectPanels() {
  for (const id of ['hierarchy', 'inspector', 'assets']) {
    await vscode.commands.executeCommand('oliveStudio.rail.' + id + '.focus');
  }
  await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
}

async function routeActiveJson() {
  const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
  const input = tab?.input;
  if (input instanceof vscode.TabInputCustom && input.viewType === editorType) {
    previousProject = input.uri.toString();
    return;
  }
  if (!(input instanceof vscode.TabInputText)) {
    previousProject = undefined;
    return;
  }
  const key = input.uri.toString();
  const editor = vscode.window.activeTextEditor;
  if (editor?.document.uri.toString() !== key) return;
  const reopenedAsText = previousProject === key;
  previousProject = undefined;
  if (input.uri.scheme !== 'file' || !/\.json$/i.test(input.uri.path) ||
      inspectedTabs.has(tab) || editor.document.isDirty || tab.isDirty) return;
  inspectedTabs.add(tab);
  if (reopenedAsText || explicitText.delete(key) ||
      !vscode.workspace.getConfiguration('oliveStudio', input.uri).get('autoOpenProjects', true)) return;
  const text = editor.document.getText();
  if (Buffer.byteLength(text) > 100 * 1024 ** 2) return;
  let json;
  try { json = JSON.parse(text); } catch { return; }
  if (!json || !((json.version === 1 && Array.isArray(json.objects)) ||
      (json.version === 2 && Array.isArray(json.scenes)))) return;
  const native = createRequire(bundle('extension.cjs').fsPath);
  if (!native('./game-export.cjs').isOliveProject(json)) return;
  if (tab.group.activeTab !== tab || editor.document.isDirty) return;
  await openProject(input.uri, { viewColumn: editor.viewColumn, preview: tab.isPreview });
  const replacement = tab.group.activeTab?.input;
  if (replacement instanceof vscode.TabInputCustom && replacement.viewType === editorType &&
      replacement.uri.toString() === key && tab.group.tabs.includes(tab) && !tab.isDirty) {
    await vscode.window.tabGroups.close(tab, true);
  }
}

const fileDialog = {
  async showOpenDialog(_parent, { title, filters, properties }) {
    const folder = properties.includes('openDirectory');
    const result = await vscode.window.showOpenDialog({
      title, filters: filters && Object.fromEntries(filters.map(filter => [filter.name, filter.extensions])),
      canSelectMany: properties.includes('multiSelections'), canSelectFiles: !folder, canSelectFolders: folder,
    });
    return { canceled: !result?.length, filePaths: result?.map(localPath) ?? [] };
  },
  async showSaveDialog(_parent, { title, filters, defaultPath }) {
    const result = await vscode.window.showSaveDialog({
      title, defaultUri: vscode.Uri.file(defaultPath),
      filters: filters && Object.fromEntries(filters.map(filter => [filter.name, filter.extensions])),
    });
    return { canceled: !result, filePath: result && localPath(result) };
  },
};

const rendererUri = () => bundle('renderer');
function webviewResource(panel, uri) {
  return panel.webview.asWebviewUri(uri).toString().replaceAll('&', '&amp;').replaceAll('"', '&quot;');
}

async function webviewHtml(panel, { peer, index, bound = false } = {}) {
  const renderer = rendererUri();
  const folder = peer ? vscode.Uri.joinPath(renderer, 'game-runtime') : renderer;
  const html = await readFile(vscode.Uri.joinPath(folder, peer ? 'game.html' : 'index.html').fsPath, 'utf8');
  const resource = (...segments) => webviewResource(panel, vscode.Uri.joinPath(renderer, ...segments));
  const source = panel.webview.cspSource;
  const policy = [
    "default-src 'none'",
    `script-src ${source} 'wasm-unsafe-eval'`,
    `style-src ${source} 'unsafe-inline'`,
    `img-src ${source} blob: data:`,
    `font-src ${source} data:`,
    `media-src ${source} blob: data:`,
    `connect-src ${source} blob: data: http://127.0.0.1:* ws://127.0.0.1:*`,
`worker-src ${source} blob:`,
  ].join('; ');
  const meta = [
    `<meta http-equiv="Content-Security-Policy" content="${policy}">`,
    `<meta name="olive-asset-root" content="${resource('assetpack')}/">`,
    bound ? '<meta name="olive-bound">' : '',
    peer ? '' : '<meta name="olive-vscode-canvas">',
    peer ? `<meta name="olive-game-project" content="${webviewResource(panel, peer)}"><meta name="olive-game-peer" content="Player ${index}">` : '',
  ];
  return html.replace(/(src|href)="\.\/([^"]+)"/g, (_match, attribute, path) =>
    `${attribute}="${webviewResource(panel, vscode.Uri.joinPath(folder, path))}"`)
    .replace('<head>', '<head>\n' + meta.join('\n'))
    .replace('</head>', (peer ? '' : `<script src="${resource('host.js')}"></script>`) + '</head>');
}

async function stageAssets(files, consume) {
  if (!Array.isArray(files) || files.length > 256) throw new Error('Invalid asset drop.');
  const folder = await mkdtemp(join(tmpdir(), 'olivestudio-drop-'));
  try {
    const names = new Set();
    const paths = [];
    let total = 0;
    for (const { name, bytes } of files) {
      if (typeof name !== 'string' || name.length > 255 || !name || name === '.' || name === '..' ||
          /[\\/:\x00-\x1f]/.test(name) || names.has(name.toLowerCase()) || !(bytes instanceof Uint8Array) ||
          !bytes.length || bytes.length > 24 * 1024 ** 2 || (total += bytes.length) > 64 * 1024 ** 2) {
        throw new Error('The dropped files must have unique, valid names and fit the asset import limit.');
      }
      names.add(name.toLowerCase());
      const path = join(folder, name);
      await writeFile(path, bytes, { flag: 'wx' });
      paths.push(path);
    }
    // An atlas arriving alongside its project JSON is a companion, not an independent asset.
    return await consume(paths.filter(path => !/\.atlas$/i.test(path)));
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

async function showHub(initial, column = vscode.ViewColumn.Active) {
  const panel = vscode.window.createWebviewPanel('oliveStudio.hub', initial?.name ?? 'OliveStudio', column, {
    enableScripts: true, retainContextWhenHidden: true,
  });
  try { await connectEditor(panel, { initial }); }
  catch (error) { panel.dispose(); throw error; }
}

function nodeServer(file, args) {
  const child = fork(file, args, { silent: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
  child.postMessage = message => { if (child.connected) child.send(message, () => {}); };
  child.on('error', error => console.error('OliveStudio multiplayer server', error));
  return child;
}

async function connectEditor(panel, { document, initial } = {}) {
  const profile = extension.globalStorageUri.fsPath;
  await mkdir(profile, { recursive: true });
  const scenePath = document && localPath(document.uri);
  const serverBundle = bundle('network-server/server.mjs').fsPath;
  const renderer = rendererUri().fsPath;
  const network = localNetwork(serverBundle, nodeServer);
  const handlers = new Map();
  const subscriptions = [];
  const clients = new Set();
  const { t } = localize([vscode.env.language]);
  const native = createRequire(bundle('extension.cjs').fsPath);
  const ipcMain = { handle: (channel, fn) => handlers.set(channel, fn) };
  const sender = () => {
    if (!vscode.workspace.isTrusted) throw new Error(t('fileCommandDenied'));
  };
  let debugState = null;
  let canvasState = {};
  let previewFolder;
  const imagePreviews = new Set();
  const imagePreviewsByAlias = new Map();
  const nativePanels = new Set();
  const publish = (channel, value, except) => panel.webview === except ? Promise.resolve(false) :
    panel.webview.postMessage({ channel, payload: encode(value) });
  webviews.add(publish);
  let disposed = false;
  let peerSequence = 0;
  let editor;
  let serial = Promise.resolve();
  const sequence = work => {
    const result = serial.then(work);
    serial = result.catch(() => {});
    return result;
  };

  panel.webview.options = { enableScripts: true, localResourceRoots: [rendererUri()] };
  panel.iconPath = bundle('icon.png');
  const stop = panel.onDidDispose(() => {
    disposed = true;
    subscriptions.forEach(subscription => subscription.dispose());
    editor?.close();
    if (previewFolder) void previewFolder.then(folder => rm(folder, { recursive: true, force: true })).catch(console.warn);
    canvases.delete(panel);
    webviews.delete(publish);
    if (document && projects.get(document.uri.toString()) === projectSession) {
      projects.delete(document.uri.toString());
      refreshViews();
    }
  });
  subscriptions.push(stop);

  const forward = path => openProject(vscode.Uri.file(path), { viewColumn: panel.viewColumn });
  let applying;
  let lastRendered;
  let workspaceState;
  let projectModel;
  let manifest;
  const versions = new WeakMap();
  let pendingConfig;
  let configOnDisk;
  let writeConfigQueue = Promise.resolve();
  const readConfig = () => readFile(configPath(scenePath), 'utf8').catch(error => {
    if (error.code !== 'ENOENT') throw error;
  });

  async function loadDocument(embedded = document.isDirty) {
    const text = document.getText();
    const file = await editor.readScene(scenePath, text, embedded);
    lastRendered = text;
    try {
      const model = native('./game-export.cjs');
      const raw = JSON.parse(file.text);
      if (file.configText !== undefined && raw && typeof raw === 'object') {
        raw.config = model.configSchema.parse(JSON.parse(file.configText));
      }
      projectModel = model.parseProject(raw, file.name.replace(/\.json$/i, ''));
    } catch { projectModel = undefined; }
    nativeViews?.update(projectSession);
    return { ...file, workspaceState, revision: document.version };
  }

  async function edit(text) {
    if (typeof text !== 'string' || !document || disposed) throw new Error('No OliveStudio project is open.');
    if (document.getText() === text) return;
    if (document.getText() !== lastRendered) throw new Error('The project changed in another editor.');
    const version = document.version;
    const range = new vscode.Range(document.positionAt(0), document.positionAt(lastRendered.length));
    const workspaceEdit = new vscode.WorkspaceEdit();
    workspaceEdit.replace(document.uri, range, text);
    applying = text;
    try {
      if (document.version !== version || !await vscode.workspace.applyEdit(workspaceEdit)) {
        throw new Error('VS Code could not apply the OliveStudio edit.');
      }
      if (document.getText() === text) {
        lastRendered = text;
        pendingConfig = true;
      }
    } finally { applying = undefined; }
  }

  editor = installEditorCommands({
    ipcMain, dialog: fileDialog, sender, t, profile, network, renderer, serverBundle, galleryPath: bundle('object-gallery.json').fsPath,
    documents: vscode.workspace.workspaceFolders?.find(item => item.uri.scheme === 'file')?.uri.fsPath ?? homedir(),
    gameExportModule: async () => native('./game-export.cjs'), assetPack: async () => native('./asset-import.cjs'),
    scenePath, hubAvailable: () => !!localHub, stageAssets,
    async openScene(path) { await forward(path); return null; },
    restore: file => document ? (void showHub(file, panel.viewColumn).catch(reportError), null) : file,
    didSaveAs: path => { void forward(path).catch(reportError); },
    reveal: path => vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(path)),
    textureSize: bytes => {
      try { const { width, height } = imageSize(bytes); return width * height * 4; }
      catch { return 0; }
    },
    saveScene: document && ((_name, text, source) => sequence(async () => {
      if (versions.get(source) !== document.version) throw new Error('The project changed in another OliveStudio view.');
      const before = document.version;
      await edit(text);
      versions.set(source, document.version);
      if (document.version !== before) await publish('vscode:document', await loadDocument(true), source);
      if (!await document.save()) throw new Error('VS Code could not save the OliveStudio project.');
      await writeConfigQueue;
      return true;
    })),
    clientCount: () => clients.size,
    closeClients: () => { for (const client of clients) client.dispose(); },
    async openClient(text) {
      const folder = await mkdtemp(join(tmpdir(), 'olivestudio-peer-'));
      const peer = vscode.Uri.file(join(folder, 'project.json'));
      const cleanup = () => rm(folder, { recursive: true, force: true }).catch(reportError);
      try {
        await writeFile(peer.fsPath, text);
        if (disposed) { await cleanup(); return; }
        const client = vscode.window.createWebviewPanel('oliveStudio.peer', t('networkTestClient'), vscode.ViewColumn.Beside, {
          enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [rendererUri(), vscode.Uri.file(folder)],
        });
        clients.add(client);
        client.onDidDispose(() => { clients.delete(client); void cleanup(); });
        try { client.webview.html = await webviewHtml(client, { peer, index: ++peerSequence }); }
        catch (error) { client.dispose(); throw error; }
      } catch (error) { await cleanup(); throw error; }
    },
  });

  ipcMain.handle('vscode:initial', source => sequence(async () => {
    if (!document) return initial;
    if (lastRendered === undefined) configOnDisk = await readConfig();
    const file = await loadDocument();
    versions.set(source, file.revision);
    return file;
  }));
  ipcMain.handle('vscode:edit', (source, text) => sequence(async () => {
    if (versions.get(source) !== document.version) throw new Error('The project changed in another OliveStudio view.');
    const before = document.version;
    await edit(text);
    versions.set(source, document.version);
    if (document.version !== before) await publish('vscode:document', await loadDocument(true), source);
    return document.version;
  }));
  ipcMain.handle('vscode:document-ready', (source, revision) => {
    if (revision === document.version) versions.set(source, revision);
  });
  ipcMain.handle('vscode:workspace-state', (source, state) => sequence(async () => {
    if (!document || !state || typeof state.scene !== 'string' || !Array.isArray(state.selection) || !Array.isArray(state.inspection)) return;
    workspaceState = state;
    nativeViews?.update(projectSession);
    await publish('vscode:workspace-state', state, source);
  }));
  ipcMain.handle('vscode:debug-native-resume', () =>
    panel.webview.postMessage({ channel: 'vscode:debug-action', payload: encode('resume') }));
  ipcMain.handle('vscode:debug-state', (source, state) => {
    if (source !== panel.webview) return;
    debugState = state;
    nativeViews?.updateDebug(projectSession);
  });
  ipcMain.handle('vscode:canvas-state', (source, state) => {
    if (source !== panel.webview) return;
    canvasState = state;
    nativeViews?.updateRuntime(projectSession);
  });
  ipcMain.handle('vscode:debug-control', (_source, action) => publish('vscode:debug-action', action));
  ipcMain.handle('vscode:panels', () => [...nativePanels]);
  ipcMain.handle('vscode:focus-view', (_source, id) => {
    if (!contributedViews().some(view => view.id === 'oliveStudio.rail.' + id)) return;
    return vscode.commands.executeCommand('oliveStudio.rail.' + id + '.focus');
  });
  ipcMain.handle('vscode:travel', (_source, direction) => sequence(async () => {
    if (direction !== 'undo' && direction !== 'redo') return;
    const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    if (activeTab instanceof vscode.TabInputCustom && activeTab.uri.toString() === document?.uri.toString()) {
      await vscode.commands.executeCommand(direction);
    }
  }));
  ipcMain.handle('vscode:preview', (_source, from) => {
    if (from !== 'startup' && from !== 'active') return;
    return panel.webview.postMessage({ channel: 'vscode:preview', payload: encode(from) });
  });
  ipcMain.handle('vscode:edit-prefab', (_source, id) => {
    if (typeof id !== 'string') return;
    return panel.webview.postMessage({ channel: 'vscode:edit-prefab', payload: encode(id) });
  });
  const timelineCommand = command => panel.webview.postMessage({ channel: 'vscode:timeline', payload: encode(command) });
  ipcMain.handle('vscode:timeline', (_source, command) => timelineCommand(command));
  ipcMain.handle('vscode:confirm', async (_event, message) =>
    typeof message === 'string' && await vscode.window.showWarningMessage(message, { modal: true }, 'Continue') === 'Continue');
  ipcMain.handle('vscode:new', () => showHub({ blank: true }, panel.viewColumn));
  ipcMain.handle('vscode:example', () => showHub({ sample: true }, panel.viewColumn));

  if (document) {
    subscriptions.push(panel.onDidChangeViewState(() => {
      if (panel.visible && projectModel && versions.get(panel.webview) !== document.version) {
        void sequence(async () => {
          const file = await loadDocument(true);
          await panel.webview.postMessage({ channel: 'vscode:document', payload: encode(file) });
        }).catch(reportError);
      }
    }));
    subscriptions.push(vscode.workspace.onDidChangeTextDocument(change => {
      if (change.document !== document || !change.contentChanges.length || document.getText() === applying || lastRendered === undefined) return;
      pendingConfig = change.reason ? true : undefined;
      void sequence(async () => publish('vscode:document', await loadDocument(!!change.reason || document.isDirty))).catch(reportError);
    }));
    subscriptions.push(vscode.workspace.onDidSaveTextDocument(saved => {
      if (saved !== document) return;
      const text = document.getText();
      const updateSidecar = pendingConfig;
      pendingConfig = undefined;
      writeConfigQueue = writeConfigQueue.catch(() => {}).then(async () => {
        if (updateSidecar) {
          const config = JSON.parse(text).config;
          if (config) {
            const next = JSON.stringify(config, null, 2) + '\n';
            const sidecar = configPath(scenePath);
            if (vscode.workspace.textDocuments.some(file => file.uri.scheme === 'file' && file.uri.fsPath === sidecar && file.isDirty)) {
              throw new Error('The OliveStudio config file has unsaved changes. The scene was saved; the config file was preserved.');
            }
            const current = await readConfig();
            if (current !== configOnDisk && current !== next) throw new Error('The OliveStudio config file changed on disk. The scene was saved; the config file was preserved.');
            if (current !== next) await writeAtomic(sidecar, next);
            configOnDisk = next;
          }
        }
        await publish('vscode:saved', text);
      });
      void writeConfigQueue.catch(reportError);
    }));
  }

  const listen = webview => webview.onDidReceiveMessage(async ({ channel, id, payload } = {}) => {
    if (!Number.isSafeInteger(id) || typeof payload !== 'string') return;
    try {
      sender();
      const handler = handlers.get(channel) ?? localHubHandlers.get(channel);
      if (!handler) throw new Error(t('fileCommandDenied'));
      const value = await handler(webview, ...decode(payload).map(value => value === null ? undefined : value));
      await webview.postMessage({ id, payload: encode(value) });
    } catch (error) {
      await webview.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
    }
  });
  const projectSession = {
    get project() { return projectModel; },
    get workspace() { return workspaceState; },
    get debug() { return debugState; },
    get runtime() { return canvasState; },
    canvas: action => publish('vscode:canvas-action', action),
    revealsAsset(uri) { return imagePreviews.has(uri.toString()); },
    assetThumbnail(asset) {
      return imagePreviewsByAlias.get(asset.alias)?.uri ??
        (asset.kind === 'image' && !asset.url.startsWith('data:') ? vscode.Uri.file(join(renderer, 'assetpack', asset.path)) : undefined);
    },
    async previewAsset(alias) {
      const asset = projectSession.assets().find(asset => asset.alias === alias);
      if (!asset) return;
      if (asset.kind === 'audio') return projectSession.canvas({ kind: 'playAsset', alias });
      if (asset.kind !== 'image') {
        if (!panel.visible) panel.reveal(panel.viewColumn, true);
        return projectSession.canvas({ kind: 'previewAsset', alias });
      }
      let uri;
      if (asset.url.startsWith('data:')) {
        const hash = createHash('sha256').update(asset.url).digest('hex').slice(0, 16);
        const existing = imagePreviewsByAlias.get(alias);
        if (existing?.hash === hash) uri = existing.uri;
        else {
          const folder = await (previewFolder ??= mkdtemp(join(tmpdir(), 'olive-asset-preview-')));
          const filename = Array.from(basename(asset.path)).slice(-42).join('');
          const directory = join(folder, hash);
          await mkdir(directory, { recursive: true });
          const target = join(directory, filename);
          await writeFile(target, Buffer.from(asset.url.slice(asset.url.indexOf(',') + 1), 'base64'));
          uri = vscode.Uri.file(target);
          imagePreviewsByAlias.set(alias, { hash, uri });
          nativeViews?.update(projectSession);
        }
      } else uri = projectSession.assetThumbnail(asset);
      if (!uri) return;
      imagePreviews.add(uri.toString());
      return vscode.commands.executeCommand('vscode.open', uri, { preview: false });

    },
    uri: document?.uri,
    model: () => native('./game-export.cjs'),
    assets() {
      if (!projectModel) return [];
      const model = projectSession.model();
      return [...(manifest ?? []), model.projectBundle(projectModel.assets)].flatMap(bundle => bundle.assets);
    },
    async change(transform) {
      return sequence(async () => {
        if (!projectModel || disposed) {
          throw new Error('Wait for the scene editor to finish updating.');
        }
        const next = transform(projectModel, projectSession.model());
        if (next === projectModel) return;
        const model = projectSession.model();
        let text;
        try { text = model.serializeProject(model.parseProject(JSON.parse(model.serializeProject(next)))); }
        catch (error) { throw new Error(model.validationMessage(error)); }
        const before = document.version;
        await edit(text);
        if (document.version !== before) await publish('vscode:document', await loadDocument(true));
      });
    },
    async select(patch) {
      if (!projectModel || disposed) return;
      workspaceState = { scene: projectModel.startup, selection: [], inspection: [], ...workspaceState, ...patch };
      nativeViews?.update(projectSession);
      await publish('vscode:workspace-state', workspaceState);
    },
    invoke: (channel, ...args) => {
      sender();
      const handler = handlers.get(channel) ?? localHubHandlers.get(channel);
      if (!handler) throw new Error(t('fileCommandDenied'));
      return handler(panel.webview, ...args);
    },
    setPanelVisibility(id, visible) {
      if (nativePanels.has(id) === visible) return;
      if (visible) nativePanels.add(id);
      else nativePanels.delete(id);
      void publish('vscode:panels', [...nativePanels]);
    },

  };
  if (document) {
    const model = projectSession.model();
    manifest = model.readManifest(JSON.parse(await readFile(join(renderer, 'assetpack', 'manifest.json'), 'utf8')), '');
  }
  canvases.set(panel, command => publish('olive:file-command', command));
  subscriptions.push(panel.onDidChangeViewState(updateCanvasContext), listen(panel.webview));
  panel.webview.html = await webviewHtml(panel, { bound: !!document });
  updateCanvasContext();
  if (document && !disposed) {
    projects.set(document.uri.toString(), projectSession);
    refreshViews();
  }
}

const activeCanvas = () => [...canvases].find(([panel]) => panel.active)?.[1];
function updateCanvasContext() {
  void vscode.commands.executeCommand('setContext', 'oliveStudio.canvasActive', !!activeCanvas());
}

function refreshViews() {
  updateCanvasContext();
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  const active = input instanceof vscode.TabInputCustom && input.viewType === editorType ? projects.get(input.uri.toString()) :
    input instanceof vscode.TabInputText && [scriptScheme, sectionScheme].includes(input.uri.scheme) ?
      projects.get(Buffer.from(input.uri.path.split('/')[1] ?? '', 'base64url').toString()) :
    input?.uri ? [...projects.values()].find(session => session.revealsAsset(input.uri)) : undefined;
  nativeViews?.setSession(active);
  if (active && !openedRails) {
    openedRails = true;
    void showProjectPanels().catch(reportError);
  }
}

function reportError(error) {
  void vscode.window.showErrorMessage('OliveStudio: ' + (error instanceof Error ? error.message : String(error)));
}

const contributedViews = () => Object.values(extension.extension.packageJSON.contributes.views).flat();

export function activate(context) {
  extension = context;
  const native = createRequire(bundle('extension.cjs').fsPath);
  const secretKey = 'olivestudio.localhub';
  localHub = native('./localhub.cjs').registerLocalHub?.({
    store: {
      async load() {
        const data = await extension.secrets.get(secretKey);
        return data ? JSON.parse(data) : null;
      },
      save: session => extension.secrets.store(secretKey, JSON.stringify(session)),
      clear: () => extension.secrets.delete(secretKey),
    },
    handle: (channel, handler) => localHubHandlers.set(channel, handler),
    removeHandler: channel => localHubHandlers.delete(channel),
    sender: () => {},
    send: (channel, value) => {
      for (const publish of webviews) void publish(channel, value);
    },
  });
  if (localHub) context.subscriptions.push(localHub);
  const handle = work => (...args) => Promise.resolve().then(() => work(...args)).catch(reportError);
  nativeViews = registerNativeViews(context, contributedViews(), reportError);
  const workbenchChanged = () => {
    refreshViews();
    void routeActiveJson().catch(reportError);
  };
  context.subscriptions.push(
    vscode.window.tabGroups.onDidChangeTabs(workbenchChanged),
    vscode.window.tabGroups.onDidChangeTabGroups(workbenchChanged),
    vscode.window.onDidChangeActiveTextEditor(workbenchChanged),
    vscode.window.registerCustomEditorProvider(editorType, {
      resolveCustomTextEditor: (document, panel) => connectEditor(panel, { document }),
    }, { webviewOptions: { retainContextWhenHidden: true }, supportsMultipleEditorsPerDocument: false }),
    vscode.commands.registerCommand('oliveStudio.hub', handle(() => showHub())),
    vscode.commands.registerCommand('oliveStudio.openResource', handle(uri => openProject(uri))),
    vscode.commands.registerCommand('oliveStudio.showPanels', handle(showProjectPanels)),
    ...Object.entries({ exportGame: 'export-game', projectSettings: 'settings', findInProject: 'search', saveProject: 'save' })
      .map(([id, command]) => vscode.commands.registerCommand('oliveStudio.' + id, handle(() => activeCanvas()?.(command)))),
    vscode.commands.registerCommand('oliveStudio.openText', handle(async () => {
      const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
      if (!(tab?.input instanceof vscode.TabInputCustom) || tab.input.viewType !== editorType) return;
      const uri = tab.input.uri;
      explicitText.add(uri.toString());
      try {
        await vscode.commands.executeCommand('vscode.openWith', uri, 'default', {
          viewColumn: tab.group.viewColumn, preview: tab.isPreview,
        });
        if (tab.group.tabs.includes(tab) && !tab.isDirty) await vscode.window.tabGroups.close(tab, true);
      } finally { explicitText.delete(uri.toString()); }
    })),
    vscode.commands.registerCommand('oliveStudio.open', handle(async () => {
      const { filePaths } = await fileDialog.showOpenDialog(undefined, {
        title: 'Open OliveStudio Project', filters: [{ name: 'OliveStudio project', extensions: ['json'] }], properties: [],
      });
      if (filePaths[0]) await openProject(vscode.Uri.file(filePaths[0]));
    })),
  );
  workbenchChanged();
}
