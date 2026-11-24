import {spatialType,spatialComponent,spatialDefinition,spatialParents,spatialBoundaryId,validateSpatial,is2DEntity,space2d} from './spatial';
export * from './spatial';
import {registerSceneAutomation} from './automation';
import { z } from 'zod';
import { DocumentSession, type DocumentPort } from '@rewrite/documents';
import { components, commands, token, type ComponentDefinition, type EditorModule, type Json, type ModuleContext } from '@rewrite/sdk';

const ComponentSchema = z.object({ id: z.string().min(1), type: z.string().min(1), version: z.number().int().positive(), data: z.json() }).strict();
const EntitySchema = z.object({ id: z.string().min(1), name: z.string().trim().min(1).max(100), parentId: z.string().nullable(), active: z.boolean(), spatial:z.string().min(1).optional(), components: z.array(ComponentSchema) }).strict();
export const SceneSchema = z.object({ formatVersion: z.literal(1), id: z.string().min(1), name: z.string().min(1).max(100), entities: z.array(EntitySchema).max(10000) }).strict();
export type Scene = z.infer<typeof SceneSchema>;
export type Entity = Scene['entities'][number];
/** Negative scale mirrors (flip); zero would collapse the object. */
const scaleValue = z.number().finite().min(-100).max(100).refine(v => v !== 0, 'Scale cannot be 0');
/** Shear in degrees, Pixi's model: skewX tilts the y axis, skewY the x axis. */
const skewValue = z.number().finite().min(-89).max(89);
const pivotValue = z.number().finite().min(-100000).max(100000);
export const TransformSchema = z.object({ x: z.number().finite(), y: z.number().finite(), rotation: z.number().finite(), scaleX: scaleValue, scaleY: scaleValue, skewX: skewValue.optional(), skewY: skewValue.optional(),
 /** The object's own point (local pixels) that sits at x/y and that it rotates, scales and skews around; 0,0 when absent. */
 pivotX: pivotValue.optional(), pivotY: pivotValue.optional() }).strict();
