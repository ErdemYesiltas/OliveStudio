import {z} from 'zod';
// Pure 3D particle emitter: every particle's state is a function of (data, index, time), so editing, Pause/Step,
// scrubbing backwards and the exported player all show the same frame. No pixi imports.
const color=z.string().regex(/^#[0-9a-fA-F]{6}$/),number=z.number().finite();
export const particle3dType='pixi3d.particles';
export const particleTextures=['soft','circle','square'] as const,particleSpawnShapes=['point','sphere','box'] as const,particleSpaces=['local','world'] as const,particleFrameModes=['overLife','loop','random'] as const,particleBillboards=['spherical','cylindrical'] as const;
/**
 * Particles leave along the emitter's local +Y. In `local` space they travel with the entity; in `world` space each one
 * starts from where the emitter was when it was born and stays behind. Gravity is world-down. Fields after
 * `blendMode` were added later and have defaults, so older emitters keep their look.
 */
export const Particles3DSchema=z.object({
 count:z.number().int().min(1).max(4000),emission:z.enum(['continuous','burst']),autoplay:z.boolean(),seed:z.number().int().min(0).max(2**31-1),
 lifetime:number.min(.05).max(60),lifetimeRandom:number.min(0).max(.95),speed:number.min(0).max(1000),speedRandom:number.min(0).max(1),spread:number.min(0).max(180),gravity:number.min(-1000).max(1000),
 spawnShape:z.enum(particleSpawnShapes),spawnRadius:number.min(0).max(1000),spawnWidth:number.min(0).max(1000),spawnHeight:number.min(0).max(1000),spawnDepth:number.min(0).max(1000),
 size:number.min(.001).max(100),sizeRandom:number.min(0).max(.95),endScale:number.min(0).max(20),alpha:number.min(0).max(1),endAlpha:number.min(0).max(1),tint:color,endTint:color,rotationSpeed:number.min(-3600).max(3600),
 particleTexture:z.enum(particleTextures),blendMode:z.enum(['normal','add']),
 /** Repeat a burst every this many seconds (0 = once). A particle lives at most until the next burst. */
 burstInterval:number.min(0).max(600).default(0),space:z.enum(particleSpaces).default('local'),billboard:z.enum(particleBillboards).default('spherical'),
 /** A Library image instead of the built-in dot; with more than one column or row it is a flipbook sheet, read left to right, top to bottom. */
 textureAsset:z.string().max(128).default(''),frameColumns:z.number().int().min(1).max(16).default(1),frameRows:z.number().int().min(1).max(16).default(1),
 frameMode:z.enum(particleFrameModes).default('overLife'),frameRate:number.min(0).max(120).default(12),
 /** Written by the Play / Stop particles actions while the game runs (seconds of game time); not authored. */
 startedAt:number.nullable().optional(),stoppedAt:number.nullable().optional(),
 /** 'script': the built-in emitter is off and a script writes every particle (self.particles.write); the pool is `count`. */
 driver:z.enum(['emitter','script']).default('emitter'),
}).strict();
export type Particles3D=z.infer<typeof Particles3DSchema>;
export const particles3dDefaults=():Particles3D=>({count:200,emission:'continuous',autoplay:true,seed:1,lifetime:2,lifetimeRandom:.3,speed:2,speedRandom:.5,spread:25,gravity:1,spawnShape:'point',spawnRadius:.25,spawnWidth:1,spawnHeight:1,spawnDepth:1,size:.2,sizeRandom:.3,endScale:.2,alpha:1,endAlpha:0,tint:'#ffd27a',endTint:'#ff6a2a',rotationSpeed:0,particleTexture:'soft',blendMode:'add',burstInterval:0,space:'local',billboard:'spherical',textureAsset:'',frameColumns:1,frameRows:1,frameMode:'overLife',frameRate:12,driver:'emitter'});
function random(seed:number,a:number,b:number,salt:number){
 let h=Math.imul(seed^0x9e3779b9,0x85ebca6b)^Math.imul(a+1,0xc2b2ae35)^Math.imul(b+7,0x27d4eb2f)^Math.imul(salt+13,0x165667b1);
 h=Math.imul(h^(h>>>15),0x2c1b3c6d);h=Math.imul(h^(h>>>12),0x297a2d39);h^=h>>>15;
 return (h>>>0)/4294967296;
}
export interface Particle3DState{alive:boolean;x:number;y:number;z:number;size:number;rotation:number;color:number;alpha:number;frame:number;age:number}
export const particle3DState=():Particle3DState=>({alive:false,x:0,y:0,z:0,size:0,rotation:0,color:0xffffff,alpha:0,frame:0,age:0});
const rgb=(hex:string)=>parseInt(hex.slice(1),16),lerp=(a:number,b:number,k:number)=>Math.round((a&255)+((b&255)-(a&255))*k);
/**
 * Writes particle `i` at `time` into `out`. Continuous: particle `i` is reborn every lifetime with phase `i/count`;
 * with autoplay and no start it is pre-warmed (steady state at time 0, what the editor shows). Burst: every particle is
 * born at the start (and again every `burstInterval`) and lives once. A Play action sets `startedAt`; after `stoppedAt`
 * nothing new is born and living particles finish. `gx,gy,gz` is gravity in the emitter's local space, so a rotated
 * emitter still falls towards world down; pass 0 to add it yourself (world space). `out.age` is the particle's age, so
 * its birth time is `time - age`. Allocates nothing.
 */
export function writeParticle3D(p:Particles3D,i:number,time:number,out:Particle3DState,gx=0,gy=-p.gravity,gz=0){
 const L=p.lifetime*(1-p.lifetimeRandom*random(p.seed,i,0,8)),t=Math.max(0,time),started=p.startedAt??null;let age:number,cycle:number;out.alive=false;
 if(p.emission==='burst'){
  const start=started??(p.autoplay?0:null);if(start===null)return out;const since=t-start;if(since<0)return out;
  if(p.burstInterval>0){const n=Math.floor(since/p.burstInterval);age=since-n*p.burstInterval;cycle=Math.round(start*1000)+n*7919;}else{age=since;cycle=Math.round(start*1000);}
  if(age>=L)return out;}
 else if(started===null){if(!p.autoplay)return out;const shifted=t+L*(1-i/p.count);cycle=Math.floor(shifted/L);age=shifted-cycle*L;}
 else{const a=t-started-L*i/p.count;if(a<0)return out;cycle=Math.floor(a/L);age=a-cycle*L;}
 if(p.stoppedAt!=null&&t-age>p.stoppedAt)return out;
 const seed=p.seed,k=age/L;
 // Uniform direction inside a cone of half-angle `spread` around +Y.
 const cosMax=Math.cos(p.spread*Math.PI/180),cy=1-random(seed,i,cycle,1)*(1-cosMax),sy=Math.sqrt(Math.max(0,1-cy*cy)),phi=random(seed,i,cycle,2)*Math.PI*2,dx=Math.cos(phi)*sy,dz=Math.sin(phi)*sy;
 const speed=p.speed*(1-p.speedRandom+random(seed,i,cycle,3)*p.speedRandom);
 let sx=0,sy0=0,sz=0;
 if(p.spawnShape==='sphere'){const u=random(seed,i,cycle,4)*2-1,a=random(seed,i,cycle,5)*Math.PI*2,rad=Math.cbrt(random(seed,i,cycle,6))*p.spawnRadius,s=Math.sqrt(1-u*u);sx=Math.cos(a)*s*rad;sy0=u*rad;sz=Math.sin(a)*s*rad;}
 else if(p.spawnShape==='box'){sx=(random(seed,i,cycle,4)-.5)*p.spawnWidth;sy0=(random(seed,i,cycle,5)-.5)*p.spawnHeight;sz=(random(seed,i,cycle,6)-.5)*p.spawnDepth;}
 const half=.5*age*age,a=rgb(p.tint),b=rgb(p.endTint);
 out.alive=true;out.x=sx+dx*speed*age+gx*half;out.y=sy0+cy*speed*age+gy*half;out.z=sz+dz*speed*age+gz*half;
 out.size=p.size*(1+(p.endScale-1)*k)*(1-p.sizeRandom*random(seed,i,cycle,7));out.rotation=(p.rotationSpeed*age+random(seed,i,cycle,9)*360)*Math.PI/180;
 out.alpha=p.alpha*(1+(p.endAlpha-1)*k);out.color=(lerp(a>>16,b>>16,k)<<16)|(lerp(a>>8,b>>8,k)<<8)|lerp(a,b,k);
 const frames=p.frameColumns*p.frameRows;out.age=age;
 out.frame=frames<2?0:p.frameMode==='overLife'?Math.min(frames-1,Math.floor(k*frames)):p.frameMode==='random'?Math.floor(random(seed,i,cycle,10)*frames):Math.floor(age*p.frameRate+random(seed,i,cycle,10)*frames)%frames;
 return out;
}
/**
 * Where a world-space emitter was over the last seconds: its world matrix (16 numbers, column-major) per frame, so a
 * particle can start from where the emitter stood at its birth. Going back in time (scrubbing, a new Play) forgets the
 * frames after it; a birth older than the oldest frame uses that frame.
 */
export class EmitterHistory{
 private times:number[]=[];private matrices:Float32Array[]=[];
 constructor(private keep:number){}
 record(time:number,matrix:ArrayLike<number>){
  while(this.times.length&&this.times[this.times.length-1]>=time){this.times.pop();this.matrices.pop();}
  // Drop frames older than `keep`, but keep the last one before it so births just inside the window still find a frame.
  let drop=0;while(drop+1<this.times.length&&this.times[drop+1]<=time-this.keep)drop++;
  if(drop){this.times.splice(0,drop);this.matrices.splice(0,drop);}
  this.times.push(time);this.matrices.push(Float32Array.from(matrix));}
 /** The matrix of the last frame at or before `time`. */
 at(time:number):Float32Array{let lo=0,hi=this.times.length-1;if(hi<0)throw Error('No emitter frames recorded');if(time<=this.times[0])return this.matrices[0];
  while(lo<hi){const mid=(lo+hi+1)>>1;if(this.times[mid]<=time)lo=mid;else hi=mid-1;}return this.matrices[lo];}
 get size(){return this.times.length;}
}
