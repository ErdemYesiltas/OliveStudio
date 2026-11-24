import {z} from 'zod';
import type {ComponentDefinition} from '@rewrite/sdk';
// Player-driven cameras: added to a camera entity, they take over that camera while the game runs. Pure: no pixi.
export const cameraControlType='pixi3d.cameraControl',cameraControlModes=['orbit','firstPerson'] as const;
const number=z.number().finite();
export const CameraControlSchema=z.object({
 mode:z.enum(cameraControlModes).default('orbit'),
 targetX:number.default(0),targetY:number.default(0),targetZ:number.default(0),
 minDistance:number.min(0).max(1e4).default(1),maxDistance:number.min(0).max(1e5).default(50),
 enableZoom:z.boolean().default(true),enablePan:z.boolean().default(true),damping:z.boolean().default(true),
 autoRotate:z.boolean().default(false),autoRotateSpeed:number.min(-60).max(60).default(2),
 moveSpeed:number.min(0).max(1000).default(4),lookSpeed:number.min(0).max(1).default(.0025),pointerLock:z.boolean().default(true),
}).strict().refine(v=>v.maxDistance>=v.minDistance,'Max distance must not be below min distance');
export type CameraControl=z.infer<typeof CameraControlSchema>;
const orbit=(d:unknown)=>(d as CameraControl).mode!=='firstPerson',fps=(d:unknown)=>(d as CameraControl).mode==='firstPerson';
const n=(key:string,visible:(d:unknown)=>boolean):ComponentDefinition['fields'][number]=>({key,titleKey:'field.'+key,kind:'number',visible});
const b=(key:string,visible:(d:unknown)=>boolean):ComponentDefinition['fields'][number]=>({key,titleKey:'field.'+key,kind:'boolean',visible});
export const cameraControlFields:ComponentDefinition['fields']=[
 {key:'mode',titleKey:'field.cameraControlMode',kind:'enum',options:cameraControlModes.map(value=>({value,titleKey:'scene3d.control.'+value}))},
 n('targetX',orbit),n('targetY',orbit),n('targetZ',orbit),n('minDistance',orbit),n('maxDistance',orbit),b('enableZoom',orbit),b('enablePan',orbit),b('damping',orbit),b('autoRotate',orbit),n('autoRotateSpeed',d=>orbit(d)&&(d as CameraControl).autoRotate),
 n('moveSpeed',fps),n('lookSpeed',fps),b('pointerLock',fps),
];
/**
 * First-person yaw and pitch (radians) that look along `forward`, for a controller that turns by yaw about +Y then
 * pitch about +X from a camera looking down −Z. Roll is dropped.
 */
export function yawPitch(forward:{x:number;y:number;z:number}){const l=Math.hypot(forward.x,forward.y,forward.z)||1,x=forward.x/l,y=forward.y/l,z=forward.z/l;return{yaw:Math.atan2(-x,-z),pitch:Math.asin(Math.max(-1,Math.min(1,y)))};}
