import {z} from 'zod';
import {slot} from '@rewrite/sdk';
export const easings=['linear','quad.in','quad.out','quad.inOut','cubic.in','cubic.out','cubic.inOut','sine.inOut']as const;
const target={id:z.string().min(1),entityId:z.string().min(1),componentId:z.string().min(1),property:z.string().min(1)};
const ScalarTrackSchema=z.object({...target,from:z.number().finite(),to:z.number().finite()}).strict();
const unit=z.tuple([z.number().finite(),z.number().finite(),z.number().finite(),z.number().finite()]).refine(q=>Math.abs(Math.hypot(...q)-1)<1e-3,'Rotation must be a unit quaternion [x,y,z,w]');
/** Rotation channels only: sampled by shortest-arc slerp between two unit quaternions. */
const QuaternionTrackSchema=z.object({...target,from:unit,to:unit}).strict();
export const TweenSchema=z.object({duration:z.number().positive().max(600),delay:z.number().min(0).max(600),ease:z.enum(easings),repeat:z.number().int().min(0).max(100),yoyo:z.boolean(),autoplay:z.boolean(),tracks:z.array(z.union([ScalarTrackSchema,QuaternionTrackSchema])).max(64)}).strict().superRefine((v,c)=>{if(new Set(v.tracks.map(t=>t.id)).size!==v.tracks.length)c.addIssue({code:'custom',message:'Duplicate tween track ID'});});
export type TweenData=z.infer<typeof TweenSchema>;
export type TweenTrack=TweenData['tracks'][number];
export const isQuaternionTrack=(t:TweenTrack):t is Extract<TweenTrack,{from:readonly number[]}>=>Array.isArray(t.from);
export const totalDuration=(v:TweenData)=>v.delay+v.duration*(v.repeat+1);
/** Explicit numeric channels only. No arbitrary property paths, callbacks or GSAP vars in JSON. */
export interface TweenChannel {componentType:string;version:number;property:string;titleKey:string;min?:number;max?:number;defaultValue?:number;
 /** Never write exactly 0 (scale: a flip from 1 to −1 passes 0 halfway); ±0.0001 is written instead, keeping the side. */
 nonZero?:boolean;
 /** Rotation channel: tracks hold unit quaternions [x,y,z,w], sampled by slerp and written normalized to these four properties. */
 quaternion?:readonly [string,string,string,string]}
export const transformTweenChannels:readonly TweenChannel[]=['x','y','rotation','scaleX','scaleY','skewX','skewY'].map(property=>({
 componentType:'scene.transform2d',version:1,property,titleKey:`field.${property}`,
 ...(property.startsWith('scale')?{min:-100,max:100,nonZero:true}:property.startsWith('skew')?{min:-89,max:89,defaultValue:0}:{}),
}));
export const tweenChannels=slot<TweenChannel>('tween.channels');
export interface TweenSpec {duration:number;delay:number;repeat:number;yoyo:boolean;ease:TweenData['ease'];tracks:readonly {id:string;from:number;to:number}[]}
export interface TweenSampler {sample(time:number):Readonly<Record<string,number>>;dispose():void}
export interface TweenProvider {id:string;create(spec:TweenSpec):TweenSampler}
export const tweenProviders=slot<TweenProvider>('tween.providers');
