import {afterEach,expect,it,vi} from 'vitest';
import {Container,TextureSource} from 'pixi.js';
import {TintEffect,FxaaEffect} from '@pixi/3d/extras';
import {SceneService,transformDefinition} from '@rewrite/scene';
import {transform3dDefinition,viewport3dDefinition,Viewport3DSchema} from '@rewrite/scene3d';
import type {AssetRecord} from '@rewrite/assets';
import {authoring3dDefinitions} from './contracts';
import {model3dDefinition} from './model-contracts';
import {Authoring3D} from './model';
import {Scene3DProjection} from './projection';
import {ColorLutEffect,lutSize,lutLookup,maxLutSize} from './color-lut';
import {runtime3DProblems} from './preflight';
const defs=()=>new Map([transformDefinition,transform3dDefinition,viewport3dDefinition,model3dDefinition,...authoring3dDefinitions].map(d=>[d.type,d]));
function fixture(){const scene=new SceneService(defs),editor=new Authoring3D(scene,()=>{},()=>null,()=>true,()=>({x:480,y:270})),ids=editor.createView(),host=new Container(),errors:unknown[]=[];return{scene,ids,host,errors,context:{node:(id:string)=>id===ids.viewId?host:undefined,changed(){},report(e:unknown){errors.push(e);}}};}
const view=(f:ReturnType<typeof fixture>,data:object)=>f.scene.document.transact('LUT',s=>{Object.assign(s.entities.find(e=>e.id===f.ids.viewId)!.components.find(c=>c.type==='pixi3d.viewport')!.data as object,data);});
const texture=(id:string,width:number,height:number,type='pixi.texture')=>({id,name:id,type,revision:'a'.repeat(64),source:{extension:'png',bytes:10},metadata:{width,height,processedBytes:10,pipeline:'test'}}) as unknown as AssetRecord;
/** An identity strip of edge n, sampled bilinearly at pixel centres like the GPU does. */
function identity(n:number){const w=n*n,h=n,px=(x:number,y:number):[number,number,number]=>[(x%n)/(n-1),y/(n-1),Math.floor(x/n)/(n-1)];
 return(u:number,v:number):[number,number,number]=>{const fx=Math.min(w-1,Math.max(0,u*w-.5)),fy=Math.min(h-1,Math.max(0,v*h-.5)),x0=Math.floor(fx),y0=Math.floor(fy),x1=Math.min(w-1,x0+1),y1=Math.min(h-1,y0+1),tx=fx-x0,ty=fy-y0;
  const a=px(x0,y0),b=px(x1,y0),c=px(x0,y1),d=px(x1,y1);return[0,1,2].map(i=>(a[i]*(1-tx)+b[i]*tx)*(1-ty)+(c[i]*(1-tx)+d[i]*tx)*ty) as [number,number,number];};}
