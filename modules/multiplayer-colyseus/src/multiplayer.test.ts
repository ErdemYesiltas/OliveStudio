import {afterAll, beforeAll, expect, it} from 'vitest';
import {defaultMultiplayer, type ServerRules} from '@rewrite/multiplayer/contracts';
import {InputBudget, Interpolator, Predictor, step} from '@rewrite/multiplayer/netcode';
import {startGameServer, type GameServer} from './server.node';
import {MultiplayerSession, gameEndpoint, type MultiplayerHost} from './client';

const rules: ServerRules = {version: 1, room: 'game', maxPlayers: 4, tickRate: 30, reconnectSeconds: 5, speed: 200, bounds: {width: 960, height: 540}, spawn: {x: 100, y: 200}};
let server: GameServer;
beforeAll(async () => { server = await startGameServer(rules, {port: 0, quiet: true}); });
afterAll(async () => { await server?.close(); });
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
async function until<T>(read: () => T, ok: (v: T) => boolean, ms = 5000) { const end = Date.now() + ms; for (;;) { const v = read(); if (ok(v)) return v; if (Date.now() > end) throw Error('Timed out; last value: ' + JSON.stringify(v)); await wait(20); } }

function client(name: string) {
 const objects = new Map<string, {x: number; y: number; active: boolean}>(), events: string[] = [], logs: string[] = [];
 let axes = {x: 0, y: 0}, seq = 0;
 const host: MultiplayerHost = {
  spawn: (template, x, y) => { events.push(`spawn:${template}`); const id = `${name}-copy-${++seq}`; objects.set(id, {x, y, active: true}); return id; },
  destroy: id => { objects.delete(id); }, setActive: (id, value) => { events.push(`active:${id}:${value}`); },
  place: (id, x, y) => { const o = objects.get(id); if (o) { o.x = x; o.y = y; } },
  emit: e => events.push(`${e.type}${e.event ? ':' + e.event : ''}`), axes: () => axes, now: () => performance.now(), log: (level, m) => logs.push(`${level}: ${m}`),
 };
 const settings = {...defaultMultiplayer(), enabled: true, interpolationMs: 50};
 const session = new MultiplayerSession(settings, rules, {id: 'template', name: 'Hero'}, server.endpoint, host, name);
 let running = true;
 const loop = (async () => { session.system.start!(); while (running) { session.system.update!(1 / 60); await wait(16); } })();
 return {session, objects, events, logs, move(x: number, y: number) { axes = {x, y}; }, async stop() { running = false; await loop; session.dispose(); }};
}

it('shares the netcode step between server and prediction, cuts excess time and interpolates', () => {
 const r = {speed: 100, bounds: {width: 50, height: 50}};
 expect(step({x: 10, y: 10}, {x: 1, y: 1, dt: 0.1}, r)).toEqual({x: 10 + 100 * 0.1 / Math.SQRT2, y: 10 + 100 * 0.1 / Math.SQRT2});
 expect(step({x: 10, y: 10}, {x: 1, y: 0, dt: 5}, r)).toEqual({x: 20, y: 10});
 expect(step({x: 45, y: 10}, {x: 1, y: 0, dt: 0.1}, r).x).toBe(50);
 const budget = new InputBudget(0.05); budget.grant(0.1);
 expect(budget.take(0.1)).toBeCloseTo(0.1); expect(budget.take(0.1)).toBeCloseTo(0.05); expect(budget.take(0.1)).toBe(0);
 const p = new Predictor({x: 0, y: 0}, {speed: 100, bounds: {width: 1000, height: 1000}});
 p.next(1, 0, 0.1); p.next(1, 0, 0.1); const third = p.next(1, 0, 0.1);
 expect(p.position.x).toBeCloseTo(30); p.reconcile({x: 5, y: 0, lastSeq: 1}); expect(p.position.x).toBeCloseTo(25); expect(p.unacknowledged).toBe(2);
 p.reconcile({x: 30, y: 0, lastSeq: third.seq}); expect(p.unacknowledged).toBe(0);
 const i = new Interpolator(); expect(i.sample(0)).toBeNull(); i.push(100, {x: 0, y: 0}); i.push(200, {x: 10, y: 20});
 expect(i.sample(150)).toEqual({x: 5, y: 10}); expect(i.sample(50)).toEqual({x: 0, y: 0}); expect(i.sample(500)).toEqual({x: 10, y: 20});
 expect(gameEndpoint({...defaultMultiplayer(), endpoint: ''}, {protocol: 'https:', hostname: 'play.example'})).toBe('wss://play.example:2567');
 expect(gameEndpoint({...defaultMultiplayer(), endpoint: 'ws://10.0.0.2:3000/'})).toBe('ws://10.0.0.2:3000');
});

