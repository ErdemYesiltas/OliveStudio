import {z} from 'zod';
import {automationTool, automationTools, components, createItems, type EditorModule, type Json, type ModuleContext} from '@rewrite/sdk';
import {projectSections, projectToken} from '@rewrite/project';
import {interactionActions,interactionTriggers} from '@rewrite/interactions';
import {InputMapSchema, defaultInputMap, inputSection} from '@rewrite/input';
import {buildTargets} from '@rewrite/build';
import {MultiplayerSettingsSchema, NetworkPlayerSchema, defaultMultiplayer, defaultNetworkPlayer,networkActions, ensureMovementActions, findNetworkPlayer, multiplayerProblems, multiplayerSection, multiplayerTriggers, networkPlayerType, readMultiplayer, serverRules, type ServerRules, type ServerStatus} from './contracts';
import {NetworkEntitySchema,networkEntityType} from './replication';
import {multiplayerLive} from './live';
export * from './contracts';
export {multiplayerLive, type MultiplayerLiveClient} from './live';

/** The local game server in the native process (the same bundle the server export ships). */
export interface MultiplayerServerPort {
 start(rules: ServerRules, port?: number): Promise<ServerStatus>; stop(): Promise<ServerStatus>; status(): Promise<ServerStatus>;
 latency(ms: number): Promise<ServerStatus>; drop(sessionId: string): Promise<ServerStatus>;
}

const empty = z.object({}).strict();
function registerAutomation(c: ModuleContext, server: MultiplayerServerPort) {
 const project = () => c.get(projectToken), doc = () => project().document.current;
 const add = <T,>(name: string, schema: z.ZodType<T>, definition: Parameters<typeof automationTool<T>>[1]) => c.contribute(automationTools, `multiplayer.${name}`, automationTool(schema, definition));
 const rules = () => serverRules(doc() as Parameters<typeof serverRules>[0]);
 add('get_settings', empty, {description: 'Read multiplayer settings (Colyseus provider), the Network Player template, the rules the server would enforce and problems that block Play/export.', effect: 'read', execute: () => { const p = doc(), found = findNetworkPlayer(p); let r: ServerRules | null = null; try { r = rules(); } catch { r = null; } return {settings: readMultiplayer(p.extensions[multiplayerSection]), template: found ? {entityId: found.entity.id, name: found.entity.name, sceneId: found.sceneId, player: found.player} : null, rules: r, problems: multiplayerProblems(p)}; }});
 add('set_settings', MultiplayerSettingsSchema.partial().omit({version: true, provider: true}).strict(), {description: 'Change multiplayer settings (enabled, room, maxPlayers, tickRate, reconnectSeconds, interpolationMs, endpoint). The endpoint is a plain ws:// or wss:// address; credentials are refused.', effect: 'edit', execute: a => { const next = MultiplayerSettingsSchema.parse({...readMultiplayer(doc().extensions[multiplayerSection]), ...a}); project().document.transact('Multiplayer settings', p => { p.extensions[multiplayerSection] = next as unknown as Json; }); return next; }});
 add('setup', z.object({entityId: z.string().min(1).optional()}).strict(), {description: 'Enable multiplayer, make an object of the open scene the Network Player template (or keep the existing one) and add its movement input actions (arrow keys and WASD) where missing. One undo step.', effect: 'edit', execute: a => {
  const sceneId = project().activeSceneId; let template = '';
  project().document.transact('Set up multiplayer', p => {
   p.extensions[multiplayerSection] = {...readMultiplayer(p.extensions[multiplayerSection]), enabled: true} as unknown as Json;
   const existing = findNetworkPlayer(p);
   let player = existing?.player;
   if (a.entityId && (!existing || existing.entity.id !== a.entityId)) {
    if (existing) throw Error(`${existing.entity.name} is already the Network Player template`);
    const e = p.scenes.find(s => s.id === sceneId)?.entities.find(x => x.id === a.entityId); if (!e) throw Error('Object not found in the open scene');
    player = defaultNetworkPlayer(); e.components.push({id: crypto.randomUUID(), type: networkPlayerType, version: 1, data: player as unknown as Json}); template = e.id;
   } else template = existing?.entity.id ?? '';
   if (!player) throw Error('Choose an object to become the Network Player (entityId)');
   p.extensions[inputSection] = ensureMovementActions(InputMapSchema.parse(p.extensions[inputSection] ?? defaultInputMap), player) as unknown as Json;
  });
  return {template, settings: readMultiplayer(doc().extensions[multiplayerSection]), problems: multiplayerProblems(doc())};
 }});
 add('server_status', empty, {description: 'Read the editor\'s local game server: endpoint, simulated latency, rooms and players with their server-side positions, refused client messages.', effect: 'read', execute: () => server.status()});
 add('server', z.object({action: z.enum(['start', 'stop', 'restart']), port: z.number().int().min(0).max(65535).optional()}).strict(), {description: 'Start, stop or restart the local game server (127.0.0.1) with the project\'s current rules. Port 0 or omitted picks a free port. Preview starts it on demand.', effect: 'session', execute: async a => { if (a.action === 'stop') return server.stop(); const status = await server.start(rules(), a.port); multiplayerLive.refresh(); return status; }});
 add('simulate', z.object({latencyMs: z.number().int().min(0).max(2000).optional(), dropSessionId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional()}).strict(), {description: 'Test network conditions on the local server: round-trip latency, or drop one player\'s connection without consent (the client reconnects to its seat within reconnectSeconds).', effect: 'session', execute: async a => { let status = await server.status(); if (a.latencyMs !== undefined) status = await server.latency(a.latencyMs); if (a.dropSessionId) status = await server.drop(a.dropSessionId); return status; }});
 add('send_event',z.object({entityId:z.string().min(1).max(100),event:z.object({type:z.string().min(1).max(80)}).catchall(z.json()).refine(v=>JSON.stringify(v).length<=4000)}).strict(),{description:'Request an allowlisted server-owned Behavior event. The server enforces the entity event whitelist and machine guards; no state patch is accepted.',effect:'session',execute:a=>{const client=multiplayerLive.client;if(!client?.sendEvent)throw Error('No multiplayer client');client.sendEvent(a.entityId,a.event);return{sent:true};}});
 add('client_status', empty, {description: 'Read the Preview client\'s connection: status, endpoint, room, its session, players with predicted/interpolated positions, unacknowledged inputs and ping.', effect: 'read', execute: () => { const live = multiplayerLive.client; if (!live) throw Error('No multiplayer client: start Preview in a scene with the Network Player template'); return live.status(); }});
}

