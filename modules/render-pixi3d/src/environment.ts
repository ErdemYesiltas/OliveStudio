import {Loader,type CubeTexture} from 'pixi.js';
import {loadHdr} from '@pixi/3d';
export * from './environment-contracts';
/** A private loader: the HDR parser converts the panorama to a float cube on the main thread (no workers, no CSP change). */
export function environmentSourcePorts(loader=(()=>{const l=new Loader();l.parsers.push(loadHdr);return l;})()){return{load:(url:string)=>loader.load<CubeTexture>(url),unload:(url:string)=>loader.unload(url)};}
