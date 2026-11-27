import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function localNetwork(bundle, startProcess) {
  let active;
  let serial = Promise.resolve();
  let sequence = 0;
  let lastError = '';
  const idle = () => ({ running: false, endpoint: '', port: 0, latencyMs: 0, error: lastError, rooms: [] });
  const run = work => {
    const result = serial.then(work, work);
    serial = result.catch(() => undefined);
    return result;
  };
  const request = (session, type, payload = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { session.pending.delete(id); reject(new Error('The game server did not respond')); }, 4000);
    session.pending.set(id, { resolve, reject, timer });
    session.process.postMessage({ id, type, ...payload });
  });
  const status = async () => {
    const session = active;
    if (!session?.endpoint) return idle();
    try { return await request(session, 'status'); }
    catch (error) { return { ...idle(), error: String(error) }; }
  };
  async function stop() {
    const session = active;
    if (!session) return idle();
    // Wait for the utility process that owns the socket before another start.
    let timeout;
    try {
      await request(session, 'stop').catch(() => undefined);
      await Promise.race([session.exit, new Promise(resolve => {
        timeout = setTimeout(() => { session.process.kill(); resolve(); }, 2000);
      })]);
    } finally { clearTimeout(timeout); }
    return idle();
  }
  async function start(rules) {
    const key = JSON.stringify(rules);
    if (active?.endpoint && active.key === key) return status();
    await stop();
    lastError = '';
    const folder = await mkdtemp(join(tmpdir(), 'olivestudio-room-'));
    try {
      const file = join(folder, 'rules.json');
      await writeFile(file, key);
      const proc = startProcess(bundle, ['--rules', file, '--port', '0', '--host', '127.0.0.1'], {
        serviceName: 'OliveStudio Colyseus server', stdio: 'pipe',
      });
      const session = { process: proc, key, endpoint: '', pending: new Map() };
      active = session;
      let output = '', resolveReady, rejectReady;
      proc.stderr?.on('data', chunk => { output = (output + String(chunk)).slice(-1800); });
      proc.stdout?.resume();
      const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
      session.exit = new Promise(resolve => proc.once('exit', code => {
        if (active === session) {
          active = undefined;
          lastError = code ? output.trim().split('\n').at(-1) || `Game server exited (${code})` : '';
        }
        for (const waiter of session.pending.values()) { clearTimeout(waiter.timer); waiter.reject(new Error('Game server stopped')); }
        session.pending.clear();
        rejectReady(new Error(lastError || 'Game server stopped'));
        void rm(folder, { recursive: true, force: true }).catch(() => {});
        resolve();
      }));
      proc.on('message', message => {
        if (message?.type === 'ready') {
          session.endpoint = message.endpoint;
          resolveReady();
          return;
        }
        const waiter = session.pending.get(message?.id);
        if (!waiter) return;
        session.pending.delete(message.id);
        clearTimeout(waiter.timer);
        if (message.ok) waiter.resolve(message.value);
        else waiter.reject(new Error(message.error || 'Game server request failed'));
      });
      let timer;
      try {
        await Promise.race([ready, new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(output || 'Game server startup timed out')), 12000);
        })]);
      } catch (error) {
        proc.kill();
        throw error;
      } finally { clearTimeout(timer); }
      return status();
    } catch (error) {
      await rm(folder, { recursive: true, force: true });
      throw error;
    }
  }
  return {
    start: rules => run(() => start(rules)), stop: () => run(stop), status,
    latency: ms => active?.endpoint ? request(active, 'latency', { ms }) : idle(),
    drop: async sessionId => {
      if (!active?.endpoint) return idle();
      await request(active, 'drop', { sessionId });
      return status();
    },
  };
}
