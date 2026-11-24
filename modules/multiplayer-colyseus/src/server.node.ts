import {Room, Server, matchMaker, type Client} from '@colyseus/core';
import {WebSocketTransport} from '@colyseus/ws-transport';
import {MapSchema, schema, t} from '@colyseus/schema';
import {ServerRulesSchema, type ServerRules, type ServerStatus} from '@rewrite/multiplayer/contracts';
import {z} from 'zod';
import {createServerWorld} from './world.node';
import {InputBudget, MoveInputSchema, playerName, step} from '@rewrite/multiplayer/netcode';

/**
 * The authoritative Colyseus room: players' positions live only here. Clients send `input` messages (axes, frame
 * time, sequence); the room validates them, cuts movement time to real time passed, applies them on a fixed tick and
 * patches the state at the tick rate. Anything else a client sends is rejected and counted. A dropped player keeps
 * their seat for `reconnectSeconds`. An optional headless scene runs selected scripts, XState and Matter without rendering or DOM.
 */
export const PlayerState = schema({x: t.float32(), y: t.float32(), name: t.string(), connected: t.boolean(), lastSeq: t.uint32(), index: t.uint8()}, 'PlayerState');
export const GameState = schema({players: t.map(PlayerState), tick: t.uint32(), entities: t.map('string')}, 'GameState');
type Player = InstanceType<typeof PlayerState>;
type Queued = {seq: number; x: number; y: number; dt: number};

export class GameRoom extends Room {
 declare state: InstanceType<typeof GameState>;
 maxMessagesPerSecond = 240;
 rules!: ServerRules;
 rejected = 0;
 /** The last refused messages (type and reason), for diagnostics. */
 recentRejections: string[] = [];
 private queues = new Map<string, Queued[]>();
 private world:Awaited<ReturnType<typeof createServerWorld>>|undefined;
 private events:{entityId:string;event:{type:string;[key:string]:unknown};clientSession:string}[]=[];
 private budgets = new Map<string, InputBudget>();
 async onCreate(options: {rules: ServerRules}) {
  this.rules = ServerRulesSchema.parse(options.rules) as ServerRules;
  this.maxClients = this.rules.maxPlayers;
  this.state = new GameState();
  this.state.players = new MapSchema<Player>(); this.state.entities=new MapSchema<string>();
  if(this.rules.world)this.world=await createServerWorld(this.rules.world,this.rules.bounds);
  this.patchRate = 1000 / this.rules.tickRate;
  this.onMessage('input', (client: Client, message: unknown) => {
   const input = MoveInputSchema.safeParse(message), player = this.state.players.get(client.sessionId), queue = this.queues.get(client.sessionId);
   if (!input.success || !player || !queue) { this.reject(client, 'input'); return; }
   if (input.data.seq <= player.lastSeq || (queue.length && input.data.seq <= queue.at(-1)!.seq)) { this.reject(client, 'stale input'); return; }
   if (queue.length >= 120) queue.shift();
   queue.push(input.data);
  });
  this.onMessage('event',(client:Client,message:unknown)=>{
   const schema=z.object({entityId:z.string().min(1).max(100),event:z.object({type:z.string().min(1).max(80)}).catchall(z.json())}).strict().refine(v=>JSON.stringify(v).length<=4000);
   const parsed=schema.safeParse(message);if(!parsed.success||!this.world||this.events.length>=256){this.reject(client,'behavior event');return;}
   this.events.push({...parsed.data,clientSession:client.sessionId});
  });
  // Positions, rewards or anything else a client may try: the server never takes state from clients.
  this.onMessage('*', (client: Client, type: string | number) => this.reject(client, String(type)));
  this.setSimulationInterval(ms => this.tick(ms / 1000), 1000 / this.rules.tickRate);
 }
 private reject(client: Client, what: string) { this.rejected++; this.recentRejections.push(`${client.sessionId}: ${what}`); if (this.recentRejections.length > 10) this.recentRejections.shift(); if (this.rejected % 50 === 1) console.warn(`[multiplayer] rejected ${what} from ${client.sessionId} (${this.rejected} total)`); }
 private tick(seconds: number) {
  this.state.tick++;
  if(this.world){
   for(const message of this.events.splice(0)){const client=this.clients.find(c=>c.sessionId===message.clientSession);if(!client)continue;try{this.world.send(message.entityId,message.event,message.clientSession);}catch(error){this.reject(client,'behavior event: '+(error instanceof Error?error.message:'refused').slice(0,120));}}
   this.world.advance(seconds);const replicas=this.world.snapshot(),ids=new Set(replicas.map(e=>e.id));
   for(const id of this.state.entities.keys())if(!ids.has(id))this.state.entities.delete(id);
   for(const entity of replicas){const json=JSON.stringify(entity);if(json.length>64000)throw Error('Replicated entity exceeds 64 KB');this.state.entities.set(entity.id,json);}
  }
  for (const [id, player] of this.state.players) {
   const queue = this.queues.get(id), budget = this.budgets.get(id); if (!queue || !budget) continue;
   budget.grant(seconds);
   let p = {x: player.x, y: player.y};
   for (const input of queue.splice(0)) { const dt = budget.take(input.dt); p = step(p, {x: input.x, y: input.y, dt}, this.rules); player.lastSeq = input.seq; }
   player.x = p.x; player.y = p.y;
  }
 }
 onJoin(client: Client, options?: {name?: unknown}) {
  const used = new Set([...this.state.players.values()].map(p => p.index)); let index = 0; while (used.has(index)) index++;
  const player = new PlayerState(); player.name = playerName(options?.name); player.connected = true; player.lastSeq = 0; player.index = index;
  player.x = Math.min(this.rules.bounds.width, Math.max(0, this.rules.spawn.x + index * 64)); player.y = this.rules.spawn.y;
  this.state.players.set(client.sessionId, player); this.queues.set(client.sessionId, []); this.budgets.set(client.sessionId, new InputBudget());
 }
 async onDrop(client: Client) {
  const player = this.state.players.get(client.sessionId); if (player) player.connected = false;
  this.queues.set(client.sessionId, []);
  if (this.rules.reconnectSeconds > 0) await this.allowReconnection(client, this.rules.reconnectSeconds);
 }
 onReconnect(client: Client) { const player = this.state.players.get(client.sessionId); if (player) player.connected = true; this.budgets.set(client.sessionId, new InputBudget()); this.queues.set(client.sessionId, []); }
 worldStatus(){return this.world?{entities:this.world.snapshot(),diagnostics:this.world.diagnostics()}:null;}
 onDispose(){this.world?.dispose();this.world=undefined;this.events=[];}
 onLeave(client: Client) { this.state.players.delete(client.sessionId); this.queues.delete(client.sessionId); this.budgets.delete(client.sessionId); }
 /** Server-side disconnect without consent (tests and the editor's "drop" button exercise reconnection). */
 drop(sessionId: string) { const client = this.clients.find(c => c.sessionId === sessionId) as (Client & {ref?: {terminate?(): void; close?(): void}}) | undefined; if (!client) throw Error('No such player'); if (client.ref?.terminate) client.ref.terminate(); else client.leave(4000); }
}

