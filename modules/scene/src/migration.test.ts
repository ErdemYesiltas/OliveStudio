import { expect,it } from 'vitest';
import { migrateScene,makeEntity,transformDefinition } from './index';
import type { ComponentDefinition } from '@rewrite/sdk';
it('migrates known older payloads on a copy while preserving newer unknown payloads',()=>{
 const e=makeEntity('E');e.components.push({id:'a',type:'plugin.number',version:1,data:{old:2}},{id:'b',type:'plugin.future',version:8,data:{untouched:true}});
 const input={formatVersion:1,id:'s',name:'S',entities:[e]},before=structuredClone(input);
 const def:ComponentDefinition={type:'plugin.number',version:2,titleKey:'n',fields:[],defaults:()=>({n:0}),parse:x=>x as {n:number},migrate:x=>({n:Number((x as {old:number}).old)})};
 const defs=new Map([[transformDefinition.type,transformDefinition],[def.type,def]]);
 const migrated=migrateScene(input,defs);expect(migrated.entities[0].components[1]).toMatchObject({version:2,data:{n:2}});expect(input).toEqual(before);
 def.migrate=()=>{throw Error('migration failed');};expect(()=>migrateScene(input,defs)).toThrow('migration failed');expect(input).toEqual(before);
});
