import type {InteractionEvent} from '@rewrite/interactions';
import {components,settings,token,propertyKey,type ComponentDefinition,type EditorModule,type Json,type RuntimeSystem} from '@rewrite/sdk';
import {transform,type Entity} from '@rewrite/scene';
import {projectToken,projectSections,type ProjectService} from '@rewrite/project';
import {z} from 'zod';
import {RigidBodySchema,BoxColliderSchema,CircleColliderSchema,CapsuleColliderSchema,PolygonColliderSchema,JointSchema,PhysicsSettingsSchema,defaultRigidBody,defaultJoint,defaultPhysicsSettings,physicsSection,colliderTypes,convexParts,filterMask,jointKinds,bodyTypes,parsePoints,
 type PhysicsSettings,type PhysicsBodySpec,type PhysicsProvider,type PhysicsWorld,type PhysicsEvent,type PhysicsControls,type ShapePart,type JointSpec,type RigidBodyData} from './contracts';
export * from './contracts';

const numbers=(keys:string[])=>keys.map(key=>({key,titleKey:`physics.${key}`,kind:'number'as const}));
const hidden=()=>false;
export const rigidBodyDefinition:ComponentDefinition={type:'physics.rigidBody2d',version:1,supportedSpaces:['scene.2d'],titleKey:'physics.rigidBody',defaults:()=>({...defaultRigidBody}),get dataSchema(){return z.toJSONSchema(RigidBodySchema,{unrepresentable:'any'});},parse:v=>RigidBodySchema.parse(v),fields:[
 {key:'bodyType',titleKey:'physics.bodyType',kind:'enum',options:bodyTypes.map(value=>({value,titleKey:`physics.${value}`}))},
 ...numbers(['density','mass','friction','frictionStatic','restitution','airFriction','gravityScale','velocityX','velocityY','angularVelocity','group']),
 {key:'lockRotation',titleKey:'physics.lockRotation',kind:'boolean'},{key:'draggable',titleKey:'physics.draggable',kind:'boolean'},{key:'bullet',titleKey:'physics.bullet',kind:'boolean'},
 // Layer and mask have their own editor (layer names and checkboxes) in the physics inspector extra.
 {key:'layer',titleKey:'physics.layer',kind:'number',visible:hidden},{key:'mask',titleKey:'physics.mask',kind:'number',visible:hidden}]};