/** Editor colour labels for Layers rows (an editor-only component: saved, copied with the object, stripped from exports). */
export const labelColors = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray'] as const;
export type LabelColor = typeof labelColors[number];
export const labelType = 'editor.label';
export const LabelSchema = z.object({color: z.enum(labelColors)}).strict();
export const labelDefinition: ComponentDefinition = {type: labelType, version: 1, titleKey: 'component.label', editorOnly: true, hiddenInInspector: true, addable: false, defaults: () => ({color: 'blue'}), get dataSchema(){return z.toJSONSchema(LabelSchema,{unrepresentable:'any'});},parse: v => LabelSchema.parse(v), fields: []};
export const transformDefinition: ComponentDefinition = {
 type: 'scene.transform2d', version: 1, spatial:{space:space2d,reparent:reparent2D,resetPosition:data=>({...TransformSchema.parse(data),x:0,y:0})}, titleKey: 'component.transform', defaults: () => ({ x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }), parse: v => TransformSchema.parse(v),
 fields: ['x','y','rotation','scaleX','scaleY','skewX','skewY','pivotX','pivotY'].map(key => ({ key, titleKey: `field.${key}`, kind: 'number' })),
};
export function transform(entity: Entity) { if(!is2DEntity(entity))throw Error(`${entity.name}: this operation needs Transform2D`);return TransformSchema.parse(entity.components.find(c => c.type === transformDefinition.type)?.data); }
export function parseScene(input: unknown, definitions: ReadonlyMap<string, ComponentDefinition>,options:{allowDetachedSpatialRoots?:boolean}={}): Scene {
 const scene = SceneSchema.parse(input), ids = new Set<string>(), componentIds = new Set<string>(), unique = new Set<string>();
 for (const entity of scene.entities) {
  if (ids.has(entity.id)) throw Error('Duplicate entity ID'); ids.add(entity.id);
  const types = new Set<string>(),groups=new Set<string>();
  for (const component of entity.components) {
   if (componentIds.has(component.id) || types.has(component.type)) throw Error('Duplicate component');
   componentIds.add(component.id); types.add(component.type);
   const def = definitions.get(component.type);
   if (def?.uniqueInScene) { if (unique.has(component.type)) throw Error(`A scene can have only one ${def.uniqueInScene}`); unique.add(component.type); }
   if (def && component.version === def.version) {def.parse(component.data);if(def.exclusiveGroup){if(groups.has(def.exclusiveGroup))throw Error(`Only one component in exclusive group ${def.exclusiveGroup} per entity`);groups.add(def.exclusiveGroup);}}
  }
  if (!types.has(spatialType(entity))) throw Error('Entity needs its spatial transform (Transform2D by default)');
 }
 const byId = new Map(scene.entities.map(e => [e.id, e]));
 for (const entity of scene.entities) {
  const visited = new Set<string>([entity.id]); let parentId = entity.parentId;
  while (parentId) {
   if (visited.has(parentId)) throw Error('Hierarchy cycle'); if(visited.size>=128)throw Error('Hierarchy exceeds 128 levels'); visited.add(parentId);
   const parent = byId.get(parentId); if (!parent) throw Error('Missing parent'); parentId = parent.parentId;
  }
 }
 validateSpatial(scene,definitions,options.allowDetachedSpatialRoots);
 return scene;
}
export function makeEntity(name: string, x = 480, y = 270): Entity {
 return { id: crypto.randomUUID(), name, parentId: null, active: true, components: [{ id: crypto.randomUUID(), type: transformDefinition.type, version: 1, data: { x, y, rotation: 0, scaleX: 1, scaleY: 1 } }] };
}
export function blankScene(): Scene { return { formatVersion: 1, id: crypto.randomUUID(), name: 'Untitled scene', entities: [] }; }
export class SceneService {
 readonly document: DocumentPort<Scene>;
 constructor(readonly definitions: () => ReadonlyMap<string, ComponentDefinition>, document?:DocumentPort<Scene>) { this.document = document ?? new DocumentSession(blankScene(), v => parseScene(v, definitions())); }
 create(name = 'Entity'): string {
  const entity = makeEntity(name); this.document.transact('Create entity', d => { d.entities.push(entity); }); return entity.id;
 }
 createSpatial(name:string,type:string,parentId:string|null,data?:Json):string{
  const def=this.definitions().get(type);if(!def?.spatial)throw Error('Spatial provider unavailable');
  const entity:Entity={id:crypto.randomUUID(),name,parentId,active:true,...(type===transformDefinition.type?{}:{spatial:type}),components:[{id:crypto.randomUUID(),type,version:def.version,data:def.parse(data??def.defaults()) as Json}]};
  this.document.transact('Create spatial entity',d=>{d.entities.push(entity);});return entity.id;
 }
 setSpatial(id:string,data:Json,expected?:Json,expectedParentId?:string|null):void{
  this.document.transact('Transform entity',draft=>{const e=draft.entities.find(e=>e.id===id);if(!e)throw Error('Entity missing');spatialDefinition(e,this.definitions());const c=spatialComponent(e),def=this.definitions().get(c.type)!;if(expectedParentId!==undefined&&e.parentId!==expectedParentId)throw Error('Parent changed during manipulation');if(expected&&JSON.stringify(def.parse(c.data))!==JSON.stringify(def.parse(expected)))throw Error('Spatial transform changed during manipulation');const next=def.parse(data) as Json;if(JSON.stringify(def.parse(c.data))!==JSON.stringify(next))c.data=next;});
 }
 setField(id: string, type: string, key: string, value: Json): void {
  const def = this.definitions().get(type);
  if (!def || !def.fields.some(field => field.key === key)) throw Error('Unknown or read-only component field');
  this.document.transact('Edit property', draft => {
   const c = draft.entities.find(e => e.id === id)?.components.find(c => c.type === type);
   if (!c || c.version !== def.version || !c.data || typeof c.data !== 'object' || Array.isArray(c.data)) throw Error('Component unavailable or newer version');
   const parsed=def.parse(c.data);if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed)&&parsed[key]===value)return;
   c.data[key] = value;
  });
 }
 setTransform(id:string,value:z.infer<typeof TransformSchema>,expected?:z.infer<typeof TransformSchema>):void {
  const next=TransformSchema.parse(value);
  this.document.transact('Transform entity',draft=>{
   const component=draft.entities.find(e=>e.id===id)?.components.find(c=>c.type===transformDefinition.type);
   if(!component||component.version!==1)throw Error('Transform is unavailable');
   if(expected&&JSON.stringify(TransformSchema.parse(component.data))!==JSON.stringify(TransformSchema.parse(expected)))throw Error('Transform changed during manipulation');
   if(JSON.stringify(TransformSchema.parse(component.data))!==JSON.stringify(next))component.data=next;
  });
 }
 addComponent(id: string, type: string): void {
  const def = this.definitions().get(type); if (!def) throw Error('Unknown component');
  this.document.transact('Add component', d => { const e = d.entities.find(e => e.id === id); if (!e) throw Error('Entity missing'); e.components.push({ id: crypto.randomUUID(), type, version: def.version, data: def.defaults() }); });
 }
 removeComponent(id: string, type: string): void {
  if (this.document.current.entities.some(e=>e.id===id&&spatialType(e)===type)) throw Error('Spatial transform is required');
  this.document.transact('Remove component', d => { const e = d.entities.find(e => e.id === id); if (e) e.components = e.components.filter(c => c.type !== type); });
 }
 remove(id: string): void {
  this.document.transact('Delete entity', d => {
   const removed = new Set([id]); let count: number;
   do { count = removed.size; for (const e of d.entities) if (e.parentId && removed.has(e.parentId)) removed.add(e.id); } while (removed.size !== count);
   d.entities = d.entities.filter(e => !removed.has(e.id));
  });
 }
 duplicate(id: string): string { return this.duplicateMany([id])[0]; }
 /** Duplicates each selected subtree once (descendants of selected ancestors are not doubled); one undo step. */
 duplicateMany(ids: readonly string[]): string[] {
  const scene = this.document.current, roots = subtreeRoots(scene, ids);
  if (!roots.length) throw Error('Entity missing');
  const {copies, entityIds} = cloneEntities(scene.entities.filter(e => subtreeIds(scene, roots).has(e.id)), this.definitions());
  for (const e of copies) if (roots.some(r => entityIds.get(r) === e.id)) e.name = (e.name + ' copy').slice(0, 100);
  this.document.transact(roots.length > 1 ? 'Duplicate entities' : 'Duplicate entity', d => { d.entities.push(...copies); });
  return roots.map(r => entityIds.get(r)!);
 }
 removeMany(ids: readonly string[]): void {
  const scene = this.document.current, removed = subtreeIds(scene, subtreeRoots(scene, ids));
  if (!removed.size) return;
  this.document.transact(removed.size > 1 ? 'Delete entities' : 'Delete entity', d => { d.entities = d.entities.filter(e => !removed.has(e.id)); });
 }
 setTransforms(changes: readonly {id: string; value: z.infer<typeof TransformSchema>; expected?: z.infer<typeof TransformSchema>}[]): void {
  const next = changes.map(c => ({...c, value: TransformSchema.parse(c.value)}));
  this.document.transact(next.length > 1 ? 'Transform entities' : 'Transform entity', draft => {
   for (const change of next) {
    const component = draft.entities.find(e => e.id === change.id)?.components.find(c => c.type === transformDefinition.type);
    if (!component || component.version !== 1) throw Error('Transform is unavailable');
    const current = TransformSchema.parse(component.data);
    if (change.expected && JSON.stringify(current) !== JSON.stringify(TransformSchema.parse(change.expected))) throw Error('Transform changed during manipulation');
    if (JSON.stringify(current) !== JSON.stringify(change.value)) component.data = change.value;
   }
  });
 }
 /** Changes a number field of several objects from each one's own value (`+10`, `*2` on a mixed selection); one undo step. */
 adjustFieldMany(ids: readonly string[], type: string, key: string, change: (current: number) => number): void {
  const def = this.definitions().get(type);
  if (!def || !def.fields.some(field => field.key === key && field.kind === 'number')) throw Error('Unknown or non-number field');
  this.document.transact('Edit property', draft => {
   for (const id of ids) {
    const c = draft.entities.find(e => e.id === id)?.components.find(c => c.type === type);
    if (!c || c.version !== def.version || !c.data || typeof c.data !== 'object' || Array.isArray(c.data)) throw Error('Component unavailable or newer version');
    const parsed = def.parse(c.data) as Record<string, unknown>, current = typeof parsed[key] === 'number' ? parsed[key] as number : 0;
    c.data[key] = change(current);
   }
  });
 }
 setFieldMany(ids: readonly string[], type: string, key: string, value: Json): void {
  const def = this.definitions().get(type);
  if (!def || !def.fields.some(field => field.key === key)) throw Error('Unknown or read-only component field');
  this.document.transact('Edit property', draft => {
   for (const id of ids) {
    const c = draft.entities.find(e => e.id === id)?.components.find(c => c.type === type);
    if (!c || c.version !== def.version || !c.data || typeof c.data !== 'object' || Array.isArray(c.data)) throw Error('Component unavailable or newer version');
    c.data[key] = value;
   }
  });
 }
 setActiveMany(ids: readonly string[], active: boolean): void {
  const set = new Set(ids);
  this.document.transact('Toggle active', d => { for (const e of d.entities) if (set.has(e.id)) e.active = active; });
 }
 /**
  * Mirrors each subtree root across a vertical (`x`: flip horizontally) or horizontal (`y`) line through `center`
  * (scene space), as seen on screen whatever its rotation or parents; one undo step. Of the two equivalent poses the one
  * closest to the old rotation wins, so an upright object flipped horizontally gets scaleX −1 rather than a 180° turn.
  */
 flip(ids: readonly string[], axis: 'x' | 'y', center: {x: number; y: number}): void {
  const scene = this.document.current, mirror: Matrix = axis === 'x' ? [-1, 0, 0, 1, 2 * center.x, 0] : [1, 0, 0, -1, 0, 2 * center.y];
  const round = (v: number) => Math.round(v * 1e6) / 1e6 || 0, turn = (a: number, b: number) => Math.abs(((a - b) % 360 + 540) % 360 - 180);
  const changes = subtreeRoots(scene, ids).flatMap(id => {
   const entity = scene.entities.find(e => e.id === id); if (!entity) return [];
   const start = transform(entity), p = worldMatrix(scene, entity.parentId), det = p[0] * p[3] - p[1] * p[2];
   if (Math.abs(det) < 1e-10) throw Error('Parent transform cannot be inverted');
   const inverse: Matrix = [p[3] / det, -p[1] / det, -p[2] / det, p[0] / det, (p[2] * p[5] - p[3] * p[4]) / det, (p[1] * p[4] - p[0] * p[5]) / det];
   const local = multiply(inverse, multiply(mirror, worldMatrix(scene, id))), a = withPivot(decomposeMatrix(local), start), b = withPivot(decomposeMatrix(local, true), start);
   const pose = turn(a.rotation, start.rotation) <= turn(b.rotation, start.rotation) + 1e-9 ? a : b;
   if (Math.abs(pose.skewX ?? 0) > 89) throw Error('Flipping would need more than 89° of skew');
   const value = {x: round(pose.x), y: round(pose.y), rotation: round(pose.rotation), scaleX: round(pose.scaleX), scaleY: round(pose.scaleY), ...(pose.skewX ? {skewX: round(pose.skewX)} : {}), ...(start.pivotX !== undefined ? {pivotX: start.pivotX} : {}), ...(start.pivotY !== undefined ? {pivotY: start.pivotY} : {})};
   return [{id, value, expected: start}];
  });
  if (changes.length) this.setTransforms(changes);
 }
 /** Moves each subtree root by a world-space (scene) delta, converted into its own parent space. */
 translateWorld(deltas: ReadonlyMap<string, {x: number; y: number}>): void {
  const scene = this.document.current, changes = subtreeRoots(scene, [...deltas.keys()]).flatMap(id => {
   const delta = deltas.get(id)!, entity = scene.entities.find(e => e.id === id)!, start = transform(entity), local = worldToLocalVector(scene, entity.parentId, delta);
   // Rounded to 1e-6 so screen-derived deltas do not leave float noise (199.99999999999997) in the document.
   const x = Math.round((start.x + local.x) * 1e6) / 1e6, y = Math.round((start.y + local.y) * 1e6) / 1e6;
   return x !== start.x || y !== start.y ? [{id, value: {...start, x, y}, expected: start}] : [];
  });
  if (changes.length) this.setTransforms(changes);
 }
 /** Drag/drop placement: reparent subtree roots (world pose preserved) and insert them before `beforeId` among the new siblings. */
 place(ids: readonly string[], parentId: string | null, beforeId: string | null): void {
  let next = this.document.current;
  const roots = subtreeRoots(next, ids);
  if (!roots.length) return;
  const moving = subtreeIds(next, roots);
  if (parentId && moving.has(parentId)) throw Error('Hierarchy cycle');
  if (beforeId && moving.has(beforeId)) beforeId = null;
  for (const id of roots) if (next.entities.find(e => e.id === id)!.parentId !== parentId) next = reparentPreservingWorld(next, id, parentId, this.definitions());
  const moved = roots.map(id => next.entities.find(e => e.id === id)!), rest = next.entities.filter(e => !roots.includes(e.id));
  let index = beforeId ? rest.findIndex(e => e.id === beforeId) : -1;
  if (index < 0) { const lastSibling = rest.map(e => e.parentId).lastIndexOf(parentId); index = lastSibling < 0 ? rest.length : lastSibling + 1; }
  const entities = [...rest.slice(0, index), ...moved, ...rest.slice(index)];
  if (entities.every((e, i) => e === this.document.current.entities[i])) return;
  this.document.transact(roots.length > 1 ? 'Move entities' : 'Move entity', d => { d.entities = entities; });
 }
 /** Clipboard roots use their space origin (scene root in 2D, view boundary in 3D), preserving world pose on paste. */
 copy(ids: readonly string[]): EntityClipboard {
  let scene = this.document.current;
  const roots = subtreeRoots(scene, ids);
  if (!roots.length) throw Error('Nothing to copy');
  for (const id of roots) {
   const entity=scene.entities.find(e=>e.id===id)!;if(!entity.parentId)continue;
   if(is2DEntity(entity))scene=reparentPreservingWorld(scene,id,null,this.definitions());
   else{const spatial=spatialDefinition(entity,this.definitions()),next=structuredClone(scene),root=next.entities.find(e=>e.id===id)!;spatialComponent(root).data=spatial.reparent(spatialComponent(root).data,spatialParents(scene,entity.parentId,spatial.space,this.definitions()),[]);root.parentId=null;scene=next;}
  }
  const members = subtreeIds(scene, roots);
  return {kind: 'pixi-editor/entities', version: 1, sourceSceneId: scene.id, roots, entities: structuredClone(scene.entities.filter(e => members.has(e.id)))};
 }
 /** Pastes with new IDs under an explicit compatible parent, preserving space-local world poses and external references. */
 paste(clip: unknown,parentId:string|null=null): {ids: string[]; unresolved: number} {
  const payload = EntityClipboardSchema.parse(clip);
  parseScene({formatVersion:1,id:'clipboard',name:'Clipboard',entities:payload.entities},this.definitions(),{allowDetachedSpatialRoots:true});
  const {copies, entityIds, external} = cloneEntities(payload.entities, this.definitions());
  for(const id of payload.roots){const root=copies.find(e=>e.id===entityIds.get(id))!;if(parentId!==null){const spatial=spatialDefinition(root,this.definitions());spatialComponent(root).data=spatial.reparent(spatialComponent(root).data,[],spatialParents(this.document.current,parentId,spatial.space,this.definitions()));}root.parentId=parentId;}
  const here = new Set(this.document.current.entities.flatMap(e => [e.id, ...e.components.map(c => c.id)]));
  const unresolved = [...external].filter(id => !here.has(id)).length;
  this.document.transact(payload.roots.length > 1 ? 'Paste entities' : 'Paste entity', d => { d.entities.push(...copies); });
  return {ids: payload.roots.map(r => entityIds.get(r)!), unresolved};
 }
 /**
  * Wraps the selection's subtree roots in a new plain object at the centre of their origins, under their shared parent
  * (or the scene root when they have different parents), keeping every world pose and the draw order; one undo step.
  */
 group(ids: readonly string[], name = 'Group'): string {
  let next = this.document.current;
  const roots = subtreeRoots(next, ids).filter(id => next.entities.some(e => e.id === id));
  if (!roots.length) throw Error('Nothing to group');
  const parents = new Set(roots.map(id => next.entities.find(e => e.id === id)!.parentId)), parentId = parents.size === 1 ? [...parents][0] : null;
  const origins = roots.map(id => worldMatrix(next, id)), cx = origins.reduce((n, m) => n + m[4], 0) / origins.length, cy = origins.reduce((n, m) => n + m[5], 0) / origins.length;
  const p = worldMatrix(next, parentId), det = p[0] * p[3] - p[1] * p[2];
  if (Math.abs(det) < 1e-10) throw Error('Parent transform cannot be inverted');
  const dx = cx - p[4], dy = cy - p[5], round = (v: number) => Math.round(v * 1e6) / 1e6 || 0;
  const group = makeEntity(name); group.parentId = parentId;
  group.components[0].data = {x: round((p[3] * dx - p[2] * dy) / det), y: round((-p[1] * dx + p[0] * dy) / det), rotation: 0, scaleX: 1, scaleY: 1};
  const at = Math.min(...roots.map(id => next.entities.findIndex(e => e.id === id)));
  next = {...next, entities: [...next.entities.slice(0, at), group, ...next.entities.slice(at)]};
  for (const id of roots) next = reparentPreservingWorld(next, id, group.id, this.definitions());
  this.document.transact(roots.length > 1 ? 'Group objects' : 'Group object', d => { d.entities = next.entities; });
  return group.id;
 }
 /** Dissolves plain groups (objects with only a transform): their children move to the group's parent at its place, world poses kept. */
 ungroup(ids: readonly string[]): string[] {
  let next = this.document.current;
  const groups = ids.map(id => next.entities.find(e => e.id === id)).filter((e): e is Entity => Boolean(e));
  if (!groups.length || groups.some(g => g.components.some(c => c.type !== transformDefinition.type))) throw Error('Only plain groups (objects with nothing but a transform) can be ungrouped');
  const released: string[] = [];
  for (const g of groups) {
   const children = next.entities.filter(e => e.parentId === g.id).map(e => e.id);
   for (const id of children) next = reparentPreservingWorld(next, id, g.parentId, this.definitions());
   const moving = next.entities.filter(e => children.includes(e.id)), rest = next.entities.filter(e => !children.includes(e.id) && e.id !== g.id), at = next.entities.filter(e => !children.includes(e.id)).findIndex(e => e.id === g.id);
   next = {...next, entities: [...rest.slice(0, at), ...moving, ...rest.slice(at)]};
   released.push(...children);
  }
  this.document.transact(groups.length > 1 ? 'Ungroup objects' : 'Ungroup object', d => { d.entities = next.entities; });
  return released;
 }
 /** Batch rename in Layers order: `{n}` is the running number from `start` (`{nn}`, `{nnn}` zero-padded), `{name}` the old name. */
 renameMany(ids: readonly string[], pattern: string, start = 1): void {
  if (!pattern.trim()) throw Error('Name pattern is empty');
  const chosen = new Set(ids), order = this.document.current.entities.filter(e => chosen.has(e.id)).map(e => e.id);
  const names = new Map(order.map((id, i) => { const old = this.document.current.entities.find(e => e.id === id)!.name; return [id, pattern.replace(/\{(n+)\}/g, (_, n: string) => String(start + i).padStart(n.length, '0')).replace(/\{name\}/g, old).slice(0, 200)]; }));
  this.document.transact(order.length > 1 ? 'Rename objects' : 'Rename object', d => { for (const e of d.entities) { const name = names.get(e.id); if (name !== undefined) e.name = name; } });
 }
 /** Editor colour label of objects (Layers rows); `null` removes it. Saved with the project, never exported. */
 setLabel(ids: readonly string[], color: LabelColor | null): void {
  const chosen = new Set(ids);
  this.document.transact(color ? 'Set colour label' : 'Clear colour label', d => {
   for (const e of d.entities) {
    if (!chosen.has(e.id)) continue;
    const c = e.components.find(c => c.type === labelType);
    if (!color) e.components = e.components.filter(x => x.type !== labelType);
    else if (c) c.data = {color}; else e.components.push({id: crypto.randomUUID(), type: labelType, version: 1, data: {color}});
   }
  });
 }
 /** Moves a component up or down in its object's list (Properties order; draw order of visuals on that object). */
 moveComponent(id: string, componentId: string, direction: -1 | 1): void {
  const e = this.document.current.entities.find(e => e.id === id); if (!e) throw Error('Entity missing');
  const from = e.components.findIndex(c => c.id === componentId), to = from + direction;
  if (from < 0 || to < 0 || to >= e.components.length) return;
  if (e.components[from].type === spatialType(e) || e.components[to].type === spatialType(e)) return;
  this.document.transact('Move component', d => { const x = d.entities.find(x => x.id === id)!; [x.components[from], x.components[to]] = [x.components[to], x.components[from]]; });
 }
 /** Pastes a copied component: replaces the values of the same component on the object, or adds it. */
 pasteComponent(id: string, copied: {type: string; version: number; data: Json}): 'replaced' | 'added' {
  const def = this.definitions().get(copied.type);
  if (!def || def.version !== copied.version) throw Error('This component cannot be pasted here');
  const e = this.document.current.entities.find(e => e.id === id);if(!e)throw Error('Entity missing');
  if(def.addable===false&&copied.type!==spatialType(e))throw Error('This component cannot be pasted');
  const data = def.parse(structuredClone(copied.data)) as Json;
  const existing = e.components.some(c => c.type === copied.type);
  if (!existing && def.uniqueInScene && this.document.current.entities.some(x => x.components.some(c => c.type === copied.type))) throw Error(`Only one ${def.uniqueInScene} per scene`);
  this.document.transact(existing ? 'Paste component values' : 'Paste component', d => {
   const x = d.entities.find(x => x.id === id)!, c = x.components.find(c => c.type === copied.type);
   if (c) c.data = data; else x.components.push({id: crypto.randomUUID(), type: copied.type, version: copied.version, data});
  });
  return existing ? 'replaced' : 'added';
 }
 rename(id: string, name: string): void { this.document.transact('Rename entity', d => { const e = d.entities.find(e => e.id === id); if (e) e.name = name; }); }
 setActive(id: string, active: boolean): void { this.document.transact('Toggle active', d => { const e = d.entities.find(e => e.id === id); if (e) e.active = active; }); }
 moveSibling(id:string,direction:-1|1):void{
  if(direction!==-1&&direction!==1)throw Error('Invalid sibling direction');
  const entities=this.document.current.entities,entity=entities.find(e=>e.id===id);if(!entity)throw Error('Entity missing');
  const siblings=entities.filter(e=>e.parentId===entity.parentId),index=siblings.findIndex(e=>e.id===id),neighbor=siblings[index+direction];if(!neighbor)return;
  const from=entities.indexOf(entity),to=entities.indexOf(neighbor);
  this.document.transact('Move sibling',d=>{[d.entities[from],d.entities[to]]=[d.entities[to],d.entities[from]];});
 }
 reparent(id: string, parentId: string|null): void {
  const next=reparentPreservingWorld(this.document.current,id,parentId,this.definitions());
  this.document.transact('Reparent entity',d=>{d.entities=next.entities;});
 }
 get diagnostics(): string[] {
  return this.document.current.entities.flatMap(e => e.components.filter(c => !this.definitions().has(c.type) || this.definitions().get(c.type)!.version !== c.version).map(c => `${e.name}: unsupported ${c.type} v${c.version}`));
 }
}
export const EntityClipboardSchema = z.object({kind: z.literal('pixi-editor/entities'), version: z.literal(1), sourceSceneId: z.string(), roots: z.array(z.string()).min(1), entities: z.array(EntitySchema).min(1).max(10000)}).strict().superRefine((clip, ctx) => {
 const ids = new Set(clip.entities.map(e => e.id));
 if (ids.size !== clip.entities.length) ctx.addIssue({code: 'custom', message: 'Duplicate entity ID'});
 for (const e of clip.entities) {
  if (clip.roots.includes(e.id) ? e.parentId !== null : !e.parentId || !ids.has(e.parentId)) ctx.addIssue({code: 'custom', message: 'Clipboard hierarchy is not self-contained'});
 }
 if (!clip.roots.every(id => ids.has(id))) ctx.addIssue({code: 'custom', message: 'Clipboard root missing'});
});
export type EntityClipboard = z.infer<typeof EntityClipboardSchema>;
/** Selected IDs whose ancestors are not also selected, in document order. */
export function subtreeRoots(scene: Scene, ids: Iterable<string>): string[] {
 const set = new Set(ids), byId = new Map(scene.entities.map(e => [e.id, e]));
 return scene.entities.filter(e => {
  if (!set.has(e.id)) return false;
  for (let p = e.parentId; p; p = byId.get(p)?.parentId ?? null) if (set.has(p)) return false;
  return true;
 }).map(e => e.id);
}
export function subtreeIds(scene: Scene, roots: readonly string[]): Set<string> {
 const all = new Set(roots); let count: number;
 do { count = all.size; for (const e of scene.entities) if (e.parentId && all.has(e.parentId)) all.add(e.id); } while (all.size !== count);
 return all;
}
/** Records reference lookups that miss, so the component's own remap decides what counts as a reference. */
class ReferenceMap extends Map<string, string> {
 constructor(entries: Iterable<readonly [string, string]>, private readonly missed: Set<string>) { super(entries); }
 override get(key: string) { if (key && !super.has(key)) this.missed.add(key); return super.get(key); }
 override has(key: string) { const found = super.has(key); if (key && !found) this.missed.add(key); return found; }
}
function cloneEntities(source: readonly Entity[], definitions: ReadonlyMap<string, ComponentDefinition>) {
 const copies = structuredClone(source) as Entity[], external = new Set<string>();
 const entityIds = new Map(copies.map(e => [e.id, crypto.randomUUID()]));
 const componentIds = new Map(copies.flatMap(e => e.components.map(c => [c.id, crypto.randomUUID()] as const)));
 const preserveLocalIds = copies.some(e => e.components.some(c => definitions.get(c.type)?.preserveLocalIdsOnDuplicate));
 for (const e of copies) {
  e.id = entityIds.get(e.id)!;
  if (e.parentId && entityIds.has(e.parentId)) e.parentId = entityIds.get(e.parentId)!;
  for (const c of e.components) {
   c.id = componentIds.get(c.id)!;
   const definition = definitions.get(c.type);
   if (definition?.version === c.version && definition.remapReferences) c.data = definition.remapReferences(c.data, {entities: new ReferenceMap(entityIds, external), components: new ReferenceMap(componentIds, external), preserveLocalIds});
  }
 }
 return {copies, entityIds, external};
}
/** An object's origin in world pixels through its parents (rotation and scale included). */
export function worldPosition(entities: readonly Entity[], id: string): {x: number; y: number} | undefined {
 const byId = new Map(entities.map(e => [e.id, e])), chain: Entity[] = [];
 for (let e = byId.get(id); e && chain.length < 128; e = e.parentId ? byId.get(e.parentId) : undefined) chain.push(e);
 if (!chain.length || chain.some(e=>!is2DEntity(e))) return undefined;
 let p = {x: transform(chain[0]).pivotX ?? 0, y: transform(chain[0]).pivotY ?? 0};
 for (const e of chain) { const t = transform(e), a = t.rotation * Math.PI / 180, x = (p.x - (t.pivotX ?? 0)) * t.scaleX, y = (p.y - (t.pivotY ?? 0)) * t.scaleY; p = {x: t.x + x * Math.cos(a) - y * Math.sin(a), y: t.y + x * Math.sin(a) + y * Math.cos(a)}; }
 return p;
}
type JsonPath = (string | number)[];
/**
 * What an exported game needs to spawn objects without component definitions: reference paths per component ID
 * (scenes and the shipped prefabs) and the prefabs scripts name. The editor adds it at export.
 */
