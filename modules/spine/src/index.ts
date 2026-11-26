import {Container,Graphics,Rectangle} from 'pixi.js';
import {Spine} from '@esotericsoftware/spine-pixi-v8';
import {components,createItems,token,type EditorModule} from '@rewrite/sdk';
import {assetToken,assetImporters,type AssetService} from '@rewrite/assets';
import {visualAdapters,type VisualAdapter,type VisualFrame} from '@rewrite/render-pixi/visuals';
import {tweenChannels} from '@rewrite/tween/contracts';
import {spineTweenChannel,SpineSchema,spineImporter,type SpineData,type SpineEvent,type SpineFrame} from './contracts';
import {SpineResources} from './resources';
export * from './contracts';
export class SpineService{
 private listeners=new Set<()=>void>();version=0;subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn);};};private changed(){this.version++;for(const fn of this.listeners)fn();}
 readonly resources:SpineResources;epoch=0;private preview?:{id:string;time:number;running:boolean};
 constructor(assets:Pick<AssetService,'get'|'url'>){this.resources=new SpineResources(assets);}
 frame(id:string,runtime?:{token:string;time:number;silent:boolean}):SpineFrame{return runtime?{...runtime,emit:true}:{token:`edit:${this.epoch}`,time:this.preview?.id===id?this.preview.time:0,emit:false,silent:true};}
 get previewing(){return Boolean(this.preview?.running);}
 get previewState(){return this.preview?{...this.preview}:null;}
 seek(id:string,time:number){this.preview={id,time,running:false};this.changed();}
 playPreview(id:string){this.preview={id,time:this.preview?.id===id?this.preview.time:0,running:true};this.changed();}
 clearPreview(id?:string){if((!id||this.preview?.id===id)&&this.preview){this.preview=undefined;this.changed();}}
 advancePreview(dt:number){if(this.preview?.running){this.preview.time+=Math.min(dt,8/60);this.changed();}}
 reset(){this.clearPreview();this.epoch++;}
 dispose(){this.reset();this.resources.dispose();}
}
export const spineToken=token<SpineService>('spine','spine.service');
export const spineDefinition={type:'spine.renderer',version:1,titleKey:'spine.component',exclusiveGroup:'render.visual',defaults:()=>({assetId:'',skin:'',animation:'',loop:true,timeScale:1,alpha:1}),parse:(v:unknown)=>SpineSchema.parse(v),fields:[{key:'assetId',titleKey:'spine.asset',kind:'asset'as const,assetType:'spine.skeleton'},{key:'loop',titleKey:'spine.loop',kind:'boolean'as const},{key:'timeScale',titleKey:'spine.timeScale',kind:'number'as const},{key:'alpha',titleKey:'field.alpha',kind:'number'as const}]};
export function createSpineAdapter(service:SpineService):VisualAdapter{return{type:'spine.renderer',version:1,key:value=>service.resources.key(SpineSchema.parse(value).assetId),create(value,ctx){
 const view=new Container(),placeholder=new Graphics().rect(-48,-48,96,96).fill('#4d3747').stroke({color:'#d29bbd',width:1});view.addChild(placeholder);view.hitArea=new Rectangle(-48,-48,96,96);let model=SpineSchema.parse(value),current=ctx.frame(),spine:Spine|undefined,dead=false,error:string|undefined,config='',lastToken='',lastTime=0,suppress=true,lease:ReturnType<SpineResources['acquire']>|undefined;
 const event=(value:Omit<SpineEvent,'entityId'|'componentId'|'assetId'|'silent'|'time'>)=>{if(dead||suppress||!current.emit)return;ctx.event({...value,entityId:ctx.entityId,componentId:ctx.componentId,assetId:model.assetId,time:current.time,silent:current.silent});};
 const update=(p:SpineData,frame:VisualFrame)=>{model=p;current=frame;view.alpha=p.alpha;if(!spine)return;const stateConfig=JSON.stringify([p.skin,p.animation,p.loop,p.timeScale]);if(stateConfig!==config||frame.token!==lastToken||frame.time<lastTime){suppress=true;spine.state.clearTracks();spine.skeleton.setToSetupPose();if(p.skin)spine.skeleton.setSkinByName(p.skin);else spine.skeleton.setSkin(spine.skeleton.data.defaultSkin);spine.skeleton.setSlotsToSetupPose();const name=p.animation||spine.skeleton.data.animations[0]?.name;if(name)spine.state.setAnimation(0,name,p.loop);config=stateConfig;lastToken=frame.token;lastTime=0;spine.update(0);suppress=false;}
  const delta=Math.max(0,frame.time-lastTime);suppress=!frame.emit;spine.update(delta*p.timeScale);suppress=true;lastTime=frame.time;const b=spine.getLocalBounds();view.hitArea=new Rectangle(b.x,b.y,Math.max(1,b.width),Math.max(1,b.height));};
 try{lease=service.resources.acquire(model.assetId);void lease.promise.then(resource=>{if(dead)return;try{spine=new Spine({skeletonData:resource.data,autoUpdate:false});spine.state.addListener({event:(_entry,e)=>event({kind:'event',name:e.data.name,intValue:e.intValue,floatValue:e.floatValue,stringValue:e.stringValue??''}),complete:entry=>event({kind:'complete',name:entry.animation?.name??''})});view.removeChild(placeholder);placeholder.destroy();view.addChild(spine);update(model,ctx.frame());ctx.changed();}catch(e){error=String(e);ctx.changed();}}).catch(e=>{if(!dead){error=String(e);ctx.changed();}});}catch(e){error=String(e);}
 return{view,update(data,frame){try{update(SpineSchema.parse(data),frame);if(spine)error=undefined;}catch(e){error=String(e);}},diagnostics(){return{ready:Boolean(spine)&&!error,error:error??null,type:'spine',assetId:model.assetId,time:current.time,bones:spine?.skeleton.bones.slice(0,16).map(b=>({name:b.data.name,x:b.x,y:b.y,rotation:b.rotation}))??[]};},dispose(){if(dead)return;dead=true;spine?.state.clearListeners();if(spine){view.removeChild(spine);spine.destroy({children:true});}lease?.release();}};
 }};}
export const spineModule:EditorModule={manifest:{id:'spine',version:'1.0.0',apiVersion:1,requires:{scene:'^1',assets:'^1',pixi:'^1'},optional:{tween:'^1'},entries:{worker:'@rewrite/spine/node',runtime:'@rewrite/spine'}},activate(c){c.contribute(createItems,'spine.skeleton',{titleKey:'create.spine',category:'skeletal',icon:'bone',name:'Spine',components:[{type:'spine.renderer'}]});const service=new SpineService(c.get(assetToken));c.provide(spineToken,service);c.own(()=>service.dispose());c.contribute(components,'spine.renderer',spineDefinition);c.contribute(assetImporters,spineImporter.id,spineImporter);c.contribute(visualAdapters,'spine.visual',createSpineAdapter(service));c.contribute(tweenChannels,'spine.alpha',spineTweenChannel);}};
