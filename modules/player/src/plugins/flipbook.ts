import {flipbookVisuals} from '@rewrite/render-pixi/flipbook';
import {textureUrl} from '@rewrite/render-pixi/visuals';
import type {PlayerPlugin} from '../plugin';

export default {id:flipbookVisuals.id,create(c){
 const url=textureUrl(id=>c.assets.get(id),asset=>c.assets.url(asset,'image.webp'));
 return {visuals:flipbookVisuals.createAdapters(url),dispose(){}};
}} satisfies PlayerPlugin;
