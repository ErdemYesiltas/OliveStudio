import {z} from 'zod';
import type {AssetImporter} from '@rewrite/assets';
// Video clips a 3D surface plays as a texture. Pure contracts: no DOM, no node.
export const videoAssetType='media.video',videoFormats=['mp4','webm'] as const;
export const videoImporter:AssetImporter&{id:string}={id:'pixi3d-editor.video',assetType:videoAssetType,titleKey:'scene3d.importVideo',extensions:videoFormats};
export const VideoMetadataSchema=z.object({format:z.enum(videoFormats),duration:z.number().positive().max(3600).optional(),width:z.number().int().positive().max(8192).optional(),height:z.number().int().positive().max(8192).optional(),processedBytes:z.number().int().positive(),pipeline:z.string().min(1)}).strict();
export type VideoMetadata=z.infer<typeof VideoMetadataSchema>;
/** The file a video asset serves and exports, kept in its original container. */
export const videoFile=(m:Pick<VideoMetadata,'format'>)=>`video.${m.format}`;
/** Whether the first bytes are an MP4 (`ftyp` box) or WebM (EBML header) container. */
export function videoContainer(bytes:Uint8Array):'mp4'|'webm'|undefined{
 if(bytes.length>=12&&bytes[4]===0x66&&bytes[5]===0x74&&bytes[6]===0x79&&bytes[7]===0x70)return'mp4';
 if(bytes.length>=4&&bytes[0]===0x1a&&bytes[1]===0x45&&bytes[2]===0xdf&&bytes[3]===0xa3)return'webm';
 return undefined;}
