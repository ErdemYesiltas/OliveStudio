import {z} from 'zod';
export const spineImporter={id:'spine.json',assetType:'spine.skeleton',titleKey:'spine.import',extensions:['json']as const};
export const SpineSchema=z.object({assetId:z.uuid().or(z.literal('')),skin:z.string().max(120),animation:z.string().max(120),loop:z.boolean(),timeScale:z.number().min(0).max(4),alpha:z.number().min(0).max(1)}).strict();
export type SpineData=z.infer<typeof SpineSchema>;
export const SpineMetadataSchema=z.object({version:z.string().startsWith('4.2.'),animations:z.array(z.object({name:z.string(),duration:z.number().min(0)}).strict()).max(128),skins:z.array(z.string()).max(128),events:z.array(z.string()).max(256),pages:z.array(z.object({name:z.string(),file:z.string(),width:z.number().int().positive(),height:z.number().int().positive()}).strict()).min(1).max(8),bones:z.number().int().min(1).max(1024),pipeline:z.literal('spine-4.2.120-v1')}).strict();
export type SpineMetadata=z.infer<typeof SpineMetadataSchema>;
export interface SpineFrame{token:string;time:number;emit:boolean;silent:boolean}
export interface SpineEvent{kind:'event'|'complete';entityId:string;componentId:string;assetId:string;name:string;time:number;silent:boolean;intValue?:number;floatValue?:number;stringValue?:string}
