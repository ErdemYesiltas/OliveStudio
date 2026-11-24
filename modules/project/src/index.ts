import {registerProjectAutomation} from './automation';
import { z } from 'zod';
import { DocumentSession, type DocumentPort } from '@rewrite/documents';
import { slot,token,type ComponentDefinition,type EditorModule,type Json } from '@rewrite/sdk';
import { blankScene,SceneSchema,migrateScene,parseScene,type Scene } from '@rewrite/scene';

/** Authoring/game resolution. Absent in older projects, which keep the original 960×540 stage. */
export const StageSchema=z.object({width:z.number().int().min(64).max(4096),height:z.number().int().min(64).max(4096)}).strict();
export const defaultStage={width:960,height:540} as const;
export function stageSize(project:{stage?:{width:number;height:number}}):{width:number;height:number}{return project.stage??defaultStage;}
export const ProjectSchema=z.object({formatVersion:z.literal(1),name:z.string().trim().min(1).max(100),entrySceneId:z.string().min(1),scenes:z.array(SceneSchema).min(1).max(100),modules:z.record(z.string(),z.string()),providers:z.record(z.string(),z.string()),extensions:z.record(z.string(),z.json()).default({}),stage:StageSchema.optional()}).strict();
export type Project=z.infer<typeof ProjectSchema>;
const legacy3DModules=['scene3d','pixi3d-editor','pixi3d-lab'] as const;
const shader3DSection='pixi3d.shaders';
const emptyShader3DLibrary=z.object({version:z.literal(1),items:z.tuple([])}).strict();
const is3DType=(value:unknown)=>typeof value==='string'&&(value.startsWith('scene3d.')||value.startsWith('pixi3d.'));

