import {join} from 'node:path';
import {app, ipcMain, safeStorage, type BrowserWindow, type IpcMainInvokeEvent} from 'electron';
import {MemorySessionStore, SafeStorageSessionStore} from '@localhub/client';
import {registerLocalHub as register} from './native-localhub.mjs';

export function registerLocalHub(options: {window(): BrowserWindow | null; sender(event: IpcMainInvokeEvent): void; memory: boolean}) {
 return register<IpcMainInvokeEvent>({
  store: options.memory ? new MemorySessionStore() : new SafeStorageSessionStore(safeStorage, join(app.getPath('userData'), 'localhub-session.bin')),
  handle: (channel, handler) => ipcMain.handle(channel, handler),
  removeHandler: channel => ipcMain.removeHandler(channel),
  sender: options.sender,
  send: (channel, payload) => options.window()?.webContents.send(channel, payload),
 });
}
