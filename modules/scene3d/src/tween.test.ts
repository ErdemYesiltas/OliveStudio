import {expect,it} from 'vitest';
import {TweenSession,compileTweens,quatFromEuler,eulerFromQuat} from '@rewrite/tween';
import type {TweenProvider} from '@rewrite/tween/contracts';
import {makeEntity,type Entity} from '@rewrite/scene';
import {identity3D,transform3D,transform3dTweenChannels,transform3dType} from './index';
// Linear test provider; the real GSAP/Pixi providers are covered in their own modules.
const linear:TweenProvider={id:'linear',create:spec=>({sample:time=>{const t=Math.min(1,Math.max(0,(time-spec.delay)/spec.duration));return Object.fromEntries(spec.tracks.map(k=>[k.id,k.from+(k.to-k.from)*t]));},dispose(){}})};
const spatial=(name:string):Entity=>{const e=makeEntity(name,0,0);e.components=[{id:name+'-t3',type:transform3dType,version:1,data:identity3D()}];e.spatial=transform3dType;return e;};
const player=(owner:Entity,target:Entity,tracks:{id:string;property:string;from:number|number[];to:number|number[]}[]):Entity=>{owner.components.push({id:owner.id+'-tween',type:'tween.player',version:1,data:{duration:1,delay:0,ease:'linear',repeat:0,yoyo:false,autoplay:true,tracks:tracks.map(t=>({...t,entityId:target.id,componentId:target.components[0].id}))}});return owner;};
it('tweens Transform3D position and scale through the shared tween runtime, never writing zero scale',()=>{
 const cube=spatial('cube');player(cube,cube,[{id:'z',property:'z',from:0,to:4},{id:'s',property:'scaleY',from:1,to:-1}]);const entities=[cube];
 const session=new TweenSession(()=>entities,transform3dTweenChannels,linear);session.start();expect(session.errors).toEqual([]);
 session.system.update!(.5);let pose=transform3D(cube);expect(pose.z).toBeCloseTo(2);expect(pose.scaleY).toBe(1e-4);expect([pose.qx,pose.qy,pose.qz,pose.qw]).toEqual([0,0,0,1]);
 session.system.update!(.5);pose=transform3D(cube);expect(pose.z).toBe(4);expect(pose.scaleY).toBe(-1);
});
it('tweens Transform3D rotation by slerp, writing a normalized quaternion every frame',()=>{
 const cube=spatial('cube');player(cube,cube,[{id:'r',property:'rotation',from:quatFromEuler(0,0,0),to:quatFromEuler(0,180,0)}]);const entities=[cube];
 const session=new TweenSession(()=>entities,transform3dTweenChannels,linear);session.start();expect(session.errors).toEqual([]);
 session.system.update!(.25);let p=transform3D(cube);expect(eulerFromQuat([p.qx,p.qy,p.qz,p.qw]).y).toBeCloseTo(45,6);expect(Math.hypot(p.qx,p.qy,p.qz,p.qw)).toBeCloseTo(1,12);
 session.system.update!(.25);p=transform3D(cube);expect(eulerFromQuat([p.qx,p.qy,p.qz,p.qw]).y).toBeCloseTo(90,4);expect([p.x,p.y,p.z,p.scaleX]).toEqual([0,0,0,1]);
});
it('rejects mixed kinds: scalar values on rotation, quaternions on scalar axes, per-component quaternion tracks',()=>{
 const a=spatial('a');player(a,a,[{id:'s',property:'rotation',from:0,to:1}]);expect(compileTweens([a],transform3dTweenChannels).errors.join()).toMatch(/Rotation track needs quaternion values: s/);
 const b=spatial('b');player(b,b,[{id:'q',property:'x',from:[0,0,0,1],to:[0,0,0,1]}]);expect(compileTweens([b],transform3dTweenChannels).errors.join()).toMatch(/Quaternion values need a rotation channel: q/);
});
it('rejects quaternion tracks and a second writer of the same Transform3D axis',()=>{
 const cube=spatial('cube');player(cube,cube,[{id:'q',property:'qx',from:0,to:1}]);
 expect(compileTweens([cube],transform3dTweenChannels).errors.join()).toMatch(/Missing target\/channel: q/);
 const target=spatial('target'),a=player(spatial('a'),target,[{id:'x',property:'x',from:0,to:1}]),b=player(spatial('b'),target,[{id:'x',property:'x',from:1,to:2}]);
 const compiled=compileTweens([target,a,b],transform3dTweenChannels);expect(compiled.plans).toHaveLength(1);expect(compiled.errors.join()).toContain(`b: Error: Channel already owned by ${a.id}-tween: x`);
});
