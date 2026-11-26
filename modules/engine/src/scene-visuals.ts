import {BitmapText,Text,type Container,type Texture} from 'pixi.js';
import type {Entity} from './scene.js';
import {BitmapTextSchema,ShapeSchema,SpriteSchema,TextSchema,bidiText,bitmapTextStyle,textStyle} from './contracts.js';
import {applySpriteView,createBitmapTextView,createSpriteView,createTextView,drawShape} from './display.js';
import {fitText,type TextFitMode} from './text-fit.js';
import {visualKey} from './visual-signature.js';
import type {TexturePool} from './textures.js';
import type {VisualAdapter,VisualFrame,VisualHandle} from './visuals.js';

type Component=Entity['components'][number];
type SpriteData=ReturnType<typeof SpriteSchema.parse>;
interface ProjectionPorts{
 texture(id:string):Texture|undefined;
 missingSprite?(data:SpriteData):Container;
 textures:TexturePool;
 font(id:string):string|string[];
 text(value:string):string;
 rtl():boolean;
 frame(componentId:string):VisualFrame;
 changed():void;
 event(event:unknown):void;
}
interface Visual{
 view:Container;
 update(component:Component):void;
 handle?:VisualHandle;
}

/** Component views for the live or authored 2D graph. Hosts own the entity containers and presentation. */
export class SceneVisualProjection{
 private entities=new Map<string,Map<string,Visual>>();
 constructor(private ports:ProjectionPorts){}

 build(entity:Entity,node:Container,adapters:readonly VisualAdapter[]){
  const visuals=new Map<string,Visual>();
  this.entities.set(entity.id,visuals);
  for(const component of entity.components){
   const adapter=adapters.find(item=>item.type===component.type&&item.version===component.version);
   const visual=adapter?this.adapt(entity,component,adapter):this.builtin(component);
   if(!visual)continue;
   visuals.set(component.id,visual);
   node.addChild(visual.view);
  }
 }

 update(entity:Entity){
  const visuals=this.entities.get(entity.id);
  if(!visuals)return;
  for(const component of entity.components)visuals.get(component.id)?.update(component);
 }

 private adapt(entity:Entity,component:Component,adapter:VisualAdapter):Visual{
  const frame=()=>this.ports.frame(component.id);
  const handle=adapter.create(component.data,{
   entityId:entity.id,componentId:component.id,textures:this.ports.textures,frame,
   changed:()=>this.ports.changed(),event:event=>this.ports.event(event),
  });
  return {view:handle.view,handle,update:next=>handle.update(next.data,frame())};
 }

 private builtin(component:Component):Visual|undefined{
  if(component.version!==1)return;
  const {data,type}=component,ports=this.ports;
  if(type==='pixi.shape'){
   const initial=ShapeSchema.parse(data),view=drawShape(initial);
   view.alpha=initial.alpha;
   return this.styled(component,view,next=>drawShape(ShapeSchema.parse(next),view));
  }
  if(type==='pixi.sprite'){
   const initial=SpriteSchema.parse(data),texture=ports.texture(initial.assetId);
   if(texture){
    const view=createSpriteView(initial,texture);
    return this.styled(component,view,data=>{
     const next=SpriteSchema.parse(data);
     const replacement=ports.texture(next.assetId);
     if(!replacement)throw Error('Sprite texture is missing');
     applySpriteView(view,next,replacement);
    });
   }
   if(!ports.missingSprite)throw Error('Sprite texture is missing');
   return this.styled(component,ports.missingSprite(initial),()=>{});
  }
  if(type==='pixi.text'){
   const initial=TextSchema.parse(data),view=createTextView(initial,ports.font(initial.font),ports.rtl(),ports.text(initial.text));
   return this.textVisual(component,view,data=>{
    const next=TextSchema.parse(data);
    view.style=textStyle(next,ports.font(next.font),ports.rtl());
   });
  }
  if(type==='pixi.bitmapText'){
   const initial=BitmapTextSchema.parse(data),view=createBitmapTextView(initial,ports.font(initial.font),ports.text(initial.text));
   return this.textVisual(component,view,data=>{
    const next=BitmapTextSchema.parse(data);
    view.style=bitmapTextStyle(next,ports.font(next.font));
   });
  }
 }

 private styled(component:Component,view:Container,restyle:(data:Component['data'])=>void,direction?:()=>boolean):Visual{
  const signature=(item:Component)=>JSON.stringify([visualKey(item),direction?.()]);
  let previous=signature(component);
  return {view,update(next){
   const key=signature(next);
   if(key!==previous){restyle(next.data);previous=key;}
   view.alpha=Number((next.data as {alpha?:number}).alpha??1);
  }};
 }

 private textVisual(component:Component,view:Text|BitmapText,restyle:(data:Component['data'])=>void):Visual{
  let previous:{text:string;mode:TextFitMode;width:number}|undefined;
  const appearance=this.styled(component,view,data=>{restyle(data);previous=undefined;},()=>this.ports.rtl());
  const update=(next:Component)=>{
   appearance.update(next);
   const data=next.data as {text?:unknown;fitMode?:TextFitMode;fitWidth?:number};
   const text=this.ports.text(String(data.text??'')),mode=data.fitMode??'none',width=data.fitWidth??400;
   if(previous?.text===text&&previous.mode===mode&&previous.width===width)return;
   previous={text,mode,width};
   const set=(value:string)=>{view.text=view instanceof Text?bidiText(value):value;};
   view.scale.set(1);
   const fitted=fitText(text,width,mode,value=>{set(value);return view.getLocalBounds().width;});
   set(fitted.text);
   view.scale.set(fitted.scale);
  };
  update(component);
  return {view,update};
 }

 textValues(){
  const result:Record<string,string>={};
  for(const visuals of this.entities.values())for(const [id,{view}] of visuals){
   if(view instanceof Text||view instanceof BitmapText)result[id]=view.text;
  }
  return result;
 }

 diagnostics(){
  return [...this.entities].flatMap(([entityId,visuals])=>[...visuals].flatMap(([componentId,{handle}])=>
   handle?[{entityId,componentId,...handle.diagnostics()}]:[]));
 }

 remove(ids:readonly string[],report:(error:unknown)=>void){
  for(const id of ids){
   const visuals=this.entities.get(id);
   this.entities.delete(id);
   for(const visual of visuals?.values()??[]){
    try{visual.handle?.dispose();}catch(error){report(error);}
   }
  }
 }

 clear(report:(error:unknown)=>void){this.remove([...this.entities.keys()],report);}
}
