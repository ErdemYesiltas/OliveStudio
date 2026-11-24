// Separate QA project around one existing local GLB (read-only copy). Usage: 3d-real-model.mjs <file.glb> [outDir]
import {createServer as vite} from 'vite';
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {resolve,join,basename} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
const glb=resolve(process.argv[2]),out=resolve(process.argv[3]??'outputs/real-model3d-qa'),bytes=await readFile(glb);await mkdir(out,{recursive:true});
const server=await vite({configFile:false,root:resolve('.'),optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true},ssr:{noExternal:[/^@rewrite\//]}}),cache=await mkdtemp(join(out,'build-'));
try{const {buildModel}=await server.ssrLoadModule('/modules/render-pixi3d/src/model.node.ts'),project=JSON.parse(await readFile('outputs/material3d-qa/3D Material Slots QA.pixieditor','utf8')),scene=project.scenes[0],template=scene.entities.find(e=>e.components.some(c=>c.type==='pixi3d.modelRenderer'));
 scene.entities=scene.entities.filter(e=>!e.components.some(c=>c.type==='pixi3d.modelRenderer'));scene.name='Real model';project.name='3D Real Model QA';
 const file=join(out,'3D Real Model QA.pixieditor'),sources=join(file+'.assets','sources');await mkdir(sources,{recursive:true});await mkdir(join(cache,'sources'));
 const asset={id:randomUUID(),name:basename(glb,'.glb'),type:'pixi3d.model',revision:createHash('sha256').update(bytes).digest('hex'),source:{extension:'glb',bytes:bytes.length},metadata:{}};
 await writeFile(join(cache,'sources',`${asset.id}-${asset.revision}.glb`),bytes);asset.metadata=(await buildModel({root:cache,asset,importerId:'pixi3d-editor.glb'})).metadata;await writeFile(join(sources,`${asset.id}-${asset.revision}.glb`),bytes);
 const e=structuredClone(template);e.id=randomUUID();e.name=asset.name;e.components=e.components.filter(c=>['scene3d.transform','pixi3d.modelRenderer'].includes(c.type));for(const c of e.components)c.id=randomUUID();Object.assign(e.components.find(c=>c.type==='scene3d.transform').data,{x:0,y:0,z:0});e.components.find(c=>c.type==='pixi3d.modelRenderer').data={assetId:asset.id,overrideMaterial:false,color:'#ffffff',roughness:.5,metallic:0,materialSlots:[]};scene.entities.push(e);
 project.extensions={'assets.registry':{version:1,items:[asset]}};await writeFile(file,JSON.stringify(project,null,2)+'\n');
 const sourceHash=createHash('sha256').update(await readFile(file)).digest('hex');await writeFile(join(out,'fixture.json'),JSON.stringify({file,sourceHash,input:glb,inputSha256:asset.revision,entityId:e.id,metadata:asset.metadata},null,2)+'\n');console.log(JSON.stringify({file,metadata:asset.metadata}).slice(0,1500));
}finally{await server.close();await rm(cache,{recursive:true,force:true});}
