import {z} from 'zod';
import {automationTool, automationTools, components, createItems, type EditorModule, type Json, type ModuleContext} from '@rewrite/sdk';
import {projectToken} from '@rewrite/project';
import {interactionActions, interactionTriggers, type InteractionCatalog} from '@rewrite/interactions';
import {ScriptLibrarySchema, emptyLibrary, scriptsSection} from '@rewrite/scripts/contracts';
import {compileScript} from '@rewrite/scripts/compile';
import {BehaviorCheckpointSchema,BehaviorSchema, behaviorActions, behaviorEvents, behaviorProblems, behaviorTriggers, behaviorType, type MachineInfo} from './contracts';
import {behaviorLive} from './live';
export * from './contracts';
export {behaviorLive, type BehaviorLiveController} from './live';

/** The state-machine library behind behaviors (XState for now): reads machine scripts without running a game. */
export interface BehaviorProvider {
 id: string; version: string;
 /** Machine identity, states and events of compiled script code; null while the script engine is still loading. */
 describe(code: string, name: string): MachineInfo | null;
 /** Loads what describe needs (the script engine); describe returns null until it resolves. */
 prepare?(): Promise<void>;
}

export const machineTemplate = `// A behavior: states, events and transitions for one object (XState v5, global \`xstate\`).
// Game events arrive as typed events: click, collision, arrive, timer, input.pressed / input.released, message, ...
const {setup, assign} = xstate;

export const params = {speed: param.number(120, {min: 0, max: 600})};

export const machine = setup({
  actions: {
    face: ({context}, dir: number) => { context.self.scaleX = dir; },
  },
}).createMachine({
  id: 'patrol', version: '1',
  context: ({input}) => ({self: input.self, speed: input.params.speed}),
  initial: 'idle',
  states: {
    idle: {after: {1000: 'walking'}, on: {click: 'alert'}},
    walking: {entry: {type: 'face', params: 1}, after: {2000: 'idle'}, on: {click: 'alert'}},
    alert: {after: {1500: 'idle'}},
  },
});
`;

const empty = z.object({}).strict(), id = z.string().min(1).max(100);
const JsonEvent = z.object({type: z.string().trim().min(1).max(80).regex(/^(?!xstate\.)[A-Za-z0-9_.:-]+$/, 'Event types use letters, digits, _ . : - and not the xstate. prefix')}).catchall(z.json()).refine(v => JSON.stringify(v).length <= 4000, 'Event data is limited to 4000 characters');