const sensor={key:'sensor',titleKey:'physics.sensor',kind:'boolean'as const};
export const boxColliderDefinition:ComponentDefinition={type:'physics.boxCollider2d',version:1,supportedSpaces:['scene.2d'],titleKey:'physics.box',defaults:()=>({width:100,height:100,offsetX:0,offsetY:0,sensor:false,chamfer:0}),get dataSchema(){return z.toJSONSchema(BoxColliderSchema,{unrepresentable:'any'});},parse:v=>BoxColliderSchema.parse(v),fields:[...numbers(['width','height','chamfer','offsetX','offsetY']),sensor]};
export const circleColliderDefinition:ComponentDefinition={type:'physics.circleCollider2d',version:1,supportedSpaces:['scene.2d'],titleKey:'physics.circle',defaults:()=>({radius:50,offsetX:0,offsetY:0,sensor:false}),get dataSchema(){return z.toJSONSchema(CircleColliderSchema,{unrepresentable:'any'});},parse:v=>CircleColliderSchema.parse(v),fields:[...numbers(['radius','offsetX','offsetY']),sensor]};
export const capsuleColliderDefinition:ComponentDefinition={type:'physics.capsuleCollider2d',version:1,supportedSpaces:['scene.2d'],titleKey:'physics.capsule',defaults:()=>({width:60,height:120,offsetX:0,offsetY:0,sensor:false}),get dataSchema(){return z.toJSONSchema(CapsuleColliderSchema,{unrepresentable:'any'});},parse:v=>CapsuleColliderSchema.parse(v),fields:[...numbers(['width','height','offsetX','offsetY']),sensor]};
export const polygonColliderDefinition:ComponentDefinition={type:'physics.polygonCollider2d',version:1,supportedSpaces:['scene.2d'],titleKey:'physics.polygon',defaults:()=>({points:'0,-50 50,40 -50,40',offsetX:0,offsetY:0,sensor:false}),parse:v=>{const p=PolygonColliderSchema.parse(v);parsePoints(p.points);return p;},fields:[{key:'points',titleKey:'physics.points',kind:'string'},...numbers(['offsetX','offsetY']),sensor]};
export const jointDefinition:ComponentDefinition={type:'physics.joint2d',version:1,supportedSpaces:['scene.2d'],titleKey:'physics.joint',defaults:()=>({...defaultJoint}),get dataSchema(){return z.toJSONSchema(JointSchema,{unrepresentable:'any'});},parse:v=>JointSchema.parse(v),
 fields:[{key:'kind',titleKey:'physics.jointKind',kind:'enum',options:jointKinds.map(value=>({value,titleKey:`physics.joint.${value}`}))},{key:'target',titleKey:'physics.jointTarget',kind:'string',visible:hidden},
  ...numbers(['anchorX','anchorY','targetAnchorX','targetAnchorY']),{key:'length',titleKey:'physics.jointLength',kind:'number',visible:v=>(v as {kind?:string}).kind!=='pin'},{key:'stiffness',titleKey:'physics.stiffness',kind:'number',visible:v=>['distance','spring'].includes(String((v as {kind?:string}).kind))},
  {key:'damping',titleKey:'physics.damping',kind:'number'},{key:'collideConnected',titleKey:'physics.collideConnected',kind:'boolean'}],
 remapReferences:(v,ids)=>{const j=JointSchema.parse(v);return{...j,target:j.target?ids.entities.get(j.target)??j.target:''};}};
export class PhysicsService{
 private listeners=new Set<()=>void>();private value:boolean;
 constructor(readonly project:ProjectService,private preference:{get():boolean;set(value:boolean):void}){this.value=preference.get();}
 subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn);};};
 get debug(){return this.value;}
 setDebug(value:boolean){if(value===this.value)return;this.preference.set(value);this.value=value;for(const fn of this.listeners)fn();}
 get settings(){return PhysicsSettingsSchema.parse(this.project.document.current.extensions[physicsSection]??defaultPhysicsSettings);}
 setSettings(patch:Partial<PhysicsSettings>){const current=this.settings,next=PhysicsSettingsSchema.parse({...current,...patch});if(JSON.stringify(next)===JSON.stringify(current))return;this.project.document.transact('Change physics settings',draft=>{draft.extensions[physicsSection]=next;});}
 dispose(){this.listeners.clear();}
}
export const physicsToken=token<PhysicsService>('physics','physics.settings');
export function physicsModule(preference:{get():boolean;set(value:boolean):void}):EditorModule{return{manifest:{id:'physics',version:'1.0.0',apiVersion:1,requires:{scene:'^1',project:'^1'},entries:{runtime:'@rewrite/physics'}},activate(c){
 c.contribute(settings,'physics.debugOutlines',{titleKey:'setting.physicsDebug',descriptionKey:'setting.physicsDebugHelp',kind:'boolean',default:false});
 for(const d of [rigidBodyDefinition,boxColliderDefinition,circleColliderDefinition,capsuleColliderDefinition,polygonColliderDefinition,jointDefinition])c.contribute(components,d.type,d);
 c.contribute(projectSections,'physics.world',{key:physicsSection,get dataSchema(){return z.toJSONSchema(PhysicsSettingsSchema,{unrepresentable:'any'});},parse:v=>PhysicsSettingsSchema.parse(v)as Json});
 const service=new PhysicsService(c.get(projectToken),preference);c.provide(physicsToken,service);c.own(()=>service.dispose());}};}

