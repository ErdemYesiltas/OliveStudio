import type {AssetImporter} from '@rewrite/assets';
import {maxLutSize} from './color-lut-size';
// Adobe/Resolve `.cube` colour LUTs, turned into the strip image the colour LUT effect reads. Pure: no pixi, no node.
/** Imports a `.cube` file as an ordinary texture: the importer's prepare step writes the strip PNG that becomes the source. */
export const cubeLutImporter:AssetImporter&{id:string}={id:'pixi3d-editor.cube',assetType:'pixi.texture',titleKey:'scene3d.importLut',extensions:['cube']};
/** Largest `.cube` accepted: 3D up to 256³ points, 1D up to 65536 entries, and files up to 20 MB (the import limit). */
export const maxCube3D=256,maxCube1D=65536;
export interface CubeLut{title:string;kind:'3d'|'1d';size:number;domainMin:[number,number,number];domainMax:[number,number,number];
 /** RGB triples, red fastest, then green, then blue (3D); one triple per entry (1D). */
 data:Float32Array}
const triple=(parts:string[],line:number,what:string):[number,number,number]=>{const v=parts.map(Number);if(v.length!==3||v.some(n=>!Number.isFinite(n)))throw Error(`.cube line ${line}: ${what} needs three numbers`);return v as [number,number,number];};
/** Parses a `.cube` file; throws with the line number on anything malformed or unsupported. */
export function parseCube(text:string):CubeLut{
 let title='',kind:'3d'|'1d'|undefined,size=0,domainMin:[number,number,number]=[0,0,0],domainMax:[number,number,number]=[1,1,1],data:Float32Array|undefined,count=0;
 const lines=text.split(/\r\n|\r|\n/);
 for(let i=0;i<lines.length;i++){const raw=lines[i].replace(/^﻿/,'').trim(),line=i+1;if(!raw||raw.startsWith('#'))continue;
  const parts=raw.split(/\s+/),key=parts[0].toUpperCase();
  if(key==='TITLE'){title=raw.slice(5).trim().replace(/^"(.*)"$/,'$1').slice(0,120);continue;}
  if(key==='LUT_3D_SIZE'||key==='LUT_1D_SIZE'){if(kind)throw Error(`.cube line ${line}: the file declares more than one LUT size`);kind=key==='LUT_3D_SIZE'?'3d':'1d';size=Number(parts[1]);
   const max=kind==='3d'?maxCube3D:maxCube1D;if(!Number.isInteger(size)||size<2||size>max)throw Error(`.cube line ${line}: ${key} must be a whole number from 2 to ${max}`);
   data=new Float32Array((kind==='3d'?size**3:size)*3);continue;}
  if(key==='DOMAIN_MIN'){domainMin=triple(parts.slice(1),line,key);continue;}
  if(key==='DOMAIN_MAX'){domainMax=triple(parts.slice(1),line,key);continue;}
  if(key==='LUT_3D_INPUT_RANGE'||key==='LUT_1D_INPUT_RANGE'){const [a,b]=parts.slice(1).map(Number);if(parts.length!==3||!Number.isFinite(a)||!Number.isFinite(b))throw Error(`.cube line ${line}: ${key} needs two numbers`);domainMin=[a,a,a];domainMax=[b,b,b];continue;}
  if(/^[A-Z][A-Z0-9_]*$/.test(key))continue; // Other keywords (e.g. LUT_IN_VIDEO_RANGE) do not change the table.
  if(!data)throw Error(`.cube line ${line}: table values come before LUT_3D_SIZE or LUT_1D_SIZE`);
  if(count*3>=data.length)throw Error(`.cube line ${line}: more table rows than the declared size`);
  data.set(triple(parts,line,'a table row'),count*3);count++;}
 if(!kind||!data)throw Error('.cube file has no LUT_3D_SIZE or LUT_1D_SIZE');
 const expected=data.length/3;if(count!==expected)throw Error(`.cube table has ${count} rows; LUT size ${size} needs ${expected}`);
 for(let k=0;k<3;k++)if(!(domainMax[k]>domainMin[k]))throw Error('.cube DOMAIN_MAX must exceed DOMAIN_MIN on every channel');
 return{title,kind,size,domainMin,domainMax,data};
}
/** Colour of the LUT for an input in the file's domain, trilinear (3D) or linear per channel (1D); inputs outside clamp. */
export function sampleCube(lut:CubeLut,r:number,g:number,b:number,out:number[]=[0,0,0]){
 const {size:n,data,domainMin:lo,domainMax:hi}=lut,pos=[r,g,b].map((v,k)=>Math.min(n-1,Math.max(0,(v-lo[k])/(hi[k]-lo[k])*(n-1))));
 if(lut.kind==='1d'){for(let k=0;k<3;k++){const p=pos[k],i0=Math.floor(p),i1=Math.min(n-1,i0+1),f=p-i0;out[k]=data[i0*3+k]*(1-f)+data[i1*3+k]*f;}return out;}
 const [x,y,z]=pos,x0=Math.floor(x),y0=Math.floor(y),z0=Math.floor(z),x1=Math.min(n-1,x0+1),y1=Math.min(n-1,y0+1),z1=Math.min(n-1,z0+1),fx=x-x0,fy=y-y0,fz=z-z0;
 const at=(i:number,j:number,l:number,k:number)=>data[((l*n+j)*n+i)*3+k];
 for(let k=0;k<3;k++){const c00=at(x0,y0,z0,k)*(1-fx)+at(x1,y0,z0,k)*fx,c10=at(x0,y1,z0,k)*(1-fx)+at(x1,y1,z0,k)*fx,c01=at(x0,y0,z1,k)*(1-fx)+at(x1,y0,z1,k)*fx,c11=at(x0,y1,z1,k)*(1-fx)+at(x1,y1,z1,k)*fx;
  out[k]=(c00*(1-fy)+c10*fy)*(1-fz)+(c01*(1-fy)+c11*fy)*fz;}
 return out;
}
/** Strip edge for a LUT: its own size for a 3D table up to 64, 64 above that (resampled), 32 for a 1D table. */
export const stripSize=(lut:Pick<CubeLut,'kind'|'size'>)=>lut.kind==='1d'?32:Math.min(lut.size,maxLutSize);
/**
 * The strip image (N² × N, 8-bit RGB, rows top to bottom) the colour LUT effect reads: at strip point (r, g, b) on
 * the 0..1 grid it stores the LUT's colour for that input, outputs clamped to 0..1. A 3D table that already sits on
 * that grid is copied exactly.
 */
export function cubeToStrip(lut:CubeLut){const n=stripSize(lut),width=n*n,pixels=new Uint8Array(width*n*3),c=[0,0,0];
 for(let g=0;g<n;g++)for(let b=0;b<n;b++)for(let r=0;r<n;r++){sampleCube(lut,r/(n-1),g/(n-1),b/(n-1),c);const o=(g*width+b*n+r)*3;for(let k=0;k<3;k++)pixels[o+k]=Math.round(Math.min(1,Math.max(0,c[k]))*255);}
 return{size:n,width,height:n,pixels};}
