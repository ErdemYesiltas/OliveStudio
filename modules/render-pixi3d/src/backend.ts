/** @pixi/3d's batched indirect draws need 'indirect-first-instance'; without it the WebGPU renderer throws at init, so a requested WebGPU backend falls back to WebGL2. Never upgrades. */
export async function select3DBackend(requested:'webgl'|'webgpu',gpu:{requestAdapter():Promise<{features:{has(name:string):boolean}}|null>}|undefined):Promise<'webgl'|'webgpu'>{
 if(requested!=='webgpu')return requested;
 try{const adapter=await gpu?.requestAdapter();return adapter?.features.has('indirect-first-instance')?'webgpu':'webgl';}catch{return 'webgl';}
}
