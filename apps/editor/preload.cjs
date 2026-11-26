// Sandboxed Electron preloads use the CommonJS loader.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { contextBridge, ipcRenderer, webUtils } = require('electron');
const listen = (channel, callback) => {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('oliveFiles', {
  open: () => ipcRenderer.invoke('olive:open-scene'),
  save: (name, text) => ipcRenderer.invoke('olive:save-scene', name, text),
  saveConfig: (token, draft, text) => ipcRenderer.invoke('olive:save-config', token, draft, text),
  importTranslations: () => ipcRenderer.invoke('olive:import-translations'),
  exportTranslations: files => ipcRenderer.invoke('olive:export-translations', files),
  importAssets: files => ipcRenderer.invoke('olive:import-assets',
    files?.map(file => webUtils.getPathForFile(file))),
  network: (action, value) => ipcRenderer.invoke('olive:network', action, value),
  exportGame: (text, options) => ipcRenderer.invoke('olive:export-game', text, options),
  exportTargets: () => ipcRenderer.invoke('olive:export-targets'),
  exportBundles: assets => ipcRenderer.invoke('olive:export-bundles', assets),
  history: (token, action, value) => ipcRenderer.invoke('olive:project-history', token, action, value),
  ai: {
    models: (provider, url) => ipcRenderer.invoke('olive:ai-status', provider, url),
    run: (id, provider, url, request) => ipcRenderer.invoke('olive:ai-request', id, provider, url, request),
    cancel: id => ipcRenderer.invoke('olive:ai-cancel', id),
  },
  localHub: {
    available: () => ipcRenderer.invoke('olive:localhub-available'),
    status: () => ipcRenderer.invoke('localhub:status'),
    pair: invite => ipcRenderer.invoke('localhub:pair', invite),
    unpair: () => ipcRenderer.invoke('localhub:unpair'),
    chat: (id, request) => ipcRenderer.invoke('localhub:chat', id, request),
    cancel: id => ipcRenderer.invoke('localhub:cancel', id),
    onDelta: callback => listen('localhub:delta', callback),
    create: request => ipcRenderer.invoke('localhub:create', request),
    job: id => ipcRenderer.invoke('localhub:job', id),
    cancelJob: id => ipcRenderer.invoke('localhub:job-cancel', id),
    preview: id => ipcRenderer.invoke('localhub:job-preview', id),
    outputs: id => ipcRenderer.invoke('localhub:job-outputs', id),
    onEvent: callback => listen('localhub:event', callback),
    files: () => ipcRenderer.invoke('localhub:files'),
    fileContent: id => ipcRenderer.invoke('localhub:file-content', id),
    uploadFile: (bytes, name) => ipcRenderer.invoke('localhub:file-upload', bytes, name),
    deleteFile: id => ipcRenderer.invoke('localhub:file-delete', id),
  },
  recovery: {
    list: () => ipcRenderer.invoke('olive:recovery-list'),
    write: (id, name, text) => ipcRenderer.invoke('olive:recovery-write', id, name, text),
    open: id => ipcRenderer.invoke('olive:recovery-open', id),
    remove: id => ipcRenderer.invoke('olive:recovery-remove', id),
  },
  hub: {
    list: () => ipcRenderer.invoke('olive:hub-list'),
    open: id => ipcRenderer.invoke('olive:hub-open', id),
    remember: token => ipcRenderer.invoke('olive:hub-remember', token),
    action: (id, action) => ipcRenderer.invoke('olive:hub-action', id, action),
    example: () => ipcRenderer.invoke('olive:hub-example'),
  },
  onCommand(callback) {
    const listener = (_event, command) => callback(command);
    ipcRenderer.on('olive:file-command', listener);
    return () => ipcRenderer.removeListener('olive:file-command', listener);
  },
});
