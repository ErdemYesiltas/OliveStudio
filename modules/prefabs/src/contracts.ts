import {z} from 'zod';
import {SceneSchema} from '@rewrite/scene';
import type {ComponentDefinition} from '@rewrite/sdk';
export const prefabSection='prefabs.registry';
export const SnapshotSchema=z.object({rootId:z.string().min(1),entities:SceneSchema.shape.entities}).strict();
/** A variant is its base prefab plus its own differences; `base` is the base snapshot those differences were taken against. */
export const VariantLinkSchema=z.object({baseId:z.uuid(),revision:z.number().int().positive(),base:SnapshotSchema}).strict();
export const PrefabSchema=SnapshotSchema.extend({id:z.uuid(),name:z.string().trim().min(1).max(100),revision:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),variant:VariantLinkSchema.optional()}).strict();
export const PrefabRegistrySchema=z.object({version:z.literal(1),items:z.array(PrefabSchema).max(1000)}).strict().superRefine((v,c)=>{if(new Set(v.items.map(a=>a.id)).size!==v.items.length)c.addIssue({code:'custom',message:'Duplicate prefab ID'});const byId=new Map(v.items.map(a=>[a.id,a]));for(const item of v.items){const seen=new Set([item.id]);for(let base=item.variant?.baseId;base;base=byId.get(base)?.variant?.baseId){if(!byId.has(base)){c.addIssue({code:'custom',message:`Variant base missing: ${item.name}`});break;}if(seen.has(base)){c.addIssue({code:'custom',message:`Variant cycle: ${item.name}`});break;}seen.add(base);}}});
export const InstanceSchema=z.object({prefabId:z.uuid(),revision:z.number().int().positive(),base:SnapshotSchema,entities:z.record(z.string(),z.string().min(1)),components:z.record(z.string(),z.string().min(1))}).strict();
export type Prefab=z.infer<typeof PrefabSchema>;export type Snapshot=z.infer<typeof SnapshotSchema>;export type PrefabInstance=z.infer<typeof InstanceSchema>;
export const instanceType='prefabs.instance';
export const prefabInstanceDefinition:ComponentDefinition={type:instanceType,version:1,titleKey:'prefab.instance',editorOnly:true,hiddenInInspector:true,addable:false,preserveLocalIdsOnDuplicate:true,fields:[],defaults(){throw Error('Use Create prefab or Instantiate');},parse:v=>InstanceSchema.parse(v),remapReferences(value,ids){const p=InstanceSchema.parse(value);p.entities=Object.fromEntries(Object.entries(p.entities).map(([k,v])=>[k,ids.entities.get(v)??v]));p.components=Object.fromEntries(Object.entries(p.components).map(([k,v])=>[k,ids.components.get(v)??v]));return p;}};

/** Prefab edit mode: the prefab open as a temporary scene, and the scene to return to. */
export const prefabEditSection='prefabs.editing';
export const PrefabEditSchema=z.object({prefabId:z.uuid(),sceneId:z.string().min(1),returnSceneId:z.string().min(1)}).strict();
export type PrefabEdit=z.infer<typeof PrefabEditSchema>;
