import type {Light3D} from './contracts';
// Editor-only light gizmos as world-space line segments: a pure function of the light's data and its node's
// local→world mapping, so the overlay only projects and strokes them. No pixi imports.
export interface Point3{x:number;y:number;z:number}
export interface LightGizmo{segments:[Point3,Point3][];origin:Point3}
const ring=(toWorld:(p:Point3)=>Point3,radius:number,at:(a:number,r:number)=>Point3,steps=32)=>{const out:[Point3,Point3][]=[];let prev=toWorld(at(0,radius));for(let i=1;i<=steps;i++){const next=toWorld(at(i/steps*Math.PI*2,radius));out.push([prev,next]);prev=next;}return out;};
/** Length a gizmo uses when the light has no range: directional arrows and unlimited spots. */
export const gizmoReach=2;
/**
 * Directional: an arrow along local −Z. Point: three range circles (none for range 0). Spot: the cone from the bulb to its
 * base (range, or `gizmoReach` without one), the base ring and, with a soft edge, the inner full-brightness ring.
 * `selected` adds the detail; unselected lights get only the origin for an icon. Ambient lights have no gizmo.
 */
export function lightGizmo(d:Pick<Light3D,'kind'|'range'|'coneAngle'|'penumbra'>,toWorld:(local:Point3)=>Point3,selected:boolean):LightGizmo|undefined{
 if(d.kind==='ambient')return undefined;const origin=toWorld({x:0,y:0,z:0}),segments:[Point3,Point3][]=[];
 if(!selected)return{origin,segments};
 if(d.kind==='directional'){const tip=toWorld({x:0,y:0,z:-gizmoReach});segments.push([origin,tip]);for(const [x,y] of [[.15,0],[-.15,0],[0,.15],[0,-.15]])segments.push([tip,toWorld({x,y,z:-gizmoReach+.35})]);}
 if(d.kind==='point'&&d.range>0){segments.push(...ring(toWorld,d.range,(a,r)=>({x:Math.cos(a)*r,y:Math.sin(a)*r,z:0})),...ring(toWorld,d.range,(a,r)=>({x:Math.cos(a)*r,y:0,z:Math.sin(a)*r})),...ring(toWorld,d.range,(a,r)=>({x:0,y:Math.cos(a)*r,z:Math.sin(a)*r})));}
 if(d.kind==='spot'){const length=d.range>0?d.range:gizmoReach,radius=length*Math.tan(d.coneAngle*Math.PI/180),base=(a:number,r:number)=>({x:Math.cos(a)*r,y:Math.sin(a)*r,z:-length});
  for(let i=0;i<4;i++)segments.push([origin,toWorld(base(i*Math.PI/2,radius))]);segments.push(...ring(toWorld,radius,base));
  if(d.penumbra>0){const inner=length*Math.tan(d.coneAngle*(1-d.penumbra)*Math.PI/180);if(inner>1e-3)segments.push(...ring(toWorld,inner,base,24));}}
 return{origin,segments};
}
/** Screen radius, in app pixels, within which a click on a light's icon picks the light. */
export const lightIconRadius=12;
/** The light whose icon is nearest a click, within `radius`; icons drawn later win ties, like the overlay stacking. */
export function pickLightIcon(point:{x:number;y:number},icons:readonly {id:string;x:number;y:number}[],radius=lightIconRadius):string|undefined{
 let best:string|undefined,distance=radius;for(const icon of icons){const d=Math.hypot(icon.x-point.x,icon.y-point.y);if(d<=distance){best=icon.id;distance=d;}}return best;}
/** Depth a camera frustum gizmo reaches when `far` is further away. */
export const cameraGizmoReach=3;
/**
 * A camera's view volume along local −Z: the near rectangle, a rectangle at `min(far, cameraGizmoReach)`, the four
 * edges joining them, and an "up" triangle above the far rectangle. Perspective spreads by the vertical `fov`;
 * orthographic keeps a half width of `orthographicSize` and a half height of that over `aspect`.
 */
