import type {ComponentDefinition,Json,SpatialDefinition} from '@rewrite/sdk';
import type {Entity,Scene} from './index';
export type Definitions=ReadonlyMap<string,ComponentDefinition>;
export const transform2dType='scene.transform2d',space2d='scene.2d';
/** Omitted in legacy 2D JSON. Explicit type preserves unsupported spatial data without inventing a 2D transform. */
export function spatialType(entity:Entity):string{return entity.spatial??transform2dType;}
export function is2DEntity(entity:Entity):boolean{return spatialType(entity)===transform2dType;}
export function spatialComponent(entity:Entity){const c=entity.components.find(c=>c.type===spatialType(entity));if(!c)throw Error(`${entity.name}: spatial component ${spatialType(entity)} missing`);return c;}
export function spatialDefinition(entity:Entity,definitions:Definitions):SpatialDefinition{const c=spatialComponent(entity),def=definitions.get(c.type);if(!def?.spatial||def.version!==c.version)throw Error(`${entity.name}: spatial provider unavailable for ${c.type} v${c.version}`);return def.spatial;}
function space(entity:Entity,defs:Definitions){const c=spatialComponent(entity),def=defs.get(c.type);return def?.version===c.version?def.spatial?.space:is2DEntity(entity)?space2d:undefined;}
function boundary(entity:Entity,defs:Definitions){const all=entity.components.flatMap(c=>{const d=defs.get(c.type);return d?.version===c.version&&d.spatialBoundary?[d.spatialBoundary]:[];});if(all.length>1)throw Error('Only one spatial boundary per entity');return all[0];}
/** Root-level spatial nodes are accepted only in explicitly detached prefab/clipboard validation. */
export function validateSpatial(scene:Scene,defs:Definitions,allowDetachedRoots=false){
 const byId=new Map(scene.entities.map(e=>[e.id,e]));
 for(const e of scene.entities){
  const own=spatialType(e);spatialComponent(e);
  if(e.components.some(c=>c.type!==own&&(c.type===transform2dType||Boolean(defs.get(c.type)?.spatial))))throw Error(`${e.name}: only one spatial transform is allowed`);
  const type=space(e,defs),def=defs.get(own),b=boundary(e,defs);
  if(def&&!def.spatial)throw Error(`${own} is not a spatial definition`);
  if(b&&type&&b.hostSpace!==type)throw Error(`${e.name}: spatial boundary needs ${b.hostSpace}`);
  if(!type)continue; // Unknown/future spatial provider: keep JSON, report through SceneService diagnostics.
  for(const c of e.components){const d=defs.get(c.type);if(d?.version===c.version&&d.supportedSpaces&&!d.supportedSpaces.includes(type))throw Error(`${c.type} does not support spatial space ${type}`);}
  if(!e.parentId){if(def?.spatial?.requiresBoundary&&!allowDetachedRoots)throw Error(`${e.name}: spatial space ${type} requires a view boundary`);continue;}
  const parent=byId.get(e.parentId)!;if(!parent)continue; // Generic hierarchy validation reports missing parents first.
  const parentSpace=space(parent,defs),opens=boundary(parent,defs);
  if(parentSpace&&(opens?.childSpace??parentSpace)!==type)throw Error(`${e.name}: incompatible parent spatial space`);
  if(def?.spatial?.requiresBoundary&&!spatialBoundaryId(scene,e.id,defs)&&!allowDetachedRoots)throw Error(`${e.name}: spatial space ${type} requires a view boundary`);
 }
}
export function spatialBoundaryId(scene:Scene,id:string,defs:Definitions):string|null{
 const byId=new Map(scene.entities.map(e=>[e.id,e])),e=byId.get(id);if(!e)throw Error('Entity missing');const own=space(e,defs);let parent=e.parentId;
 const seen=new Set<string>();while(parent){if(seen.has(parent))throw Error('Hierarchy cycle');seen.add(parent);const node=byId.get(parent);if(!node)throw Error('Parent missing');if(boundary(node,defs)?.childSpace===own)return node.id;parent=node.parentId;}return null;
}
export function spatialParents(scene:Scene,parentId:string|null,ownSpace:string,defs:Definitions):Json[]{
 const byId=new Map(scene.entities.map(e=>[e.id,e])),chain:Json[]=[],seen=new Set<string>();
 while(parentId){if(seen.has(parentId))throw Error('Hierarchy cycle');seen.add(parentId);const parent=byId.get(parentId);if(!parent)throw Error('Parent missing');if(boundary(parent,defs)?.childSpace===ownSpace)break;if(space(parent,defs)!==ownSpace)throw Error('Incompatible parent spatial space');const c=spatialComponent(parent);spatialDefinition(parent,defs);chain.unshift(c.data);parentId=parent.parentId;}
 return chain;
}
/** A 2D renderer must omit unsupported spatial subtrees rather than creating fake XY poses. */
export function project2DScene(scene:Scene):Scene{
 const byId=new Map(scene.entities.map(e=>[e.id,e]));const supported=(entity:Entity)=>{const seen=new Set<string>();for(let e:Entity|undefined=entity;e;e=e.parentId?byId.get(e.parentId):undefined){if(seen.has(e.id)||!is2DEntity(e))return false;seen.add(e.id);}return true;};
 return scene.entities.every(is2DEntity)?scene:{...scene,entities:scene.entities.filter(supported)};
}
