import {z} from 'zod';
import type {Project} from '@rewrite/project';
import {SceneSchema,type Entity} from '@rewrite/scene';
import {ScriptLibrarySchema} from '@rewrite/scripts/contracts';
import {NetworkEntitySchema,networkEntityType} from './replication';
export * from './replication';
import type {ActionDefinition,TriggerDefinition} from '@rewrite/interactions';
import {InputMapSchema, defaultInputMap, inputSection, type InputMap} from '@rewrite/input';

/**
 * Multiplayer (provider-neutral contracts; Colyseus is the first provider). The server owns the game state that
 * matters: clients send movement *inputs* only, never positions or rewards. One **Network Player** object is the
 * template every connected player gets a copy of; the local copy is predicted and reconciled, remote copies are
 * interpolated. Endpoints are plain addresses; credentials never go into the project or the exported game.
 */
export const multiplayerSection = 'multiplayer.settings';
export const networkPlayerType = 'multiplayer.player';
export const EndpointSchema = z.string().trim().max(200).refine(v => v === '' || /^wss?:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?\/?$/.test(v), 'Use ws://host:port or wss://host (no user name, password, path or query)');
export const MultiplayerSettingsSchema = z.object({
 version: z.literal(1),
 enabled: z.boolean(),
 provider: z.literal('colyseus'),
 /** Room type name clients join (one room type per game in this first version). */
 room: z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/, 'Room names use a-z, 0-9, _ and - and start with a letter'),
 maxPlayers: z.number().int().min(1).max(16),
 /** Server simulation and state patches per second. */
 tickRate: z.number().int().min(10).max(60),
 /** How long a dropped player keeps their seat (0: leave at once). */
 reconnectSeconds: z.number().min(0).max(120),
 /** Remote players are drawn this far in the past, between two server states. */
 interpolationMs: z.number().min(0).max(500),
 /** Where the exported game connects; empty: the page's host on port 2567. Preview always uses the editor's local server. */
 endpoint: EndpointSchema,
}).strict();
export type MultiplayerSettings = z.infer<typeof MultiplayerSettingsSchema>;
export const defaultMultiplayer = (): MultiplayerSettings => ({version: 1, enabled: false, provider: 'colyseus', room: 'game', maxPlayers: 4, tickRate: 20, reconnectSeconds: 15, interpolationMs: 100, endpoint: ''});
export const readMultiplayer = (value: unknown): MultiplayerSettings => { const parsed = MultiplayerSettingsSchema.safeParse(value ?? defaultMultiplayer()); return parsed.success ? parsed.data : defaultMultiplayer(); };

const ActionName = z.string().trim().max(40);
export const NetworkPlayerSchema = z.object({
 /** Server-enforced speed in px/s. */
 speed: z.number().min(1).max(2000),
 /** Input map actions that move the player (names, as in the Input panel). */
 left: ActionName, right: ActionName, up: ActionName, down: ActionName,
}).strict();
export type NetworkPlayer = z.infer<typeof NetworkPlayerSchema>;
export const defaultNetworkPlayer = (): NetworkPlayer => ({speed: 220, left: 'left', right: 'right', up: 'up', down: 'down'});

/** Server rules plus an optional DOM-free authoritative world; presentation asset files stay in the client export. */
export const ServerWorldSchema=z.object({actions:z.array(z.object({id:z.string(),name:z.string()}).strict()).max(256).default([]),scene:SceneSchema,physics:z.json().optional(),scripts:ScriptLibrarySchema}).strict().refine(w=>w.scene.entities.length<=500&&JSON.stringify(w).length<=2000000,'Server world exceeds 500 entities or 2 MB');
export type ServerWorld=z.infer<typeof ServerWorldSchema>;
export interface ServerRules {
 version: 1; room: string; maxPlayers: number; tickRate: number; reconnectSeconds: number;
 world?:ServerWorld;
 speed: number; bounds: {width: number; height: number}; spawn: {x: number; y: number};
}
export const ServerRulesSchema = z.object({
 world:ServerWorldSchema.optional(),
 version: z.literal(1), room: MultiplayerSettingsSchema.shape.room, maxPlayers: MultiplayerSettingsSchema.shape.maxPlayers, tickRate: MultiplayerSettingsSchema.shape.tickRate,
 reconnectSeconds: MultiplayerSettingsSchema.shape.reconnectSeconds, speed: NetworkPlayerSchema.shape.speed,
 bounds: z.object({width: z.number().min(16).max(100000), height: z.number().min(16).max(100000)}).strict(), spawn: z.object({x: z.number().finite(), y: z.number().finite()}).strict(),
}).strict();

