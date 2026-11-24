import {z} from 'zod';
import type {ComponentDefinition} from '@rewrite/sdk';
// Built-in primitive shapes: which one, its shape-only options (size comes from the transform's scale), and how it is
// drawn (surface, wireframe or points). Pure: no pixi.
export const primitiveShapes=['cube','sphere','plane','cylinder','cone','capsule','torus','torusKnot','icosahedron'] as const;
export type PrimitiveShape=typeof primitiveShapes[number];
export const drawModes=['surface','wireframe','points'] as const;
const number=z.number().finite();
/** Every shape fits a unit box at scale 1 (radius 0.5), so swapping shapes keeps an object's size. */
export const shapeOptions={
 segments:z.number().int().min(3).max(128).default(32),radiusTop:number.min(0).max(1).default(.5),openEnded:z.boolean().default(false),
 capsuleLength:number.min(0).max(4).default(.5),tube:number.min(.01).max(.5).default(.15),arc:number.min(1).max(360).default(360),
 knotP:z.number().int().min(1).max(12).default(2),knotQ:z.number().int().min(1).max(12).default(3),detail:z.number().int().min(0).max(6).default(1),
 draw:z.enum(drawModes).default('surface'),
 hitVolume:z.enum(['auto','box','sphere','geometry','none']).default('auto'),
 lodDistance:number.min(0).max(1e4).default(0),lodSegments:z.number().int().min(3).max(128).default(8),
};
type Fields=ComponentDefinition['fields'];
const is=(...shapes:PrimitiveShape[])=>(d:unknown)=>shapes.includes((d as {shape?:PrimitiveShape}).shape??'cube');
/** Shapes with a smoothness setting, the ones a far, coarser copy can stand in for. */
export const lodShapes:readonly PrimitiveShape[]=['sphere','cylinder','cone','capsule','torus','torusKnot','icosahedron'];
const lodShape=(d:unknown)=>lodShapes.includes((d as {shape?:PrimitiveShape}).shape??'cube');
/** Inspector rows for the shape, each shown only for the shapes it changes. */
export function shapeFields():Fields{
 const n=(key:string,visible:(d:unknown)=>boolean):Fields[number]=>({key,titleKey:'field.'+key,kind:'number',visible});
 return[
  n('segments',is('sphere','cylinder','cone','capsule','torus','torusKnot')),n('radiusTop',is('cylinder')),{key:'openEnded',titleKey:'field.openEnded',kind:'boolean',visible:is('cylinder','cone')},
  n('capsuleLength',is('capsule')),n('tube',is('torus','torusKnot')),n('arc',is('torus')),n('knotP',is('torusKnot')),n('knotQ',is('torusKnot')),n('detail',is('icosahedron')),
  {key:'draw',titleKey:'field.draw',kind:'enum',options:drawModes.map(value=>({value,titleKey:'scene3d.draw.'+value}))},
  {key:'hitVolume',titleKey:'field.hitVolume',kind:'enum',options:['auto','box','sphere','geometry','none'].map(value=>({value,titleKey:'scene3d.hit.'+value}))},
  n('lodDistance',lodShape),n('lodSegments',d=>lodShape(d)&&Number((d as {lodDistance?:number}).lodDistance??0)>0),
 ];
}
/**
 * The edges of a triangle list as a line list, each shared edge once: what a wireframe draws. Drawing the triangle
 * indices with `line-list` instead would join them in pairs and miss edges.
 */
export function edgeIndices(triangles:ArrayLike<number>):Uint32Array{
 const seen=new Set<string>(),out:number[]=[];
 for(let i=0;i+2<triangles.length;i+=3)for(const [a,b] of [[triangles[i],triangles[i+1]],[triangles[i+1],triangles[i+2]],[triangles[i+2],triangles[i]]]){const key=a<b?`${a},${b}`:`${b},${a}`;if(seen.has(key))continue;seen.add(key);out.push(a,b);}
 return Uint32Array.from(out);
}
