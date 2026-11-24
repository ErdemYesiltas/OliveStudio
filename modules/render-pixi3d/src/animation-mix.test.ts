import {it,expect} from 'vitest';
import {Loader} from 'pixi.js';
import {loadGlb,Model3D,Mesh3D} from '@pixi/3d';
import {identity3D} from '@rewrite/scene3d';
import type {Entity} from '@rewrite/scene';
import {ModelAnimations,mixParts} from './animation';
import {modelAnimationType,ModelAnimationSchema} from './animation-contracts';
import {axisToZ,BoneAimSchema} from './rig';
/** A cube with two one-second clips on the same channel: Left takes x from 0 to −2, Right from 0 to +2. */
async function model(){const {Document,NodeIO}=await import('@gltf-transform/core'),doc=new Document(),buffer=doc.createBuffer();
 const acc=(type:'VEC3'|'SCALAR',values:number[])=>doc.createAccessor().setType(type).setArray(new Float32Array(values)).setBuffer(buffer);
 const prim=doc.createPrimitive().setAttribute('POSITION',acc('VEC3',[0,0,0,1,0,0,0,1,0])).setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint16Array([0,1,2])).setBuffer(buffer));
 const node=doc.createNode('Box').setMesh(doc.createMesh('Box').addPrimitive(prim));doc.createScene('Scene').addChild(node);
 for(const [name,to] of [['Left',-2],['Right',2]] as const){const sampler=doc.createAnimationSampler().setInput(acc('SCALAR',[0,1])).setOutput(acc('VEC3',[0,0,0,to,0,0])).setInterpolation('LINEAR');
  doc.createAnimation(name).addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath('translation').setSampler(sampler));}
 const bytes=await new NodeIO().writeBinary(doc),source=await loadGlb.load('data:model/gltf-binary;base64,'+Buffer.from(bytes).toString('base64'),undefined,new Loader());return new Model3D({source,autoUpdate:false});}
