import { readFile,mkdir,mkdtemp,rm,writeFile,rename } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { type BuildJob,type BuildResult } from '@rewrite/assets/node';
import { TextureMetadataSchema } from '@rewrite/render-pixi/contracts';
export async function buildImage(job:BuildJob):Promise<BuildResult>{
 if(job.importerId!=='assetpack.images'||job.asset.type!=='pixi.texture')throw Error('Unknown image job');
 const asset=job.asset,source=join(job.root,'sources',`${asset.id}-${asset.revision}.${asset.source.extension}`),bytes=await readFile(source);
 if(bytes.length!==asset.source.bytes||createHash('sha256').update(bytes).digest('hex')!==asset.revision)throw Error('Source checksum mismatch');
 const image=sharp(bytes,{limitInputPixels:8192*8192,failOn:'error'}),meta=await image.metadata();
 const expected=asset.source.extension==='jpg'?'jpeg':asset.source.extension;
 if(meta.format!==expected||(meta.pages??1)>1||!meta.width||!meta.height||meta.width>8192||meta.height>8192)throw Error('Only static PNG, JPEG and WebP images up to 8192 × 8192 are supported');
 const jobRoot=await mkdtemp(join(job.root,'build-'));let pack:{stop():Promise<void>}|undefined;
 try{
  const input=join(jobRoot,'input'),output=join(jobRoot,'output');await mkdir(input);await image.rotate().png().toFile(join(input,'image.png'));
  const [{AssetPack},{compress},{pixiManifest}]=await Promise.all([import('@assetpack/core'),import('@assetpack/core/image'),import('@assetpack/core/manifest')]);
  const instance=new AssetPack({entry:input,output,cache:false,cacheLocation:join(jobRoot,'cache'),strict:true,logLevel:'error',pipes:[compress({png:'skip',jpg:'skip',webp:{lossless:true},avif:false}),pixiManifest({output:'manifest.json'})]});pack=instance;await instance.run();
  const result=await readFile(join(output,'image.webp')),metadata=await sharp(result).metadata(),target=join(job.root,'cache',`${asset.id}-${asset.revision}`);await mkdir(target,{recursive:true});
  const thumbnail=await sharp(result).resize(160,160,{fit:'inside',withoutEnlargement:true}).webp({lossless:true}).toBuffer();
  // Readers see complete files even while a cache rebuild replaces a revision.
  for(const [name,contents]of [['image.webp',result],['thumb.webp',thumbnail],['manifest.json',await readFile(join(output,'manifest.json'))]]as const){const temporary=join(jobRoot,name);await writeFile(temporary,contents);await rename(temporary,join(target,name));}
  return{metadata:TextureMetadataSchema.parse({width:metadata.width,height:metadata.height,processedBytes:result.length,pipeline:'assetpack-1.7.0/sharp-0.34.5/lossless-webp-v1'}),files:[{name:'image.webp',mime:'image/webp'},{name:'thumb.webp',mime:'image/webp'}]};
 }finally{await pack?.stop();await rm(jobRoot,{recursive:true,force:true});}
}