/** World transform of an entity: position, rotation (degrees) and scale with every parent applied. */
export function worldTransform(byId:ReadonlyMap<string,Entity>,id:string){
 const chain:Entity[]=[];for(let e=byId.get(id);e&&chain.length<64;e=e.parentId?byId.get(e.parentId):undefined)chain.push(e);
 // x/y: where the object's pivot lands; a child's position is relative to its parent's local origin (parent pivot subtracted).
 let x=0,y=0,rotation=0,scaleX=1,scaleY=1,pivotX=0,pivotY=0;
 for(const e of chain.reverse()){const t=transform(e),a=rotation*Math.PI/180,lx=(t.x-pivotX)*scaleX,ly=(t.y-pivotY)*scaleY;x+=lx*Math.cos(a)-ly*Math.sin(a);y+=lx*Math.sin(a)+ly*Math.cos(a);rotation+=t.rotation;scaleX*=t.scaleX;scaleY*=t.scaleY;pivotX=t.pivotX??0;pivotY=t.pivotY??0;}
 return{x,y,rotation,scaleX,scaleY,pivotX,pivotY};
}
const rot=(p:{x:number;y:number},deg:number)=>{const a=deg*Math.PI/180;return{x:p.x*Math.cos(a)-p.y*Math.sin(a),y:p.x*Math.sin(a)+p.y*Math.cos(a)};};
const TilemapCollisionSchema=z.object({tileWidth:z.number().positive(),tileHeight:z.number().positive(),columns:z.number().int().positive(),rows:z.number().int().positive(),tiles:z.array(z.number().int()),collision:z.enum(['none','solid']).default('none')}).loose();
/** Solid tiles merged into as few rectangles as possible (runs per row, stacked rows with equal runs merged). */
export function tileRects(map:{columns:number;rows:number;tiles:readonly number[]}){
 const rects:{x:number;y:number;w:number;h:number}[]=[],open=new Map<string,{x:number;y:number;w:number;h:number}>();
 for(let r=0;r<map.rows;r++){const next=new Map<string,{x:number;y:number;w:number;h:number}>();
  for(let c=0;c<map.columns;){if(map.tiles[r*map.columns+c]<0){c++;continue;}let e=c;while(e<map.columns&&map.tiles[r*map.columns+e]>=0)e++;const key=`${c}:${e}`,above=open.get(key);if(above){above.h++;next.set(key,above);open.delete(key);}else{const rect={x:c,y:r,w:e-c,h:1};rects.push(rect);next.set(key,rect);}c=e;}
  open.clear();for(const [k,v] of next)open.set(k,v);}
 return rects;
}
/** One collider component as shape parts, in the owning entity's local space scaled by `scale`. */
function colliderParts(c:Entity['components'][number],scale:{x:number;y:number},place:{x:number;y:number;angle:number},pivot={x:0,y:0}):ShapePart[]{
 const at=(ox:number,oy:number)=>{const p=rot({x:(ox-pivot.x)*scale.x,y:(oy-pivot.y)*scale.y},place.angle);return{x:place.x+p.x,y:place.y+p.y};},sx=Math.abs(scale.x),sy=Math.abs(scale.y);
 if(c.type==='physics.boxCollider2d'){const p=BoxColliderSchema.parse(c.data);return[{kind:'box',width:p.width*sx,height:p.height*sy,chamfer:p.chamfer*Math.min(sx,sy),...at(p.offsetX,p.offsetY),angle:place.angle,sensor:p.sensor}];}
 if(c.type==='physics.capsuleCollider2d'){const p=CapsuleColliderSchema.parse(c.data),w=p.width*sx,h=p.height*sy;return[{kind:'box',width:w,height:h,chamfer:Math.min(w,h)/2,...at(p.offsetX,p.offsetY),angle:place.angle,sensor:p.sensor}];}
 if(c.type==='physics.circleCollider2d'){const p=CircleColliderSchema.parse(c.data);if(Math.abs(sx-sy)>1e-6*Math.max(sx,sy))throw Error('Circle collider needs positive uniform scale');return[{kind:'circle',radius:p.radius*sx,...at(p.offsetX,p.offsetY),angle:0,sensor:p.sensor}];}
 if(c.type==='physics.polygonCollider2d'){const p=PolygonColliderSchema.parse(c.data),where=at(p.offsetX,p.offsetY);return convexParts(parsePoints(p.points).map(v=>({x:v.x*scale.x,y:v.y*scale.y}))).map(points=>({kind:'polygon' as const,points,...where,angle:place.angle,sensor:p.sensor}));}
 return[];
}
const isCollider=(c:Entity['components'][number])=>(colliderTypes as readonly string[]).includes(c.type)&&c.version===1;
const rigidOf=(e:Entity)=>e.components.find(c=>c.type==='physics.rigidBody2d'&&c.version===1);
const solidMap=(e:Entity)=>{const c=e.components.find(x=>x.type==='pixi.tilemap'&&x.version===1);if(!c)return undefined;const p=TilemapCollisionSchema.safeParse(c.data);return p.success&&p.data.collision==='solid'?p.data:undefined;};
interface Plan{entity:Entity;spec:PhysicsBodySpec}
/**
 * Bodies, parts and joints of a scene. A body is an entity with a Rigid Body, a collider-only entity without a body
 * above it (static), or a tilemap with solid collision. Collider-only children of a body are parts of it (compound);
 * children with their own Rigid Body are separate bodies. Dynamic bodies own their transform's x, y, rotation and scale.
 */
