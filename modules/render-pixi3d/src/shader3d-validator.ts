import {Application,type WebGPURenderer} from 'pixi.js';
import {AmbientLight,Geometry3D,Mesh3D,View3D,type BaseMaterial3D} from '@pixi/3d';
import {installCspUniformCompatibility} from './csp';
import {userLine} from './shader3d';
// Compiles user shaders where nobody sees them: one hidden PixiJS app per backend (never added to the page), kept for
// the session. A shader reaches a real 3D view only after it drew here on that view's backend.
export type ShaderBackend='webgl'|'webgpu';
export interface ShaderError{section:string|null;line:number|null;message:string}
/** ok: compiled and drew; failed: errors (with the user's section and line when they fall inside the user's code); unavailable: no such backend here. */
export interface ShaderCheck{state:'ok'|'failed'|'unavailable';errors:ShaderError[];
 /** What the hidden app did: its renderer, shader sources it compiled, whether one held the user's code, a lost context (for diagnosing a check). */
 details?:{renderer:string;sources:number;messages:number;userCodeSeen:boolean;contextLost:boolean;reason?:string}}
/** What a check draws: the material as the 3D view would build it, and which vertex attributes its mesh has. */
export interface ShaderBuild{material:BaseMaterial3D;attributes:{uv:boolean;color:boolean;color1:boolean};
 /** The user's code as it appears in this backend's generated source (fingerprint() in shader3d), to confirm it really compiled. */
 code?:Partial<Record<ShaderBackend,string>>}
export interface ShaderValidatorPort{check(key:string,backend:ShaderBackend,build:()=>ShaderBuild):Promise<ShaderCheck>;peek(key:string,backend:ShaderBackend):ShaderCheck|undefined}
interface Hidden{app:Application;view:View3D;sources:string[];known:Map<string,ShaderCheck>;device?:GPUDevice;gl?:WebGL2RenderingContext;uncaptured:string[]}
/** The attribute set the real mesh has, on one triangle (formats do not change what the shader declares). */
function probeGeometry(a:ShaderBuild['attributes']){const n=new Float32Array([0,0,1,0,0,1,0,0,1]);
 return new Geometry3D({positions:new Float32Array([-1,-1,0,1,-1,0,0,1,0]),normals:n,...a.uv?{uvs:new Float32Array([0,0,1,0,.5,1])}:{},...a.color?{colors:new Float32Array(12).fill(1)}:{},...a.color1?{colors1:new Float32Array(12).fill(1)}:{}});}
