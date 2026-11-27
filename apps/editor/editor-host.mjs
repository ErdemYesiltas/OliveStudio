import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join } from 'node:path';

export function persistProfile(profile, file, value) {
  const directory = mkdtempSync(join(profile, '.preferences-'));
  try {
    const temporary = join(directory, basename(file));
    writeFileSync(temporary, JSON.stringify(value) + '\n', { mode: 0o600 });
    renameSync(temporary, file);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export function configPath(path) {
  return join(dirname(path), basename(path).replace(/\.json$/i, '') + '.config.json');
}

export async function writeAtomic(path, text) {
  const directory = await mkdtemp(join(dirname(path), '.olivestudio-'));
  try {
    const temporary = join(directory, 'document.json');
    await writeFile(temporary, text, { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, path);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export function installEditorCommands(options) {
  const { ipcMain, dialog, t, profile, renderer, serverBundle, network, gameExportModule, assetPack, galleryPath, theatrePath, tavernPath, photoPath, rigPath, textureSize, documents } = options;
  const recentsFile = join(profile, 'recent-scenes.json');
  const spineLauncherFile = join(profile, 'spine-launcher.json');
  const recoveryDirectory = join(profile, 'recovery');
  const recoveryId = /^[a-f0-9-]{36}$/;
  const recoveryLimit = 8;
  let recentScenes = [];
  let importing = false;
  const aiJobs = new Map();
  const sceneTickets = new Map();
  const configFiles = new Map();
  async function savedSpineLauncher() {
    try {
      const { executable } = JSON.parse(await readFile(spineLauncherFile, 'utf8'));
      if (typeof executable === 'string' && isAbsolute(executable)) return executable;
    } catch (error) {
      if (error.code !== 'ENOENT') console.warn('Could not read Spine launcher preference:', error);
    }
    return undefined;
  }
  const runFile = promisify(execFile);
  const git = async (directory, args) => (await runFile('git', ['--literal-pathspecs', ...args], {
    cwd: directory, timeout: 20000, maxBuffer: 128 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' },
  })).stdout;
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
    persistProfile(profile, recentsFile, sorted);
    recentScenes = sorted;
  }

  async function rememberScene(path) {
    recentScenes = await readRecents();
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

  async function readScene(path, source, embeddedConfig = false) {
    const text = source ?? await readFile(path, 'utf8');
    const configText = embeddedConfig ? undefined : await readFile(configPath(path), 'utf8').catch(error => {
      if (error.code !== 'ENOENT') throw error;
    });
    const recentToken = crypto.randomUUID();
    if (sceneTickets.size >= 10) sceneTickets.delete(sceneTickets.keys().next().value);
    sceneTickets.set(recentToken, path);
    return { name: basename(path), text, configText, configToken: path === options.scenePath ? boundToken : registerConfig(path), recentToken };
  }

  function registerConfig(path) {
    if (configFiles.size >= 64) configFiles.delete(configFiles.keys().next().value);
    const token = crypto.randomUUID();
    configFiles.set(token, path);
    return token;
  }

  const boundToken = options.scenePath ? registerConfig(options.scenePath) : undefined;
  const filters = [{ name: t('sceneFileType'), extensions: ['json'] }];
  const fromEditor = options.sender;
  const stopNetwork = () => { options.closeClients(); return network.stop(); };
  ipcMain.handle('olive:localhub-available', event => { fromEditor(event); return !!options.hubAvailable(); });
  ipcMain.handle('olive:open-scene', async event => {
    const parent = fromEditor(event);
    const result = await dialog.showOpenDialog(parent, { title: t('openScene'), filters, properties: ['openFile'] });
    if (result.canceled || !result.filePaths[0]) return null;
    return options.openScene(result.filePaths[0], readScene);
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
    if (path) {
      if (token !== boundToken) await writeAtomic(path, text);
    }
    else if (token === undefined && typeof draft === 'string' && /^[\da-f-]{36}$/.test(draft)) {
      const directory = join(profile, 'config-drafts');
      mkdirSync(directory, { recursive: true });
      await writeAtomic(join(directory, draft + '.json'), text);
    } else throw new Error(t('fileCommandDenied'));
  });
  ipcMain.handle('olive:hub-list', async event => {
    fromEditor(event);
    recentScenes = await readRecents();
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
    return options.restore({ name: t('recoveredFile').replace('{name}', JSON.parse(file.slice(0, headerEnd))), text: file.slice(headerEnd + 1), recovered: true });
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
      return options.restore({ name: t('recoveredFile').replace('{name}', file), text, configText, recovered: true });
    }
    throw new Error(t('fileCommandDenied'));
  });
  ipcMain.handle('olive:hub-open', async (event, id) => {
    fromEditor(event);
    recentScenes = await readRecents();
    const item = recentScenes.find(item => item.id === id);
    return item ? options.openScene(item.path, readScene) : null;
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
  ipcMain.handle('olive:hub-remember', async (event, token) => {
    fromEditor(event);
    const path = sceneTickets.get(token);
    if (path) {
      sceneTickets.delete(token);
      await rememberScene(path);
    }
  });
  ipcMain.handle('olive:hub-action', async (event, id, action) => {
    fromEditor(event);
    recentScenes = await readRecents();
    const item = recentScenes.find(item => item.id === id);
    if (!item) return;
    if (action === 'remove') updateRecents(recentScenes.filter(entry => entry !== item));
    else if (action === 'pin') updateRecents(recentScenes.map(entry =>
      entry === item ? { ...entry, pinned: !entry.pinned } : entry));
    else if (action === 'reveal') options.reveal(item.path);
  });
  ipcMain.handle('olive:hub-example', async (event, id = 'gallery') => {
    fromEditor(event);
    if (id === 'gallery') return options.restore({ name: 'object-gallery.json', text: await readFile(galleryPath, 'utf8') });
    if (id === 'theatre' && theatrePath) return options.restore({ name: 'moonlight-theatre.json', text: await readFile(theatrePath, 'utf8') });
    if (id === 'tavern' && tavernPath) return options.restore({ name: 'the-poison-apple.json', text: await readFile(tavernPath, 'utf8') });
    if (id === 'photo' && photoPath) return options.restore({ name: '3d-photo.json', text: await readFile(photoPath, 'utf8') });
    if (id === 'rig' && rigPath) return options.restore({ name: 'skeleton2d.json', text: await readFile(rigPath, 'utf8') });
    throw new Error(t('fileCommandDenied'));
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
          filters: [{ name: t('assets'), extensions: ['png', 'jpg', 'jpeg', 'webp', 'wav', 'mp3', 'ogg', 'json', 'skel', 'atlas', 'spine', 'bytes', 'txt', 'zip'] }],
        });
        if (result.canceled) return [];
        paths = result.filePaths;
      }
      if (options.stageAssets && dropped !== undefined) {
        const { importAssets } = await assetPack();
        const launcher = await savedSpineLauncher();
        return await options.stageAssets(dropped, staged => importAssets(staged, t, launcher));
      }
      if (!Array.isArray(paths) || paths.some(path => typeof path !== 'string' || !path)) {
        throw new Error(t('assetDropError'));
      }
      if (!paths.length) return [];
      const { importAssets } = await assetPack();
      return await importAssets([...new Set(paths)], t, await savedSpineLauncher());
    } finally {
      importing = false;
    }
  });
  ipcMain.handle('olive:spine-launcher', async (event, action) => {
    const parent = fromEditor(event);
    const { findSpineLauncher, testSpineLauncher } = await assetPack();
    let selection = await savedSpineLauncher();
    if (action === 'choose') {
      const result = await dialog.showOpenDialog(parent, { title: t('spineChooseLauncher'), properties: ['openFile'] });
      const path = result.canceled ? undefined : result.filePaths[0];
      if (path) {
        const candidate = /\.app$/i.test(path) ? join(path, 'Contents', 'MacOS', 'Spine') : path;
        if (!isAbsolute(path) || basename(candidate) !== 'Spine' || !(await findSpineLauncher(candidate))) {
          throw new Error(t('spineInvalidLauncher'));
        }
        persistProfile(profile, spineLauncherFile, { executable: candidate });
        selection = candidate;
      }
    } else if (action === 'reset') {
      persistProfile(profile, spineLauncherFile, { executable: null });
      selection = undefined;
    } else if (action !== 'status' && action !== 'test') throw new Error(t('fileCommandDenied'));
    const path = await findSpineLauncher(selection);
    return { path, configured: selection ?? null, ...(action === 'test' && { test: await testSpineLauncher(path) }) };
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
  ipcMain.handle('olive:export-spine-files', async (event, asset, format = 'runtime') => {
    const parent = fromEditor(event);
    const titles = new Map([['runtime', 'spineExportFiles'], ['project', 'spineExportProject'], ['binary', 'spineExportBinary']]);
    const title = titles.get(format);
    if (!title) throw new Error(t('fileCommandDenied'));
    const result = await dialog.showOpenDialog(parent, {
      title: t(title), properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const { exportSpineFiles, exportSpineProject, exportSpineBinary } = await assetPack();
    const exporter = format === 'project' ? exportSpineProject : format === 'binary' ? exportSpineBinary : exportSpineFiles;
    return exporter(result.filePaths[0], asset, t, format === 'runtime' ? undefined : await savedSpineLauncher());
  });
  ipcMain.handle('olive:convert-spine-binary', async (event, asset) => {
    fromEditor(event);
    const { convertSpineBinary } = await assetPack();
    return convertSpineBinary(asset, t, await savedSpineLauncher());
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
          title: t('exportWindow'), defaultPath: join(documents, (basename(options.title.trim()) || 'game') + '.zip'),
          filters: [{ name: 'ZIP', extensions: ['zip'] }],
        })
        : await dialog.showOpenDialog(parent, { title: t('exportWindow'), properties: ['openDirectory', 'createDirectory'] });
      const target = zip ? result.filePath : result.filePaths[0];
      if (result.canceled || !target) return null;
      return await exportGame(renderer, serverBundle, target, text, options, textureSize);
    } finally { exportingGame = false; }
  });
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
        if (options.clientCount() >= 4) throw new Error(t('networkClientLimit'));
        const { validateNetworkDocument } = await gameExportModule();
        const { rules } = validateNetworkDocument(value);
        const status = await network.start(rules);
        if (!status.running) throw new Error(status.error || t('networkServerUnavailable'));
        const { text } = validateNetworkDocument(value, status.endpoint);
        await options.openClient(text);
        return status;
      }
    }
    throw new Error(t('fileCommandDenied'));
  });
  ipcMain.handle('olive:save-scene', async (event, name, text) => {
    const parent = fromEditor(event);
    if (typeof name !== 'string' || typeof text !== 'string') throw new Error(t('fileCommandDenied'));
    if (options.saveScene && await options.saveScene(name, text, event)) {
      return { name: basename(options.scenePath), configToken: boundToken };
    }
    const result = await dialog.showSaveDialog(parent, {
      title: t('saveDialog'), defaultPath: join(documents, basename(name)), filters,
    });
    if (result.canceled || !result.filePath) return null;
    const { config } = JSON.parse(text);
    await writeAtomic(result.filePath, text);
    await writeAtomic(configPath(result.filePath), JSON.stringify(config, null, 2) + '\n');
    try { await rememberScene(result.filePath); }
    catch (error) { console.warn('Could not record saved scene:', error); }
    const saved = { name: basename(result.filePath), configToken: registerConfig(result.filePath) };
    options.didSaveAs?.(result.filePath);
    return saved;
  });
  return {
    readScene,
    close() {
      for (const controller of aiJobs.values()) controller.abort();
      void stopNetwork();
    },
  };
}
