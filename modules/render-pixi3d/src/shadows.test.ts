import {expect,it} from 'vitest';
import {Container} from 'pixi.js';
import {DirectionalLight,AmbientLight,Mesh3D} from '@pixi/3d';
import {SceneService,transformDefinition} from '@rewrite/scene';
import {transform3dDefinition,viewport3dDefinition,Viewport3DSchema} from '@rewrite/scene3d';
import {authoring3dDefinitions,Light3DSchema,Primitive3DSchema,lightShadow,light3dDefinition} from './contracts';
import {model3dDefinition,Model3DSchema} from './model-contracts';
import {Authoring3D} from './model';
import {Scene3DProjection} from './projection';
function fixture(){const defs=new Map([transformDefinition,transform3dDefinition,viewport3dDefinition,model3dDefinition,...authoring3dDefinitions].map(d=>[d.type,d])),scene=new SceneService(()=>defs),editor=new Authoring3D(scene,()=>{},()=>null,()=>true,()=>({x:480,y:270})),ids=editor.createView(),host=new Container();return{scene,ids,host,context:{node:(id:string)=>id===ids.viewId?host:undefined,changed(){},report(){}}};}
it('keeps older scenes unshadowed: lights default off, meshes cast and receive, views default to medium PCF',()=>{
 expect(Light3DSchema.parse({kind:'directional',color:'#ffffff',intensity:2}).castShadow).toBe(false);
 expect(Primitive3DSchema.parse({shape:'cube',color:'#ffffff',roughness:.5,metallic:0})).toMatchObject({castShadow:true,receiveShadow:true});
 expect(Model3DSchema.parse({assetId:'a',overrideMaterial:false,color:'#ffffff',roughness:.5,metallic:0})).toMatchObject({castShadow:true,receiveShadow:true});
 expect(Viewport3DSchema.parse({width:640,height:360})).toMatchObject({shadowQuality:'medium',shadowFilter:'pcf'});
 expect(()=>Viewport3DSchema.parse({width:640,height:360,shadowQuality:'huge'})).toThrow();
});
it('applies the light, mesh and view shadow settings to the projected scene',async()=>{
 const f=fixture(),p=new Scene3DProjection(f.context);try{
  const doc=f.scene.document.current,sun=doc.entities.find(e=>e.name==='Sun')!,cube=doc.entities.find(e=>e.name==='Cube')!;
  f.scene.document.transact('Shadow settings',s=>{const light=s.entities.find(e=>e.id===sun.id)!.components.find(c=>c.type==='pixi3d.light')!;(light.data as Record<string,unknown>).castShadow=true;
   const prim=s.entities.find(e=>e.id===cube.id)!.components.find(c=>c.type==='pixi3d.primitive')!;Object.assign(prim.data as object,{castShadow:false,receiveShadow:true});
   const view=s.entities.find(e=>e.id===f.ids.viewId)!.components.find(c=>c.type==='pixi3d.viewport')!;Object.assign(view.data as object,{shadowQuality:'high',shadowFilter:'pcf-high'});});
  p.sync(f.scene.document.current);const slot=p.slots[0];
  expect(slot.view.shadowQuality).toBe('high');expect(slot.view.shadowFilter).toBe('pcf-high');
  const lights:(DirectionalLight|AmbientLight)[]=[];slot.view.root.traverse(n=>{if(n instanceof DirectionalLight||n instanceof AmbientLight)lights.push(n);});
  expect(lights.find(l=>l instanceof DirectionalLight)!.castShadow).toBe(true);
  const mesh=slot.nodes.get(cube.id)!.children.find(c=>c instanceof Mesh3D) as Mesh3D;expect(mesh.castShadow).toBe(false);expect(mesh.receiveShadow).toBe(true);
 }finally{await p.dispose();f.host.destroy();}
});
it('keeps older lights fitted and turns each placement into shadow options',()=>{
 const old=Light3DSchema.parse({kind:'directional',color:'#ffffff',intensity:2,castShadow:true});
 expect(old).toMatchObject({shadowPlacement:'fit',shadowBias:.001,shadowNormalBiasAuto:true,shadowUpdate:1});expect(lightShadow(old)).toEqual({bias:.001,update:1});
 expect(lightShadow({...old,castShadow:false})).toBeUndefined();expect(lightShadow({...old,kind:'ambient'})).toBeUndefined();
 expect(lightShadow({...old,shadowPlacement:'cascades',shadowCascades:4,shadowMaxDistance:80,shadowLambda:.7,shadowNormalBiasAuto:false,shadowNormalBias:.2})).toEqual({bias:.001,update:1,normalBias:.2,cascades:4,maxDistance:80,lambda:.7});
 expect(lightShadow({...old,shadowPlacement:'bounds',shadowBoundsX:1,shadowBoundsY:2,shadowBoundsZ:3,shadowBoundsWidth:4,shadowBoundsHeight:5,shadowBoundsDepth:6})).toMatchObject({bounds:{center:{x:1,y:2,z:3},size:{x:4,y:5,z:6}}});
 expect(()=>Light3DSchema.parse({...old,shadowCascades:5})).toThrow();expect(()=>Light3DSchema.parse({...old,shadowPlacement:'auto'})).toThrow();
 const visible=(data:object)=>light3dDefinition.fields.filter(f=>!f.visible||f.visible(data as never)).map(f=>f.key);
 expect(visible({...old,castShadow:false})).not.toContain('shadowPlacement');expect(visible({...old,shadowPlacement:'cascades'})).toEqual(expect.arrayContaining(['shadowCascades','shadowMaxDistance','shadowLambda']));
 expect(visible({...old,shadowPlacement:'cascades'})).not.toContain('shadowBoundsWidth');expect(visible(old)).not.toContain('shadowNormalBias');
});
it('builds directional lights with cascades, a fixed box and manual biases',async()=>{
 const f=fixture(),p=new Scene3DProjection(f.context);try{
  const sun=f.scene.document.current.entities.find(e=>e.name==='Sun')!;
  const set=(data:object)=>f.scene.document.transact('Shadow',s=>{Object.assign(s.entities.find(e=>e.id===sun.id)!.components.find(c=>c.type==='pixi3d.light')!.data as object,{castShadow:true,...data});});
  const light=()=>{const l:DirectionalLight[]=[];p.slots[0].view.root.traverse(n=>{if(n instanceof DirectionalLight)l.push(n);});return l[0];};
  set({shadowPlacement:'cascades',shadowCascades:2,shadowMaxDistance:30,shadowLambda:.8,shadowBias:.004,shadowUpdate:3});p.sync(f.scene.document.current);
  expect(light().shadow).toMatchObject({cascades:2,maxDistance:30,lambda:.8,bias:.004,update:3});expect(light().shadow.bounds).toBeUndefined();
  set({shadowPlacement:'bounds',shadowBoundsX:2,shadowBoundsWidth:10,shadowBoundsHeight:4,shadowBoundsDepth:6,shadowNormalBiasAuto:false,shadowNormalBias:.3});p.sync(f.scene.document.current);
  const s=light().shadow;expect(s.cascades).toBeUndefined();expect(s.normalBias).toBeCloseTo(.3,6);expect([s.bounds!.min.x,s.bounds!.max.x,s.bounds!.min.y,s.bounds!.max.z]).toEqual([-3,7,-2,3]);
  set({shadowPlacement:'fit',shadowNormalBiasAuto:true});p.sync(f.scene.document.current);expect(light().shadow.bounds).toBeUndefined();expect(light().shadow.cascades).toBeUndefined();expect(light().shadow.normalBias).toBeUndefined();
 }finally{await p.dispose();f.host.destroy();}
});