export const spawnSection = 'runtime.spawn';
export const SpawnDataSchema = z.object({version: z.literal(1), references: z.record(z.string(), z.array(z.array(z.union([z.string(), z.number()])))), prefabs: z.array(z.object({id: z.string().optional(), name: z.string(), rootId: z.string(), entities: SceneSchema.shape.entities}).strict()).max(1000)}).strict();
export type SpawnData = z.infer<typeof SpawnDataSchema>;
const referenceToken = '\u0000ref\u0000';
/** Answers every lookup with a marked value, so a definition's own remap shows where its references are. */
class ReferenceProbe extends Map<string, string> {
 override get(key: string) { return key ? referenceToken + key : undefined; }
 override has(key: string) { return Boolean(key); }
}
/**
 * Where a component's data holds object or component references (JSON key paths), found by running its definition's
 * `remapReferences` with marked IDs. No remap: no references. Used to copy objects while the game runs (spawn).
 */
export function referencePaths(data: Json, definition: ComponentDefinition | undefined): JsonPath[] {
 if (!definition?.remapReferences) return [];
 const marked = definition.remapReferences(structuredClone(data), {entities: new ReferenceProbe(), components: new ReferenceProbe(), scenes: new Map()}), paths: JsonPath[] = [];
 const walk = (value: unknown, path: JsonPath) => {
  if (typeof value === 'string') { if (value.startsWith(referenceToken)) paths.push(path); return; }
  if (Array.isArray(value)) value.forEach((v, i) => walk(v, [...path, i]));
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) walk(v, [...path, k]);
 };
 walk(marked, []);
 return paths;
}
/**
 * A fresh copy of an object and its descendants (parents first) for a running game: new object and component IDs,
 * references inside the copy (at `paths`) pointing to the copy, references outside it kept. The copy's root is a
 * top-level, active object, placed at `at` when given.
 */
