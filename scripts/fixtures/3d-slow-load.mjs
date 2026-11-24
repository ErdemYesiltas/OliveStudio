// Separate QA project whose single UV model carries a large noise texture, so Preview preparation stays pending long enough to cancel.
import {createServer as vite} from 'vite';
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {modelMatrix} from './model-matrix.mjs';
const sharp=createRequire(new URL('../../modules/render-pixi3d/package.json',import.meta.url))('sharp'),size=Number(process.argv[3]??4096);
const out=resolve(process.argv[2]??'outputs/slow-load3d-qa');await mkdir(out,{recursive:true});
// Decoded size drives the delay; a low-entropy pattern keeps the PNG under the 20 MiB asset source limit.
const pixels=Buffer.alloc(size*size*4);for(let y=0;y<size;y++)for(let x=0;x<size;x++){const i=(y*size+x)*4;pixels[i]=x&255;pixels[i+1]=y&255;pixels[i+2]=(x^y)&255;pixels[i+3]=255;}
const image=await sharp(pixels,{raw:{width:size,height:size,channels:4}}).png({compressionLevel:9}).toBuffer();if(image.length>18*1024*1024)throw Error(`Texture PNG too large: ${image.length}`);
const server=await vite({configFile:false,root:resolve('.'),optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true},ssr:{noExternal:[/^@rewrite\//]}}),cache=await mkdtemp(join(out,'build-'));
try{const {buildModel}=await server.ssrLoadModule('/modules/render-pixi3d/src/model.node.ts'),project=JSON.parse(await readFile('outputs/material3d-qa/3D Material Slots QA.pixieditor','utf8')),scene=project.scenes[0],template=scene.entities.find(e=>e.components.some(c=>c.type==='pixi3d.modelRenderer'));
 scene.entities=scene.entities.filter(e=>!e.components.some(c=>c.type==='pixi3d.modelRenderer'));scene.name='Slow load';project.name='3D Slow Load QA';
 const file=join(out,'3D Slow Load QA.pixieditor'),sources=join(file+'.assets','sources');await mkdir(sources,{recursive:true});await mkdir(join(cache,'sources'));
 const [f]=await modelMatrix({image,kinds:['uv']}),asset={id:randomUUID(),name:`Slow ${size}px texture`,type:'pixi3d.model',revision:createHash('sha256').update(f.bytes).digest('hex'),source:{extension:'glb',bytes:f.bytes.length},metadata:{}};
 await writeFile(join(cache,'sources',`${asset.id}-${asset.revision}.glb`),f.bytes);asset.metadata=(await buildModel({root:cache,asset,importerId:'pixi3d-editor.glb'})).metadata;await writeFile(join(sources,`${asset.id}-${asset.revision}.glb`),f.bytes);
 const e=structuredClone(template);e.id=randomUUID();e.name=asset.name;e.components=e.components.filter(c=>['scene3d.transform','pixi3d.modelRenderer'].includes(c.type));for(const c of e.components)c.id=randomUUID();e.components.find(c=>c.type==='pixi3d.modelRenderer').data={assetId:asset.id,overrideMaterial:false,color:'#ffffff',roughness:.5,metallic:0};scene.entities.push(e);
 project.extensions={'assets.registry':{version:1,items:[asset]}};await writeFile(file,JSON.stringify(project,null,2)+'\n');
 const sourceHash=createHash('sha256').update(await readFile(file)).digest('hex');await writeFile(join(out,'fixture.json'),JSON.stringify({file,sourceHash,entityId:e.id,assetId:asset.id,texture:size,glbBytes:f.bytes.length},null,2)+'\n');console.log(JSON.stringify({file,glbBytes:f.bytes.length,sourceHash}));
}finally{await server.close();await rm(cache,{recursive:true,force:true});}
