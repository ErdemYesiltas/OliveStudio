import {expect,it} from 'vitest';
import {Container} from 'pixi.js';
import {Material3D,Mesh3D} from '@pixi/3d';
import {BloomEffect,SsaoEffect,TiltShiftEffect,TintEffect,FxaaEffect,MotionBlurEffect} from '@pixi/3d/extras';
import {Camera3D} from '@pixi/3d';
import {vi} from 'vitest';
import {SceneService,transformDefinition} from '@rewrite/scene';
import {transform3dDefinition,viewport3dDefinition,Viewport3DSchema} from '@rewrite/scene3d';
import {authoring3dDefinitions,Primitive3DSchema} from './contracts';
import {model3dDefinition} from './model-contracts';
import {Authoring3D} from './model';
import {Scene3DProjection} from './projection';
function fixture(){const defs=new Map([transformDefinition,transform3dDefinition,viewport3dDefinition,model3dDefinition,...authoring3dDefinitions].map(d=>[d.type,d])),scene=new SceneService(()=>defs),editor=new Authoring3D(scene,()=>{},()=>null,()=>true,()=>({x:480,y:270})),ids=editor.createView(),host=new Container(),errors:unknown[]=[];return{scene,ids,host,errors,context:{node:(id:string)=>id===ids.viewId?host:undefined,changed(){},report(e:unknown){errors.push(e);}}};}
function edit(f:ReturnType<typeof fixture>,view:object,cube?:object){const doc=f.scene.document.current,cubeId=doc.entities.find(e=>e.name==='Cube')!.id;
 f.scene.document.transact('Post settings',s=>{Object.assign(s.entities.find(e=>e.id===f.ids.viewId)!.components.find(c=>c.type==='pixi3d.viewport')!.data as object,view);
  if(cube)Object.assign(s.entities.find(e=>e.id===cubeId)!.components.find(c=>c.type==='pixi3d.primitive')!.data as object,cube);});return cubeId;}
it('keeps older scenes clear: no fog, no bloom, no glow',()=>{
 expect(Viewport3DSchema.parse({width:640,height:360})).toMatchObject({fog:'none',bloom:false,bloomThreshold:1});
 expect(Primitive3DSchema.parse({shape:'cube',color:'#ffffff',roughness:.5,metallic:0})).toMatchObject({emissiveColor:'#000000',emissiveStrength:0});
 expect(()=>Viewport3DSchema.parse({width:640,height:360,fog:'linear',fogNear:40,fogFar:20})).toThrow(/far/);
 expect(()=>Viewport3DSchema.parse({width:640,height:360,fog:'smoke'})).toThrow();
});
it('applies each fog curve to the view',async()=>{
 const f=fixture(),p=new Scene3DProjection(f.context);try{
  p.sync(f.scene.document.current);expect(p.slots[0].view.fog).toBeNull();
  edit(f,{fog:'linear',fogColor:'#336699',fogNear:5,fogFar:25});p.sync(f.scene.document.current);
  expect(p.slots[0].view.fog).toMatchObject({type:'linear',color:0x336699,near:5,far:25});
  edit(f,{fog:'exp2',fogDensity:.08});p.sync(f.scene.document.current);
  expect(p.slots[0].view.fog).toMatchObject({type:'exp2',density:.08});
 }finally{await p.dispose();f.host.destroy();}
});
it('adds bloom as a view pass and lets an emissive cube glow',async()=>{
 const f=fixture(),p=new Scene3DProjection(f.context);try{
  p.sync(f.scene.document.current);expect(p.slots[0].view.passes.some(x=>x instanceof BloomEffect)).toBe(false);
  const cubeId=edit(f,{bloom:true,bloomThreshold:.75,bloomIntensity:1.5,bloomRadius:.5},{emissiveColor:'#ff8800',emissiveStrength:6});p.sync(f.scene.document.current);
  const bloom=p.slots[0].view.passes.find(x=>x instanceof BloomEffect) as BloomEffect;expect(bloom).toBeDefined();
  expect({threshold:bloom.threshold,intensity:bloom.intensity,radius:bloom.radius}).toEqual({threshold:.75,intensity:1.5,radius:.5});
  const material=(p.slots[0].nodes.get(cubeId)!.children.find(c=>c instanceof Mesh3D) as Mesh3D).material as Material3D;
  expect(material.emissive?.strength).toBe(6);expect(material.emissive?.color).toBe(0xff8800);
  expect(f.errors).toEqual([]);
 }finally{await p.dispose();f.host.destroy();}
});
it('keeps older views without the other post effects and refuses an inverted focus band',()=>{
 expect(Viewport3DSchema.parse({width:640,height:360})).toMatchObject({ssao:false,depthOfField:false,tint:'#ffffff',antialias:false,motionBlur:false,motionBlurIntensity:.5,motionBlurSamples:12,motionBlurMaxLength:48});
 expect(()=>Viewport3DSchema.parse({width:640,height:360,motionBlurSamples:1})).toThrow();
 expect(()=>Viewport3DSchema.parse({width:640,height:360,depthOfField:true,focusRange:9,focusFalloff:4})).toThrow(/falloff/);
 expect(Viewport3DSchema.parse({width:640,height:360,depthOfField:false,focusRange:9,focusFalloff:4}).focusRange).toBe(9);
});
it('builds SSAO, bloom, tilt-shift, tint and FXAA in that order with their settings',async()=>{
 const f=fixture(),p=new Scene3DProjection(f.context);try{
  edit(f,{ssao:true,ssaoRadius:.75,ssaoIntensity:1.5,bloom:true,motionBlur:true,motionBlurIntensity:1,motionBlurSamples:8,motionBlurMaxLength:24,depthOfField:true,focusDistance:12,focusRange:1.5,focusFalloff:6,focusBlur:16,tint:'#ffcc88',antialias:true});p.sync(f.scene.document.current);
  const passes=p.slots[0].view.passes;expect(passes.map(x=>x.constructor)).toEqual([SsaoEffect,BloomEffect,MotionBlurEffect,TiltShiftEffect,TintEffect,FxaaEffect]);
  const tilt=passes[3] as TiltShiftEffect;expect({focalDepth:tilt.focalDepth,focalNear:tilt.focalNear,focalFar:tilt.focalFar,maxBlur:tilt.maxBlur}).toEqual({focalDepth:12,focalNear:1.5,focalFar:6,maxBlur:16});
  const ssao=passes[0] as SsaoEffect;expect(ssao.radius).toBeCloseTo(.75,6);expect(ssao.intensity).toBeCloseTo(1.5,6);
  expect(p.slots[0].resources.filter(r=>passes.includes(r as never))).toHaveLength(6);
  edit(f,{ssao:false,bloom:false,motionBlur:false,depthOfField:false,tint:'#FFFFFF',antialias:false});p.sync(f.scene.document.current);expect(p.slots[0].view.passes).toEqual([]);
  expect(f.errors).toEqual([]);
 }finally{await p.dispose();f.host.destroy();}
});
it('starts motion blur fresh when the view switches to its scene camera',async()=>{
 const f=fixture(),p=new Scene3DProjection(f.context);try{
  p.sync(f.scene.document.current);const camera=[...p.slots[0].cameras.values()][0] as Camera3D,reset=vi.spyOn(camera,'resetHistory');
  p.useSceneCameras();expect(p.slots[0].view.camera).toBe(camera);expect(reset).toHaveBeenCalledTimes(1);p.useSceneCameras();expect(reset).toHaveBeenCalledTimes(1);
 }finally{await p.dispose();f.host.destroy();}
});
