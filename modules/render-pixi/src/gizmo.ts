/** All pointer coordinates are in the selected entity's parent space. */
export interface Point {x:number;y:number}
import type {Transform2D} from '@olivestudio/engine';
export type {Transform2D} from '@olivestudio/engine';
export type TransformTool='move'|'rotate'|'scale';
export type TransformAxis='x'|'y'|'xy';
export function angleStep(previous:number,next:number):number{return Math.atan2(Math.sin(next-previous),Math.cos(next-previous));}
export function pointerAngle(point:Point,origin:Point){return Math.atan2(point.y-origin.y,point.x-origin.x);}
function unrotate(p:Point,t:Transform2D):Point{const r=t.rotation*Math.PI/180,dx=p.x-t.x,dy=p.y-t.y;return{x:Math.cos(r)*dx+Math.sin(r)*dy,y:-Math.sin(r)*dx+Math.cos(r)*dy};}
/** Keeps the sign of the start scale (a flipped object stays flipped) and its magnitude within 0.01–100. */
const clampScale=(value:number,start:number)=>{const sign=Math.sign(start)||1;return sign*Math.max(Math.min(.01,Math.abs(start)),Math.min(100,value*sign));};
export function evaluateTransform(start:Transform2D,from:Point,to:Point,tool:TransformTool,axis:TransformAxis,shift=false,rotationDelta=0):Transform2D{
 if(!Object.values(to).every(Number.isFinite))return{...start};
 if(tool==='move')return{...start,x:start.x+(axis==='y'?0:to.x-from.x),y:start.y+(axis==='x'?0:to.y-from.y)};
 if(tool==='rotate'){const rotation=start.rotation+rotationDelta*180/Math.PI;return{...start,rotation:shift?Math.round(rotation/15)*15:rotation};}
 const a=unrotate(from,start),b=unrotate(to,start);
 let sx=Math.abs(a.x)>1e-8?b.x/a.x:1,sy=Math.abs(a.y)>1e-8?b.y/a.y:1;
 if(shift&&axis==='xy'){const length=a.x*a.x+a.y*a.y;const factor=length>1e-8?(a.x*b.x+a.y*b.y)/length:1;sx=factor;sy=factor;}
 return{...start,scaleX:axis==='y'?start.scaleX:clampScale(start.scaleX*sx,start.scaleX),scaleY:axis==='x'?start.scaleY:clampScale(start.scaleY*sy,start.scaleY)};
}
