import {expect,it} from 'vitest';
import {Container} from 'pixi.js';
import {Container3D,Mesh3D} from '@pixi/3d';
import {SceneService,transformDefinition,type Entity} from '@rewrite/scene';
import {transform3dDefinition,viewport3dDefinition} from '@rewrite/scene3d';
import {authoring3dDefinitions} from './contracts';
import {model3dDefinition} from './model-contracts';
import {Authoring3D} from './model';
import {Scene3DProjection} from './projection';
import {runtime3DProblems} from './preflight';
import {withEuler} from './math';
import {DecalsSchema,PaintableSchema,decalLook,hoverChanges,strokeDabs,boxAtlasUvs,paint3dActions,decalsType,attachType,paintableType} from './place3d';
it('picks each decal\'s look from the seed and lists hover changes like pointerenter',()=>{
 const d=DecalsSchema.parse({size:1,sizeRandom:.5,color:'#000000',color2:'#ffffff'}),a=decalLook(d,3);expect(decalLook(d,3)).toEqual(a);expect(decalLook(d,4)).not.toEqual(a);
 for(let i=0;i<50;i++){const l=decalLook(d,i);expect(l.size).toBeGreaterThanOrEqual(.5);expect(l.size).toBeLessThanOrEqual(1);expect(l.color).toBeGreaterThanOrEqual(0);expect(l.color).toBeLessThanOrEqual(0xffffff);}
 expect(hoverChanges(['child','group'],['sibling','group'])).toEqual({leave:['child'],enter:['sibling']});
 expect(hoverChanges([],['child','group','world'])).toEqual({leave:[],enter:['world','group','child']});
 expect(hoverChanges(['child','group'],[])).toEqual({leave:['child','group'],enter:[]});
});
const defs=()=>new Map([transformDefinition,transform3dDefinition,viewport3dDefinition,model3dDefinition,...authoring3dDefinitions].map(d=>[d.type,d]));
function fixture(){const scene=new SceneService(defs),editor=new Authoring3D(scene,()=>{},()=>null,()=>true,()=>({x:480,y:270})),ids=editor.createView(),host=new Container(),errors:unknown[]=[],moves:{id:string;p:Record<string,number>}[]=[],events:string[]=[];
 scene.document.transact('Camera',s=>{const camera=s.entities.find(e=>e.name==='Camera')!.components.find(c=>c.type==='scene3d.transform')!;camera.data={...withEuler(camera.data as never,{x:-35,y:0,z:0}),y:4,z:6};});
 return{scene,editor,ids,host,errors,moves,events,context:{node:(id:string)=>id===ids.viewId?host:undefined,changed(){},report(e:unknown){errors.push(e);},moved(id:string,p:Record<string,number>){moves.push({id,p:{...p}});},emit(type:string,id:string){events.push(`${type.replace('pixi3d.pointer','')}:${id}`);}}};}