/** Parents before their children (spawned objects attach to parents already in the world). */
export function parentsFirst<T extends {id:string;parentId?:string|null}>(entities:readonly T[]):T[]{const byId=new Map(entities.map(e=>[e.id,e])),done=new Set<string>(),out:T[]=[];const visit=(e:T,depth:number)=>{if(done.has(e.id)||depth>entities.length)return;const parent=e.parentId?byId.get(e.parentId):undefined;if(parent)visit(parent,depth+1);if(done.has(e.id))return;done.add(e.id);out.push(e);};for(const e of entities)visit(e,0);return out;}
export function spawnCopy(source: readonly Entity[], rootId: string, paths: (component: Entity['components'][number]) => readonly JsonPath[], at?: {x: number; y: number}, copied?: (original: Entity['components'][number], copy: Entity['components'][number]) => void): Entity[] {
 const root = source.find(e => e.id === rootId); if (!root) throw Error('Nothing to copy');if(at&&!is2DEntity(root))throw Error('2D spawn placement cannot target a non-2D entity');
 const order: Entity[] = [root];
 for (let i = 0; i < order.length; i++) for (const e of source) if (e.parentId === order[i].id) order.push(e);
 const entities = new Map(order.map(e => [e.id, crypto.randomUUID()])), components = new Map(order.flatMap(e => e.components.map(c => [c.id, crypto.randomUUID()] as const)));
 return order.map(e => {
  const copy = structuredClone(e) as Entity;
  copy.id = entities.get(e.id)!; copy.parentId = e.id === rootId ? null : entities.get(e.parentId!)!;
  if (e.id === rootId) copy.active = true;
  copy.components = copy.components.map((c, i) => {
   for (const path of paths(e.components[i])) {
    let parent: unknown = c.data; for (const key of path.slice(0, -1)) parent = (parent as Record<string | number, unknown> | null)?.[key];
    const last = path[path.length - 1], holder = parent as Record<string | number, unknown> | null;
    if (holder && typeof holder[last] === 'string') { const value = holder[last] as string; holder[last] = entities.get(value) ?? components.get(value) ?? value; }
   }
   const next = {...c, id: components.get(c.id)!}; copied?.(e.components[i], next); return next;
  });
  if (at && e.id === rootId) { const t = copy.components.find(c => c.type === transformDefinition.type); if (t) t.data = {...(t.data as Record<string, Json>), x: at.x, y: at.y}; }
  return copy;
 });
}
function worldToLocalVector(scene: Scene, parentId: string | null, delta: {x: number; y: number}) {
 const [a, b, c, d] = worldMatrix(scene, parentId), det = a * d - b * c;
 if (Math.abs(det) < 1e-10) throw Error('Parent transform cannot be inverted');
 return {x: (d * delta.x - c * delta.y) / det, y: (-b * delta.x + a * delta.y) / det};
}
export const sceneToken = token<SceneService>('scene', 'scene.document');
export function sceneModule(definitions: () => ReadonlyMap<string, ComponentDefinition>, backing?:{owner:string;get(context:ModuleContext):DocumentPort<Scene>}): EditorModule {
 return { manifest: { id: 'scene', version: '1.0.0', apiVersion: 1, requires:backing?{[backing.owner]:'^1'}:{} }, activate(c) {
  const scene = new SceneService(definitions,backing?.get(c)); c.provide(sceneToken, scene);registerSceneAutomation(c,scene);
  c.contribute(components, 'scene.transform2d', transformDefinition);c.contribute(components, 'scene.label', labelDefinition);
  c.contribute(commands, 'scene.create', { titleKey: 'command.create', execute: () => scene.create() });
  c.contribute(commands, 'scene.undo', { titleKey: 'command.undo', execute: () => scene.document.undo() });
  c.contribute(commands, 'scene.redo', { titleKey: 'command.redo', execute: () => scene.document.redo() });
 } };
}
type Matrix = [number,number,number,number,number,number];
const multiply = (a:Matrix,b:Matrix):Matrix => [a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];
function worldMatrix(scene:Scene,id:string|null):Matrix {
 if(!id)return [1,0,0,1,0,0];
 const e=scene.entities.find(e=>e.id===id);if(!e)throw Error('Parent missing');const t=transform(e),r=t.rotation*Math.PI/180,kx=(t.skewX??0)*Math.PI/180,ky=(t.skewY??0)*Math.PI/180;
 const a=Math.cos(r+ky)*t.scaleX,b=Math.sin(r+ky)*t.scaleX,c=-Math.sin(r-kx)*t.scaleY,d=Math.cos(r-kx)*t.scaleY,px=t.pivotX??0,py=t.pivotY??0;
 return multiply(worldMatrix(scene,e.parentId),[a,b,c,d,t.x-a*px-c*py,t.y-b*px-d*py]);
}
/**
 * A transform for a 2D matrix with skewY 0: rotation from the x axis, signed scales from the determinant, skewX for any
 * remaining shear. `flipX` keeps a mirrored object mirrored on x (otherwise the mirror shows as a 180° turn and flip on y).
 */
