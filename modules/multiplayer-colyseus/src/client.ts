import {Client, type Room} from '@colyseus/sdk';
import type {RuntimeSystem} from '@rewrite/sdk';
import {type ReplicatedEntity,type MultiplayerSettings,type NetStatus} from '@rewrite/multiplayer/contracts';
import {Interpolator, Predictor, type MoveRules, type Vec} from '@rewrite/multiplayer/netcode';

/** What a game runtime (exported player or editor Preview) gives the multiplayer session. */
export interface MultiplayerHost {
 /** Copy the template object by stable ID into the running world; returns the copy's ID. */
 replica?(patch:ReplicatedEntity):void;
 removeReplica?(id:string):void;
 spawn(templateId: string, x: number, y: number): string;
 destroy(id: string): void;
 setActive(id: string, value: boolean): void;
 /** Write a world position into an object's transform. */
 place(id: string, x: number, y: number): void;
 emit(event: {type: string; sourceId: string; event?: string; silent: boolean}): void;
 /** Local movement axes this frame, each in [-1, 1] (from the Network Player's input actions). */
 axes(): Vec;
 /** Real time in milliseconds (performance.now), for interpolation. */
 now(): number;
 log(level: 'info' | 'warn' | 'error', message: string): void;
}
interface RemoteState {sessionId: string; name: string; connected: boolean; x: number; y: number; lastSeq: number}
interface Seat {objectId: string; local: boolean; interpolator?: Interpolator; name: string; connected: boolean; x: number; y: number}

/**
 * Colyseus client for one game: joins (or creates) the room, spawns a copy of the Network Player template for each
 * player, predicts and reconciles the local copy, interpolates the others and reconnects after drops. The template
 * object itself is hidden while connected. All positions it writes come from the server's state or local prediction
 * of inputs the server will validate.
 */
