import createBridge from '../editor/host-bridge.cjs';
import { decode, encode } from './transport.mjs';

const vscode = acquireVsCodeApi();
const pending = new Map();
const events = new Map();
let sequence = 0;

function invoke(channel, ...args) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    vscode.postMessage({ channel, id, payload: encode(args) });
  });
}

function listen(channel, callback) {
  const callbacks = events.get(channel) ?? new Set();
  events.set(channel, callbacks);
  callbacks.add(callback);
  return () => callbacks.delete(callback);
}

window.addEventListener('message', ({ data }) => {
  if (typeof data?.channel === 'string') {
    for (const callback of events.get(data.channel) ?? []) callback(decode(data.payload));
    return;
  }
  const waiter = pending.get(data?.id);
  if (!waiter) return;
  pending.delete(data.id);
  if (data.error) waiter.reject(new Error(data.error));
  else waiter.resolve(decode(data.payload));
});

window.oliveFiles = createBridge(invoke, listen, async files => {
  if (!files) return undefined;
  let total = 0;
  for (const file of files) {
    total += file.size;
    if (file.size > 24 * 1024 ** 2 || total > 64 * 1024 ** 2) throw new Error('The asset import exceeds the file size limit.');
  }
  return Promise.all(files.map(async file => ({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) })));
});

window.oliveHost = {
  initial: () => invoke('vscode:initial'),
  bound: document.querySelector('meta[name="olive-bound"]') !== null,
  onCanvasAction: callback => listen('vscode:canvas-action', callback),
  publishCanvasState: state => invoke('vscode:canvas-state', state),
  panels: () => invoke('vscode:panels'),
  publishDebugState: state => invoke('vscode:debug-state', state),
  onDebugAction: callback => listen('vscode:debug-action', callback),
  onPrefabEdit: callback => listen('vscode:edit-prefab', callback),
  focusView: id => invoke('vscode:focus-view', id),
  onPanels: callback => listen('vscode:panels', callback),
  updateWorkspace: state => invoke('vscode:workspace-state', state),
  onWorkspace: callback => listen('vscode:workspace-state', callback),
  acceptDocument: revision => invoke('vscode:document-ready', revision),
  travel: direction => invoke('vscode:travel', direction),
  onPreview: callback => listen('vscode:preview', callback),
  onTimeline: callback => listen('vscode:timeline', callback),
  edit: text => invoke('vscode:edit', text),
  onDocument: callback => listen('vscode:document', callback),
  onSaved: callback => listen('vscode:saved', callback),
  confirm: message => invoke('vscode:confirm', message),
  newProject: () => invoke('vscode:new'),
  example: () => invoke('vscode:example'),
};
