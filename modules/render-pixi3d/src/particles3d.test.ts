import {expect,it} from 'vitest';
import {Container,Texture} from 'pixi.js';
import {ParticleContainer3D} from '@pixi/3d';
import {SceneService,transformDefinition,parseScene} from '@rewrite/scene';
import {transform3dDefinition,viewport3dDefinition} from '@rewrite/scene3d';
import {authoring3dDefinitions,particles3dDefinition} from './contracts';
import {model3dDefinition} from './model-contracts';
import {Authoring3D} from './model';
import {Scene3DProjection} from './projection';
import {Particles3DSchema,particles3dDefaults,particle3DState,writeParticle3D,type Particles3D} from './particles3d';
import {runtime3DProblems} from './preflight';
const base=(over:Partial<Particles3D>={}):Particles3D=>Particles3DSchema.parse({...particles3dDefaults(),...over});
function fixture(){const defs=new Map([transformDefinition,transform3dDefinition,viewport3dDefinition,model3dDefinition,...authoring3dDefinitions].map(d=>[d.type,d])),scene=new SceneService(()=>defs),editor=new Authoring3D(scene,()=>{},()=>null,()=>true,()=>({x:480,y:270})),ids=editor.createView(),host=new Container(),errors:unknown[]=[];return{scene,editor,ids,host,errors,context:{node:(id:string)=>id===ids.viewId?host:undefined,changed(){},report(e:unknown){errors.push(e);}}};}
function setData(f:ReturnType<typeof fixture>,id:string,data:Partial<Particles3D>,pose?:object){f.scene.document.transact('Particles',s=>{const e=s.entities.find(e=>e.id===id)!;Object.assign(e.components.find(c=>c.type==='pixi3d.particles')!.data as object,data);if(pose)Object.assign(e.components.find(c=>c.type==='scene3d.transform')!.data as object,pose);});}
const position=(c:ParticleContainer3D,i:number)=>{const o=i*4*c.data.floatStride;return[c.data.f32[o],c.data.f32[o+1],c.data.f32[o+2]];};
it('is pure in (data, index, time) and keeps old data valid',()=>{
 const p=base(),a=writeParticle3D(p,7,1.25,particle3DState()),b=writeParticle3D(p,7,1.25,particle3DState());expect(a).toEqual(b);
 expect(writeParticle3D(base({seed:2}),7,1.25,particle3DState())).not.toEqual(a);
 expect(particles3dDefinition.parse(particles3dDefinition.defaults())).toEqual(particles3dDefaults());
 expect(()=>Particles3DSchema.parse({...particles3dDefaults(),count:4001})).toThrow();
});
it('pre-warms continuous emitters, plays a burst once and honours autoplay',()=>{
 const live=(p:Particles3D,t:number)=>Array.from({length:p.count},(_,i)=>writeParticle3D(p,i,t,particle3DState()).alive).filter(Boolean).length;
 expect(live(base(),0)).toBe(200);
 const burst=base({emission:'burst',lifetime:1,lifetimeRandom:0});expect(live(burst,.5)).toBe(200);expect(live(burst,1.01)).toBe(0);
 expect(live(base({autoplay:false}),1)).toBe(0);
});
it('emits along local +Y inside the cone and falls with gravity',()=>{
 const straight=base({spread:0,speed:2,speedRandom:0,gravity:0,spawnShape:'point',emission:'burst',lifetimeRandom:0}),s=writeParticle3D(straight,3,.5,particle3DState());
 expect(s.x).toBeCloseTo(0,6);expect(s.y).toBeCloseTo(1,6);expect(s.z).toBeCloseTo(0,6);
 const fall=writeParticle3D({...straight,speed:0,gravity:4},3,.5,particle3DState());expect(fall.y).toBeCloseTo(-.5,6);
 const cone=base({spread:30,speedRandom:0,gravity:0});for(let i=0;i<cone.count;i++){const p=writeParticle3D(cone,i,0,particle3DState()),r=Math.hypot(p.x,p.y,p.z);if(r>1e-3)expect(p.y/r).toBeGreaterThanOrEqual(Math.cos(Math.PI/6)-1e-9);}
});
it('projects one local-space container per emitter that scrubs back to the same buffer',async()=>{
 const f=fixture(),p=new Scene3DProjection(f.context);try{
  const {id}=f.editor.create('particles',f.ids.viewId);p.sync(f.scene.document.current);
  const container=p.slots[0].particles[0].container!;expect(container).toBeInstanceOf(ParticleContainer3D);expect(container.capacity).toBe(200);expect(container.space).toBe('local');expect(container.eventMode).toBe('none');
  expect(container.textures[0]).toBe(Texture.WHITE);
  p.setParticleTime(.4);const first=container.data.f32.slice();p.setParticleTime(2.7);expect(container.data.f32).not.toEqual(first);p.setParticleTime(.4);expect(container.data.f32).toEqual(first);
  setData(f,id,{count:50});p.sync(f.scene.document.current);expect(p.slots[0].particles[0].container!.capacity).toBe(50);expect(container.destroyed).toBe(true);
  expect(f.errors).toEqual([]);
 }finally{await p.dispose();f.host.destroy();}
});
it('keeps gravity pointing at world down when the emitter is turned over',async()=>{
 const f=fixture(),p=new Scene3DProjection(f.context);try{
  const {id}=f.editor.create('particles',f.ids.viewId);setData(f,id,{spread:0,speed:0,gravity:4,emission:'burst',lifetimeRandom:0,spawnShape:'point'},{qx:1,qy:0,qz:0,qw:0});
  p.sync(f.scene.document.current);p.setParticleTime(.5);const [x,y,z]=position(p.slots[0].particles[0].container!,0);
  expect(x).toBeCloseTo(0,4);expect(y).toBeCloseTo(.5,4);expect(z).toBeCloseTo(0,4);
 }finally{await p.dispose();f.host.destroy();}
});
it('passes the 3D runtime preflight',()=>{
 const f=fixture();f.editor.create('particles',f.ids.viewId);const scene=parseScene(f.scene.document.current,new Map([transformDefinition,transform3dDefinition,viewport3dDefinition,model3dDefinition,...authoring3dDefinitions].map(d=>[d.type,d])));
 expect(runtime3DProblems(scene)).toEqual([]);
});
