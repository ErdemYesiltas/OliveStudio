import {expect,it} from 'vitest';
import {angleStep,evaluateTransform,type Transform2D} from './gizmo';
const start:Transform2D={x:10,y:20,rotation:90,scaleX:2,scaleY:3};
it('moves in parent axes while leaving rotation and scale intact',()=>{
 expect(evaluateTransform(start,{x:12,y:24},{x:42,y:64},'move','x')).toEqual({...start,x:40});
 expect(evaluateTransform(start,{x:12,y:24},{x:42,y:64},'move','y')).toEqual({...start,y:60});
});
it('scales along rotated local axes and clamps at positive scale without flipping',()=>{
 // A 90-degree rotated point: local (10, 20) becomes parent (-20, 10).
 const result=evaluateTransform(start,{x:-10,y:30},{x:-30,y:50},'scale','xy');
 expect(result.scaleX).toBeCloseTo(6);expect(result.scaleY).toBeCloseTo(6);
 expect(result.x).toBe(start.x);expect(result.y).toBe(start.y);
 const crossed=evaluateTransform(start,{x:-10,y:30},{x:30,y:10},'scale','xy');
 expect(crossed.scaleX).toBe(.01);expect(crossed.scaleY).toBe(.01);
 expect(evaluateTransform(start,{x:-10,y:30},{x:-10000,y:10000},'scale','xy').scaleX).toBe(100);
});
it('preserves the original aspect ratio when Shift scaling a corner',()=>{
 const result=evaluateTransform(start,{x:-10,y:30},{x:-30,y:50},'scale','xy',true);
 expect(result.scaleX/start.scaleX).toBeCloseTo(result.scaleY/start.scaleY);
});
it('unwraps rotations across ±180 and snaps in 15-degree increments',()=>{
 expect(angleStep(179*Math.PI/180,-179*Math.PI/180)*180/Math.PI).toBeCloseTo(2);
 expect(angleStep(-179*Math.PI/180,179*Math.PI/180)*180/Math.PI).toBeCloseTo(-2);
 expect(evaluateTransform(start,start,start,'rotate','xy',true,23*Math.PI/180).rotation).toBe(120);
 expect(evaluateTransform(start,start,start,'rotate','xy',false,4*Math.PI).rotation).toBe(810);
});
it('ignores invalid coordinates and handles zero-length scale vectors',()=>{
 expect(evaluateTransform(start,start,{x:NaN,y:Infinity},'scale','xy')).toEqual(start);
 expect(evaluateTransform(start,start,start,'scale','xy',true)).toEqual(start);
});
it('keeps a flipped object flipped while scaling and clamps its magnitude',()=>{
 const flipped:Transform2D={...start,scaleX:-2,skewX:15};
 const result=evaluateTransform(flipped,{x:-10,y:30},{x:-30,y:50},'scale','xy');
 expect(result.scaleX).toBeCloseTo(-6);expect(result.scaleY).toBeCloseTo(6);expect(result.skewX).toBe(15);
 expect(evaluateTransform(flipped,{x:-10,y:30},{x:30,y:10},'scale','xy').scaleX).toBe(-.01);
 expect(evaluateTransform(flipped,{x:-10,y:30},{x:-10000,y:10000},'scale','xy').scaleX).toBe(-100);
});