/** A saved 2D project may carry every installed editor module's lock. Inspect its content before dropping those locks. */
export function has3DContent(project:Project):boolean{
 const contains3D=(value:Json|undefined)=>{
  const pending=[value];
  while(pending.length){
   const current=pending.pop();
   if(!current||typeof current!=='object')continue;
   if(Array.isArray(current)){for(const child of current)pending.push(child);}
   else{
    if(is3DType(current.type)||is3DType(current.spatial))return true;
    for(const child of Object.values(current))pending.push(child);
   }
  }
  return false;
 };
 for(const scene of project.scenes)for(const entity of scene.entities){
  if(is3DType(entity.spatial)||entity.components.some(component=>is3DType(component.type)
   ||(component.type==='prefabs.instance'&&contains3D(component.data))))return true;
 }
 return contains3D(project.extensions['prefabs.registry'])||contains3D(project.extensions['assets.registry'])
  ||(shader3DSection in project.extensions&&!emptyShader3DLibrary.safeParse(project.extensions[shader3DSection]).success);
}
export function assert2DProject(project:Project):void{
 if(has3DContent(project))throw Error('This project contains 3D content. Open it in the full OliveStudio editor.');
}
export interface SceneReference {targetSceneId:string|null;sceneId?:string;label:string}
export interface ReferenceScope {sceneId?:string;name:string;entities:readonly {name:string;components:readonly {type:string;version:number;data:Json}[]}[]}
export function sceneReferencesIn(scope:ReferenceScope,definitions:ReadonlyMap<string,ComponentDefinition>):SceneReference[]{return scope.entities.flatMap(e=>e.components.flatMap((component):SceneReference[]=>{const def=definitions.get(component.type),label=`${scope.name} / ${e.name} · ${component.type}`;if(!def||def.version!==component.version)return[{targetSceneId:null,sceneId:scope.sceneId,label}];return (def.sceneReferences?.(component.data)??[]).filter(id=>id!=='').map(targetSceneId=>({targetSceneId,sceneId:scope.sceneId,label}));}));}
export interface ProjectSection { key:string;dataSchema?:Record<string,unknown>;parse(value:unknown):Json;validate?(project:Project):void;prepare?(project:Project):void;sceneReferences?(project:Project):readonly SceneReference[] }
export const projectSections=slot<ProjectSection>('project.sections');
export function newProject(scene=blankScene()):Project{return{formatVersion:1,name:scene.name,entrySceneId:scene.id,scenes:[scene],modules:{},providers:{render:'pixi'},extensions:{}};}
export function parseProject(input:unknown,definitions:ReadonlyMap<string,ComponentDefinition>,sections:readonly ProjectSection[]=[]):Project{
 const p=ProjectSchema.parse(input);
 assert2DProject(p);
 for(const id of legacy3DModules)delete p.modules[id];
 delete p.extensions[shader3DSection];
 if(new Set(p.scenes.map(s=>s.id)).size!==p.scenes.length)throw Error('Duplicate scene ID');
 if(!p.scenes.some(s=>s.id===p.entrySceneId))throw Error('Entry scene is missing');
 for(const scene of p.scenes)parseScene(scene,definitions);
 for(const section of sections){if(section.key in p.extensions)section.parse(p.extensions[section.key]);section.validate?.(p);}
 return p;
}
export class ProjectService {
 readonly document:DocumentSession<Project>;
 readonly sceneDocument:DocumentPort<Scene>;
 generation=0;
 private editingId:string|null=null;
 private editorVersion=0;
 private editorListeners=new Set<()=>void>();
 get activeSceneId():string{return this.editingId??this.document.current.entrySceneId;}
 private publishEditor(){for(const listener of this.editorListeners)listener();}
 openScene(id:string):void{if(!this.document.current.scenes.some(s=>s.id===id))throw Error('Scene missing');const changed=this.activeSceneId!==id;this.editingId=id;if(!changed)return;this.editorVersion++;this.publishEditor();}
 createScene(name='Untitled scene'):string{const scene=blankScene();scene.name=SceneSchema.shape.name.parse(name.trim());this.document.transact('Create scene',p=>{p.scenes.push(scene);});this.openScene(scene.id);return scene.id;}
 duplicateScene(id:string):string{
  const source=this.document.current.scenes.find(s=>s.id===id);if(!source)throw Error('Scene missing');
  if(this.document.current.scenes.length>=100)throw Error('The project supports at most 100 scenes');
  const definitions=this.definitions();
  for(const entity of source.entities)for(const component of entity.components){const def=definitions.get(component.type);if(!def||def.version!==component.version)throw Error(`Cannot duplicate unsupported component: ${component.type} v${component.version}`);if(def.sceneReferences?.(component.data)?.some(ref=>ref===null))throw Error(`Cannot determine scene references: ${component.type}`);}
  const copy=structuredClone(source),sceneId=crypto.randomUUID(),entities=new Map(copy.entities.map(e=>[e.id,crypto.randomUUID()])),components=new Map(copy.entities.flatMap(e=>e.components.map(c=>[c.id,crypto.randomUUID()] as const)));
  const names=new Set(this.document.current.scenes.map(s=>s.name));let suffix=' copy',n=2;while(names.has(source.name.slice(0,100-suffix.length)+suffix))suffix=` copy ${n++}`;
  copy.id=sceneId;copy.name=source.name.slice(0,100-suffix.length)+suffix;
  // Preserve provider-local IDs consistently with linked prefab entity duplication.
  const preserveLocalIds=copy.entities.some(e=>e.components.some(c=>definitions.get(c.type)?.preserveLocalIdsOnDuplicate));
  for(const entity of copy.entities){entity.id=entities.get(entity.id)!;if(entity.parentId)entity.parentId=entities.get(entity.parentId)!;for(const component of entity.components){const def=definitions.get(component.type)!;component.id=components.get(component.id)!;const expected=def.sceneReferences?.(component.data)?.map(ref=>ref===id?sceneId:ref).sort();if(def.remapReferences)component.data=def.remapReferences(component.data,{entities,components,scenes:new Map([[id,sceneId]]),preserveLocalIds});if(expected&&JSON.stringify(expected)!==JSON.stringify([...def.sceneReferences!(component.data)].sort()))throw Error(`Scene reference remapping is unsupported: ${component.type}`);}}
  this.document.transact('Duplicate scene',p=>{p.scenes.splice(p.scenes.findIndex(s=>s.id===id)+1,0,copy);});this.openScene(sceneId);return sceneId;
 }
 setStage(size:{width:number;height:number}):void{const next=StageSchema.parse(size),current=stageSize(this.document.current);if(next.width===current.width&&next.height===current.height)return;this.document.transact('Set stage size',p=>{p.stage=next;});}
 renameProject(name:string):void{this.document.transact('Rename project',p=>{p.name=ProjectSchema.shape.name.parse(name);});}
 renameScene(id:string,name:string):void{const parsed=SceneSchema.shape.name.parse(name.trim());this.document.transact('Rename scene',p=>{const scene=p.scenes.find(s=>s.id===id);if(!scene)throw Error('Scene missing');scene.name=parsed;});}
 setEntryScene(id:string):void{if(!this.document.current.scenes.some(s=>s.id===id))throw Error('Scene missing');this.editingId=this.activeSceneId;this.document.transact('Set startup scene',p=>{p.entrySceneId=id;});}
 /** Every scene change between scenes (rules, graphs, state machines, scripts…), for the Scenes flow: from → to, with where it is. */
 sceneFlow():{from:string;to:string;label:string}[]{const p=this.document.current,seen=new Set<string>();return [...p.scenes.flatMap(s=>sceneReferencesIn({sceneId:s.id,name:s.name,entities:s.entities},this.definitions())),...this.sections().flatMap(section=>section.sceneReferences?.(p)??[])].flatMap(ref=>ref.sceneId&&ref.targetSceneId&&ref.targetSceneId!==ref.sceneId&&p.scenes.some(s=>s.id===ref.targetSceneId)?[{from:ref.sceneId,to:ref.targetSceneId,label:ref.label}]:[]).filter(e=>{const k=e.from+"→"+e.to+e.label;if(seen.has(k))return false;seen.add(k);return true;});}
 sceneUsages(id:string):SceneReference[]{const p=this.document.current;return [...p.scenes.flatMap(s=>s.id===id?[]:sceneReferencesIn({sceneId:s.id,name:s.name,entities:s.entities},this.definitions())),...this.sections().flatMap(section=>section.sceneReferences?.(p)??[])].filter(ref=>ref.sceneId!==id&&(ref.targetSceneId===id||ref.targetSceneId===null));}
 removeScene(id:string):void{const p=this.document.current;if(!p.scenes.some(s=>s.id===id))throw Error('Scene missing');if(p.scenes.length===1)throw Error('The project needs at least one scene');if(this.sceneUsages(id).length)throw Error('Scene is referenced or its references cannot be checked. Resolve the listed usages first.');this.document.transact('Delete scene',draft=>{draft.scenes=draft.scenes.filter(s=>s.id!==id);if(draft.entrySceneId===id)draft.entrySceneId=draft.scenes[0].id;});}

