import {expect,it} from 'vitest';
import {Container} from 'pixi.js';
import {PointLight,SpotLight,type Light} from '@pixi/3d';
import {SceneService,transformDefinition,parseScene} from '@rewrite/scene';
import {transform3dDefinition,viewport3dDefinition,transform3D} from '@rewrite/scene3d';
import {authoring3dDefinitions,Light3DSchema,lightShadow,light3dDefinition} from './contracts';
import {model3dDefinition} from './model-contracts';
import {Authoring3D} from './model';
import {Scene3DProjection} from './projection';
import {runtime3DProblems} from './preflight';
const defs=()=>new Map([transformDefinition,transform3dDefinition,viewport3dDefinition,model3dDefinition,...authoring3dDefinitions].map(d=>[d.type,d]));
function fixture(){const scene=new SceneService(defs),editor=new Authoring3D(scene,()=>{},()=>null,()=>true,()=>({x:480,y:270})),ids=editor.createView(),host=new Container(),errors:unknown[]=[];return{scene,editor,ids,host,errors,context:{node:(id:string)=>id===ids.viewId?host:undefined,changed(){},report(e:unknown){errors.push(e);}}};}
const lightData=(f:ReturnType<typeof fixture>,id:string)=>f.scene.document.current.entities.find(e=>e.id===id)!.components.find(c=>c.type==='pixi3d.light')!;
it('accepts point and spot lights and keeps older lights valid',()=>{
 const old=Light3DSchema.parse({kind:'directional',color:'#ffffff',intensity:2});expect(old).toMatchObject({range:10,radius:.1,coneAngle:30,penumbra:.2});
 const spot=Light3DSchema.parse({kind:'spot',color:'#ffffff',intensity:20,castShadow:true,shadowPlacement:'cascades',shadowBias:.003});
 expect(lightShadow(spot)).toEqual({bias:.003,update:1});expect(lightShadow({...spot,kind:'point'})).toBeUndefined();
 expect(()=>Light3DSchema.parse({...spot,coneAngle:120})).toThrow();expect(()=>Light3DSchema.parse({...spot,kind:'area'})).toThrow();
 const visible=(data:object)=>light3dDefinition.fields.filter(f=>!f.visible||f.visible(data as never)).map(f=>f.key);
 expect(visible({...spot,kind:'point'})).toEqual(expect.arrayContaining(['range','radius']));expect(visible({...spot,kind:'point'})).not.toContain('castShadow');expect(visible({...spot,kind:'point'})).not.toContain('coneAngle');
 expect(visible(spot)).toEqual(expect.arrayContaining(['coneAngle','penumbra','castShadow','shadowBias']));expect(visible(spot)).not.toContain('shadowPlacement');
 expect(visible(old)).not.toContain('range');
});
it('creates a point light above and a spot light aimed down, and projects both',async()=>{
 const f=fixture(),p=new Scene3DProjection(f.context);try{
  const point=f.editor.create('point',f.ids.viewId).id,spot=f.editor.create('spot',f.ids.viewId).id;
  expect(lightData(f,point).data).toMatchObject({kind:'point'});expect(lightData(f,spot).data).toMatchObject({kind:'spot'});
  const pose=transform3D(f.scene.document.current.entities.find(e=>e.id===spot)!);expect(pose.y).toBe(3);expect(pose.qx).toBeCloseTo(-Math.SQRT1_2,6);expect(pose.qw).toBeCloseTo(Math.SQRT1_2,6);
  f.scene.document.transact('Tune',s=>{Object.assign(s.entities.find(e=>e.id===spot)!.components.find(c=>c.type==='pixi3d.light')!.data as object,{range:12,radius:.4,coneAngle:25,penumbra:.5,intensity:40,castShadow:true,shadowBias:.002});
   Object.assign(s.entities.find(e=>e.id===point)!.components.find(c=>c.type==='pixi3d.light')!.data as object,{range:0,radius:.6,castShadow:true});});
  p.sync(f.scene.document.current);const lights:Light[]=[];p.slots[0].view.root.traverse(n=>{if(n instanceof PointLight||n instanceof SpotLight)lights.push(n);});
  const pl=lights.find(l=>l instanceof PointLight) as PointLight,sl=lights.find(l=>l instanceof SpotLight) as SpotLight;
  expect({range:pl.range,radius:pl.radius}).toEqual({range:0,radius:.6});expect(pl.castShadow).toBe(false);
  expect({range:sl.range,coneAngle:sl.coneAngle,penumbra:sl.penumbra,intensity:sl.intensity,cast:sl.castShadow}).toMatchObject({range:12,penumbra:.5,intensity:40,cast:true});expect(sl.coneAngle).toBeCloseTo(25,4);expect(sl.radius).toBeCloseTo(.4,6);expect(sl.shadow.bias).toBeCloseTo(.002,6);
  expect(runtime3DProblems(parseScene(f.scene.document.current,defs()))).toEqual([]);expect(f.errors).toEqual([]);
 }finally{await p.dispose();f.host.destroy();}
});
it('commits a gizmo edit as one undo and refuses data that changed meanwhile',()=>{
 const f=fixture(),spot=f.editor.create('spot',f.ids.viewId).id,before=lightData(f,spot).data,rev=f.scene.document.current;
 f.editor.setComponentData(spot,'pixi3d.light',{...(before as object),range:7.5},before);expect(lightData(f,spot).data).toMatchObject({range:7.5});
 expect(()=>f.editor.setComponentData(spot,'pixi3d.light',{...(before as object),range:3},before)).toThrow(/changed/);
 expect(()=>f.editor.setComponentData(spot,'pixi3d.light',{...(lightData(f,spot).data as object),coneAngle:120},lightData(f,spot).data)).toThrow();
 f.scene.document.undo();expect(lightData(f,spot).data).toEqual(before);expect(rev).toBeDefined();
});
