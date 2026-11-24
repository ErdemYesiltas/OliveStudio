import {describe,it,expect} from 'vitest';
import {Animation,AnimationPlayer,Container3D,NumberTrack} from '@pixi/3d';
import {RuntimeSession} from '@rewrite/runtime';
import {SimulationTicker} from './clock';
import {chooseBackend} from './contracts';
import {SharedResource} from './resources';
describe('3D lab contracts',()=>{
 it('requires indirect-first-instance before choosing WebGPU',()=>{
  expect(chooseBackend('webgpu',false,false).selected).toBe('webgl');
  expect(chooseBackend('webgpu',true,false).selected).toBe('webgl');
  expect(chooseBackend('webgpu',true,true).selected).toBe('webgpu');
  expect(chooseBackend('webgl',true,true).selected).toBe('webgl');
 });
 it('drives real animation players from the paused runtime clock, independently',()=>{
  const animation=new Animation({label:'bob',tracks:[new NumberTrack({label:'Bob.y',times:[0,1,2],values:[0,1,0]})]});
  const a=new Container3D({label:'Bob'}),b=new Container3D({label:'Bob'});
  const p=new AnimationPlayer({target:a,animations:[animation],autoUpdate:false}),q=new AnimationPlayer({target:b,animations:[animation],autoUpdate:false});
  const clock=new SimulationTicker();p.play('bob');q.play('bob');q.getState('bob').gotoAndStop(.5);
  const session=new RuntimeSession([],()=>[{id:'animation',fixedUpdate:dt=>{clock.advance(dt);p.update(clock.ticker);q.update(clock.ticker);},dispose(){}}],{paused:true});
  try{
   session.advance(1);expect(a.y).toBe(0);
   session.step();expect(a.y).toBeCloseTo(1/60,6);expect(clock.ticker.started).toBe(false);
   for(let i=1;i<60;i++)session.step();expect(a.y).toBeCloseTo(1,6);expect(b.y).toBeCloseTo(.5,6);
   p.getState('bob').gotoAndStop(1);expect(a.y).toBeCloseTo(1,6);
   p.destroy();q.play('bob');clock.advance(1/60);q.update(clock.ticker);expect(b.y).toBeGreaterThan(.5);
  }finally{session.dispose();clock.dispose();p.destroy();q.destroy();a.destroy();b.destroy();}
 });
 it('loads once, releases on last owner, and serializes reload after asynchronous unload',async()=>{
  let loads=0,unloads=0;let finish!:()=>void;
  const pool=new SharedResource(async()=>({id:++loads}),async()=>{unloads++;await new Promise<void>(resolve=>{finish=resolve;});});
  const [a,b]=await Promise.all([pool.acquire(),pool.acquire()]);expect(a.value).toBe(b.value);expect(loads).toBe(1);
  await a.release();await a.release();expect(pool.refs).toBe(1);expect(unloads).toBe(0);
  const released=b.release();await Promise.resolve();expect(unloads).toBe(1);
  const next=pool.acquire();await Promise.resolve();expect(loads).toBe(1);finish();await released;
  const c=await next;expect(c.value.id).toBe(2);const done=c.release();await Promise.resolve();finish();await done;expect(pool.refs).toBe(0);
 });
 it('can retry after a failed shared load without leaking owners',async()=>{
  let fail=true;const pool=new SharedResource(async()=>{if(fail)throw Error('load');return 1;},async()=>{});
  const results=await Promise.allSettled([pool.acquire(),pool.acquire()]);expect(results.every(r=>r.status==='rejected')).toBe(true);expect(pool.refs).toBe(0);
  fail=false;const a=await pool.acquire();await a.release();expect(pool.refs).toBe(0);
 });
});
