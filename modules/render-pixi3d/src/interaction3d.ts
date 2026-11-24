import {z} from 'zod';
import type {ComponentDefinition} from '@rewrite/sdk';
import type {ActionDefinition,TriggerDefinition} from '@rewrite/interactions';
// Pointer interaction with 3D objects while the game runs: dragging along a plane, and hover triggers. Pure: no pixi.
export const draggableType='pixi3d.draggable',dragPlanes=['ground','view'] as const;
export const DraggableSchema=z.object({plane:z.enum(dragPlanes).default('ground'),snap:z.number().finite().min(0).max(100).default(0)}).strict();
export type Draggable=z.infer<typeof DraggableSchema>;
export const draggableFields:ComponentDefinition['fields']=[{key:'plane',titleKey:'field.dragPlane',kind:'enum',options:dragPlanes.map(value=>({value,titleKey:'scene3d.drag.'+value}))},{key:'snap',titleKey:'field.dragSnap',kind:'number'}];
// Any 3D object, groups included: hover flows up into the groups an object sits in.
const refs:TriggerDefinition['references']=catalog=>catalog.entities.flatMap(e=>e.components.some(c=>c.type==='scene3d.transform')?[{id:e.id,name:e.name}]:[]);
/** Hover and drag events on 3D objects, for rules; `sourceId` is the object's id. */
export const pointer3dTriggers:TriggerDefinition[]=[{type:'pixi3d.pointerEnter',titleKey:'interaction.pointerEnter3d',references:refs},{type:'pixi3d.pointerLeave',titleKey:'interaction.pointerLeave3d',references:refs},{type:'pixi3d.dragEnd',titleKey:'interaction.dragEnd3d',references:refs}];
export const pointer3dActions:ActionDefinition[]=[];
/** Where a ray (origin o, direction d) meets the plane through `point` with normal `n`; null when parallel or behind. */
export function rayPlane(o:{x:number;y:number;z:number},d:{x:number;y:number;z:number},point:{x:number;y:number;z:number},n:{x:number;y:number;z:number}){
 const denom=d.x*n.x+d.y*n.y+d.z*n.z;if(Math.abs(denom)<1e-9)return null;const t=((point.x-o.x)*n.x+(point.y-o.y)*n.y+(point.z-o.z)*n.z)/denom;if(t<0)return null;return{x:o.x+d.x*t,y:o.y+d.y*t,z:o.z+d.z*t};}
/** Rounds a coordinate to a snap grid; 0 leaves it free. */
export const snapTo=(v:number,step:number)=>step>0?Math.round(v/step)*step:v;