export interface GameServer {
 readonly port: number; readonly endpoint: string;
 status(): ServerStatus;
 setLatency(ms: number): void;
 drop(sessionId: string): void;
 close(): Promise<void>;
}
/**
 * Starts the game server on `port` (0: any free port) at 127.0.0.1 unless `host` says otherwise. The editor runs it
 * for Preview; the exported server bundle runs it with `node server.mjs`.
 */
export async function startGameServer(rules: ServerRules, options: {port?: number; host?: string; quiet?: boolean} = {}): Promise<GameServer> {
 const parsed = ServerRulesSchema.parse(rules) as ServerRules, host = options.host ?? '127.0.0.1';
 const transport = new WebSocketTransport({pingInterval: 2000, pingMaxRetries: 2});
 const server = new Server({transport, gracefullyShutdown: false, greet: false, ...(options.quiet ? {logger: {info() {}, warn() {}, error: console.error, debug() {}, trace() {}}} : {})});
 server.define(parsed.room, GameRoom, {rules: parsed});
 await server.listen(options.port ?? 2567, host);
 const address = (transport.server?.address?.() ?? null) as {port: number} | null, port = address?.port ?? options.port ?? 2567;
 let latency = 0, closed = false;
 const rooms = listRooms;
 return {
  port, endpoint: `ws://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}`,
  status: () => ({running: !closed, endpoint: `ws://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}`, port, latencyMs: latency, error: '', rooms: rooms().map(room => ({roomId: room.roomId, name: room.roomName, clients: room.clients.length, maxClients: room.maxClients, world:room.worldStatus(), rejected: room.rejected, recentRejections: [...room.recentRejections], players: [...room.state.players.entries()].map(([sessionId, p]) => ({sessionId, name: p.name, connected: p.connected, x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100, lastSeq: p.lastSeq}))}))}),
  setLatency(ms) { latency = Math.max(0, Math.min(2000, Math.round(ms))); server.simulateLatency(latency); },
  drop(sessionId) { const room = rooms().find(r => r.state.players.has(sessionId)); if (!room) throw Error('No such player'); room.drop(sessionId); },
  async close() { if (closed) return; closed = true; for (const room of rooms()) await room.disconnect().catch(() => undefined); await server.gracefullyShutdown(false).catch(() => undefined); },
 };
}
/** The rooms this process runs (the local driver keeps them in memory). */
function listRooms(): GameRoom[] { const ids = ((matchMaker.driver as unknown as {rooms?: {roomId: string}[]}).rooms ?? []).map(r => r.roomId); return ids.map(id => matchMaker.getLocalRoomById(id)).filter((r): r is GameRoom => r instanceof GameRoom); }
