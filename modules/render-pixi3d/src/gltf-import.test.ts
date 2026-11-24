import {expect,it} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {NodeIO,type GLTF} from '@gltf-transform/core';
import {modelMatrix} from '../../../scripts/fixtures/model-matrix.mjs';
import {prepareModel,buildModel} from './model.node';
// A real textured GLB split into .gltf + .bin + .png, the way DCC tools export "glTF Separate".
async function separate(dir:string){
 const [uv]=await modelMatrix({kinds:['uv']}),io=new NodeIO(),doc=await io.readBinary(uv.bytes);
 doc.getRoot().listBuffers()[0].setURI('mesh.bin');doc.getRoot().listTextures()[0].setURI('textures/quadrants.png');
 const {json,resources}=await io.writeJSON(doc);await mkdir(join(dir,'textures'));
 for(const [uri,bytes] of Object.entries(resources))await writeFile(join(dir,uri),bytes);await writeFile(join(dir,'model.gltf'),JSON.stringify(json));return{json,glb:uv.bytes};
}
const variant=async(dir:string,edit:(json:GLTF.IGLTF)=>void,name='bad.gltf')=>{const json=JSON.parse(await readFile(join(dir,'model.gltf'),'utf8'));edit(json);await writeFile(join(dir,name),JSON.stringify(json));return join(dir,name);};
it('packs a separate .gltf with its .bin and texture into one GLB that the regular model build accepts',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'gltf-import-'));try{
  await separate(dir);const prepared=await prepareModel(join(dir,'model.gltf'));expect(prepared.extension).toBe('glb');expect(prepared.name).toBe('model');
  const root=join(dir,'session');await mkdir(join(root,'sources'),{recursive:true});const revision=createHash('sha256').update(prepared.bytes).digest('hex'),asset={id:'a',name:'model',type:'pixi3d.model',revision,source:{extension:'glb',bytes:prepared.bytes.length},metadata:{}};
  await writeFile(join(root,'sources',`a-${revision}.glb`),prepared.bytes);const built=await buildModel({root,importerId:'pixi3d-editor.glb',asset:asset as never});
  expect(built.metadata).toMatchObject({meshes:1,triangles:12,materials:[{index:0}]});const doc=await new NodeIO().readBinary(prepared.bytes);expect(doc.getRoot().listTextures()[0].getImage()?.length).toBeGreaterThan(0);
  const glb=await prepareModel(await (async()=>{const p=join(dir,'plain.glb');const [uv]=await modelMatrix({kinds:['uv']});await writeFile(p,uv.bytes);return p;})());expect(glb.extension).toBe('glb');
 }finally{await rm(dir,{recursive:true,force:true});}
});
it('refuses resources outside the model folder, URLs, absolute paths, symlinks, missing files and foreign data URIs',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'gltf-import-'));try{
  await separate(dir);await writeFile(join(tmpdir(),'outside-gltf.bin'),'x');
  const bad=async(edit:(j:GLTF.IGLTF)=>void)=>prepareModel(await variant(dir,edit));
  await expect(bad(j=>{j.buffers![0].uri='../outside-gltf.bin';})).rejects.toThrow(/escapes the model folder/);
  await expect(bad(j=>{j.buffers![0].uri='https://example.com/mesh.bin';})).rejects.toThrow(/relative file path/);
  await expect(bad(j=>{j.buffers![0].uri='/etc/hosts';})).rejects.toThrow(/relative file path|escapes/);
  await expect(bad(j=>{j.buffers![0].uri='missing.bin';})).rejects.toThrow();
  await expect(bad(j=>{j.images![0].uri='data:image/svg+xml;base64,PHN2Zy8+';})).rejects.toThrow(/PNG, JPEG, WebP or KTX2/);
  await symlink(join(dir,'mesh.bin'),join(dir,'link.bin'));await expect(bad(j=>{j.buffers![0].uri='link.bin';})).rejects.toThrow(/symlinks/);
  await expect(bad(j=>{j.asset.version='1.0';})).rejects.toThrow(/glTF 2.0/);
 }finally{await rm(dir,{recursive:true,force:true});await rm(join(tmpdir(),'outside-gltf.bin'),{force:true});}
});
