import {afterEach,expect,it,vi} from 'vitest';
import {Container} from 'pixi.js';
import {Mesh3D} from '@pixi/3d';
import {OutlinePass} from '@pixi/3d/extras';
import {SceneService,transformDefinition} from '@rewrite/scene';
import {transform3dDefinition,viewport3dDefinition} from '@rewrite/scene3d';
import {authoring3dDefinitions} from './contracts';
import {model3dDefinition} from './model-contracts';
import {Authoring3D} from './model';
import {Scene3DProjection} from './projection';
import {runtime3DProblems} from './preflight';
import {worldBox,highlight3dActions,outline3dType,wireframeOverlayType,boundsHelperType} from './debug3d';
const defs=()=>new Map([transformDefinition,transform3dDefinition,viewport3dDefinition,model3dDefinition,...authoring3dDefinitions].map(d=>[d.type,d]));
function fixture(){const scene=new SceneService(defs),editor=new Authoring3D(scene,()=>{},()=>null,()=>true,()=>({x:480,y:270})),ids=editor.createView(),host=new Container(),errors:unknown[]=[];
 return{scene,editor,ids,host,errors,context:{node:(id:string)=>id===ids.viewId?host:undefined,changed(){},report(e:unknown){errors.push(e);}}};}
const cube=(f:ReturnType<typeof fixture>)=>f.scene.document.current.entities.find(e=>e.name==='Cube')!;
const add=(f:ReturnType<typeof fixture>,type:string,data:Record<string,string|boolean>)=>f.scene.document.transact('Add',s=>{s.entities.find(e=>e.name==='Cube')!.components.push({id:type,type,version:1,data});});
const set=(f:ReturnType<typeof fixture>,type:string,data:object)=>f.scene.document.transact('Set',s=>{Object.assign(s.entities.find(e=>e.name==='Cube')!.components.find(c=>c.type===type)!.data as object,data);});
afterEach(()=>vi.restoreAllMocks());
it('measures the world box of a turned and moved local box',()=>{
 const c=Math.SQRT1_2,turn=[c,0,-c,0,0,1,0,0,c,0,c,0,2,0,0,1],b=worldBox({x:-.5,y:-.5,z:-.5},{x:.5,y:.5,z:.5},turn);
 expect(b.max.x-b.min.x).toBeCloseTo(Math.SQRT2,6);expect(b.max.y-b.min.y).toBeCloseTo(1,6);expect((b.min.x+b.max.x)/2).toBeCloseTo(2,6);
});
it('switches an add-on through runtime data and lists every add-on as a target',()=>{
 const action=highlight3dActions[0],setData=vi.fn();action.execute({id:'a',type:action.type,targetId:'outline-1',value:false},{silent:false,setData} as never);expect(setData).toHaveBeenCalledWith('outline-1',{enabled:false});
 const refs=action.references({entities:[{id:'e',name:'Crate',components:[{id:'o',type:outline3dType,version:1,data:{}},{id:'w',type:wireframeOverlayType,version:1,data:{}},{id:'b',type:boundsHelperType,version:1,data:{}},{id:'p',type:'pixi3d.primitive',version:1,data:{}}]}]} as never);
 expect(refs.map(r=>r.name)).toEqual(['Crate · outline','Crate · wireframe','Crate · bounds']);
});
it('outlines a primitive through its mesh and turns it off without a rebuild',async()=>{
 const enable=vi.spyOn(Mesh3D.prototype,'enablePass'),disable=vi.spyOn(Mesh3D.prototype,'disablePass');
 const f=fixture(),p=new Scene3DProjection(f.context);try{add(f,outline3dType,{enabled:true});p.sync(f.scene.document.current);
  expect(p.slots[0].view.passes.some(x=>x instanceof OutlinePass)).toBe(true);const mesh=p.slots[0].nodes.get(cube(f).id)!.children.find(c=>c instanceof Mesh3D);
  expect(enable.mock.contexts).toContain(mesh);expect(enable).toHaveBeenCalledWith('outline');
  const before=p.diagnostics().rebuilds;set(f,outline3dType,{enabled:false});p.sync(f.scene.document.current);p.setParticleTime(.1);
  expect(p.diagnostics().rebuilds).toBe(before);expect(disable).toHaveBeenCalledWith('outline');expect(disable.mock.contexts).toContain(mesh);
  enable.mockClear();p.setParticleTime(.2);expect(enable).not.toHaveBeenCalled();
  expect(f.errors).toEqual([]);
 }finally{await p.dispose();f.host.destroy();}
});
it('keeps a toon surface\'s own ink when its outline add-on is switched off',async()=>{
 const disable=vi.spyOn(Mesh3D.prototype,'disablePass');
 const f=fixture(),p=new Scene3DProjection(f.context);try{f.scene.document.transact('Toon',s=>{Object.assign(s.entities.find(e=>e.name==='Cube')!.components.find(c=>c.type==='pixi3d.primitive')!.data as object,{material:'toon',toonOutline:true});});add(f,outline3dType,{enabled:false});
  p.sync(f.scene.document.current);p.setParticleTime(.1);expect(disable).not.toHaveBeenCalledWith('outline');
 }finally{await p.dispose();f.host.destroy();}
});
it('draws exact edges over a primitive and a box that follows its world extent',async()=>{
 const f=fixture(),p=new Scene3DProjection(f.context);try{add(f,wireframeOverlayType,{enabled:true,color:'#ff00ff'});add(f,boundsHelperType,{enabled:true,color:'#ffff00'});
  f.scene.document.transact('Move',s=>{Object.assign(s.entities.find(e=>e.name==='Cube')!.components.find(c=>c.type==='scene3d.transform')!.data as object,{x:3,scaleX:2});});
  p.sync(f.scene.document.current);p.setParticleTime(0);const node=p.slots[0].nodes.get(cube(f).id)!,overlay=node.children.find(c=>c.label==='wireframe-overlay') as Mesh3D,box=p.slots[0].view.root.children.find(c=>c.label==='bounds-box') as Mesh3D;
  expect(overlay.visible).toBe(true);expect(overlay.geometry.topology).toBe('line-list');expect(overlay.eventMode).toBe('none');
  expect(box.visible).toBe(true);expect(box.position.x).toBeCloseTo(3,3);expect(box.scale.x).toBeCloseTo(2*1.02+.01,1);expect(box.scale.x).toBeGreaterThan(2.04);expect(box.scale.y).toBeCloseTo(1.03,1);
  set(f,wireframeOverlayType,{enabled:false});set(f,boundsHelperType,{enabled:false});p.sync(f.scene.document.current);p.setParticleTime(.1);expect([overlay.visible,box.visible]).toEqual([false,false]);
  expect(f.errors).toEqual([]);
 }finally{await p.dispose();f.host.destroy();}
});
it('rejects an add-on with nothing to draw',()=>{
 const f=fixture();f.scene.document.transact('Lone',s=>{s.entities.find(e=>e.name==='Sun')!.components.push({id:'o',type:outline3dType,version:1,data:{enabled:true}});});
 expect(runtime3DProblems(f.scene.document.current).join()).toContain('need a primitive or a model');
});
