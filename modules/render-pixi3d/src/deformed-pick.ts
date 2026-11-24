import {getAttributeData,type IHitVolume3D,type HitResult3D,type Mesh3D,type Ray} from '@pixi/3d';

interface DeformSource {
 positions:Float32Array;indices:ArrayLike<number>;morphs:readonly Float32Array[];joints?:Float32Array;jointWeights?:Float32Array;
 weights():ArrayLike<number>|undefined;skin():ArrayLike<number>|undefined;
}

/** Deformed vertex positions in the mesh's local space, in shader order: morph offsets, then 4-joint skinning
 * with row-major 3x4 skinning matrices (which already cancel the bind shape, so the result stays mesh-local). */
export function deformPositions(source:DeformSource,out:Float32Array){
 const {positions,morphs,joints,jointWeights}=source,weights=source.weights(),skin=joints&&jointWeights?source.skin():undefined,count=positions.length/3;
 for(let v=0;v<count;v++){
  let x=positions[v*3],y=positions[v*3+1],z=positions[v*3+2];
  if(weights)for(let m=0;m<morphs.length;m++){const w=weights[m];if(w){const d=morphs[m];x+=d[v*3]*w;y+=d[v*3+1]*w;z+=d[v*3+2]*w;}}
  if(skin){let r00=0,r01=0,r02=0,r03=0,r10=0,r11=0,r12=0,r13=0,r20=0,r21=0,r22=0,r23=0;
   for(let k=0;k<4;k++){const w=jointWeights![v*4+k];if(!w)continue;const b=joints![v*4+k]*12;
    r00+=skin[b]*w;r01+=skin[b+1]*w;r02+=skin[b+2]*w;r03+=skin[b+3]*w;r10+=skin[b+4]*w;r11+=skin[b+5]*w;r12+=skin[b+6]*w;r13+=skin[b+7]*w;r20+=skin[b+8]*w;r21+=skin[b+9]*w;r22+=skin[b+10]*w;r23+=skin[b+11]*w;}
   const sx=r00*x+r01*y+r02*z+r03,sy=r10*x+r11*y+r12*z+r13,sz=r20*x+r21*y+r22*z+r23;x=sx;y=sy;z=sz;}
  out[v*3]=x;out[v*3+1]=y;out[v*3+2]=z;
 }
 return out;
}

/** Two-sided Möller–Trumbore against indexed triangles; returns the nearest t >= 0 or -1, and that triangle. */
export function raycastTriangles(origin:{x:number;y:number;z:number},direction:{x:number;y:number;z:number},positions:ArrayLike<number>,indices:ArrayLike<number>):{t:number;triangle:number;normal:[number,number,number]}{
 let best=-1,triangle=-1,normal:[number,number,number]=[0,0,0];
 for(let i=0;i+2<indices.length;i+=3){
  const a=indices[i]*3,b=indices[i+1]*3,c=indices[i+2]*3;
  const e1x=positions[b]-positions[a],e1y=positions[b+1]-positions[a+1],e1z=positions[b+2]-positions[a+2],e2x=positions[c]-positions[a],e2y=positions[c+1]-positions[a+1],e2z=positions[c+2]-positions[a+2];
  const px=direction.y*e2z-direction.z*e2y,py=direction.z*e2x-direction.x*e2z,pz=direction.x*e2y-direction.y*e2x,det=e1x*px+e1y*py+e1z*pz;
  if(Math.abs(det)<1e-12)continue;
  const inv=1/det,tx=origin.x-positions[a],ty=origin.y-positions[a+1],tz=origin.z-positions[a+2],u=(tx*px+ty*py+tz*pz)*inv;if(u<0||u>1)continue;
  const qx=ty*e1z-tz*e1y,qy=tz*e1x-tx*e1z,qz=tx*e1y-ty*e1x,w=(direction.x*qx+direction.y*qy+direction.z*qz)*inv;if(w<0||u+w>1)continue;
  const t=(e2x*qx+e2y*qy+e2z*qz)*inv;if(t<0||best>=0&&t>=best)continue;
  best=t;triangle=i/3;const nx=e1y*e2z-e1z*e2y,ny=e1z*e2x-e1x*e2z,nz=e1x*e2y-e1y*e2x,l=Math.hypot(nx,ny,nz)||1;normal=[nx/l,ny/l,nz/l];
 }
 return{t:best,triangle,normal};
}