const asset={id:'asset',name:'Mix',type:'pixi3d.model',revision:'b'.repeat(64),source:{extension:'glb',bytes:1},metadata:{pipeline:'gltf-transform-4.5.1/glb-v1',nodes:1,meshes:1,triangles:1,vertices:3,materials:[],animations:[{name:'Left',duration:1},{name:'Right',duration:1}],bounds:{min:[0,0,0],max:[1,1,0]},warnings:[]}};
const entity=(clip:object):Entity=>({id:'e',name:'Mixer',active:true,parentId:null,spatial:'scene3d.transform',components:[{id:'pose',type:'scene3d.transform',version:1,data:identity3D()},{id:'model',type:'pixi3d.modelRenderer',version:1,data:{assetId:'asset',overrideMaterial:false,color:'#ffffff',roughness:.5,metallic:0}},{id:'clip',type:modelAnimationType,version:1,data:{clip:'Left',loop:true,speed:1,autoplay:true,...clip}}]});
const boxX=(m:Model3D)=>{let x=NaN;m.traverse(n=>{if(n.label==='Box')x=n.position.x;});return x;};
it('keeps older clips unblended and weighs the parts of a mix',()=>{
 expect(ModelAnimationSchema.parse({clip:'A',loop:true,speed:1,autoplay:true})).toMatchObject({blendClip:'',blendWeight:.5,fadeDuration:.3,startOffset:0});
 const base={time:.2,blendTime:.4,config:{blendWeight:.25}};
 expect(mixParts(base,'A')).toEqual([{label:'A',time:.2,weight:1}]);
 expect(mixParts({...base,blendLabel:'B'},'A')).toEqual([{label:'A',time:.2,weight:.75},{label:'B',time:.4,weight:.25}]);
 expect(mixParts({...base,blendLabel:'B',config:{blendWeight:1}},'A')).toEqual([{label:'B',time:.4,weight:1}]);
 expect(mixParts({...base,fade:{label:'Old',time:.9,left:.3,total:1}},'A')).toEqual([{label:'A',time:.2,weight:expect.closeTo(.7,9)},{label:'Old',time:.9,weight:expect.closeTo(.3,9)}]);
});
it('blends two clips on one channel by weight, starts at an offset and crossfades a swapped clip',async()=>{
 const m=await model(),animation=new ModelAnimations(()=>m.player??undefined,()=>asset as never);try{
  animation.reset([entity({blendClip:'Right',blendWeight:.25})]);animation.advanceTo(.5);
  // 0.75 of Left at 0.5 s (x −1) and 0.25 of Right at 0.5 s (x +1).
  expect(boxX(m)).toBeCloseTo(-.5,5);
  animation.reset([entity({startOffset:.25})]);expect(boxX(m)).toBeCloseTo(-.5,5);animation.advanceTo(.25);expect(boxX(m)).toBeCloseTo(-1,5);
  animation.reset([entity({})]);animation.advanceTo(.5);expect(boxX(m)).toBeCloseTo(-1,5);
  // Swap to Right while Left plays: over a 1 s fade the old clip hands over its weight.
  animation.sync([entity({clip:'Right',fadeDuration:1})]);animation.advanceTo(.75);
  // Right at 0.25 s (x +0.5) with 0.25 of the weight; Left at 0.75 s (x −1.5) with 0.75.
  expect(boxX(m)).toBeCloseTo(.25*.5+.75*-1.5,5);
  animation.advanceTo(1.6);expect(boxX(m)).toBeCloseTo(2*(1.1%1),4);
  expect(m.traverse).toBeDefined();expect(Mesh3D).toBeDefined();
 }finally{animation.clear();m.destroy({children:true});}
});
it('maps each bone axis onto +Z for aiming',()=>{
 const rotate=([x,y,z,w]:number[],v:number[])=>{const ix=w*v[0]+y*v[2]-z*v[1],iy=w*v[1]+z*v[0]-x*v[2],iz=w*v[2]+x*v[1]-y*v[0],iw=-x*v[0]-y*v[1]-z*v[2];return[ix*w+iw*-x+iy*-z-iz*-y,iy*w+iw*-y+iz*-x-ix*-z,iz*w+iw*-z+ix*-y-iy*-x];};
 const axes={'+Z':[0,0,1],'-Z':[0,0,-1],'+Y':[0,1,0],'-Y':[0,-1,0],'+X':[1,0,0],'-X':[-1,0,0]} as const;
 // R takes the axis to +Z, so R applied to +Z… here we check R⁻¹ is not needed: rotating the axis by R gives +Z.
 for(const [axis,v] of Object.entries(axes)){const out=rotate(axisToZ(axis as keyof typeof axes),[...v]);out.forEach((c,i)=>expect(c).toBeCloseTo([0,0,1][i],9));}
 expect(BoneAimSchema.parse({})).toEqual({bone:'',targetId:'',axis:'+Z',weight:1});
});
it('aims a bone along its axis at a world point, in its parent\'s space, blended by weight',async()=>{
 const {Skeleton,Matrix4,Vector3,Quaternion}=await import('@pixi/3d'),{aimBone}=await import('./projection');
 const ibm=new Float32Array(32);const skeleton=new Skeleton({parent:new Int16Array([-1,0]),joints:new Int16Array([0,1]),inverseBindMatrices:ibm,labels:['Root','Tip']});
 skeleton.localPosition.set([0,0,0,0,1,0]);skeleton.localRotation.set([0,0,0,1,0,0,0,1]);skeleton.localScale.fill(1);
 // The root turned 90° about Y: the tip's +Y must still reach a target at world (+1, 1, 0) though its parent's frame is turned.
 const h=Math.SQRT1_2;skeleton.localRotation.set([0,h,0,h],0);const world=new Matrix4();
 aimBone(skeleton,1,world,{x:1,y:1,z:0},{bone:'Tip',targetId:'t',axis:'+Y',weight:1});
 const tip=new Quaternion(...skeleton.localRotation.slice(4,8) as unknown as [number,number,number,number]),root=new Quaternion(0,h,0,h);
 const dir=new Vector3(0,1,0).applyQuaternion(tip).applyQuaternion(root);expect(dir.x).toBeCloseTo(1,6);expect(dir.y).toBeCloseTo(0,6);expect(dir.z).toBeCloseTo(0,6);expect(skeleton.dirty).toBe(true);
 skeleton.localRotation.set([0,0,0,1],4);aimBone(skeleton,1,world,{x:1,y:1,z:0},{bone:'Tip',targetId:'t',axis:'+Y',weight:.5});
 const half=new Vector3(0,1,0).applyQuaternion(new Quaternion(...skeleton.localRotation.slice(4,8) as unknown as [number,number,number,number])).applyQuaternion(root);
 expect(Math.atan2(half.x,half.y)*180/Math.PI).toBeCloseTo(45,4);
});
