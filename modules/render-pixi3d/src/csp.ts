import {RendererType,WGSL_ALIGN_SIZE_DATA,type Renderer,type UniformData,type UniformGroup,type UboElement,type GlUniformData,type UniformsSyncCallback} from 'pixi.js';
/** @pixi/3d 0.1 adds object parsers but Pixi 8.23's no-eval handlers are fixed.
 * Normalize only those objects to standard array uniforms on this lab renderer.
 * No global prototype/registry mutation and no eval. Remove after upstream support.
 */
export function uniformArray(uniform:UniformData,value:unknown):unknown{
 if(!value||typeof value!=='object'||uniform.size!==1)return value;
 const object=value as Record<string,unknown>;
 if((uniform.type==='mat4x4<f32>'||uniform.type==='mat3x3<f32>')&&object.elements)return object.elements;
 if(uniform.type==='vec3<f32>'){
  if(typeof object.x==='number'&&typeof object.y==='number'&&typeof object.z==='number')return new Float32Array([object.x,object.y,object.z]);
  if(typeof object.r==='number'&&typeof object.g==='number'&&typeof object.b==='number')return new Float32Array([object.r,object.g,object.b]);
 }
 return value;
}
function normalizer(uniforms:Record<string,UniformData>){
 const changed=Object.entries(uniforms).filter(([,u])=>uniformArray(u,u.value)!==u.value);
 return{structures:Object.fromEntries(Object.entries(uniforms).map(([key,u])=>[key,{...u,value:uniformArray(u,u.value)}])),values:(values:Record<string,unknown>)=>{
  if(!changed.length)return values;const normalized={...values};for(const [key,u]of changed)normalized[key]=uniformArray(u,values[key]);return normalized;
 }};
}
/** Pixi 8.23's no-eval WGSL UBO sync ignores its dataInt32 argument and stores i32/u32 members through the
 * Float32 view, so an integer 1 lands as the bits of 1.0f (0x3F800000). @pixi/3d's light-tile masks are
 * vec4<i32> bitfields, so every mask test fails and no direct light reaches any pixel under WebGPU.
 * Re-store integer members through an Int32 view with the same WGSL layout the polyfill uses. */
const intViews=new WeakMap<Float32Array,Int32Array>();
export function storeWgslIntegers(elements:readonly UboElement[],uniforms:Record<string,unknown>,data:Float32Array,dataInt32:Int32Array|null,offset:number){
 let view=dataInt32;
 for(const element of elements){const type=element.data.type;if(!/(^|<)[iu]32>?$/.test(type))continue;const layout=WGSL_ALIGN_SIZE_DATA[type as keyof typeof WGSL_ALIGN_SIZE_DATA];if(!layout)continue;
  if(!view){view=intViews.get(data)??new Int32Array(data.buffer,data.byteOffset,data.length);intViews.set(data,view);}
  const value=uniforms[element.data.name!],words=layout.size/4,stride=Math.max(layout.size,layout.align)/4;let at=offset+element.offset/4;
  if(typeof value==='number'){view[at]=value;continue;}
  const list=value as ArrayLike<number>;let t=0;for(let i=0;i<(element.data.size??1);i++){for(let j=0;j<words;j++)view[at+j]=list[t++];at+=stride;}
 }
}
interface UniformSystem{_generateUniformsSync:(group:UniformGroup,data:Record<string,GlUniformData>)=>UniformsSyncCallback}
interface BufferSystem{_generateUboSync:(elements:UboElement[])=>UniformsSyncCallback}
export function installCspUniformCompatibility(renderer:Renderer){
 const systems=renderer as unknown as {uniformGroup?:UniformSystem;ubo:BufferSystem};
 if(systems.uniformGroup){const system=systems.uniformGroup,generate=system._generateUniformsSync.bind(system);
  system._generateUniformsSync=(group,data)=>{const n=normalizer(group.uniformStructures);const sync=generate({...group,uniformStructures:n.structures} as UniformGroup,data);return (ud,uv,...rest)=>sync(ud,n.values(uv),...rest);};
 }
 const system=systems.ubo,generate=system._generateUboSync.bind(system);
 const wgsl=renderer.type===RendererType.WEBGPU;
 system._generateUboSync=elements=>{const n=normalizer(Object.fromEntries(elements.map(e=>[e.data.name!,e.data])));const sync=generate(elements.map(e=>({...e,data:n.structures[e.data.name!]}))),ints=wgsl?elements.filter(e=>/(^|<)[iu]32>?$/.test(e.data.type)):[];
  return (uv,...rest)=>{const values=n.values(uv);sync(values,...rest);if(ints.length){const [data,dataInt32,offset]=rest as unknown as [Float32Array,Int32Array|null,number];storeWgslIntegers(ints,values,data,dataInt32,offset??0);}};};
}
