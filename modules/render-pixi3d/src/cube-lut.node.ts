import {lstat,readFile} from 'node:fs/promises';
import {basename,extname} from 'node:path';
import sharp from 'sharp';
import type {PreparedSource} from '@rewrite/assets/node';
import {parseCube,cubeToStrip} from './cube-lut';
/** Reads a `.cube` file and returns the strip PNG that the image pipeline stores as the texture's source. */
export async function prepareCubeLut(path:string):Promise<PreparedSource>{
 const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink())throw Error('Choose a regular .cube file');
 const lut=parseCube(await readFile(path,'utf8')),strip=cubeToStrip(lut);
 const bytes=await sharp(Buffer.from(strip.pixels),{raw:{width:strip.width,height:strip.height,channels:3}}).png({compressionLevel:9}).toBuffer();
 return{name:(lut.title||basename(path,extname(path))).slice(0,120),extension:'png',bytes:new Uint8Array(bytes)};
}
