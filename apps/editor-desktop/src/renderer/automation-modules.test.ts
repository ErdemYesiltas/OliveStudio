import {expect,it} from 'vitest';
import {ModuleHost,AutomationExecutor} from '@rewrite/kernel';
import {components,automationTools} from '@rewrite/sdk';
import {projectModule,projectToken,projectSections,sceneDocumentToken} from '@rewrite/project';
import {sceneModule,sceneToken} from '@rewrite/scene';
import {tweenModule} from '@rewrite/tween';
import {animationModule} from '@rewrite/animation';
import {scriptsModule} from '@rewrite/scripts';
import {prefabsModule} from '@rewrite/prefabs';
it('discovers module-owned tools, edits nested animation/script data through validators, and cleans up with the host',async()=>{
 const host=new ModuleHost();let project!:ReturnType<typeof getProject>,scene!:ReturnType<typeof getScene>;
 // References are captured only for this test's composition; no domain dependency enters the kernel.
 const getProject=(value:import('@rewrite/project').ProjectService)=>value,getScene=(value:import('@rewrite/scene').SceneService)=>value;
 await host.start([projectModule(()=>new Map(host.entries(components).map(e=>[e.value.type,e.value])),()=>host.entries(projectSections).map(e=>e.value)),sceneModule(()=>new Map(host.entries(components).map(e=>[e.value.type,e.value])),{owner:'project',get:c=>c.get(sceneDocumentToken)}),tweenModule,animationModule,scriptsModule,prefabsModule,{manifest:{id:'interactions',version:'1.0.0',apiVersion:1},activate(){}},{manifest:{id:'fixture',version:'1.0.0',apiVersion:1,requires:{project:'^1',scene:'^1'}},activate(c){project=getProject(c.get(projectToken));scene=getScene(c.get(sceneToken));}}]);
 expect(host.diagnostics).toEqual([]);
 const executor=new AutomationExecutor({entries:()=>host.entries(automationTools),snapshot:()=>({generation:project.generation,revision:project.document.version}),editable:()=>{},batch:(label,work)=>project.document.batch(label,work)});
 try{
  expect(executor.list().map(t=>t.name)).toEqual(expect.arrayContaining(['scene.set_component','animation.set_track','scripts.upsert','prefabs.instantiate']));
  const id=scene.create('Actor');scene.addComponent(id,'animation.player');const player=scene.document.current.entities[0].components.find(c=>c.type==='animation.player')!;
  const clip=await executor.execute('animation.create_clip',{componentId:player.id,name:'Run'}) as {id:string};
  await executor.execute('animation.set_track',{componentId:player.id,clipId:clip.id,track:{id:'track',entityId:id,componentId:scene.document.current.entities[0].components[0].id,property:'x',keys:[{id:'a',time:0,value:10,ease:'linear'},{id:'b',time:1,value:100,ease:'linear'}]}});
  const original=structuredClone(project.document.current);await expect(executor.execute('animation.delete_clip',{componentId:player.id,clipId:'missing'})).rejects.toThrow('not found');expect(project.document.current).toEqual(original);
  const description=await executor.execute('scene.describe_components',{}) as {type:string;dataSchema:unknown}[];expect(description.find(d=>d.type==='animation.player')?.dataSchema).toBeTruthy();expect(()=>structuredClone(description)).not.toThrow();
  const script=await executor.execute('scripts.upsert',{name:'Actor',source:'export function onStart(self) { self.x = 5; }'}) as {id:string;code:string};expect(script.code).toContain('onStart');
  await expect(executor.execute('project.set_section',{key:'scripts.library',value:{version:1,items:[]}})).rejects.toThrow('managed');
  const invalid=await executor.execute('scripts.validate',{name:'Invalid',source:'import fs from "node:fs";'});expect(invalid).toMatchObject({code:'',error:expect.stringContaining('cannot import')});
  await executor.execute('scene.set_component',{objectId:id,component:'scene.transform2d',data:{x:10,y:20,rotation:0,scaleX:1,scaleY:1}});project.document.undo();expect(scene.document.current.entities[0].components[0].data).toMatchObject({x:480,y:270});
 }finally{executor.dispose();await host.stop();}
 expect(host.entries(automationTools)).toEqual([]);
});
