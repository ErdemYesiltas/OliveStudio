import {z} from 'zod';
import type {Ray,HitResult3D,IHitVolume3D,Vector3} from '@pixi/3d';
// Instanced copies of one primitive, drawn as slots of a single BatchedMesh3D. Layout is pure in the data, so the
// editor, Preview and the exported player place every copy identically. No pixi runtime imports.
const color=z.string().regex(/^#[0-9a-fA-F]{6}$/),number=z.number().finite();
/** Copies × model parts share one batch; past this many slots the build is refused instead of stalling the frame. */
export const instances3dType='pixi3d.instances',maxInstances=20000,maxInstanceSlots=60000;
export const Instances3DSchema=z.object({
 source:z.enum(['primitive','model']).default('primitive'),assetId:z.string().max(128).default(''),shape:z.enum(['cube','sphere']),color,roughness:number.min(0).max(1),metallic:number.min(0).max(1),castShadow:z.boolean(),receiveShadow:z.boolean(),
 layout:z.enum(['grid','scatter']),columns:z.number().int().min(1).max(500),rows:z.number().int().min(1).max(500),layers:z.number().int().min(1).max(100),spacing:number.min(0).max(1000),
 count:z.number().int().min(1).max(maxInstances),areaWidth:number.min(0).max(10000),areaDepth:number.min(0).max(10000),areaHeight:number.min(0).max(10000),
 colorMode:z.enum(['single','random','gradient']).default('single'),color2:color.default('#e8a06a'),gradientAxis:z.enum(['x','y','z']).default('x'),
 /** Frustum culling per copy: `off` draws all (a layout that fits in view), `gpu` culls off the main thread (WebGL falls back to the CPU), `cpu` tests every copy each frame. */
 cull:z.enum(['off','cpu','gpu']).default('off'),
 seed:z.number().int().min(0).max(2**31-1),scale:number.min(.001).max(1000),scaleRandom:number.min(0).max(.95),yawRandom:number.min(0).max(180),jitter:number.min(0).max(1),
}).strict().refine(v=>v.layout!=='grid'||v.columns*v.rows*v.layers<=maxInstances,`A grid holds at most ${maxInstances} copies`);
export type Instances3D=z.infer<typeof Instances3DSchema>;
export const instances3dDefaults=():Instances3D=>({cull:'off',source:'primitive',assetId:'',shape:'cube',color:'#9fb7d6',colorMode:'single',color2:'#e8a06a',gradientAxis:'x',roughness:.6,metallic:0,castShadow:true,receiveShadow:true,layout:'grid',columns:10,rows:10,layers:1,spacing:1.5,count:200,areaWidth:10,areaDepth:10,areaHeight:0,seed:1,scale:1,scaleRandom:0,yawRandom:0,jitter:0});
export const instanceCount=(d:Instances3D)=>d.layout==='grid'?d.columns*d.rows*d.layers:d.count;
function random(seed:number,a:number,salt:number){let h=Math.imul(seed^0x9e3779b9,0x85ebca6b)^Math.imul(a+1,0xc2b2ae35)^Math.imul(salt+13,0x165667b1);h=Math.imul(h^(h>>>15),0x2c1b3c6d);h=Math.imul(h^(h>>>12),0x297a2d39);h^=h>>>15;return(h>>>0)/4294967296;}
/** Five floats per copy: x, y, z, yaw (radians), uniform scale; in the entity's local space, centred on its origin. */
export function instanceLayout(d:Instances3D):Float32Array{
 const n=instanceCount(d),out=new Float32Array(n*5);
 for(let i=0;i<n;i++){let x:number,y:number,z:number;
  if(d.layout==='grid'){const c=i%d.columns,r=Math.floor(i/d.columns)%d.rows,l=Math.floor(i/(d.columns*d.rows)),j=d.jitter*d.spacing;
   x=(c-(d.columns-1)/2)*d.spacing+(random(d.seed,i,1)-.5)*j;z=(r-(d.rows-1)/2)*d.spacing+(random(d.seed,i,2)-.5)*j;y=(l-(d.layers-1)/2)*d.spacing+(random(d.seed,i,3)-.5)*j*(d.layers>1?1:0);}
  else{x=(random(d.seed,i,1)-.5)*d.areaWidth;z=(random(d.seed,i,2)-.5)*d.areaDepth;y=(random(d.seed,i,3)-.5)*d.areaHeight;}
  const o=i*5;out[o]=x;out[o+1]=y;out[o+2]=z;out[o+3]=(random(d.seed,i,4)*2-1)*d.yawRandom*Math.PI/180;out[o+4]=d.scale*(1-d.scaleRandom*random(d.seed,i,5));}
 return out;
}
const channel=(hex:string,shift:number)=>(parseInt(hex.slice(1),16)>>shift&255)/255;
/**
 * Display-space (sRGB, 0–1) colour of every copy, three floats each, or `null` for `single` (one material colour).
 * `random` mixes `color` and `color2` by a seeded amount per copy; `gradient` runs from `color` to `color2` along the
 * chosen layout axis.
 */
export function instanceColors(d:Instances3D,layout:Float32Array):Float32Array|null{
 if(d.colorMode==='single')return null;const n=layout.length/5,out=new Float32Array(n*3),axis={x:0,y:1,z:2}[d.gradientAxis];let lo=Infinity,hi=-Infinity;
 if(d.colorMode==='gradient')for(let i=0;i<n;i++){const v=layout[i*5+axis];if(v<lo)lo=v;if(v>hi)hi=v;}
 for(let i=0;i<n;i++){const k=d.colorMode==='random'?random(d.seed,i,6):hi>lo?(layout[i*5+axis]-lo)/(hi-lo):0;
  for(let c=0;c<3;c++){const a=channel(d.color,16-8*c),b=channel(d.color2,16-8*c);out[i*3+c]=a+(b-a)*k;}}
 return out;
}
/** Row-major T·Ry·S for `Matrix4.set`. */
export function instanceMatrix(layout:Float32Array,i:number,m:number[]){const o=i*5,c=Math.cos(layout[o+3]),s=Math.sin(layout[o+3]),k=layout[o+4];
 m[0]=c*k;m[1]=0;m[2]=s*k;m[3]=layout[o];m[4]=0;m[5]=k;m[6]=0;m[7]=layout[o+1];m[8]=-s*k;m[9]=0;m[10]=c*k;m[11]=layout[o+2];m[12]=0;m[13]=0;m[14]=0;m[15]=1;return m;}
/** Local box every copy is picked against: the unit cube, or a model's bounds in its root space. */
export interface InstanceBox{min:[number,number,number];max:[number,number,number]}
export const unitBox:InstanceBox={min:[-.5,-.5,-.5],max:[.5,.5,.5]};
/**
 * Picks the copy a ray hits first: each copy's box (or radius-0.5 sphere), tested in that copy's own frame after a
 * bounding-sphere pre-test sized from the box's farthest corner. `lastIndex` is the copy of the latest hit.
 */
export class InstancesHitVolume implements IHitVolume3D{
 readonly boundingRadiusSq:number;lastIndex=-1;private readonly reach:number;
 constructor(private readonly layout:Float32Array,private readonly shape:'box'|'sphere',private readonly box:InstanceBox=unitBox){
  let reach=0;for(const x of [box.min[0],box.max[0]])for(const y of [box.min[1],box.max[1]])for(const z of [box.min[2],box.max[2]])reach=Math.max(reach,Math.hypot(x,y,z));this.reach=shape==='sphere'?.5:reach;
  let r=0;for(let i=0;i<layout.length;i+=5){const d=Math.hypot(layout[i],layout[i+1],layout[i+2])+layout[i+4]*this.reach;if(d>r)r=d;}this.boundingRadiusSq=r*r;}
 raycast(ray:Ray,out:HitResult3D):number{
  const L=this.layout,b=this.box,ox=ray.origin.x,oy=ray.origin.y,oz=ray.origin.z,dx=ray.direction.x,dy=ray.direction.y,dz=ray.direction.z;let best=Infinity,hit=-1;
  for(let i=0,o=0;o<L.length;i++,o+=5){const k=L[o+4],px=ox-L[o],py=oy-L[o+1],pz=oz-L[o+2],bound=k*this.reach;
   const along=px*dx+py*dy+pz*dz,closest=px*px+py*py+pz*pz-along*along;if(closest>bound*bound||-along+bound<0)continue;
   const c=Math.cos(-L[o+3]),s=Math.sin(-L[o+3]),lx=(c*px+s*pz)/k,ly=py/k,lz=(-s*px+c*pz)/k,ex=(c*dx+s*dz)/k,ey=dy/k,ez=(-s*dx+c*dz)/k;
   const t=this.shape==='sphere'?sphereT(lx,ly,lz,ex,ey,ez):boxT(lx,ly,lz,ex,ey,ez,b);if(t>=0&&t<best){best=t;hit=i;}}
  if(hit<0)return -1;this.lastIndex=hit;ray.at(best,out.point as Vector3);out.distance=best;out.normal.set(0,0,0);out.uv.set(0,0);out.triangleIndex=-1;return best;
 }
}
function sphereT(ox:number,oy:number,oz:number,dx:number,dy:number,dz:number){const a=dx*dx+dy*dy+dz*dz,b=ox*dx+oy*dy+oz*dz,c=ox*ox+oy*oy+oz*oz-.25,disc=b*b-a*c;if(disc<0)return -1;const q=Math.sqrt(disc),t0=(-b-q)/a,t1=(-b+q)/a;return t0>=0?t0:t1>=0?t1:-1;}
function boxT(ox:number,oy:number,oz:number,dx:number,dy:number,dz:number,b:InstanceBox){let lo=-Infinity,hi=Infinity;const o=[ox,oy,oz],d=[dx,dy,dz];
 for(let a=0;a<3;a++){if(Math.abs(d[a])<1e-12){if(o[a]<b.min[a]||o[a]>b.max[a])return -1;continue;}let t0=(b.min[a]-o[a])/d[a],t1=(b.max[a]-o[a])/d[a];if(t0>t1)[t0,t1]=[t1,t0];if(t0>lo)lo=t0;if(t1<hi)hi=t1;if(lo>hi)return -1;}
 return hi<0?-1:lo>=0?lo:hi;}
