import { z } from 'zod';
import { slot } from '@rewrite/sdk';
export const AssetSchema=z.object({id:z.uuid(),name:z.string().trim().min(1).max(120),type:z.string().regex(/^[a-z][a-z0-9.-]+$/),revision:z.string().regex(/^[a-f0-9]{64}$/),source:z.object({extension:z.string().regex(/^[a-z0-9]{1,12}$/),bytes:z.number().int().positive().max(20*1024*1024)}).strict(),metadata:z.json()}).strict();
export type AssetRecord=z.infer<typeof AssetSchema>;
export const RegistrySchema=z.object({version:z.literal(1),items:z.array(AssetSchema).max(2000)}).strict().superRefine((v,c)=>{if(new Set(v.items.map(a=>a.id)).size!==v.items.length)c.addIssue({code:'custom',message:'Duplicate asset ID'});});
export const sectionKey='assets.registry';
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
