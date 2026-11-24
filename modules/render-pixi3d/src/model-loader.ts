import {Loader,loadTextures} from 'pixi.js';
import {loadGlb,type Scene3DSource} from '@pixi/3d';
/** Embedded GLB images must work under the desktop's strict CSP without blob workers.
 * A private loader/parser copy leaves Assets and every other module's parser preferences alone.
 */
export function createModelLoader(){const loader=new Loader();loader.parsers.push(loadGlb,{...loadTextures,config:{...loadTextures.config,preferWorkers:false}});return loader;}
export function modelSourcePorts(loader=createModelLoader()){return{load:(url:string)=>loader.load<Scene3DSource>({src:url,parser:'glb'}),unload:(url:string)=>loader.unload(url)};}