export function compilePhysics(entities:readonly Entity[],writers=new Map<string,string>()){
 const plans:Plan[]=[],joints:JointSpec[]=[],errors:string[]=[],byId=new Map(entities.map(e=>[e.id,e])),children=new Map<string,Entity[]>();
 for(const e of entities)if(e.parentId)children.set(e.parentId,[...(children.get(e.parentId)??[]),e]);
 const bodyAbove=(e:Entity)=>{for(let p=e.parentId?byId.get(e.parentId):undefined;p;p=p.parentId?byId.get(p.parentId):undefined)if(rigidOf(p))return p;return undefined;};
 const bodies=new Set<string>();
 for(const entity of entities){
  const rigid=rigidOf(entity),own=entity.components.filter(isCollider),map=solidMap(entity);
  if(!rigid&&!map&&(!own.length||bodyAbove(entity)))continue;
  try{
   const w=worldTransform(byId,entity.id);
   if([w.x,w.y,w.rotation].some(n=>Math.abs(n)>1e7))throw Error('Physics transform exceeds the supported world range');
   const settings:RigidBodyData=rigid?RigidBodySchema.parse(rigid.data):{...defaultRigidBody,bodyType:'static'};
   const parts:ShapePart[]=[];
   for(const c of own)parts.push(...colliderParts(c,{x:w.scaleX,y:w.scaleY},{x:0,y:0,angle:0},{x:w.pivotX,y:w.pivotY}));
   if(map){const sx=w.scaleX,sy=w.scaleY;for(const r of tileRects(map))parts.push({kind:'box',width:r.w*map.tileWidth*Math.abs(sx),height:r.h*map.tileHeight*Math.abs(sy),chamfer:0,x:((r.x+r.w/2)*map.tileWidth-w.pivotX)*sx,y:((r.y+r.h/2)*map.tileHeight-w.pivotY)*sy,angle:0,sensor:false});}
   // Collider-only descendants (stopping at descendants with their own body) are parts of this body.
   const visit=(id:string)=>{for(const child of children.get(id)??[]){if(rigidOf(child))continue;const cw=worldTransform(byId,child.id),rel=rot({x:cw.x-w.x,y:cw.y-w.y},-w.rotation);for(const c of child.components.filter(isCollider))parts.push(...colliderParts(c,{x:cw.scaleX,y:cw.scaleY},{x:rel.x,y:rel.y,angle:cw.rotation-w.rotation},{x:cw.pivotX,y:cw.pivotY}));visit(child.id);}};
   if(rigid||own.length)visit(entity.id);
   if(!parts.length)throw Error('A physics body needs a collider (on it or on a child without its own Rigid Body)');
   for(const p of parts){const dims=p.kind==='box'?[p.width,p.height]:p.kind==='circle'?[p.radius]:p.points.flatMap(v=>[Math.abs(v.x),Math.abs(v.y)]).filter(n=>n>0);if(dims.some(n=>!Number.isFinite(n)||n<.1||n>100000))throw Error('Scaled collider dimensions must be between 0.1 and 100000 pixels');}
   if(settings.bodyType==='dynamic'){const transformComponent=entity.components.find(c=>c.type==='scene.transform2d')!;for(const property of ['x','y','rotation','scaleX','scaleY']){const key=propertyKey(entity.id,transformComponent.id,property);if(writers.has(key))throw Error(`Channel already owned by ${writers.get(key)}: ${property}`);writers.set(key,`physics:${entity.id}`);}}
   plans.push({entity,spec:{entityId:entity.id,colliderId:(own[0]??rigid??entity.components[0]).id,settings,parts,x:w.x,y:w.y,rotation:w.rotation,filter:{category:2**settings.layer,mask:settings.mask,group:settings.group}}});
   bodies.add(entity.id);
  }catch(error){errors.push(`${entity.name}: ${error instanceof Error?error.message:String(error)}`);}
 }
 for(const entity of entities)for(const c of entity.components){
  if(c.type!=='physics.joint2d'||c.version!==1)continue;
  try{
   const j=JointSchema.parse(c.data);
   if(!bodies.has(entity.id))throw Error('A joint needs a Rigid Body (or collider) on its object');
   if(j.target&&!bodies.has(j.target))throw Error(byId.has(j.target)?'The joint target has no physics body':'The joint target is missing');
   if(j.target===entity.id)throw Error('A joint cannot join an object to itself');
   const scale=(id:string)=>{const w=worldTransform(byId,id);return{x:w.scaleX,y:w.scaleY};},sa=scale(entity.id),sb=j.target?scale(j.target):{x:1,y:1};
   joints.push({id:c.id,kind:j.kind,a:entity.id,b:j.target||null,anchorA:{x:j.anchorX*sa.x,y:j.anchorY*sa.y},anchorB:j.target?{x:j.targetAnchorX*sb.x,y:j.targetAnchorY*sb.y}:{x:j.targetAnchorX,y:j.targetAnchorY},length:j.length,stiffness:j.stiffness,damping:j.damping,collideConnected:j.collideConnected});
  }catch(error){errors.push(`${entity.name}: ${error instanceof Error?error.message:String(error)}`);}
 }
 return{plans,joints,errors};
}
/** Local-space outlines can be projected by any renderer; no physics/render objects enter JSON. */
export function colliderOutlines(entities:readonly Entity[]){
 const circle=(x:number,y:number,r:number)=>Array.from({length:40},(_,i)=>({x:x+Math.cos(i/40*Math.PI*2)*r,y:y+Math.sin(i/40*Math.PI*2)*r}));
 const rect=(x:number,y:number,w:number,h:number,r=0)=>r<=0?[[-1,-1],[1,-1],[1,1],[-1,1]].map(([a,b])=>({x:x+a*w/2,y:y+b*h/2})):[[1,1],[-1,1],[-1,-1],[1,-1]].flatMap(([a,b],k)=>Array.from({length:9},(_,i)=>{const t=(k*90+i*90/8)*Math.PI/180;return{x:x+a*(w/2-r)+Math.cos(t)*r,y:y+b*(h/2-r)+Math.sin(t)*r};}));
 return entities.flatMap(entity=>{const out:{entityId:string;points:{x:number;y:number}[];sensor:boolean}[]=[];
  for(const c of entity.components){if(c.version!==1)continue;try{
   if(c.type==='physics.boxCollider2d'){const p=BoxColliderSchema.parse(c.data);out.push({entityId:entity.id,points:rect(p.offsetX,p.offsetY,p.width,p.height,Math.min(p.chamfer,p.width/2,p.height/2)),sensor:p.sensor});}
   else if(c.type==='physics.capsuleCollider2d'){const p=CapsuleColliderSchema.parse(c.data);out.push({entityId:entity.id,points:rect(p.offsetX,p.offsetY,p.width,p.height,Math.min(p.width,p.height)/2),sensor:p.sensor});}
   else if(c.type==='physics.circleCollider2d'){const p=CircleColliderSchema.parse(c.data);out.push({entityId:entity.id,points:circle(p.offsetX,p.offsetY,p.radius),sensor:p.sensor});}
   else if(c.type==='physics.polygonCollider2d'){const p=PolygonColliderSchema.parse(c.data);out.push({entityId:entity.id,points:parsePoints(p.points).map(v=>({x:v.x+p.offsetX,y:v.y+p.offsetY})),sensor:p.sensor});}
  }catch{/* invalid data shows no outline */}}
  const map=solidMap(entity);if(map)for(const r of tileRects(map))out.push({entityId:entity.id,points:rect((r.x+r.w/2)*map.tileWidth,(r.y+r.h/2)*map.tileHeight,r.w*map.tileWidth,r.h*map.tileHeight),sensor:false});
  return out;});
}
/**
 * A scene's physics while it plays: builds the world on start, adds/removes bodies as objects turn on and off, steps at
 * a fixed 60 Hz, writes dynamic poses back to transforms (parent space for children), moves kinematic bodies along their
 * transforms, reports contacts, and offers `controls` to rules and scripts and `pointer` for dragging.
 */
