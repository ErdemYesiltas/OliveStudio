import {NativeBuildService} from '@rewrite/build/node';
import {htmlTarget} from '@rewrite/html-export/node';
import {mobileTarget} from '@rewrite/html-export/mobile-node';
import type {NativeAssets} from './native-assets.types';
export function createNativeBuild(template:string,assets:()=>NativeAssets|null){return new NativeBuildService([htmlTarget,mobileTarget],template,async(id,revision,file)=>{const service=assets();if(!service)throw Error('Asset service unavailable');const response=await service.read(`pixi-editor-asset://${service.info().sessionId}/${id}/${revision}/${file}`);if(!response.ok)throw Error(`Asset unavailable: ${id}/${file}. Rebuild the asset cache.`);return new Uint8Array(await response.arrayBuffer());});}