const equal=(a:Float32Array,b:ArrayLike<number>|undefined)=>{if(!b)return a.length===0;if(a.length!==b.length)return false;for(let i=0;i<a.length;i++)if(a[i]!==b[i])return false;return true;};

/** A morph/skin mesh is otherwise picked against its rest-pose bounds. This volume deforms the vertices on
 * the CPU only when a pick asks, caching the result until the weights or skinning matrices change. */
/** A radius that encloses every pose the current weights and skinning matrices can produce, from cheap per-target and
 * per-joint bounds, so the pick's sphere pre-test never has to deform the mesh. */
export function conservativeRadius(restRadius:number,morphReach:readonly number[],weights:ArrayLike<number>|undefined,skin:ArrayLike<number>|undefined){
 let r=restRadius;if(weights)for(let m=0;m<morphReach.length;m++)r+=Math.abs(weights[m]??0)*morphReach[m];
 if(!skin)return r;let worst=0;
 for(let b=0;b+11<skin.length;b+=12){let norm=0;for(const k of [0,1,2,4,5,6,8,9,10])norm+=skin[b+k]**2;worst=Math.max(worst,Math.sqrt(norm)*r+Math.hypot(skin[b+3],skin[b+7],skin[b+11]));}
 // Joint weights are a convex blend, so the blended matrix stays within the largest single-joint bound.
 return worst;
}
export class DeformedHitVolume implements IHitVolume3D{
 private deformed:Float32Array;private weightKey=new Float32Array(0);private skinKey=new Float32Array(0);private valid=false;private readonly restRadius:number;private readonly morphReach:number[];
 /** Full CPU deformations run so far; the sphere pre-test alone never adds to it. */
 deformations=0;
 constructor(private source:DeformSource){this.deformed=new Float32Array(source.positions.length);let r=0;for(let i=0;i<source.positions.length;i+=3)r=Math.max(r,Math.hypot(source.positions[i],source.positions[i+1],source.positions[i+2]));this.restRadius=r;
  this.morphReach=source.morphs.map(d=>{let m=0;for(let i=0;i<d.length;i+=3)m=Math.max(m,Math.hypot(d[i],d[i+1],d[i+2]));return m;});}
 static forMesh(mesh:Mesh3D):DeformedHitVolume|null{
  const geometry=mesh.geometry as unknown as Parameters<typeof getAttributeData>[0]&{indices?:ArrayLike<number>;topology?:string;_morphTargets?:{positions:Float32Array}[];attributes:Record<string,unknown>};
  const morphs=(geometry._morphTargets??[]).map(t=>t.positions),skinned=Boolean(mesh.skeleton&&geometry.attributes.aJoints&&geometry.attributes.aWeights);
  if((!morphs.length&&!skinned)||!geometry.indices||(geometry.topology&&geometry.topology!=='triangle-list'))return null;
  const positions=getAttributeData(geometry,'aPosition',3);
  return new DeformedHitVolume({positions,indices:geometry.indices,morphs,...(skinned?{joints:getAttributeData(geometry,'aJoints',4),jointWeights:getAttributeData(geometry,'aWeights',4)}:{}),weights:()=>mesh.weights,skin:()=>mesh.skeleton?.worldMatrix});
 }
 private refresh(){
  const weights=this.source.weights(),skin=this.source.skin();
  if(this.valid&&equal(this.weightKey,weights)&&equal(this.skinKey,skin))return;
  deformPositions(this.source,this.deformed);this.deformations++;this.weightKey=Float32Array.from(weights??[]);this.skinKey=Float32Array.from(skin??[]);this.valid=true;
 }
 get boundingRadiusSq(){const r=conservativeRadius(this.restRadius,this.morphReach,this.source.weights(),this.source.joints?this.source.skin():undefined);return r*r;}
 raycast(localRay:Ray,out:HitResult3D):number{
  this.refresh();const hit=raycastTriangles(localRay.origin,localRay.direction,this.deformed,this.source.indices);if(hit.t<0)return -1;
  localRay.at(hit.t,out.point);out.distance=hit.t;out.normal.set(...hit.normal);out.uv.set(0,0);out.triangleIndex=hit.triangle;return hit.t;
 }
}