export class PhysicsSession{
 readonly system:RuntimeSystem;errors:readonly string[]=[];private world?:PhysicsWorld;private plans:Plan[]=[];private jointSpecs:JointSpec[]=[];private byId=new Map<string,Plan>();private active=new Set<string>();private joined=new Set<string>();private dead=false;private started=false;private seconds=0;private count=0;private gravity:{x:number;y:number};private dragging:string|null=null;
 constructor(private entities:()=>readonly Entity[],private settings:PhysicsSettings,private provider:PhysicsProvider,private options:{silent?:()=>boolean;event?:(event:PhysicsEvent)=>void;bounds?:()=>{width:number;height:number}}={}){
  this.gravity={x:settings.gravityX,y:settings.gravityY};
  this.system={id:'physics',start:()=>this.start(),fixedUpdate:dt=>this.step(dt),dispose:()=>this.dispose(),spawned:()=>this.refresh(),removed:()=>this.refresh()};
 }
 start(){if(this.dead||this.started)return;this.started=true;const settings=PhysicsSettingsSchema.parse(this.settings),compiled=compilePhysics(this.entities());this.errors=compiled.errors;if(this.errors.length)return;this.plans=compiled.plans;this.jointSpecs=compiled.joints;this.byId=new Map(this.plans.map(p=>[p.entity.id,p]));
  try{this.world=this.provider.create(settings,event=>{if(this.dead)return;const a=this.byId.get(event.a),b=this.byId.get(event.b);if(a&&b)this.options.event?.({...event,colliderA:a.spec.colliderId,colliderB:b.spec.colliderId,time:this.seconds,silent:this.options.silent?.()??false});},settings.walls&&this.options.bounds?{bounds:this.options.bounds()}:{});this.reconcile();}
  catch(error){this.errors=[String(error)];this.world?.dispose();this.world=undefined;this.active.clear();}}
 /** Recompile after objects were spawned or destroyed: new bodies and joints join, those of removed objects leave. */
 refresh(){if(this.dead||!this.world)return;const compiled=compilePhysics(this.entities());if(compiled.errors.length){this.errors=compiled.errors;return;}const keep=new Set(compiled.plans.map(p=>p.entity.id)),joints=new Set(compiled.joints.map(j=>j.id));for(const id of [...this.active])if(!keep.has(id)){this.world.remove(id);this.active.delete(id);}for(const id of [...this.joined])if(!joints.has(id)){this.world.removeJoint?.(id);this.joined.delete(id);}this.plans=compiled.plans;this.jointSpecs=compiled.joints;this.byId=new Map(this.plans.map(p=>[p.entity.id,p]));this.reconcile();}
 private activeIn(entities:ReadonlyMap<string,Entity>,id:string){for(let e=entities.get(id);e;e=e.parentId?entities.get(e.parentId):undefined)if(!e.active)return false;return true;}
 private reconcile(){if(!this.world)return;const entities=new Map(this.entities().map(e=>[e.id,e]));
  for(const plan of this.plans){const on=entities.has(plan.entity.id)&&this.activeIn(entities,plan.entity.id);if(!on){if(this.active.has(plan.entity.id)){this.world.remove(plan.entity.id);this.active.delete(plan.entity.id);for(const j of this.jointSpecs)if(j.a===plan.entity.id||j.b===plan.entity.id)this.joined.delete(j.id);}continue;}
   if(!this.active.has(plan.entity.id)){const w=worldTransform(entities,plan.entity.id),matrix=PhysicsSettingsSchema.parse(this.settings);this.world.add({...plan.spec,filter:{...plan.spec.filter,mask:filterMask(matrix,plan.spec.settings.layer,plan.spec.filter.mask)},x:w.x,y:w.y,rotation:w.rotation});this.active.add(plan.entity.id);}}
  for(const j of this.jointSpecs){const on=this.active.has(j.a)&&(!j.b||this.active.has(j.b));if(on&&!this.joined.has(j.id)){this.world.addJoint?.(j);this.joined.add(j.id);}else if(!on&&this.joined.has(j.id)){this.world.removeJoint?.(j.id);this.joined.delete(j.id);}}}
 private step(dt:number){if(this.dead||!this.world)return;if(!Number.isFinite(dt)||Math.abs(dt-1/60)>1e-8)throw Error('Physics requires a fixed 1/60 second step');this.seconds+=dt;this.reconcile();
  const entities=new Map(this.entities().map(e=>[e.id,e]));
  for(const plan of this.plans)if(plan.spec.settings.bodyType==='kinematic'&&this.active.has(plan.entity.id)){const w=worldTransform(entities,plan.entity.id);this.world.setPose?.(plan.entity.id,w.x,w.y,w.rotation,dt);}
  this.world.step(dt);
  this.projectPoses(entities);
  this.count++;}
 /** Copy current body poses after a renderer rebuild, without advancing the simulation. */
 projectPoses(entities=new Map(this.entities().map(e=>[e.id,e]))){if(!this.world||this.dead)return;
  for(const pose of this.world.poses()){const entity=entities.get(pose.entityId),plan=this.byId.get(pose.entityId);if(!entity||!plan||plan.spec.settings.bodyType!=='dynamic')continue;const component=entity.components.find(c=>c.type==='scene.transform2d'&&c.version===1);if(!component||!component.data||typeof component.data!=='object'||Array.isArray(component.data))continue;
   if(!entity.parentId){Object.assign(component.data,{x:pose.x,y:pose.y,rotation:pose.rotation});continue;}
   const parent=worldTransform(entities,entity.parentId),local=rot({x:pose.x-parent.x,y:pose.y-parent.y},-parent.rotation);Object.assign(component.data,{x:local.x/(parent.scaleX||1)+parent.pivotX,y:local.y/(parent.scaleY||1)+parent.pivotY,rotation:pose.rotation-parent.rotation});}}
 private need(){if(!this.world)throw Error('Physics is not running in this scene');return this.world;}
 private method<K extends keyof PhysicsWorld>(name:K){const fn=this.need()[name];if(typeof fn!=='function')throw Error(`The physics provider cannot ${String(name)}`);return(fn as (...args:never[])=>unknown).bind(this.world) as NonNullable<PhysicsWorld[K]>;}
 /** Runtime control for rules and scripts (object IDs; px, px/s, degrees). */
 readonly controls:PhysicsControls={
  setVelocity:(id,x,y)=>this.method('setVelocity')(id,x,y),setAngularVelocity:(id,d)=>this.method('setAngularVelocity')(id,d),
  applyForce:(id,x,y)=>this.method('applyForce')(id,x,y),applyImpulse:(id,x,y)=>this.method('applyImpulse')(id,x,y),
  teleport:(id,x,y)=>{const pose=this.need().poses().find(p=>p.entityId===id);if(!pose)throw Error('This object has no physics body');this.method('setPose')(id,x,y,pose.rotation);},
  body:id=>this.world?.body?.(id),
  gravity:()=>({...this.gravity}),setGravity:(x,y)=>{if(![x,y].every(Number.isFinite))throw Error('Gravity must be finite');this.gravity={x,y};this.method('setGravity')(x,y);},
  raycast:(x1,y1,x2,y2)=>this.method('raycast')({x:x1,y:y1},{x:x2,y:y2}),
  objectsAt:(x,y)=>this.method('point')(x,y),objectsIn:(x,y,w,h)=>this.method('region')(x,y,x+w,y+h),
 };
 /** Pointer in world pixels: press on a draggable dynamic body to drag it, release to drop. Returns whether a body is held. */
 pointer(phase:'down'|'move'|'up',x:number,y:number){
  if(!this.world?.drag)return false;
  if(phase==='down'){const id=(this.world.point?.(x,y)??[]).find(id=>{const p=this.byId.get(id);return p?.spec.settings.draggable&&p.spec.settings.bodyType==='dynamic';});this.dragging=id??null;if(id)this.world.drag(id,{x,y});return Boolean(id);}
  if(phase==='move'&&this.dragging){this.world.drag(this.dragging,{x,y});return true;}
  if(phase==='up'&&this.dragging){this.world.drag(null);this.dragging=null;return true;}
  return false;
 }
 get diagnostics(){return{time:this.seconds,steps:this.count,bodies:this.world?.poses()??[],joints:[...this.joined],gravity:this.gravity,dragging:this.dragging,errors:this.errors};}
 dispose(){if(this.dead)return;this.dead=true;this.world?.dispose();this.world=undefined;this.active.clear();this.joined.clear();this.plans=[];this.byId.clear();}
}

function emitPhysicsInteraction(
 emit:(event:InteractionEvent)=>void,
 contact:{a:string;b:string;phase:'enter'|'exit';silent:boolean;contact?:InteractionEvent['data']},
){
 const {a,b,phase,silent}=contact;
 const data=contact.contact?{data:contact.contact}:{};
 emit({type:`physics.${phase}`,sourceId:a,event:b,silent,...data});
 emit({type:`physics.${phase}`,sourceId:b,event:a,silent,...data});
}

/** Create the play world's physics and send its contacts to the common interaction bus. */
export function createScenePhysics(entities:()=>readonly Entity[],settings:PhysicsSettings,provider:PhysicsProvider,ports:{
 bounds():{width:number;height:number};silent():boolean;emit(event:InteractionEvent):void;
 observe?(event:PhysicsEvent):void;
}){
 return new PhysicsSession(entities,settings,provider,{
  bounds:ports.bounds,silent:ports.silent,
  event(event){emitPhysicsInteraction(ports.emit,event);ports.observe?.(event);},
 });
}
