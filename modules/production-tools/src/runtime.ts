import {propertyKey,type ComponentDefinition,type RuntimeSystem} from '@rewrite/sdk';
import type {Project} from '@rewrite/project';
import {transform,type Entity} from '@rewrite/scene';
import {CharacterSchema,WorldSchema,DataSchema,characterType,sections} from './contracts';
import {applyBindings} from './models';
export const characterDefinition:ComponentDefinition={type:characterType,version:1,titleKey:'production.character',defaults:()=>CharacterSchema.parse({}),parse:v=>CharacterSchema.parse(v),fields:Object.entries(CharacterSchema.shape).map(([key])=>({key,titleKey:`production.${key}`,kind:key==='mode'?'enum':typeof CharacterSchema.parse({})[key as keyof ReturnType<typeof CharacterSchema.parse>]==='number'?'number':'string',...(key==='mode'?{options:[{value:'platformer',titleKey:'production.platformer'},{value:'topdown',titleKey:'production.topdown'}]}:{})}))};
export interface Motion {vx:number;vy:number;grounded:boolean;air:number;coyote:number;buffer:number;dash:number;facing:number;jumpHeld:boolean;dashHeld:boolean}
export const motion=():Motion=>({vx:0,vy:0,grounded:false,air:0,coyote:0,buffer:0,dash:0,facing:1,jumpHeld:false,dashHeld:false});
export type Bounds={x:number;y:number;width:number;height:number};
/** Kinematic, axis-aligned static platforms. Actor and platform x/y denote their centres. */
export function moveCharacter(t:{x:number;y:number},s:Motion,c:ReturnType<typeof CharacterSchema.parse>,input:(name:string)=>boolean,dt:number,platforms:Bounds[]){const dir=Number(input(c.right))-Number(input(c.left));if(dir)s.facing=dir;
 if(c.mode==='topdown'){t.x+=dir*c.speed*dt;t.y+=(Number(input(c.down))-Number(input(c.up)))*c.speed*dt;return;}
 const jump=input(c.jump),dash=input(c.dash);s.coyote=s.grounded?c.coyoteMs/1000:Math.max(0,s.coyote-dt);s.buffer=jump&&!s.jumpHeld?c.bufferMs/1000+dt:Math.max(0,s.buffer-dt);
 if(dash&&!s.dashHeld&&s.dash<=0)s.dash=c.dashMs/1000;
 if(s.buffer>0&&(s.grounded||s.coyote>0||s.air<c.airJumps)){if(!s.grounded&&s.coyote<=0)s.air++;s.vy=-c.jumpSpeed;s.buffer=0;s.coyote=0;s.grounded=false;}
 s.jumpHeld=jump;s.dashHeld=dash;const goal=dir*c.speed;s.vx+=Math.sign(goal-s.vx)*Math.min(Math.abs(goal-s.vx),c.acceleration*dt);
 if(s.dash>0){s.dash=Math.max(0,s.dash-dt);s.vx=s.facing*c.dashSpeed;s.vy=0;}else s.vy+=c.gravity*dt;
 const oldX=t.x,oldY=t.y;t.x+=s.vx*dt;for(const b of platforms)if(Math.abs(t.y-b.y)<(c.height+b.height)/2&&Math.abs(t.x-b.x)<(c.width+b.width)/2){if(oldX<=b.x-b.width/2-c.width/2)t.x=b.x-b.width/2-c.width/2;else if(oldX>=b.x+b.width/2+c.width/2)t.x=b.x+b.width/2+c.width/2;s.vx=0;}
 t.y+=s.vy*dt;s.grounded=false;for(const b of platforms)if(Math.abs(t.x-b.x)<(c.width+b.width)/2&&Math.abs(t.y-b.y)<=(c.height+b.height)/2){if(s.vy>=0&&oldY+c.height/2<=b.y-b.height/2+.1){t.y=b.y-(b.height+c.height)/2;s.vy=0;s.grounded=true;s.air=0;}else if(s.vy<0&&oldY-c.height/2>=b.y+b.height/2-.1){t.y=b.y+(b.height+c.height)/2;s.vy=0;}}
}
export function trajectory(c:ReturnType<typeof CharacterSchema.parse>,seconds=2,kind:'jump'|'dash'='jump'){const s=motion(),t={x:0,y:0},points:{x:number;y:number}[]=[];s.grounded=true;for(let f=0;f<seconds*60;f++){moveCharacter(t,s,c,n=>n===c.right||(n===c.jump&&kind==='jump'&&f===0)||(n===c.dash&&kind==='dash'&&f===0),1/60,[]);points.push({...t});}return points;}
export function mutableTransform(e:Entity){return e.components.find(c=>c.type==='scene.transform2d')!.data as ReturnType<typeof transform>;}
export class ProductionRuntime{
 private arrival:{scene:string;actor:string;spawn:string}|null=null;private cooldown=0;private states=new Map<string,Motion>();private sceneId='';private entities:()=>readonly Entity[]=()=>[];private changeScene:(id:string)=>void=()=>{};
 constructor(private project:()=>Pick<Project,'extensions'>,private input:(name:string)=>boolean){ }
 private portals(){return WorldSchema.parse(this.project().extensions[sections.world]??{version:1,rooms:[],portals:[]}).portals;}
 listens(type:string,id:string){return type==='pointer.click'&&this.portals().some(gate=>gate.mode==='click'&&gate.fromEntity===id);}
 observe(event:{type:string;sourceId:string}){
  if(event.type!=='pointer.click')return;
  for(const gate of this.portals())if(gate.mode==='click'&&gate.fromEntity===event.sourceId)this.enter(gate.id);
 }

