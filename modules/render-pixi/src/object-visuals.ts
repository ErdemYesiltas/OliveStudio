import {createObjectAdapters,objectDefinitions} from './objects';
import {createTilemapAdapter,tilemapDefinition} from './tilemap';
import type {VisualFeature} from './visuals';

export const objectVisuals={
 id:'objects',
 components:[...objectDefinitions,tilemapDefinition],
 createAdapters:url=>[...createObjectAdapters(url),createTilemapAdapter(url)],
 references:data=>{
  const id=String((data as {assetId?:string}).assetId??'');
  return id?[{id,type:'pixi.texture'}]:[];
 },
} satisfies VisualFeature;
