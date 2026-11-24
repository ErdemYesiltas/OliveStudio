import type {Entity} from '@rewrite/scene';
/**
 * What of a built-in pixi component forces the editor to rebuild its display objects. Alpha and text content are left
 * out: both update in place, and Play rewrites templated text ({score}) on every change, which must not rebuild the
 * scene (and every 3D view in it).
 */
export function visualKey(c:Entity['components'][number]){
 if(!c.type.startsWith('pixi.')||!c.data||typeof c.data!=='object'||Array.isArray(c.data))return c;
 const text=c.type==='pixi.text'||c.type==='pixi.bitmapText';
 return{...c,data:{...c.data,alpha:undefined,...text?{text:undefined}:{}}};
}
