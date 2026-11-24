import 'pixi.js/unsafe-eval';
import {it,expect} from 'vitest';
import {Matrix4,Vector3} from '@pixi/3d';
import {GlUniformGroupSystem,GlUboSystem,GpuUboSystem,UniformGroup,type Renderer,type WebGLRenderer,type GlUniformData,type UniformsSyncCallback} from 'pixi.js';
import {installCspUniformCompatibility,uniformArray} from './csp';
it('uploads 3D object uniforms through real Pixi no-eval handlers and follows later mutations',()=>{
 const matrix=new Matrix4(),vector=new Vector3(1,2,3),color={r:.2,g:.4,b:.6};
 const group=new UniformGroup({matrix:{type:'mat4x4<f32>',value:matrix},vector:{type:'vec3<f32>',value:vector},color:{type:'vec3<f32>',value:color}});
 const uniformGroup=new GlUniformGroupSystem({} as WebGLRenderer),ubo=new GlUboSystem();
 installCspUniformCompatibility({uniformGroup,ubo} as unknown as Renderer);
 const system=uniformGroup as unknown as {_generateUniformsSync:(g:UniformGroup,d:Record<string,GlUniformData>)=>UniformsSyncCallback};
 const data={matrix:{location:null,value:new Float32Array(16)},vector:{location:null,value:new Float32Array(3)},color:{location:null,value:new Float32Array(3)}} as unknown as Record<string,GlUniformData>;
 const calls:number[][]=[];const gl={uniformMatrix4fv:(_location:unknown,_transpose:boolean,v:ArrayLike<number>)=>calls.push(Array.from(v)),uniform3f:(_location:unknown,...v:number[])=>calls.push(v)};
 const sync=system._generateUniformsSync(group,data);sync(data,group.uniforms,{gl});expect(calls.at(-2)).toEqual([1,2,3]);
 vector.x=7;matrix.elements[12]=8;sync(data,group.uniforms,{gl});expect(calls.at(-1)).toEqual([7,2,3]);expect(calls.at(-2)?.[12]).toBe(8);
 expect(group.uniforms.matrix).toBe(matrix);expect(group.uniforms.vector).toBe(vector);
});
for(const [backend,System]of [['webgl',GlUboSystem],['webgpu',GpuUboSystem]] as const){
 it(`writes matrices and vectors to real ${backend} no-eval uniform buffers`,()=>{
  const matrix=new Matrix4(),vector=new Vector3(1,2,3);matrix.elements[12]=9;
  const normal={elements:new Float32Array([1,2,3,4,5,6,7,8,9])};
  const group=new UniformGroup({matrix:{type:'mat4x4<f32>',value:matrix},vector:{type:'vec3<f32>',value:vector},normal:{type:'mat3x3<f32>',value:normal}}),ubo=new System();
  installCspUniformCompatibility({ubo} as unknown as Renderer);
  const {layout,syncFunction}=ubo.getUniformGroupData(group),data=new Float32Array(layout.size/4);
  syncFunction(group.uniforms,data,new Int32Array(data.buffer),0);
  const offset=(name:string)=>layout.uboElements.find(e=>e.data.name===name)!.offset/4;
  expect(data[offset('matrix')+12]).toBe(9);expect(Array.from(data.slice(offset('normal'),offset('normal')+11))).toEqual([1,2,3,0,4,5,6,0,7,8,9]);expect(Array.from(data.slice(offset('vector'),offset('vector')+3))).toEqual([1,2,3]);
  vector.z=6;syncFunction(group.uniforms,data,new Int32Array(data.buffer),0);expect(data[offset('vector')+2]).toBe(6);
 });
}
it('leaves standard 2D matrix objects and typed arrays untouched',()=>{
 const value={a:1,b:0,c:0,d:1,tx:2,ty:3,toArray:()=>new Float32Array(9)};
 expect(uniformArray({type:'mat3x3<f32>',size:1,value},value)).toBe(value);
 const data=new Float32Array(16);expect(uniformArray({type:'mat4x4<f32>',size:1,value:data},data)).toBe(data);
});
