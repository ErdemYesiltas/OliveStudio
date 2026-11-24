import {expect,it} from 'vitest';
import {quatFromEuler,eulerFromQuat} from '@rewrite/tween';
import {identity3D} from '@rewrite/scene3d';
import {withEuler,eulerOf} from './math';
// The tween inspector's dependency-free Euler helpers must match the 3D Inspector (gl-matrix) exactly.
it('matches the 3D Inspector Euler convention',()=>{
 for(const [x,y,z] of [[0,0,0],[10,20,30],[-45,60,120],[170,-10,-90],[0,90,0],[33,-89.9,12]]){
  const pose=withEuler(identity3D(),{x,y,z}),q=quatFromEuler(x,y,z);
  [pose.qx,pose.qy,pose.qz,pose.qw].forEach((v,i)=>expect(q[i]).toBeCloseTo(v,10));
  const a=eulerOf(pose),b=eulerFromQuat(q);expect(b.x).toBeCloseTo(a.x,7);expect(b.y).toBeCloseTo(a.y,7);expect(b.z).toBeCloseTo(a.z,7);
 }
});
