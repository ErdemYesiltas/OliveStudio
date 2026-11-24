import {expect,it} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {Container} from 'pixi.js';
import {parseRadianceHdr} from '@pixi/3d';
import {SceneService,transformDefinition} from '@rewrite/scene';
import {transform3dDefinition,viewport3dDefinition,Viewport3DSchema} from '@rewrite/scene3d';
import {hdrPanorama} from '../../../scripts/fixtures/hdr-panorama.mjs';
import {decodeRadiance,buildEnvironment} from './environment.node';
import {authoring3dDefinitions} from './contracts';
import {model3dDefinition} from './model-contracts';
import {Authoring3D} from './model';
import {Scene3DProjection} from './projection';
const rle=(width:number,height:number,value:[number,number,number,number])=>{const parts=[Buffer.from(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${height} +X ${width}\n`,'latin1')];for(let y=0;y<height;y++){parts.push(Buffer.from([2,2,width>>8,width&255]));for(const c of value)parts.push(Buffer.from([128+width,c]));}return Buffer.concat(parts);};
it('decodes flat and RLE Radiance files the way @pixi/3d reads them, and rejects foreign layouts',()=>{
 const flat=hdrPanorama(32,16),a=decodeRadiance(flat),ref=parseRadianceHdr(new Uint8Array(flat).buffer as ArrayBuffer);expect([a.width,a.height]).toEqual([ref.width,ref.height]);
 const r=decodeRadiance(rle(16,4,[100,50,25,129]));expect([r.width,r.height]).toEqual([16,4]);expect(Array.from(r.rgbe.subarray(0,4))).toEqual([100,50,25,129]);
 expect(()=>decodeRadiance(Buffer.from('P6\n1 1\n'))).toThrow(/Radiance/);
 expect(()=>decodeRadiance(Buffer.from('#?RADIANCE\nFORMAT=32-bit_rle_xyze\n\n-Y 1 +X 1\n'))).toThrow(/32-bit_rle_rgbe/);
 expect(()=>decodeRadiance(Buffer.from('#?RADIANCE\n\n+Y 1 +X 1\n'))).toThrow(/orientation/);
 expect(()=>decodeRadiance(Buffer.concat([Buffer.from('#?RADIANCE\n\n-Y 2 +X 2\n'),Buffer.alloc(4)]))).toThrow(/truncated/);
});
it('builds an environment asset: the original HDR, a preview and its size and peak',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'hdr-'));try{
  const bytes=hdrPanorama(64,32),revision=createHash('sha256').update(bytes).digest('hex');await mkdir(join(dir,'sources'),{recursive:true});await writeFile(join(dir,'sources',`e-${revision}.hdr`),bytes);
  const built=await buildEnvironment({root:dir,importerId:'pixi3d-editor.hdr',asset:{id:'e',name:'sky',type:'pixi3d.environment',revision,source:{extension:'hdr',bytes:bytes.length},metadata:{}} as never});
  expect(built.metadata).toMatchObject({pipeline:'radiance-hdr-v1',width:64,height:32});expect((built.metadata as {peak:number}).peak).toBeGreaterThan(30);
  expect(Buffer.compare(await readFile(join(dir,'cache',`e-${revision}`,'environment.hdr')),bytes)).toBe(0);expect((await readFile(join(dir,'cache',`e-${revision}`,'image.webp'))).length).toBeGreaterThan(0);
 }finally{await rm(dir,{recursive:true,force:true});}
});
it('defaults keep older views unchanged and the projection applies hemisphere, background and tone mapping',async()=>{
 expect(Viewport3DSchema.parse({width:640,height:360})).toMatchObject({environment:'none',background:'color',backgroundColor:'#19212b',toneMapping:'none',exposure:1});
 const defs=new Map([transformDefinition,transform3dDefinition,viewport3dDefinition,model3dDefinition,...authoring3dDefinitions].map(d=>[d.type,d])),scene=new SceneService(()=>defs),editor=new Authoring3D(scene,()=>{},()=>null,()=>true,()=>({x:480,y:270})),ids=editor.createView(),host=new Container();
 const p=new Scene3DProjection({node:id=>id===ids.viewId?host:undefined,changed(){},report(){}});try{
  p.sync(scene.document.current);expect(p.slots[0].view.background).toBe(0x19212b);expect(p.slots[0].view.environment).toBeNull();
  scene.document.transact('Sky',s=>{Object.assign(s.entities.find(e=>e.id===ids.viewId)!.components.find(c=>c.type==='pixi3d.viewport')!.data as object,{environment:'hemisphere',skyColor:'#ff8800',groundColor:'#003366',environmentIntensity:2,background:'environment',toneMapping:'aces',exposure:.5});});
  p.sync(scene.document.current);const v=p.slots[0].view;expect(v.environment).toEqual({skyColor:0xff8800,groundColor:0x003366,intensity:2});expect(v.background).toBe(v.environment);expect(v.toneMapping).toBe('aces');expect(v.exposure).toBe(.5);
 }finally{await p.dispose();host.destroy();}
});