export function cameraGizmo(d:{mode:'perspective'|'orthographic';fov:number;near:number;far:number;orthographicSize:number},aspect:number,toWorld:(local:Point3)=>Point3,selected:boolean):LightGizmo{
 const origin=toWorld({x:0,y:0,z:0}),segments:[Point3,Point3][]=[];if(!selected)return{origin,segments};
 const ratio=aspect>0&&Number.isFinite(aspect)?aspect:1,depth=Math.max(d.near,Math.min(d.far,cameraGizmoReach)),half=(z:number)=>d.mode==='orthographic'?{w:d.orthographicSize,h:d.orthographicSize/ratio}:{h:z*Math.tan(d.fov*Math.PI/360),w:z*Math.tan(d.fov*Math.PI/360)*ratio};
 const rect=(z:number)=>{const {w,h}=half(z);return[[-w,-h],[w,-h],[w,h],[-w,h]].map(([x,y])=>toWorld({x,y,z:-z}));};
 const near=rect(d.near),far=rect(depth);for(let i=0;i<4;i++){segments.push([near[i],near[(i+1)%4]],[far[i],far[(i+1)%4]],[near[i],far[i]]);}
 const {w,h}=half(depth),top=toWorld({x:0,y:h*1.5,z:-depth});segments.push([toWorld({x:-w*.4,y:h,z:-depth}),top],[top,toWorld({x:w*.4,y:h,z:-depth})]);
 return{origin,segments};
}
/** A draggable point on a selected light's gizmo: `range` (point/spot reach) or `coneAngle` (spot rim). `anchor` is the point the drag is measured from. */
export interface GizmoHandle{key:'range'|'coneAngle';point:Point3;anchor:Point3}
/** Closest a range handle sits to its light, in world units, so a short range never buries the handle under the light's icon. */
export const minHandleReach=.5;
/** The distance a range handle is drawn at, and the length a drag scales: the range, at least `minHandleReach` (`gizmoReach` for an unlimited spot). */
export const handleReach=(d:Pick<Light3D,'kind'|'range'>)=>d.kind==='spot'&&d.range<=0?gizmoReach:Math.max(d.range,minHandleReach);
/** Point light: on its range ring along local +X. Spot: at the cone base centre (range) and on the base rim (cone angle). */
export function lightHandles(d:Pick<Light3D,'kind'|'range'|'coneAngle'>,toWorld:(local:Point3)=>Point3):GizmoHandle[]{
 const origin=toWorld({x:0,y:0,z:0});
 if(d.kind==='point')return d.range>0?[{key:'range',point:toWorld({x:handleReach(d),y:0,z:0}),anchor:origin}]:[];
 if(d.kind!=='spot')return[];const length=handleReach(d),base=toWorld({x:0,y:0,z:-length});
 return[{key:'range',point:base,anchor:origin},{key:'coneAngle',point:toWorld({x:length*Math.tan(d.coneAngle*Math.PI/180),y:0,z:-length}),anchor:base}];
}
type Screen={x:number;y:number};
/** Shortest range a drag sets; 0 (no limit) stays an Inspector choice. */
export const minDragRange=.1;
/**
 * The value a handle takes after dragging it to `pointer`, all in screen pixels: the reach scales with the pointer's
 * distance from the anchor along the anchor→handle line; the cone angle follows the rim radius against the cone length.
 * `start.value` is the value the drag began with and `start.length` the handle's drawn reach (`handleReach`). Range is at least `minDragRange`.
 */
export function dragHandle(key:GizmoHandle['key'],start:{value:number;length:number},anchor:Screen,handle:Screen,pointer:Screen):number{
 const dx=handle.x-anchor.x,dy=handle.y-anchor.y,span=Math.hypot(dx,dy);if(span<1e-6)return start.value;
 const along=((pointer.x-anchor.x)*dx+(pointer.y-anchor.y)*dy)/span,scale=Math.max(0,along/span);
 // The range scales its own value, so a handle held off a short light moves it smoothly; an unlimited spot starts from its drawn reach.
 if(key==='range')return Math.min(1e5,Math.max(minDragRange,Math.round((start.value>0?start.value:start.length)*scale*100)/100));
 const radius=start.length*Math.tan(start.value*Math.PI/180)*scale;return Math.min(89,Math.max(1,Math.round(Math.atan2(radius,start.length)*1800/Math.PI)/10));
}