afterEach(()=>{vi.unstubAllGlobals();});
it('accepts only N² × N strips up to 64³',()=>{
 expect([lutSize(256,16),lutSize(1024,32),lutSize(4096,64),lutSize(16,4)]).toEqual([16,32,64,4]);
 for(const [w,h] of [[512,512],[256,15],[1,1],[65*65,65],[0,0],[24,4.9]])expect(()=>lutSize(w,h)).toThrow(/strip/);
 expect(maxLutSize).toBe(64);
});
it('looks colours up through an identity strip unchanged, across blue slices and out-of-range input',()=>{
 for(const n of [16,32])for(const rgb of [[0,0,0],[1,1,1],[.25,.5,.75],[.9,.1,.53],[.333,.666,.5]] as [number,number,number][]){const out=lutLookup(rgb,n,identity(n));for(let i=0;i<3;i++)expect(out[i]).toBeCloseTo(rgb[i],4);}
 expect(lutLookup([1.5,-.2,2],16,identity(16)).map(v=>Math.round(v*1e4)/1e4)).toEqual([1,0,1]);
 // A strip that swaps red and blue grades each pixel by that swap.
 const id=identity(16),swap=(u:number,v:number)=>{const c=id(u,v);return[c[2],c[1],c[0]] as [number,number,number];};
 const out=lutLookup([.8,.4,.2],16,swap);expect(out[0]).toBeCloseTo(.2,4);expect(out[2]).toBeCloseTo(.8,4);
});
it('keeps older views ungraded and shows the strength only with a LUT chosen',()=>{
 expect(Viewport3DSchema.parse({width:640,height:360})).toMatchObject({lutAssetId:'',lutIntensity:1});
 expect(()=>Viewport3DSchema.parse({width:640,height:360,lutIntensity:1.5})).toThrow();
 const field=viewport3dDefinition.fields.find(f=>f.key==='lutIntensity')!;expect(field.visible?.({lutAssetId:''} as never)).toBe(false);expect(field.visible?.({lutAssetId:'x'} as never)).toBe(true);
 expect(viewport3dDefinition.fields.find(f=>f.key==='lutAssetId')).toMatchObject({kind:'asset',assetType:'pixi.texture'});
});
it('passes the picture through until a strip is set, then grades at the chosen strength',()=>{
 const effect=new ColorLutEffect({intensity:.6}),info=()=>Array.from((effect as unknown as {uniforms:{uniforms:{uLutInfo:Float32Array}}}).uniforms.uniforms.uLutInfo.slice(0,2));
 try{expect(effect.stage).toBe('afterToneMapping');expect(effect.lut).toBeNull();expect(info()).toEqual([2,0]);
  const strip=new TextureSource({width:1024,height:32});effect.lut=strip;expect(info()[0]).toBe(32);expect(info()[1]).toBeCloseTo(.6,6);
  expect(strip.style.scaleMode).toBe('linear');expect(strip.style.addressMode).toBe('clamp-to-edge');expect(strip.autoGenerateMipmaps).toBe(false);
  effect.intensity=3;expect(info()[1]).toBe(1);effect.intensity=-1;expect(info()[1]).toBe(0);
  expect(()=>{effect.lut=new TextureSource({width:64,height:64});}).toThrow(/strip/);expect(effect.lut).toBe(strip);
  effect.lut=null;expect(effect.lut).toBeNull();expect(info()[1]).toBe(0);strip.destroy();
 }finally{effect.destroy();}
});
it('puts the LUT after the tint and before FXAA, gates readiness on the image, and reports a missing one',async()=>{
 const assets=new Map([['lut',texture('lut',256,16)],['model',texture('model',1,1,'pixi3d.model')]]),port={get:(id:string)=>assets.get(id),url:(a:AssetRecord,file:string)=>`asset://${a.id}/${file}`};
 const fetches:string[]=[];vi.stubGlobal('fetch',(url:string)=>{fetches.push(url);return new Promise(()=>{});});
 const f=fixture(),p=new Scene3DProjection(f.context,port);try{
  view(f,{tint:'#ffcc88',lutAssetId:'lut',lutIntensity:.5,antialias:true});p.sync(f.scene.document.current);
  const passes=p.slots[0].view.passes;expect(passes.map(x=>x.constructor)).toEqual([TintEffect,ColorLutEffect,FxaaEffect]);expect((passes[1] as ColorLutEffect).intensity).toBe(.5);
  expect(fetches).toEqual(['asset://lut/image.webp']);expect(p.slots[0].loads).toHaveLength(1);
  // A rebuild for the same image reuses the load in flight instead of fetching again.
  view(f,{lutIntensity:.7});p.sync(f.scene.document.current);expect(fetches).toHaveLength(1);
  view(f,{lutAssetId:'gone'});p.sync(f.scene.document.current);expect(String(f.errors.at(-1))).toMatch(/colour LUT: the image is missing/);
  view(f,{lutAssetId:'model'});p.sync(f.scene.document.current);expect(String(f.errors.at(-1))).toMatch(/colour LUT: the image is missing/);
  expect(p.slots[0].view.passes.some(x=>x instanceof ColorLutEffect)).toBe(true);
 }finally{await p.dispose();f.host.destroy();}
});
it('flags a missing or wrongly shaped LUT before export',()=>{
 const f=fixture();view(f,{lutAssetId:'lut'});const scene=f.scene.document.current;
 expect(runtime3DProblems(scene,()=>undefined).join()).toMatch(/LUT image is missing/);
 expect(runtime3DProblems(scene,()=>texture('lut',512,512)).join()).toMatch(/strip N² wide/);
 expect(runtime3DProblems(scene,()=>texture('lut',1024,32))).toEqual([]);
 expect(runtime3DProblems(scene)).toEqual([]);
});
