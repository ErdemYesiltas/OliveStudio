import {z} from 'zod';
import type {Entity} from '@rewrite/scene';
/** Only explicitly declared, top-level JSON fields leave the server. Entity IDs remain stable across patches. */
const key=z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]{0,79}$/).refine(k=>!['constructor','prototype','__proto__'].includes(k));
export const networkEntityType='multiplayer.entity';
export const NetworkEntitySchema=z.object({
 authority:z.literal('server').default('server'),
 fields:z.array(z.object({component:key,keys:z.array(key).min(1).max(32)}).strict()).max(16).default([{component:'scene.transform2d',keys:['x','y','rotation']}]),
 events:z.array(z.string().regex(/^(?!xstate\.)[A-Za-z][A-Za-z0-9_.:-]{0,79}$/)).max(32).default([]),
 behavior:z.boolean().default(false),
}).strict();
export type ReplicatedEntity={id:string;active:boolean;fields:Record<string,Record<string,unknown>>;states?:string[]};
export function projectEntity(e:Entity,states?:string[]):ReplicatedEntity {
 const def=NetworkEntitySchema.parse(e.components.find(c=>c.type===networkEntityType)?.data);
 const fields:ReplicatedEntity['fields']={};
 for(const f of def.fields){const data=e.components.find(c=>c.type===f.component)?.data;if(data&&typeof data==='object'&&!Array.isArray(data))fields[f.component]=Object.fromEntries(f.keys.filter(k=>Object.hasOwn(data,k)).map(k=>[k,(data as Record<string,unknown>)[k]]));}
 return {id:e.id,active:e.active,fields,...(def.behavior?{states:states??[]}: {})};
}
/** Apply a server patch through the local entity's own whitelist, never arbitrary component data. */
export function applyEntity(e:Entity,patch:ReplicatedEntity){
 const def=NetworkEntitySchema.parse(e.components.find(c=>c.type===networkEntityType)?.data);
 if(patch.id!==e.id)return;
 e.active=Boolean(patch.active);
 for(const f of def.fields){const c=e.components.find(c=>c.type===f.component),values=patch.fields[f.component];if(!c||!c.data||typeof c.data!=='object'||Array.isArray(c.data)||!values)continue;for(const key of f.keys)if(Object.hasOwn(values,key))(c.data as Record<string,unknown>)[key]=values[key];}
}

/** Server-owned logic/physics must not also run in a client prediction world. Presentation remains local. */
export function clientEntity(e:Entity):Entity{return e.components.some(c=>c.type===networkEntityType)?{...e,components:e.components.filter(c=>!c.type.startsWith('physics.')&&!['behavior.machine','scripts.behaviour'].includes(c.type))}:e;}
