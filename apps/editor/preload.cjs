// Sandboxed Electron preloads use the CommonJS loader.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { contextBridge, ipcRenderer, webUtils } = require('electron');
const listen = (channel, callback) => {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const createBridge = require('./host-bridge.cjs');

contextBridge.exposeInMainWorld('oliveFiles', createBridge(
  (channel, ...args) => ipcRenderer.invoke(channel, ...args), listen,
  files => files?.map(file => webUtils.getPathForFile(file)),
));
