import {z} from 'zod';
import {Buffer,BufferUsage,type Attribute} from 'pixi.js';
import {Box,CubeGeometry,Geometry3D,Vector3} from '@pixi/3d';
import type {ComponentDefinition} from '@rewrite/sdk';
// Mesh 3D: an object whose shape comes from a script (game.geometry → self.mesh.geometry). The shape is play-session
// data, not saved in the project; while no script has given it one (and in edit mode) it shows a unit cube stand-in.
export const mesh3dType='pixi3d.mesh';
const hex=z.string().regex(/^#[0-9a-fA-F]{6}$/),unit=z.number().finite().min(0).max(1);
export const Mesh3DSchema=z.object({color:hex.default('#ffffff'),roughness:unit.default(.5),metallic:unit.default(0),texture:z.string().max(128).default(''),vertexColors:z.boolean().default(false),doubleSided:z.boolean().default(false),flatShading:z.boolean().default(false),castShadow:z.boolean().default(true),receiveShadow:z.boolean().default(true)}).strict();
export type Mesh3DData=z.infer<typeof Mesh3DSchema>;
export const mesh3dDefinition:ComponentDefinition={type:mesh3dType,version:1,titleKey:'component.mesh3d',exclusiveGroup:'render.visual',supportedSpaces:['scene.3d'],defaults:()=>Mesh3DSchema.parse({}),parse:v=>Mesh3DSchema.parse(v),get dataSchema(){return z.toJSONSchema(Mesh3DSchema);},
 fields:[{key:'color',titleKey:'field.color',kind:'color'},{key:'roughness',titleKey:'field.roughness',kind:'number'},{key:'metallic',titleKey:'field.metallic',kind:'number'},{key:'texture',titleKey:'field.meshTexture',kind:'asset',assetType:'pixi.texture'},{key:'vertexColors',titleKey:'field.vertexColors',kind:'boolean'},{key:'doubleSided',titleKey:'field.doubleSided',kind:'boolean'},{key:'flatShading',titleKey:'field.flatShading',kind:'boolean'},{key:'castShadow',titleKey:'field.castShadow',kind:'boolean'},{key:'receiveShadow',titleKey:'field.receiveShadow',kind:'boolean'}]};

/** Batch 3D: one node drawing up to `size` copies of script-made shapes (self.batch.geometries / self.batch.write). */
export const batch3dType='pixi3d.batch',maxBatchSlots=100000;
export const Batch3DSchema=z.object({size:z.number().int().min(1).max(maxBatchSlots).default(1000),color:hex.default('#ffffff'),roughness:unit.default(.6),metallic:unit.default(0),castShadow:z.boolean().default(true),receiveShadow:z.boolean().default(true)}).strict();
export const batch3dDefinition:ComponentDefinition={type:batch3dType,version:1,titleKey:'component.batch3d',exclusiveGroup:'render.visual',supportedSpaces:['scene.3d'],defaults:()=>Batch3DSchema.parse({}),parse:v=>Batch3DSchema.parse(v),get dataSchema(){return z.toJSONSchema(Batch3DSchema);},
 fields:[{key:'size',titleKey:'field.batchSize',kind:'number'},{key:'color',titleKey:'field.color',kind:'color'},{key:'roughness',titleKey:'field.roughness',kind:'number'},{key:'metallic',titleKey:'field.metallic',kind:'number'},{key:'castShadow',titleKey:'field.castShadow',kind:'boolean'},{key:'receiveShadow',titleKey:'field.receiveShadow',kind:'boolean'}]};
/** Floats per item a script writes: shape index, x, y, z, qx, qy, qz, qw, scale, r, g, b (sRGB 0–1). */
export const batchStride=12;
/** Floats per particle a script writes: x, y, z, size, r, g, b (sRGB 0–1), alpha. */
export const particleStride=8;
/** How a script's vertex data is stored on the GPU: the source is always floats; the host packs it when asked. */
export const positionFormats=['float32','snorm16'] as const,normalFormats=['float32','snorm8'] as const,colorFormats=['float32','unorm8'] as const;
export interface ScriptGeometry{
 positions:Float32Array;normals:Float32Array;uvs?:Float32Array;colors?:Float32Array;colors1?:Float32Array;indices?:Uint32Array;
 morphTargets?:{positions:Float32Array;normals?:Float32Array}[];
 format:{positions:typeof positionFormats[number];normals:typeof normalFormats[number];colors:typeof colorFormats[number]};
 /** Bytes the host keeps for it (for the session budget). */
 bytes:number;
}
/** Limits on what scripts may hand the host (the sandbox's own 64 MB cap does not cover the copies). */
export const geometryLimits={vertices:262144,indices:3*1048576,geometries:256,bytes:128*1024*1024,morphTargets:8};

const packSnorm=(src:Float32Array,size:number,stride:number,bits:8|16)=>{const max=bits===8?127:32767,n=src.length/size,out=bits===8?new Int8Array(n*stride):new Int16Array(n*stride);for(let i=0;i<n;i++)for(let k=0;k<size;k++)out[i*stride+k]=Math.round(Math.max(-1,Math.min(1,src[i*size+k]))*max);return out;};
const packUnorm8=(src:Float32Array)=>{const out=new Uint8Array(src.length);for(let i=0;i<src.length;i++)out[i]=Math.round(Math.max(0,Math.min(1,src[i]))*255);return out;};
/** The bounds of the float positions, so packed positions still cull and pick right. */
export function positionBounds(p:Float32Array){const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(let i=0;i<p.length;i++){const k=i%3;if(p[i]<min[k])min[k]=p[i];if(p[i]>max[k])max[k]=p[i];}return new Box(new Vector3(min[0],min[1],min[2]),new Vector3(max[0],max[1],max[2]));}
/** A GPU geometry for a script's data (each 3D view gets its own; the data stays on the projection). */
export function buildScriptGeometry(g:ScriptGeometry):Geometry3D{
 const positions=g.format.positions==='snorm16'?({buffer:new Buffer({data:packSnorm(g.positions,3,4,16),usage:BufferUsage.VERTEX}),format:'snorm16x4',stride:8,offset:0} as Attribute):g.positions;
 const colors=g.colors?g.format.colors==='unorm8'?packUnorm8(g.colors):g.colors:undefined,colors1=g.colors1?g.format.colors==='unorm8'?packUnorm8(g.colors1):g.colors1:undefined;
 return new Geometry3D({positions,normals:g.normals,quantizeNormals:g.format.normals==='snorm8',...g.uvs?{uvs:g.uvs}:{},...colors?{colors}:{},...colors1?{colors1}:{},...g.indices?{indices:g.indices}:{},
  ...g.morphTargets?.length?{morphTargets:g.morphTargets}:{},bounds3D:positionBounds(g.positions)});
}
/** The stand-in shape a Mesh 3D shows until a script gives it one. */
export const standInGeometry=()=>new CubeGeometry({width:1,height:1,depth:1});
