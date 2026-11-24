import {expect,it} from 'vitest';
import {Container,RenderTexture} from 'pixi.js';
import {Mesh3D} from '@pixi/3d';
import {SceneService,transformDefinition,makeEntity} from '@rewrite/scene';
import {transform3dDefinition,viewport3dDefinition,Viewport3DSchema} from '@rewrite/scene3d';
import {authoring3dDefinitions,followDefinition} from './contracts';
import {model3dDefinition} from './model-contracts';
import {Authoring3D} from './model';
import {Scene3DProjection} from './projection';
import {runtime3DProblems} from './preflight';
const defs=()=>new Map([transformDefinition,transform3dDefinition,viewport3dDefinition,model3dDefinition,...authoring3dDefinitions].map(d=>[d.type,d]));
function fixture(){const scene=new SceneService(defs),editor=new Authoring3D(scene,()=>{},()=>null,()=>true,()=>({x:480,y:270})),ids=editor.createView(),host=new Container(),stage=new Container(),nodes=new Map<string,Container>(),errors:unknown[]=[];stage.addChild(host);
 return{scene,editor,ids,host,stage,nodes,errors,context:{node:(id:string)=>id===ids.viewId?host:nodes.get(id),changed(){},report(e:unknown){errors.push(e);}}};}
const cube=(f:ReturnType<typeof fixture>)=>f.scene.document.current.entities.find(e=>e.name==='Cube')!;
it('shows a 2D object on a surface through a capture texture, flipped the other way up from an image',async()=>{
 const f=fixture(),p=new Scene3DProjection(f.context);try{
  const panel=makeEntity('Panel',0,0);f.scene.document.transact('Panel',s=>{s.entities.push(panel);Object.assign(s.entities.find(e=>e.name==='Cube')!.components.find(c=>c.type==='pixi3d.primitive')!.data as object,{shape:'plane',material:'flat',screenSourceId:panel.id,screenWidth:300,screenHeight:120});});
  p.sync(f.scene.document.current);const mesh=p.slots[0].nodes.get(cube(f).id)!.children.find(c=>c instanceof Mesh3D) as Mesh3D,texture=(mesh.material.textures as {baseColor:RenderTexture}).baseColor;
  expect(texture).toBeInstanceOf(RenderTexture);expect([texture.width,texture.height]).toEqual([300,120]);
  // A plane already flips V for images; the capture is stored bottom row first, so its transform flips V back.
  expect([mesh.material.uvTransform!.d,mesh.material.uvTransform!.ty]).toEqual([-1,1]);
  p.setParticleTime(0);expect(f.errors).toEqual([]);expect(runtime3DProblems(f.scene.document.current)).toEqual([]);
  f.scene.document.transact('Wrong',s=>{(s.entities.find(e=>e.name==='Cube')!.components.find(c=>c.type==='pixi3d.primitive')!.data as {screenSourceId:string}).screenSourceId=cube(f).id;});
  expect(runtime3DProblems(f.scene.document.current).join()).toMatch(/missing or not 2D/);
 }finally{await p.dispose();f.host.destroy();}
});
it('moves a 2D label onto its 3D target on screen once the scene camera is in use, and hides it behind the camera',async()=>{
 const f=fixture(),p=new Scene3DProjection(f.context);try{
  const label=makeEntity('Tag',5,5),target=cube(f).id;label.components.push({id:'follow',type:followDefinition.type,version:1,data:{...(followDefinition.defaults() as object),targetId:target,offsetY:.5}});
  f.scene.document.transact('Tag',s=>{s.entities.push(label);});const node=new Container();node.position.set(5,5);f.stage.addChild(node);f.nodes.set(label.id,node);
  p.sync(f.scene.document.current);p.setParticleTime(0);expect([node.x,node.y]).toEqual([5,5]);
  p.useSceneCameras();p.setParticleTime(0);const slot=p.slots[0],at=slot.view.worldToScreen({x:0,y:.5,z:0})!;
  expect(node.x).toBeCloseTo(at.x,4);expect(node.y).toBeCloseTo(at.y,4);
  // The scene camera sits 6 in front of the cube; turned to face away, the cube is behind it.
  slot.view.camera.lookAt({x:0,y:0,z:30});p.setParticleTime(0);expect(node.visible).toBe(false);
  slot.view.camera.lookAt({x:0,y:0,z:0});p.setParticleTime(0);expect(node.visible).toBe(true);
  expect(runtime3DProblems(f.scene.document.current)).toEqual([]);
  f.scene.document.transact('Bad',s=>{(s.entities.find(e=>e.id===label.id)!.components[1].data as {targetId:string}).targetId=label.id;});expect(runtime3DProblems(f.scene.document.current).join()).toMatch(/Follow 3D object needs/);
  expect(Viewport3DSchema.parse({width:10,height:10,background:'transparent'}).background).toBe('transparent');
 }finally{await p.dispose();f.host.destroy();}
});
