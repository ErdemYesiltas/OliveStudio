import {expect,it} from 'vitest';
import {visualKey} from './visual-signature';
const text=(t:string,size=20)=>({id:'t',type:'pixi.text',version:1,data:{text:t,fontSize:size,alpha:1}});
it('keeps text content and alpha out of the rebuild key, but not the style',()=>{
 const key=(c:Parameters<typeof visualKey>[0])=>JSON.stringify(visualKey(c));
 expect(key(text('Clicks: 1'))).toBe(key(text('Clicks: 2')));expect(key(text('Clicks: 1'))).not.toBe(key(text('Clicks: 1',24)));
 expect(key({...text('a'),type:'pixi.bitmapText'})).toBe(key({...text('b'),type:'pixi.bitmapText'}));
 const shape=(alpha:number,width:number)=>({id:'s',type:'pixi.shape',version:1,data:{alpha,width}});expect(key(shape(.2,10))).toBe(key(shape(1,10)));expect(key(shape(1,10))).not.toBe(key(shape(1,12)));
 const other={id:'b',type:'interactions.bindings',version:1,data:{rules:[]}};expect(visualKey(other)).toBe(other);
});
