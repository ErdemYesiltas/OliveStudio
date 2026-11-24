import type {AssetRecord} from '@rewrite/assets';
import {ModelMetadataSchema,model3dDefinition,modelAssetType} from './model-contracts';
import type {Json} from '@rewrite/sdk';
import {makeViewport3D,identity3D,space3d,transform3dType,Viewport3DSchema} from '@rewrite/scene3d';
import {spatialBoundaryId,spatialDefinition,type SceneService,type Entity} from '@rewrite/scene';
import {withEuler} from './math';
import {primitive3dDefinition,camera3dDefinition,sprite3dDefinition,light3dDefinition,particles3dDefinition,instances3dDefinition} from './contracts';
const component=(type:string,data:Json)=>({id:crypto.randomUUID(),type,version:1,data});
function node(name:string,parentId:string,data=identity3D()):Entity{return{id:crypto.randomUUID(),name,parentId,active:true,spatial:transform3dType,components:[component(transform3dType,data)]};}
export class Authoring3D{
 constructor(readonly scene:SceneService,private select:(id:string)=>void,private selection:()=>string|null,private editable:()=>boolean,private center:()=>{x:number;y:number}){}
 get snapshot(){return this.scene.document.current;}
 get modelTargets(){
  const views=this.snapshot.entities.filter(e=>e.components.some(c=>c.type==='pixi3d.viewport'&&c.version===1)),counts=new Map<string,number>();for(const e of views)counts.set(e.name,(counts.get(e.name)??0)+1);
  return views.map(e=>({id:e.id,name:e.name,label:counts.get(e.name)!>1?`${e.name} · ${e.id.slice(0,8)}`:e.name}));
 }
 private newView(){const names=new Set(this.snapshot.entities.map(e=>e.name));let name='3D View',n=2;while(names.has(name))name=`3D View ${n++}`;const at=this.center();return makeViewport3D(name,Math.round(at.x-320),Math.round(at.y-180));}
 modelParent(parentId?:string|null):string|null{
  const explicit=parentId!==undefined,parent=this.snapshot.entities.find(e=>e.id===(explicit?parentId:this.selection()));
  if(parent&&(parent.components.some(c=>c.type==='pixi3d.viewport'&&c.version===1)||spatialDefinition(parent,this.scene.definitions()).space===space3d))return parent.id;
  if(explicit)throw Error('Choose an existing 3D view or object');
  const views=this.modelTargets;return views.length===1?views[0].id:null;
 }
/** Lights the selected (or only) 3D view with an HDR asset and shows it as the sky; switches on ACES if no tone mapping is set. */
 /** One undoable edit of a component's data, refused when it changed since the gesture began (stale `expected`). */
 setComponentData(entityId:string,type:string,data:Record<string,unknown>,expected:unknown,label='Edit 3D gizmo'){this.check();const entity=this.scene.document.current.entities.find(e=>e.id===entityId),current=entity?.components.find(c=>c.type===type);
  if(!current)throw Error('Component is missing');if(JSON.stringify(current.data)!==JSON.stringify(expected))throw Error('The component changed during the drag');const definition=this.scene.definitions().get(type);const parsed=definition?definition.parse(data):data;
  this.scene.document.transact(label,s=>{s.entities.find(e=>e.id===entityId)!.components.find(c=>c.type===type)!.data=parsed as Json;});}
 applyEnvironment(asset:AssetRecord){
  this.check();if(asset.type!=='pixi3d.environment')throw Error('Choose an HDR environment asset');const byId=new Map(this.snapshot.entities.map(e=>[e.id,e]));
  let view:Entity|undefined;for(let e=byId.get(this.selection()??'');e;e=e.parentId?byId.get(e.parentId):undefined)if(e.components.some(c=>c.type==='pixi3d.viewport'&&c.version===1)){view=e;break;}
  const views=this.snapshot.entities.filter(e=>e.components.some(c=>c.type==='pixi3d.viewport'&&c.version===1));view??=views.length===1?views[0]:undefined;
  if(!view)throw Error('Select a 3D view (or an object inside one) before applying an environment');const id=view.id;
  this.scene.document.transact('Apply HDR environment',s=>{const c=s.entities.find(e=>e.id===id)!.components.find(c=>c.type==='pixi3d.viewport')!,data=Viewport3DSchema.parse(c.data);c.data={...(c.data as object),environment:'hdr',environmentAssetId:asset.id,background:'environment',toneMapping:data.toneMapping==='none'?'aces':data.toneMapping};});
  return id;
 }
 private check(){if(!this.editable())throw Error('Stop Preview and finish file operations first');}
 createView(){this.check();const view=this.newView(),cube=node('Cube',view.id),camera=node('Camera',view.id,{...identity3D(),z:6}),sun=node('Sun',view.id,withEuler(identity3D(),{x:-35,y:40,z:0})),ambient=node('Ambient',view.id);
  cube.components.push(component(primitive3dDefinition.type,primitive3dDefinition.defaults()));camera.components.push(component(camera3dDefinition.type,camera3dDefinition.defaults()));sun.components.push(component(light3dDefinition.type,light3dDefinition.defaults()));ambient.components.push(component(light3dDefinition.type,{...light3dDefinition.defaults() as object,kind:'ambient',intensity:.5}));
  (view.components.find(c=>c.type==='pixi3d.viewport')!.data as Record<string,Json>).cameraId=camera.id;
  this.scene.document.transact('Create 3D view',s=>{s.entities.push(view,cube,camera,sun,ambient);});this.select(cube.id);return{viewId:view.id,entityId:cube.id,cameraId:camera.id};
 }
 placeModel(asset:AssetRecord,parentId?:string|null){
  this.check();this.checkAsset(asset);const parent=this.modelParent(parentId);if(!parent)throw Error('Choose a 3D view or create a new one before placing a model');
  const entity=this.modelEntity(asset,parent);this.scene.document.transact('Place 3D model',s=>{s.entities.push(entity);});this.select(entity.id);return{id:entity.id,assetId:asset.id};
 }
 private checkAsset(asset:AssetRecord){if(asset.type!==modelAssetType)throw Error('Choose a 3D model asset');ModelMetadataSchema.parse(asset.metadata);}
 private modelEntity(asset:AssetRecord,parentId:string){const entity=node(asset.name,parentId);entity.components.push(component(model3dDefinition.type,{...model3dDefinition.defaults() as object,assetId:asset.id}));return entity;}
 placeModelInNewView(asset:AssetRecord){
  this.check();this.checkAsset(asset);const view=this.newView(),entity=this.modelEntity(asset,view.id),camera=node('Camera',view.id,{...identity3D(),z:6}),sun=node('Sun',view.id,withEuler(identity3D(),{x:-35,y:40,z:0})),ambient=node('Ambient',view.id);
  camera.components.push(component(camera3dDefinition.type,camera3dDefinition.defaults()));sun.components.push(component(light3dDefinition.type,light3dDefinition.defaults()));ambient.components.push(component(light3dDefinition.type,{...light3dDefinition.defaults() as object,kind:'ambient',intensity:.5}));
  (view.components.find(c=>c.type==='pixi3d.viewport')!.data as Record<string,Json>).cameraId=camera.id;
  this.scene.document.transact('Place model in new 3D view',s=>{s.entities.push(view,entity,camera,sun,ambient);});this.select(entity.id);return{id:entity.id,viewId:view.id,assetId:asset.id};
 }

