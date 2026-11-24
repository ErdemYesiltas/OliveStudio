import type {AutomationContext,ComponentDefinition, CreateItemDefinition, Json} from '@rewrite/sdk';
import {makeEntity, transform, type Entity, type SceneService} from '@rewrite/scene';
import {stageSize, type ProjectService} from '@rewrite/project';
import type {AssetService} from '@rewrite/assets';
import {BindingsSchema, GlobalsSchema, GlobalValueSchema, typeOfGlobal, defaultGlobals, defaultValue, globalsSection, LocalizationSchema, defaultLocalization, localizationSection, languageName, type ActionDefinition, type TriggerDefinition, type InteractionCatalog} from '@rewrite/interactions';
import type {AgentTools} from '@rewrite/ai-lm/agent';
import type {ToolSpec} from '@rewrite/ai-lm/contracts';

/**
 * Editor tools for the LM Studio assistant. Every tool goes through the same services and validation as the UI
 * (one transaction each; the panel squashes a whole turn into one undo step). No file system, saving or exporting.
 */
export interface ToolServices {
 project: ProjectService; scene: SceneService; assets: AssetService;
 definitions(): ReadonlyMap<string, ComponentDefinition>; createItems(): readonly {id: string; value: CreateItemDefinition}[];
 triggers(): readonly TriggerDefinition[]; actions(): readonly ActionDefinition[]; catalog(): InteractionCatalog;
 selection(): readonly string[]; select(ids: readonly string[]): void; text(key: string): string;
 generate(kind: 'image' | 'audio', prompt: string, options: {seconds?: number; width?: number; height?: number; skill?: string}, context?:AutomationContext): Promise<string>;
 /** A skill's instructions (and preset) by name; throws for an unknown skill. */
 useSkill(name: string): string;
 preview(action: 'play' | 'stop'): Promise<void>;
 busy(): boolean;
}
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({type: 'object', properties, required, additionalProperties: false});
const str = (description: string) => ({type: 'string', description}), num = (description: string) => ({type: 'number', description});
const tool = (name: string, description: string, parameters: Record<string, unknown>): ToolSpec => ({type: 'function', function: {name, description, parameters}});
const fieldValues = {type: 'object', description: 'Field values keyed by field name, e.g. {"color":"#ff3355","width":120}', additionalProperties: true};

