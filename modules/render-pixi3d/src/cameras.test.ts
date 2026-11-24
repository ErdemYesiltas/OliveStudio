import {expect,it,vi,afterEach} from 'vitest';
import {Container,RenderTexture} from 'pixi.js';
import {Mesh3D,MeshPass,Quaternion,Vector3,Camera3D} from '@pixi/3d';
import {OrbitCamera,FPSCamera,PortalMaterial,PortalPass} from '@pixi/3d/extras';
import {SceneService,transformDefinition} from '@rewrite/scene';
import {transform3dDefinition,viewport3dDefinition} from '@rewrite/scene3d';
import {authoring3dDefinitions,cameraControlDefinition,Camera3DSchema} from './contracts';
import {model3dDefinition} from './model-contracts';
import {Authoring3D} from './model';
import {Scene3DProjection} from './projection';
import {runtime3DProblems} from './preflight';
import {yawPitch,CameraControlSchema} from './camera-control';
const defs=()=>new Map([transformDefinition,transform3dDefinition,viewport3dDefinition,model3dDefinition,...authoring3dDefinitions].map(d=>[d.type,d]));
function fixture(){const scene=new SceneService(defs),editor=new Authoring3D(scene,()=>{},()=>null,()=>true,()=>({x:480,y:270})),ids=editor.createView(),host=new Container(),errors:unknown[]=[];return{scene,editor,ids,host,errors,context:{node:(id:string)=>id===ids.viewId?host:undefined,changed(){},report(e:unknown){errors.push(e);}}};}
const entity=(f:ReturnType<typeof fixture>,name:string)=>f.scene.document.current.entities.find(e=>e.name===name)!;
const set=(f:ReturnType<typeof fixture>,id:string,type:string,data:object)=>f.scene.document.transact('Edit',s=>{Object.assign(s.entities.find(e=>e.id===id)!.components.find(c=>c.type===type)!.data as object,data);});
const viewCamera=(f:ReturnType<typeof fixture>)=>(f.scene.document.current.entities.find(e=>e.id===f.ids.viewId)!.components.find(c=>c.type==='pixi3d.viewport')!.data as {cameraId:string}).cameraId;
it('turns a camera forward into the first-person yaw and pitch the controller rebuilds it from',()=>{
 for(const [yaw,pitch] of [[0,0],[.7,-.3],[-2.5,.9],[3,0]]){const q=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),yaw).multiply(new Quaternion().setFromAxisAngle(new Vector3(1,0,0),pitch)),f=new Vector3(0,0,-1).applyQuaternion(q),out=yawPitch(f);
  expect(out.pitch).toBeCloseTo(pitch,9);expect(Math.atan2(Math.sin(out.yaw-yaw),Math.cos(out.yaw-yaw))).toBeCloseTo(0,9);}
 expect(CameraControlSchema.parse({})).toMatchObject({mode:'orbit',minDistance:1,maxDistance:50,moveSpeed:4,pointerLock:true});expect(()=>CameraControlSchema.parse({minDistance:10,maxDistance:2})).toThrow(/Max distance/);
 expect(Camera3DSchema.parse({mode:'perspective',fov:50,near:.1,far:100,orthographicSize:5})).toMatchObject({feedWidth:512,feedHeight:288});
});
it('draws a second camera into a texture a surface shows, and a portal from behind its exit',async()=>{
 const f=fixture(),p=new Scene3DProjection(f.context);try{
  const security=f.editor.create('camera',f.ids.viewId).id;set(f,security,'pixi3d.camera',{feedWidth:320,feedHeight:180});
  const screen=f.editor.create('plane',f.ids.viewId).id,exit=f.editor.create('plane',f.ids.viewId).id,cube=entity(f,'Cube').id;
  set(f,screen,'pixi3d.primitive',{feedCameraId:security,material:'flat'});set(f,cube,'pixi3d.primitive',{shape:'plane',portalExitId:exit});
  p.sync(f.scene.document.current);const slot=p.slots[0],mesh=(id:string)=>slot.nodes.get(id)!.children.find(c=>c instanceof Mesh3D) as Mesh3D;
  const camera=slot.cameras.get(security)!,feed=camera.renderTexture as RenderTexture;expect(feed).toBeInstanceOf(RenderTexture);expect([feed.width,feed.height]).toEqual([320,180]);
  expect((mesh(screen).material.textures as {baseColor:unknown}).baseColor).toBe(feed);
  expect(slot.view.passes.filter(x=>x instanceof MeshPass)).toHaveLength(1);expect(slot.view.passes.some(x=>x instanceof PortalPass)).toBe(true);expect(mesh(cube).material).toBeInstanceOf(PortalMaterial);
  expect(f.errors).toEqual([]);expect(runtime3DProblems(f.scene.document.current)).toEqual([]);
  set(f,screen,'pixi3d.primitive',{feedCameraId:viewCamera(f)});set(f,cube,'pixi3d.primitive',{portalExitId:'nowhere'});p.sync(f.scene.document.current);
  expect(f.errors.map(String).join()).toMatch(/view's own camera can't be shown/);expect(f.errors.map(String).join()).toMatch(/portal exit nowhere is not a primitive/);
  const problems=runtime3DProblems(f.scene.document.current).join();expect(problems).toMatch(/view's own camera/);expect(problems).toMatch(/portal exit \(nowhere\)/);
 }finally{await p.dispose();f.host.destroy();}
});
afterEach(()=>{vi.unstubAllGlobals();});
it('hands the scene camera to its control in Play keeping its world pose, and returns it after',async()=>{
 vi.stubGlobal('requestAnimationFrame',()=>0);vi.stubGlobal('cancelAnimationFrame',()=>{});
 const events={addEventListener(){},removeEventListener(){}};vi.stubGlobal('document',{...events,pointerLockElement:null,exitPointerLock(){}});vi.stubGlobal('window',{...events});
 const f=fixture(),p=new Scene3DProjection(f.context);try{const camId=viewCamera(f);
  f.scene.document.transact('Control',s=>{const e=s.entities.find(x=>x.id===camId)!;e.components.push({id:'control',type:cameraControlDefinition.type,version:1,data:{...(cameraControlDefinition.defaults() as object),targetY:.5}});});
  p.sync(f.scene.document.current);const slot=p.slots[0],camera=slot.cameras.get(camId)!,node=slot.nodes.get(camId)!,before=camera.getGlobalPosition();
  expect(runtime3DProblems(f.scene.document.current)).toEqual([]);
  p.useSceneCameras();expect(slot.view.camera).toBe(camera);expect(camera.parent).toBe(slot.view.root);const after=camera.getGlobalPosition();
  expect([after.x,after.y,after.z].map(v=>+v.toFixed(5))).toEqual([before.x,before.y,before.z].map(v=>+v.toFixed(5)));
  expect(slot.controller).toBeDefined();p.useSceneCameras();expect(slot.controller?.camera).toBe(camera);
  p.stopCameraControls();expect(slot.controller).toBeUndefined();expect(camera.parent).toBe(node);expect([camera.x,camera.y,camera.z]).toEqual([0,0,0]);
  set(f,camId,cameraControlDefinition.type,{mode:'firstPerson'});p.sync(f.scene.document.current);p.useSceneCameras();const fps=p.slots[0];
  const forward=new Vector3(0,0,-1).applyQuaternion(fps.view.camera.quaternion),authored=new Vector3(0,0,-1).applyQuaternion(fps.nodes.get(camId)!.quaternion);
  expect(forward.x).toBeCloseTo(authored.x,4);expect(forward.y).toBeCloseTo(authored.y,4);expect(forward.z).toBeCloseTo(authored.z,4);
  p.stopCameraControls();
  const lone=f.editor.create('cube',f.ids.viewId).id;f.scene.document.transact('Bad',s=>{s.entities.find(e=>e.id===lone)!.components.push({id:'c2',type:cameraControlDefinition.type,version:1,data:cameraControlDefinition.defaults()});});
  expect(runtime3DProblems(f.scene.document.current).join()).toMatch(/Camera control needs a camera/);
  expect(OrbitCamera&&FPSCamera&&Camera3D).toBeTruthy();
 }finally{await p.dispose();f.host.destroy();}
});
