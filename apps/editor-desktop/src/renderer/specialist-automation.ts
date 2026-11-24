import {z} from 'zod';
import {automationTools,automationTool,type AutomationContext,type AutomationToolDefinition,type EditorModule} from '@rewrite/sdk';
import {summarize,toCsv,type ProfileRecorder} from '@rewrite/profiler';
import {SfxSchema,sfxPresets,presetSfx,renderSfx,encodeWav} from '@rewrite/audio/sfx';
import type {scriptDebugger} from '@rewrite/scripts/debug';
import type {HubFileInfo} from '@rewrite/ai-hub/contracts';

export interface SpecialistPorts {
 profiler:ProfileRecorder;
 debugger:typeof scriptDebugger;
 scriptExists(id:string):boolean;
 sound(bytes:Uint8Array,name:string,place:boolean,context:AutomationContext):Promise<unknown>;
 hub:{files():Promise<HubFileInfo[]>;import(id:string,check:()=>void):Promise<unknown>;animate(id:string,frames:number,fps:number,check:()=>void):Promise<unknown>;upload(bytes:Uint8Array,name:string):Promise<HubFileInfo>;remove(id:string):Promise<void>};
 readUpload(path:string):Promise<{bytes:Uint8Array;name:string}>;
 git:Window['platform']['git'];
 open(result:{text:string;path:string;warnings:string[]}):Promise<void>;
 fileAction(work:()=>Promise<void>):Promise<void>;
 currentFile():Promise<string|null>;
 dirty():boolean;
 check(context:AutomationContext):void;
}
/** Presentation/native adapters are packaged feature modules, never a generic host command/eval escape hatch. */
export function specialistModules(access:()=>SpecialistPorts):EditorModule[]{
 const empty=z.object({}).strict(),id=z.string().min(1).max(200);
 const module=(name:string,register:(add:<T>(suffix:string,schema:z.ZodType<T>,definition:Parameters<typeof automationTool<T>>[1])=>void)=>void):EditorModule=>({
  manifest:{id:name,version:'1.0.0',apiVersion:1,requires:{studio:'^1'}},
  activate(context){register((suffix,schema,definition)=>{
   const definitionWithScope:AutomationToolDefinition=automationTool(schema,{...definition,execute:(input,job)=>{
    const signal=AbortSignal.any([context.signal,job.signal]);signal.throwIfAborted();return definition.execute(input,{...job,signal});
   }});
   context.contribute(automationTools,`${name}.${suffix}`,definitionWithScope);
  });},
 });
 return[
  module('profiler',add=>{
   add('state',empty,{description:'Read recording state and frame/system performance summary from the Profiler panel.',effect:'read',execute:()=>{const p=access().profiler;return{paused:p.paused,capacity:p.capacity,summary:summarize(p.samples())};}});
   add('control',z.object({action:z.enum(['record','pause','clear'])}).strict(),{description:'Start/resume or pause recording, or clear recorded Profiler frames. Does not change game playback.',effect:'session',execute:a=>{const p=access().profiler;if(a.action==='clear')p.clear();else p.paused=a.action==='pause';return{paused:p.paused,frames:p.samples().length};}});
   add('frames',z.object({offset:z.number().int().min(0).default(0),limit:z.number().int().min(1).max(200).default(50)}).strict(),{description:'Read a page of captured Profiler frames, including per-system timings and draw calls.',effect:'read',execute:a=>{const frames=access().profiler.samples();return{total:frames.length,nextOffset:a.offset+a.limit<frames.length?a.offset+a.limit:null,items:frames.slice(a.offset,a.offset+a.limit)};}});
   add('csv',empty,{description:'Return the Profiler capture as CSV data (no filesystem writes).',effect:'read',execute:()=>({csv:toCsv(access().profiler.samples())})});
  }),
  module('debugger',add=>{
   const state=()=>{const d=access().debugger;return{connected:Boolean(d.controller),paused:d.controller?.paused()??false,hit:d.hit,breakpoints:Object.fromEntries(d.breakpoints),validLines:Object.fromEntries(d.valid),watches:d.watches,instances:d.controller?.instances()??[]};};
   add('state',empty,{description:'Read script debugger hit, instances, valid lines, breakpoints and watch expressions.',effect:'read',execute:state});
   add('breakpoint',z.object({scriptId:id,line:z.number().int().min(1).max(200000),enabled:z.boolean()}).strict(),{description:'Set or clear a script breakpoint. Uses the same debugger as Monaco; only known scripts are accepted.',effect:'session',execute:a=>{const p=access();if(!p.scriptExists(a.scriptId))throw Error('Script not found');if(p.debugger.lines(a.scriptId).includes(a.line)!==a.enabled)p.debugger.toggle(a.scriptId,a.line);return state();}});
   add('clear',empty,{description:'Clear all script breakpoints.',effect:'session',execute:()=>{access().debugger.clear();return state();}});
   add('watch',z.object({expression:z.string().trim().min(1).max(500),action:z.enum(['add','remove'])}).strict(),{description:'Add or remove a debugger watch. Expressions run only through the existing QuickJS debugger, never in the renderer.',effect:'session',execute:a=>{const d=access().debugger;if(a.action==='add'){if(d.watches.length>=32&&!d.watches.includes(a.expression))throw Error('At most 32 watches');d.addWatch(a.expression);}else d.removeWatch(a.expression);return state();}});
   add('evaluate',empty,{description:'Evaluate configured watches in the paused QuickJS runtime. Never evaluates renderer or Node code.',effect:'session',execute:()=>{const d=access().debugger;if(!d.controller?.paused())throw Error('Pause script Preview first');const live=d.controller.watch(d.watches);return{expressions:d.watches,values:d.watches.map((expression,index)=>d.hit?.watches[expression]??live[index])};}});
   add('control',z.object({action:z.enum(['step','resume'])}).strict(),{description:'Step or resume the paused script debugger through its actual Preview controller.',effect:'session',execute:a=>{const d=access().debugger;if(!d.controller?.paused())throw Error('Pause script Preview first');d.controller[a.action]();return state();}});
  }),
  module('soundlab',add=>{
   add('presets',empty,{description:'List Sound Lab presets and default synthesis parameters.',effect:'read',execute:()=>({presets:sfxPresets,defaults:SfxSchema.parse({}),schema:z.toJSONSchema(SfxSchema)})});
   add('preset',z.object({preset:z.enum(sfxPresets),seed:z.number().int().min(0).max(2147483647).default(1)}).strict(),{description:'Get deterministic editable synthesis parameters for a Sound Lab preset/variation.',effect:'read',execute:a=>presetSfx(a.preset,a.seed)});
   add('create',z.object({name:z.string().trim().min(1).max(100),parameters:SfxSchema,place:z.boolean().default(false)}).strict(),{description:'Synthesize a Sound Lab WAV through the existing synthesizer and asset importer. Optionally create an AudioSource object in the same undo transaction. Returns a job.',effect:'job',execute:(a,ctx)=>{ctx.signal.throwIfAborted();return access().sound(encodeWav(renderSfx(a.parameters)),a.name,a.place,ctx);}});
  }),
  module('git',add=>{
   add('status',empty,{description:'Read native Git availability, project folder, branch and working changes.',effect:'read',execute:()=>access().git.status()});
   add('history',empty,{description:'Read the saved project file history (up to 50 commits).',effect:'read',execute:()=>access().git.log()});
   const hash=z.string().regex(/^[0-9a-f]{7,40}$/);
   add('show',z.object({hash}).strict(),{description:'Read the project JSON at a commit for comparison. Does not modify files.',effect:'read',execute:async a=>({text:await access().git.show(a.hash)})});
   add('init',z.object({projectPath:id}).strict(),{description:'Initialize version control for the saved project folder after editor approval. No shell or remote operations.',effect:'job',approval:true,cancellable:false,execute:async(a,ctx)=>{const p=access();ctx.signal.throwIfAborted();if(await p.currentFile()!==a.projectPath)throw Error('Saved project path changed');p.check(ctx);return{initialized:await p.git.init()};}});
   add('commit',z.object({projectPath:id,message:z.string().trim().min(1).max(2000),files:z.array(z.string().min(1).max(1000)).min(1).max(200)}).strict(),{description:'Commit the explicit reviewed file list in the saved project folder through the native Git service after editor approval. Save dirty editor changes first. Does not push.',effect:'job',approval:true,cancellable:false,execute:async(a,ctx)=>{const p=access();ctx.signal.throwIfAborted();if(await p.currentFile()!==a.projectPath)throw Error('Saved project path changed');p.check(ctx);if(p.dirty())throw Error('Save the project before committing');return{hash:await p.git.commit(a.message,a.files)};}});
   add('restore',z.object({hash,projectPath:id}).strict(),{description:'Restore the project file from a commit and reopen it after editor approval. Save and commit/discard working changes first.',effect:'job',approval:true,cancellable:false,changesProject:true,execute:async(a,ctx)=>{const p=access();ctx.signal.throwIfAborted();if(await p.currentFile()!==a.projectPath)throw Error('Saved project path changed');p.check(ctx);if(p.dirty())throw Error('Save the project before restoring a version');let restored=false;await p.fileAction(async()=>{const result=await p.git.restore(a.hash);if(result){await p.open(result);restored=true;}});return{restored};}});
  }),
  module('hub-files',add=>{
   add('list',z.object({query:z.string().max(200).optional(),offset:z.number().int().min(0).default(0),limit:z.number().int().min(1).max(100).default(30)}).strict(),{description:'Search/page files belonging to this paired LocalHub device (uploads and generated media). Pairing and scopes remain user-controlled.',effect:'read',execute:async a=>{const all=(await access().hub.files()).filter(f=>!a.query||f.filename.toLowerCase().includes(a.query.toLowerCase()));return{total:all.length,nextOffset:a.offset+a.limit<all.length?a.offset+a.limit:null,items:all.slice(a.offset,a.offset+a.limit)};}});
   add('import',z.object({id}).strict(),{description:'Import a LocalHub image/audio file through the same conversion/library service as the Files tab. Returns a job.',effect:'job',execute:(a,ctx)=>{const p=access();return p.hub.import(a.id,()=>p.check(ctx));}});
   add('animate',z.object({id,frames:z.number().int().min(2).max(64).default(8),fps:z.number().int().min(1).max(60).default(12)}).strict(),{description:'Convert a LocalHub video to a sprite-sheet asset through the Files animation pipeline. Returns asset IDs and layout; place a pixi.flipbook separately.',effect:'job',execute:(a,ctx)=>{const p=access();return p.hub.animate(a.id,a.frames,a.fps,()=>p.check(ctx));}});
   add('upload',z.object({path:z.string().min(1)}).strict(),{description:'Upload a supported local file from an allowed folder to the paired LocalHub. Requires editor approval; never exposes file bytes to the model.',effect:'job',approval:true,cancellable:false,execute:async(a,ctx)=>{const p=access();p.check(ctx);const file=await p.readUpload(a.path);p.check(ctx);return p.hub.upload(file.bytes,file.name);}});
   add('delete',z.object({id}).strict(),{description:'Permanently delete this device\'s LocalHub file after editor approval, using existing Hub permissions.',effect:'job',approval:true,cancellable:false,execute:async(a,ctx)=>{ctx.signal.throwIfAborted();await access().hub.remove(a.id);return{deleted:a.id};}});
  }),
 ];
}
