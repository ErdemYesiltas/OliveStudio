import {describe,expect,it} from 'vitest';
import {Container,Loader} from 'pixi.js';
import {BatchedMesh3D,Material3D,Mesh3D,loadGlb,Ray,Vector3,createHitResult3D,srgbToLinear} from '@pixi/3d';
import {SceneService,transformDefinition,parseScene} from '@rewrite/scene';
import {transform3dDefinition,viewport3dDefinition} from '@rewrite/scene3d';
import {authoring3dDefinitions,instances3dDefinition} from './contracts';
import {model3dDefinition,modelAssetType} from './model-contracts';
import {Authoring3D} from './model';
import {Scene3DProjection} from './projection';
import {Instances3DSchema,instances3dDefaults,instanceLayout,instanceCount,instanceColors,InstancesHitVolume,type Instances3D} from './instances3d';
import {runtime3DProblems} from './preflight';
const data=(over:Partial<Instances3D>={}):Instances3D=>Instances3DSchema.parse({...instances3dDefaults(),...over});
const defs=()=>new Map([transformDefinition,transform3dDefinition,viewport3dDefinition,model3dDefinition,...authoring3dDefinitions].map(d=>[d.type,d]));
function fixture(){const scene=new SceneService(defs),editor=new Authoring3D(scene,()=>{},()=>null,()=>true,()=>({x:480,y:270})),ids=editor.createView(),host=new Container(),errors:unknown[]=[];return{scene,editor,ids,host,errors,context:{node:(id:string)=>id===ids.viewId?host:undefined,changed(){},report(e:unknown){errors.push(e);}}};}
const ray=(o:[number,number,number],d:[number,number,number])=>{const n=Math.hypot(...d);return new Ray(new Vector3(...o),new Vector3(d[0]/n,d[1]/n,d[2]/n));};
it('lays copies out deterministically and centred, within the copy limit',()=>{
 const grid=instanceLayout(data({columns:3,rows:2,layers:1,spacing:2}));expect(grid.length).toBe(30);
 expect([grid[0],grid[2]]).toEqual([-2,-1]);expect([grid[25],grid[27]]).toEqual([2,1]);
 const a=data({layout:'scatter',count:500,areaWidth:8,areaDepth:4,yawRandom:90,scaleRandom:.5,seed:7});expect(instanceLayout(a)).toEqual(instanceLayout(a));
 const l=instanceLayout(a);for(let i=0;i<l.length;i+=5){expect(Math.abs(l[i])).toBeLessThanOrEqual(4);expect(Math.abs(l[i+2])).toBeLessThanOrEqual(2);expect(Math.abs(l[i+3])).toBeLessThanOrEqual(Math.PI/2);expect(l[i+4]).toBeGreaterThanOrEqual(.5-1e-6);}
 expect(instanceLayout({...a,seed:8})).not.toEqual(l);
 expect(instances3dDefinition.parse(instances3dDefinition.defaults())).toEqual(instances3dDefaults());expect(instanceCount(instances3dDefaults())).toBe(100);
 expect(()=>data({columns:200,rows:200,layers:1})).toThrow(/at most 20000/);
});
it('picks the nearest copy through its own box or sphere, and misses the gaps',()=>{
 const layout=instanceLayout(data({columns:3,rows:1,spacing:2})),cubes=new InstancesHitVolume(layout,'box'),out=createHitResult3D();
 expect(cubes.raycast(ray([2,0,10],[0,0,-1]),out)).toBeCloseTo(9.5,6);expect(cubes.lastIndex).toBe(2);expect(out.point.z).toBeCloseTo(.5,6);
 expect(cubes.raycast(ray([1,0,10],[0,0,-1]),out)).toBe(-1);
 expect(cubes.raycast(ray([10,0,0],[-1,0,0]),out)).toBeCloseTo(7.5,6);expect(cubes.lastIndex).toBe(2);
 // A cube corner is inside the bounding sphere but outside a sphere copy.
 expect(cubes.raycast(ray([.45,.45,10],[0,0,-1]),out)).toBeGreaterThan(0);expect(new InstancesHitVolume(layout,'sphere').raycast(ray([.45,.45,10],[0,0,-1]),out)).toBe(-1);
 const turned=new InstancesHitVolume(instanceLayout(data({columns:1,rows:1,yawRandom:180,seed:3})),'box');expect(turned.raycast(ray([0,0,10],[0,0,-1]),out)).toBeGreaterThan(9);
});
it('projects one batch per component, pickable as its entity, with shared geometry and material',async()=>{
 const f=fixture(),p=new Scene3DProjection(f.context);try{
  const {id}=f.editor.create('instances',f.ids.viewId);p.sync(f.scene.document.current);
  const node=p.slots[0].nodes.get(id)!,batch=node.children.find(c=>c instanceof BatchedMesh3D) as BatchedMesh3D;
  expect(batch.size).toBe(100);expect(batch.eventMode).toBe('static');expect(batch.hitVolume).toBeInstanceOf(InstancesHitVolume);
  expect(p.slots[0].resources.length).toBeGreaterThanOrEqual(2);
  f.scene.document.transact('Shadow off',s=>{Object.assign(s.entities.find(e=>e.id===id)!.components.find(c=>c.type==='pixi3d.instances')!.data as object,{receiveShadow:false,layout:'scatter',count:42});});
  p.sync(f.scene.document.current);const next=p.slots[0].nodes.get(id)!.children.find(c=>c instanceof BatchedMesh3D) as BatchedMesh3D;
  expect(next.size).toBe(42);expect(next.items.every(i=>!i.receiveShadow)).toBe(true);expect(batch.destroyed).toBe(true);
  expect(runtime3DProblems(parseScene(f.scene.document.current,defs()))).toEqual([]);expect(f.errors).toEqual([]);
 }finally{await p.dispose();f.host.destroy();}
});
it('colours copies by a seeded mix or a gradient, and keeps older data single-coloured',()=>{
 const {colorMode:_a,color2:_b,gradientAxis:_c,...old}=instances3dDefaults();const single=Instances3DSchema.parse(old);expect(single.colorMode).toBe('single');expect(instanceColors(single,instanceLayout(single))).toBeNull();
 const random=data({colorMode:'random',color:'#000000',color2:'#ff8040',layout:'scatter',count:300}),r=instanceColors(random,instanceLayout(random))!;expect(r).toEqual(instanceColors(random,instanceLayout(random)));
 let spread=0;for(let i=0;i<300;i++){const k=r[i*3]/1;expect(r[i*3+1]).toBeCloseTo(k*128/255,5);expect(r[i*3+2]).toBeCloseTo(k*64/255,5);spread=Math.max(spread,k);}expect(spread).toBeGreaterThan(.9);
 const gradient=data({colorMode:'gradient',color:'#ff0000',color2:'#0000ff',columns:5,rows:2,spacing:1}),g=instanceColors(gradient,instanceLayout(gradient))!;
 expect([...g.slice(0,3)]).toEqual([1,0,0]);expect([...g.slice(12,15)]).toEqual([0,0,1]);expect(g[2*3]).toBeCloseTo(.5,6);
 const vertical=instanceColors({...gradient,gradientAxis:'y'},instanceLayout(gradient))!;expect([...vertical.slice(0,3)]).toEqual([1,0,0]);
});
it('writes linear-light tints into the batch and multiplies a white material by them',async()=>{
 const f=fixture(),p=new Scene3DProjection(f.context);try{
  const {id}=f.editor.create('instances',f.ids.viewId);f.scene.document.transact('Colours',s=>{Object.assign(s.entities.find(e=>e.id===id)!.components.find(c=>c.type==='pixi3d.instances')!.data as object,{colorMode:'gradient',color:'#ff8000',color2:'#0080ff',columns:4,rows:1});});
  p.sync(f.scene.document.current);const batch=p.slots[0].nodes.get(id)!.children.find(c=>c instanceof BatchedMesh3D) as BatchedMesh3D;
  const {data:values,offset,fields}=batch.instanceData,o=offset+fields.tint;expect([values[o],values[o+1],values[o+2],values[o+3]].map(v=>+v.toFixed(5))).toEqual([1,srgbToLinear(128/255),0,1].map(v=>+v.toFixed(5)));
  const last=o+3*batch.instanceData.stride;expect(values[last]).toBeCloseTo(0,6);expect(values[last+2]).toBeCloseTo(1,6);
  const material=p.slots[0].resources.find(r=>r instanceof Material3D) as Material3D;expect(material.extraBits.map(b=>b.name)).toEqual(['instance-tint']);expect(Array.from(material.data.baseColor.slice(0,3))).toEqual([1,1,1]);
  expect(f.errors).toEqual([]);
 }finally{await p.dispose();f.host.destroy();}
});
describe('GLB-sourced instances',()=>{
 /** Two meshes, the second nested under a rotated, non-uniformly scaled parent, each with its own material. */
 async function nestedGlb(){
  const {Document,NodeIO}=await import('@gltf-transform/core'),doc=new Document(),buffer=doc.createBuffer();
  const box=(name:string,color:[number,number,number,number])=>{const p=[-.5,-.5,-.5,.5,-.5,-.5,.5,.5,-.5,-.5,.5,-.5,-.5,-.5,.5,.5,-.5,.5,.5,.5,.5,-.5,.5,.5],ix=[0,2,1,0,3,2,4,5,6,4,6,7,0,1,5,0,5,4,3,7,6,3,6,2,1,2,6,1,6,5,0,4,7,0,7,3];
   const prim=doc.createPrimitive().setAttribute('POSITION',doc.createAccessor().setType('VEC3').setArray(new Float32Array(p)).setBuffer(buffer)).setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(ix)).setBuffer(buffer)).setMaterial(doc.createMaterial(name).setBaseColorFactor(color));
   return doc.createMesh(name).addPrimitive(prim);};
  const child=doc.createNode('child').setMesh(box('B',[.2,.4,1,1])).setTranslation([0,1.5,0]).setRotation([0,0,Math.SQRT1_2,Math.SQRT1_2]).setScale([1,.5,2]);
  const parent=doc.createNode('parent').setMesh(box('A',[1,.3,.2,1])).setTranslation([1,0,-1]).setRotation([0,Math.sin(.3),0,Math.cos(.3)]).setScale([2,1,1]).addChild(child);
  doc.createScene('main').addChild(parent);
  return 'data:model/gltf-binary;base64,'+Buffer.from(await new NodeIO().writeBinary(doc)).toString('base64');
 }
 const modelAsset=(url:string)=>({id:'0c1f6c4e-6f63-4b3f-9a52-7f0e5f0b9b11',name:'Nested',type:modelAssetType,revision:'b'.repeat(64),source:{extension:'glb',bytes:1},metadata:{pipeline:'gltf-transform-4.5.1/glb-v1',nodes:2,meshes:2,triangles:24,vertices:16,materials:[{index:0,name:'A'},{index:1,name:'B'}],animations:[],bounds:{min:[-1,-1,-1],max:[1,1,1]},warnings:[]},url});
 const backend={load:(url:string)=>loadGlb.load(url,undefined,new Loader()),unload:async(_url:string,source:import('@pixi/3d').Scene3DSource)=>source.destroy()};
 const setInstances=(f:ReturnType<typeof fixture>,id:string,over:Partial<Instances3D>)=>f.scene.document.transact('Instances',s=>{Object.assign(s.entities.find(e=>e.id===id)!.components.find(c=>c.type==='pixi3d.instances')!.data as object,over);});
 it('places every model part exactly where a Model renderer draws it, sharing the source geometry and materials',async()=>{
  const f=fixture(),a=modelAsset(await nestedGlb()),p=new Scene3DProjection(f.context,{get:()=>a,url:()=>a.url},backend);try{
   const reference=f.editor.placeModel(a,f.ids.viewId).id,{id}=f.editor.create('instances',f.ids.viewId);setInstances(f,id,{source:'model',assetId:a.id,columns:3,rows:1,spacing:4});
   p.sync(f.scene.document.current);await p.ready();const slot=p.slots[0],model=slot.models.get(reference)!.instance!,meshes:Mesh3D[]=[];model.traverse(c=>{if(c instanceof Mesh3D)meshes.push(c);});expect(meshes).toHaveLength(2);
   const batch=slot.nodes.get(id)!.children.find(c=>c instanceof BatchedMesh3D) as BatchedMesh3D;expect(batch.size).toBe(6);
   const {data:m,stride,offset}=batch.matrices;
   meshes.forEach((mesh,j)=>{const world=mesh.getGlobalTransform().elements;for(const copy of [0,1,2]){const o=offset+(copy*2+j)*stride,dx=(copy-1)*4;
    for(let k=0;k<16;k++)expect(m[o+k]).toBeCloseTo(world[k]+(k===12?dx:0),5);}});
   expect(p.slots[0].resources.some(r=>r===meshes[0].material||r===meshes[0].geometry)).toBe(false);
   expect(batch.hitVolume).toBeInstanceOf(InstancesHitVolume);expect(f.errors).toEqual([]);
  }finally{await p.dispose();f.host.destroy();}
 });
 it('tints model parts through material clones and releases its source with the projection',async()=>{
  const f=fixture(),a=modelAsset(await nestedGlb()),p=new Scene3DProjection(f.context,{get:()=>a,url:()=>a.url},backend);
  const {id}=f.editor.create('instances',f.ids.viewId);setInstances(f,id,{source:'model',assetId:a.id,columns:2,rows:1,colorMode:'random'});
  p.sync(f.scene.document.current);await p.ready();const batch=p.slots[0].nodes.get(id)!.children.find(c=>c instanceof BatchedMesh3D) as BatchedMesh3D;expect(batch.size).toBe(4);
  const clones=p.slots[0].resources.filter(r=>r instanceof Material3D&&r.extraBits.some(b=>b.name==='instance-tint'));expect(clones).toHaveLength(2);
  expect(p.resources?.stats).toMatchObject({resources:1,refs:1});await p.dispose();expect(p.resources?.stats).toMatchObject({resources:0,refs:0});f.host.destroy();
 });
 it('fails readiness and preflight for a missing or unset model instead of drawing nothing',async()=>{
  const f=fixture(),p=new Scene3DProjection(f.context,{get:()=>undefined,url:()=>''},backend);try{
   const {id}=f.editor.create('instances',f.ids.viewId);setInstances(f,id,{source:'model',assetId:'missing-asset'});p.sync(f.scene.document.current);
   await expect(p.ready()).rejects.toThrow();expect(f.errors.length).toBeGreaterThan(0);
   expect(runtime3DProblems(parseScene(f.scene.document.current,defs()),()=>undefined).join('\n')).toMatch(/instances model asset is missing/);
   setInstances(f,id,{assetId:''});expect(runtime3DProblems(parseScene(f.scene.document.current,defs())).join('\n')).toMatch(/choose a GLB model/);
  }finally{await p.dispose();f.host.destroy();}
 });
});
it('keeps older instances unculled and passes the chosen culling to the batch',async()=>{
 const {cull:_c,...old}=instances3dDefaults();expect(Instances3DSchema.parse(old).cull).toBe('off');expect(()=>data({cull:'always' as never})).toThrow();
 const f=fixture(),p=new Scene3DProjection(f.context);try{
  const {id}=f.editor.create('instances',f.ids.viewId);p.sync(f.scene.document.current);
  const batch=()=>p.slots[0].nodes.get(id)!.children.find(c=>c instanceof BatchedMesh3D) as BatchedMesh3D;expect(batch().cull).toBe('off');
  for(const cull of ['gpu','cpu'] as const){f.scene.document.transact('Cull',s=>{Object.assign(s.entities.find(e=>e.id===id)!.components.find(c=>c.type==='pixi3d.instances')!.data as object,{cull});});p.sync(f.scene.document.current);expect(batch().cull).toBe(cull);}
 }finally{await p.dispose();f.host.destroy();}
});
