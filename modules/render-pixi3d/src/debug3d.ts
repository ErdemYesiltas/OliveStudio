import {z} from 'zod';
import type {ComponentDefinition} from '@rewrite/sdk';
import type {ActionDefinition} from '@rewrite/interactions';
import {attachType} from './place3d';
// Per-object outline, wireframe overlay and bounding box. Each is an add-on component on a primitive or model whose
// `enabled` flag changes without rebuilding the view, so a rule can switch it on hover. Pure: no pixi.
const color=z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const outline3dType='pixi3d.outline',wireframeOverlayType='pixi3d.wireframeOverlay',boundsHelperType='pixi3d.boundsHelper';
export const highlight3dTypes=[outline3dType,wireframeOverlayType,boundsHelperType] as const;
/** Ink shell around the object; width and colour are the view's (one outline pass per view). */
export const Outline3DSchema=z.object({enabled:z.boolean().default(true)}).strict();
export const WireframeOverlaySchema=z.object({enabled:z.boolean().default(true),color:color.default('#3cff8a')}).strict();
export const BoundsHelperSchema=z.object({enabled:z.boolean().default(true),color:color.default('#ffd23c')}).strict();
export const outline3dFields:ComponentDefinition['fields']=[{key:'enabled',titleKey:'field.enabled',kind:'boolean'}];
export const wireframeOverlayFields:ComponentDefinition['fields']=[{key:'enabled',titleKey:'field.enabled',kind:'boolean'},{key:'color',titleKey:'field.color',kind:'color'}];
export const boundsHelperFields=wireframeOverlayFields;
/** Turns an outline, wireframe overlay, bounding box or attach on (value true) or off while the game runs; never the document. */
export const highlight3dActions:ActionDefinition[]=[{type:'pixi3d.highlight',titleKey:'interaction.highlight3d',
 references:c=>c.entities.flatMap(e=>e.components.filter(x=>(highlight3dTypes as readonly string[]).includes(x.type)||x.type===attachType).map(x=>({id:x.id,name:`${e.name} · ${x.type===outline3dType?'outline':x.type===wireframeOverlayType?'wireframe':x.type===attachType?'attach':'bounds'}`}))),
 execute:(a,c)=>{if(!c.setData)throw Error('Runtime component data is unavailable');c.setData(a.targetId,{enabled:a.value});}}];
/**
 * The world-axis box around a local box (min, max) placed by a column-major world matrix: the eight corners moved
 * into the world, then their extent. A turning object's box grows and shrinks with its corners.
 */
export function worldBox(min:{x:number;y:number;z:number},max:{x:number;y:number;z:number},e:ArrayLike<number>){
 const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
 for(let k=0;k<8;k++){const x=k&1?max.x:min.x,y=k&2?max.y:min.y,z=k&4?max.z:min.z,w=[e[0]*x+e[4]*y+e[8]*z+e[12],e[1]*x+e[5]*y+e[9]*z+e[13],e[2]*x+e[6]*y+e[10]*z+e[14]];
  for(let i=0;i<3;i++){lo[i]=Math.min(lo[i],w[i]);hi[i]=Math.max(hi[i],w[i]);}}
 return{min:{x:lo[0],y:lo[1],z:lo[2]},max:{x:hi[0],y:hi[1],z:hi[2]}};
}
