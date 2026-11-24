import {expect,it} from 'vitest';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {Container} from 'pixi.js';
import {Mesh3D} from '@pixi/3d';
import {Document,NodeIO} from '@gltf-transform/core';
import {SceneService,transformDefinition} from '@rewrite/scene';
import {transform3dDefinition,viewport3dDefinition} from '@rewrite/scene3d';
import {authoring3dDefinitions,Primitive3DSchema} from './contracts';
import {model3dDefinition,Model3DSchema} from './model-contracts';
import {Authoring3D} from './model';
import {Scene3DProjection} from './projection';
import {runtime3DProblems} from './preflight';
import {buildModel} from './model.node';
import {renderState} from './surface';
it('maps render state, two-sided surfaces drawing both faces',()=>{
 const d=Primitive3DSchema.parse({shape:'cube',color:'#ffffff',roughness:.5,metallic:0});expect([d.depthTest,d.depthWrite,d.cull,d.blend]).toEqual([true,true,'back','normal']);
 expect(renderState({...d,depthTest:false,depthWrite:false,cull:'front',blend:'add'})).toEqual({depthTest:false,depthMask:false,cullMode:'front',blendMode:'add'});
 expect(renderState({...d,cull:'front',doubleSided:true}).cullMode).toBe('none');
});
const defs=()=>new Map([transformDefinition,transform3dDefinition,viewport3dDefinition,model3dDefinition,...authoring3dDefinitions].map(d=>[d.type,d]));
it('sets a primitive material\'s render state',async()=>{
 const scene=new SceneService(defs),editor=new Authoring3D(scene,()=>{},()=>null,()=>true,()=>({x:480,y:270})),ids=editor.createView(),host=new Container();
 scene.document.transact('State',s=>{Object.assign(s.entities.find(e=>e.name==='Cube')!.components.find(c=>c.type==='pixi3d.primitive')!.data as object,{depthTest:false,depthWrite:false,cull:'front',blend:'add'});});
 const p=new Scene3DProjection({node:(id:string)=>id===ids.viewId?host:undefined,changed(){},report(e:unknown){throw e;}} as never);try{p.sync(scene.document.current);
  const cube=scene.document.current.entities.find(e=>e.name==='Cube')!.id,mesh=p.slots[0].nodes.get(cube)!.children.find(c=>c instanceof Mesh3D) as Mesh3D,st=mesh.material.state;
  expect([st.depthTest,st.depthMask,st.cullMode,st.blendMode]).toEqual([false,false,'front','add']);
 }finally{await p.dispose();host.destroy();}
});
it('lists a glTF file\'s named scenes and checks the chosen one',async()=>{
 const doc=new Document(),buffer=doc.createBuffer(),acc=(type:'VEC3'|'SCALAR',arr:Float32Array|Uint16Array)=>doc.createAccessor().setType(type).setArray(arr).setBuffer(buffer);
 const mesh=doc.createMesh('Tri').addPrimitive(doc.createPrimitive().setAttribute('POSITION',acc('VEC3',new Float32Array([0,0,0,1,0,0,0,1,0]))).setIndices(acc('SCALAR',new Uint16Array([0,1,2]))));
 doc.createScene('Day').addChild(doc.createNode('Sun').setMesh(mesh));doc.createScene('Night').addChild(doc.createNode('Moon').setMesh(mesh));
 const bytes=Buffer.from(await new NodeIO().writeBinary(doc)),dir=await mkdtemp(join(tmpdir(),'scenes-'));try{await mkdir(join(dir,'sources'));const revision=createHash('sha256').update(bytes).digest('hex');await writeFile(join(dir,'sources',`a-${revision}.glb`),bytes);
  const built=await buildModel({root:dir,importerId:'pixi3d-editor.glb',asset:{id:'a',name:'m',type:'pixi3d.model',revision,source:{extension:'glb',bytes:bytes.length},metadata:{}} as never});
  expect((built.metadata as {scenes:string[]}).scenes).toEqual(['Day','Night']);
  expect(Model3DSchema.parse({assetId:'a',overrideMaterial:false,color:'#ffffff',roughness:.5,metallic:0}).scene).toBe('');
  const sv=new SceneService(defs),ed=new Authoring3D(sv,()=>{},()=>null,()=>true,()=>({x:480,y:270})),view=ed.createView().viewId;
  sv.document.transact('Model',s=>{s.entities.push({id:'m',name:'Lamp',parentId:view,active:true,spatial:'scene3d.transform',components:[{id:'t',type:'scene3d.transform',version:1,data:{x:0,y:0,z:0,qx:0,qy:0,qz:0,qw:1,scaleX:1,scaleY:1,scaleZ:1}},{id:'r',type:'pixi3d.modelRenderer',version:1,data:{assetId:'a',overrideMaterial:false,color:'#ffffff',roughness:.5,metallic:0,materialSlots:[],scene:''}}]} as never);});
  const problems=(name:string)=>{sv.document.transact('Scene',s=>{(s.entities.find(e=>e.id==='m')!.components[1].data as {scene:string}).scene=name;});return runtime3DProblems(sv.document.current,()=>({id:'a',type:'pixi3d.model',revision,metadata:built.metadata}) as never).join();};
  expect(problems('Night')).not.toContain('no scene');expect(problems('Noon')).toContain('the model has no scene "Noon" (it has Day, Night)');
 }finally{await rm(dir,{recursive:true,force:true});}
});
