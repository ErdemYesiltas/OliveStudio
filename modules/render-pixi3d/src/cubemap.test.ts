import {afterEach,expect,it,vi} from 'vitest';
import {Container} from 'pixi.js';
import {Mesh3D} from '@pixi/3d';
import {SceneService,transformDefinition} from '@rewrite/scene';
import {transform3dDefinition,viewport3dDefinition,Viewport3DSchema} from '@rewrite/scene3d';
import type {AssetRecord} from '@rewrite/assets';
import {authoring3dDefinitions,primitive3dDefinition,Primitive3DSchema} from './contracts';
import {model3dDefinition} from './model-contracts';
import {Authoring3D} from './model';
import {Scene3DProjection} from './projection';
import {runtime3DProblems} from './preflight';
import {cubeLayout,cubeDirection,cubeFaces,lodFar} from './cubemap';
const defs=()=>new Map([transformDefinition,transform3dDefinition,viewport3dDefinition,model3dDefinition,...authoring3dDefinitions].map(d=>[d.type,d]));
function fixture(){const scene=new SceneService(defs),editor=new Authoring3D(scene,()=>{},()=>null,()=>true,()=>({x:480,y:270})),ids=editor.createView(),host=new Container(),errors:unknown[]=[];return{scene,editor,ids,host,errors,context:{node:(id:string)=>id===ids.viewId?host:undefined,changed(){},report(e:unknown){errors.push(e);}}};}
const viewEdit=(f:ReturnType<typeof fixture>,data:object)=>f.scene.document.transact('View',s=>{Object.assign(s.entities.find(e=>e.id===f.ids.viewId)!.components.find(c=>c.type==='pixi3d.viewport')!.data as object,data);});
const cubeEdit=(f:ReturnType<typeof fixture>,data:object)=>f.scene.document.transact('Cube',s=>{Object.assign(s.entities.find(e=>e.name==='Cube')!.components.find(c=>c.type==='pixi3d.primitive')!.data as object,data);});
afterEach(()=>{vi.unstubAllGlobals();});
it('finds the six faces of a cross, a strip and a column, and refuses other shapes',()=>{
 const cross=cubeLayout(1024,768);expect(cross).toMatchObject({kind:'cross',size:256});expect(cross.faces).toEqual({top:{x:256,y:0},left:{x:0,y:256},front:{x:256,y:256},right:{x:512,y:256},back:{x:768,y:256},bottom:{x:256,y:512}});
 const strip=cubeLayout(1536,256);expect(strip.kind).toBe('strip');expect(cubeFaces.map(f=>strip.faces[f].x)).toEqual([0,256,512,768,1024,1280]);
 expect(cubeLayout(64,384)).toMatchObject({kind:'column',size:64});expect(cubeLayout(64,384).faces.back).toEqual({x:0,y:320});
 for(const [w,h] of [[512,512],[1000,700],[24,18],[300,100]])expect(()=>cubeLayout(w,h)).toThrow(/cross \(4:3\)/);
});
it('points each face centre down its axis and keeps the faces seamless',()=>{
 const axis={right:[1,0,0],left:[-1,0,0],top:[0,1,0],bottom:[0,-1,0],front:[0,0,1],back:[0,0,-1]} as const;
 for(const f of cubeFaces)cubeDirection(f,0,0).forEach((v,i)=>expect(v).toBeCloseTo(axis[f][i],9));
 // The right edge of the front face and the left edge of the right face look the same way.
 cubeDirection('front',1,.3).forEach((v,i)=>expect(v).toBeCloseTo(cubeDirection('right',-1,.3)[i],9));
 // The top row of the front face meets the bottom row of the top face.
 cubeDirection('front',.4,-1).forEach((v,i)=>expect(v).toBeCloseTo(cubeDirection('top',.4,1)[i],9));
});
it('switches level of detail with a band so the boundary never flickers',()=>{
 expect(lodFar(10,10.5,false)).toBe(false);expect(lodFar(10,11.5,false)).toBe(true);expect(lodFar(10,9.5,true)).toBe(true);expect(lodFar(10,8.5,true)).toBe(false);expect(lodFar(0,1e6,false)).toBe(false);
 expect(Viewport3DSchema.parse({width:640,height:360})).toMatchObject({cubemapAssetId:''});expect(Viewport3DSchema.parse({width:640,height:360,environment:'cubemap'}).environment).toBe('cubemap');
 const shown=(data:object)=>primitive3dDefinition.fields.filter(f=>!f.visible||f.visible(Primitive3DSchema.parse({shape:'sphere',color:'#ffffff',roughness:.5,metallic:0,...data}) as never)).map(f=>f.key);
 expect(shown({})).toContain('lodDistance');expect(shown({})).not.toContain('lodSegments');expect(shown({lodDistance:5})).toContain('lodSegments');expect(shown({shape:'cube'})).not.toContain('lodDistance');
});
it('swaps a far sphere to its coarse geometry and back as the camera moves',async()=>{
 const f=fixture(),p=new Scene3DProjection(f.context);try{const id=f.scene.document.current.entities.find(e=>e.name==='Cube')!.id;
  cubeEdit(f,{shape:'sphere',segments:32,lodDistance:20,lodSegments:6});p.sync(f.scene.document.current);
  const mesh=p.slots[0].nodes.get(id)!.children.find(c=>c instanceof Mesh3D) as Mesh3D,camera=p.slots[0].view.camera,near=mesh.geometry.vertexCount;
  camera.position.set(0,0,5);p.setParticleTime(0);expect(mesh.geometry.vertexCount).toBe(near);
  camera.position.set(0,0,30);p.setParticleTime(0);expect(mesh.geometry.vertexCount).toBeLessThan(near/10);
  camera.position.set(0,0,19);p.setParticleTime(0);expect(mesh.geometry.vertexCount).toBeLessThan(near/10);
  camera.position.set(0,0,17);p.setParticleTime(0);expect(mesh.geometry.vertexCount).toBe(near);
  expect(f.errors).toEqual([]);
 }finally{await p.dispose();f.host.destroy();}
});
it('loads a cube map image behind the readiness gate and checks its shape before export',async()=>{
 const assets=new Map([['sky',{id:'sky',type:'pixi.texture',metadata:{width:1024,height:768}}],['square',{id:'square',type:'pixi.texture',metadata:{width:512,height:512}}]]) as unknown as Map<string,AssetRecord>,port={get:(id:string)=>assets.get(id),url:(a:AssetRecord,file:string)=>`asset://${a.id}/${file}`};
 const fetches:string[]=[];vi.stubGlobal('fetch',(url:string)=>{fetches.push(url);return new Promise(()=>{});});
 const f=fixture(),p=new Scene3DProjection(f.context,port);try{
  viewEdit(f,{environment:'cubemap',cubemapAssetId:'sky',background:'environment'});p.sync(f.scene.document.current);expect(fetches).toEqual(['asset://sky/image.webp']);expect(p.slots[0].loads).toHaveLength(1);
  viewEdit(f,{cubemapAssetId:'gone'});p.sync(f.scene.document.current);expect(String(f.errors.at(-1))).toMatch(/cube map: the image is missing/);
  expect(runtime3DProblems(f.scene.document.current,id=>assets.get(id)).join()).toMatch(/cube map image is missing/);
  viewEdit(f,{cubemapAssetId:'square'});expect(runtime3DProblems(f.scene.document.current,id=>assets.get(id)).join()).toMatch(/cross \(4:3\)/);
  viewEdit(f,{cubemapAssetId:'sky'});expect(runtime3DProblems(f.scene.document.current,id=>assets.get(id))).toEqual([]);
 }finally{await p.dispose();f.host.destroy();}
});