export const editorToolSpecs: ToolSpec[] = [
 tool('get_editor_state', 'Project overview: scenes, the open scene\'s objects (id, name, parent, position, components), selection, assets, globals, createItems for add_object and component types.', obj({})),
 tool('describe_component', 'Fields of a component type (names, kinds, enum options, defaults).', obj({component: str('Component type, e.g. pixi.shape')}, ['component'])),
 tool('list_interactions', 'Trigger and action types for add_rule, with what their sourceId/targetId refers to.', obj({})),
 tool('create_scene', 'Create a scene and open it.', obj({name: str('Scene name')}, ['name'])),
 tool('open_scene', 'Open a scene for editing.', obj({sceneId: str('Scene id')}, ['sceneId'])),
 tool('rename_scene', 'Rename a scene.', obj({sceneId: str('Scene id'), name: str('New name')}, ['sceneId', 'name'])),
 tool('set_startup_scene', 'Make a scene the one the game starts with.', obj({sceneId: str('Scene id')}, ['sceneId'])),
 tool('delete_scene', 'Delete a scene (not the last one, not one other content refers to).', obj({sceneId: str('Scene id')}, ['sceneId'])),
 tool('add_object', 'Add an object to the open scene from a create item (see get_editor_state.createItems).', obj({item: str('Create item id, e.g. pixi.circle, pixi.rect, pixi.star, pixi.text, pixi.sprite, pixi.particles, layout.row, audio.sound'), name: str('Object name'), x: num('Centre x'), y: num('Centre y'), parentId: str('Optional parent object id'), fields: {type: 'object', description: 'Component field values keyed by component type, e.g. {"pixi.shape":{"color":"#ff0000","width":80}} or {"pixi.text":{"text":"Score"}}', additionalProperties: true}}, ['item'])),
 tool('set_fields', 'Set fields of one component on an object.', obj({objectId: str('Object id'), component: str('Component type'), values: fieldValues}, ['objectId', 'component', 'values'])),
 tool('set_transform', 'Move, rotate (degrees) or scale an object.', obj({objectId: str('Object id'), x: num('x'), y: num('y'), rotation: num('Degrees'), scaleX: num('Scale x'), scaleY: num('Scale y')}, ['objectId'])),
 tool('rename_object', 'Rename an object.', obj({objectId: str('Object id'), name: str('New name')}, ['objectId', 'name'])),
 tool('delete_objects', 'Delete objects (and their children).', obj({ids: {type: 'array', items: {type: 'string'}}}, ['ids'])),
 tool('duplicate_objects', 'Duplicate objects; returns the new ids.', obj({ids: {type: 'array', items: {type: 'string'}}}, ['ids'])),
 tool('set_parent', 'Put an object under a parent (null = scene root).', obj({objectId: str('Object id'), parentId: {type: ['string', 'null'], description: 'Parent id or null'}}, ['objectId', 'parentId'])),
 tool('set_visible', 'Show or hide (activate/deactivate) objects.', obj({ids: {type: 'array', items: {type: 'string'}}, visible: {type: 'boolean'}}, ['ids', 'visible'])),
 tool('select_objects', 'Select objects in the editor.', obj({ids: {type: 'array', items: {type: 'string'}}}, ['ids'])),
 tool('add_component', 'Add a component to an object, optionally with field values.', obj({objectId: str('Object id'), component: str('Component type'), values: fieldValues}, ['objectId', 'component'])),
 tool('remove_component', 'Remove a component from an object.', obj({objectId: str('Object id'), component: str('Component type')}, ['objectId', 'component'])),
 tool('add_rule', 'Add an interaction rule to an object: when trigger happens, run actions.', obj({objectId: str('Object that holds the rule'), trigger: obj({type: str('Trigger type, e.g. pointer.click'), sourceId: str('What the trigger listens to (usually an object id)'), event: str('Optional event name')}, ['type', 'sourceId']), actions: {type: 'array', items: obj({type: str('Action type, e.g. entity.active, scene.change, global.add, global.set, global.toggle'), targetId: str('Target id'), value: {type: 'boolean'}, amount: num('Number for global.add, fades, shakes'), to: {description: 'Value for global.set (number, boolean or string, matching the global)'}}, ['type', 'targetId'])}}, ['objectId', 'trigger', 'actions'])),
 tool('set_global', 'Create or update a project global (number, boolean, string, list or object) used by rules, state machines, {name} / {name.field} text templates and scripts (globals.name).', obj({name: str('Global name (letters, digits, _)'), type: {type: 'string', enum: ['number', 'boolean', 'string', 'list', 'object']}, initial: {description: 'Initial value of that type (a JSON array for list, a JSON object for object)'}}, ['name', 'type'])),
 tool('set_stage_size', 'Set the game stage size in pixels.', obj({width: num('Width'), height: num('Height')}, ['width', 'height'])),
 tool('rename_project', 'Rename the project.', obj({name: str('Project name')}, ['name'])),
 tool('generate_asset', 'Generate an image or sound with ComfyUI/LocalHub (requires a configured AI model; NOT Sound Lab). For procedural game sounds discover soundlab.preset/create. Import it into the Library; returns the asset id (use it as assetId of pixi.sprite or audio.sound fields).', obj({kind: {type: 'string', enum: ['image', 'audio']}, prompt: str('What to generate'), seconds: num('Audio length'), width: num('Image width'), height: num('Image height'), skill: str('Optional skill name whose generation preset (prompt template, LoRAs, size) styles the asset')}, ['kind', 'prompt'])),
 tool('list_strings', 'Localization table (i18next): languages, default language and keyed texts (plural forms are key_one, key_other…; texts show as {@key} in Text objects).', obj({})),
 tool('set_strings', 'Add or change localized texts; missing languages are added. Values may use {{global}} and $t(key). Texts you write are marked for review.', obj({strings: {type: 'array', description: 'e.g. [{"key":"menu.play","values":{"en":"Play","tr":"Oyna"},"note":"Main menu button"}]', items: obj({key: str('Key: letters, digits, _ and .'), values: {type: 'object', description: 'Language code → text', additionalProperties: {type: 'string'}}, note: str('Optional context for translators')}, ['key', 'values'])}}, ['strings'])),
 tool('use_skill', 'Load a skill\'s instructions (and its generation preset) by name before doing work the skill covers.', obj({name: str('Skill name from the Skills list')}, ['name'])),
 tool('preview', 'Start or stop the game preview.', obj({action: {type: 'string', enum: ['play', 'stop']}}, ['action'])),
];

