import {expect,it} from 'vitest';
import {Container} from 'pixi.js';
import {SceneService,transformDefinition} from '@rewrite/scene';
import {transform3dDefinition,viewport3dDefinition} from '@rewrite/scene3d';
import {lookRotation as shared} from '@rewrite/scene3d/look';
import {authoring3dDefinitions} from './contracts';
import {model3dDefinition,Model3DSchema} from './model-contracts';
import {Authoring3D} from './model';
import {Scene3DProjection} from './projection';
import {lookRotation} from './look3d';
const defs=()=>new Map([transformDefinition,transform3dDefinition,viewport3dDefinition,model3dDefinition,...authoring3dDefinitions].map(d=>[d.type,d]));
const settle=()=>new Promise(resolve=>setTimeout(resolve,0));
it('keeps the Look at add-on and scripts on one look rotation',()=>{expect(lookRotation).toBe(shared);});
it('loads a model by default; a script unloading it releases the shared file and loading asks for it again',async()=>{
 expect(Model3DSchema.parse({assetId:'a',overrideMaterial:false,color:'#ffffff',roughness:.5,metallic:0}).loaded).toBe(true);
 const scene=new SceneService(defs),editor=new Authoring3D(scene,()=>{},()=>null,()=>true,()=>({x:480,y:270})),view=editor.createView().viewId,host=new Container(),loads:string[]=[],unloads:string[]=[];
 scene.document.transact('Model',s=>{s.entities.push({id:'m',name:'Castle',parentId:view,active:true,spatial:'scene3d.transform',components:[{id:'t',type:'scene3d.transform',version:1,data:{x:0,y:0,z:0,qx:0,qy:0,qz:0,qw:1,scaleX:1,scaleY:1,scaleZ:1}},{id:'r',type:'pixi3d.modelRenderer',version:1,data:{assetId:'a',overrideMaterial:false,color:'#ffffff',roughness:.5,metallic:0,materialSlots:[],scene:'',loaded:false}}]} as never);});
 const assets={get:()=>({id:'a',type:'pixi3d.model',revision:'r1',metadata:{pipeline:'gltf-transform-4.5.1/glb-v1',nodes:1,meshes:1,triangles:1,vertices:3,materials:[],animations:[],bounds:{min:[0,0,0],max:[1,1,0]},warnings:[]}}) as never,url:()=>'castle.glb'};
 // The fake file never becomes a model, so the state ends in error; what matters here is when the file is asked for and let go.
 const p=new Scene3DProjection({node:(id:string)=>id===view?host:undefined,changed(){},report(){}},assets,{load:async url=>{loads.push(url);throw Error('not a real model');},unload:async url=>{unloads.push(url);}});
 try{
  p.sync(scene.document.current);await settle();
  expect(loads).toEqual([]);expect(p.modelState('m')).toEqual({state:'unloaded'});expect(p.resources?.stats.resources).toBe(0);
  const set=(loaded:boolean)=>scene.document.transact('Load',s=>{(s.entities.find(e=>e.id==='m')!.components[1].data as {loaded:boolean}).loaded=loaded;});
  set(true);expect(p.sync(scene.document.current)).toBe(true);
  expect(p.modelState('m')).toEqual({state:'loading'});expect(p.resources?.stats.refs).toBe(1);
  await settle();await settle();
  expect(loads).toEqual(['castle.glb']);expect(p.modelState('m').state).toBe('error');
  set(false);p.sync(scene.document.current);await settle();await settle();
  expect(p.modelState('m')).toEqual({state:'unloaded'});expect(p.resources?.stats).toMatchObject({resources:0,refs:0});
  set(true);p.sync(scene.document.current);await settle();await settle();
  expect(loads).toEqual(['castle.glb','castle.glb']);
 }finally{await p.dispose();}
});
it('reports no 3D hit where no view is under the point',()=>{
 const scene=new SceneService(defs),editor=new Authoring3D(scene,()=>{},()=>null,()=>true,()=>({x:480,y:270})),view=editor.createView().viewId,host=new Container();
 const p=new Scene3DProjection({node:(id:string)=>id===view?host:undefined,changed(){},report(e:unknown){throw e;}});
 try{p.sync(scene.document.current);expect(p.raycastHit({x:-50,y:-50})).toBeNull();host.visible=false;expect(p.raycastHit({x:10,y:10})).toBeNull();}finally{void p.dispose();}
});
it('moves a node to its new parent in the same view without a rebuild, and rebuilds when it changes view',()=>{
 const scene=new SceneService(defs),editor=new Authoring3D(scene,()=>{},()=>null,()=>true,()=>({x:480,y:270})),view=editor.createView().viewId,second=editor.createView().viewId,hosts=new Map([[view,new Container()],[second,new Container()]]);
 const t=(x:number)=>({x,y:0,z:0,qx:0,qy:0,qz:0,qw:1,scaleX:1,scaleY:1,scaleZ:1});
 scene.document.transact('Car',s=>{s.entities.push({id:'car',name:'Car',parentId:view,active:true,spatial:'scene3d.transform',components:[{id:'ct',type:'scene3d.transform',version:1,data:t(4)}]} as never);});
 const p=new Scene3DProjection({node:(id:string)=>hosts.get(id),changed(){},report(e:unknown){throw e;}});
 try{p.sync(scene.document.current);const slot=p.slots.find(s=>s.id===view)!,cube=scene.document.current.entities.find(e=>e.name==='Cube'&&e.parentId===view)!.id,node=slot.nodes.get(cube)!;
  expect(node.parent).toBe(slot.view.root);
  scene.document.transact('Ride',s=>{const e=s.entities.find(x=>x.id===cube)!;e.parentId='car';Object.assign(e.components.find(c=>c.type==='scene3d.transform')!.data as object,{x:-4});});
  expect(p.sync(scene.document.current)).toBe(false);
  expect(node.parent).toBe(slot.nodes.get('car'));expect(slot.nodes.get(cube)).toBe(node);expect(node.position.x).toBe(-4);
  scene.document.transact('Off',s=>{const e=s.entities.find(x=>x.id===cube)!;e.parentId=view;});
  expect(p.sync(scene.document.current)).toBe(false);expect(node.parent).toBe(slot.view.root);
  scene.document.transact('Elsewhere',s=>{s.entities.find(x=>x.id===cube)!.parentId=second;});
  expect(p.sync(scene.document.current)).toBe(true);expect(p.slots.find(s=>s.id===second)!.nodes.has(cube)).toBe(true);
 }finally{void p.dispose();}
});
