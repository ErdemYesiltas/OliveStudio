import {expect,it} from 'vitest';
import {Container} from 'pixi.js';
import {ParticleContainer3D} from '@pixi/3d';
import {SceneService,transformDefinition} from '@rewrite/scene';
import {transform3dDefinition,viewport3dDefinition} from '@rewrite/scene3d';
import {authoring3dDefinitions} from './contracts';
import {model3dDefinition} from './model-contracts';
import {Authoring3D} from './model';
import {Scene3DProjection} from './projection';
import {runtime3DProblems} from './preflight';
import {Particles3DSchema,particles3dDefaults,particle3DState,writeParticle3D,EmitterHistory,type Particles3D} from './particles3d';
const base=(over:Partial<Particles3D>={}):Particles3D=>Particles3DSchema.parse({...particles3dDefaults(),...over});
const live=(p:Particles3D,t:number)=>Array.from({length:p.count},(_,i)=>writeParticle3D(p,i,t,particle3DState()).alive).filter(Boolean).length;
function fixture(){const defs=new Map([transformDefinition,transform3dDefinition,viewport3dDefinition,model3dDefinition,...authoring3dDefinitions].map(d=>[d.type,d])),scene=new SceneService(()=>defs),editor=new Authoring3D(scene,()=>{},()=>null,()=>true,()=>({x:480,y:270})),ids=editor.createView(),host=new Container(),errors:unknown[]=[];return{scene,editor,ids,host,errors,context:{node:(id:string)=>id===ids.viewId?host:undefined,changed(){},report(e:unknown){errors.push(e);}}};}
function setData(f:ReturnType<typeof fixture>,id:string,data:Partial<Particles3D>,pose?:object){f.scene.document.transact('Particles',s=>{const e=s.entities.find(e=>e.id===id)!;Object.assign(e.components.find(c=>c.type==='pixi3d.particles')!.data as object,data);if(pose)Object.assign(e.components.find(c=>c.type==='scene3d.transform')!.data as object,pose);});}
const position=(c:ParticleContainer3D,i:number)=>{const o=i*4*c.data.floatStride;return[c.data.f32[o],c.data.f32[o+1],c.data.f32[o+2]];};
it('parses emitters saved before F8 with the new defaults',()=>{
 const {burstInterval:_a,space:_b,billboard:_c,textureAsset:_d,frameColumns:_e,frameRows:_f,frameMode:_g,frameRate:_h,...old}=particles3dDefaults();
 expect(Particles3DSchema.parse(old)).toEqual(particles3dDefaults());
});
it('starts on Play, stops making new particles on Stop and repeats a burst',()=>{
 const flow=base({autoplay:false,lifetime:1,lifetimeRandom:0,count:100});expect(live(flow,5)).toBe(0);
 const started={...flow,startedAt:2};expect(live(started,1.9)).toBe(0);expect(live(started,2.5)).toBe(51);expect(live(started,4)).toBe(100);
 const stopped={...started,stoppedAt:4};expect(Math.abs(live(stopped,4.5)-50)).toBeLessThanOrEqual(1);expect(live(stopped,5.01)).toBe(0);
 const burst=base({emission:'burst',lifetime:.5,lifetimeRandom:0,burstInterval:2,count:10});expect([live(burst,.2),live(burst,1),live(burst,2.2),live(burst,2.6)]).toEqual([10,0,10,0]);
 const a=writeParticle3D(burst,3,.2,particle3DState()),b=writeParticle3D(burst,3,2.2,particle3DState());expect(a.x===b.x&&a.z===b.z).toBe(false);
 expect(live(base({emission:'burst',autoplay:false,startedAt:3,lifetime:1,lifetimeRandom:0,count:5}),3.5)).toBe(5);
});
it('picks flipbook frames over the lifetime, at a frame rate or at random',()=>{
 const sheet=base({emission:'burst',lifetime:1,lifetimeRandom:0,frameColumns:4,frameRows:2,count:50});
 expect([0,.24,.5,.99].map(t=>writeParticle3D(sheet,0,t,particle3DState()).frame)).toEqual([0,1,4,7]);
 const loop={...sheet,frameMode:'loop' as const,frameRate:10},f0=writeParticle3D(loop,0,0,particle3DState()).frame;expect(writeParticle3D(loop,0,.1,particle3DState()).frame).toBe((f0+1)%8);
 const random=new Set(Array.from({length:50},(_,i)=>writeParticle3D({...sheet,frameMode:'random'},i,.3,particle3DState()).frame));expect(random.size).toBeGreaterThan(4);expect(Math.max(...random)).toBeLessThan(8);
 expect(writeParticle3D(base(),0,.3,particle3DState()).frame).toBe(0);
});
it('remembers where a world-space emitter was and forgets frames after a jump back',()=>{
 const h=new EmitterHistory(1),m=(x:number)=>[1,0,0,0,0,1,0,0,0,0,1,0,x,0,0,1];
 for(let k=0;k<=30;k++)h.record(k/10,m(k));
 expect(h.at(2.05)[12]).toBe(20);expect(h.at(5)[12]).toBe(30);expect(h.at(0)[12]).toBe(20);expect(h.size).toBeLessThan(14);
 h.record(2.5,m(-1));expect(h.at(2.9)[12]).toBe(-1);expect(h.at(2.45)[12]).toBe(24);
});
it('leaves world-space particles where they were born and takes Play without a rebuild',async()=>{
 const f=fixture(),p=new Scene3DProjection(f.context);try{
  const {id}=f.editor.create('particles',f.ids.viewId);setData(f,id,{space:'world',emission:'burst',speed:0,gravity:0,spawnShape:'point',lifetime:5,lifetimeRandom:0,count:4});
  p.sync(f.scene.document.current);const c=p.slots[0].particles[0].container!;expect(c.space).toBe('world');
  p.setParticleTime(.2);setData(f,id,{},{x:5});p.sync(f.scene.document.current);p.setParticleTime(.4);
  expect(position(c,0)[0]).toBeCloseTo(0,4);
  setData(f,id,{space:'local'});p.sync(f.scene.document.current);p.setParticleTime(.4);expect(position(p.slots[0].particles[0].container!,0)[0]).toBeCloseTo(0,4);
  const before=p.diagnostics().rebuilds;setData(f,id,{startedAt:3,stoppedAt:null});p.sync(f.scene.document.current);
  expect(p.diagnostics().rebuilds).toBe(before);expect(p.slots[0].particles[0].data.startedAt).toBe(3);
  expect(f.errors).toEqual([]);
 }finally{await p.dispose();f.host.destroy();}
});
it('reports a particle image missing from the Library',()=>{
 const f=fixture(),{id}=f.editor.create('particles',f.ids.viewId);setData(f,id,{textureAsset:'gone'});
 expect(runtime3DProblems(f.scene.document.current,()=>undefined).join()).toContain('the particle image is missing from the Library');
});