 enter(id:string){const g=this.portals().find(g=>g.id===id);if(!g||g.fromScene!==this.sceneId||this.cooldown>0||(g.action&&!this.input(g.action)))return false;this.arrival={scene:g.toScene,actor:g.toActor,spawn:g.toSpawn};this.changeScene(g.toScene);this.cooldown=.3;return true;}
 system(sceneId:string,entities:()=>readonly Entity[],changeScene:(id:string)=>void):RuntimeSystem{this.sceneId=sceneId;this.entities=entities;this.changeScene=changeScene;this.states.clear();return{id:'production',start:()=>{const data=DataSchema.parse(this.project().extensions[sections.data]??{version:1,tables:[],bindings:[]});applyBindings(entities(),data);if(this.arrival?.scene===sceneId){const a=entities().find(e=>e.id===this.arrival!.actor),b=entities().find(e=>e.id===this.arrival!.spawn);if(a&&b)Object.assign(mutableTransform(a),{x:transform(b).x,y:transform(b).y});this.arrival=null;}},fixedUpdate:dt=>{this.cooldown=Math.max(0,this.cooldown-dt);const all=entities(),platforms=all.filter(e=>e.active&&!e.parentId&&!e.components.some(c=>c.type===characterType)).flatMap(e=>{const c=e.components.find(c=>c.type==='production.platform');if(!c)return[];const b=c.data as Bounds,t=transform(e);return[{x:t.x,y:t.y,width:b.width*Math.abs(t.scaleX),height:b.height*Math.abs(t.scaleY)}];});for(const e of all){const component=e.components.find(c=>c.type===characterType);if(!component||!e.active)continue;const c=CharacterSchema.parse(component.data),state=this.states.get(e.id)??motion();this.states.set(e.id,state);moveCharacter(mutableTransform(e),state,c,this.input,dt,platforms);}
 for(const g of this.portals().filter(g=>g.fromScene===sceneId&&g.mode==='near')){const a=all.find(e=>e.id===g.fromActor),b=all.find(e=>e.id===g.fromEntity);if(a?.active&&b?.active&&(!g.action||this.input(g.action))&&Math.hypot(transform(a).x-transform(b).x,transform(a).y-transform(b).y)<=g.radius){if(this.enter(g.id))break;}}},dispose:()=>{this.states.clear();}};}
}
export const platformDefinition:ComponentDefinition={type:'production.platform',version:1,titleKey:'production.platform',defaults:()=>({width:200,height:32}),parse:v=>{const b=v as Bounds;if(!b||!Number.isFinite(b.width)||!Number.isFinite(b.height)||b.width<=0||b.height<=0||b.width>10000||b.height>10000)throw Error('Positive platform width/height required');return{width:b.width,height:b.height};},fields:[{key:'width',titleKey:'field.width',kind:'number'},{key:'height',titleKey:'field.height',kind:'number'}]};

/** Channel claims are passed to the existing tween/animation validators in both hosts. */
export function characterWriters(entities:readonly Entity[]){const writers=new Map<string,string>();for(const e of entities){if(!e.components.some(c=>c.type===characterType))continue;if(e.parentId||e.components.some(c=>c.type==='physics.rigidBody2d'||c.type==='navigation.agent'))throw Error(`${e.name}: kinematic characters must be roots without Matter bodies or Nav Agents`);const t=e.components.find(c=>c.type==='scene.transform2d')!;for(const property of ['x','y'])writers.set(propertyKey(e.id,t.id,property),`character:${e.id}`);}for(const e of entities.filter(e=>e.components.some(c=>c.type==='production.platform'))){const t=transform(e);if(e.parentId||t.rotation!==0||t.skewX||t.skewY)throw Error(`${e.name}: kinematic platforms require root, axis-aligned transforms`);}return writers;}
