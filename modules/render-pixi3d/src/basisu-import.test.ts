import {expect,it} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {NodeIO} from '@gltf-transform/core';
import {KHRTextureBasisu} from '@gltf-transform/extensions';
import {modelMatrix} from '../../../scripts/fixtures/model-matrix.mjs';
import {prepareModel,buildModel,ktx2ToPng} from './model.node';
const basisu=join(dirname(createRequire(import.meta.url).resolve('@gpu-tex-enc/basis/package.json')),'bin',`${process.platform}-${process.arch}`,'basisu');
// Quadrants red/green/blue/yellow; the blue one is half transparent.
const quadrants=()=>{const w=32,h=32,px=Buffer.alloc(w*h*4);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const q=(y<16?0:2)+(x<16?0:1),c=[[255,40,40,255],[40,230,60,255],[40,90,255,128],[255,225,35,255]][q];px.set(c,(y*w+x)*4);}return sharp(px,{raw:{width:w,height:h,channels:4}}).png().toBuffer();};
async function encode(dir:string,mode:'uastc'|'etc1s'){await writeFile(join(dir,'q.png'),await quadrants());execFileSync(basisu,['-ktx2',...mode==='uastc'?['-uastc']:[],'q.png','-output_file',`q-${mode}.ktx2`],{cwd:dir,stdio:'ignore'});return readFile(join(dir,`q-${mode}.ktx2`));}
const sample=async(png:Uint8Array)=>{const {data,info}=await sharp(png).ensureAlpha().raw().toBuffer({resolveWithObject:true});const at=(x:number,y:number)=>Array.from(data.subarray((y*info.width+x)*4,(y*info.width+x)*4+4));return{w:info.width,h:info.height,tl:at(4,4),tr:at(27,4),bl:at(4,27),br:at(27,27)};};
const close=(a:number[],b:number[],tol:number)=>a.forEach((v,i)=>expect(Math.abs(v-b[i])).toBeLessThanOrEqual(tol));
it('transcodes UASTC and ETC1S KTX2 to PNG, keeping size, colours and alpha',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'basisu-'));try{
  for(const [mode,tol] of [['uastc',6],['etc1s',24]] as const){const s=await sample(await ktx2ToPng(await encode(dir,mode)));expect([s.w,s.h]).toEqual([32,32]);close(s.tl,[255,40,40,255],tol);close(s.tr,[40,230,60,255],tol);close(s.bl,[40,90,255,128],tol);close(s.br,[255,225,35,255],tol);}
  await expect(ktx2ToPng(new Uint8Array([1,2,3,4,5,6,7,8,9,10,11,12,13]))).rejects.toThrow(/not a KTX2 file/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
it('imports a KHR_texture_basisu model (.glb and .gltf) as a plain PNG-textured GLB the model build accepts',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'basisu-'));try{
  const ktx2=await encode(dir,'uastc'),[uv]=await modelMatrix({kinds:['uv']}),io=new NodeIO().registerExtensions([KHRTextureBasisu]),doc=await io.readBinary(uv.bytes);
  doc.createExtension(KHRTextureBasisu).setRequired(true);doc.getRoot().listTextures()[0].setImage(new Uint8Array(ktx2)).setMimeType('image/ktx2');
  const glb=await io.writeBinary(doc),head=Buffer.from(glb);expect(JSON.parse(head.subarray(20,20+head.readUInt32LE(12)).toString()).extensionsRequired).toContain('KHR_texture_basisu');
  await writeFile(join(dir,'m.glb'),glb);const prepared=await prepareModel(join(dir,'m.glb')),out=await new NodeIO().readBinary(prepared.bytes),texture=out.getRoot().listTextures()[0];
  expect(texture.getMimeType()).toBe('image/png');expect(out.getRoot().listExtensionsUsed().map(e=>e.extensionName)).not.toContain('KHR_texture_basisu');const s=await sample(texture.getImage()!);close(s.tl,[255,40,40,255],6);
  const root=join(dir,'session');await mkdir(join(root,'sources'),{recursive:true});const revision=createHash('sha256').update(prepared.bytes).digest('hex');await writeFile(join(root,'sources',`a-${revision}.glb`),prepared.bytes);
  const built=await buildModel({root,importerId:'pixi3d-editor.glb',asset:{id:'a',name:'m',type:'pixi3d.model',revision,source:{extension:'glb',bytes:prepared.bytes.length},metadata:{}} as never});expect((built.metadata as {capabilities:{textures:unknown[]}}).capabilities.textures).toEqual([{width:32,height:32,format:'png'}]);
  doc.getRoot().listBuffers()[0].setURI('m.bin');doc.getRoot().listTextures()[0].setURI('tex.ktx2');const {json,resources}=await io.writeJSON(doc);for(const [uri,b] of Object.entries(resources))await writeFile(join(dir,uri),b);await writeFile(join(dir,'m.gltf'),JSON.stringify(json));
  expect((await new NodeIO().readBinary((await prepareModel(join(dir,'m.gltf'))).bytes)).getRoot().listTextures()[0].getMimeType()).toBe('image/png');
 }finally{await rm(dir,{recursive:true,force:true});}
});
