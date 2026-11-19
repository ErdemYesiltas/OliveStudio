import type {ComponentDefinition,Json} from '@rewrite/sdk';
import type {AssetRecord} from './contracts';
export interface AssetReferenceScope {id:string;name:string;entities:readonly {id:string;name:string;components:readonly {id:string;type:string;version:number;data:Json}[]}[]}
export interface AssetReferenceIssue {kind:'unassigned'|'missing'|'wrong-type';scopeId:string;scopeName:string;entityId:string;entityName:string;componentId:string;componentType:string;field:string;assetId:string;expectedType:string}
/** Reads public asset fields only. Opaque/newer components are preserved and never guessed. */
export function inspectAssetReferences(scopes:readonly AssetReferenceScope[],assets:readonly AssetRecord[],definitions:ReadonlyMap<string,ComponentDefinition>):AssetReferenceIssue[]{
 const byId=new Map(assets.map(a=>[a.id,a])),issues:AssetReferenceIssue[]=[];
 for(const scope of scopes)for(const entity of scope.entities)for(const component of entity.components){const def=definitions.get(component.type);if(!def||def.version!==component.version)continue;const value=def.parse(component.data);if(!value||typeof value!=='object'||Array.isArray(value))continue;
  for(const field of def.fields){if(field.kind!=='asset')continue;const assetId=typeof value[field.key]==='string'?value[field.key] as string:'',asset=byId.get(assetId),kind=!assetId?'unassigned':!asset?'missing':field.assetType&&asset.type!==field.assetType?'wrong-type':null;if(kind)issues.push({kind,scopeId:scope.id,scopeName:scope.name,entityId:entity.id,entityName:entity.name,componentId:component.id,componentType:component.type,field:field.key,assetId,expectedType:field.assetType??''});}
 }
 return issues;
}