/** The first Network Player object of the project (scene order), with its scene. */
export function findNetworkPlayer(project: Pick<Project, 'scenes'>): {sceneId: string; entity: Entity; player: NetworkPlayer} | null {
 for (const s of project.scenes) for (const e of s.entities) { const c = e.components.find(x => x.type === networkPlayerType); if (c) { const p = NetworkPlayerSchema.safeParse(c.data); if (p.success) return {sceneId: s.id, entity: e as Entity, player: p.data}; } }
 return null;
}
/** Server rules from the project (settings, the Network Player's speed and position, the stage as bounds). */
export function serverRules(project: Pick<Project, 'scenes' | 'extensions'> & {stage?: {width: number; height: number}}): ServerRules {
 const settings = readMultiplayer(project.extensions[multiplayerSection]), found = findNetworkPlayer(project);
 if (!found) throw Error('Multiplayer needs a Network Player object (Add › Logic › Network player)');
 const t = found.entity.components.find(c => c.type === 'scene.transform2d')?.data as {x?: number; y?: number} | undefined, stage = project.stage ?? {width: 960, height: 540};
 const scene=project.scenes.find(s=>s.id===found.sceneId)!;
 const templateIds=new Set([found.entity.id]);let size:number;do{size=templateIds.size;for(const e of scene.entities)if(e.parentId&&templateIds.has(e.parentId))templateIds.add(e.id);}while(size!==templateIds.size);
 const replicas=scene.entities.filter(e=>e.components.some(c=>c.type===networkEntityType));
 if(replicas.some(e=>templateIds.has(e.id)))throw Error('Server-owned entities cannot be part of the Network Player template');
 const serverTypes=new Set(['scene.transform2d','behavior.machine','scripts.behaviour','multiplayer.entity']);
 const replicatedIds=new Set(replicas.map(e=>e.id));
 const selectedTypes=new Map(replicas.map(e=>[e.id,new Set(NetworkEntitySchema.parse(e.components.find(c=>c.type===networkEntityType)!.data).fields.map(f=>f.component))]));
 const world=replicas.length?{actions:InputMapSchema.parse(project.extensions[inputSection]??defaultInputMap).actions.map(a=>({id:a.id,name:a.name})),scene:{...scene,entities:scene.entities.filter(e=>!templateIds.has(e.id)).map(e=>({...e,components:e.components.filter(c=>(serverTypes.has(c.type)&&(!['behavior.machine','scripts.behaviour'].includes(c.type)||replicatedIds.has(e.id)))||c.type.startsWith('physics.')||Boolean(selectedTypes.get(e.id)?.has(c.type)))}))},physics:project.extensions['physics.world'],scripts:ScriptLibrarySchema.parse(project.extensions['scripts.library']??{version:1,items:[]})}:undefined;
 for(const e of replicas)NetworkEntitySchema.parse(e.components.find(c=>c.type===networkEntityType)!.data);
 return ServerRulesSchema.parse({...(world?{world}:{}),version: 1, room: settings.room, maxPlayers: settings.maxPlayers, tickRate: settings.tickRate, reconnectSeconds: settings.reconnectSeconds, speed: found.player.speed, bounds: {width: stage.width, height: stage.height}, spawn: {x: t?.x ?? stage.width / 2, y: t?.y ?? stage.height / 2}});
}
/** The page origins an exported game needs for its server (WebSocket plus the HTTP matchmaking route). */
export function gameServerOrigins(settings: MultiplayerSettings): string[] {
 if (!settings.enabled) return [];
 if (!settings.endpoint) return ['ws://*:2567', 'wss://*:2567', 'http://*:2567', 'https://*:2567'];
 const url = new URL(settings.endpoint), host = url.host, secure = url.protocol === 'wss:';
 return [`${secure ? 'wss' : 'ws'}://${host}`, `${secure ? 'https' : 'http'}://${host}`];
}
/** Problems that block Play and export when multiplayer is on. */
export function multiplayerProblems(project: Pick<Project, 'scenes' | 'extensions'>): string[] {
 const raw = project.extensions[multiplayerSection];
 if (raw === undefined) return usesNetworkContent(project) ? ['Network components need multiplayer to be enabled (Settings › Multiplayer)'] : [];
 const parsed = MultiplayerSettingsSchema.safeParse(raw);
 if (!parsed.success) return [`Multiplayer settings: ${parsed.error.issues[0]?.message ?? 'invalid'}`];
 if (!parsed.data.enabled) return usesNetworkContent(project) ? ['Network components need multiplayer to be enabled (Settings › Multiplayer)'] : [];
 const players = project.scenes.flatMap(s => s.entities.filter(e => e.components.some(c => c.type === networkPlayerType)).map(e => `${s.name} / ${e.name}`));
 if (!players.length) return ['Multiplayer is enabled but no object has a Network Player component'];
 if (players.length > 1) return [`Only one Network Player template is supported (found: ${players.join(', ')})`];
 const found = findNetworkPlayer(project), map = InputMapSchema.safeParse(project.extensions[inputSection] ?? defaultInputMap);
 const names = new Set(map.success ? map.data.actions.filter(a => a.kind === 'button').map(a => a.name) : []);
 return found ? movementKeys.flatMap(k => found.player[k] && !names.has(found.player[k]) ? [`Network Player: the input action "${found.player[k]}" (${k}) is missing — add it in the Input panel or use Set up movement keys`] : []) : [];
}
const movementKeys = ['left', 'right', 'up', 'down'] as const;
const defaultKeys: Record<(typeof movementKeys)[number], string[]> = {left: ['ArrowLeft', 'KeyA'], right: ['ArrowRight', 'KeyD'], up: ['ArrowUp', 'KeyW'], down: ['ArrowDown', 'KeyS']};
/** The input map with the Network Player's movement actions added (arrow keys and WASD) where they are missing. */
export function ensureMovementActions(map: InputMap, player: NetworkPlayer): InputMap {
 const next = structuredClone(map);
 for (const k of movementKeys) { const name = player[k]; if (!name || next.actions.some(a => a.name === name)) continue; next.actions.push({id: crypto.randomUUID(), name, kind: 'button', bindings: defaultKeys[k].map(code => ({type: 'key' as const, code}))}); }
 return InputMapSchema.parse(next);
}
/** Movement axes from the pressed input actions (by ID): left/right and up/down cancel out. */
export function movementAxes(player: NetworkPlayer, map: InputMap, pressed: Pick<ReadonlySet<string>,'has'>) {
 const down = (name: string) => map.actions.some(a => a.name === name && pressed.has(a.id));
 return {x: (down(player.right) ? 1 : 0) - (down(player.left) ? 1 : 0), y: (down(player.down) ? 1 : 0) - (down(player.up) ? 1 : 0)};
}
const usesNetworkContent=(project:Pick<Project,'scenes'>)=>project.scenes.some(s=>s.entities.some(e=>e.components.some(c=>c.type===networkPlayerType||c.type===networkEntityType)));
export const usesNetworkPlayer = (project: Pick<Project, 'scenes'>) => project.scenes.some(s => s.entities.some(e => e.components.some(c => c.type === networkPlayerType)));
export const multiplayerEnabled = (project: Pick<Project, 'extensions'>) => readMultiplayer(project.extensions[multiplayerSection]).enabled;

