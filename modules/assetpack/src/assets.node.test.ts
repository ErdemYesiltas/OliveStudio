import { afterEach,beforeEach,expect,it } from 'vitest';
import { mkdtemp,rm,writeFile,readFile,mkdir,symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { AssetSession,sourceName,type AssetBuilder,type BuildResult } from '@rewrite/assets/node';
import { sectionKey,type AssetRecord } from '@rewrite/assets';
import { buildImage } from './build.node';
import { imageImporter } from './catalog';
let root:string;const sessions:AssetSession[]=[];
beforeEach(async()=>{root=await mkdtemp(join(tmpdir(),'rewrite-assets-test-'));});
afterEach(async()=>{for(const s of sessions.splice(0))await s.dispose();await rm(root,{recursive:true,force:true});});
async function session(build:AssetBuilder=(job)=>buildImage(job)){const s=await AssetSession.create(root,[imageImporter],build);sessions.push(s);return s;}
const project=(assets:AssetRecord[])=>({extensions:{[sectionKey]:{version:1,items:assets}}});
async function image(name:string,color='#e59b47',width=48,height=24){const path=join(root,name);await sharp({create:{width,height,channels:4,background:color}}).toFile(path);return path;}
it('processes PNG/JPEG/WebP with real AssetPack, preserves originals and reopens from sources alone',async()=>{
 const original=await image('test.png'),before=await readFile(original),s=await session(),assets=await s.importFiles([original],imageImporter.id),a=assets[0];
 expect(a.metadata).toMatchObject({width:48,height:24,pipeline:expect.stringContaining('assetpack')});expect(await readFile(original)).toEqual(before);
 const file=await s.read(a.id,a.revision,'image.webp');expect(file?.mime).toBe('image/webp');expect((await sharp(file!.bytes).metadata()).format).toBe('webp');expect(await s.read(a.id,a.revision,'../../private')).toBeNull();
 const target=join(root,'saved.pixieditor');expect(await s.persist(target,project(assets))).toEqual([]);expect(await readFile(join(target+'.assets','sources',sourceName(a)))).toEqual(before);
 await rm(original);const fresh=await session();await fresh.restore(target,project(assets));expect(fresh.warnings).toEqual([]);expect(await fresh.read(a.id,a.revision,'image.webp')).not.toBeNull();
 for(const name of ['other.jpg','other.webp']){const path=await image(name);const [asset]=await s.importFiles([path],imageImporter.id);expect(asset.metadata).toMatchObject({width:48,height:24});}
});
it('preserves GUID on reimport, keeps old revisions available for undo and preserves portable Save As',async()=>{
 const s=await session(),[a]=await s.importFiles([await image('a.png')],imageImporter.id),[b]=await s.importFiles([await image('b.png','#00aaff',60,30)],imageImporter.id,a);
 expect(b.id).toBe(a.id);expect(b.revision).not.toBe(a.revision);expect(await s.read(a.id,a.revision,'image.webp')).not.toBeNull();expect(await s.read(b.id,b.revision,'image.webp')).not.toBeNull();
 const copy=join(root,'copy.pixieditor');await s.persist(copy,project([b]));const fresh=await session();await fresh.restore(copy,project([b]));expect(fresh.warnings).toEqual([]);
});
it('rejects disguised files, reports missing/corrupt sources, and does not read symlinked sidecars',async()=>{
 const s=await session(),bad=join(root,'bad.png');await writeFile(bad,'not an image');await expect(s.importFiles([bad],imageImporter.id)).rejects.toThrow();
 const [a]=await s.importFiles([await image('a.png')],imageImporter.id),target=join(root,'project.pixieditor');await s.persist(target,project([a]));await writeFile(join(target+'.assets','sources',sourceName(a)),new Uint8Array(a.source.bytes));
 const corrupt=await session();await corrupt.restore(target,project([a]));expect(corrupt.warnings).toHaveLength(1);expect(await corrupt.read(a.id,a.revision,'image.webp')).toBeNull();
 const linked=join(root,'linked.pixieditor');await symlink(target+'.assets',linked+'.assets','dir');const blocked=await session();await blocked.restore(linked,project([a]));expect(blocked.warnings[0]).toContain('symbolic');
 const missing=await session();await missing.restore(join(root,'absent.pixieditor'),project([a]));expect(missing.warnings).toHaveLength(1);expect(await missing.persist(join(root,'missing-copy.pixieditor'),project([a]))).toHaveLength(1);
});
it('cancels pending processing without accepting late results and allows the next import',async()=>{
 let release!:(v:BuildResult)=>void;
 const s=await session(()=>new Promise(resolve=>{release=resolve;}));const file=await image('a.png');
 const work=s.importFiles([file],imageImporter.id);while(!release)await new Promise(r=>setTimeout(r,1));s.cancel();release({metadata:{},files:[]});await expect(work).rejects.toThrow('cancelled');
 const next=s.importFiles([file],imageImporter.id);const previous=release;while(release===previous)await new Promise(r=>setTimeout(r,1));release({metadata:{width:48,height:24},files:[]});expect(await next).toHaveLength(1);
});
it('refuses Save As into symlinked directories without touching outside files',async()=>{
 const s=await session(),[a]=await s.importFiles([await image('a.png')],imageImporter.id),outside=join(root,'outside');await mkdir(outside);const target=join(root,'unsafe.pixieditor');await symlink(outside,target+'.assets','dir');
 await expect(s.persist(target,project([a]))).rejects.toThrow('real directories');
});