 constructor(private definitions:()=>ReadonlyMap<string,ComponentDefinition>,private sections:()=>readonly ProjectSection[]){
  this.document=new DocumentSession(newProject(),v=>parseProject(v,definitions(),sections()));
  const root=this.document,active=()=>this.activeSceneId,editorVersion=()=>this.editorVersion;
  root.subscribe(()=>{if(this.editingId&&!root.current.scenes.some(s=>s.id===this.editingId))this.editingId=null;this.publishEditor();});
  this.sceneDocument={
   get current(){return root.current.scenes.find(s=>s.id===active())!;},
   get version(){return root.version+editorVersion();},get dirty(){return root.dirty;},get canUndo(){return root.canUndo;},get canRedo(){return root.canRedo;},
   subscribe:listener=>{this.editorListeners.add(listener);return()=>{this.editorListeners.delete(listener);};},
   transact(label,edit){root.transact(label,d=>{edit(d.scenes.find(s=>s.id===active())!);});},
   undo(){root.undo();},redo(){root.redo();},
   replace(input){const next=structuredClone(root.current);next.scenes[next.scenes.findIndex(s=>s.id===active())]=input as Scene;root.replace(next);},
  };
 }
 prepare(input:unknown):Project{
  const p=ProjectSchema.parse(input);for(const section of this.sections())section.prepare?.(p);p.scenes=p.scenes.map(s=>migrateScene(s,this.definitions()));return parseProject(p,this.definitions(),this.sections());
 }
 replace(input:unknown,unsaved=false):void{const p=this.prepare(input);const previous=this.editingId;this.editingId=null;this.generation++;try{this.document.replace(p,unsaved);}catch(error){this.editingId=previous;this.generation--;throw error;}}
 fresh(scene=blankScene()):void{this.replace(newProject(scene));}
}
export const projectToken=token<ProjectService>('project','project.model');
export const sceneDocumentToken=token<DocumentPort<Scene>>('project','project.scene-document');
export function projectModule(definitions:()=>ReadonlyMap<string,ComponentDefinition>,sections:()=>readonly ProjectSection[]):EditorModule{
 return{manifest:{id:'project',version:'1.0.0',apiVersion:1},activate(c){const project=new ProjectService(definitions,sections);c.provide(projectToken,project);registerProjectAutomation(c,project,sections);c.provide(sceneDocumentToken,project.sceneDocument);}};
}
