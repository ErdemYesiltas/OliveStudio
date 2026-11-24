import {ModelAnimations} from '@rewrite/render-pixi3d/animation';
import {shaderValidator} from '@rewrite/render-pixi3d/shader3d-validator';
import {modelAnimationActions} from '@rewrite/render-pixi3d/animation-contracts';
import {highlight3dActions} from '@rewrite/render-pixi3d/debug3d';
import {paint3dActions} from '@rewrite/render-pixi3d/place3d';
import {runtime3DProblems} from '@rewrite/render-pixi3d/preflight';
import {select3DBackend} from '@rewrite/render-pixi3d/backend';
import type {Container} from 'pixi.js';
import {Scene3DProjection} from '@rewrite/render-pixi3d/projection';
import {transform3dType} from '@rewrite/scene3d';
import type {PlayerPlugin} from '../plugin';
/** Optional browser projection. The module is loaded before GamePlayer.init, registering Pixi's 3D pipes. */
export default {id:'pixi3d',create(ctx){
 let projection:Scene3DProjection|undefined;
 const animation=new ModelAnimations(id=>projection?.slots.flatMap(s=>[s.models.get(id)?.instance?.player]).find(Boolean),ctx.assets.get,(id,silent)=>ctx.emit({type:'animation3d.complete',sourceId:id,silent}));
 ctx.services.set('animation3d',{control(id:string,action:import('@rewrite/render-pixi3d/animation-contracts').ModelAnimationAction,time?:number){animation.sync(ctx.entities());return animation.control(id,action,time);}});
 ctx.inspectors.set('pixi3d.deformation',query=>{if(!projection)throw Error('3D projection is not ready');return projection.inspectDeformation(query);});
 ctx.inspectors.set('pixi3d.materials',query=>{if(!projection)throw Error('3D projection is not ready');return projection.inspectMaterials(query);});
 ctx.inspectors.set('pixi3d.models',query=>{if(!projection)throw Error('3D projection is not ready');return projection.inspectModel(query);});
 const report=(error:unknown)=>ctx.report(String(error));
 // Scripts pick in the 3D views and read model load states through this service (world pixels in, like game.pointer).
 ctx.services.set('script3d',{raycast:(x:number,y:number)=>projection?.raycastHit(ctx.toGlobal(x,y))??null,model:(id:string)=>projection?.modelState(id)??{state:'loading'},stats:()=>projection?.resources?.stats??null,
  defineGeometry:(id:string,data:import('@rewrite/render-pixi3d/mesh3d').ScriptGeometry)=>{if(!projection)throw Error('3D projection is not ready');projection.defineGeometry(id,data);},setMeshGeometry:(entityId:string,id:string)=>{if(!projection)throw Error('3D projection is not ready');projection.setMeshGeometry(entityId,id);},setMorph:(entityId:string,w:readonly number[])=>projection?.setMorph(entityId,w),
  writeParticles:(entityId:string,data:Float32Array,count:number)=>projection?.writeScriptParticles(entityId,data,count),setBatchGeometries:(entityId:string,ids:readonly string[])=>projection?.setBatchGeometries(entityId,ids),writeBatch:(entityId:string,data:Float32Array,count:number)=>projection?.writeBatch(entityId,data,count)});
 return{
  spatialTypes:[transform3dType],
  renderer:requested=>select3DBackend(requested,navigator.gpu),
  actions:[...modelAnimationActions(()=>({control(id,action,time){animation.sync(ctx.entities());return animation.control(id,action,time);}})),...highlight3dActions,...paint3dActions],
  systems(){let time=0,particles=0;return[{id:'animation3d',start(){animation.reset(ctx.entities());},update(dt){animation.sync(ctx.entities());animation.advanceTo(time+=dt);},dispose(){animation.clear();}},
   {id:'particles3d',start(){particles=0;projection?.setParticleTime(0);},update(dt){projection?.setParticleTime(particles+=dt);},dispose(){}}];},
  async prepare(){const problems=ctx.bundle.project.scenes.flatMap(scene=>runtime3DProblems(scene,ctx.assets.get,ctx.bundle.project.extensions['pixi3d.shaders']??{version:1,items:[]}));if(problems.length)throw Error(problems.join('\n'));},
  decorate(entities,node,renderer){
   projection??=new Scene3DProjection({shaderLibrary:()=>ctx.bundle.project.extensions['pixi3d.shaders'] as never,shaderValidator:shaderValidator(),
    // A shader that does not compile on this device falls back to the object's own material; the game goes on.
    warn:message=>console.warn(`[3D] ${message}`),node,renderer,changed:()=>{if(!ctx.signal.aborted)ctx.changed();},report,
    // A dragged object writes its new place into the running scene, so other systems and later frames see it.
    moved:(id,p)=>{const transform=ctx.entities().find(e=>e.id===id)?.components.find(c=>c.type==='scene3d.transform');if(transform)Object.assign(transform.data as object,p);ctx.changed();},
    emit:(type,sourceId)=>ctx.emit({type,sourceId,silent:false})},ctx.assets);
   projection.sync({formatVersion:1,id:'runtime',name:'Runtime',entities:[...entities]});
   // A report during sync can end the session and dispose the projection; then there is nothing left to decorate.
   if(!projection)return;
   projection.useSceneCameras();animation.sync(entities);
   for(const slot of projection.slots)slot.view.eventMode='static';
   if(ctx.host)ctx.host.dataset.spatial3d=JSON.stringify({...projection.diagnostics(),animations:animation.diagnostics});
  },
  ready:async()=>{await projection?.ready();},
  hitEntity(node:Container,point,listens){const slot=projection?.slots.find(s=>s.view===node);return slot?projection?.pick(slot,point,listens)??undefined:undefined;},
  clear(){animation.clear();projection?.resetScripted();projection?.clear();},
  dispose(){animation.clear();const owned=projection;projection=undefined;void owned?.dispose().catch(report);}
 };
}} satisfies PlayerPlugin;
