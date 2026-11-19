import {createFlipbookAdapter} from '@rewrite/render-pixi/flipbook';
import type {PlayerPlugin} from '../plugin';
/** Sprite-sheet frames for the exported player; textures come from the exported image assets. */
export default {id: 'flipbook', create(c) {
 return {visuals: [createFlipbookAdapter(id => { const asset = c.assets.get(id); return asset?.type === 'pixi.texture' ? c.assets.url(asset, 'image.webp') : undefined; })], dispose() {}};
}} satisfies PlayerPlugin;
