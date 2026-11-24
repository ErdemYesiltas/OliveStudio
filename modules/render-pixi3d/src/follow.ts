import {z} from 'zod';
import type {ComponentDefinition} from '@rewrite/sdk';
// A 2D object that rides on a 3D object's place on screen while the game runs: a name tag, a health bar, a marker.
export const followType='pixi3d.follow';
const number=z.number().finite();
export const FollowSchema=z.object({targetId:z.string().max(128).default(''),offsetX:number.default(0),offsetY:number.default(0),offsetZ:number.default(0),hideBehind:z.boolean().default(true)}).strict();
export type Follow=z.infer<typeof FollowSchema>;
export const followFields:ComponentDefinition['fields']=[{key:'targetId',titleKey:'field.followTarget',kind:'string'},...(['offsetX','offsetY','offsetZ'] as const).map(key=>({key,titleKey:'field.follow.'+key,kind:'number' as const})),{key:'hideBehind',titleKey:'field.hideBehind',kind:'boolean'}];
