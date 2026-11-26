import type {Json} from '@rewrite/sdk';
import {is2DEntity,spatialComponent,spatialType} from '@rewrite/scene';
import {destroyLocalApplication} from '@olivestudio/engine/lifecycle';
import {PixiGameApplication} from '@olivestudio/engine/game-application';
import {GameSceneObjects,GameSceneTransitions} from '@olivestudio/engine/game-scene';
import {clientEntity} from '@rewrite/multiplayer/contracts';
import 'pixi.js/unsafe-eval';
import {Container,Rectangle,Texture,TextureSource} from 'pixi.js';
import type {RuntimeEntity} from '@rewrite/runtime';
import {transform,SpawnDataSchema,spawnSection,type Entity,type Scene} from '@rewrite/scene';
import type {AssetRecord} from '@rewrite/assets';
import {FontMetadataSchema,fontFile,RenderSettingsSchema,renderSettingsSection,renderResolution,resolvePresentation} from '@olivestudio/engine/contracts';
import {loadFont,fontStack} from '@olivestudio/engine/fonts';
import {applyTransform2D} from '@olivestudio/engine/display';
import {SceneVisualProjection} from '@olivestudio/engine/scene-visuals';
import {screenSpace,screenOffset} from '@olivestudio/engine/screen';
import {createDebugOverlay,type DebugStats} from '@rewrite/render-pixi/overlay';
import {clickTarget} from '@olivestudio/engine/click';
import {cameraControls,idleCamera,snapCamera,resolveCameraFrame,viewPlacement,viewOffset,type CameraView,type RuntimeCameraState} from '@olivestudio/engine/runtime-camera';
import {clearSceneDecorators,decorateScene} from '@rewrite/render-pixi/visuals';
import type {TextureLease} from '@olivestudio/engine/textures';
import {isActive,createSceneInteractions,type TimerSession,type InteractionSession,builtinActions,mediaActions,visualActions,languageActions,cameraActions,saveActions,LocalizationSchema,localizationSection,createLanguageStore,matchLanguage,type LanguageStore,GlobalStore,formatRuntimeText,GlobalsSchema,defaultGlobals,globalsSection} from '@rewrite/interactions';
import type {GameBundle,PlayerPlugin,PlayerExtension,PlayerPluginContext,PlayerController} from './plugin';
export type {GameBundle} from './plugin';
/** Runtime-only Pixi projection. This package imports no React or Electron APIs. */
export class GamePlayer{
 readonly app=new PixiGameApplication();private root=new Container();
 /** Screen Space (HUD) objects: above the world, outside the camera, anchored when the screen size changes. */
 private ui=new Container();private timers:TimerSession|null=null;
 /** F3 debug overlay when the project turns it on for exported games. */
 private overlay:ReturnType<typeof createDebugOverlay>|null=null;
 private toggleOverlay=(e:KeyboardEvent)=>{if(e.key==='F3'){e.preventDefault();this.overlay?.toggle();}};
 private debugStats():DebugStats|null{if(!this.session)return null;const entities=this.sceneEntities,running=(d:unknown)=>Object.values((d??{}) as Record<string,{running?:boolean;state?:string}>).filter(x=>x.running||x.state==='playing').length;
  return{scene:this.bundle.project.scenes.find(s=>s.id===this.sceneId)?.name??'',objects:{active:entities.filter(e=>isActive(e,entities)).length,total:entities.length},tweens:running(this.controllers.get('tween')?.diagnostics),animations:running(this.controllers.get('animation')?.diagnostics),voices:running(this.controllers.get('audio')?.diagnostics),timers:running(this.timers?.diagnostics),globals:this.globals?.snapshot()};}private nodes=new Map<string,Container>();private images=new Map<string,Texture>();private subtextures=new Set<Texture>();private textureLeases=new Set<TextureLease>();private abort=new AbortController();private extensions:PlayerExtension[]=[];private controllers=new Map<string,PlayerController>();private services=new Map<string,unknown>();private inspectors=new Map<string,(query:unknown)=>Json>();private pointers=new Set<(phase:'down'|'move'|'up',x:number,y:number)=>boolean|void>();private sceneEntities:readonly Entity[]=[];
 private get session(){return this.app.game.session;}
 private interactions:InteractionSession|null=null;private transitions=new GameSceneTransitions();private loading=false;private disposed=false;private background=false;private userPaused=false;private globals?:GlobalStore;private language?:LanguageStore;private camera:RuntimeCameraState=idleCamera();private currentView:CameraView={x:480,y:270,zoom:1,rotation:0};
 /** The game camera for rules and scripts (follow, shake, zoom, look at a point) and the view it shows. */
 private cameraControls=cameraControls(()=>this.camera,()=>this.session?.time??0,()=>this.currentView);
 private visuals=new SceneVisualProjection({
  texture:id=>this.images.get(id),textures:this.app.textures,
  font:id=>fontStack(id,Boolean(id)&&this.fonts.has(id)),text:value=>formatRuntimeText(value,this.globals,this.language),rtl:()=>this.rtl,
  frame:()=>({token:String(this.epoch),time:this.session?.time??0,silent:!this.session?.started||this.session.paused,emit:Boolean(this.session?.started)}),
  changed:()=>{if(!this.disposed)this.app.render();},event:()=>{},
 });
 /** Last drawn shape/text look per component: timelines and scripts may change colours, sizes and text at runtime. */
 private fonts=new Set<string>();private epoch=0;private sceneId='';
 private authoredStage:{width:number;height:number};
 private resizePresentation=()=>{if(this.disposed)return;this.applyPresentation();if(this.session)this.app.game.present();else this.app.render();};
 private applyPresentation(){const result=resolvePresentation(RenderSettingsSchema.parse(this.bundle.project.extensions[renderSettingsSection]??{version:1}),this.authoredStage,{width:window.innerWidth,height:window.innerHeight});this.bundle.project.stage={...result.stage};this.host.style.setProperty('--stage-w',String(result.stage.width));this.host.style.setProperty('--stage-h',String(result.stage.height));this.host.dataset.stage=`${result.stage.width}x${result.stage.height}`;this.host.dataset.scale=result.settings.scaleMode;this.host.dataset.presentation=JSON.stringify({device:result.device,orientation:result.orientation,overridden:result.overridden});if(this.app.renderer){this.app.renderer.resize(result.stage.width,result.stage.height);this.app.stage.hitArea=this.app.screen;if(this.host.dataset.render){const render=JSON.parse(this.host.dataset.render);this.host.dataset.render=JSON.stringify({...render,width:this.app.canvas.width,height:this.app.canvas.height});}}}
 constructor(private host:HTMLElement,private bundle:GameBundle,private report:(message:string)=>void,plugins:readonly PlayerPlugin[]=[],private diagnostic?:(message:string)=>void){
  this.authoredStage={...bundle.project.stage??{width:960,height:540}};
  const ids=new Set<string>();for(const p of plugins){if(ids.has(p.id))throw Error('Duplicate player plugin: '+p.id);ids.add(p.id);}
  const sessionNow=()=>this.session,simulation={pause:()=>this.pause(),resume:()=>this.resume(),get paused(){return Boolean(sessionNow()?.paused);},get time(){return sessionNow()?.time??0;}};
  const ctx:PlayerPluginContext={bundle,simulation,host:this.host,act:(action,silent,owner)=>this.interactions?.runAction(action,silent,owner),signal:this.abort.signal,view:()=>({x:this.currentView.x,y:this.currentView.y}),camera:this.cameraControls,spawn:(name,x,y)=>this.spawnObject({name},x,y),spawnEntity:(id,x,y)=>this.spawnObject({id},x,y),destroy:id=>this.destroyObject(id),globals:()=>this.globals,language:()=>this.language,assets:{get:id=>this.asset(id),url:(a,file='image.webp')=>this.url(a,file)},controllers:this.controllers,inspectors:this.inspectors,services:this.services,toGlobal:(x,y)=>{const p=this.root.toGlobal({x,y});return{x:p.x,y:p.y};},pointer:listener=>{this.pointers.add(listener);return()=>{this.pointers.delete(listener);};},entities:()=>this.sceneEntities,frame:()=>({token:String(this.epoch),time:this.session?.time??0,silent:!this.session?.started||this.session.paused,emit:Boolean(this.session?.started)}),changed:()=>{if(!this.disposed&&this.app.renderer)this.app.render();},emit:e=>this.interactions?.emit(e),setActive:(id,v)=>{const e=this.sceneEntities.find(x=>x.id===id);if(e)e.active=v;},changeScene:id=>{this.transitions.request(id);},addScene:id=>this.addScene(id),removeScene:id=>this.removeScene(id),invoke:(service,method,id)=>{const controller=this.controllers.get(service);if(!controller)throw Error('Interaction service unavailable: '+service);controller[method](id);},time:()=>this.session?.time??0,publish:e=>{for(const x of this.extensions)x.event?.(e);},report:message=>{if(this.additions?.active)this.warn(message);else this.report(message);}};
  try{for(const plugin of plugins)this.extensions.push(plugin.create(ctx));}catch(e){this.abort.abort();const errors:unknown[]=[e];for(const x of [...this.extensions].reverse()){try{x.dispose();}catch(error){errors.push(error);}}throw new AggregateError(errors,'Runtime plugin activation failed');}
  this.app.game.setFramePorts({
   blocked:()=>Boolean(this.additions?.active),
   idle:(_seconds,session)=>{if(!this.loading&&session?.started&&this.interactions?.eventsPending)this.app.game.present(false);},
   flush:()=>this.interactions?.flush(),eventsPending:()=>this.interactions?.eventsPending??false,
   project:()=>this.projectFrame(),publish:()=>this.publishFrame(),paint:()=>this.app.render(),
   afterTick:()=>{
    const next=this.transitions.take(this.bundle.project.scenes);
    if(next)void this.load(next).catch(error=>this.runtimeFault(error));
   },
   fault:error=>this.runtimeFault(error),
  });
 }
 /** Recoverable resource failures belong to their pending scene, never the fatal player callback. */
 private warnings:string[]=[];
 private warn(message:string){this.warnings.push(message);if(this.warnings.length>20)this.warnings.shift();this.host.dataset.runtimeWarnings=JSON.stringify(this.warnings);if(this.diagnostic){try{this.diagnostic(message);}catch(error){console.warn('Runtime diagnostic callback failed',error);}}else console.warn(message);}
 private asset(id:string){return this.bundle.assets.find(a=>a.id===id);}
 private url(a:AssetRecord,file:string){const path=this.bundle.files[a.id]?.[file];if(!path)throw Error(`Missing exported file: ${a.name}/${file}`);return new URL(path,document.baseURI).href;}
 /** Rules reach physics through whatever the physics plugin offers (errors when the scene has none). */
 private physicsBridge={setVelocity:(id:string,x:number,y:number)=>this.physicsService().setVelocity(id,x,y),setAngularVelocity:(id:string,d:number)=>this.physicsService().setAngularVelocity(id,d),teleport:(id:string,x:number,y:number)=>this.physicsService().teleport(id,x,y),body:(id:string)=>this.physicsService().body(id),setGravity:(x:number,y:number)=>this.physicsService().setGravity(x,y)};
 private physicsService(){const p=this.services.get('physics') as {setVelocity(id:string,x:number,y:number):void;setAngularVelocity(id:string,d:number):void;teleport(id:string,x:number,y:number):void;body(id:string):{velocityX:number;velocityY:number}|undefined;setGravity(x:number,y:number):void}|undefined;if(!p)throw Error('Physics is not running in this scene');return p;}
 async init(){for(const scene of this.bundle.project.scenes)for(const entity of scene.entities)if(!is2DEntity(entity)&&!this.extensions.some(x=>x.spatialTypes?.includes(spatialType(entity))))throw Error(`${entity.name}: runtime spatial provider unavailable: ${spatialType(entity)}`);for(const x of this.extensions){await x.prepare?.();if(this.disposed)return;}this.applyPresentation();const stage=this.bundle.project.stage??{width:960,height:540};this.host.style.setProperty('--stage-w',String(stage.width));this.host.style.setProperty('--stage-h',String(stage.height));this.host.dataset.stage=`${stage.width}x${stage.height}`;// The project's render settings: clear colour, resolution, antialias, renderer, pixel art, scaling and ticker limits.
  const render=resolvePresentation(RenderSettingsSchema.parse(this.bundle.project.extensions[renderSettingsSection]??{version:1}),this.authoredStage,{width:window.innerWidth,height:window.innerHeight}).settings;TextureSource.defaultOptions.scaleMode=render.pixelArt?'nearest':'linear';this.app.textures.setFiltering(TextureSource.defaultOptions.scaleMode);
  let preference=render.renderer;for(const x of this.extensions){if(preference==='webgl')break;preference=await x.renderer?.(preference)??preference;if(this.disposed)return;}this.host.dataset.renderer=JSON.stringify({requested:render.renderer,preference});
  await this.app.init({width:stage.width,height:stage.height,background:render.background,antialias:render.antialias,resolution:renderResolution(render,devicePixelRatio),autoDensity:false,autoStart:false,preference,roundPixels:render.pixelArt});
  this.app.ticker.maxFPS=render.maxFPS;this.app.ticker.minFPS=render.minFPS;this.host.dataset.scale=render.scaleMode;document.documentElement.style.setProperty('--game-background',render.background);this.host.dataset.render=JSON.stringify({resolution:this.app.renderer.resolution,width:this.app.canvas.width,height:this.app.canvas.height,renderer:this.app.renderer.name,maxFPS:Math.round(this.app.ticker.maxFPS),minFPS:Math.round(this.app.ticker.minFPS),pixelArt:render.pixelArt,antialias:render.antialias});
  // The project stage (default 960x540) is drawn at device density and scaled by CSS to whatever box the host gives it; Pixi maps pointers through the canvas rect.
  Object.assign(this.app.canvas.style,{display:'block',width:'100%',height:'100%',touchAction:'none'});if(RenderSettingsSchema.parse(this.bundle.project.extensions[renderSettingsSection]??{version:1}).debugOverlay){this.overlay=createDebugOverlay(this.host,()=>this.debugStats());window.addEventListener('keydown',this.toggleOverlay);}this.host.appendChild(this.app.canvas);this.app.stage.addChild(this.root,this.ui);window.addEventListener('resize',this.resizePresentation);
  // World-space pointer for plugins (physics dragging); object clicks go to the topmost object that listens (clickTarget).
  this.app.stage.eventMode='static';this.app.stage.hitArea=this.app.screen;const point=(phase:'down'|'move'|'up')=>(e:{global:{x:number;y:number}})=>{if(!this.session||this.loading||this.additions?.active)return;const p=this.root.toLocal(e.global);for(const fn of this.pointers)fn(phase,p.x,p.y);};this.app.stage.on('pointerdown',point('down'));this.app.stage.on('globalpointermove',point('move'));this.app.stage.on('pointerup',point('up'));this.app.stage.on('pointerupoutside',point('up'));this.app.stage.on('pointertap',e=>{if(!this.session||this.loading||this.additions?.active||!this.interactions)return;const id=clickTarget(this.app.renderer.events,e.global,n=>{for(const x of this.extensions){const id=x.hitEntity?.(n,e.global,id=>this.interactions?.listens('pointer.click',id)??false);if(id)return id;}return this.nodes.get(n.label)===n?n.label:undefined;},id=>this.interactions?.listens('pointer.click',id)??false);if(!id)return;this.interactions.emit({type:'pointer.click',sourceId:id,silent:this.session.paused});this.app.game.present();});const atlas=this.bundle.atlas;
  if(atlas){
   const pages:Texture[]=[];
   for(const url of atlas.pages){const texture=await this.loadImage(url,'Atlas page unavailable');if(!texture)return;pages.push(texture);}
   for(const [id,frame] of Object.entries(atlas.frames)){
    const page=pages[frame.page];if(!page)continue;
    const texture=new Texture({source:page.source,frame:new Rectangle(frame.x,frame.y,frame.width,frame.height)});
    this.images.set(id,texture);this.subtextures.add(texture);
   }
  }
  for(const a of this.bundle.assets){if(a.type==='font.face'){const meta=FontMetadataSchema.safeParse(a.metadata);if(meta.success){try{await loadFont(a.id,this.url(a,fontFile(meta.data.format)));this.fonts.add(a.id);}catch(e){this.report(`Font unavailable: ${a.name} (${String(e)})`);}if(this.disposed)return;}}if(a.type==='pixi.texture'&&!atlas?.frames[a.id]){
   const texture=await this.loadImage(this.url(a,'image.webp'),`Image unavailable: ${a.name}`);
   if(!texture)return;
   this.images.set(a.id,texture);
  }}for(const x of this.extensions){await x.init?.();if(this.disposed)return;}}
 private async loadImage(url:string,message:string){
  const lease=this.app.textures.acquire(url);
  this.textureLeases.add(lease);
  try{const texture=await lease.ready;return this.disposed?undefined:texture;}
  catch(error){
   lease.release();this.textureLeases.delete(lease);
   if(!this.disposed)throw Error(message,{cause:error});
  }
 }
 /** Right-to-left language: text alignment and layout rows mirror, and the page gets dir="rtl" (Start button, overlays). */
 private get rtl(){return this.language?.direction==='rtl';}
 private showLanguage(){const l=this.language;if(!l)return;this.host.dataset.language=l.language;this.host.dataset.direction=l.direction;if(typeof document!=='undefined'){document.documentElement.lang=l.language;document.documentElement.dir=l.direction;}}
 /** Browser storage key for the save slot (per game name and entry scene). */
 private get saveKey(){return `pixi-game-save:${this.bundle.project.name}:${this.bundle.project.entrySceneId}`;}
 async start(){this.camera=idleCamera();
  // Background policy: a hidden page pauses the whole session (audio, motion, physics, Spine) because Android WebViews keep audio running when the app is backgrounded.
  // Globals live for the whole game session, across scene changes; each change becomes a `global.change` interaction event.
  this.globals=new GlobalStore(GlobalsSchema.parse(this.bundle.project.extensions[globalsSection]??defaultGlobals));
  this.globals.changes$.subscribe(c=>this.interactions?.emit({type:'global.change',sourceId:c.id,silent:c.silent}));
  // Language: the player's preferred locale when the project has it, otherwise the project default.
  const strings=this.bundle.project.extensions[localizationSection];if(strings){const table=LocalizationSchema.parse(strings);this.language=createLanguageStore(table,matchLanguage(table,typeof navigator==='undefined'?[]:navigator.languages),()=>{this.showLanguage();this.app.game.present();});this.showLanguage();}
  this.background=document.visibilityState==='hidden';document.addEventListener('visibilitychange',this.visibility,{signal:this.abort.signal});
  await Promise.all(this.extensions.map(x=>x.unlock?.()));const entry=this.bundle.project.scenes.find(scene=>scene.id===this.bundle.project.entrySceneId);if(!entry)throw Error('Scene target is missing');this.transitions.reset();await this.load(entry);if(this.disposed)return;this.app.ticker.start();}
 private runtimeFault(error:unknown){this.report(String(error));this.dispose();}
 /** Explicit app/menu pause survives background/foreground changes. */
 pause(){if(!this.session||this.loading||this.disposed)throw Error('Start the game and wait for resources first');this.userPaused=true;this.session.pause();this.app.game.present();}
 resume(){if(!this.session||this.loading||this.disposed)throw Error('Start the game and wait for resources first');this.userPaused=false;if(!this.background)this.session.resume();this.app.game.present();}
 /** Bounded module-owned inspection, without exposing Pixi instances or the mutable world. */
 inspect(service:string,query:unknown){if(!this.session||this.loading||this.disposed)throw Error('Start the game and wait for resources first');const inspector=this.inspectors.get(service);if(!inspector)throw Error('Runtime inspector unavailable: '+service);return{sceneId:this.sceneId,time:this.session.time,paused:this.session.paused,result:inspector(query)};}
 private visibility=()=>{this.background=document.visibilityState==='hidden';if(!this.session)return;if(this.background||this.userPaused)this.session.pause();else this.session.resume();if(!this.loading)this.app.game.present();};
 private clear(){this.additions?.dispose();this.additions=undefined;const errors:unknown[]=[];const run=(work:()=>void)=>{try{work();}catch(e){errors.push(e);}};run(()=>this.interactions?.dispose());this.interactions=null;this.timers=null;run(()=>this.app.game.stop());for(const x of [...this.extensions].reverse()){clearSceneDecorators(x.decorators??[],error=>errors.push(error));run(()=>x.clear?.());}this.controllers.clear();this.services.delete('physics');this.sceneEntities=[];this.visuals.clear(error=>errors.push(error));for(const n of [...this.root.removeChildren(),...this.ui.removeChildren()])run(()=>n.destroy({children:true,context:true}));this.nodes.clear();if(errors.length)throw new AggregateError(errors,'Runtime scene cleanup');}
 private async load(source:Scene){if(this.disposed)return;const {id}=source;this.loading=true;this.clear();this.sceneId=id;this.epoch++;snapCamera(this.camera);const epoch=this.epoch;this.createView(source.entities);await Promise.all(this.extensions.map(x=>x.ready?.()));if(this.disposed||epoch!==this.epoch)return;
  const owned=this.app.game.createScene(source.entities.map(clientEntity) as unknown as RuntimeEntity[],(world,install)=>{this.sceneEntities=world.entities as unknown as Entity[];const {interactions,timers}=createSceneInteractions(()=>this.sceneEntities,[...builtinActions,...mediaActions,...visualActions,...languageActions,...cameraActions,...saveActions,...this.extensions.flatMap(x=>x.actions??[])],{globals:this.globals,physics:this.physicsBridge,time:()=>this.session?.time??0,setLanguage:id=>{if(!this.language)throw Error('This game has no localization');this.language.setLanguage(id);},fade:(id,to,seconds,stopAfter)=>{const audio=this.controllers.get('audio') as unknown as {fade?(id:string,to:number,s:number,stop:boolean):void}|undefined;if(!audio?.fade)throw Error('Audio fades are unavailable');audio.fade(id,to,seconds,stopAfter);},camera:this.cameraControls,spawn:(target,x,y,near)=>this.spawnObject({id:target},x,y,near),destroy:id=>this.destroyObject(id),storage:{write:values=>{try{localStorage.setItem(this.saveKey,JSON.stringify(values));}catch(e){this.report(`Save failed: ${String(e)}`);}},read:()=>{try{const raw=JSON.parse(localStorage.getItem(this.saveKey)??'null');return raw&&typeof raw==='object'&&!Array.isArray(raw)?raw as Record<string,unknown>:null;}catch{return null;}},clear:()=>{try{localStorage.removeItem(this.saveKey);}catch{/* storage unavailable */}}},setData:(id,patch)=>{for(const e of world.entities as unknown as Entity[])for(const c of e.components)if(c.id===id){Object.assign(c.data as object,patch);return;}},setActive:(id,v)=>{const e=world.entities.find(e=>e.id===id);if(e)e.active=v;},changeScene:id=>{this.transitions.request(id);},addScene:id=>this.addScene(id),removeScene:id=>this.removeScene(id),crossFade:(id,name,seconds)=>{const animation=this.controllers.get('animation') as unknown as {crossFade?(id:string,name:string,s:number):void}|undefined;if(!animation?.crossFade)throw Error('Animation cross-fades are unavailable');animation.crossFade(id,name,seconds);},invoke:(service,method,id)=>{const controller=this.controllers.get(service);if(!controller)throw Error('Interaction service unavailable: '+service);controller[method](id);}},this.report,()=>this.session?.paused??(this.background||this.userPaused));this.interactions=interactions;this.interactions.observe(event=>{for(const x of this.extensions)x.interaction?.(event);},(type,id)=>this.extensions.some(x=>x.listens?.(type,id)??false));this.timers=timers;this.controllers.set('timer',timers);install(timers.system);for(const extension of this.extensions)install(...extension.systems?.(source)??[]);},this.background||this.userPaused);
  const errors=this.extensions.flatMap(x=>x.errors?.()??[]);if(errors.length)throw Error(errors.join('\n'));
  const parsedSpawn=SpawnDataSchema.safeParse(this.bundle.project.extensions[spawnSection]);
  const spawnData=parsedSpawn.success?parsedSpawn.data:undefined;
  this.additions=new GameSceneObjects(owned,id,{
   scenes:()=>this.bundle.project.scenes,
   prefabs:()=>spawnData?.prefabs??[],
   references:component=>spawnData?.references[component.id]??[],
   project:entities=>entities.map(clientEntity),
   immediate:entities=>this.createView(entities),
   removed:ids=>this.removeViews(ids),
   prepare:async candidate=>{const next=candidate as unknown as readonly Entity[],existing=new Set(owned.world.entities.map(e=>e.id)),added=next.filter(e=>!existing.has(e.id));this.createView(added,next);for(const e of added){const node=this.nodes.get(e.id);if(node)node.visible=false;}await Promise.all(this.extensions.map(x=>x.ready?.()));},
   added:key=>{this.interactions?.emit({type:'scene.start',sourceId:key,silent:owned.paused});},
   rollback:ids=>{if(this.session===owned)this.removeViews(ids.filter(id=>!owned.world.entities.some(e=>e.id===id)));},
   sync:()=>{if(this.session===owned)this.app.game.present();},report:error=>this.warn(String(error))
  });
  await this.app.game.startScene(owned,{
   prepare:async()=>{this.app.game.present();await Promise.all(this.extensions.map(x=>x.ready?.()));},
   started:()=>{
    const startupErrors=this.extensions.flatMap(x=>x.errors?.()??[]);if(startupErrors.length)throw Error(startupErrors.join('\n'));
    this.interactions?.emit({type:'scene.start',sourceId:id,silent:owned.paused});this.app.game.present();this.loading=false;
   },
  });
 }
 private additions?:GameSceneObjects;
 private liveObjects(){if(!this.additions)throw Error('The game is not running');return this.additions;}
 private addScene(id:string){this.liveObjects().add(id);}
 private removeScene(id:string){this.additions?.remove(id);}
 private spawnObject(target:{name?:string;id?:string},x:number,y:number,near?:string){return this.liveObjects().spawn(target,x,y,near);}
 private destroyObject(id:string){this.additions?.destroy([id]);}
 private removeViews(ids:readonly string[]){
  const errors:unknown[]=[];
  // All adapters release their resources before a parent destroys its children.
  this.visuals.remove(ids,error=>errors.push(error));
  for(const id of ids){
   const node=this.nodes.get(id);
   try{if(node&&!node.destroyed)node.destroy({children:true});}catch(error){errors.push(error);}
   this.nodes.delete(id);
  }
  if(errors.length)throw new AggregateError(errors,'Runtime view cleanup');
 }
 private createView(input:readonly Entity[],candidate?:readonly Entity[]){
  const entities=input.filter(is2DEntity),adapters=this.extensions.flatMap(extension=>extension.visuals??[]);
  for(const entity of entities){
   const node=new Container();
   this.nodes.set(entity.id,node);
   node.label=entity.id;node.eventMode='static';node.cursor='pointer';
   this.visuals.build(entity,node,adapters);
  }
  for(const entity of entities){
   const parent=entity.parentId?this.nodes.get(entity.parentId):undefined;
   (parent??(screenSpace(entity)?this.ui:this.root)).addChild(this.nodes.get(entity.id)!);
  }
  this.decorate(candidate??(this.sceneEntities.length?this.sceneEntities:input));
 }
 private decorate(entities:readonly Entity[]){
  const node=(id:string)=>this.nodes.get(id),renderer=this.app.renderer,context={rtl:this.rtl};
  for(const extension of this.extensions){
   if(extension.decorators)decorateScene(extension.decorators,entities,node,renderer,context);
   extension.decorate?.(entities,node,renderer);
  }
 }
 private projectFrame(){if(!this.session)return;const entities=this.session.world.entities as unknown as Entity[];for(const e of entities){const node=this.nodes.get(e.id);if(!node)continue;const t=transform(e),screen=screenSpace(e),shift=screen?screenOffset(screen.anchor,this.bundle.project.stage??this.authoredStage,this.authoredStage):{x:0,y:0};applyTransform2D(node,t,shift);node.visible=e.active;this.visuals.update(e);}this.decorate(entities);{const stage=this.bundle.project.stage??{width:960,height:540},view=this.currentView=resolveCameraFrame(this.camera,this.session.time,stage,entities,id=>{const follow=this.nodes.get(id);return follow?this.root.toLocal(follow.toGlobal({x:0,y:0})):undefined;}),p=viewPlacement(view,stage);this.root.pivot.set(p.pivot.x,p.pivot.y);this.root.position.set(p.position.x,p.position.y);this.root.scale.set(p.scale);this.root.angle=p.angle;this.host.dataset.camera=JSON.stringify(viewOffset(view,stage));this.host.dataset.view=JSON.stringify(view);}}
 private publishFrame(){
  if(!this.session)return;
  const entities=this.session.world.entities as unknown as readonly Entity[];
  const texts=JSON.stringify(this.visuals.textValues());
  if(this.host.dataset.texts!==texts)this.host.dataset.texts=texts;
  this.host.dataset.states=JSON.stringify(this.interactions?.states()??{});
  this.host.dataset.sceneId=this.sceneId;this.host.dataset.addedScenes=JSON.stringify(this.additions?.additions??[]);this.host.dataset.timers=JSON.stringify(this.timers?.diagnostics??{});this.host.dataset.runtimeTime=String(this.session.time);this.host.dataset.poses=JSON.stringify(Object.fromEntries(entities.map(e=>[e.id,{...(is2DEntity(e)?transform(e):spatialComponent(e).data as object),active:e.active,parentId:e.parentId}])));this.host.dataset.audio=JSON.stringify(this.controllers.get('audio')?.diagnostics??{});this.host.dataset.audioEffects=JSON.stringify((this.controllers.get('audio') as unknown as {effects?:unknown}|undefined)?.effects??{});this.overlay?.frame();}
 dispose(){if(this.disposed)return;this.disposed=true;this.overlay?.dispose();if(typeof window!=='undefined'){window.removeEventListener('keydown',this.toggleOverlay);window.removeEventListener('resize',this.resizePresentation);}const errors:unknown[]=[];const run=(work:()=>void)=>{try{work();}catch(e){errors.push(e);}};this.abort.abort();run(()=>this.app.ticker?.stop());run(()=>this.clear());run(()=>this.globals?.dispose());for(const x of [...this.extensions].reverse())run(()=>x.dispose());this.extensions=[];this.inspectors.clear();for(const texture of this.subtextures)run(()=>texture.destroy(false));this.subtextures.clear();this.images.clear();for(const lease of this.textureLeases)run(()=>lease.release());this.textureLeases.clear();if(this.app.renderer)run(()=>destroyLocalApplication(this.app));if(errors.length)this.report('Runtime cleanup errors: '+errors.map(String).join('; '));}
}
