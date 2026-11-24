import {expect,it} from 'vitest';
import {Container} from 'pixi.js';
import {Container3D,Mesh3D,Sphere} from '@pixi/3d';
import {SceneService,transformDefinition} from '@rewrite/scene';
import {transform3dDefinition,viewport3dDefinition} from '@rewrite/scene3d';
import {authoring3dDefinitions,draggableDefinition,Primitive3DSchema} from './contracts';
import {model3dDefinition} from './model-contracts';
import {Authoring3D} from './model';
import {Scene3DProjection} from './projection';
import {rayPlane,snapTo,pointer3dTriggers} from './interaction3d';
import {withEuler} from './math';
const defs=()=>new Map([transformDefinition,transform3dDefinition,viewport3dDefinition,model3dDefinition,...authoring3dDefinitions].map(d=>[d.type,d]));
function fixture(){const scene=new SceneService(defs),editor=new Authoring3D(scene,()=>{},()=>null,()=>true,()=>({x:480,y:270})),ids=editor.createView(),host=new Container(),errors:unknown[]=[],moves:{id:string;p:{x:number;y:number;z:number}}[]=[],events:string[]=[];
 return{scene,editor,ids,host,errors,moves,events,context:{node:(id:string)=>id===ids.viewId?host:undefined,changed(){},report(e:unknown){errors.push(e);},moved(id:string,p:{x:number;y:number;z:number}){moves.push({id,p:{...p}});},emit(type:string,id:string){events.push(`${type}:${id}`);}}};}
