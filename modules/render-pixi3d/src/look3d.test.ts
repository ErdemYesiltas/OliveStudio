import {expect,it} from 'vitest';
import {Container} from 'pixi.js';
import {Container3D} from '@pixi/3d';
import {SceneService,transformDefinition,type Entity} from '@rewrite/scene';
import {transform3dDefinition,viewport3dDefinition} from '@rewrite/scene3d';
import {authoring3dDefinitions} from './contracts';
import {model3dDefinition} from './model-contracts';
import {Authoring3D} from './model';
import {Scene3DProjection} from './projection';
import {runtime3DProblems} from './preflight';
import {withEuler} from './math';
import {lookRotation,alignUp,slerp,lookAtType,pointerFollowType} from './look3d';
const rotate=(q:readonly number[],v:[number,number,number])=>{const [x,y,z,w]=q,tx=2*(y*v[2]-z*v[1]),ty=2*(z*v[0]-x*v[2]),tz=2*(x*v[1]-y*v[0]);return[v[0]+w*tx+y*tz-z*ty,v[1]+w*ty+z*tx-x*tz,v[2]+w*tz+x*ty-y*tx];};
const close=(a:number[],b:number[])=>a.forEach((v,i)=>expect(v).toBeCloseTo(b[i],5));
it('turns the front toward a direction without rolling',()=>{
 const q=lookRotation({x:3,y:0,z:0})!;close(rotate(q,[0,0,1]),[1,0,0]);close(rotate(q,[0,1,0]),[0,1,0]);
 const back=lookRotation({x:0,y:0,z:5},undefined,'-Z')!;close(rotate(back,[0,0,-1]),[0,0,1]);
 const up=lookRotation({x:1,y:1,z:0})!,f=rotate(up,[0,0,1]);expect(f[0]).toBeCloseTo(Math.SQRT1_2,5);expect(f[1]).toBeCloseTo(Math.SQRT1_2,5);expect(rotate(up,[1,0,0])[1]).toBeCloseTo(0,5);
 close(rotate(lookRotation({x:1,y:1,z:0},undefined,'+Z',true)!,[0,0,1]),[1,0,0]);
 expect(lookRotation({x:0,y:0,z:0})).toBeNull();expect(lookRotation({x:0,y:2,z:0},undefined,'+Z',true)).toBeNull();
 close(rotate(lookRotation({x:0,y:1,z:0})!,[0,0,1]),[0,1,0]);
 close(rotate(alignUp({x:1,y:0,z:0}),[0,1,0]),[1,0,0]);close(rotate(alignUp({x:0,y:-1,z:0}),[0,1,0]),[0,-1,0]);
 close(slerp([0,0,0,1],[0,1,0,0],.5),[0,Math.SQRT1_2,0,Math.SQRT1_2]);
});
const defs=()=>new Map([transformDefinition,transform3dDefinition,viewport3dDefinition,model3dDefinition,...authoring3dDefinitions].map(d=>[d.type,d]));
function fixture(){const scene=new SceneService(defs),editor=new Authoring3D(scene,()=>{},()=>null,()=>true,()=>({x:480,y:270})),ids=editor.createView(),host=new Container(),errors:unknown[]=[],moves:{id:string;p:Record<string,number>}[]=[];
 return{scene,editor,ids,host,errors,moves,context:{node:(id:string)=>id===ids.viewId?host:undefined,changed(){},report(e:unknown){errors.push(e);},moved(id:string,p:Record<string,number>){moves.push({id,p:{...p}});}}};}
