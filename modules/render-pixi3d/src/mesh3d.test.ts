import {expect,it} from 'vitest';
import {Container} from 'pixi.js';
import {Mesh3D} from '@pixi/3d';
import {SceneService,transformDefinition} from '@rewrite/scene';
import {transform3dDefinition,viewport3dDefinition} from '@rewrite/scene3d';
import {authoring3dDefinitions} from './contracts';
import {model3dDefinition} from './model-contracts';
import {Authoring3D} from './model';
import {Scene3DProjection} from './projection';
import {buildScriptGeometry,mesh3dType,Mesh3DSchema,positionBounds,type ScriptGeometry} from './mesh3d';
const defs=()=>new Map([transformDefinition,transform3dDefinition,viewport3dDefinition,model3dDefinition,...authoring3dDefinitions].map(d=>[d.type,d]));
/** A quad (two triangles) facing +Z, with one morph target that lifts its top edge. */
const quad=(format:Partial<ScriptGeometry['format']>={}):ScriptGeometry=>({positions:new Float32Array([-.5,-.5,0,.5,-.5,0,.5,.5,0,-.5,.5,0]),normals:new Float32Array([0,0,1,0,0,1,0,0,1,0,0,1]),uvs:new Float32Array([0,0,1,0,1,1,0,1]),colors:new Float32Array([1,0,0,1,0,1,0,1,0,0,1,1,1,1,1,1]),indices:new Uint32Array([0,1,2,0,2,3]),
 morphTargets:[{positions:new Float32Array([0,0,0,0,0,0,0,.5,0,0,.5,0])}],format:{positions:'float32',normals:'float32',colors:'float32',...format},bytes:0});
