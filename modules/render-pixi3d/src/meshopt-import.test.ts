import {expect,it} from 'vitest';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {NodeIO} from '@gltf-transform/core';
import {EXTMeshoptCompression,KHRDracoMeshCompression} from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';
import {MeshoptEncoder} from 'meshoptimizer';
import {modelMatrix} from '../../../scripts/fixtures/model-matrix.mjs';
import {prepareModel,buildModel} from './model.node';
const positions=async(bytes:Uint8Array):Promise<number[]>=>Array.from((await new NodeIO().readBinary(bytes)).getRoot().listMeshes()[0].listPrimitives()[0].getAttribute('POSITION')!.getArray() as Float32Array);
async function compressed(){
 await MeshoptEncoder.ready;const [skin]=await modelMatrix({kinds:['skin']}),io=new NodeIO().registerExtensions([EXTMeshoptCompression]).registerDependencies({'meshopt.encoder':MeshoptEncoder}),doc=await io.readBinary(skin.bytes);
 doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({method:EXTMeshoptCompression.EncoderMethod.QUANTIZE});
 return{original:skin.bytes,bytes:await io.writeBinary(doc),io,doc};
}
it('decodes an EXT_meshopt_compression GLB at import into a plain GLB the model build accepts',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'meshopt-'));try{
  const {original,bytes}=await compressed(),json=JSON.parse(Buffer.from(bytes).subarray(20,20+Buffer.from(bytes).readUInt32LE(12)).toString());expect(json.extensionsRequired).toContain('EXT_meshopt_compression');
  await writeFile(join(dir,'skin.glb'),bytes);const prepared=await prepareModel(join(dir,'skin.glb')),out=Buffer.from(prepared.bytes),outJson=JSON.parse(out.subarray(20,20+out.readUInt32LE(12)).toString());
  expect(outJson.extensionsUsed??[]).not.toContain('EXT_meshopt_compression');
  const before=await positions(original),after=await positions(prepared.bytes);expect(after.length).toBe(before.length);after.forEach((v,i)=>expect(v).toBeCloseTo(before[i],5));
  const root=join(dir,'session');await mkdir(join(root,'sources'),{recursive:true});const revision=createHash('sha256').update(prepared.bytes).digest('hex');await writeFile(join(root,'sources',`a-${revision}.glb`),prepared.bytes);
  const built=await buildModel({root,importerId:'pixi3d-editor.glb',asset:{id:'a',name:'skin',type:'pixi3d.model',revision,source:{extension:'glb',bytes:prepared.bytes.length},metadata:{}} as never});expect(built.metadata).toMatchObject({meshes:1,triangles:12,animations:[{name:'Bend'}]});
 }finally{await rm(dir,{recursive:true,force:true});}
});
it('decodes meshopt in a separate .gltf too',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'meshopt-'));try{
  const {io,doc}=await compressed();doc.getRoot().listBuffers()[0].setURI('skin.bin');const {json,resources}=await io.writeJSON(doc);for(const [uri,b] of Object.entries(resources))await writeFile(join(dir,uri),b);await writeFile(join(dir,'skin.gltf'),JSON.stringify(json));
  const prepared=await prepareModel(join(dir,'skin.gltf'));expect((await positions(prepared.bytes)).length).toBe(108);
 }finally{await rm(dir,{recursive:true,force:true});}
});
const build=async(dir:string,bytes:Uint8Array)=>{const root=join(dir,'session-'+Math.random().toString(36).slice(2));await mkdir(join(root,'sources'),{recursive:true});const revision=createHash('sha256').update(bytes).digest('hex');await writeFile(join(root,'sources',`a-${revision}.glb`),bytes);return buildModel({root,importerId:'pixi3d-editor.glb',asset:{id:'a',name:'m',type:'pixi3d.model',revision,source:{extension:'glb',bytes:bytes.length},metadata:{}} as never});};
it('decodes KHR_draco_mesh_compression (.glb and .gltf) at import, keeping geometry, skin and animation',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'draco-'));try{
  const encoder=await draco3d.createEncoderModule(),[skin]=await modelMatrix({kinds:['skin']}),io=new NodeIO().registerExtensions([KHRDracoMeshCompression]).registerDependencies({'draco3d.encoder':encoder}),doc=await io.readBinary(skin.bytes);
  // Draco only encodes indexed primitives; the fixture's are not, so give them a trivial index list.
  for(const mesh of doc.getRoot().listMeshes())for(const primitive of mesh.listPrimitives())if(!primitive.getIndices()){const count=primitive.getAttribute('POSITION')!.getCount();primitive.setIndices(doc.createAccessor().setType('SCALAR').setArray(Uint16Array.from({length:count},(_,i)=>i)).setBuffer(doc.getRoot().listBuffers()[0]));}
  doc.createExtension(KHRDracoMeshCompression).setRequired(true).setEncoderOptions({method:KHRDracoMeshCompression.EncoderMethod.EDGEBREAKER,quantizationBits:{POSITION:14,NORMAL:10,TEX_COORD:12,COLOR:8,GENERIC:12}});
  const bytes=await io.writeBinary(doc),head=Buffer.from(bytes);expect(JSON.parse(head.subarray(20,20+head.readUInt32LE(12)).toString()).extensionsRequired).toContain('KHR_draco_mesh_compression');
  const original=await build(dir,skin.bytes);
  await writeFile(join(dir,'skin.glb'),bytes);const fromGlb=await prepareModel(join(dir,'skin.glb')),out=Buffer.from(fromGlb.bytes);expect(JSON.parse(out.subarray(20,20+out.readUInt32LE(12)).toString()).extensionsUsed??[]).not.toContain('KHR_draco_mesh_compression');
  const built=await build(dir,fromGlb.bytes) as unknown as {metadata:{triangles:number;animations:unknown;bounds:{min:number[];max:number[]}}},ref=original.metadata as unknown as typeof built.metadata;
  expect(built.metadata.triangles).toBe(ref.triangles);expect(built.metadata.animations).toEqual(ref.animations);built.metadata.bounds.min.forEach((v,i)=>expect(v).toBeCloseTo(ref.bounds.min[i],3));built.metadata.bounds.max.forEach((v,i)=>expect(v).toBeCloseTo(ref.bounds.max[i],3));
  const skinned=await new NodeIO().readBinary(fromGlb.bytes);expect(skinned.getRoot().listSkins()).toHaveLength(1);expect(skinned.getRoot().listMeshes()[0].listPrimitives()[0].getAttribute('JOINTS_0')).toBeTruthy();
  doc.getRoot().listBuffers()[0].setURI('skin.bin');const {json,resources}=await io.writeJSON(doc);for(const [uri,b] of Object.entries(resources))await writeFile(join(dir,uri),b);await writeFile(join(dir,'skin.gltf'),JSON.stringify(json));
  expect(((await build(dir,(await prepareModel(join(dir,'skin.gltf'))).bytes)).metadata as {triangles:number}).triangles).toBe(ref.triangles);
 }finally{await rm(dir,{recursive:true,force:true});}
});
it('still refuses KHR_meshopt_compression, which the import pipeline cannot decode',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'khr-meshopt-'));try{
  const [cube]=await modelMatrix({kinds:['uv']}),d=await new NodeIO().readBinary(cube.bytes),{json:j,resources:r}=await new NodeIO().writeJSON(d);j.extensionsUsed=['KHR_meshopt_compression'];j.extensionsRequired=['KHR_meshopt_compression'];
  for(const [uri,b] of Object.entries(r))await writeFile(join(dir,uri),b);await writeFile(join(dir,'k.gltf'),JSON.stringify(j));
  const packed=await prepareModel(join(dir,'k.gltf')).catch(e=>e as Error);if(packed instanceof Error){expect(packed.message).toMatch(/meshopt|extension/i);return;}
  await expect(build(dir,packed.bytes)).rejects.toThrow(/KHR_meshopt_compression requires an offline decoder/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