it('two clients: server-authoritative movement, remote smoothing, refused client state, reconnect and cleanup', async () => {
 const a = client('Ada'), b = client('Bo');
 try {
  await until(() => [a.session.status(), b.session.status()], ([x, y]) => x.status === 'connected' && y.status === 'connected' && x.players.length === 2 && y.players.length === 2);
  const sa = a.session.status(), sb = b.session.status();
  expect(sa.roomId).toBe(sb.roomId); expect(a.events).toContain('spawn:template');expect(a.events).not.toContain('spawn:Hero'); expect(a.events).toContain('active:template:false');
  expect(sa.players.find(p => p.local)!.name).toBe('Ada');
  const room = () => server.status().rooms[0], serverPos = (id: string) => room().players.find(p => p.sessionId === id)!;
  // Seats spread from the spawn point in join order (either client may join first).
  expect([serverPos(sa.sessionId).x, serverPos(sb.sessionId).x].sort((m, n) => m - n)).toEqual([100, 164]); expect(serverPos(sa.sessionId).y).toBe(200);
  const startX = serverPos(sa.sessionId).x;

  // Ada walks right; the server moves her, Bo sees her smoothly, prediction agrees with the server.
  const started = performance.now();
  a.move(1, 0);
  await until(() => serverPos(sa.sessionId).x, x => x > startX + 200 * 0.3);
  a.move(0, 0);
  const walked = performance.now() - started;
  await until(() => a.session.status().pending, n => n === 0);
  const ada = serverPos(sa.sessionId);
  expect(ada.x).toBeGreaterThan(startX + 200 * 0.3); expect(ada.x).toBeLessThanOrEqual(startX + 200 * (walked / 1000 + 0.3));
  expect(a.session.status().players.find(p => p.local)!.x).toBeCloseTo(ada.x, 0);
  await until(() => b.session.status().players.find(p => p.sessionId === sa.sessionId)!.x, x => Math.abs(x - ada.x) < 0.5);

  // Clients cannot set positions or anything else; out-of-range inputs and replays are refused.
  const before = room().rejected;
  a.session.sendUnchecked('position', {x: 900, y: 10}); a.session.sendUnchecked('reward', {coins: 1e6}); a.session.sendUnchecked('input', {seq: 999999, x: 1, y: 0, dt: 10}); a.session.sendUnchecked('input', {seq: 1, x: 1, y: 0, dt: 0.016});
  await until(() => room(), r => r.rejected >= before + 4);
  await wait(100); expect(serverPos(sa.sessionId).x).toBeCloseTo(ada.x, 3);

  // Dropped by the network (no consent): the seat stays, Bo sees the drop, the client reconnects to the same seat.
  server.drop(sa.sessionId);
  await until(() => room().players.find(p => p.sessionId === sa.sessionId)?.connected, c => c === false, 3000);
  await until(() => a.session.status(), s => s.status === 'connected' && a.events.includes('multiplayer.disconnected'), 8000);
  expect(a.session.status().sessionId).toBe(sa.sessionId);
  await until(() => room().players.find(p => p.sessionId === sa.sessionId)?.connected, c => c === true);
  a.move(0, 1);
  await until(() => serverPos(sa.sessionId).y, y => y > 220);
  a.move(0, 0);

  // Leaving (consented) frees the seat: Bo's copy of Ada is destroyed and a left event fires.
  await a.stop(); expect(a.objects.size).toBe(0);
  await until(() => b.session.status().players.length, n => n === 1);
  expect(b.events.some(e => e.startsWith('multiplayer.left:'))).toBe(true);
  expect([...b.objects.keys()]).toHaveLength(1);
  await until(() => room().players.length, n => n === 1);
 } finally { await a.stop().catch(() => undefined); await b.stop(); }
 await until(() => server.status().rooms.length, n => n === 0, 8000).catch(() => undefined);
});

it('reports join failures without throwing and simulates latency', async () => {
 server.setLatency(120); expect(server.status().latencyMs).toBe(120); server.setLatency(0);
 const logs: string[] = [];
 const session = new MultiplayerSession({...defaultMultiplayer(), enabled: true}, rules, {id: 't', name: 'Hero'}, 'ws://127.0.0.1:1', {spawn: () => 'x', destroy() {}, setActive() {}, place() {}, emit() {}, axes: () => ({x: 0, y: 0}), now: () => 0, log: (l, m) => logs.push(m)});
 await session.connect();
 expect(session.status().status).toBe('error'); expect(logs[0]).toMatch(/could not join ws:\/\/127.0.0.1:1/);
 session.dispose();
});