function registerAutomation(c: ModuleContext, provider: BehaviorProvider) {
 const project = () => c.get(projectToken), library = () => ScriptLibrarySchema.parse(project().document.current.extensions[scriptsSection] ?? emptyLibrary());
 const add = <T,>(name: string, schema: z.ZodType<T>, definition: Parameters<typeof automationTool<T>>[1]) => c.contribute(automationTools, `behavior.${name}`, automationTool(schema, definition));
 add('describe_api', empty, {description: 'Read how behaviors work: machine script template (XState v5 global `xstate`), the game events machines receive, the `behavior` script API and the component shape.', effect: 'read', execute: () => ({provider: {id: provider.id, version: provider.version}, component: behaviorType, template: machineTemplate, events: behaviorEvents, scriptApi: ['behavior.send(object, type, data?)', 'behavior.states(object)', 'behavior.matches(object, path)', 'behavior.snapshot(object)'], machineInput: '{self: GameObject, params}', delays: 'after/delays follow the game clock (Pause stops them, Step advances them)', limits: {eventsPerFrame: 256, history: 20, contextPreviewChars: 2000}})});
 add('list', empty, {description: 'List Behavior components in the project: scene, object, script, pinned machine and static problems that block Play/export.', effect: 'read', execute: () => {
  const p = project().document.current, items = library().items;
  return {problems: behaviorProblems(p), behaviors: p.scenes.flatMap(s => s.entities.flatMap(e => e.components.filter(x => x.type === behaviorType).map(x => { const v = BehaviorSchema.safeParse(x.data); return {sceneId: s.id, scene: s.name, entityId: e.id, object: e.name, componentId: x.id, scriptId: v.success ? v.data.scriptId : '', script: v.success ? items.find(i => i.id === v.data.scriptId)?.name ?? null : null, machine: v.success ? v.data.machine ?? null : null}; })))};
 }});
 add('describe_machine', z.object({scriptId: id}).strict(), {description: 'Evaluate a machine script in a throwaway sandbox (no game) and return its id, version, state paths, initial states and handled event types.', effect: 'read', execute: async a => {
  const script = library().items.find(s => s.id === a.scriptId); if (!script) throw Error('Script not found');
  if (script.error) throw Error(script.error);
  await provider.prepare?.();
  const info = provider.describe(script.code, script.name); if (!info) throw Error('The script engine is still loading; retry shortly');
  return info;
 }});
 add('upsert_machine', z.object({id: id.optional(), name: z.string().trim().min(1).max(60), source: z.string().max(200000).optional()}).strict(), {description: 'Create or update a machine script through the editor compiler (default source: the template). Returns the script and its machine description.', effect: 'edit', execute: a => {
  const data = library(), scriptId = a.id ?? crypto.randomUUID(), old = data.items.findIndex(s => s.id === scriptId);
  if (a.id && old < 0) throw Error('Script not found');
  const source = a.source ?? (old >= 0 ? data.items[old].source : machineTemplate), script = {id: scriptId, name: a.name, source, ...compileScript(source, a.name)};
  if (old < 0) data.items.push(script); else data.items[old] = script;
  project().document.transact('Edit behavior script', p => { p.extensions[scriptsSection] = ScriptLibrarySchema.parse(data) as Json; });
  return {script, machine: script.error ? null : provider.describe(script.code, script.name)};
 }});
 add('attach', z.object({entityId: id, scriptId: id, params: z.record(z.string(), z.union([z.number().finite(), z.string().max(500), z.boolean()])).default({}), pin: z.boolean().default(true)}).strict(), {description: 'Add or replace the Behavior on an object in the open scene. With pin, the machine id/version the script defines now is recorded and checked at runtime.', effect: 'edit', execute: a => {
  const script = library().items.find(s => s.id === a.scriptId); if (!script) throw Error('Script not found');
  if (script.error) throw Error(script.error);
  let machine: {id: string; version?: string} | undefined;
  if (a.pin) { const info = provider.describe(script.code, script.name); if (!info) throw Error('The script engine is still loading; retry shortly'); if (info.error) throw Error(info.error); machine = {id: info.id, ...(info.version ? {version: info.version} : {})}; }
  const value = BehaviorSchema.parse({scriptId: a.scriptId, params: a.params, refs: {}, ...(machine ? {machine} : {})});
  const sceneId = project().activeSceneId;
  let componentId = '';
  project().document.transact('Attach behavior', p => {
   const e = p.scenes.find(s => s.id === sceneId)?.entities.find(x => x.id === a.entityId); if (!e) throw Error('Object not found in the open scene');
   const existing = e.components.find(x => x.type === behaviorType);
   if (existing) { existing.data = value as unknown as Json; componentId = existing.id; } else { componentId = crypto.randomUUID(); e.components.push({id: componentId, type: behaviorType, version: 1, data: value as unknown as Json}); }
  });
  return {componentId, value};
 }});
 add('capture_checkpoint',z.object({entityId:id,session:z.number().int().min(0).optional()}).strict(),{description:'Capture an explicit, versioned domain checkpoint from a machine exporting checkpoint {version,save,restore,migrate?}. This does not capture physics, timers or actor internals.',effect:'read',execute:a=>{const c=behaviorLive.require(a.session);if(!c.checkpoint)throw Error('Checkpoint service unavailable');return BehaviorCheckpointSchema.parse(c.checkpoint(a.entityId));}});
 add('restore_checkpoint',z.object({entityId:id,value:BehaviorCheckpointSchema,session:z.number().int().min(0).optional()}).strict(),{description:'Restore a domain checkpoint through the machine-defined migration/restore event and normal guards. Does not rewind the world or physics.',effect:'session',execute:a=>{const c=behaviorLive.require(a.session);if(!c.checkpoint)throw Error('Checkpoint service unavailable');return c.checkpoint(a.entityId,a.value);}});
 add('inspect', z.object({entityId: id.optional(), session: z.number().int().min(0).optional()}).strict(), {description: 'Read running behaviors in Preview (read-only): active states, status, size-limited context, handled events, recent transitions and errors. Pass session to refuse a newer/older Preview.', effect: 'read', execute: a => { const live = behaviorLive.require(a.session); return {session: live.session, time: live.time(), paused: live.paused(), actors: live.inspect(a.entityId)}; }});
 add('send_event', z.object({entityId: id, event: JsonEvent, session: z.number().int().min(0).optional()}).strict(), {description: 'Send a validated event to an object\'s running behavior in Preview. Only event types the machine handles are accepted; data is JSON. Returns the actor afterwards.', effect: 'session', execute: a => { const live = behaviorLive.require(a.session); const actor = live.send(a.entityId, a.event as {type: string}); behaviorLive.refresh(); return {session: live.session, time: live.time(), actor}; }});
}

