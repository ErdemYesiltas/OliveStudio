import {z} from 'zod';
import {automationTool,automationTools,type ModuleContext} from '@rewrite/sdk';
import type {PrefabService} from './index';
export function registerPrefabAutomation(c:ModuleContext,s:PrefabService){
 const id=z.string().min(1);
 c.contribute(automationTools,'prefabs.list',automationTool(z.object({}).strict(),{description:'List prefab sources and variants, with complete source entities.',effect:'read',execute:()=>s.items}));
 c.contribute(automationTools,'prefabs.create',automationTool(z.object({objectId:id}).strict(),{description:'Create a linked prefab from an object subtree.',effect:'edit',execute:a=>({id:s.create(a.objectId)})}));
 c.contribute(automationTools,'prefabs.instantiate',automationTool(z.object({prefabId:id,x:z.number().finite().default(480),y:z.number().finite().default(270)}).strict(),{description:'Instantiate a prefab with fresh stable IDs.',effect:'edit',execute:a=>({id:s.instantiate(a.prefabId,{x:a.x,y:a.y})})}));
 c.contribute(automationTools,'prefabs.create_variant',automationTool(z.object({prefabId:id}).strict(),{description:'Create a variant following a base prefab.',effect:'edit',execute:a=>({id:s.createVariant(a.prefabId)})}));
 c.contribute(automationTools,'prefabs.overrides',automationTool(z.object({objectId:id}).strict(),{description:'Read instance overrides.',effect:'read',execute:a=>s.overrides(a.objectId)}));
 for(const method of ['apply','revert','unpack','sync'] as const)c.contribute(automationTools,`prefabs.${method}`,automationTool(z.object({objectId:id}).strict(),{description:`${method} a prefab instance using the normal prefab service.`,effect:'edit',execute:a=>s[method](a.objectId)}));
 c.contribute(automationTools,'prefabs.rename',automationTool(z.object({prefabId:id,name:z.string().min(1).max(100)}).strict(),{description:'Rename a prefab source and propagate through the prefab service.',effect:'edit',execute:a=>s.rename(a.prefabId,a.name)}));
 c.contribute(automationTools,'prefabs.edit_source',automationTool(z.object({prefabId:id}).strict(),{description:'Open a temporary editable prefab source scene. Save or cancel before editing another prefab.',effect:'session',execute:a=>s.openForEditing(a.prefabId)}));
 c.contribute(automationTools,'prefabs.save_source',automationTool(z.object({}).strict(),{description:'Apply the source editing scene to the prefab, updating instances and variants.',effect:'session',execute:()=>s.saveEditing()}));
 c.contribute(automationTools,'prefabs.cancel_source',automationTool(z.object({}).strict(),{description:'Cancel temporary prefab source editing and return to the previous scene.',effect:'session',execute:()=>s.cancelEditing()}));
 c.contribute(automationTools,'prefabs.revert_variant',automationTool(z.object({prefabId:id}).strict(),{description:'Revert variant overrides.',effect:'edit',execute:a=>s.revertVariant(a.prefabId)}));
}
