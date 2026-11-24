import {expect,it} from 'vitest';
import {Container} from 'pixi.js';
import {Mesh3D} from '@pixi/3d';
import {SceneService,transformDefinition} from '@rewrite/scene';
import {transform3dDefinition,viewport3dDefinition} from '@rewrite/scene3d';
import {authoring3dDefinitions} from './contracts';
import {model3dDefinition} from './model-contracts';
import {Authoring3D} from './model';
import {Scene3DProjection} from './projection';
import {runtime3DProblems} from './preflight';
import {ShaderItemSchema,ShaderMaterial3D,loopProblems,shaderBits,shaderHash,shaderProblems,userLine,wrap,type ShaderItem} from './shader3d';
import type {ShaderCheck,ShaderValidatorPort} from './shader3d-validator';
const item=(over:Partial<ShaderItem>={}):ShaderItem=>ShaderItemSchema.parse({id:'s1',name:'Stripes',kind:'extra',params:[{name:'amount',type:'float',default:.5},{name:'tint',type:'color',default:'#ff0000'}],wgsl:{material:'  albedo = mix(albedo, material.tint.rgb, material.amount);'},glsl:{material:'  albedo = mix(albedo, material.tint.rgb, material.amount);'},...over});
it('checks parameter names, loops and required code before anything compiles',()=>{
 expect(ShaderItemSchema.safeParse({...item(),params:[{name:'baseColor',type:'float'}]}).success).toBe(false);
 expect(ShaderItemSchema.safeParse({...item(),params:[{name:'Big',type:'float'}]}).success).toBe(false);
 expect(ShaderItemSchema.safeParse({...item(),params:[{name:'a',type:'float'},{name:'a',type:'color'}]}).success).toBe(false);
 expect(loopProblems(item())).toEqual([]);
 expect(loopProblems(item({wgsl:{...item().wgsl,material:'  loop { }'}}))[0]).toMatch(/WGSL material: while and loop/);
 expect(loopProblems(item({glsl:{...item().glsl,material:'  for (int i = 0; i < n; i++) {}'}}))[0]).toMatch(/GLSL material: a for loop must stop at a number/);
 expect(loopProblems(item({glsl:{...item().glsl,material:'  for (int i = 0; i < 16; i++) {} // while'}}))).toEqual([]);
 expect(loopProblems(item({wgsl:{...item().wgsl,material:'  for (var i = 0u; i < 300u; i++) {}'}}))[0]).toMatch(/at most 256/);
 expect(shaderProblems(item({kind:'lighting'}))).toEqual(['A lighting shader needs per-light code (WGSL and GLSL)']);
});
it('names bits after their content, gives them the parameters and time, and traces lines back to the user code',()=>{
 const a=item(),b=item({wgsl:{...item().wgsl,material:'  albedo = vec3<f32>(1.0);'}});
 expect(shaderHash(a)).toBe(shaderHash({...a,name:'Renamed'}));expect(shaderHash(a)).not.toBe(shaderHash(b));
 const [bit]=shaderBits(a) as unknown as {name:string;bindings:{material:Record<string,string>};gpu:{fragment:{material:string}}}[];
 expect(bit.name).toBe(`olive-extra-${shaderHash(a)}`);expect(bit.bindings.material).toEqual({time:'f32',amount:'f32',tint:'vec4<f32>'});
 expect(shaderBits(item({kind:'lighting',wgsl:{...a.wgsl,perLight:'x'},glsl:{...a.glsl,perLight:'x'}})).length).toBe(2);
 const generated=['line 1','line 2',...wrap('material','  first\n  second\n  third').split('\n'),'after'].join('\n'),at=generated.split('\n').indexOf('  second')+1;
 expect(userLine(generated,at)).toEqual({section:'material',line:2});expect(userLine(generated,1)).toBeNull();expect(userLine(generated,generated.split('\n').length)).toBeNull();
 const m=new ShaderMaterial3D(item({kind:'material'}),'#ffffff');expect(m.lit).toBe(false);m.destroy();
});
const defs=()=>new Map([transformDefinition,transform3dDefinition,viewport3dDefinition,model3dDefinition,...authoring3dDefinitions].map(d=>[d.type,d]));
function fixture(library:ShaderItem[],validator?:ShaderValidatorPort){const scene=new SceneService(defs),editor=new Authoring3D(scene,()=>{},()=>null,()=>true,()=>({x:480,y:270})),view=editor.createView().viewId,host=new Container(),warnings:string[]=[];
 scene.document.transact('Shader',d=>{d.entities.find(e=>e.name==='Cube')!.components.push({id:'sh',type:'pixi3d.shader',version:1,data:{shaderId:'s1',values:{amount:.25}}});});
 const p=new Scene3DProjection({node:(id:string)=>id===view?host:undefined,changed(){},report(e:unknown){throw e;},shaderLibrary:()=>({version:1,items:library}),...validator?{shaderValidator:validator}:{},warn:m=>warnings.push(m)});
 const mesh=()=>p.slots[0].nodes.get(scene.document.current.entities.find(e=>e.name==='Cube')!.id)!.children.find(c=>c instanceof Mesh3D) as Mesh3D;
 return{scene,p,mesh,warnings};}
