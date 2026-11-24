import {expect,it} from 'vitest';
import type {UboElement} from 'pixi.js';
import {storeWgslIntegers} from './csp';
const element=(name:string,type:string,size:number,offset:number)=>({data:{name,type,size,value:new Int32Array(Math.max(size,1)*4)},offset} as unknown as UboElement);
it('stores WGSL integer UBO members as integers, not as float bit patterns',()=>{
 const data=new Float32Array(160),masks=Array.from({length:144},(_,i)=>i===5?-2147483647:i%3?1:5);
 // What the polyfill leaves behind: integers written through the Float32 view.
 data.set(masks.map(Number),4);data[150]=7;
 storeWgslIntegers([element('uTileMasks','vec4<i32>',36,16),element('uCount','i32',1,600)],{uTileMasks:masks,uCount:7},data,null,0);
 const ints=new Int32Array(data.buffer);expect(Array.from(ints.slice(4,148))).toEqual(masks);expect(ints[150]).toBe(7);
 expect(ints[4]&1).toBe(1);
});
it('honours the array stride of vec3<i32> and the group offset, and leaves float members alone',()=>{
 const data=new Float32Array(32),ints=new Int32Array(data.buffer);data[0]=1.5;
 storeWgslIntegers([element('v','vec3<i32>',2,16),element('f','f32',1,0)],{v:[1,2,3,4,5,6],f:9},data,ints,4);
 expect(Array.from(ints.slice(8,16))).toEqual([1,2,3,0,4,5,6,0]);expect(data[0]).toBe(1.5);
});
