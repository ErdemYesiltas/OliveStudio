import {createObjectAdapters} from '@rewrite/render-pixi/objects';
import {createTilemapAdapter} from '@rewrite/render-pixi/tilemap';
import type {PlayerPlugin} from '../plugin';
/** Tiling, nine-slice, mesh plane, rope, particles and tilemaps for the exported player (one chunk, included only when used). */
export default {id: 'objects', create(c) {
 const url = (id: string) => { const asset = c.assets.get(id); return asset?.type === 'pixi.texture' ? c.assets.url(asset, 'image.webp') : undefined; };
 return {visuals: [...createObjectAdapters(url), createTilemapAdapter(url)], dispose() {}};
}} satisfies PlayerPlugin;
