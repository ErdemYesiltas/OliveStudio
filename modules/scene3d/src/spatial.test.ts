import {describe,it,expect} from 'vitest';
import type {ComponentDefinition,Json} from '@rewrite/sdk';
import {SceneService,parseScene,migrateScene,makeEntity,transform,transformDefinition,spatialComponent,spatialParents,worldPosition,project2DScene,sceneModule} from '@rewrite/scene';
import {ProjectService,parseProject} from '@rewrite/project';
import {PrefabService,prefabInstanceDefinition,prefabSection} from '@rewrite/prefabs';
import {validatePrefabs} from '../../prefabs/src/model';
import {ModuleHost} from '@rewrite/kernel';
import {components} from '@rewrite/sdk';
import {Transform3DSchema,identity3D,transform3dDefinition,viewport3dDefinition,makeViewport3D,transform3D,world3D,space3d,scene3dModule} from './index';
const defs=()=>new Map<string,ComponentDefinition>([transformDefinition,transform3dDefinition,viewport3dDefinition,prefabInstanceDefinition].map(d=>[d.type,d]));
function fixture(){const definitions=defs(),project=new ProjectService(()=>definitions,()=>[{key:prefabSection,parse:v=>v as Json,validate:p=>validatePrefabs(p,definitions)}]),scene=new SceneService(()=>definitions,project.sceneDocument),a=makeViewport3D('A',300,200),b=makeViewport3D('B',100,500);scene.document.transact('Views',s=>s.entities.push(a,b));return{definitions,project,scene,a,b,entity:(id:string)=>scene.document.current.entities.find(e=>e.id===id)!};}
const pose=(patch:Partial<ReturnType<typeof identity3D>>={})=>({...identity3D(),...patch});
function world(f:ReturnType<typeof fixture>,id:string){const e=f.entity(id);return world3D(spatialParents(f.scene.document.current,e.parentId,space3d,f.definitions),spatialComponent(e).data);}
const close=(a:ArrayLike<number>,b:ArrayLike<number>)=>{for(let i=0;i<a.length;i++)expect(a[i]).toBeCloseTo(b[i],6);};
describe('spatial document contracts',()=>{
 it('keeps a legacy 2D JSON golden round-trip byte-for-byte and preserves 2D operations',()=>{
  const e=makeEntity('Old',17,-24),raw=JSON.stringify({formatVersion:1,id:'golden',name:'Golden',entities:[e]});
  expect(JSON.stringify(parseScene(JSON.parse(raw),defs()))).toBe(raw);expect(e).not.toHaveProperty('spatial');
  const s=new SceneService(defs);s.document.replace(JSON.parse(raw));const p=s.create('Parent');s.reparent(e.id,p);s.reparent(e.id,null);expect(transform(s.document.current.entities[0]).x).toBeCloseTo(17,6);const copied=s.copy([e.id]),pasted=s.paste(copied,p).ids[0];expect(worldPosition(s.document.current.entities,pasted)).toEqual(worldPosition(s.document.current.entities,e.id));const rotated={...transform(s.document.current.entities[0]),rotation:730};s.setTransform(e.id,rotated);const rawClip=s.copy([e.id]),rootCopy=s.paste(rawClip).ids[0];expect(spatialComponent(s.document.current.entities.find(e=>e.id===rootCopy)!).data).toEqual(rawClip.entities[0].components[0].data);
 });
 it('creates, edits, duplicates, deletes and undoes 3D subtrees without a Transform2D',()=>{
  const f=fixture(),root=f.scene.createSpatial('Root','scene3d.transform',f.a.id,pose({x:1,z:3})),child=f.scene.createSpatial('Child','scene3d.transform',root,pose({y:2}));
  expect(f.entity(root).components.map(c=>c.type)).toEqual(['scene3d.transform']);expect(()=>transform(f.entity(root))).toThrow('Transform2D');
  f.scene.setSpatial(child,pose({y:4}));f.scene.document.undo();expect(transform3D(f.entity(child)).y).toBe(2);f.scene.document.redo();expect(transform3D(f.entity(child)).y).toBe(4);
  const copy=f.scene.duplicate(root),children=f.scene.document.current.entities.filter(e=>e.parentId===copy);expect(children).toHaveLength(1);expect(f.entity(copy).spatial).toBe('scene3d.transform');expect(children[0].id).not.toBe(child);
  f.scene.remove(copy);expect(f.scene.document.current.entities.some(e=>e.id===children[0].id)).toBe(false);f.scene.document.undo();expect(f.entity(copy)).toBeDefined();
  expect(()=>f.scene.removeComponent(root,'scene3d.transform')).toThrow('required');
 });
 it('preserves full 3D world poses within one view, excluding the viewport pixel transform',()=>{
  const f=fixture(),q=Math.SQRT1_2,p=f.scene.createSpatial('Parent','scene3d.transform',f.a.id,pose({x:3,y:4,qz:q,qw:q,scaleX:-2,scaleY:2,scaleZ:2})),c=f.scene.createSpatial('Child','scene3d.transform',f.a.id,pose({x:1,z:2}));
  const before=world(f,c);f.scene.reparent(c,p);close(world(f,c),before);f.scene.document.undo();close(world(f,c),before);f.scene.document.redo();close(world(f,c),before);
  f.scene.reparent(c,f.a.id);close(world(f,c),before);expect(transform3D(f.entity(c)).x).toBeCloseTo(1,6);
  expect(worldPosition(f.scene.document.current.entities,c)).toBeUndefined();
 });
 it('rejects cross-view, mixed-space, missing-view, cycle and dual-transform edits atomically',()=>{
  const f=fixture(),id=f.scene.createSpatial('Mesh','scene3d.transform',f.a.id),child=f.scene.createSpatial('Child','scene3d.transform',id),before=JSON.stringify(f.scene.document.current),version=f.scene.document.version;
  for(const action of [()=>f.scene.reparent(id,f.b.id),()=>f.scene.reparent(id,null),()=>f.scene.reparent(id,child),()=>f.scene.reparent(f.a.id,id),()=>f.scene.addComponent(id,'scene.transform2d')]){
   expect(action).toThrow();expect(JSON.stringify(f.scene.document.current)).toBe(before);expect(f.scene.document.version).toBe(version);
  }
  expect(()=>f.scene.createSpatial('No view','scene3d.transform',null)).toThrow('boundary');
 });
 it('rejects non-representable shear rather than silently changing world pose',()=>{
  const f=fixture(),q=Math.sin(Math.PI/8),w=Math.cos(Math.PI/8),p=f.scene.createSpatial('Scale','scene3d.transform',f.a.id,pose({scaleX:2})),id=f.scene.createSpatial('Rotate','scene3d.transform',f.a.id,pose({qz:q,qw:w})),before=JSON.stringify(f.scene.document.current);
  expect(()=>f.scene.reparent(id,p)).toThrow('shear');expect(JSON.stringify(f.scene.document.current)).toBe(before);
 });
 it('validates quaternion, finite coordinates, scale and supported component spaces',()=>{
  for(const bad of [pose({qw:0}),pose({qx:1}),pose({x:Infinity}),pose({scaleX:0})])expect(()=>Transform3DSchema.parse(bad)).toThrow();
  const f=fixture(),id=f.scene.createSpatial('Mesh','scene3d.transform',f.a.id);const two:ComponentDefinition={type:'test.2d',version:1,titleKey:'x',fields:[],defaults:()=>({}),parse:v=>v as Json,supportedSpaces:['scene.2d']};f.definitions.set(two.type,two);expect(()=>f.scene.addComponent(id,two.type)).toThrow('does not support');
 });
 it('retains unknown/future spatial payloads losslessly; migration failure cannot mutate the source',()=>{
  const f=fixture(),id=f.scene.createSpatial('Mesh','scene3d.transform',f.a.id),input=structuredClone(f.scene.document.current);spatialComponent(input.entities.find(e=>e.id===id)!).version=8;spatialComponent(input.entities.find(e=>e.id===id)!).data={future:[1,2,3]};
  expect(parseScene(input,f.definitions)).toEqual(input);const missing=new Map([[transformDefinition.type,transformDefinition]]);expect(parseScene(input,missing)).toEqual(input);
  const service=new SceneService(()=>missing);service.document.replace(input);expect(service.diagnostics.some(d=>d.includes('scene3d.transform'))).toBe(true);expect(()=>service.reparent(id,f.a.id)).toThrow('provider unavailable');expect(service.document.current).toEqual(input);
  const original=structuredClone(f.scene.document.current),before=structuredClone(original);f.definitions.set('scene3d.transform',{...transform3dDefinition,version:2,migrate:()=>{throw Error('bad migration');}});expect(()=>migrateScene(original,f.definitions)).toThrow('bad migration');expect(original).toEqual(before);
 });
 it('copies in boundary-local space and pastes only into an explicit compatible parent',()=>{
  const f=fixture(),parent=f.scene.createSpatial('Parent','scene3d.transform',f.a.id,pose({x:5})),id=f.scene.createSpatial('Mesh','scene3d.transform',parent,pose({x:2})),clip=f.scene.copy([id]);
  expect(clip.entities[0].parentId).toBeNull();expect(transform3D(clip.entities[0]).x).toBe(7);expect(()=>f.scene.paste(clip)).toThrow('boundary');
  const pasted=f.scene.paste(clip,parent).ids[0];expect(f.entity(pasted).parentId).toBe(parent);close(world(f,pasted),world(f,id));f.scene.document.undo();expect(f.entity(pasted)).toBeUndefined();
 });
 it('projects only real 2D nodes and never invents XY poses for missing 3D modules',()=>{
  const f=fixture();f.scene.createSpatial('Mesh','scene3d.transform',f.a.id);const projected=project2DScene(f.scene.document.current);expect(projected.entities.map(e=>e.id)).toEqual([f.a.id,f.b.id]);expect(f.scene.document.current.entities).toHaveLength(3);
 });
 it('round-trips through project save/open with provider present and absent',()=>{
  const f=fixture();f.scene.createSpatial('Mesh','scene3d.transform',f.a.id,pose({z:12}));const raw=JSON.stringify(f.project.document.current);expect(JSON.stringify(parseProject(JSON.parse(raw),f.definitions))).toBe(raw);expect(JSON.stringify(parseProject(JSON.parse(raw),new Map([[transformDefinition.type,transformDefinition]])))).toBe(raw);
 });
 it('uses the same public contract for a third-party coordinate space',()=>{
  const f=fixture(),scalar:ComponentDefinition={type:'example.distance',version:1,titleKey:'distance',fields:[],defaults:()=>({distance:0}),parse:v=>v as Json,spatial:{space:'example.line',resetPosition:()=>({distance:0}),reparent(local,oldParents,newParents){const sum=(all:readonly Json[])=>all.reduce<number>((n,v)=>n+(v as {distance:number}).distance,0);return{distance:(local as {distance:number}).distance+sum(oldParents)-sum(newParents)};}}};
  f.definitions.set(scalar.type,scalar);const p=f.scene.createSpatial('Line parent',scalar.type,null,{distance:5}),c=f.scene.createSpatial('Line child',scalar.type,null,{distance:9});f.scene.reparent(c,p);expect(spatialComponent(f.entity(c)).data).toEqual({distance:4});
 });
 it('commits batch hierarchy changes as one undo and rolls back the whole batch on failure',()=>{
  const f=fixture(),p=f.scene.createSpatial('Parent','scene3d.transform',f.a.id,pose({x:5})),a=f.scene.createSpatial('A','scene3d.transform',f.a.id,pose({x:1})),b=f.scene.createSpatial('B','scene3d.transform',f.a.id,pose({x:2})),aWorld=world(f,a),bWorld=world(f,b),version=f.scene.document.version;
  f.scene.place([a,b],p,null);expect(f.scene.document.version).toBe(version+1);close(world(f,a),aWorld);close(world(f,b),bWorld);f.scene.document.undo();expect(f.entity(a).parentId).toBe(f.a.id);expect(f.entity(b).parentId).toBe(f.a.id);
  const other=f.scene.createSpatial('Other','scene3d.transform',f.b.id),before=JSON.stringify(f.scene.document.current);expect(()=>f.scene.place([a,other],p,null)).toThrow('between spatial views');expect(JSON.stringify(f.scene.document.current)).toBe(before);
 });
 it('migrates old spatial payloads on a copy without adding a 2D transform',()=>{
  const f=fixture(),id=f.scene.createSpatial('Mesh','scene3d.transform',f.a.id),input=structuredClone(f.scene.document.current);spatialComponent(input.entities.find(e=>e.id===id)!).data={position:[1,2,3]};const before=structuredClone(input);
  f.definitions.set('scene3d.transform',{...transform3dDefinition,version:2,migrate:v=>{const [x,y,z]=(v as {position:number[]}).position;return pose({x,y,z});}});
  const migrated=migrateScene(input,f.definitions),e=migrated.entities.find(e=>e.id===id)!;expect(spatialComponent(e).version).toBe(2);expect(transform3D(e)).toMatchObject({x:1,y:2,z:3});expect(e.components.some(c=>c.type==='scene.transform2d')).toBe(false);expect(input).toEqual(before);
 });
 it('activates as an optional schema feature, without importing Pixi into scene/kernel',async()=>{
  const host=new ModuleHost();try{await host.start([sceneModule(defs),scene3dModule]);expect(host.diagnostics).toEqual([]);expect(host.entries(components).some(e=>e.value.type==='scene3d.transform')).toBe(true);}finally{await host.stop();}
 });
});
describe('3D prefabs',()=>{
 it('edits detached 3D prefabs in a temporary boundary and never saves the wrapper',()=>{
  const f=fixture(),original=f.project.activeSceneId,root=f.scene.createSpatial('Root','scene3d.transform',f.a.id,pose({x:5})),child=f.scene.createSpatial('Child','scene3d.transform',root,pose({z:1})),service=new PrefabService(f.project,f.scene),prefabId=service.create(root),prefab=service.items.find(p=>p.id===prefabId)!;
  service.openForEditing(prefabId);const edit=service.editing!;expect(edit.boundaryId).toBeTruthy();const editableRoot=f.scene.document.current.entities.find(e=>e.id===prefab.rootId)!;expect(editableRoot.parentId).toBe(edit.boundaryId);expect(editableRoot.components.some(c=>c.type==='scene.transform2d')).toBe(false);
  const editableChild=f.scene.document.current.entities.find(e=>e.parentId===prefab.rootId)!;f.scene.setSpatial(editableChild.id,pose({z:7}));service.saveEditing();expect(f.project.activeSceneId).toBe(original);expect(service.editing).toBeNull();const saved=service.items.find(p=>p.id===prefabId)!;expect(saved.entities.some(e=>e.id===edit.boundaryId)).toBe(false);expect(saved.entities.find(e=>e.id===saved.rootId)!.parentId).toBeNull();expect(transform3D(f.entity(child)).z).toBe(7);
  service.openForEditing(prefabId);const temporary=service.editing!.sceneId;service.cancelEditing();expect(f.project.document.current.scenes.some(s=>s.id===temporary)).toBe(false);validatePrefabs(f.project.document.current,f.definitions);
 });

 it('creates detached prefab data and instances under a view, then applies/reverts child overrides with undo',()=>{
  const f=fixture(),root=f.scene.createSpatial('Root','scene3d.transform',f.a.id,pose({x:5})),child=f.scene.createSpatial('Child','scene3d.transform',root,pose({z:1})),service=new PrefabService(f.project,f.scene),prefabId=service.create(root);
  expect(service.items[0].entities.find(e=>e.id===service.items[0].rootId)!.spatial).toBe('scene3d.transform');expect(()=>service.instantiate(prefabId)).toThrow('instantiateSpatial');
  const a=service.instantiateSpatial(prefabId,f.a.id,pose({x:10})),b=service.instantiateSpatial(prefabId,f.a.id,pose({x:20}));
  const ca=f.scene.document.current.entities.find(e=>e.parentId===a)!,cb=f.scene.document.current.entities.find(e=>e.parentId===b)!;
  f.scene.setSpatial(ca.id,pose({z:9}));expect(service.overrides(a)).toHaveLength(1);service.apply(a);expect(transform3D(f.entity(cb.id)).z).toBe(9);expect(transform3D(f.entity(a)).x).toBe(10);expect(transform3D(f.entity(b)).x).toBe(20);
  f.project.document.undo();expect(transform3D(f.entity(cb.id)).z).toBe(1);expect(service.overrides(a)).toHaveLength(1);service.revert(a);expect(transform3D(f.entity(ca.id)).z).toBe(1);expect(transform3D(f.entity(child)).z).toBe(1);
 });
 it('duplicates complete viewport prefabs without cross-linking 3D child IDs',()=>{
  const f=fixture(),id=f.scene.createSpatial('Mesh','scene3d.transform',f.a.id),service=new PrefabService(f.project,f.scene),prefab=service.create(f.a.id),instance=service.instantiate(prefab),copy=f.scene.document.current.entities.find(e=>e.parentId===instance)!;
  expect(copy.spatial).toBe('scene3d.transform');expect(copy.id).not.toBe(id);validatePrefabs(f.project.document.current,f.definitions);
 });
});
