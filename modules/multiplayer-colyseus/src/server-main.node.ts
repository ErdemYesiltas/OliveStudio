import {readFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ServerRulesSchema, type ServerRules} from '@rewrite/multiplayer/contracts';
import {startGameServer} from './server.node';

/**
 * Entry of the game server (`node server.mjs`). Exported servers read rules.json next to the file; the editor starts
 * the same bundle as a child process with `--rules <file>` and drives it over the process channel (status, simulated
 * latency, dropping a player, stop). PORT / --port (default 2567) and HOST / --host (default 0.0.0.0). Put TLS (wss://)
 * in front with a reverse proxy; no credentials are read or stored here.
 */
const here = dirname(fileURLToPath(import.meta.url)), args = process.argv.slice(2);
const option = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const rules = ServerRulesSchema.parse(JSON.parse(await readFile(option('rules') ?? join(here, 'rules.json'), 'utf8'))) as ServerRules;
const port = Number(option('port') ?? process.env.PORT ?? 2567), host = option('host') ?? process.env.HOST ?? '0.0.0.0';
if (!Number.isInteger(port) || port < 0 || port > 65535) throw Error('Invalid port');
const server = await startGameServer(rules, {port, host, quiet: Boolean(option('rules'))});

type Request = {id: number; type: 'status' | 'latency' | 'drop' | 'stop'; ms?: number; sessionId?: string};
const parent = (process as unknown as {parentPort?: {on(e: 'message', fn: (m: {data: Request}) => void): void; postMessage(v: unknown): void}}).parentPort;
const reply = (value: unknown) => { if (parent) parent.postMessage(value); else process.send?.(value); };
const stop = async () => { await server.close(); process.exit(0); };
const handle = (r: Request) => {
 try {
  if (r.type === 'status') return reply({id: r.id, ok: true, value: server.status()});
  if (r.type === 'latency') { server.setLatency(Number(r.ms ?? 0)); return reply({id: r.id, ok: true, value: server.status()}); }
  if (r.type === 'drop') { server.drop(String(r.sessionId ?? '')); return reply({id: r.id, ok: true, value: null}); }
  if (r.type === 'stop') { reply({id: r.id, ok: true, value: null}); void stop(); return; }
  reply({id: r.id, ok: false, error: 'Unknown request'});
 } catch (error) { reply({id: r.id, ok: false, error: error instanceof Error ? error.message : String(error)}); }
};
if (parent) parent.on('message', m => handle(m.data)); else if (process.send) process.on('message', m => handle(m as Request));
reply({type: 'ready', port: server.port, endpoint: server.endpoint});
console.log(`Game server: room "${rules.room}" (${rules.maxPlayers} players, ${rules.tickRate} Hz) on ws://${host}:${server.port}`);
process.once('SIGINT', () => void stop()); process.once('SIGTERM', () => void stop());
// The editor's server ends with the editor even if the editor could not ask it to stop.
if (parent || process.send) process.on('disconnect', () => void stop());