export class MultiplayerSession {
 private room: Room | null = null;
 private seats = new Map<string, Seat>();
 private predictor: Predictor | null = null;
 private state: NetStatus;
 private disposed = false;
 private connecting=false;
 private replicas=new Set<string>();
 private idle = false;
 private ping: number | null = null;
 private pingTimer: ReturnType<typeof setInterval> | null = null;
 readonly system: RuntimeSystem;
 constructor(private settings: MultiplayerSettings, private rules: MoveRules, private template: {id: string; name: string}, private endpoint: string | (() => Promise<string>), private host: MultiplayerHost, private playerName = 'Player') {
  this.state = {status: 'idle', endpoint: typeof endpoint === 'string' ? endpoint : '', room: settings.room, roomId: '', sessionId: '', error: '', players: [], pending: 0, rejected: 0, ping: null};
  this.system = {id: 'multiplayer', start: () => { void this.connect(); }, update: dt => this.update(dt), dispose: () => this.dispose()};
 }
 status(): NetStatus {
  return {...this.state, pending: this.predictor?.unacknowledged ?? 0, ping: this.ping, players: [...this.seats].map(([sessionId, s]) => ({sessionId, name: s.name, local: s.local, connected: s.connected, x: Math.round(s.x * 100) / 100, y: Math.round(s.y * 100) / 100, objectId: s.objectId}))};
 }
 private set(status: NetStatus['status'], error = '') { this.state = {...this.state, status, error}; }
 async connect() {
  if (this.room || this.disposed || this.connecting) return;
  this.connecting=true;
  this.set('connecting');
  try {
   const endpoint = typeof this.endpoint === 'string' ? this.endpoint : await this.endpoint();
   this.state = {...this.state, endpoint};
   if (this.disposed) return;
   const room = await new Client(endpoint).joinOrCreate(this.settings.room, {name: this.playerName});
   if (this.disposed) { void room.leave(true); return; }
   this.room = room;
   room.reconnection.minUptime = 0; room.reconnection.maxRetries = Math.max(3, Math.ceil(this.settings.reconnectSeconds)); room.reconnection.maxDelay = 2000;
   this.state = {...this.state, roomId: room.roomId, sessionId: room.sessionId};
   this.set('connected');
   this.host.setActive(this.template.id, false);
   this.host.emit({type: 'multiplayer.connected', sourceId: 'game', silent: false});
   const live=()=>!this.disposed&&this.room===room;
   room.onStateChange((state: unknown) => {if(live())this.receive(state);});
   room.onDrop(() => { if(!live())return; this.set('reconnecting'); this.host.emit({type: 'multiplayer.disconnected', sourceId: 'game', silent: false}); });
   room.onReconnect(() => { if(!live())return; this.set('connected'); const me = this.read(room.state).find(p => p.sessionId === room.sessionId); if (me) this.predictor?.resume(me.lastSeq); this.host.emit({type: 'multiplayer.connected', sourceId: 'game', silent: false}); });
   room.onLeave((code: number) => { if (!live()) return; if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
    this.set('disconnected', `Left the room (${code})`); this.clearSeats(); this.room = null; this.host.setActive(this.template.id, true); this.host.emit({type: 'multiplayer.disconnected', sourceId: 'game', silent: false}); });
   room.onError((code: number, message?: string) => { if(!live())return; this.state = {...this.state, error: `${code}: ${message ?? ''}`}; });
   this.pingTimer = setInterval(() => { try { room.ping(ms => { if(live())this.ping = ms; }); } catch { /* reconnecting */ } }, 1000);
   this.receive(room.state);
  } catch (error) {
   if(this.disposed)return;
   const message = error instanceof Error ? error.message : String(error);
   this.set('error', message); this.host.log('error', `Multiplayer: could not join ${this.state.endpoint || 'the server'} (${message})`);
  } finally {this.connecting=false;}
 }
 private read(state: unknown): RemoteState[] {
  const players = (state as {players?: {forEach(fn: (p: RemoteState, id: string) => void): void}} | null)?.players, out: RemoteState[] = [];
  players?.forEach((p, sessionId) => out.push({sessionId, name: String(p.name), connected: Boolean(p.connected), x: Number(p.x), y: Number(p.y), lastSeq: Number(p.lastSeq)}));
  return out;
 }
 private receive(state: unknown) {
  const room = this.room; if (!room || this.disposed) return;
  const world=(state as {entities?:{forEach(fn:(value:string,id:string)=>void):void}})?.entities,presentWorld=new Set<string>();
  world?.forEach((json,id)=>{const patch=JSON.parse(json) as ReplicatedEntity;presentWorld.add(id);this.host.replica?.(patch);});
  for(const id of this.replicas)if(!presentWorld.has(id))this.host.removeReplica?.(id);this.replicas=presentWorld;
  const now = this.host.now(), players = this.read(state), present = new Set(players.map(p => p.sessionId));
  for (const p of players) {
   let seat = this.seats.get(p.sessionId);
   if (!seat) {
    // Copies clone the (hidden) template, so they are switched on explicitly.
    const local = p.sessionId === room.sessionId, objectId = this.host.spawn(this.template.id, p.x, p.y);
    this.host.setActive(objectId, true);
    seat = {objectId, local, name: p.name, connected: p.connected, x: p.x, y: p.y, ...(local ? {} : {interpolator: new Interpolator()})};
    if (local) this.predictor = new Predictor({x: p.x, y: p.y}, this.rules);
    this.seats.set(p.sessionId, seat);
    this.host.emit({type: 'multiplayer.joined', sourceId: 'game', event: objectId, silent: false});
   }
   seat.name = p.name; seat.connected = p.connected;
   if (seat.local) this.predictor!.reconcile(p); else seat.interpolator!.push(now, p);
  }
  for (const [sessionId, seat] of this.seats) if (!present.has(sessionId)) { this.seats.delete(sessionId); this.host.destroy(seat.objectId); this.host.emit({type: 'multiplayer.left', sourceId: 'game', event: seat.objectId, silent: false}); }
 }
 private update(dt: number) {
  const room = this.room; if (!room || this.disposed) return;
  if (this.predictor && this.state.status === 'connected' && dt > 0) {
   // Standing still sends one zero input, then nothing until the player moves again.
   const a = this.host.axes(), idle = a.x === 0 && a.y === 0;
   if (!idle || !this.idle) room.send('input', this.predictor.next(a.x, a.y, dt));
   this.idle = idle;
  }
  const at = this.host.now() - this.settings.interpolationMs;
  for (const seat of this.seats.values()) {
   const p = seat.local ? this.predictor?.position : seat.interpolator?.sample(at);
   if (!p) continue;
   seat.x = p.x; seat.y = p.y; this.host.place(seat.objectId, p.x, p.y);
  }
 }
 sendEvent(entityId:string,event:{type:string;[key:string]:unknown}){if(!this.room||this.state.status!=='connected')throw Error('Not connected');this.room.send('event',{entityId,event});}
 /** Sends something the server must refuse (tests and diagnostics: clients cannot set state). */
 sendUnchecked(type: string, payload: unknown) { this.room?.send(type, payload); }
 private clearSeats() { for (const seat of this.seats.values()) try { this.host.destroy(seat.objectId); } catch { /* scene already gone */ } this.seats.clear(); this.predictor = null; }
 dispose() {
  if (this.disposed) return; this.disposed = true;
  if (this.pingTimer) clearInterval(this.pingTimer);
  const room = this.room; this.room = null;
  if (room) void room.leave(true).catch(() => undefined);
  this.clearSeats(); this.replicas.clear(); this.set('disconnected');
 }
}

/** The address an exported game connects to: the setting, else the page's host on port 2567. */
export function gameEndpoint(settings: MultiplayerSettings, location?: {protocol: string; hostname: string}) {
 if (settings.endpoint) return settings.endpoint.replace(/\/$/, '');
 const secure = location?.protocol === 'https:';
 return `${secure ? 'wss' : 'ws'}://${location?.hostname || '127.0.0.1'}:2567`;
}
