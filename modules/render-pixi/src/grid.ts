import type {Transform2D,TransformAxis} from './gizmo';
export const gridSteps=[8,16,32,64,128] as const;
export interface GridSettings {visible:boolean;snap:boolean;step:number}
export function readGridSettings(value:unknown):GridSettings{const v=value&&typeof value==='object'?value as Partial<GridSettings>:{};return{visible:v.visible===true,snap:v.snap===true,step:gridSteps.some(step=>step===v.step)?v.step!:32};}
export function snapMove<Value extends Pick<Transform2D,'x'|'y'>>(value:Value,axis:TransformAxis,step:number):Value{if(!Number.isFinite(step)||step<=0)return value;return{...value,x:axis==='y'?value.x:Math.round(value.x/step)*step,y:axis==='x'?value.y:Math.round(value.y/step)*step};}
export function gridNudge(value:number,direction:number,step:number,multiple=1):number{return (direction>0?Math.floor(value/step+1e-9)+multiple:Math.ceil(value/step-1e-9)-multiple)*step;}
/** Bounded visible lines: coarsen display only; snap keeps the authored grid step. */
export function gridLines(bounds:{minX:number;minY:number;maxX:number;maxY:number},step:number):{step:number;segments:[{x:number;y:number},{x:number;y:number}][]}{
 const segments:[{x:number;y:number},{x:number;y:number}][]=[],{minX,minY,maxX,maxY}=bounds,width=maxX-minX,height=maxY-minY;
 if(![minX,minY,maxX,maxY,width,height,step].every(Number.isFinite)||step<=0||width<0||height<0)return{step,segments};
 const spacing=step*Math.max(1,Math.ceil(Math.max(width,height)/step/80));if(!Number.isFinite(spacing))return{step,segments};
 for(let i=0,x=Math.ceil(minX/spacing)*spacing;i<82&&x<=maxX;i++,x+=spacing)segments.push([{x,y:minY},{x,y:maxY}]);
 for(let i=0,y=Math.ceil(minY/spacing)*spacing;i<82&&y<=maxY;i++,y+=spacing)segments.push([{x:minX,y},{x:maxX,y}]);return{step:spacing,segments};
}
