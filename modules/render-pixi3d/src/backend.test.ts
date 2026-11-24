import {expect,it} from 'vitest';
import {select3DBackend} from './backend';
const gpu=(features:string[]|null,fail=false)=>({requestAdapter:async()=>{if(fail)throw Error('adapter lost');return features?{features:new Set(features)}:null;}});
it('keeps WebGPU only when the adapter has indirect-first-instance and never upgrades WebGL',async()=>{
 expect(await select3DBackend('webgpu',gpu(['indirect-first-instance','float32-filterable']))).toBe('webgpu');
 expect(await select3DBackend('webgpu',gpu(['float32-filterable']))).toBe('webgl');
 expect(await select3DBackend('webgpu',gpu(null))).toBe('webgl');
 expect(await select3DBackend('webgpu',gpu([],true))).toBe('webgl');
 expect(await select3DBackend('webgpu',undefined)).toBe('webgl');
 expect(await select3DBackend('webgl',gpu(['indirect-first-instance']))).toBe('webgl');
});
