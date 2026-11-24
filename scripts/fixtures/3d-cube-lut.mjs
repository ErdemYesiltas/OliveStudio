// QA project for .cube LUT import: writes a real .cube file, runs it through the importer's prepare step (strip PNG)
// and grades the post-effects scene with it. Usage: 3d-cube-lut.mjs <outDir> swap65|curve1d webgl|webgpu
// swap65: a 65³ table exchanging red and blue (resampled to the 64³ strip); curve1d: a 1D table r², g, √b.
import {createServer as vite} from 'vite';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
const [out,mode='swap65',renderer='webgl']=[resolve(process.argv[2]??'outputs/cube-lut3d-qa/swap65-webgl'),process.argv[3],process.argv[4]];await mkdir(out,{recursive:true});
if(!['swap65','curve1d'].includes(mode))throw Error('Mode must be swap65 or curve1d');
let text;if(mode==='swap65'){const n=65,rows=[];for(let b=0;b<n;b++)for(let g=0;g<n;g++)for(let r=0;r<n;r++)rows.push(`${(b/(n-1)).toFixed(6)} ${(g/(n-1)).toFixed(6)} ${(r/(n-1)).toFixed(6)}`);text=`TITLE "Swap RB 65"\nLUT_3D_SIZE ${n}\n${rows.join('\n')}\n`;}
else text=`TITLE "Curve 1D"\nLUT_1D_SIZE 1024\n${Array.from({length:1024},(_,i)=>{const v=i/1023;return`${(v*v).toFixed(6)} ${v.toFixed(6)} ${Math.sqrt(v).toFixed(6)}`;}).join('\n')}\n`;
const cubeFile=join(out,`${mode}.cube`);await writeFile(cubeFile,text);
const server=await vite({configFile:false,root:resolve('.'),optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true},ssr:{noExternal:[/^@rewrite\//]}});
try{const {prepareCubeLut}=await server.ssrLoadModule('/modules/render-pixi3d/src/cube-lut.node.ts'),prepared=await prepareCubeLut(cubeFile),bytes=Buffer.from(prepared.bytes),size=mode==='swap65'?64:32;
 const project=JSON.parse(await readFile('outputs/postfx3d-qa/plain-webgl/3D PostFX QA.pixieditor','utf8')),view=project.scenes[0].entities.find(e=>e.components.some(c=>c.type==='pixi3d.viewport'));
 const file=join(out,'3D Cube LUT QA.pixieditor'),sources=join(file+'.assets','sources');await mkdir(sources,{recursive:true});
 const asset={id:'8d2e0f3b-5c4a-4b9f-8e7d-3f4a5b6c7d8e',name:prepared.name,type:'pixi.texture',revision:createHash('sha256').update(bytes).digest('hex'),source:{extension:'png',bytes:bytes.length},metadata:{width:size*size,height:size,processedBytes:bytes.length,pipeline:'fixture'}};
 await writeFile(join(sources,`${asset.id}-${asset.revision}.png`),bytes);await writeFile(join(out,'strip.png'),bytes);
 Object.assign(view.components.find(c=>c.type==='pixi3d.viewport').data,{lutAssetId:asset.id,lutIntensity:1});
 project.name=`3D Cube LUT QA ${mode} ${renderer}`;project.extensions={'pixi.render':{version:1,renderer},'assets.registry':{version:1,items:[asset]}};
 await writeFile(file,JSON.stringify(project,null,2)+'\n');console.log(JSON.stringify({file,name:prepared.name,stripBytes:bytes.length}));
}finally{await server.close();}