const refresh=(n:Container3D):void=>{n.getGlobalTransform(n.worldTransform);(n as unknown as {_worldTransformId:number})._worldTransformId++;for(const c of n.children)if(c instanceof Container3D)refresh(c);};
const cubeId=(f:ReturnType<typeof fixture>)=>f.scene.document.current.entities.find(e=>e.name==='Cube')!.id;
function add(f:ReturnType<typeof fixture>,entity:Partial<Entity>&{id:string;name:string},parentOfCube?:boolean){f.scene.document.transact('Add',s=>{const view=s.entities.find(e=>e.components.some(c=>c.type==='pixi3d.viewport'))!;s.entities.push({parentId:view.id,active:true,spatial:'scene3d.transform',components:[{id:entity.id+'-t',type:'scene3d.transform',version:1,data:{x:0,y:0,z:0,qx:0,qy:0,qz:0,qw:1,scaleX:1,scaleY:1,scaleZ:1}}],...entity} as Entity);if(parentOfCube)s.entities.find(e=>e.name==='Cube')!.parentId=entity.id;});}
const send=(p:Scene3DProjection,type:string,g:{x:number;y:number})=>{const view=p.slots[0].view;refresh(view.camera);for(const n of p.slots[0].nodes.values())refresh(n);view.emit(type as never,{global:g,stopPropagation(){}} as never);};
it('enters the groups an object sits in and leaves them innermost first',async()=>{
 const f=fixture();add(f,{id:'group',name:'Group'},true);const p=new Scene3DProjection(f.context);try{p.sync(f.scene.document.current);p.useSceneCameras();const at=p.slots[0].view.worldToScreen({x:0,y:0,z:0})!,id=cubeId(f);
  send(p,'globalpointermove',at);expect(f.events).toEqual(['Enter:group',`Enter:${id}`]);send(p,'globalpointermove',{x:2,y:2});expect(f.events.slice(2)).toEqual([`Leave:${id}`,'Leave:group']);
 }finally{await p.dispose();f.host.destroy();}
});
it('stamps decals on the clicked object, never on a drag, keeps the newest and clears them for the next Play',async()=>{
 const f=fixture();add(f,{id:'stamper',name:'Stamper',components:[{id:'stamper-t',type:'scene3d.transform',version:1,data:{x:0,y:0,z:0,qx:0,qy:0,qz:0,qw:1,scaleX:1,scaleY:1,scaleZ:1}},{id:'d',type:decalsType,version:1,data:{max:2,size:.3}}]});
 const p=new Scene3DProjection(f.context);try{p.sync(f.scene.document.current);const view=()=>p.slots[0].view,cube=()=>p.slots[0].nodes.get(cubeId(f))!,decals=()=>(cube().children.find(c=>c.label==='decal-space')?.children??[]).filter(c=>c.label==='decal') as Mesh3D[];
  const at=view().worldToScreen({x:0,y:.5,z:0})!;send(p,'pointerdown',at);send(p,'pointerup',at);expect(decals()).toHaveLength(0);
  p.useSceneCameras();send(p,'pointerdown',at);send(p,'pointerup',{x:at.x+20,y:at.y});expect(decals()).toHaveLength(0);
  for(let k=0;k<3;k++){send(p,'pointerdown',at);send(p,'pointerup',at);}const ds=decals();expect(ds).toHaveLength(2);expect(ds[0].eventMode).toBe('none');
  refresh(cube());const w=ds[0].getGlobalPosition();expect(ds[0].scale.x).toBeCloseTo(ds[0].scale.y,6);expect(w.y).toBeCloseTo(.51,2);expect(Math.abs(w.x)).toBeLessThan(.1);
  p.resetPointers();expect(decals()).toHaveLength(0);expect(f.errors).toEqual([]);
 }finally{await p.dispose();f.host.destroy();}
});
it('rides on its target from the hold it had when switched on and stays put when switched off',async()=>{
 const f=fixture(),id=cubeId(f);add(f,{id:'rider',name:'Rider'});f.scene.document.transact('Attach',s=>{const r=s.entities.find(e=>e.id==='rider')!;Object.assign(r.components[0].data as object,{x:2,y:1});r.components.push({id:'a',type:attachType,version:1,data:{targetId:id,enabled:true}});});
 const p=new Scene3DProjection(f.context);try{p.sync(f.scene.document.current);const rider=()=>p.slots[0].nodes.get('rider')!,cube=()=>p.slots[0].nodes.get(id)!;
  p.setParticleTime(0);expect(rider().x).toBe(2);p.useSceneCameras();p.setParticleTime(.1);
  cube().position.set(1,0,0);cube().quaternion.set(0,Math.SQRT1_2,0,Math.SQRT1_2);p.setParticleTime(.2);expect(rider().x).toBeCloseTo(1,4);expect(rider().y).toBeCloseTo(1,4);expect(rider().z).toBeCloseTo(-2,4);expect(f.moves.at(-1)!.id).toBe('rider');
  f.scene.document.transact('Off',s=>{(s.entities.find(e=>e.id==='rider')!.components.find(c=>c.type===attachType)!.data as {enabled:boolean}).enabled=false;Object.assign(s.entities.find(e=>e.id==='rider')!.components[0].data as object,f.moves.at(-1)!.p);});
  p.sync(f.scene.document.current);cube().position.set(5,0,0);p.setParticleTime(.3);expect(rider().x).toBeCloseTo(1,4);
  expect(runtime3DProblems(f.scene.document.current)).toEqual([]);expect(f.errors).toEqual([]);
 }finally{await p.dispose();f.host.destroy();}
});
it('keeps a decal square on a stretched object',async()=>{
 const f=fixture();add(f,{id:'stamper',name:'Stamper',components:[{id:'stamper-t',type:'scene3d.transform',version:1,data:{x:0,y:0,z:0,qx:0,qy:0,qz:0,qw:1,scaleX:1,scaleY:1,scaleZ:1}},{id:'d',type:decalsType,version:1,data:{size:.3,sizeRandom:0}}]});
 f.scene.document.transact('Stretch',s=>{Object.assign(s.entities.find(e=>e.name==='Cube')!.components.find(c=>c.type==='scene3d.transform')!.data as object,{scaleX:4,scaleY:.5});});
 const p=new Scene3DProjection(f.context);try{p.sync(f.scene.document.current);p.useSceneCameras();const at=p.slots[0].view.worldToScreen({x:.6,y:.25,z:0})!;send(p,'pointerdown',at);send(p,'pointerup',at);
  const cube=p.slots[0].nodes.get(cubeId(f))!;refresh(cube);const decal=cube.children.find(c=>c.label==='decal-space')!.children[0] as Mesh3D,e=decal.getGlobalTransform().elements,len=(i:number)=>Math.hypot(e[i],e[i+1],e[i+2]),dot=e[0]*e[4]+e[1]*e[5]+e[2]*e[6];
  expect(len(0)).toBeCloseTo(.3,4);expect(len(4)).toBeCloseTo(.3,4);expect(dot).toBeCloseTo(0,6);
 }finally{await p.dispose();f.host.destroy();}
});
it('spaces paint dabs along a stroke and drives the brush through run-time data',()=>{
 const dabs=strokeDabs({u:0,v:0},{u:.15,v:0},.03);expect(dabs).toHaveLength(15);expect(dabs.at(-1)).toEqual({u:.15,v:0});expect(dabs[0].u).toBeCloseTo(.01,6);
 expect(strokeDabs({u:.5,v:.5},{u:.5,v:.5},.03)).toEqual([{u:.5,v:.5}]);expect(strokeDabs({u:0,v:0},{u:.14,v:.14},.0002)).toHaveLength(256);expect(strokeDabs({u:.98,v:.5},{u:.02,v:.5},.03)).toEqual([{u:.02,v:.5}]);
 expect(PaintableSchema.parse({})).toEqual({brushColor:'#ff4a6a',brushSize:.03,resolution:512,background:'',clears:0});
 const [color,clear]=paint3dActions,calls:unknown[]=[],ctx={silent:false,setData:(id:string,p:unknown)=>calls.push([id,p]),time:()=>2.5} as never;
 color.execute({id:'a',type:color.type,targetId:'p',value:true,to:'#00ff00'},ctx);clear.execute({id:'b',type:clear.type,targetId:'p',value:true},ctx);
 expect(calls).toEqual([['p',{brushColor:'#00ff00'}],['p',{clears:2501}]]);expect(()=>color.execute({id:'a',type:color.type,targetId:'p',value:true,to:'red'},ctx)).toThrow('#rrggbb');
 const f=fixture();f.scene.document.transact('Paint',s=>{s.entities.find(e=>e.name==='Sun')!.components.push({id:'pp',type:paintableType,version:1,data:{}});});expect(runtime3DProblems(f.scene.document.current).join()).toContain('Paintable 3D needs a primitive');
});
it('gives each face of a paintable box its own atlas cell',()=>{
 const normals=[1,0,0, -1,0,0, 0,1,0, 0,-1,0, 0,0,1, 0,0,-1],uvs=Array(12).fill(.5),out=boxAtlasUvs(normals,uvs),cells=new Set<string>();
 for(let i=0;i<6;i++){const u=out[i*2],v=out[i*2+1];cells.add(`${Math.floor(u*3)},${Math.floor(v*2)}`);expect(u*3%1).toBeCloseTo(.5,6);expect(v*2%1).toBeCloseTo(.5,6);}expect(cells.size).toBe(6);
});
