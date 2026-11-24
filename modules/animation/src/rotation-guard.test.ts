import {expect,it} from 'vitest';
import {makeEntity} from '@rewrite/scene';
import type {TweenChannel} from '@rewrite/tween';
import {resolveChannel} from './timeline';
const rotation:TweenChannel={componentType:'scene3d.transform',version:1,property:'rotation',titleKey:'rotation',quaternion:['qx','qy','qz','qw']};
const x:TweenChannel={componentType:'scene3d.transform',version:1,property:'x',titleKey:'x'};
it('keeps quaternion components and rotation channels out of scalar animation keys',()=>{
 const e=makeEntity('cube',0,0);e.components=[{id:'t',type:'scene3d.transform',version:1,data:{x:0,y:0,z:0,qx:0,qy:0,qz:0,qw:1,scaleX:1,scaleY:1,scaleZ:1}}];
 for(const property of ['qx','qw','rotation'])expect(()=>resolveChannel([rotation,x],e,'t',property)).toThrow(/rotation/);
 expect(resolveChannel([rotation,x],e,'t','x').kind).toBe('number');
});