export function decomposeMatrix(m:Matrix,flipX=false){
 const sx=(flipX?-1:1)*Math.hypot(m[0],m[1]),det=m[0]*m[3]-m[1]*m[2],sy=Math.sign(det*sx)*Math.hypot(m[2],m[3]),deg=180/Math.PI;
 const rotation=Math.atan2(m[1]/sx,m[0]/sx)*deg,shear=((rotation-Math.atan2(-m[2]/sy,m[3]/sy)*deg+540)%360)-180,skewX=Math.abs(shear)<1e-9?0:shear;
 return{x:m[4],y:m[5],rotation,scaleX:sx,scaleY:sy,...(skewX?{skewX}:{})};
}
/** A decomposed pose (x/y = where the local origin lands) moved so x/y are where the object's pivot lands; the pivot is kept. */
function withPivot<T extends {x:number;y:number;rotation:number;scaleX:number;scaleY:number;skewX?:number}>(pose:T,t:{pivotX?:number;pivotY?:number}):T&{pivotX?:number;pivotY?:number}{
 const px=t.pivotX??0,py=t.pivotY??0;if(!px&&!py)return{...pose,...(t.pivotX!==undefined?{pivotX:t.pivotX}:{}),...(t.pivotY!==undefined?{pivotY:t.pivotY}:{})};
 const r=pose.rotation*Math.PI/180,kx=(pose.skewX??0)*Math.PI/180,a=Math.cos(r)*pose.scaleX,b=Math.sin(r)*pose.scaleX,c=-Math.sin(r-kx)*pose.scaleY,d=Math.cos(r-kx)*pose.scaleY;
 return{...pose,x:pose.x+a*px+c*py,y:pose.y+b*px+d*py,pivotX:px,pivotY:py};
}
/**
 * Moves an object's pivot (its own point it turns around) without moving it on screen: x/y follow so the visual stays
 * put; one undo step.
 */
