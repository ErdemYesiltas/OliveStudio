import {ipcMain, type BrowserWindow} from 'electron';
import {LmClient} from '@rewrite/ai-lm/client.node';
import {ChatRequestSchema} from '@rewrite/ai-lm/contracts';

/** LM Studio bridge in the main process: loopback only, streamed deltas to the renderer, cancellable per job. */
export function registerLm(options: {window(): BrowserWindow | null; sender(event: Electron.IpcMainInvokeEvent): void}) {
 const jobs = new Map<string, AbortController>();
 const url = (value: unknown) => { if (typeof value !== 'string' || value.length > 200) throw Error('Invalid LM Studio address'); return value; };
 ipcMain.handle('lm:status', async (event, value: unknown) => { options.sender(event); return new LmClient(url(value)).status(); });
 ipcMain.handle('lm:cancel', (event, jobId: unknown) => { options.sender(event); if (typeof jobId === 'string') jobs.get(jobId)?.abort(); });
 ipcMain.handle('lm:chat', async (event, value: unknown, jobId: unknown, input: unknown) => {
  options.sender(event);
  if (typeof jobId !== 'string' || !/^[a-f0-9-]{36}$/.test(jobId) || jobs.has(jobId)) throw Error('Invalid assistant job');
  const client = new LmClient(url(value)), request = ChatRequestSchema.parse(input), abort = new AbortController();
  jobs.set(jobId, abort);
  try { return await client.chat(request, delta => options.window()?.webContents.send('lm:delta', {jobId, ...delta}), abort.signal); }
  catch (error) { if (abort.signal.aborted) throw Error('Assistant cancelled'); throw error; }
  finally { jobs.delete(jobId); options.window()?.webContents.send('lm:delta', {jobId, done: true}); }
 });
 return {dispose() { for (const job of jobs.values()) job.abort(); jobs.clear(); for (const channel of ['lm:status', 'lm:cancel', 'lm:chat']) ipcMain.removeHandler(channel); }};
}