/** Behaviors: the Behavior component, its rules, Add menu entry and automation tools; the provider is injected. */
export function createBehaviorModule(provider: BehaviorProvider): EditorModule {
 return {
  manifest: {id: 'behavior', version: '1.0.0', apiVersion: 1, requires: {project: '^1', scene: '^1', interactions: '^1', scripts: '^1'}, entries: {runtime: '@rewrite/behavior/contracts'}},
  activate(c) {
   c.contribute(components, behaviorType, {type: behaviorType, version: 1, titleKey: 'component.behavior', get dataSchema() { return z.toJSONSchema(BehaviorSchema); }, fields: [], defaults: () => ({scriptId: '', params: {}, refs: {}}), parse: v => BehaviorSchema.parse(v) as unknown as Json,
    remapReferences: (value, ids) => { const v = BehaviorSchema.parse(value); v.refs = Object.fromEntries(Object.entries(v.refs).map(([k, ref]) => [k, ids.entities.get(ref) ?? ref])); return v as unknown as Json; }});
   c.contribute(createItems, 'behavior.object', {titleKey: 'create.behavior', category: 'logic', icon: 'logic', name: 'Stateful object', components: [{type: 'pixi.shape', data: {kind: 'rect', width: 80, height: 80, color: '#2bb673'}}, {type: behaviorType}]});
   // In the editor the state paths come from the machine scripts, so rules pick a state and preflight catches typos.
   const states = (entity: InteractionCatalog['entities'][number]) => {
    const component = entity.components.find(x => x.type === behaviorType), v = component && BehaviorSchema.safeParse(component.data);
    const script = v?.success ? ScriptLibrarySchema.safeParse(c.get(projectToken).document.current.extensions[scriptsSection] ?? emptyLibrary()) : undefined;
    const item = script?.success && v?.success ? script.data.items.find(i => i.id === v.data.scriptId) : undefined;
    const info = item && !item.error ? provider.describe(item.code, item.name) : null;
    return info && !info.error ? info.states.map(path => ({id: path, name: path})) : undefined;
   };
   for (const d of behaviorTriggers) c.contribute(interactionTriggers, `behavior.${d.type}`, {...d, references: catalog => catalog.entities.filter(e => e.components.some(x => x.type === behaviorType)).map(e => ({id: e.id, name: e.name, events: states(e)}))});
   for (const d of behaviorActions(() => { const live = behaviorLive.controller; return live ? {send: (entityId, event) => live.send(entityId, event), inspect: entityId => live.inspect(entityId)} : undefined; })) c.contribute(interactionActions, `behavior.${d.type}`, d);
   registerAutomation(c, provider);
   // Machine descriptions (Inspector, pinning, rule state lists, MCP) need the script engine: warm it up front.
   void provider.prepare?.().catch(() => undefined);
  },
 };
}
