import {expect,it} from 'vitest';
import {fitText} from './text-fit.js';
import {safeScreenRect} from './screen.js';

it('fits or truncates text while keeping whole graphemes',()=>{
 const width=(text:string)=>[...new Intl.Segmenter().segment(text)].length*10;
 expect(fitText('abcdef',30,'shrink',width)).toEqual({text:'abcdef',scale:.5});
 expect(fitText('👨‍👩‍👦 Çabc',30,'ellipsis',width)).toEqual({text:'👨‍👩‍👦…',scale:1});
 expect(fitText('abcdef',5,'ellipsis',width)).toEqual({text:'',scale:1});
 expect(fitText('abcdef',5,'none',width)).toEqual({text:'abcdef',scale:1});
});

it('maps asymmetric device insets onto a scaled and translated preview frame',()=>{
 expect(safeScreenRect({x:100,y:20,width:400,height:200},{width:200,height:200},{top:8,right:15,bottom:0,left:5}))
  .toEqual({x:110,y:28,width:360,height:192});
});
