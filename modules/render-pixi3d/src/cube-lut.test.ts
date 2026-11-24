import {expect,it} from 'vitest';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import sharp from 'sharp';
import {parseCube,sampleCube,cubeToStrip,stripSize,cubeLutImporter,maxCube3D} from './cube-lut';
import {prepareCubeLut} from './cube-lut.node';
import {lutSize,lutLookup} from './color-lut-size';
/** A `.cube` 3D table of edge n, red fastest, holding `f` at each grid point. */
function cube3d(n:number,f:(r:number,g:number,b:number)=>number[],head=''){const rows:string[]=[];for(let b=0;b<n;b++)for(let g=0;g<n;g++)for(let r=0;r<n;r++)rows.push(f(r/(n-1),g/(n-1),b/(n-1)).map(v=>v.toFixed(6)).join(' '));return`${head}LUT_3D_SIZE ${n}\n${rows.join('\n')}\n`;}
const level=(v:number)=>Math.round(Math.min(1,Math.max(0,v))*255);
const px=(s:{width:number;pixels:Uint8Array},x:number,y:number)=>Array.from(s.pixels.slice((y*s.width+x)*3,(y*s.width+x)*3+3));
it('declares a texture importer for .cube files',()=>{expect(cubeLutImporter).toEqual({id:'pixi3d-editor.cube',assetType:'pixi.texture',titleKey:'scene3d.importLut',extensions:['cube']});});
it('parses titles, comments, CRLF, a BOM, domains and unknown keywords',()=>{
 const text='﻿# made by a grader\r\nTITLE "Warm look"\r\nLUT_IN_VIDEO_RANGE\r\nDOMAIN_MIN 0 0 0\r\nDOMAIN_MAX 1 1 1\r\n'+cube3d(2,(r,g,b)=>[r,g,b]).replace(/\n/g,'\r\n');
 const lut=parseCube(text);expect({title:lut.title,kind:lut.kind,size:lut.size,min:lut.domainMin,max:lut.domainMax,rows:lut.data.length/3}).toEqual({title:'Warm look',kind:'3d',size:2,min:[0,0,0],max:[1,1,1],rows:8});
 expect(Array.from(lut.data.slice(3,6))).toEqual([1,0,0]);
 expect(parseCube('LUT_3D_INPUT_RANGE 0 2\n'+cube3d(2,(r,g,b)=>[r,g,b])).domainMax).toEqual([2,2,2]);
 expect(parseCube('LUT_1D_SIZE 2\n0 0 0\n1 1 1\n').kind).toBe('1d');
});
it('refuses malformed files with the line that is wrong',()=>{
 expect(()=>parseCube('# nothing\n')).toThrow(/no LUT_3D_SIZE/);
 expect(()=>parseCube('0 0 0\nLUT_3D_SIZE 2\n')).toThrow(/line 1: table values come before/);
 expect(()=>parseCube('LUT_3D_SIZE 2\n0 0 0\n')).toThrow(/has 1 rows; LUT size 2 needs 8/);
 expect(()=>parseCube(cube3d(2,()=>[0,0,0])+'1 1 1\n')).toThrow(/line 10: more table rows/);
 expect(()=>parseCube('LUT_3D_SIZE 2\n0 0 x\n')).toThrow(/line 2: a table row needs three numbers/);
 expect(()=>parseCube('LUT_3D_SIZE 2\nLUT_1D_SIZE 2\n')).toThrow(/line 2: the file declares more than one/);
 expect(()=>parseCube(`LUT_3D_SIZE ${maxCube3D+1}\n`)).toThrow(/from 2 to 256/);expect(()=>parseCube('LUT_3D_SIZE 1\n')).toThrow(/from 2/);
 expect(()=>parseCube('DOMAIN_MIN 0 0 1\nDOMAIN_MAX 1 1 1\n'+cube3d(2,(r,g,b)=>[r,g,b]))).toThrow(/DOMAIN_MAX must exceed/);
});
it('copies a 33³ table onto the strip exactly, with red across, blue in slices and green down',()=>{
 const lut=parseCube(cube3d(33,(r,g,b)=>[r,g,b])),strip=cubeToStrip(lut);expect([strip.size,strip.width,strip.height]).toEqual([33,1089,33]);expect(lutSize(strip.width,strip.height)).toBe(33);
 for(const [r,g,b] of [[0,0,0],[32,32,32],[5,17,29],[31,2,0]])expect(px(strip,b*33+r,g)).toEqual([level(r/32),level(g/32),level(b/32)]);
 const swap=cubeToStrip(parseCube(cube3d(33,(r,g,b)=>[b,g,r])));expect(px(swap,29*33+5,17)).toEqual([level(29/32),level(17/32),level(5/32)]);
});
it('resamples a 65³ table down to the 64³ strip limit and keeps an identity within one level',()=>{
 const lut=parseCube(cube3d(65,(r,g,b)=>[r,g,b])),strip=cubeToStrip(lut);expect(stripSize(lut)).toBe(64);expect([strip.width,strip.height]).toEqual([4096,64]);
 let worst=0;for(let i=0;i<strip.pixels.length;i+=3){const p=i/3,x=p%4096,y=Math.floor(p/4096),want=[x%64,y,Math.floor(x/64)].map(v=>level(v/63));for(let k=0;k<3;k++)worst=Math.max(worst,Math.abs(strip.pixels[i+k]-want[k]));}expect(worst).toBeLessThanOrEqual(1);
});
it('interpolates between table points and clamps outputs above 1',()=>{
 const lut=parseCube(cube3d(2,(r,g,b)=>[r*2,g,b]));expect(sampleCube(lut,.5,.25,.75)).toEqual([1,.25,.75]);
 const strip=cubeToStrip(lut);expect(px(strip,1,0)).toEqual([255,0,0]);
});
it('turns a 1D curve into a 32³ strip that applies the curve per channel',()=>{
 const rows=Array.from({length:256},(_,i)=>{const v=i/255;return`${v**2} ${v} ${Math.sqrt(v)}`;}).join('\n'),lut=parseCube(`LUT_1D_SIZE 256\n${rows}\n`),strip=cubeToStrip(lut);
 expect(strip.size).toBe(32);const c=[.6,.3,.8],out=lutLookup(c as [number,number,number],32,(u,v)=>{const x=Math.min(strip.width-1,Math.floor(u*strip.width)),y=Math.min(31,Math.floor(v*32));return px(strip,x,y).map(n=>n/255) as [number,number,number];});
 expect(out[0]).toBeCloseTo(.36,1);expect(out[1]).toBeCloseTo(.3,1);expect(out[2]).toBeCloseTo(Math.sqrt(.8),1);
});
it('maps the strip grid through the file domain',()=>{
 // Domain 0..2: the strip's input 1.0 reads the table half way, where this ramp holds 0.5.
 const lut=parseCube('DOMAIN_MIN 0 0 0\nDOMAIN_MAX 2 2 2\n'+cube3d(3,(r,g,b)=>[r,g,b])),strip=cubeToStrip(lut);expect(px(strip,2*3+2,2)).toEqual([level(.5),level(.5),level(.5)]);
});
it('prepares a .cube file into a strip PNG named after its title',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'cube-'));try{const file=join(dir,'look.cube');await writeFile(file,cube3d(17,(r,g,b)=>[b,g,r],'TITLE "Swap"\n'));
  const prepared=await prepareCubeLut(file);expect({name:prepared.name,extension:prepared.extension}).toEqual({name:'Swap',extension:'png'});
  const {data,info}=await sharp(Buffer.from(prepared.bytes)).raw().toBuffer({resolveWithObject:true});expect([info.width,info.height,info.channels]).toEqual([289,17,3]);
  const at=(x:number,y:number)=>Array.from(data.slice((y*289+x)*3,(y*289+x)*3+3));expect(at(10*17+3,7)).toEqual([level(10/16),level(7/16),level(3/16)]);
  await writeFile(file,'LUT_3D_SIZE 2\n0 0 0\n');await expect(prepareCubeLut(file)).rejects.toThrow(/needs 8/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
