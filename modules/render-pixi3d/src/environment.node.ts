import {readFile,mkdir,mkdtemp,writeFile,rename,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import type {BuildJob,BuildResult} from '@rewrite/assets/node';
import {environmentImporter,EnvironmentMetadataSchema} from './environment-contracts';
/** Radiance header and pixels, as @pixi/3d's parser accepts them: FORMAT=32-bit_rle_rgbe, "-Y h +X w", RLE or flat scanlines. */
export function decodeRadiance(bytes:Uint8Array){
 let pos=0;const line=()=>{let end=pos;while(end<bytes.length&&bytes[end]!==10)end++;if(end>=bytes.length)throw Error('HDR header is truncated');const text=Buffer.from(bytes.subarray(pos,end)).toString('latin1');pos=end+1;return text;};
 const magic=line();if(!magic.startsWith('#?RADIANCE')&&!magic.startsWith('#?RGBE'))throw Error('Not a Radiance .hdr file');
 for(let l=line();l!=='';l=line())if(l.startsWith('FORMAT=')&&l!=='FORMAT=32-bit_rle_rgbe')throw Error('Only 32-bit_rle_rgbe HDR files are supported');
 const size=/^-Y (\d+) \+X (\d+)$/.exec(line());if(!size)throw Error('Only the standard "-Y <height> +X <width>" HDR orientation is supported');
 const height=Number(size[1]),width=Number(size[2]);if(width<1||height<1||width>8192||height>4096)throw Error('HDR panorama must be at most 8192×4096');
 const rgbe=new Uint8Array(width*height*4);
 for(let y=0;y<height;y++){const row=rgbe.subarray(y*width*4,(y+1)*width*4);
  if(width>=8&&width<0x8000&&bytes[pos]===2&&bytes[pos+1]===2&&((bytes[pos+2]<<8)|bytes[pos+3])===width){pos+=4;
   for(let c=0;c<4;c++)for(let x=0;x<width;){if(pos>=bytes.length)throw Error('HDR scanline is truncated');let n=bytes[pos++];
    if(n>128){n-=128;if(x+n>width)throw Error('HDR run overflows its scanline');const v=bytes[pos++];for(let k=0;k<n;k++)row[(x++)*4+c]=v;}
    else{if(!n||x+n>width||pos+n>bytes.length)throw Error('HDR run overflows its scanline');for(let k=0;k<n;k++)row[(x++)*4+c]=bytes[pos++];}}}
  else{if(pos+width*4>bytes.length)throw Error('HDR scanline is truncated');row.set(bytes.subarray(pos,pos+width*4));pos+=width*4;}
 }
 return{width,height,rgbe};
}
export async function buildEnvironment(job:BuildJob):Promise<BuildResult>{
 const {asset}=job;if(job.importerId!==environmentImporter.id||asset.type!==environmentImporter.assetType||asset.source.extension!=='hdr')throw Error('Unknown HDR environment job');
 const bytes=await readFile(join(job.root,'sources',`${asset.id}-${asset.revision}.hdr`));if(bytes.length!==asset.source.bytes||createHash('sha256').update(bytes).digest('hex')!==asset.revision)throw Error('HDR source checksum mismatch');
 const {width,height,rgbe}=decodeRadiance(bytes);let peak=0;const tw=Math.min(256,width),th=Math.max(1,Math.round(tw*height/width)),preview=Buffer.alloc(tw*th*3);
 for(let i=0;i<width*height;i++){const e=rgbe[i*4+3];if(e){const f=2**(e-136);peak=Math.max(peak,rgbe[i*4]*f,rgbe[i*4+1]*f,rgbe[i*4+2]*f);}}
 for(let y=0;y<th;y++)for(let x=0;x<tw;x++){const sx=Math.min(width-1,Math.floor(x*width/tw)),sy=Math.min(height-1,Math.floor(y*height/th)),i=(sy*width+sx)*4,e=rgbe[i+3],f=e?2**(e-136):0;
  // Reinhard then sRGB, only for the Library preview; the runtime reads the original HDR.
  for(let c=0;c<3;c++){const v=rgbe[i+c]*f,t=v/(1+v);preview[(y*tw+x)*3+c]=Math.round(255*(t<=.0031308?12.92*t:1.055*t**(1/2.4)-.055));}}
 const metadata=EnvironmentMetadataSchema.parse({pipeline:'radiance-hdr-v1',width,height,peak:+peak.toFixed(4)}),target=join(job.root,'cache',`${asset.id}-${asset.revision}`),temporary=await mkdtemp(join(job.root,'environment-build-'));
 try{await mkdir(target,{recursive:true});await writeFile(join(temporary,'environment.hdr'),bytes);await sharp(preview,{raw:{width:tw,height:th,channels:3}}).webp({quality:82}).toFile(join(temporary,'image.webp'));
  for(const name of ['environment.hdr','image.webp'])await rename(join(temporary,name),join(target,name));}finally{await rm(temporary,{recursive:true,force:true});}
 return{metadata,files:[{name:'environment.hdr',mime:'image/vnd.radiance'},{name:'image.webp',mime:'image/webp'}]};
}
