import {expect,it} from 'vitest';
import {SceneSchema} from '@rewrite/scene';
import {applyEntity,clientEntity,NetworkEntitySchema,projectEntity} from './replication';
it('projects and applies only declared fields; removes client simulation without changing the authored entity',()=>{
 const entity=SceneSchema.parse({formatVersion:1,id:'s',name:'S',entities:[{id:'door',name:'Door',active:true,parentId:null,components:[{id:'t',type:'scene.transform2d',version:1,data:{x:10,y:20}},{id:'v',type:'pixi.shape',version:1,data:{color:'#00ff00',alpha:1}},{id:'b',type:'behavior.machine',version:1,data:{scriptId:'m'}},{id:'rb',type:'physics.rigidBody2d',version:1,data:{}},{id:'n',type:'multiplayer.entity',version:1,data:{fields:[{component:'scene.transform2d',keys:['x']},{component:'pixi.shape',keys:['color']}]}}]}]}).entities[0];
 expect(projectEntity(entity).fields).toEqual({'scene.transform2d':{x:10},'pixi.shape':{color:'#00ff00'}});
 applyEntity(entity,{id:'door',active:false,fields:{'scene.transform2d':{x:80,y:999},'pixi.shape':{color:'#ff0000',alpha:0}}});
 expect(entity.components[0].data).toEqual({x:80,y:20});expect(entity.components[1].data).toEqual({color:'#ff0000',alpha:1});
 expect(clientEntity(entity).components.map(c=>c.type)).not.toContain('behavior.machine');expect(entity.components.map(c=>c.type)).toContain('behavior.machine');
 expect(NetworkEntitySchema.safeParse({fields:[{component:'scene.transform2d',keys:['__proto__']}]}).success).toBe(false);
});
