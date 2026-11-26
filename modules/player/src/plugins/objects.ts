import {objectVisuals} from '@rewrite/render-pixi/object-visuals';
import {textureUrl} from '@rewrite/render-pixi/visuals';
import type {PlayerPlugin} from '../plugin';

export default {id:objectVisuals.id,create(c){
 const url=textureUrl(id=>c.assets.get(id),asset=>c.assets.url(asset,'image.webp'));
 return {visuals:objectVisuals.createAdapters(url),dispose(){}};
}} satisfies PlayerPlugin;
