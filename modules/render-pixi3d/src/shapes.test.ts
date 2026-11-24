import {expect,it} from 'vitest';
import {Container} from 'pixi.js';
import {Mesh3D,Sprite3D,CylinderGeometry,TorusKnotGeometry,IcosahedronGeometry,SphereGeometry} from '@pixi/3d';
import {SceneService,transformDefinition} from '@rewrite/scene';
import {transform3dDefinition,viewport3dDefinition} from '@rewrite/scene3d';
import type {AssetRecord} from '@rewrite/assets';
import {authoring3dDefinitions,Primitive3DSchema,primitive3dDefinition,sprite3dDefinition} from './contracts';
import {model3dDefinition} from './model-contracts';
import {Authoring3D} from './model';
import {Scene3DProjection} from './projection';
import {runtime3DProblems} from './preflight';
import {edgeIndices,primitiveShapes} from './shapes';
const defs=()=>new Map([transformDefinition,transform3dDefinition,viewport3dDefinition,model3dDefinition,...authoring3dDefinitions].map(d=>[d.type,d]));
function fixture(){const scene=new SceneService(defs),editor=new Authoring3D(scene,()=>{},()=>null,()=>true,()=>({x:480,y:270})),ids=editor.createView(),host=new Container(),errors:unknown[]=[];return{scene,editor,ids,host,errors,context:{node:(id:string)=>id===ids.viewId?host:undefined,changed(){},report(e:unknown){errors.push(e);}}};}
const edit=(f:ReturnType<typeof fixture>,data:object)=>f.scene.document.transact('Shape',s=>{Object.assign(s.entities.find(e=>e.name==='Cube')!.components.find(c=>c.type==='pixi3d.primitive')!.data as object,data);});
const mesh=(p:Scene3DProjection,id:string)=>p.slots[0].nodes.get(id)!.children.find(c=>c instanceof Mesh3D) as Mesh3D;
it('keeps old spheres at 32 × 16 segments and offers nine shapes',()=>{
 expect(primitiveShapes).toHaveLength(9);
 expect(Primitive3DSchema.parse({shape:'sphere',color:'#ffffff',roughness:.5,metallic:0})).toMatchObject({segments:32,draw:'surface',detail:1,knotP:2,knotQ:3});
 expect(()=>Primitive3DSchema.parse({shape:'teapot',color:'#ffffff',roughness:.5,metallic:0})).toThrow();
 const shown=(shape:string)=>primitive3dDefinition.fields.filter(f=>!f.visible||f.visible(Primitive3DSchema.parse({shape,color:'#ffffff',roughness:.5,metallic:0}) as never)).map(f=>f.key);
 expect(shown('cube')).not.toContain('segments');expect(shown('torusKnot')).toEqual(expect.arrayContaining(['segments','tube','knotP','knotQ']));expect(shown('cylinder')).toEqual(expect.arrayContaining(['radiusTop','openEnded']));expect(shown('icosahedron')).toContain('detail');
});
it('lists each triangle edge once for a wireframe',()=>{
 // Two triangles sharing the edge 1–2 have five edges, not six.
 expect(Array.from(edgeIndices([0,1,2,2,1,3]))).toEqual([0,1,1,2,2,0,1,3,3,2]);expect(edgeIndices([])).toHaveLength(0);
});
it('builds every shape at unit size, and wireframes and points from its vertices',async()=>{
 const f=fixture(),p=new Scene3DProjection(f.context);try{const id=f.scene.document.current.entities.find(e=>e.name==='Cube')!.id;
  for(const shape of primitiveShapes){edit(f,{shape});p.sync(f.scene.document.current);const b=mesh(p,id).geometry.bounds3D;
   expect(Math.max(b.max.x-b.min.x,b.max.y-b.min.y,b.max.z-b.min.z),shape).toBeLessThanOrEqual(1.0001);expect(Math.max(b.max.x-b.min.x,b.max.y-b.min.y),shape).toBeGreaterThan(.4);}
  edit(f,{shape:'capsule'});p.sync(f.scene.document.current);{const b=mesh(p,id).geometry.bounds3D;expect(b.max.y-b.min.y).toBeCloseTo(1,3);expect(b.max.x-b.min.x).toBeCloseTo(.5,3);}
  edit(f,{shape:'sphere',segments:12});p.sync(f.scene.document.current);expect(mesh(p,id).geometry).toBeInstanceOf(SphereGeometry);expect(mesh(p,id).geometry.vertexCount).toBe(13*7);
  edit(f,{shape:'cylinder',radiusTop:0,openEnded:true});p.sync(f.scene.document.current);expect(mesh(p,id).geometry).toBeInstanceOf(CylinderGeometry);
  edit(f,{shape:'torusKnot',knotP:3,knotQ:5});p.sync(f.scene.document.current);expect(mesh(p,id).geometry).toBeInstanceOf(TorusKnotGeometry);
  edit(f,{shape:'icosahedron',detail:0});p.sync(f.scene.document.current);const ico=mesh(p,id).geometry;expect(ico).toBeInstanceOf(IcosahedronGeometry);
  edit(f,{draw:'wireframe'});p.sync(f.scene.document.current);const wire=mesh(p,id).geometry;expect(wire.topology).toBe('line-list');expect(wire.indices.length).toBeGreaterThan(0);expect(wire.indices.length%2).toBe(0);
  edit(f,{draw:'points'});p.sync(f.scene.document.current);expect(mesh(p,id).geometry.topology).toBe('point-list');
  expect(f.errors).toEqual([]);
 }finally{await p.dispose();f.host.destroy();}
});
it('creates a Sprite 3D that faces the camera, sizes it from its image and checks the image before export',async()=>{
 const f=fixture(),p=new Scene3DProjection(f.context,{get:(id:string)=>id==='tree'?({id,type:'pixi.texture',metadata:{width:64,height:64}}) as unknown as AssetRecord:undefined,url:(a:AssetRecord,file:string)=>`asset://${a.id}/${file}`});
 try{const id=f.editor.create('sprite3d',f.ids.viewId).id;expect(f.scene.document.current.entities.find(e=>e.id===id)!.name).toBe('Sprite 3D');
  f.scene.document.transact('Sprite',s=>{Object.assign(s.entities.find(e=>e.id===id)!.components.find(c=>c.type==='pixi3d.sprite3d')!.data as object,{billboard:'cylindrical',pixelSize:.02,tint:'#ff8800',anchorY:0});});
  p.sync(f.scene.document.current);const sprite=p.slots[0].nodes.get(id)!.children.find(c=>c instanceof Sprite3D) as Sprite3D;
  expect({mode:sprite.billboardMode,size:sprite.pixelSize,tint:sprite.tint,ay:sprite.anchor.y}).toEqual({mode:'cylindrical',size:.02,tint:0xff8800,ay:0});
  expect(sprite3dDefinition.defaults()).toMatchObject({billboard:'spherical',alphaMode:'mask',pixelSize:.01,castShadow:false});
  const scene=f.scene.document.current;expect(runtime3DProblems(scene,()=>undefined)).toEqual([]);
  f.scene.document.transact('Image',s=>{(s.entities.find(e=>e.id===id)!.components.find(c=>c.type==='pixi3d.sprite3d')!.data as {texture:string}).texture='gone';});
  expect(runtime3DProblems(f.scene.document.current,()=>undefined).join()).toMatch(/sprite image is missing/);
 }finally{await p.dispose();f.host.destroy();}
});
