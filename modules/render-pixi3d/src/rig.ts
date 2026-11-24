import {z} from 'zod';
import type {ComponentDefinition} from '@rewrite/sdk';
// Posing a model's rig from the editor: morph weights set by hand, and a bone turned toward another object. Pure: no pixi.
export const morphKeys=['morph1','morph2','morph3','morph4'] as const;
const number=z.number().finite();
/** Manual morph target weights for the first four targets of every morph mesh in a model; they win over a clip. */
export const morphShape={morphOverride:z.boolean().default(false),...Object.fromEntries(morphKeys.map(k=>[k,number.min(0).max(1).default(0)])) as Record<typeof morphKeys[number],z.ZodDefault<z.ZodNumber>>};
export const morphFields:ComponentDefinition['fields']=[{key:'morphOverride',titleKey:'field.morphOverride',kind:'boolean'},...morphKeys.map(key=>({key,titleKey:'field.'+key,kind:'number' as const,visible:(d:unknown)=>(d as {morphOverride?:boolean}).morphOverride===true}))];
export const boneAimType='pixi3d.boneAim',aimAxes=['+Z','-Z','+Y','-Y','+X','-X'] as const;
export const BoneAimSchema=z.object({bone:z.string().max(256).default(''),targetId:z.string().max(128).default(''),axis:z.enum(aimAxes).default('+Z'),weight:number.min(0).max(1).default(1)}).strict();
export type BoneAim=z.infer<typeof BoneAimSchema>;
export const boneAimFields:ComponentDefinition['fields']=[{key:'bone',titleKey:'field.aimBone',kind:'string'},{key:'targetId',titleKey:'field.aimTarget',kind:'string'},{key:'axis',titleKey:'field.aimAxis',kind:'enum',options:aimAxes.map(value=>({value,titleKey:'scene3d.axis.'+value}))},{key:'weight',titleKey:'field.aimWeight',kind:'number'}];
/**
 * The rotation (x, y, z, w) that carries a bone's chosen axis onto local +Z, the axis `lookAt` aims: applied after
 * `lookAt`, it makes that axis point at the target instead.
 */
export function axisToZ(axis:BoneAim['axis']):[number,number,number,number]{const h=Math.SQRT1_2;
 return axis==='+Z'?[0,0,0,1]:axis==='-Z'?[0,1,0,0]:axis==='+Y'?[h,0,0,h]:axis==='-Y'?[-h,0,0,h]:axis==='+X'?[0,-h,0,h]:[0,h,0,h];}
