import {RuntimeSession,type RuntimeEntity} from './runtime/index.js';
import type {RuntimeSystem} from './types.js';
import {TexturePool} from './textures.js';
import {Application,ExtensionType,extensions,type ApplicationPlugin,type Ticker} from 'pixi.js';

type CreateSystems=NonNullable<ConstructorParameters<typeof RuntimeSession>[1]>;
interface SceneStart {
 prepare():Promise<void>;
 validate?():void;
 started():void;
}

interface GameFramePorts {
 blocked?():boolean;
 idle?(seconds:number,session:RuntimeSession|null):void;
 beforeTick?(session:RuntimeSession):void;
 afterTick?(seconds:number,session:RuntimeSession):void;
 flush():void;
 eventsPending():boolean;
 project():void;
 publish?():void;
 paint?():void;
 fault?(error:unknown):void;
}

const coreOrder=['input','production','physics','tween','animation','audio','timers','navigation','achievements','dialogue','scripts','multiplayer'];
const rank=new Map(coreOrder.map((id,index)=>[id,index]));
const compareSystems=(a:RuntimeSystem,b:RuntimeSystem)=>(rank.get(a.id)??coreOrder.length)-(rank.get(b.id)??coreOrder.length);

/** One game world and frame subscription for each OliveStudio Pixi application. */
class PixiGameRuntime {
 private current:RuntimeSession|null=null;
 private starting:RuntimeSession|null=null;
 private framePorts?:GameFramePorts;
 private presenting=false;
 private detachTicker?:()=>void;
 get session(){return this.current;}

 attachTicker(ticker:Ticker){
  const frame=(elapsed:Ticker)=>this.tick(elapsed.deltaMS/1000);
  ticker.add(frame);
  this.detachTicker=()=>ticker.remove(frame);
 }

 setFramePorts(ports:GameFramePorts){this.framePorts=ports;}

 private tick(seconds:number){
  const ports=this.framePorts,session=this.current;
  if(!ports||ports.blocked?.())return;
  try{
   if(!session?.started||session.paused){ports.idle?.(seconds,session);return;}
   ports.beforeTick?.(session);
   session.advance(seconds);
   if(this.current!==session)return;
   this.present(false);
   if(this.current===session)ports.afterTick?.(seconds,session);
  }catch(error){
   if(ports.fault)ports.fault(error);
   else throw error;
  }
 }

 /** Project once, then handle events raised by visuals before publishing the final frame. */
 present(paint=true){
  const ports=this.framePorts,session=this.current;
  if(!ports||!session||this.presenting||ports.blocked?.())return;
  this.presenting=true;
  try{
   if(session.started)ports.flush();
   if(this.current!==session)return;
   ports.project();
   if(session.started&&ports.eventsPending()){
    ports.flush();
    if(this.current!==session)return;
    ports.project();
   }
   ports.publish?.();
   if(paint)ports.paint?.();
  }finally{this.presenting=false;}
 }

 step(){
  if(!this.current)return;
  this.current.step();
  this.present();
 }

 createScene(entities:readonly RuntimeEntity[],systems:CreateSystems,paused=false):RuntimeSession{
  if(this.current)throw Error('Stop the active game scene before creating another');
  const session=new RuntimeSession(entities,systems,{paused,deferStart:true,compareSystems});
  this.current=session;
  return session;
 }

 async startScene(session:RuntimeSession,options:SceneStart):Promise<boolean>{
  if(this.current!==session||session.started||this.starting===session)return false;
  this.starting=session;
  try{
   await options.prepare();
   if(this.current!==session||session.started)return false;
   options.validate?.();
   session.start();
   options.started();
   return true;
  }catch(error){
   if(this.current===session){
    try{this.stop();}catch(cleanup){throw new AggregateError([error,cleanup],'Scene startup and cleanup failed');}
   }
   throw error;
  }finally{if(this.starting===session)this.starting=null;}
 }

 stop(){
  const session=this.current;
  this.current=null;
  session?.dispose();
 }

 dispose(){
  this.framePorts=undefined;
  this.detachTicker?.();
  this.detachTicker=undefined;
  this.stop();
 }
}

/** Ordinary Pixi applications, including isolated editor previews, do not own a game runtime. */
export class PixiGameApplication extends Application {
 readonly game=new PixiGameRuntime();
 readonly textures:TexturePool;
 constructor(maxTextureBytes?:number){super();this.textures=new TexturePool(maxTextureBytes);}
}

const gameRuntimePlugin={
 // Bind after Pixi's ticker plugin has created this application's ticker, and unbind before it is destroyed.
 extension:{type:ExtensionType.Application,priority:-1000},
 init(this:Application){if(this instanceof PixiGameApplication)this.game.attachTicker(this.ticker);},
 destroy(this:Application){if(this instanceof PixiGameApplication){try{this.game.dispose();}finally{this.textures.dispose();}}},
} satisfies ApplicationPlugin&{extension:{type:ExtensionType.Application;priority:number}};

extensions.add(gameRuntimePlugin);
