import {slot,type ComponentDefinition,type Json} from '@rewrite/sdk';
import type {AssetRecord} from '@rewrite/assets';
import type {SceneDecorator,VisualAdapter} from '@olivestudio/engine/visuals';
export * from '@olivestudio/engine/visuals';
export const visualAdapters=slot<VisualAdapter>('pixi.visuals');
export type TextureUrl=(id:string)=>string|undefined;
export interface VisualFeature{
 id:string;
 components:readonly ComponentDefinition[];
 createAdapters(url:TextureUrl):readonly VisualAdapter[];
 references(data:Json):readonly {id:string;type:'pixi.texture'}[];
}
export function textureUrl(get:(id:string)=>AssetRecord|undefined,url:(asset:AssetRecord)=>string):TextureUrl{
 return id=>{const asset=get(id);return asset?.type==='pixi.texture'?url(asset):undefined;};
}
export const sceneDecorators=slot<SceneDecorator>('pixi.decorators');