export class ShaderValidator implements ShaderValidatorPort{
 private apps=new Map<ShaderBackend,Promise<Hidden|null>>();private results=new Map<string,ShaderCheck>();private running=new Map<string,Promise<ShaderCheck>>();private queue:Promise<unknown>=Promise.resolve();
 peek(key:string,backend:ShaderBackend){return this.results.get(`${backend}|${key}`);}
 check(key:string,backend:ShaderBackend,build:()=>ShaderBuild):Promise<ShaderCheck>{const id=`${backend}|${key}`,done=this.results.get(id);if(done)return Promise.resolve(done);
  let run=this.running.get(id);if(!run){
   // One check at a time: each one reads the console and the GPU error scope of a shared hidden app.
   run=(this.queue=this.queue.then(()=>this.run(backend,build),()=>this.run(backend,build))).then(result=>{this.results.set(id,result);this.running.delete(id);return result;},error=>{const result:ShaderCheck={state:'failed',errors:[{section:null,line:null,message:String(error instanceof Error?error.message:error)}]};this.results.set(id,result);this.running.delete(id);return result;});
   this.running.set(id,run);}
  return run;}
 private hidden(backend:ShaderBackend){let app=this.apps.get(backend);if(!app){app=this.open(backend).catch(()=>null);this.apps.set(backend,app);}return app;}
 private async open(backend:ShaderBackend):Promise<Hidden|null>{
  if(backend==='webgpu'&&!(globalThis.navigator as Navigator&{gpu?:unknown})?.gpu)return null;
  const app=new Application();await app.init({preference:backend,width:32,height:32,autoStart:false,antialias:false,background:'#000000'});
  if(app.renderer.name!==backend){app.destroy(true);return null;}
  installCspUniformCompatibility(app.renderer);
  const view=new View3D({width:32,height:32,autoResize:false});view.camera.position.set(0,0,3);view.camera.lookAt({x:0,y:0,z:0});view.root.addChild(new AmbientLight({intensity:1}));app.stage.addChild(view);
  // The hidden app owns its device or context, so it sees every source it compiles (to map error lines).
  const hidden:Hidden={app,view,sources:[],known:new Map(),uncaptured:[]};
  if(backend==='webgpu'){const device=(app.renderer as WebGPURenderer).gpu.device,create=device.createShaderModule.bind(device);device.createShaderModule=d=>{hidden.sources.push(d.code);return create(d);};device.addEventListener('uncapturederror',e=>hidden.uncaptured.push((e as GPUUncapturedErrorEvent).error.message));hidden.device=device;}
  else{const gl=(app.renderer as unknown as {gl:WebGL2RenderingContext}).gl,set=gl.shaderSource.bind(gl),compile=gl.compileShader.bind(gl),link=gl.linkProgram.bind(gl);gl.shaderSource=(shader,src)=>{hidden.sources.push(src);set(shader,src);};
   // Read the status from GL itself: PixiJS's own error log may be quiet in production builds (the packaged editor).
   gl.compileShader=shader=>{compile(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))hidden.uncaptured.push(gl.getShaderInfoLog(shader)??'GLSL compile failed');};
   gl.linkProgram=program=>{link(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))hidden.uncaptured.push(`GLSL link failed: ${gl.getProgramInfoLog(program)??''}`);};hidden.gl=gl;}
  return hidden;}
 private async run(backend:ShaderBackend,build:()=>ShaderBuild):Promise<ShaderCheck>{const hidden=await this.hidden(backend);if(!hidden)return{state:'unavailable',errors:[]};
  const {app,view,device}=hidden,messages:string[]=[],keep={error:console.error,warn:console.warn};hidden.sources.length=0;hidden.uncaptured.length=0;
  let mesh:Mesh3D|undefined,geometry:Geometry3D|undefined,material:BaseMaterial3D|undefined;
  console.error=(...a:unknown[])=>{messages.push(a.map(String).join(' '));};console.warn=(...a:unknown[])=>{messages.push(a.map(String).join(' '));};
  let code='';
  try{const b=build();code=b.code?.[backend]??'';material=b.material;geometry=probeGeometry(b.attributes);mesh=new Mesh3D({geometry,material});view.root.addChild(mesh);
   device?.pushErrorScope('validation');
   try{app.renderer.render(app.stage);}catch(error){messages.push(error instanceof Error?error.message:String(error));}
   if(device){const e=await device.popErrorScope();if(e)messages.push(e.message);await device.queue.onSubmittedWorkDone();}
   messages.push(...hidden.uncaptured);
  }catch(error){messages.push(error instanceof Error?error.message:String(error));}
  finally{console.error=keep.error;console.warn=keep.warn;mesh?.removeFromParent();mesh?.destroy();geometry?.destroy();material?.destroy();}
  const seen=new Set<string>(),errors=messages.filter(m=>/error|ERROR|Could not|invalid/i.test(m)).flatMap(m=>this.locate(m,hidden.sources)).filter(e=>{const k=`${e.section}|${e.line}|${e.message}`;if(seen.has(k))return false;seen.add(k);return true;});
  // PixiJS compiles a program once per renderer and reuses it (failed ones too), so a later check of the same code may
  // compile nothing: then the answer is what that code did when it really compiled here, kept per code.
  const compiled=code?hidden.sources.some(src=>src.includes(code)):hidden.sources.some(src=>src.includes('// @olive-shader')),contextLost=Boolean(hidden.gl?.isContextLost()),details={renderer:app.renderer.name,sources:hidden.sources.length,messages:messages.length,userCodeSeen:compiled,contextLost};
  if(compiled){const result:ShaderCheck=errors.length?{state:'failed',errors,details}:{state:'ok',errors:[],details};if(code){hidden.known.set(code,result);if(hidden.known.size>256)hidden.known.delete(hidden.known.keys().next().value!);}return result;}
  if(errors.length)return{state:'failed',errors,details};
  const known=code?hidden.known.get(code):undefined;if(known)return{...known,details:{...details,reason:'compiled earlier in this session'}};
  // Never report a shader as compiling when its code did not reach the GPU (a lost context, a skipped draw): that is
  // "could not check here", which Play does not count as a failure but the panel shows.
  if(contextLost)this.apps.delete(backend);
  return{state:'unavailable',errors:[],details:{...details,reason:contextLost?'the hidden WebGL context was lost':'the hidden check did not compile the shader'}};}
 /** WGSL ":line:col error" or GLSL "ERROR: 0:line:", traced to the user's section and line in the source that has it. */
 private locate(message:string,sources:string[]):ShaderError[]{
  // GLSL logs the whole source after the error line; keep the error lines only.
  if(/^\d+: /m.test(message)&&!/ERROR:/.test(message))return[];
  const lines=[...message.matchAll(/:(\d+):\d+ error: ([^\n]*)/g)].map(m=>({line:Number(m[1]),text:m[2]})).concat([...message.matchAll(/ERROR: \d+:(\d+): ([^\n]*)/g)].map(m=>({line:Number(m[1]),text:m[2]})));
  if(!lines.length)return/Could not initialize shader/.test(message)?[]:[{section:null,line:null,message:message.split('\n')[0].slice(0,300)}];
  return lines.map(({line,text})=>{for(const src of sources){const at=userLine(src,line);if(at)return{section:at.section,line:at.line,message:text.slice(0,300)};}return{section:null,line:null,message:text.slice(0,300)};});}
 dispose(){for(const app of this.apps.values())void app.then(h=>h?.app.destroy(true));this.apps.clear();}
}
let shared:ShaderValidator|undefined;
/** One validator per page (editor or game). */
export const shaderValidator=()=>shared??=new ShaderValidator();
