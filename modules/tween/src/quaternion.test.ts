import {expect,it} from 'vitest';
import {slerp,quatFromEuler,eulerFromQuat} from './quaternion';
import {TweenSchema} from './contracts';
import {tweenSpec} from './index';
const close=(a:readonly number[],b:readonly number[],e=1e-9)=>a.forEach((v,i)=>expect(v).toBeCloseTo(b[i],-Math.log10(e)));
it('slerps along the shortest arc with constant angular speed and unit length',()=>{
 const a=quatFromEuler(0,0,0),b=quatFromEuler(0,90,0);close(slerp(a,b,.5),quatFromEuler(0,45,0));close(slerp(a,b,0),a);close(slerp(a,b,1),b);
 const neg=b.map(v=>-v) as [number,number,number,number];close(slerp(a,neg,.5),quatFromEuler(0,45,0));
 for(const t of [0,.1,.33,.9,1])expect(Math.hypot(...slerp(a,quatFromEuler(10,170,-30),t))).toBeCloseTo(1,12);
 close(slerp(a,quatFromEuler(0,.01,0),.5),quatFromEuler(0,.005,0),1e-7);
});
it('round-trips XYZ Euler degrees away from gimbal lock',()=>{
 for(const [x,y,z] of [[10,20,30],[-45,60,120],[170,-10,-90]]){const e=eulerFromQuat(quatFromEuler(x,y,z));close([e.x,e.y,e.z],[x,y,z],1e-7);}
});
it('accepts unit quaternion tracks beside scalar ones and gives providers only scalars',()=>{
 const base={duration:1,delay:0,ease:'linear',repeat:0,yoyo:false,autoplay:true};
 const data=TweenSchema.parse({...base,tracks:[{id:'r',entityId:'e',componentId:'c',property:'rotation',from:[0,0,0,1],to:quatFromEuler(0,90,0)},{id:'x',entityId:'e',componentId:'c',property:'x',from:0,to:2}]});
 expect(tweenSpec(data).tracks).toEqual([{id:'r',from:0,to:1},{id:'x',from:0,to:2}]);
 expect(()=>TweenSchema.parse({...base,tracks:[{id:'r',entityId:'e',componentId:'c',property:'rotation',from:[0,0,0,2],to:[0,0,0,1]}]})).toThrow(/unit quaternion/);
 expect(()=>TweenSchema.parse({...base,tracks:[{id:'r',entityId:'e',componentId:'c',property:'rotation',from:[0,0,1],to:[0,0,0,1]}]})).toThrow();
});
