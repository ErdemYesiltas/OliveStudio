import {expect,it} from 'vitest';
import {Geometry3D,Material3D,Mesh3D,Ray,Vector3,createHitResult3D,loadGlb,Model3D} from '@pixi/3d';
import {Loader} from 'pixi.js';
import {modelMatrix} from '../../../scripts/fixtures/model-matrix.mjs';
import {deformPositions,raycastTriangles,DeformedHitVolume,conservativeRadius} from './deformed-pick';
const quad=new Float32Array([-.5,.5,0,.5,.5,0,-.5,-.5,0,.5,-.5,0]),indices=new Uint16Array([0,2,3,0,3,1]),shear=new Float32Array([.7,0,0,.7,0,0,0,0,0,0,0,0]);
it('applies morph offsets, then 4-joint row-major skinning, in shader order',()=>{
 const out=new Float32Array(12);
 deformPositions({positions:quad,indices,morphs:[shear],weights:()=>[.5],skin:()=>undefined},out);expect(Array.from(out.slice(0,3)).map(v=>+v.toFixed(6))).toEqual([-.15,.5,0]);expect(Array.from(out.slice(6,9))).toEqual([-.5,-.5,0]);
 // Joint 0 identity, joint 1 translates +2 in Y; vertex 0 is fully on joint 1, vertex 2 split half/half.
 const skin=[1,0,0,0, 0,1,0,0, 0,0,1,0, 1,0,0,0, 0,1,0,2, 0,0,1,0],joints=new Float32Array([1,0,0,0, 0,0,0,0, 0,1,0,0, 0,0,0,0]),jw=new Float32Array([1,0,0,0, 1,0,0,0, .5,.5,0,0, 1,0,0,0]);
 deformPositions({positions:quad,indices,morphs:[shear],joints,jointWeights:jw,weights:()=>[1],skin:()=>skin},out);
 expect(Array.from(out.slice(0,3)).map(v=>+v.toFixed(6))).toEqual([.2,2.5,0]);expect(Array.from(out.slice(6,9))).toEqual([-.5,.5,0]);expect(Array.from(out.slice(3,6)).map(v=>+v.toFixed(6))).toEqual([1.2,.5,0]);
});
it('finds the nearest two-sided triangle hit',()=>{
 const front=raycastTriangles({x:0,y:0,z:5},{x:0,y:0,z:-1},quad,indices);expect(front.t).toBeCloseTo(5);expect(Math.abs(front.normal[2])).toBeCloseTo(1);
 expect(raycastTriangles({x:0,y:0,z:-5},{x:0,y:0,z:1},quad,indices).t).toBeCloseTo(5);
 expect(raycastTriangles({x:2,y:0,z:5},{x:0,y:0,z:-1},quad,indices).t).toBe(-1);
});
it('picks a real morphed Mesh3D by its deformed shape and follows weight changes',()=>{
 const geometry=new Geometry3D({positions:quad,indices,morphTargets:[{positions:shear}]}),mesh=new Mesh3D({geometry,material:new Material3D(),weights:new Float32Array([1])});
 const volume=DeformedHitVolume.forMesh(mesh)!;expect(volume).not.toBeNull();
 const cast=(x:number,y:number)=>volume.raycast(new Ray(new Vector3(x,y,5),new Vector3(0,0,-1)),createHitResult3D());
 expect(cast(.9,.35)).toBeCloseTo(5);expect(cast(-.4,.35)).toBe(-1);expect(cast(.1,-.3)).toBeCloseTo(5);
 expect(Math.sqrt(volume.boundingRadiusSq)).toBeGreaterThanOrEqual(Math.hypot(1.2,.5)-1e-6);
 mesh.weights![0]=0;expect(cast(.9,.35)).toBe(-1);expect(cast(-.4,.35)).toBeCloseTo(5);
});
it('leaves plain meshes on the built-in pick',()=>{
 expect(DeformedHitVolume.forMesh(new Mesh3D({geometry:new Geometry3D({positions:quad,indices}),material:new Material3D()}))).toBeNull();
});
it('keeps the sphere pre-test conservative and free of CPU deformation',()=>{
 const geometry=new Geometry3D({positions:quad,indices,morphTargets:[{positions:shear}]}),mesh=new Mesh3D({geometry,material:new Material3D(),weights:new Float32Array([1])}),volume=DeformedHitVolume.forMesh(mesh)!;
 for(let i=0;i<50;i++){mesh.weights![0]=i/49;void volume.boundingRadiusSq;}expect(volume.deformations).toBe(0);
 const out=new Float32Array(12);for(const w of [0,.3,1]){mesh.weights![0]=w;deformPositions({positions:quad,indices,morphs:[shear],weights:()=>[w],skin:()=>undefined},out);let r=0;for(let i=0;i<12;i+=3)r=Math.max(r,Math.hypot(out[i],out[i+1],out[i+2]));expect(Math.sqrt(volume.boundingRadiusSq)).toBeGreaterThanOrEqual(r-1e-6);}
 // Skin bound: a joint scaling by 2 and translating by 3 cannot push a point of radius 1 past sqrt(3)*2*1+3.
 expect(conservativeRadius(1,[],undefined,[2,0,0,3, 0,2,0,0, 0,0,2,0])).toBeCloseTo(Math.sqrt(12)+3);
 mesh.weights![0]=1;expect(volume.raycast(new Ray(new Vector3(.9,.35,5),new Vector3(0,0,-1)),createHitResult3D())).toBeCloseTo(5);expect(volume.deformations).toBe(1);
 volume.raycast(new Ray(new Vector3(.1,-.3,5),new Vector3(0,0,-1)),createHitResult3D());expect(volume.deformations).toBe(1);
});
it('attaches to real non-indexed skin and morph GLB meshes (the loader supplies indices)',async()=>{
 for(const kind of ['skin','morph']){const f=(await modelMatrix({kinds:[kind]}))[0],source=await loadGlb.load('data:model/gltf-binary;base64,'+f.bytes.toString('base64'),undefined,new Loader()),model=new Model3D({source,autoUpdate:false}),meshes:Mesh3D[]=[];model.traverse(n=>{if(n instanceof Mesh3D)meshes.push(n);});
  expect(DeformedHitVolume.forMesh(meshes[0]),kind).toBeInstanceOf(DeformedHitVolume);model.destroy();}
});
