import {RuntimeSpawnQueue,type RuntimeEntity,type RuntimeSession,type SpawnPreparationPorts} from './runtime/index.js';
import {parentsFirst,spawnCopy,worldPosition,type Entity,type Scene} from './scene.js';

type ReferencePaths=Parameters<typeof spawnCopy>[2];
interface SpawnTarget{name?:string;id?:string}
interface GameScenePorts extends Omit<SpawnPreparationPorts,'committed'>{
 scenes():readonly Scene[];
 prefabs():readonly {id?:string;name:string;rootId:string;entities:readonly Entity[]}[];
 references:ReferencePaths;
 validate?(scene:Scene):void;
 project?(entities:readonly Entity[]):Entity[];
 immediate?(entities:readonly Entity[]):void;
 removed?(ids:readonly string[]):void;
 added?(id:string):void;
}

function checkCapacity(current:number,added:number){
 if(current+added>10000)throw Error('A scene can have at most 10,000 objects');
}

/** The live scene's spawn and additive operations. The host projects and prepares the resulting objects. */
export class GameSceneObjects{
 private queue:RuntimeSpawnQueue;
 private addedScenes=new Map<string,string[]>();
 private remappedPaths=new Map<string,ReturnType<ReferencePaths>>();

 constructor(private session:RuntimeSession,private sceneId:string,private ports:GameScenePorts){
  this.queue=new RuntimeSpawnQueue(session,{
   prepare:async candidate=>{checkCapacity(0,candidate.length);await ports.prepare(candidate);},
   rollback:ports.rollback,report:ports.report,sync:ports.sync,changed:ports.changed,
   committed:(key,ids)=>{
    const added=new Set(ids);
    const roots=this.entities.filter(entity=>added.has(entity.id)&&(!entity.parentId||!added.has(entity.parentId)));
    this.addedScenes.set(key,roots.map(entity=>entity.id));
    ports.added?.(key);
   },
  });
 }

 get active(){return this.queue.active;}
 get pendingKeys(){return this.queue.pendingKeys;}
 get additions(){return [...this.addedScenes.keys()];}
 idle(){return this.queue.idle();}
 private get entities(){return this.session.world.entities as unknown as readonly Entity[];}

 spawn(target:SpawnTarget,x:number,y:number,near?:string){
  const world=this.entities;
  const prefabId=target.id?.startsWith('prefab:')?target.id.slice(7):undefined;
  const prefab=this.ports.prefabs().find(item=>prefabId?item.id===prefabId:target.name!==undefined&&item.name===target.name);
  const rootId=prefab?.rootId??world.find(entity=>target.id?entity.id===target.id:entity.name===target.name)?.id;
  if(!rootId)throw Error(`Nothing to spawn: ${target.name??target.id}`);
  const origin=(near?worldPosition(world,near):undefined)??{x:0,y:0};
  const paths:ReferencePaths=component=>this.remappedPaths.get(component.id)??this.ports.references(component);
  const copiedPaths=new Map<string,ReturnType<ReferencePaths>>();
  const copy=spawnCopy(prefab?.entities??world,rootId,paths,{x:origin.x+x,y:origin.y+y},(from,to)=>{
   const list=paths(from);
   if(list.length)copiedPaths.set(to.id,list);
  });
  const projected=this.ports.project?.(copy)??copy;
  checkCapacity(world.length,projected.length);
  for(const entity of projected)for(const component of entity.components){
   const list=copiedPaths.get(component.id);
   if(list)this.remappedPaths.set(component.id,list);
  }
  this.session.spawn(projected as unknown as RuntimeEntity[]);
  this.ports.immediate?.(projected);
  return projected[0].id;
 }

 add(id:string){
  if(id===this.sceneId)throw Error('This scene is already running');
  if(this.addedScenes.has(id)||this.queue.pendingKeys.includes(id))return;
  const source=this.ports.scenes().find(scene=>scene.id===id);
  if(!source)throw Error('Scene target is missing');
  this.ports.validate?.(source);
  const world=this.entities,taken=new Set(world.map(entity=>entity.id));
  const clash=source.entities.find(entity=>taken.has(entity.id));
  if(clash)throw Error(`Cannot add scene ${source.name}: object ${clash.name} is already running`);
  checkCapacity(world.length,source.entities.length);
  const copy=structuredClone(source.entities);
  this.queue.enqueue(id,parentsFirst(this.ports.project?.(copy)??copy) as unknown as RuntimeEntity[]);
 }

 remove(id:string){
  this.queue.cancel(id);
  const roots=this.addedScenes.get(id);
  if(!roots)return;
  this.addedScenes.delete(id);
  this.destroy(roots);
 }

 destroy(ids:readonly string[]){
  const before=this.entities;
  const tracked=before.filter(entity=>entity.components.some(component=>this.remappedPaths.has(component.id)));
  const removed=this.session.despawn(ids);
  const gone=new Set(removed);
  for(const entity of tracked)if(gone.has(entity.id))for(const component of entity.components)this.remappedPaths.delete(component.id);
  this.ports.removed?.(removed);
 }

 dispose(){
  this.queue.dispose();
  this.addedScenes.clear();
  this.remappedPaths.clear();
 }
}

/** A requested scene change is consumed at a frame boundary. The budget spans scene replacements. */
export class GameSceneTransitions{
 private pending?:string;
 private recent:number[]=[];
 constructor(private now=()=>performance.now()){}
 request(id:string){this.pending=id;}
 clear(){this.pending=undefined;}
 reset(){this.clear();this.recent=[];}

 take(scenes:readonly Scene[]):Scene|undefined{
  const id=this.pending;
  this.clear();
  if(!id)return;
  const now=this.now();
  this.recent=this.recent.filter(time=>now-time<1000);
  if(this.recent.length>=8)throw Error('Scene transition cycle limit reached');
  this.recent.push(now);
  const scene=scenes.find(scene=>scene.id===id);
  if(!scene)throw Error('Scene target is missing');
  return scene;
 }
}