it('builds GPU geometry from script data, packed or not, with bounds from the float positions',()=>{
 for(const format of [{},{positions:'snorm16' as const,normals:'snorm8' as const,colors:'unorm8' as const}]){const g=buildScriptGeometry(quad(format));
  expect(g.vertexCount).toBe(4);expect(g.morphTargetCount).toBe(1);expect([g.bounds3D.min.x,g.bounds3D.max.y]).toEqual([-.5,.5]);g.destroy();}
 expect(positionBounds(new Float32Array([1,2,3,-1,5,0])).max.y).toBe(5);
 expect(Mesh3DSchema.parse({})).toMatchObject({color:'#ffffff',vertexColors:false});
});
it('shows a stand-in until a script gives the Mesh 3D a shape, keeps it through a rebuild, blends morphs and resets with the session',()=>{
 const scene=new SceneService(defs),editor=new Authoring3D(scene,()=>{},()=>null,()=>true,()=>({x:480,y:270})),view=editor.createView().viewId,host=new Container();
 scene.document.transact('Mesh',s=>{s.entities.push({id:'m',name:'Shape',parentId:view,active:true,spatial:'scene3d.transform',components:[{id:'t',type:'scene3d.transform',version:1,data:{x:0,y:0,z:0,qx:0,qy:0,qz:0,qw:1,scaleX:1,scaleY:1,scaleZ:1}},{id:'r',type:mesh3dType,version:1,data:Mesh3DSchema.parse({vertexColors:true})}]} as never);});
 const p=new Scene3DProjection({node:(id:string)=>id===view?host:undefined,changed(){},report(e:unknown){throw e;}});
 const mesh=()=>p.slots[0].nodes.get('m')!.children.find(c=>c instanceof Mesh3D) as Mesh3D;
 try{p.sync(scene.document.current);expect(mesh().geometry.vertexCount).toBe(24);
  p.defineGeometry('g1',quad());p.setMeshGeometry('m','g1');p.setMorph('m',[.75]);expect(p.sync(scene.document.current)).toBe(false);
  expect(mesh().geometry.vertexCount).toBe(4);expect(Array.from(mesh().weights!)).toEqual([.75]);
  // A rebuild (an unrelated component changes) builds the shape again from the projection's copy.
  scene.document.transact('Rebuild',s=>{(s.entities.find(e=>e.id==='m')!.components[1].data as {color:string}).color='#ff0000';});
  expect(p.sync(scene.document.current)).toBe(true);expect(mesh().geometry.vertexCount).toBe(4);expect(Array.from(mesh().weights!)).toEqual([.75]);
  expect(p.meshInfo('m')).toEqual({geometryId:'g1',vertices:4,morphTargets:1});
  expect(()=>p.setMeshGeometry('m','missing')).toThrow('not known');
  p.resetPointers();p.sync(scene.document.current);expect(mesh().geometry.vertexCount).toBe(24);
 }finally{void p.dispose();}
});
it('draws a script-driven Particles 3D and a Batch 3D from the latest writes, through rebuilds, and clears them with the session',async()=>{
 const {Particles3DSchema,particles3dDefaults}=await import('./particles3d');const {ParticleContainer3D,BatchedMesh3D}=await import('@pixi/3d');
 const scene=new SceneService(defs),editor=new Authoring3D(scene,()=>{},()=>null,()=>true,()=>({x:480,y:270})),view=editor.createView().viewId,host=new Container();
 const t={x:0,y:0,z:0,qx:0,qy:0,qz:0,qw:1,scaleX:1,scaleY:1,scaleZ:1};
 scene.document.transact('Bulk',s=>{s.entities.push({id:'p',name:'Sparks',parentId:view,active:true,spatial:'scene3d.transform',components:[{id:'pt',type:'scene3d.transform',version:1,data:t},{id:'pc',type:'pixi3d.particles',version:1,data:Particles3DSchema.parse({...particles3dDefaults(),count:4,driver:'script'})}]} as never,
  {id:'b',name:'Clay',parentId:view,active:true,spatial:'scene3d.transform',components:[{id:'bt',type:'scene3d.transform',version:1,data:t},{id:'bc',type:'pixi3d.batch',version:1,data:{size:5,color:'#ffffff',roughness:.6,metallic:0,castShadow:true,receiveShadow:true}}]} as never);});
 const p=new Scene3DProjection({node:(id:string)=>id===view?host:undefined,changed(){},report(e:unknown){throw e;}});
 try{p.sync(scene.document.current);
  const container=()=>p.slots[0].nodes.get('p')!.children.find(c=>c instanceof ParticleContainer3D) as InstanceType<typeof ParticleContainer3D>;
  const spy:number[][]=[];const original=container().setParticleAt.bind(container());container().setParticleAt=((...a:number[])=>{spy.push(a);return original(...(a as Parameters<typeof original>));}) as typeof original;
  p.writeScriptParticles('p',new Float32Array([1,2,3,.5,1,0,0,.8, 4,5,6,.25,0,0,1,1]),2);p.setParticleTime(.1);
  // Index first; alpha comes back through Float32.
  expect(spy.slice(0,4).map(c=>c.map(v=>+v.toFixed(4)))).toEqual([[0,1,2,3,.5,0,0xff0000,.8,0],[1,4,5,6,.25,0,0x0000ff,1,0],[2,0,0,0,0],[3,0,0,0,0]]);
  p.defineGeometry('g1',quad());p.setBatchGeometries('b',['g1','']);p.writeBatch('b',new Float32Array([0,1,0,0,0,0,0,1,2,1,1,1, 1,0,0,0,0,0,0,1,1,1,0,0, 0,-1,0,0,0,0,0,1,1,0,1,0]),3);p.sync(scene.document.current);
  expect(p.batchInfo('b')).toEqual({size:5,visible:3,shapes:1});
  const batch=p.slots[0].nodes.get('b')!.children.find(c=>c instanceof BatchedMesh3D) as InstanceType<typeof BatchedMesh3D>,m=batch.matrices.data,o=batch.matrices.offset,st=batch.matrices.stride;
  expect([m[o+12],m[o+0]]).toEqual([1,2]);expect(m[o+st+12]).toBe(0);
  scene.document.transact('Rebuild',s=>{(s.entities.find(e=>e.id==='b')!.components[1].data as {color:string}).color='#ff0000';});p.sync(scene.document.current);
  expect(p.batchInfo('b')).toEqual({size:5,visible:3,shapes:1});
  p.writeBatch('b',new Float32Array(12),1);p.sync(scene.document.current);expect(p.batchInfo('b')!.visible).toBe(1);
  p.resetPointers();p.sync(scene.document.current);expect(p.batchInfo('b')!.visible).toBe(0);
 }finally{void p.dispose();}
});
