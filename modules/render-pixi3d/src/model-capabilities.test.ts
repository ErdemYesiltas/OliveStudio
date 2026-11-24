import {expect,it} from 'vitest';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {NodeIO} from '@gltf-transform/core';
import {modelMatrix} from '../../../scripts/fixtures/model-matrix.mjs';
import {buildModel} from './model.node';
import {ModelMetadataSchema} from './model-contracts';
const build=async(dir:string,bytes:Uint8Array)=>{const root=join(dir,Math.random().toString(36).slice(2));await mkdir(join(root,'sources'),{recursive:true});const revision=createHash('sha256').update(bytes).digest('hex');await writeFile(join(root,'sources',`a-${revision}.glb`),bytes);return ModelMetadataSchema.parse((await buildModel({root,importerId:'pixi3d-editor.glb',asset:{id:'a',name:'m',type:'pixi3d.model',revision,source:{extension:'glb',bytes:bytes.length},metadata:{}} as never})).metadata);};
it('records skin, morph and texture capabilities at import, and accepts older metadata without them',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'caps-'));try{
  const models=Object.fromEntries((await modelMatrix()).map(m=>[m.kind,m.bytes]));
  expect((await build(dir,models.uv)).capabilities).toEqual({skins:0,maxJoints:0,jointInfluences:0,morphTargets:0,textures:[{width:2,height:2,format:'png'}],texturePixels:4});
  expect((await build(dir,models.skin)).capabilities).toMatchObject({skins:1,maxJoints:2,jointInfluences:4,morphTargets:0,textures:[]});
  expect((await build(dir,models.morph)).capabilities).toMatchObject({skins:0,morphTargets:1});
  const legacy={pipeline:'gltf-transform-4.5.1/glb-v1',nodes:1,meshes:1,triangles:12,vertices:36,materials:[],animations:[],bounds:{min:[0,0,0],max:[1,1,1]},warnings:[]};expect(ModelMetadataSchema.parse(legacy).capabilities).toBeUndefined();
 }finally{await rm(dir,{recursive:true,force:true});}
});
it('adds advisory budget warnings without refusing the model',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'caps-'));try{
  const [skin]=await modelMatrix({kinds:['skin']}),io=new NodeIO(),doc=await io.readBinary(skin.bytes),s=doc.getRoot().listSkins()[0],scene=doc.getRoot().listScenes()[0];
  for(let i=0;i<300;i++){const n=doc.createNode('extra '+i);scene.addChild(n);s.addJoint(n);}
  const ibm=s.getInverseBindMatrices()!;ibm.setArray(new Float32Array(16*s.listJoints().length).map((_,i)=>i%5===0?1:0));
  const meta=await build(dir,await io.writeBinary(doc));expect(meta.capabilities?.maxJoints).toBe(302);expect(meta.warnings.join()).toMatch(/302 joints \(budget 256\)/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
