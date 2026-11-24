import {expect,it} from 'vitest';
import {Light3DSchema} from './contracts';
import {lightGizmo,gizmoReach,pickLightIcon,lightIconRadius,cameraGizmo,cameraGizmoReach,lightHandles,dragHandle,handleReach,minHandleReach,minDragRange,type Point3} from './light-gizmos';
import {EditorPickSchema} from './editor-camera';
const light=(over:object)=>Light3DSchema.parse({kind:'directional',color:'#ffffff',intensity:1,...over});
const identity=(p:Point3)=>p,moved=(p:Point3)=>({x:p.x+5,y:p.y+1,z:p.z});
const length=([a,b]:[Point3,Point3])=>Math.hypot(b.x-a.x,b.y-a.y,b.z-a.z);
it('draws nothing for ambient lights and only an icon for unselected ones',()=>{
 expect(lightGizmo(light({kind:'ambient'}),identity,true)).toBeUndefined();
 expect(lightGizmo(light({kind:'spot'}),moved,false)).toEqual({origin:{x:5,y:1,z:0},segments:[]});
});
it('points a directional arrow along local -Z with a four-line head',()=>{
 const g=lightGizmo(light({}),identity,true)!;expect(g.segments).toHaveLength(5);expect(g.segments[0][1]).toEqual({x:0,y:0,z:-gizmoReach});
 const turned=lightGizmo(light({}),p=>({x:-p.z,y:p.y,z:p.x}),true)!;expect(turned.segments[0][1]).toEqual({x:gizmoReach,y:0,z:0});
});
it('rings a point light at its range in three planes, and skips an unlimited one',()=>{
 const g=lightGizmo(light({kind:'point',range:3}),moved,true)!;expect(g.segments).toHaveLength(96);
 for(const [a] of g.segments)expect(Math.hypot(a.x-5,a.y-1,a.z)).toBeCloseTo(3,6);
 expect(lightGizmo(light({kind:'point',range:0}),identity,true)!.segments).toHaveLength(0);
});
it('outlines a spot cone to its range, with an inner ring for the soft edge',()=>{
 const g=lightGizmo(light({kind:'spot',range:4,coneAngle:30,penumbra:.5}),identity,true)!,radius=4*Math.tan(Math.PI/6);
 expect(g.segments).toHaveLength(4+32+24);for(const edge of g.segments.slice(0,4)){expect(edge[0]).toEqual({x:0,y:0,z:0});expect(edge[1].z).toBeCloseTo(-4,6);expect(Math.hypot(edge[1].x,edge[1].y)).toBeCloseTo(radius,6);}
 const inner=g.segments.slice(36),innerRadius=4*Math.tan(Math.PI/12);for(const [a] of inner)expect(Math.hypot(a.x,a.y)).toBeCloseTo(innerRadius,6);
 expect(lightGizmo(light({kind:'spot',range:0,coneAngle:30,penumbra:0}),identity,true)!.segments).toHaveLength(36);
 expect(lightGizmo(light({kind:'spot',range:0,coneAngle:30,penumbra:0}),identity,true)!.segments[0][1].z).toBeCloseTo(-gizmoReach,6);
 expect(length(g.segments[4])).toBeCloseTo(2*radius*Math.sin(Math.PI/32),6);
});
it('picks the nearest light icon within the click radius, and nothing beyond it',()=>{
 const icons=[{id:'sun',x:100,y:100},{id:'lamp',x:110,y:100},{id:'far',x:300,y:300}];
 expect(pickLightIcon({x:104,y:100},icons)).toBe('sun');expect(pickLightIcon({x:106,y:101},icons)).toBe('lamp');
 expect(pickLightIcon({x:100,y:100+lightIconRadius+1},icons)).toBeUndefined();expect(pickLightIcon({x:0,y:0},[])).toBeUndefined();
 expect(pickLightIcon({x:100,y:105},[{id:'a',x:100,y:100},{id:'b',x:100,y:100}])).toBe('b');
 expect(EditorPickSchema.parse({viewId:'v',x:1,y:2})).toEqual({viewId:'v',x:1,y:2,select:false});expect(()=>EditorPickSchema.parse({viewId:'v',x:1})).toThrow();
});
it('outlines a camera frustum from near to its reach, with an up marker, for both projections',()=>{
 const perspective={mode:'perspective' as const,fov:60,near:.5,far:1000,orthographicSize:5};
 expect(cameraGizmo(perspective,16/9,identity,false)).toEqual({origin:{x:0,y:0,z:0},segments:[]});
 const g=cameraGizmo(perspective,2,identity,true);expect(g.segments).toHaveLength(14);
 const corners=g.segments.filter((_,i)=>i<12&&i%3===1).map(([a])=>a);for(const c of corners){expect(c.z).toBeCloseTo(-cameraGizmoReach,6);expect(Math.abs(c.y)).toBeCloseTo(cameraGizmoReach*Math.tan(Math.PI/6),6);expect(Math.abs(c.x)).toBeCloseTo(2*cameraGizmoReach*Math.tan(Math.PI/6),6);}
 const nearCorners=g.segments.filter((_,i)=>i<12&&i%3===0).map(([a])=>a);for(const c of nearCorners)expect(c.z).toBeCloseTo(-.5,6);
 expect(g.segments[12][1].y).toBeGreaterThan(cameraGizmoReach*Math.tan(Math.PI/6));
 const short=cameraGizmo({...perspective,far:1.5},1,identity,true);expect(short.segments[1][0].z).toBeCloseTo(-1.5,6);
 const ortho=cameraGizmo({...perspective,mode:'orthographic',orthographicSize:4},2,moved,true);
 for(const [a] of ortho.segments.slice(0,12)){expect(Math.abs(a.x-5)).toBeCloseTo(4,6);expect(Math.abs(a.y-1)).toBeCloseTo(2,6);}
});
it('places range and cone handles and turns a drag into new values',()=>{
 expect(lightHandles(light({kind:'point',range:4}),moved)).toEqual([{key:'range',point:{x:9,y:1,z:0},anchor:{x:5,y:1,z:0}}]);
 expect(lightHandles(light({kind:'point',range:0}),identity)).toEqual([]);expect(lightHandles(light({}),identity)).toEqual([]);
 const spot=lightHandles(light({kind:'spot',range:6,coneAngle:45}),identity);expect(spot.map(h=>h.key)).toEqual(['range','coneAngle']);
 expect(spot[0].point).toEqual({x:0,y:0,z:-6});expect(spot[1].anchor).toEqual({x:0,y:0,z:-6});expect(spot[1].point.x).toBeCloseTo(6,6);
 expect(lightHandles(light({kind:'spot',range:0,coneAngle:30}),identity)[0].point.z).toBe(-gizmoReach);
 const o={x:100,y:100},h={x:200,y:100};
 expect(dragHandle('range',{value:4,length:4},o,h,{x:250,y:130})).toBeCloseTo(6,6);expect(dragHandle('range',{value:4,length:4},o,h,{x:50,y:100})).toBe(minDragRange);
 expect(dragHandle('range',{value:0,length:gizmoReach},o,h,{x:300,y:100})).toBeCloseTo(2*gizmoReach,6);
 expect(dragHandle('coneAngle',{value:45,length:6},o,h,{x:200,y:100})).toBe(45);expect(dragHandle('coneAngle',{value:45,length:6},o,h,{x:150,y:100})).toBeCloseTo(26.6,6);
 expect(dragHandle('coneAngle',{value:45,length:6},o,h,{x:5000,y:100})).toBe(88.8);expect(dragHandle('coneAngle',{value:45,length:6},o,h,{x:100,y:100})).toBe(1);
 expect(dragHandle('range',{value:4,length:4},o,o,{x:300,y:300})).toBe(4);
});
it('keeps a short range handle clear of the light and moves it smoothly',()=>{
 const tiny=light({kind:'point',range:.1});expect(handleReach(tiny)).toBe(minHandleReach);expect(lightHandles(tiny,identity)[0].point).toEqual({x:minHandleReach,y:0,z:0});
 const spot=light({kind:'spot',range:.2,coneAngle:30});expect(lightHandles(spot,identity)[0].point.z).toBe(-minHandleReach);expect(handleReach({kind:'spot',range:0})).toBe(gizmoReach);expect(handleReach({kind:'point',range:7})).toBe(7);
 const o={x:0,y:0},h={x:100,y:0};expect(dragHandle('range',{value:.1,length:minHandleReach},o,h,{x:105,y:0})).toBeCloseTo(.11,6);expect(dragHandle('range',{value:.1,length:minHandleReach},o,h,{x:300,y:0})).toBeCloseTo(.3,6);
 expect(dragHandle('coneAngle',{value:30,length:minHandleReach},o,h,{x:100,y:0})).toBe(30);
});