export function createEditorTools(s: ToolServices): AgentTools & {execute(name:string,args:Record<string,unknown>,context?:AutomationContext):unknown} {
 const doc = () => s.scene.document.current;
 const entity = (id: unknown) => {
  const e = typeof id === 'string' ? doc().entities.find(x => x.id === id || x.name === id) : undefined;
  if (e) return e;
  const elsewhere = s.project.document.current.scenes.find(sc => sc.id !== s.project.activeSceneId && sc.entities.some(x => x.id === id || x.name === id));
  throw Error(elsewhere ? `${String(id)} is in scene "${elsewhere.name}" (${elsewhere.id}); call open_scene first` : `No object ${String(id)} in the open scene`);
 };
 const definition = (type: unknown) => { const d = typeof type === 'string' ? s.definitions().get(type) : undefined; if (!d) throw Error(`Unknown component ${String(type)}`); return d; };
 const values = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {}) as Record<string, Json>;
 const setFields = (id: string, type: string, input: Record<string, Json>) => { const d = definition(type), keys = new Set(d.fields.map(f => f.key)); for (const [key, value] of Object.entries(input)) { if (!keys.has(key)) throw Error(`${type} has no field ${key}; fields: ${[...keys].join(', ')}`); s.scene.setField(id, type, key, value); } };
 const scenes = () => s.project.document.current.scenes;
 const scene = (id: unknown) => { const x = scenes().find(v => v.id === id || v.name === id); if (!x) throw Error(`No scene ${String(id)}`); return x; };
 const run: Record<string, (a: Record<string, unknown>,context?:AutomationContext) => unknown> = {
  get_editor_state: () => {
   const p = s.project.document.current, objects = doc().entities;
   return {
    project: p.name, stage: stageSize(p), scenes: p.scenes.map(x => ({id: x.id, name: x.name, startup: x.id === p.entrySceneId, open: x.id === s.project.activeSceneId})),
    objects: objects.slice(0, 200).map(e => { const t = e.components.some(c => c.type === 'scene.transform2d') ? transform(e) : undefined; return {id: e.id, name: e.name, parentId: e.parentId, visible: e.active, x: t?.x, y: t?.y, components: e.components.filter(c => c.type !== 'scene.transform2d').map(c => c.type)}; }), ...(objects.length > 200 ? {moreObjects: objects.length - 200} : {}),
    selection: s.selection(), assets: s.assets.items.slice(0, 100).map(a => ({id: a.id, name: a.name, type: a.type})),
    globals: GlobalsSchema.parse(p.extensions[globalsSection] ?? defaultGlobals).items.map(g => ({id: g.id, name: g.name, type: g.type, initial: g.initial})),
    createItems: s.createItems().map(i => ({id: i.id, name: i.value.name, category: i.value.category})),
    componentTypes: [...s.definitions().values()].filter(d => d.addable !== false && !d.hiddenInInspector && d.type !== 'scene.transform2d').map(d => d.type),
   };
  },
  describe_component: a => { const d = definition(a.component); return {type: d.type, title: s.text(d.titleKey), defaults: d.defaults() as Json, ...(d.dataSchema?{dataSchema:d.dataSchema}:{}), fields: d.fields.map(f => ({key: f.key, kind: f.kind, ...(f.options ? {options: f.options.map(o => o.value)} : {}), ...(f.assetType ? {assetType: f.assetType} : {})}))}; },
  list_interactions: () => ({triggers: s.triggers().map(t => ({type: t.type, title: s.text(t.titleKey), source: t.entityReference ? 'object id' : t.sceneReference ? 'scene id' : t.globalReference ? 'global id' : 'id from references', options: t.references(s.catalog()).slice(0, 20).map(r => ({id: r.id, name: r.name}))})), actions: s.actions().map(x => ({type: x.type, title: s.text(x.titleKey), target: x.entityReference ? 'object id' : x.sceneReference ? 'scene id' : x.globalReference ? 'global id' : 'id from references', options: x.references(s.catalog()).slice(0, 20).map(r => ({id: r.id, name: r.name}))}))}),
  create_scene: a => ({sceneId: s.project.createScene(String(a.name ?? 'Scene'))}),
  open_scene: a => { s.project.openScene(scene(a.sceneId).id); return {open: s.project.activeSceneId}; },
  rename_scene: a => { s.project.renameScene(scene(a.sceneId).id, String(a.name)); return {ok: true}; },
  set_startup_scene: a => { s.project.setEntryScene(scene(a.sceneId).id); return {ok: true}; },
  delete_scene: a => { s.project.removeScene(scene(a.sceneId).id); return {ok: true}; },
  add_object: a => {
   const wanted = String(a.item ?? ''), items = s.createItems(), item = items.find(i => i.id === wanted) ?? items.find(i => i.id.endsWith('.' + wanted) || i.value.name.toLowerCase() === wanted.toLowerCase());
   if (!item) throw Error(`Unknown item ${wanted}; use one of ${items.map(i => i.id).join(', ')}`);
   if(item.value.command)throw Error('Use the module automation tool for this item: pixi3d-editor.create_view or pixi3d-editor.create_node');
   const stage = stageSize(s.project.document.current), e = makeEntity(typeof a.name === 'string' && a.name.trim() ? a.name.trim().slice(0, 100) : item.value.name, Number.isFinite(a.x) ? Number(a.x) : stage.width / 2, Number.isFinite(a.y) ? Number(a.y) : stage.height / 2);
   if (typeof a.parentId === 'string' && a.parentId) e.parentId = entity(a.parentId).id;
   const extra = values(a.fields);
   for (const part of item.value.components) { const d = definition(part.type); e.components.push({id: crypto.randomUUID(), type: part.type, version: d.version, data: d.parse({...(d.defaults() as Record<string, Json>), ...part.data, ...values(extra[part.type])}) as Json}); }
   s.scene.document.transact(`Add ${e.name}`, draft => { draft.entities.push(e); });
   for (const [type, v] of Object.entries(extra)) if (!item.value.components.some(c => c.type === type)) { s.scene.addComponent(e.id, type); setFields(e.id, type, values(v)); }
   return {id: e.id, name: e.name, components: e.components.map(c => c.type)};
  },
  set_fields: a => { const e = entity(a.objectId); setFields(e.id, String(a.component), values(a.values)); return {ok: true}; },
  set_transform: a => { const e = entity(a.objectId), t = transform(e), next = {...t}; for (const k of ['x', 'y', 'rotation', 'scaleX', 'scaleY'] as const) if (Number.isFinite(a[k])) next[k] = Number(a[k]); s.scene.setTransform(e.id, next, t); return next; },
  rename_object: a => { s.scene.rename(entity(a.objectId).id, String(a.name)); return {ok: true}; },
  delete_objects: a => { const ids = (Array.isArray(a.ids) ? a.ids : []).map(id => entity(id).id); s.scene.removeMany(ids); return {deleted: ids.length}; },
  duplicate_objects: a => ({ids: s.scene.duplicateMany((Array.isArray(a.ids) ? a.ids : []).map(id => entity(id).id))}),
  set_parent: a => { s.scene.reparent(entity(a.objectId).id, a.parentId ? entity(a.parentId).id : null); return {ok: true}; },
  set_visible: a => { s.scene.setActiveMany((Array.isArray(a.ids) ? a.ids : []).map(id => entity(id).id), a.visible !== false); return {ok: true}; },
  select_objects: a => { s.select((Array.isArray(a.ids) ? a.ids : []).map(id => entity(id).id)); return {ok: true}; },
  add_component: a => { const e = entity(a.objectId), type = String(a.component); definition(type); s.scene.addComponent(e.id, type); setFields(e.id, type, values(a.values)); return {ok: true}; },
  remove_component: a => { s.scene.removeComponent(entity(a.objectId).id, String(a.component)); return {ok: true}; },
  add_rule: a => {
   const e = entity(a.objectId), trigger = values(a.trigger), actions = Array.isArray(a.actions) ? a.actions.map(values) : [];
   if (!s.triggers().some(t => t.type === trigger.type)) throw Error(`Unknown trigger ${String(trigger.type)}; call list_interactions`);
   for (const x of actions) if (!s.actions().some(d => d.type === x.type)) throw Error(`Unknown action ${String(x.type)}; call list_interactions`);
   const resolve = (id: Json | undefined) => { const v = String(id ?? ''); return doc().entities.find(x => x.name === v)?.id ?? v; };
   const rule = {id: crypto.randomUUID(), trigger: {type: String(trigger.type), sourceId: resolve(trigger.sourceId), event: String(trigger.event ?? '')}, actions: actions.map(x => ({id: crypto.randomUUID(), type: String(x.type), targetId: resolve(x.targetId), value: x.value !== false, ...(Number.isFinite(x.amount) ? {amount: Number(x.amount)} : {}), ...(x.to !== undefined ? {to: GlobalValueSchema.parse(x.to)} : {})}))};
   s.scene.document.transact('Add rule', draft => {
    const target = draft.entities.find(x => x.id === e.id)!;
    let c = target.components.find(x => x.type === 'interactions.bindings');
    if (!c) { c = {id: crypto.randomUUID(), type: 'interactions.bindings', version: 1, data: {rules: []}}; target.components.push(c); }
    const data = BindingsSchema.parse(c.data); data.rules.push(rule); c.data = BindingsSchema.parse(data) as never;
   });
   return {ruleId: rule.id};
  },
  set_global: a => {
   const name = String(a.name), type = a.type === 'boolean' || a.type === 'string' || a.type === 'list' || a.type === 'object' ? a.type : 'number', initial = a.initial === undefined ? defaultValue(type) : GlobalValueSchema.parse(type === 'number' ? Number(a.initial) : a.initial);
   if (typeOfGlobal(initial) !== type) throw Error(`The initial value of a ${type} global must be a ${type}`);
   s.project.document.transact('Set global', p => { const g = GlobalsSchema.parse(p.extensions[globalsSection] ?? defaultGlobals), found = g.items.find(x => x.name === name); if (found) Object.assign(found, {type, initial}); else g.items.push({id: crypto.randomUUID(), name, type, initial}); p.extensions[globalsSection] = GlobalsSchema.parse(g) as never; });
   return {ok: true};
  },
  set_stage_size: a => { s.project.setStage({width: Number(a.width), height: Number(a.height)}); return stageSize(s.project.document.current); },
  rename_project: a => { s.project.renameProject(String(a.name)); return {ok: true}; },
  generate_asset: async (a,context) => ({assetId: await s.generate(a.kind === 'audio' ? 'audio' : 'image', String(a.prompt ?? ''), {seconds: Number.isFinite(a.seconds) ? Number(a.seconds) : undefined, width: Number.isFinite(a.width) ? Number(a.width) : undefined, height: Number.isFinite(a.height) ? Number(a.height) : undefined, ...(typeof a.skill === 'string' && a.skill.trim() ? {skill: a.skill} : {})},context)}),
  list_strings: () => { const table = LocalizationSchema.parse(s.project.document.current.extensions[localizationSection] ?? defaultLocalization); return {...table, entries: table.entries.slice(0, 300), more: Math.max(0, table.entries.length - 300)}; },
  set_strings: a => {
   if (!Array.isArray(a.strings) || !a.strings.length) throw Error('strings must be a non-empty array');
   let written = 0;
   s.project.document.transact('Assistant: set strings', p => {
    const table = structuredClone(LocalizationSchema.parse(p.extensions[localizationSection] ?? defaultLocalization));
    for (const item of a.strings as {key?: unknown; values?: unknown; note?: unknown}[]) {
     const key = String(item?.key ?? ''), values = item?.values && typeof item.values === 'object' ? item.values as Record<string, unknown> : {};
     let entry = table.entries.find(e => e.key === key);
     if (!entry) { entry = {key, values: {}}; table.entries.push(entry); }
     for (const [lng, text] of Object.entries(values)) {
      if (typeof text !== 'string') continue;
      if (!table.languages.some(l => l.id === lng)) table.languages.push({id: lng, name: languageName(lng)});
      entry.values[lng] = text; entry.review = [...new Set([...entry.review ?? [], lng])]; written++;
     }
     if (typeof item?.note === 'string' && item.note.trim()) entry.note = item.note.trim().slice(0, 500);
    }
    p.extensions[localizationSection] = LocalizationSchema.parse(table) as never;
   });
   return {written};
  },
  use_skill: a => ({instructions: s.useSkill(String(a.name ?? ''))}),
  preview: async a => { await s.preview(a.action === 'stop' ? 'stop' : 'play'); return {ok: true}; },
 };
 return {specs: editorToolSpecs, execute(name, args,context?:AutomationContext) {
  if (s.busy() && !['get_editor_state', 'describe_component', 'list_interactions', 'preview', 'use_skill', 'list_strings'].includes(name)) throw Error('The editor is busy (Preview or a file operation); stop the preview first');
  const handler = run[name];
  if (!handler) throw Error(`Unknown tool ${name}`);
  return handler(args,context);
 }};
}
export type {Entity};
