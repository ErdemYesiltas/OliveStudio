import {readFile,mkdir,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {parseBuffer} from 'music-metadata';
import type {BuildJob,BuildResult} from '@rewrite/assets/node';
import {AudioMetadataSchema} from './contracts';
export async function buildAudio(job:BuildJob):Promise<BuildResult>{
 const {asset}=job,extension=asset.source.extension;
 if(job.importerId!=='audio.files'||asset.type!=='audio.clip'||!['wav','mp3'].includes(extension))throw Error('Unsupported audio job');
 const bytes=await readFile(join(job.root,'sources',`${asset.id}-${asset.revision}.${extension}`));
 if(bytes.length!==asset.source.bytes||createHash('sha256').update(bytes).digest('hex')!==asset.revision)throw Error('Audio source checksum mismatch');
 // Metadata only, no cover/tag payloads and no transcoding in the first provider.
 const {format}=await parseBuffer(bytes,{mimeType:extension==='wav'?'audio/wav':'audio/mpeg',size:bytes.length},{duration:true,skipCovers:true});
 if(extension==='wav'&&(format.container!=='WAVE'||!format.codec?.startsWith('PCM')))throw Error('WAV requires PCM audio');
 if(extension==='mp3'&&(!format.container?.startsWith('MPEG')||!format.codec?.includes('Layer 3')))throw Error('MP3 requires MPEG Layer 3 audio');
 const metadata=AudioMetadataSchema.parse({format:extension,duration:format.duration,sampleRate:format.sampleRate,channels:format.numberOfChannels,codec:format.codec,processedBytes:bytes.length,pipeline:'audio-original-v1/music-metadata-12.5.0'});
 const directory=join(job.root,'cache',`${asset.id}-${asset.revision}`),name=`audio.${extension}`,temporary=join(directory,`.${randomUUID()}.tmp`);await mkdir(directory,{recursive:true});await writeFile(temporary,bytes);await rename(temporary,join(directory,name));
 return{metadata,files:[{name,mime:extension==='wav'?'audio/wav':'audio/mpeg'}]};
}
