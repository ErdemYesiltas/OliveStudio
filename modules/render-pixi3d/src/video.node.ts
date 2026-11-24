import {readFile,mkdir,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {parseBuffer} from 'music-metadata';
import type {BuildJob,BuildResult} from '@rewrite/assets/node';
import {videoImporter,VideoMetadataSchema,videoContainer,videoFile} from './video-contracts';
/** Checks the container and keeps the clip as it is (no transcoding); duration and size come from the container when it states them. */
export async function buildVideo(job:BuildJob):Promise<BuildResult>{
 const {asset}=job,extension=asset.source.extension;
 if(job.importerId!==videoImporter.id||asset.type!==videoImporter.assetType||!['mp4','webm'].includes(extension))throw Error('Unsupported video job');
 const bytes=await readFile(join(job.root,'sources',`${asset.id}-${asset.revision}.${extension}`));
 if(bytes.length!==asset.source.bytes||createHash('sha256').update(bytes).digest('hex')!==asset.revision)throw Error('Video source checksum mismatch');
 const container=videoContainer(bytes);if(container!==extension)throw Error(`The file is not ${extension==='mp4'?'an MP4':'a WebM'} video`);
 const mime=extension==='mp4'?'video/mp4':'video/webm';let duration:number|undefined,width:number|undefined,height:number|undefined;
 try{const {format}=await parseBuffer(bytes,{mimeType:mime,size:bytes.length},{duration:true,skipCovers:true});if(format.duration&&format.duration>0)duration=format.duration;
  const track=format.trackInfo?.find(t=>t.video);if(track?.video?.pixelWidth&&track.video.pixelHeight){width=track.video.pixelWidth;height=track.video.pixelHeight;}}catch{/* An unreadable header leaves the optional fields out; the browser decides whether it plays. */}
 const metadata=VideoMetadataSchema.parse({format:extension,...duration?{duration:Math.min(duration,3600)}:{},...width&&height?{width,height}:{},processedBytes:bytes.length,pipeline:'video-original-v1'});
 const directory=join(job.root,'cache',`${asset.id}-${asset.revision}`),name=videoFile(metadata),temporary=join(directory,`.${randomUUID()}.tmp`);await mkdir(directory,{recursive:true});await writeFile(temporary,bytes);await rename(temporary,join(directory,name));
 return{metadata,files:[{name,mime}]};
}