export function pivotKeepingPlace(t:z.infer<typeof TransformSchema>,pivotX:number,pivotY:number){
 const r=t.rotation*Math.PI/180,kx=(t.skewX??0)*Math.PI/180,ky=(t.skewY??0)*Math.PI/180,a=Math.cos(r+ky)*t.scaleX,b=Math.sin(r+ky)*t.scaleX,c=-Math.sin(r-kx)*t.scaleY,d=Math.cos(r-kx)*t.scaleY,dx=pivotX-(t.pivotX??0),dy=pivotY-(t.pivotY??0),round=(v:number)=>Math.round(v*1e6)/1e6||0;
 return{...t,x:round(t.x+a*dx+c*dy),y:round(t.y+b*dx+d*dy),pivotX:round(pivotX),pivotY:round(pivotY)};
}
const builtinSpatialDefinitions=()=>new Map([[transformDefinition.type,transformDefinition]]);
export function reparentPreservingWorld(scene:Scene,id:string,parentId:string|null,definitions:ReadonlyMap<string,ComponentDefinition>=builtinSpatialDefinitions()):Scene {
 if(id===parentId)throw Error('Hierarchy cycle');
 const next=structuredClone(scene),entity=next.entities.find(e=>e.id===id);if(!entity)throw Error('Entity missing');
 let ancestor=parentId;const seen=new Set<string>();while(ancestor){if(ancestor===id||seen.has(ancestor))throw Error('Hierarchy cycle');seen.add(ancestor);const e=scene.entities.find(e=>e.id===ancestor);if(!e)throw Error('Parent missing');ancestor=e.parentId;}
 const spatial=spatialDefinition(entity,definitions),oldBoundary=spatialBoundaryId(scene,id,definitions),oldParents=spatialParents(scene,entity.parentId,spatial.space,definitions);
 entity.parentId=parentId;validateSpatial(next,definitions);
 if(oldBoundary!==spatialBoundaryId(next,id,definitions))throw Error('Moving between spatial views is not supported');
 spatialComponent(entity).data=spatial.reparent(spatialComponent(entity).data,oldParents,spatialParents(next,parentId,spatial.space,definitions));
 return next;
}
function reparent2D(data:Json,oldParents:readonly Json[],newParents:readonly Json[]):Json{
 const scene=(parents:readonly Json[],own?:Json):Scene=>({formatVersion:1,id:'pose',name:'Pose',entities:[...parents,...(own?[own]:[])].map((data,i)=>({id:String(i),name:'Pose',active:true,parentId:i?String(i-1):null,components:[{id:String(i),type:'scene.transform2d',version:1,data}]}))});
 const before=worldMatrix(scene(oldParents,data),String(oldParents.length)),parent=worldMatrix(scene(newParents),newParents.length?String(newParents.length-1):null),det=parent[0]*parent[3]-parent[1]*parent[2];
 if(Math.abs(det)<1e-10)throw Error('Parent transform cannot be inverted');
 const inverse:Matrix=[parent[3]/det,-parent[1]/det,-parent[2]/det,parent[0]/det,(parent[2]*parent[5]-parent[3]*parent[4])/det,(parent[1]*parent[4]-parent[0]*parent[5])/det];
 const own=TransformSchema.parse(data),local=withPivot(decomposeMatrix(multiply(inverse,before),own.scaleX<0),own);
 if(Math.abs(local.skewX??0)>89)throw Error('This parent would need more than 89° of skew');return local;
}
/** Migrations operate on a copy. A failing migration never changes the input. */
export function migrateScene(input: unknown, definitions: ReadonlyMap<string, ComponentDefinition>,options:{allowDetachedSpatialRoots?:boolean}={}): Scene {
 const candidate = SceneSchema.parse(structuredClone(input));
 for (const e of candidate.entities) for (const c of e.components) {
  const def=definitions.get(c.type);
  if(def&&c.version<def.version){if(!def.migrate)throw Error(`Migration unavailable: ${c.type} v${c.version}`);c.data=def.parse(def.migrate(c.data,c.version));c.version=def.version;}
 }
 return parseScene(candidate,definitions,options);
}
