import {z} from 'zod';
import type {ComponentDefinition} from '@rewrite/sdk';
// A picture on a flat quad in 3D, sized from its texture and optionally turned toward the camera. Pure: no pixi.
export const sprite3dType='pixi3d.sprite3d',billboardModes=['none','spherical','cylindrical'] as const;
const color=z.string().regex(/^#[0-9a-fA-F]{6}$/),number=z.number().finite();
export const Sprite3DSchema=z.object({
 texture:z.string().max(128).default(''),tint:color.default('#ffffff'),alpha:number.min(0).max(1).default(1),
 alphaMode:z.enum(['opaque','mask','blend']).default('mask'),alphaCutoff:number.min(0).max(1).default(.5),
 billboard:z.enum(billboardModes).default('spherical'),pixelSize:number.min(.0001).max(10).default(.01),
 anchorX:number.min(-2).max(3).default(.5),anchorY:number.min(-2).max(3).default(.5),
 castShadow:z.boolean().default(false),receiveShadow:z.boolean().default(false),
}).strict();
export type Sprite3D=z.infer<typeof Sprite3DSchema>;
export const sprite3dDefaults=():Sprite3D=>Sprite3DSchema.parse({});
export const sprite3dFields:ComponentDefinition['fields']=[
 {key:'texture',titleKey:'field.spriteTexture',kind:'asset',assetType:'pixi.texture'},{key:'tint',titleKey:'field.tint',kind:'color'},
 {key:'alphaMode',titleKey:'field.alphaMode',kind:'enum',options:['opaque','mask','blend'].map(value=>({value,titleKey:'scene3d.alpha.'+value}))},
 {key:'alpha',titleKey:'field.alpha',kind:'number',visible:d=>(d as Sprite3D).alphaMode==='blend'},{key:'alphaCutoff',titleKey:'field.alphaCutoff',kind:'number',visible:d=>(d as Sprite3D).alphaMode==='mask'},
 {key:'billboard',titleKey:'field.billboard',kind:'enum',options:billboardModes.map(value=>({value,titleKey:'scene3d.billboard.'+value}))},
 {key:'pixelSize',titleKey:'field.pixelSize',kind:'number'},{key:'anchorX',titleKey:'field.anchorX',kind:'number'},{key:'anchorY',titleKey:'field.anchorY',kind:'number'},
 {key:'castShadow',titleKey:'field.castShadow',kind:'boolean'},{key:'receiveShadow',titleKey:'field.receiveShadow',kind:'boolean'},
];