// Picking reads the transforms of the last render; with no renderer here, bring them up to date by hand.
const refresh=(n:Container3D):void=>{n.getGlobalTransform(n.worldTransform);(n as unknown as {_worldTransformId:number})._worldTransformId++;for(const c of n.children)if(c instanceof Container3D)refresh(c);};
const cube=(f:ReturnType<typeof fixture>)=>f.scene.document.current.entities.find(e=>e.name==='Cube')!;
it('meets a plane along a ray and snaps to a grid',()=>{
 expect(rayPlane({x:0,y:5,z:0},{x:0,y:-1,z:0},{x:0,y:1,z:0},{x:0,y:1,z:0})).toEqual({x:0,y:1,z:0});
 expect(rayPlane({x:0,y:5,z:0},{x:1,y:0,z:0},{x:0,y:1,z:0},{x:0,y:1,z:0})).toBeNull();expect(rayPlane({x:0,y:5,z:0},{x:0,y:1,z:0},{x:0,y:1,z:0},{x:0,y:1,z:0})).toBeNull();
 expect([snapTo(1.26,.5),snapTo(1.26,0),snapTo(-.74,.5)]).toEqual([1.5,1.26,-.5]);
 expect(pointer3dTriggers.map(t=>t.type)).toEqual(['pixi3d.pointerEnter','pixi3d.pointerLeave','pixi3d.dragEnd']);
 expect(Primitive3DSchema.parse({shape:'cube',color:'#ffffff',roughness:.5,metallic:0}).hitVolume).toBe('auto');
});
it('sets the clickable shape a primitive is tested against',async()=>{
 const f=fixture(),p=new Scene3DProjection(f.context);try{const id=cube(f).id,mesh=()=>p.slots[0].nodes.get(id)!.children.find(c=>c instanceof Mesh3D) as Mesh3D,set=(hitVolume:string)=>{f.scene.document.transact('Hit',s=>{(s.entities.find(e=>e.id===id)!.components.find(c=>c.type==='pixi3d.primitive')!.data as {hitVolume:string}).hitVolume=hitVolume;});p.sync(f.scene.document.current);};
  set('none');expect(mesh().eventMode).toBe('none');set('sphere');expect(mesh().hitVolume).toBeInstanceOf(Sphere);expect((mesh().hitVolume as Sphere).radius).toBeCloseTo(Math.sqrt(3)/2,6);
 }finally{await p.dispose();f.host.destroy();}
});
it('drags a Draggable object along the ground, writes its place and raises hover and drop events',async()=>{
 const f=fixture(),p=new Scene3DProjection(f.context);try{const id=cube(f).id;
  f.scene.document.transact('Drag',s=>{s.entities.find(e=>e.id===id)!.components.push({id:'drag',type:draggableDefinition.type,version:1,data:{plane:'ground',snap:.5}});
   const camera=s.entities.find(e=>e.name==='Camera')!.components.find(c=>c.type==='scene3d.transform')!;camera.data={...withEuler(camera.data as never,{x:-35,y:0,z:0}),y:4,z:6};});
  p.sync(f.scene.document.current);p.useSceneCameras();const view=p.slots[0].view,node=p.slots[0].nodes.get(id)!;
  const at=(x:number,y:number,z:number)=>view.worldToScreen({x,y,z})!,send=(type:string,g:{x:number;y:number})=>{refresh(view.camera);for(const n of p.slots[0].nodes.values())refresh(n);view.emit(type as never,{global:g,stopPropagation(){}} as never);};
  send('globalpointermove',at(0,0,0));expect(f.events).toEqual([`pixi3d.pointerEnter:${id}`]);
  send('pointerdown',at(0,0,0));send('globalpointermove',at(1.6,0,-.9));
  const last=f.moves.at(-1)!;expect(last.id).toBe(id);expect(last.p.x).toBe(1.5);expect(last.p.z).toBe(-1);expect(last.p.y).toBeCloseTo(0,5);expect([node.x,node.z]).toEqual([1.5,-1]);
  send('pointerup',at(1.6,0,-.9));expect(f.events.at(-1)).toBe(`pixi3d.dragEnd:${id}`);
  // A press and release without moving is a click, not a drop.
  send('pointerdown',at(1.5,0,-1));send('pointerup',at(1.5,0,-1));expect(f.events.filter(e=>e.startsWith('pixi3d.dragEnd'))).toHaveLength(1);
  send('globalpointermove',{x:1,y:1});expect(f.events.at(-1)).toBe(`pixi3d.pointerLeave:${id}`);
  expect(f.errors).toEqual([]);
 }finally{await p.dispose();f.host.destroy();}
});
it('still raises the leave when the view is rebuilt while an object is hovered',async()=>{
 const f=fixture(),p=new Scene3DProjection(f.context);try{const id=cube(f).id;
  f.scene.document.transact('Camera',s=>{const camera=s.entities.find(e=>e.name==='Camera')!.components.find(c=>c.type==='scene3d.transform')!;camera.data={...withEuler(camera.data as never,{x:-35,y:0,z:0}),y:4,z:6};});
  p.sync(f.scene.document.current);p.useSceneCameras();
  const send=(type:string,g:{x:number;y:number})=>{const view=p.slots[0].view;refresh(view.camera);for(const n of p.slots[0].nodes.values())refresh(n);view.emit(type as never,{global:g,stopPropagation(){}} as never);};
  send('globalpointermove',p.slots[0].view.worldToScreen({x:0,y:0,z:0})!);expect(f.events).toEqual([`pixi3d.pointerEnter:${id}`]);
  f.scene.document.transact('Recolour',s=>{(s.entities.find(e=>e.id===id)!.components.find(c=>c.type==='pixi3d.primitive')!.data as {color:string}).color='#ff0000';});
  const before=p.diagnostics().rebuilds;p.sync(f.scene.document.current);p.useSceneCameras();expect(p.diagnostics().rebuilds).toBe(before+1);
  send('globalpointermove',{x:1,y:1});expect(f.events.at(-1)).toBe(`pixi3d.pointerLeave:${id}`);
 }finally{await p.dispose();f.host.destroy();}
});
it('forgets a hover and a held drag when Play ends',async()=>{
 const f=fixture(),p=new Scene3DProjection(f.context);try{const id=cube(f).id;
  f.scene.document.transact('Drag',s=>{s.entities.find(e=>e.id===id)!.components.push({id:'drag',type:draggableDefinition.type,version:1,data:{plane:'ground',snap:0}});const camera=s.entities.find(e=>e.name==='Camera')!.components.find(c=>c.type==='scene3d.transform')!;camera.data={...withEuler(camera.data as never,{x:-35,y:0,z:0}),y:4,z:6};});
  p.sync(f.scene.document.current);p.useSceneCameras();const view=p.slots[0].view,at=(x:number,y:number,z:number)=>view.worldToScreen({x,y,z})!;
  const send=(type:string,g:{x:number;y:number})=>{refresh(view.camera);for(const n of p.slots[0].nodes.values())refresh(n);view.emit(type as never,{global:g,stopPropagation(){}} as never);};
  send('globalpointermove',at(0,0,0));send('pointerdown',at(0,0,0));p.resetPointers();
  send('globalpointermove',at(1,0,1));expect(f.moves).toEqual([]);
  send('globalpointermove',at(0,0,0));expect(f.events).toEqual([`pixi3d.pointerEnter:${id}`,`pixi3d.pointerEnter:${id}`]);
 }finally{await p.dispose();f.host.destroy();}
});
