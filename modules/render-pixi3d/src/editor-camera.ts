import {z} from 'zod';
import type {Camera3D,Container3D,View3D} from '@pixi/3d';
const point=z.object({x:z.number().finite().min(-1e6).max(1e6),y:z.number().finite().min(-1e6).max(1e6),z:z.number().finite().min(-1e6).max(1e6)}).strict();
const id=z.string().min(1).max(128);
/** Developer panels of the 3D view: true opens, false closes, missing keeps. */
export const DebugPanelsSchema=z.object({graph:z.boolean().optional(),geometry:z.boolean().optional()}).strict();
export const EditorViewQuerySchema=z.object({viewId:id.optional()}).strict();
/** A click at view-local pixels (0,0 = the view's top-left), as the editor would resolve it; `select` also selects the result. */
/** Drag the selected light's `range` or `coneAngle` handle to view-local pixels, as a pointer drag would (one undo). */
export const EditorHandleDragSchema=z.object({viewId:id,key:z.enum(['range','coneAngle']),x:z.number().finite(),y:z.number().finite()}).strict();
export const EditorPickSchema=z.object({viewId:id,x:z.number().finite(),y:z.number().finite(),select:z.boolean().default(false)}).strict();
export const EditorCameraCommandSchema=z.discriminatedUnion('action',[
 z.object({action:z.literal('set'),viewId:id,position:point,target:point,zoom:z.number().finite().min(.05).max(20).default(1)}).strict().refine(v=>Math.hypot(v.position.x-v.target.x,v.position.y-v.target.y,v.position.z-v.target.z)>1e-5,'Camera position and target must differ'),
 z.object({action:z.enum(['reset','scene','editor','frame']),viewId:id,entityId:id.optional()}).strict(),
]);
export type EditorCameraCommand=z.infer<typeof EditorCameraCommandSchema>;
export interface CameraCheckpoint{position:{x:number;y:number;z:number};target:{x:number;y:number;z:number};zoom:number;sceneCamera:boolean}
/** Numeric camera snapshots survive temporary runtime scenes; no renderer objects are retained. */
export class EditorCameraMemory{
 private records=new Map<string,CameraCheckpoint>();
 constructor(private capacity=128){if(!Number.isInteger(capacity)||capacity<1)throw Error('Invalid camera memory capacity');}
 set(id:string,value:CameraCheckpoint){this.records.delete(id);this.records.set(id,structuredClone(value));while(this.records.size>this.capacity)this.records.delete(this.records.keys().next().value!);}
 get(id:string){const value=this.records.get(id);return value?structuredClone(value):undefined;}
 clear(){this.records.clear();}
 get size(){return this.records.size;}
}
/** Conservative world sphere fit, including non-uniform scale and rotated parents. */
export function frameNode(node:Container3D,view:View3D,camera:Camera3D):Omit<CameraCheckpoint,'sceneCamera'>{
 const bounds=node.getLocalBounds(),points=[];
 if(bounds.isEmpty())points.push(node.getGlobalPosition());
 else for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z])points.push(node.toGlobal({x,y,z}));
 const min={x:Infinity,y:Infinity,z:Infinity},max={x:-Infinity,y:-Infinity,z:-Infinity};
 for(const p of points)for(const axis of ['x','y','z'] as const){min[axis]=Math.min(min[axis],p[axis]);max[axis]=Math.max(max[axis],p[axis]);}
 const target={x:(min.x+max.x)/2,y:(min.y+max.y)/2,z:(min.z+max.z)/2},radius=Math.max(.05,Math.hypot(max.x-min.x,max.y-min.y,max.z-min.z)/2),aspect=view.width/view.height;
 const half=Math.atan(Math.tan(camera.fov*Math.PI/360)*Math.min(1,aspect)),distance=Math.max(radius*1.2/Math.sin(half),radius+camera.near*2);
 if(!Number.isFinite(distance)||distance+radius>=camera.far)throw Error('Object does not fit inside editor camera clipping range');
 let direction={x:camera.x-target.x,y:camera.y-target.y,z:camera.z-target.z},length=Math.hypot(direction.x,direction.y,direction.z);
 if(length<1e-6){direction={x:4,y:3,z:7};length=Math.hypot(4,3,7);}
 return{position:{x:target.x+direction.x/length*distance,y:target.y+direction.y/length*distance,z:target.z+direction.z/length*distance},target,zoom:1};
}
