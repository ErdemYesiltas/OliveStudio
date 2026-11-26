import type {Entity} from './scene.js';
/**
 * What of a built-in pixi component forces the editor to rebuild its display objects. Alpha and text content are left
 * out: both update in place, and Play rewrites templated text ({score}) on every change, which must not rebuild the
 * scene and its viewport features.
 */
export function visualKey(c:Entity['components'][number]){
 if(!c.type.startsWith('pixi.')||!c.data||typeof c.data!=='object'||Array.isArray(c.data))return c;
 const text=c.type==='pixi.text'||c.type==='pixi.bitmapText';
 return{...c,data:{...c.data,alpha:undefined,...text?{text:undefined}:{}}};
}