/** Multiplayer: settings, the Network Player component and template object, rules, the server export and tools. */
export function createMultiplayerModule(server: MultiplayerServerPort): EditorModule {
 return {
  manifest: {id: 'multiplayer', version: '1.0.0', apiVersion: 1, requires: {project: '^1', scene: '^1', interactions: '^1', input: '^1', build: '^1'}, entries: {runtime: '@rewrite/multiplayer/contracts'}},
  activate(c) {
   c.contribute(projectSections, multiplayerSection, {key: multiplayerSection, get dataSchema() { return z.toJSONSchema(MultiplayerSettingsSchema); }, parse: v => MultiplayerSettingsSchema.parse(v ?? defaultMultiplayer()) as unknown as Json});
   c.contribute(components, networkPlayerType, {type: networkPlayerType, version: 1, titleKey: 'component.networkPlayer', uniqueInScene: 'Network Player', get dataSchema() { return z.toJSONSchema(NetworkPlayerSchema); }, defaults: () => defaultNetworkPlayer() as unknown as Json, parse: v => NetworkPlayerSchema.parse(v) as unknown as Json,
    fields: [{key: 'speed', titleKey: 'net.speed', kind: 'number'}, ...(['left', 'right', 'up', 'down'] as const).map(key => ({key, titleKey: `net.${key}`, kind: 'string' as const}))]});
   c.contribute(components,networkEntityType,{type:networkEntityType,version:1,titleKey:'component.networkEntity',get dataSchema(){return z.toJSONSchema(NetworkEntitySchema);},defaults:()=>NetworkEntitySchema.parse({}),parse:v=>NetworkEntitySchema.parse(v) as unknown as Json,fields:[]});
   c.contribute(createItems,'multiplayer.entity',{titleKey:'create.networkEntity',category:'logic',icon:'logic',name:'Network entity',components:[{type:'pixi.shape',data:{kind:'rect',width:64,height:64,color:'#2bb673'}},{type:networkEntityType}]});
   c.contribute(createItems, 'multiplayer.player', {titleKey: 'create.networkPlayer', category: 'logic', icon: 'logic', name: 'Network player', components: [{type: 'pixi.shape', data: {kind: 'circle', width: 48, height: 48, color: '#ff8a3d'}}, {type: networkPlayerType}]});
   for(const d of networkActions(()=>multiplayerLive.client?.sendEvent))c.contribute(interactionActions,'multiplayer.send',d);
   for (const d of multiplayerTriggers) c.contribute(interactionTriggers, `multiplayer.${d.type}`, d);
   c.contribute(buildTargets, 'multiplayer.server', {id: 'server', titleKey: 'build.server', nativeEntry: '@rewrite/multiplayer-colyseus/target'});
   registerAutomation(c, server);
   c.own(() => { void server.stop().catch(() => undefined); });
  },
 };
}
