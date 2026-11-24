// QA project for the colour LUT: the post-effects scene (cubes, ground, glowing sphere) graded through a 32³ strip.
// Usage: 3d-lut.mjs <outDir> plain|identity|swap|swap-half webgl|webgpu
// identity must match plain; swap exchanges red and blue (catches axis/slice/flip mistakes); swap-half blends it at 0.5.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
const [out,mode='identity',renderer='webgl']=[resolve(process.argv[2]??'outputs/lut3d-qa/identity-webgl'),process.argv[3],process.argv[4]];await mkdir(out,{recursive:true});
if(!['plain','identity','swap','swap-half'].includes(mode))throw Error('Mode must be plain, identity, swap or swap-half');
function png(w,h,pixel){const raw=Buffer.alloc((w*3+1)*h);for(let y=0;y<h;y++){raw[y*(w*3+1)]=0;for(let x=0;x<w;x++)raw.set(pixel(x,y),y*(w*3+1)+1+x*3);}
 const crc=b=>{let c=~0;for(const v of b){c^=v;for(let k=0;k<8;k++)c=c>>>1^(0xedb88320&-(c&1));}return ~c>>>0;},chunk=(t,d)=>{const head=Buffer.alloc(8);head.writeUInt32BE(d.length);head.write(t,4);const c=Buffer.alloc(4);c.writeUInt32BE(crc(Buffer.concat([Buffer.from(t),d])));return Buffer.concat([head,d,c]);};
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(w,0);ihdr.writeUInt32BE(h,4);ihdr[8]=8;ihdr[9]=2;return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);}
const n=32,level=v=>Math.round(v/(n-1)*255),bytes=png(n*n,n,(x,y)=>{const r=level(x%n),g=level(y),b=level(Math.floor(x/n));return mode.startsWith('swap')?[b,g,r]:[r,g,b];});
const project=JSON.parse(await readFile('outputs/postfx3d-qa/plain-webgl/3D PostFX QA.pixieditor','utf8')),view=project.scenes[0].entities.find(e=>e.components.some(c=>c.type==='pixi3d.viewport'));
const file=join(out,'3D LUT QA.pixieditor'),sources=join(file+'.assets','sources');await mkdir(sources,{recursive:true});
const asset={id:'7c1d9e2a-4b3f-4a8e-9d6c-2e3f4a5b6c7d',name:mode.startsWith('swap')?'Swap RB':'Identity',type:'pixi.texture',revision:createHash('sha256').update(bytes).digest('hex'),source:{extension:'png',bytes:bytes.length},metadata:{width:n*n,height:n,processedBytes:bytes.length,pipeline:'fixture'}};
await writeFile(join(sources,`${asset.id}-${asset.revision}.png`),bytes);await writeFile(join(out,'lut.png'),bytes);
Object.assign(view.components.find(c=>c.type==='pixi3d.viewport').data,{lutAssetId:mode==='plain'?'':asset.id,lutIntensity:mode==='swap-half'?.5:1});
project.name=`3D LUT QA ${mode} ${renderer}`;project.extensions={'pixi.render':{version:1,renderer},'assets.registry':{version:1,items:mode==='plain'?[]:[asset]}};
await writeFile(file,JSON.stringify(project,null,2)+'\n');console.log(JSON.stringify({file,sha:createHash('sha256').update(await readFile(file)).digest('hex'),id:randomUUID()}));
