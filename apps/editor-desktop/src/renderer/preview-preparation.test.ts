import {describe,it,expect} from 'vitest';
import {PreviewPreparation,playbackDisabled} from './preview-preparation';
describe('Preview preparation ownership',()=>{
 it('cancels a never-settling preload without allowing stale completion to clear a replacement',async()=>{
  const states:boolean[]=[],gate=new PreviewPreparation(v=>states.push(v)),first=gate.begin();let resolve!:(n:number)=>void;
  const wait=gate.wait(first,new Promise<number>(r=>resolve=r));gate.cancel();await expect(wait).rejects.toMatchObject({name:'AbortError'});
  const second=gate.begin();resolve(7);gate.finish(first);expect(gate.owns(second)).toBe(true);expect(gate.owns(first)).toBe(false);
  expect(await gate.wait(second,Promise.resolve(8))).toBe(8);gate.finish(second);expect(states).toEqual([true,false,true,false]);
 });
 it('keeps Stop available only for preview-owned busy state',()=>{
  for(const mode of ['edit','playing','paused']as const){expect(playbackDisabled('stop',{mode,busy:true,previewPreparing:true})).toBe(false);expect(playbackDisabled('stop',{mode,busy:true,previewPreparing:false})).toBe(true);}
  expect(playbackDisabled('play',{mode:'edit',busy:true,previewPreparing:true})).toBe(true);
 });
 it('rejects duplicate startup and observes cancellation before attaching waits',async()=>{
  const gate=new PreviewPreparation(()=>{}),token=gate.begin();expect(()=>gate.begin()).toThrow('already preparing');gate.cancel();await expect(gate.wait(token,Promise.resolve())).rejects.toMatchObject({name:'AbortError'});
 });
});
