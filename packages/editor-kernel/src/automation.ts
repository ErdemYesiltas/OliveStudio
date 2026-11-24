import type {AutomationContext,AutomationToolDefinition} from '@rewrite/sdk';

export class AutomationError extends Error {
 constructor(readonly code:string,message:string){super(message);this.name='AutomationError';}
}
export interface AutomationEntry {id:string;owner:string;value:AutomationToolDefinition}
export interface AutomationSnapshot {generation:number;revision:number;sceneId?:string}
export interface AutomationJob {
 id:string;tool:string;state:'awaiting_approval'|'running'|'complete'|'failed'|'cancelled';
 progress?:{completed:number;total:number;message:string};
 createdAt:number;finishedAt?:number;result?:unknown;error?:{code:string;message:string};
 context:AutomationSnapshot;input:unknown;cancellable:boolean;
}
export interface AutomationGuard {generation?:number;revision?:number;sceneId?:string}
const failure=(error:unknown)=>({code:error instanceof AutomationError?error.code:'TOOL_FAILED',message:error instanceof Error?error.message:String(error)});
/** Transport independent: MCP and the built-in assistant share validation, ordering and transactions. */
export class AutomationExecutor {
 private queue:Promise<unknown>=Promise.resolve();
 private listeners=new Set<()=>void>();
 private tasks=new Map<string,{job:AutomationJob;controller:AbortController;entry:AutomationEntry;input:unknown;expiry?:ReturnType<typeof setTimeout>}>();
 private dead=false;
 version=0;
 constructor(private options:{entries():readonly AutomationEntry[];snapshot():AutomationSnapshot;editable(tool?:AutomationToolDefinition,preempting?:boolean):void;batch(label:string,work:()=>void):void}){}
 subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
 private changed(){this.version++;for(const listener of this.listeners)listener();}
 list(){return this.options.entries().map(({id,owner,value})=>({name:id,owner,description:value.description,inputSchema:value.inputSchema,...(value.outputSchema?{outputSchema:value.outputSchema}:{}),annotations:{readOnlyHint:value.effect==='read'||Boolean(value.readOnly),destructiveHint:Boolean(value.approval),openWorldHint:false},effect:value.effect,undoable:value.undoable??value.effect==='edit',approval:Boolean(value.approval)}));}
 jobs(){return [...this.tasks.values()].map(t=>structuredClone(t.job));}
 job(id:string){const task=this.tasks.get(id);if(!task)throw new AutomationError('JOB_NOT_FOUND','Unknown automation job');return structuredClone(task.job);}
 wait(id:string,ms=0):Promise<AutomationJob>{
  const current=this.job(id);if(!ms||current.finishedAt!==undefined)return Promise.resolve(current);
  return new Promise(resolve=>{let done=false;const finish=()=>{if(done)return;done=true;clearTimeout(timer);off();resolve(this.job(id));};const off=this.subscribe(()=>{if(this.job(id).finishedAt!==undefined)finish();});const timer=setTimeout(finish,Math.min(10000,Math.max(0,ms)));});
 }
 private entry(name:string){const entry=this.options.entries().find(e=>e.id===name);if(!entry)throw new AutomationError('TOOL_NOT_FOUND',`Unknown or inactive tool: ${name}`);return entry;}
 private parse(entry:AutomationEntry,input:unknown){try{return entry.value.parse(input);}catch(error){throw new AutomationError('INVALID_ARGUMENT',error instanceof Error?error.message:String(error));}}
 private output(entry:AutomationEntry,result:unknown){const value=result===undefined?{ok:true}:result;return entry.value.parseOutput?entry.value.parseOutput(value):value;}
 private synchronous(entry:AutomationEntry){if(entry.value.execute.constructor.name==='AsyncFunction')throw new AutomationError('ASYNC_EDIT','Document edits must be synchronous');}
 cancelPending(){for(const [id,task]of this.tasks)if(task.job.state==='awaiting_approval'||task.job.state==='running'&&task.job.cancellable)this.cancel(id);}
 private check(guard:AutomationGuard){
  if(this.dead)throw new AutomationError('CLOSED','Automation is closed');
  const now=this.options.snapshot();
  if(guard.generation!==undefined&&guard.generation!==now.generation||guard.revision!==undefined&&guard.revision!==now.revision||guard.sceneId!==undefined&&guard.sceneId!==now.sceneId)throw new AutomationError('STALE_CONTEXT','The project, scene or document changed. Read its state and retry.');
  return now;
 }
 private preempting(name:string,args:unknown){const entry=this.options.entries().find(e=>e.id===name);if(!entry?.value.preempts||entry.value.effect!=='session'||entry.value.approval)return undefined;try{const input=entry.value.parse(args);return entry.value.preempts(input)?{entry,input}:undefined;}catch{return undefined;}}
 private serial<T>(work:()=>T|Promise<T>):Promise<T>{const next=this.queue.then(work);this.queue=next.catch(()=>{});return next;}
 execute(name:string,args:unknown={},guard:AutomationGuard={}):Promise<unknown>{
  const initial=this.options.snapshot(),preempt=this.preempting(name,args);
  if(preempt)return Promise.resolve().then(()=>{const context=this.check({generation:initial.generation,sceneId:initial.sceneId,...guard});this.options.editable(preempt.entry.value,true);return Promise.resolve(preempt.entry.value.execute(preempt.input,{...context,signal:new AbortController().signal})).then(value=>this.output(preempt.entry,value));});
  return this.serial(()=>{
   const context=this.check({generation:initial.generation,sceneId:initial.sceneId,...guard}),entry=this.entry(name),input=this.parse(entry,args);
   if(entry.value.effect!=='read'&&!entry.value.readOnly)this.options.editable(entry.value);
   if(entry.value.effect==='job'||entry.value.approval)return this.start(entry,input,context);
   const signal=new AbortController().signal;
   if(entry.value.effect==='edit'){
    this.synchronous(entry);let result:unknown;this.options.batch(`AI: ${name}`,()=>{result=entry.value.execute(input,{...context,signal});if(result instanceof Promise)throw new AutomationError('ASYNC_EDIT','Document edits must be synchronous; use a job for async work');result=this.output(entry,result);});return result;
   }
   return Promise.resolve(entry.value.execute(input,{...context,signal})).then(value=>this.output(entry,value));
  });
 }
 executeBatch(calls:readonly {name:string;arguments?:unknown}[],guard:AutomationGuard={}):Promise<unknown>{
  const initial=this.options.snapshot();
  return this.serial(()=>{
   const context=this.check({generation:initial.generation,sceneId:initial.sceneId,...guard});this.options.editable();
   if(!calls.length||calls.length>100)throw new AutomationError('INVALID_BATCH','A batch needs 1–100 document edits');
   const prepared=calls.map(call=>{const entry=this.entry(call.name);if(entry.value.effect!=='edit'||entry.value.approval)throw new AutomationError('INVALID_BATCH',`${call.name} is not a synchronous document edit`);this.synchronous(entry);return{entry,input:this.parse(entry,call.arguments??{})};});
   const results:unknown[]=[];this.options.batch('AI: edit batch',()=>{for(const {entry,input}of prepared){const result=entry.value.execute(input,{...context,signal:new AbortController().signal});if(result instanceof Promise)throw new AutomationError('ASYNC_EDIT','Async work is not allowed in a document batch');results.push(this.output(entry,result));}});return{results,context:this.options.snapshot()};
  });
 }
 private start(entry:AutomationEntry,input:unknown,context:AutomationSnapshot){
  // Bound retained history; pending/running work is never silently evicted.
  if(this.tasks.size>=100){const old=[...this.tasks].find(([,t])=>t.job.finishedAt!==undefined);if(old)this.tasks.delete(old[0]);else throw new AutomationError('BUSY','Too many pending automation jobs');}
  const id=globalThis.crypto.randomUUID(),controller=new AbortController(),job:AutomationJob={id,tool:entry.id,state:entry.value.approval?'awaiting_approval':'running',createdAt:Date.now(),context,input,cancellable:entry.value.cancellable!==false};
  const task:{job:AutomationJob;controller:AbortController;entry:AutomationEntry;input:unknown;expiry?:ReturnType<typeof setTimeout>}={job,controller,entry,input};
  this.tasks.set(id,task);if(entry.value.approval)task.expiry=setTimeout(()=>{if(job.state==='awaiting_approval'){job.state='failed';job.error={code:'APPROVAL_EXPIRED',message:'Approval request expired; submit a new operation'};job.finishedAt=Date.now();this.changed();}},5*60_000);this.changed();
  if(!entry.value.approval)void this.run(id);
  return{id,state:job.state};
 }
 /** Only the editor UI calls this method; never register it as an AI tool. */
 approve(id:string){return this.serial(()=>{const task=this.tasks.get(id);if(!task||task.job.state!=='awaiting_approval')throw new AutomationError('JOB_NOT_PENDING','This request is no longer pending');clearTimeout(task.expiry);try{if(Date.now()-task.job.createdAt>5*60_000)throw new AutomationError('APPROVAL_EXPIRED','Approval request expired; submit a new operation');this.check(task.job.context);this.options.editable(task.entry.value);task.job.state='running';this.changed();void this.run(id);}catch(error){task.job.state='failed';task.job.error=failure(error);task.job.finishedAt=Date.now();this.changed();throw error;}});}
 cancel(id:string){const task=this.tasks.get(id);if(!task)throw new AutomationError('JOB_NOT_FOUND','Unknown automation job');if(task.job.finishedAt!==undefined)return;if(task.job.state==='running'&&!task.job.cancellable)throw new AutomationError('NOT_CANCELLABLE','This atomic file operation has already started; wait for its result');clearTimeout(task.expiry);task.controller.abort();task.job.state='cancelled';task.job.finishedAt=Date.now();this.changed();}
 private async run(id:string){
  const task=this.tasks.get(id)!;
  try{
   const active=this.entry(task.entry.id);if(active.value!==task.entry.value)throw new AutomationError('STALE_TOOL','The tool changed');
   this.check({generation:task.job.context.generation});
   const result=await task.entry.value.execute(task.input,{...task.job.context,signal:task.controller.signal,report:progress=>{if(task.job.finishedAt===undefined){task.job.progress={completed:Math.max(0,Math.min(progress.total,progress.completed)),total:Math.max(0,progress.total),message:progress.message.slice(0,300)};this.changed();}}} satisfies AutomationContext);
   if(!task.controller.signal.aborted){if(!task.entry.value.changesProject&&!(task.entry.value.readOnly&&result&&typeof result==='object'&&'state'in result&&result.state==='cancelled'))this.check({generation:task.job.context.generation});task.job.result=this.output(task.entry,result);task.job.state='complete';}
  }catch(error){if(!task.controller.signal.aborted){task.job.state='failed';task.job.error=failure(error);}}
  finally{task.job.finishedAt??=Date.now();this.changed();}
 }
 dispose(){this.dead=true;for(const [id,task]of this.tasks){clearTimeout(task.expiry);if(task.job.finishedAt===undefined){clearTimeout(task.expiry);task.controller.abort();task.job.state='cancelled';task.job.finishedAt=Date.now();}void id;}this.changed();this.listeners.clear();}
}
