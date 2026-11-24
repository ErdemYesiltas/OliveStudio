import {z} from 'zod';
import type {AssetImporter} from '@rewrite/assets';
import {environmentAssetType} from '@rewrite/scene3d';
export {environmentAssetType};
export const EnvironmentMetadataSchema=z.object({pipeline:z.literal('radiance-hdr-v1'),width:z.number().int().positive(),height:z.number().int().positive(),peak:z.number().finite().nonnegative()}).strict();
export const environmentImporter:AssetImporter&{id:string}={id:'pixi3d-editor.hdr',assetType:environmentAssetType,titleKey:'scene3d.importEnvironment',extensions:['hdr']};
