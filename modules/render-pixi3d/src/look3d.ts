import {z} from 'zod';
import type {ComponentDefinition} from '@rewrite/sdk';
// Turning toward another object, and following the pointer's point in the 3D scene. Pure: no pixi.
export const lookAtType='pixi3d.lookAt',pointerFollowType='pixi3d.pointerFollow';
export const lookAxes=['+Z','-Z'] as const;
/** Turns the object every frame so its front (`axis`) faces the target; `yawOnly` keeps it upright, turning only around Y. */
export const LookAtSchema=z.object({targetId:z.string().max(128).default(''),axis:z.enum(lookAxes).default('+Z'),yawOnly:z.boolean().default(false),weight:z.number().finite().min(0).max(1).default(1)}).strict();
export type LookAt=z.infer<typeof LookAtSchema>;
export const lookAtFields:ComponentDefinition['fields']=[{key:'targetId',titleKey:'field.lookTarget',kind:'string'},{key:'axis',titleKey:'field.lookAxis',kind:'enum',options:lookAxes.map(value=>({value,titleKey:'scene3d.look.'+value}))},{key:'yawOnly',titleKey:'field.yawOnly',kind:'boolean'},{key:'weight',titleKey:'field.lookWeight',kind:'number'}];
export const followSurfaces=['objects','ground'] as const;
/**
 * Moves the object to the point under the pointer while the game runs: on the nearest object (`objects`, falling back to
 * the ground plane when nothing is hit) or only on the ground plane at `groundY`. `align` turns its +Y to the surface,
 * `lift` raises it along that normal, `hideWhenMissed` hides it while the pointer is over empty sky.
 */
export const PointerFollowSchema=z.object({surface:z.enum(followSurfaces).default('objects'),groundY:z.number().finite().min(-1e4).max(1e4).default(0),align:z.boolean().default(true),lift:z.number().finite().min(-100).max(100).default(.02),hideWhenMissed:z.boolean().default(true)}).strict();
export type PointerFollow=z.infer<typeof PointerFollowSchema>;
export const pointerFollowFields:ComponentDefinition['fields']=[{key:'surface',titleKey:'field.followSurface',kind:'enum',options:followSurfaces.map(value=>({value,titleKey:'scene3d.surface.'+value}))},{key:'groundY',titleKey:'field.groundY',kind:'number'},{key:'align',titleKey:'field.alignToSurface',kind:'boolean'},{key:'lift',titleKey:'field.lift',kind:'number'},{key:'hideWhenMissed',titleKey:'field.hideWhenMissed',kind:'boolean'}];
type V={x:number;y:number;z:number};
export {lookRotation} from '@rewrite/scene3d/look';
/** Spherical blend between two unit quaternions by `t` (the short way round). */
export function slerp(a:readonly number[],b:readonly number[],t:number):[number,number,number,number]{
 let d=a[0]*b[0]+a[1]*b[1]+a[2]*b[2]+a[3]*b[3];const s=d<0?-1:1;d*=s;
 if(d>.9995){const q=[0,1,2,3].map(i=>a[i]+(b[i]*s-a[i])*t),l=Math.hypot(...q);return[q[0]/l,q[1]/l,q[2]/l,q[3]/l];}
 const th=Math.acos(d),k0=Math.sin((1-t)*th)/Math.sin(th),k1=Math.sin(t*th)/Math.sin(th)*s;return[a[0]*k0+b[0]*k1,a[1]*k0+b[1]*k1,a[2]*k0+b[2]*k1,a[3]*k0+b[3]*k1];
}
/** The rotation that turns +Y onto the unit normal `n` (shortest arc), for lying a marker flat on a surface. */
export function alignUp(n:V):[number,number,number,number]{
 const d=n.y;if(d<-.999999)return[1,0,0,0];const x=n.z,z=-n.x,w=1+d,l=Math.hypot(x,0,z,w);return[x/l,0,z/l,w/l];}