 create(kind:'cube'|'sphere'|'plane'|'camera'|'directional'|'ambient'|'particles'|'instances'|'point'|'spot'|'sprite3d',parentId=this.selection()){
  this.check();const source=this.scene.document.current,parent=source.entities.find(e=>e.id===parentId);if(!parent)throw Error('Select a 3D view or an object inside it');
  const boundary=parent.components.some(c=>c.type==='pixi3d.viewport'&&c.version===1);if(!boundary&&spatialDefinition(parent,this.scene.definitions()).space!==space3d)throw Error('Select a 3D view or an object inside it');
  const pose=kind==='camera'?{...identity3D(),z:6}:kind==='point'?{...identity3D(),y:2}:kind==='spot'?withEuler({...identity3D(),y:3},{x:-90,y:0,z:0}):kind==='plane'?withEuler({...identity3D(),scaleX:4,scaleY:4},{x:-90,y:0,z:0}):identity3D(),e=node(kind==='sprite3d'?'Sprite 3D':kind[0].toUpperCase()+kind.slice(1),parent.id,pose);
  const definition=kind==='camera'?camera3dDefinition:kind==='sprite3d'?sprite3dDefinition:kind==='particles'?particles3dDefinition:kind==='instances'?instances3dDefinition:['directional','ambient','point','spot'].includes(kind)?light3dDefinition:primitive3dDefinition;
  const data=definition.defaults() as Record<string,Json>;if(definition===primitive3dDefinition)data.shape=kind;if(definition===light3dDefinition)data.kind=kind;
  e.components.push(component(definition.type,data));this.scene.document.transact('Create 3D '+kind,s=>{s.entities.push(e);});this.select(e.id);return{id:e.id,viewId:boundary?parent.id:spatialBoundaryId(this.scene.document.current,e.id,this.scene.definitions())};
 }
}
