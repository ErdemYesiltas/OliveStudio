import {fontFamily} from './contracts.js';
const faces = new Map<string, Promise<string>>();
/**
 * Registers an imported font under its asset-scoped family. Bytes are fetched and handed to FontFace,
 * so pages whose CSP only allows `connect-src` for asset URLs (the editor) can still use them.
 */
export function loadFont(assetId: string, url: string): Promise<string> {
 let face = faces.get(url);
 if (!face) {
  face = (async () => {
   const response = await fetch(url);
   if (!response.ok) throw Error('Font unavailable');
   const loaded = await new FontFace(fontFamily(assetId), await response.arrayBuffer()).load();
   document.fonts.add(loaded);
   return loaded.family;
  })();
  face.catch(() => faces.delete(url));
  faces.set(url, face);
 }
 return face;
}
/** CSS font stack for a text component: the imported family first, the system font as fallback. */
export const fontStack = (assetId: string, ready: boolean) => assetId && ready ? `"${fontFamily(assetId)}", system-ui` : 'system-ui';
