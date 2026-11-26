import {z} from 'zod';
import type {Json} from './types.js';

const ComponentSchema = z.object({ id: z.string().min(1), type: z.string().min(1), version: z.number().int().positive(), data: z.json() }).strict();
export const EntitySchema = z.object({ id: z.string().min(1), name: z.string().trim().min(1).max(100), parentId: z.string().nullable(), active: z.boolean(), spatial:z.string().min(1).optional(), components: z.array(ComponentSchema) }).strict();
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
export const transform2dType='scene.transform2d',space2d='scene.2d';
/** Omitted in legacy 2D JSON. Explicit type preserves unsupported spatial data without inventing a 2D transform. */
export function spatialType(entity:Entity):string{return entity.spatial??transform2dType;}
export function is2DEntity(entity:Entity):boolean{return spatialType(entity)===transform2dType;}
export function spatialComponent(entity:Entity){const c=entity.components.find(c=>c.type===spatialType(entity));if(!c)throw Error(`${entity.name}: spatial component ${spatialType(entity)} missing`);return c;}
export function transform(entity: Entity) { if(!is2DEntity(entity))throw Error(`${entity.name}: this operation needs Transform2D`);return TransformSchema.parse(entity.components.find(c => c.type === transform2dType)?.data); }

/** An object's origin in world pixels through its parents (rotation and scale included). */
export function worldPosition(entities: readonly Entity[], id: string): {x: number; y: number} | undefined {
 const byId = new Map(entities.map(e => [e.id, e])), chain: Entity[] = [];
 for (let e = byId.get(id); e && chain.length < 128; e = e.parentId ? byId.get(e.parentId) : undefined) chain.push(e);
 if (!chain.length || chain.some(e=>!is2DEntity(e))) return undefined;
 let p = {x: transform(chain[0]).pivotX ?? 0, y: transform(chain[0]).pivotY ?? 0};
 for (const e of chain) { const t = transform(e), a = t.rotation * Math.PI / 180, x = (p.x - (t.pivotX ?? 0)) * t.scaleX, y = (p.y - (t.pivotY ?? 0)) * t.scaleY; p = {x: t.x + x * Math.cos(a) - y * Math.sin(a), y: t.y + x * Math.sin(a) + y * Math.cos(a)}; }
 return p;
}
export type JsonPath = (string | number)[];
/**
 * What an exported game needs to spawn objects without component definitions: reference paths per component ID
 * (scenes and the shipped prefabs) and the prefabs scripts name. The editor adds it at export.
 */
export const spawnSection = 'runtime.spawn';
export const SpawnDataSchema = z.object({version: z.literal(1), references: z.record(z.string(), z.array(z.array(z.union([z.string(), z.number()])))), prefabs: z.array(z.object({id: z.string().optional(), name: z.string(), rootId: z.string(), entities: SceneSchema.shape.entities}).strict()).max(1000)}).strict();
export type SpawnData = z.infer<typeof SpawnDataSchema>;

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
  if (at && e.id === rootId) { const t = copy.components.find(c => c.type === transform2dType); if (t) t.data = {...(t.data as Record<string, Json>), x: at.x, y: at.y}; }
  return copy;
 });
}