/** A checker whose answers the test gives: pending until resolved, then cached like the real one. */
function fakeValidator(){const results=new Map<string,ShaderCheck>(),waits:{id:string;resolve(r:ShaderCheck):void}[]=[];
 const port:ShaderValidatorPort={peek:(key,b)=>results.get(`${b}|${key}`),check:(key,b,build)=>{const done=results.get(`${b}|${key}`);if(done)return Promise.resolve(done);build().material.destroy();return new Promise<ShaderCheck>(resolve=>waits.push({id:`${b}|${key}`,resolve:r=>{results.set(`${b}|${key}`,r);resolve(r);}}));}};
 return{port,answer:async(r:ShaderCheck)=>{for(const w of waits.splice(0))w.resolve(r);await Promise.resolve();await Promise.resolve();}};}
it('keeps the object\'s own material until the shader compiled on this backend, then writes values and game time without a rebuild',async()=>{
 const v=fakeValidator(),{scene,p,mesh}=fixture([item()],v.port);
 try{p.sync(scene.document.current);const base=mesh().material;expect((base.extraBits??[]).length).toBe(0);
  await v.answer({state:'ok',errors:[]});expect(p.sync(scene.document.current)).toBe(true);
  const shaded=mesh().material,data=shaded.data as unknown as {amount:number;tint:Float32Array;time:number};
  expect(shaded).not.toBe(base);expect(shaded.extraBits.some(b=>b.name.startsWith('olive-extra-'))).toBe(true);expect(data.amount).toBe(.25);expect(Array.from(data.tint).map(x=>+x.toFixed(3))).toEqual([1,0,0,1]);
  scene.document.transact('Tune',d=>{(d.entities.find(e=>e.name==='Cube')!.components.find(c=>c.type==='pixi3d.shader')!.data as {values:{amount:number}}).values.amount=.9;});
  expect(p.sync(scene.document.current)).toBe(false);expect(data.amount).toBeCloseTo(.9,5);
  p.setParticleTime(2.5);expect(data.time).toBe(2.5);
 }finally{void p.dispose();}
});
it('falls back to the own material with one warning when the shader fails, and Play\'s check reports the user\'s line',async()=>{
 const v=fakeValidator(),{scene,p,mesh,warnings}=fixture([item()],v.port);
 try{p.sync(scene.document.current);const base=mesh().material;await v.answer({state:'failed',errors:[{section:'material',line:1,message:"unresolved value 'nope'"}]});
  p.sync(scene.document.current);expect((mesh().material.extraBits??[]).length).toBe(0);expect(mesh().material.constructor).toBe(base.constructor);p.sync(scene.document.current);
  expect(warnings).toEqual([expect.stringContaining("Cube: shader \"Stripes\" does not compile on WebGL: material line 1: unresolved value 'nope'")]);
  const failed=p.verifyShaders(['webgl','webgpu']);await new Promise(r=>setTimeout(r,0));await v.answer({state:'failed',errors:[{section:'material',line:1,message:'bad'}]});
  expect(await failed).toEqual([expect.stringContaining("does not compile on WebGL: material line 1: unresolved value 'nope'"),expect.stringContaining('does not compile on WebGPU: material line 1: bad')]);
 }finally{void p.dispose();}
});
it('preflights Shader 3D: a missing shader, wrong values, unsafe loops and objects it cannot go on',()=>{
 const {scene}=fixture([]);const problems=(lib:ShaderItem[])=>runtime3DProblems(scene.document.current,undefined,{version:1,items:lib}).join('\n');
 expect(problems([])).toContain('Shader 3D: the shader s1 is not in this project');
 expect(problems([item({params:[{name:'amount',type:'color',default:'#ffffff'}]})])).toContain('amount must be a #rrggbb colour');
 expect(problems([item({wgsl:{...item().wgsl,material:'while (true) {}'}})])).toContain('while and loop are not allowed');
 expect(problems([item()])).not.toContain('Shader 3D');
 scene.document.transact('Paint',d=>{d.entities.find(e=>e.name==='Cube')!.components.push({id:'pt',type:'pixi3d.paintable',version:1,data:{}});});
 expect(problems([item()])).toContain("Shader 3D can't go with");
});
