import {expect,it} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {videoContainer,videoImporter,videoFile,VideoMetadataSchema} from './video-contracts';
import {buildVideo} from './video.node';
const mp4=()=>{const b=Buffer.alloc(64);b.writeUInt32BE(24,0);b.write('ftypisom',4);b.writeUInt32BE(512,8);b.write('isomiso2',16);b.writeUInt32BE(8,24);b.write('free',28);return b;};
it('recognises MP4 and WebM containers by their first bytes and nothing else',()=>{
 expect(videoContainer(mp4())).toBe('mp4');expect(videoContainer(Uint8Array.from([0x1a,0x45,0xdf,0xa3,1,2]))).toBe('webm');
 expect(videoContainer(Buffer.from('GIF89a........'))).toBeUndefined();expect(videoContainer(new Uint8Array(2))).toBeUndefined();
 expect(videoImporter).toMatchObject({assetType:'media.video',extensions:['mp4','webm']});expect(videoFile({format:'webm'})).toBe('video.webm');
});
it('keeps an MP4 as it is, and refuses a file whose container does not match its extension',async()=>{
 const root=await mkdtemp(join(tmpdir(),'video-'));try{await mkdir(join(root,'sources'));const bytes=mp4(),revision=createHash('sha256').update(bytes).digest('hex'),id='0b1c2d3e-4f50-4a61-8b72-93a4b5c6d7e8';
  await writeFile(join(root,'sources',`${id}-${revision}.mp4`),bytes);
  const asset={id,name:'clip',type:'media.video',revision,source:{extension:'mp4',bytes:bytes.length},metadata:{}};
  const built=await buildVideo({root,importerId:videoImporter.id,asset} as never);
  expect(VideoMetadataSchema.parse(built.metadata)).toMatchObject({format:'mp4',processedBytes:64,pipeline:'video-original-v1'});expect(built.files).toEqual([{name:'video.mp4',mime:'video/mp4'}]);
  expect(Buffer.compare(await readFile(join(root,'cache',`${id}-${revision}`,'video.mp4')),bytes)).toBe(0);
  await writeFile(join(root,'sources',`${id}-${revision}.webm`),bytes);
  await expect(buildVideo({root,importerId:videoImporter.id,asset:{...asset,source:{extension:'webm',bytes:bytes.length}}} as never)).rejects.toThrow(/not a WebM/);
  await expect(buildVideo({root,importerId:'assetpack.images',asset} as never)).rejects.toThrow(/Unsupported/);
 }finally{await rm(root,{recursive:true,force:true});}
});
