import {morphShape,morphFields} from './rig';
import {z} from 'zod';
import type {AssetImporter} from '@rewrite/assets';
import type {ComponentDefinition} from '@rewrite/sdk';
import {space3d} from '@rewrite/scene3d';
export const modelAssetType='pixi3d.model',modelComponentType='pixi3d.modelRenderer';
export const modelImporter:AssetImporter&{id:string}={id:'pixi3d-editor.glb',assetType:modelAssetType,titleKey:'scene3d.importModel',extensions:['glb','gltf']};
const point=z.tuple([z.number().finite(),z.number().finite(),z.number().finite()]);
export const ModelMetadataSchema=z.object({pipeline:z.literal('gltf-transform-4.5.1/glb-v1'),nodes:z.number().int().nonnegative(),meshes:z.number().int().nonnegative(),triangles:z.number().int().nonnegative(),vertices:z.number().int().nonnegative(),materials:z.array(z.object({index:z.number().int().nonnegative(),name:z.string()})),animations:z.array(z.object({name:z.string(),duration:z.number().finite().nonnegative()})),scenes:z.array(z.string()).optional(),bounds:z.object({min:point,max:point}),warnings:z.array(z.string()),
 /** Built by newer imports; older assets omit it. */
 capabilities:z.object({skins:z.number().int().nonnegative(),maxJoints:z.number().int().nonnegative(),jointInfluences:z.number().int().nonnegative(),morphTargets:z.number().int().nonnegative(),textures:z.array(z.object({width:z.number().int().positive(),height:z.number().int().positive(),format:z.string()})),texturePixels:z.number().int().nonnegative()}).strict().optional()}).strict();
export const MaterialValuesSchema=z.object({color:z.string().regex(/^#[0-9a-fA-F]{6}$/),roughness:z.number().finite().min(0).max(1),metallic:z.number().finite().min(0).max(1)}).strict();
export const MaterialSlotSchema=MaterialValuesSchema.extend({index:z.number().int().min(0).max(4095),sourceRevision:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export type MaterialValues=z.infer<typeof MaterialValuesSchema>;
export const Model3DSchema=MaterialValuesSchema.extend({assetId:z.string().max(128),overrideMaterial:z.boolean(),materialSlots:z.array(MaterialSlotSchema).max(128).default([]),castShadow:z.boolean().default(true),receiveShadow:z.boolean().default(true),scene:z.string().max(128).default(''),loaded:z.boolean().default(true),...morphShape}).strict().refine(v=>new Set(v.materialSlots.map(s=>s.index)).size===v.materialSlots.length,'Duplicate material slot override');

export const model3dDefinition:ComponentDefinition={type:modelComponentType,version:1,titleKey:'component.model3d',exclusiveGroup:'render.visual',defaults:()=>({assetId:'',overrideMaterial:false,color:'#ffffff',roughness:.5,metallic:0}),parse:v=>Model3DSchema.parse(v),get dataSchema(){return z.toJSONSchema(Model3DSchema);},supportedSpaces:[space3d],fields:[{key:'assetId',titleKey:'scene3d.modelAsset',kind:'asset',assetType:modelAssetType},{key:'overrideMaterial',titleKey:'scene3d.overrideMaterial',kind:'boolean'},{key:'color',titleKey:'field.color',kind:'color'},{key:'roughness',titleKey:'field.roughness',kind:'number'},{key:'metallic',titleKey:'field.metallic',kind:'number'},{key:'scene',titleKey:'field.gltfScene',kind:'string'},{key:'loaded',titleKey:'field.modelLoaded',kind:'boolean'},...morphFields]};
/** Bounded, read-only inspection of the actual instantiated glTF node transforms. Paths are model-local, not entity IDs. */
export const ModelPoseQuerySchema=z.object({entityId:z.string().min(1).max(128),offset:z.number().int().min(0).max(10000).default(0),limit:z.number().int().min(1).max(64).default(32)}).strict();
export type ModelPoseQuery=z.infer<typeof ModelPoseQuerySchema>;

/** One real mesh per call, with bounded bone paging; model-local indices are not entity IDs. */
export const ModelDeformationQuerySchema=z.object({entityId:z.string().min(1).max(128),meshIndex:z.number().int().min(0).max(10000).default(0),offset:z.number().int().min(0).max(10000).default(0),limit:z.number().int().min(1).max(32).default(16)}).strict();