/** Rule triggers: connection state of this game, and players (their spawned objects) joining and leaving. */
export const multiplayerTriggers: TriggerDefinition[] = [
 {type: 'multiplayer.connected', titleKey: 'interaction.netConnected', references: () => [{id: 'game', name: 'Game'}]},
 {type: 'multiplayer.disconnected', titleKey: 'interaction.netDisconnected', references: () => [{id: 'game', name: 'Game'}]},
 {type: 'multiplayer.joined', titleKey: 'interaction.netJoined', references: () => [{id: 'game', name: 'Game'}]},
 {type: 'multiplayer.left', titleKey: 'interaction.netLeft', references: () => [{id: 'game', name: 'Game'}]},
];
/** A connection's state for diagnostics, the panel, tests and MCP. */
export interface NetStatus {
 status: 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error';
 endpoint: string; room: string; roomId: string; sessionId: string; error: string;
 players: {sessionId: string; name: string; local: boolean; connected: boolean; x: number; y: number; objectId: string}[];
 pending: number; rejected: number; ping: number | null;
}
/** Dev server state (editor's local server or an exported server) as the panel and MCP see it. */
export interface ServerStatus {
 running: boolean; endpoint: string; port: number; latencyMs: number; error: string;
 rooms: {world?:{entities:import('./replication').ReplicatedEntity[];diagnostics:string[]}|null;roomId: string; name: string; clients: number; maxClients: number; players: {sessionId: string; name: string; connected: boolean; x: number; y: number; lastSeq: number}[]; rejected: number; recentRejections: string[]}[];
}

export const networkActions=(send:()=>((id:string,event:{type:string;[key:string]:unknown})=>void)|undefined):ActionDefinition[]=>[{
 type:'multiplayer.send',titleKey:'net.sendEvent',entityReference:true,references:c=>c.entities.filter(e=>e.components.some(x=>x.type===networkEntityType)).map(e=>({id:e.id,name:e.name})),
 execute:a=>{const fn=send();if(!fn)throw Error('Multiplayer is not connected');const type=String(a.to??'').trim();if(!type)throw Error('Specify a network event');fn(a.targetId,{type,...(a.amount!==undefined?{amount:a.amount}:{})});}
}];
