import { z } from 'zod';
import { slot } from '@rewrite/sdk';
export const AssetSchema=z.object({id:z.uuid(),name:z.string().trim().min(1).max(120),type:z.string().regex(/^[a-z][a-z0-9.-]+$/),revision:z.string().regex(/^[a-f0-9]{64}$/),source:z.object({extension:z.string().regex(/^[a-z0-9]{1,12}$/),bytes:z.number().int().positive().max(20*1024*1024)}).strict(),metadata:z.json()}).strict();
export type AssetRecord=z.infer<typeof AssetSchema>;
export const RegistrySchema=z.object({version:z.literal(1),items:z.array(AssetSchema).max(2000)}).strict().superRefine((v,c)=>{if(new Set(v.items.map(a=>a.id)).size!==v.items.length)c.addIssue({code:'custom',message:'Duplicate asset ID'});});
export const sectionKey='assets.registry';
/** Files one import request may carry (file picker, native session and automation share it); larger lists are refused before any work. */
export const importFileLimit=16;
export const importLimitMessage=(count:number)=>`Import accepts 1 to ${importFileLimit} files per request (got ${count}); split the list into batches of ${importFileLimit}`;
export const ImportPathsSchema=z.array(z.string().min(1).max(4096)).min(1,importLimitMessage(0)).superRefine((v,c)=>{if(v.length>importFileLimit)c.addIssue({code:'too_big',maximum:importFileLimit,origin:'array',inclusive:true,message:importLimitMessage(v.length)});});
export interface AssetImporter { assetType:string;titleKey:string;extensions:readonly string[] }
export const assetImporters=slot<AssetImporter>('assets.importers');
export const AssetHealthSchema=z.object({assetId:z.uuid(),revision:z.string().regex(/^[a-f0-9]{64}$/),source:z.enum(['ready','missing','corrupt','unavailable']),cache:z.enum(['ready','missing','outdated','unsupported'])}).strict();
export type AssetHealth=z.infer<typeof AssetHealthSchema>;
export interface AssetPort {
 sessionId:string;
 import(importerId:string,replace?:AssetRecord):Promise<AssetRecord[]|null>;
 /** One dialog for every supported file type; each file goes to the importer of its extension. */
 importAny?():Promise<AssetRecord[]|null>;
 rebuild?(text:string):Promise<string[]>;
 inspect?(text:string,sessionId:string):Promise<AssetHealth[]>;
 cancel():Promise<void>;
}
export function assetUrl(sessionId:string,asset:AssetRecord,file='image.webp'):string{return `pixi-editor-asset://${sessionId}/${asset.id}/${asset.revision}/${file}`;}

/** Module-owned Library placement. The host passes screen/scene coordinates without creating an entity. */
export interface AssetPlacement{assetType:string;place(asset:AssetRecord,point?:{x:number;y:number}):unknown;thumbnailFile?:string;details?(asset:AssetRecord):readonly string[]}
export const assetPlacements=slot<AssetPlacement>('assets.placements');