const byName=(f:ReturnType<typeof fixture>,name:string)=>f.scene.document.current.entities.find(e=>e.name===name)!;
const refresh=(n:Container3D):void=>{n.getGlobalTransform(n.worldTransform);(n as unknown as {_worldTransformId:number})._worldTransformId++;for(const c of n.children)if(c instanceof Container3D)refresh(c);};
function addMarker(f:ReturnType<typeof fixture>,name:string,x:number,component:{type:string;data:Record<string,string|number|boolean>}){f.scene.document.transact('Add',s=>{const cube=s.entities.find(e=>e.name==='Cube')!,copy=JSON.parse(JSON.stringify(cube)) as Entity;copy.id=name;copy.name=name;copy.components=copy.components.map(c=>({...c,id:`${name}-${c.type}`}));Object.assign(copy.components.find(c=>c.type==='scene3d.transform')!.data as object,{x,y:0,z:0,scaleX:.2,scaleY:.2,scaleZ:.2});copy.components.push({id:`${name}-c`,type:component.type,version:1,data:component.data});s.entities.push(copy);});}
it('faces its target only through the scene camera, and keeps the authored turn in the editor',async()=>{
 const f=fixture(),p=new Scene3DProjection(f.context);try{const cube=byName(f,'Cube').id;addMarker(f,'Turret',-3,{type:lookAtType,data:{targetId:cube,axis:'+Z',yawOnly:true,weight:1}});
  p.sync(f.scene.document.current);p.setParticleTime(0);const turret=p.slots[0].nodes.get('Turret')!;expect(turret.quaternion.w).toBeCloseTo(1,6);
  p.useSceneCameras();p.setParticleTime(.1);close(rotate([turret.quaternion.x,turret.quaternion.y,turret.quaternion.z,turret.quaternion.w],[0,0,1]),[1,0,0]);
  expect(runtime3DProblems(f.scene.document.current)).toEqual([]);expect(f.errors).toEqual([]);
 }finally{await p.dispose();f.host.destroy();}
});
it('puts a pointer follower on the surface under the pointer, or on the ground past it',async()=>{
 const f=fixture(),p=new Scene3DProjection(f.context);try{
  f.scene.document.transact('Camera',s=>{const camera=s.entities.find(e=>e.name==='Camera')!.components.find(c=>c.type==='scene3d.transform')!;camera.data={...withEuler(camera.data as never,{x:-35,y:0,z:0}),y:4,z:6};});
  addMarker(f,'Cursor',3,{type:pointerFollowType,data:{surface:'objects',groundY:-.5,align:true,lift:.1,hideWhenMissed:true}});
  p.sync(f.scene.document.current);p.useSceneCameras();const view=p.slots[0].view,cursor=p.slots[0].nodes.get('Cursor')!;
  const move=(g:{x:number;y:number})=>{refresh(view.camera);for(const n of p.slots[0].nodes.values())refresh(n);view.emit('globalpointermove' as never,{global:g,stopPropagation(){}} as never);};
  move(view.worldToScreen({x:0,y:.5,z:0})!);expect(cursor.y).toBeCloseTo(.6,3);expect(Math.abs(cursor.x)).toBeLessThan(.05);close(rotate([cursor.quaternion.x,cursor.quaternion.y,cursor.quaternion.z,cursor.quaternion.w],[0,1,0]),[0,1,0]);
  expect(f.moves.at(-1)!.id).toBe('Cursor');expect(f.moves.at(-1)!.p.y).toBeCloseTo(.6,3);
  move(view.worldToScreen({x:2,y:-.5,z:1})!);expect(cursor.x).toBeCloseTo(2,2);expect(cursor.y).toBeCloseTo(-.4,3);expect(cursor.visible).toBe(true);
  // A ground plane above the camera is never reached by a ray going down: the follower hides.
  f.scene.document.transact('Sky',s=>{Object.assign(s.entities.find(e=>e.name==='Cursor')!.components.find(c=>c.type===pointerFollowType)!.data as object,{surface:'ground',groundY:10});});p.sync(f.scene.document.current);p.useSceneCameras();
  const view2=p.slots[0].view,cursor2=p.slots[0].nodes.get('Cursor')!;refresh(view2.camera);for(const n of p.slots[0].nodes.values())refresh(n);view2.emit('globalpointermove' as never,{global:{x:320,y:180},stopPropagation(){}} as never);
  expect(cursor2.visible).toBe(false);expect(f.errors).toEqual([]);
 }finally{await p.dispose();f.host.destroy();}
});
it('reports a Look at without a 3D target',()=>{
 const f=fixture();f.scene.document.transact('Look',s=>{s.entities.find(e=>e.name==='Cube')!.components.push({id:'l',type:lookAtType,version:1,data:{targetId:'',axis:'+Z',yawOnly:false,weight:1}});});
 expect(runtime3DProblems(f.scene.document.current).join()).toContain('Look at needs the ID');
});
