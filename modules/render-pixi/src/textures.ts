import {Texture, TextureSource} from 'pixi.js';

/** Reference-counted image textures keyed by URL, shared by every texture-backed visual adapter. */
const sheets = new Map<string, {refs: number; ready: Promise<{texture: Texture; bitmap: ImageBitmap}>}>();
export function acquireTexture(url: string) {
 let entry = sheets.get(url);
 if (!entry) {
  entry = {refs: 0, ready: (async () => {
   const response = await fetch(url);
   if (!response.ok) throw Error('Image unavailable');
   const bitmap = await createImageBitmap(await response.blob());
   return {texture: Texture.from(bitmap), bitmap};
  })()};
  entry.ready.catch(() => sheets.delete(url));
  sheets.set(url, entry);
 }
 entry.refs++;
 return entry.ready;
}
/** Pixel art: nearest-neighbour filtering for new and already loaded shared textures. */
export function setTextureFiltering(mode: 'linear' | 'nearest') {
 TextureSource.defaultOptions.scaleMode = mode;
 for (const entry of sheets.values()) void entry.ready.then(({texture}) => { texture.source.scaleMode = mode; }, () => {});
}
export function releaseTexture(url: string) {
 const entry = sheets.get(url);
 if (!entry || --entry.refs > 0) return;
 sheets.delete(url);
 void entry.ready.then(({texture, bitmap}) => { texture.destroy(true); bitmap.close(); }, () => {});
}

