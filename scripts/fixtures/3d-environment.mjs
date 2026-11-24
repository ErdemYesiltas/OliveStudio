// QA project for view environment light: ground, a mirror-like sphere and a matte cube under a sun.
// Usage: 3d-environment.mjs <outDir> none|hemisphere|hdr [webgl|webgpu]
import {createServer as vite} from 'vite';
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {hdrPanorama} from './hdr-panorama.mjs';
const out=resolve(process.argv[2]??'outputs/environment3d-qa/hdr'),kind=process.argv[3]??'hdr',renderer=process.argv[4]??'webgl';await mkdir(out,{recursive:true});
const euler=(x,y,z)=>{const h=Math.PI/360,sx=Math.sin(x*h),cx=Math.cos(x*h),sy=Math.sin(y*h),cy=Math.cos(y*h),sz=Math.sin(z*h),cz=Math.cos(z*h);return{qx:sx*cy*cz+cx*sy*sz,qy:cx*sy*cz-sx*cy*sz,qz:cx*cy*sz+sx*sy*cz,qw:cx*cy*cz-sx*sy*sz};};
const project=JSON.parse(await readFile('outputs/uv-alpha3d-qa/3D UV Alpha QA.pixieditor','utf8')),scene=project.scenes[0],view=scene.entities.find(e=>e.components.some(c=>c.type==='pixi3d.viewport'));
const t3=(x,y,z,q,s=1)=>({id:randomUUID(),type:'scene3d.transform',version:1,data:{x,y,z,...q,scaleX:s,scaleY:s,scaleZ:s}}),entity=(name,components)=>({id:randomUUID(),name,parentId:view.id,active:true,spatial:'scene3d.transform',components});
const prim=(shape,color,roughness,metallic)=>({id:randomUUID(),type:'pixi3d.primitive',version:1,data:{shape,color,roughness,metallic}});
scene.entities.find(e=>e.components.some(c=>c.type==='pixi3d.camera')).components.find(c=>c.type==='scene3d.transform').data={x:0,y:1.6,z:6,...euler(-12,0,0),scaleX:1,scaleY:1,scaleZ:1};
scene.entities=scene.entities.filter(e=>!e.components.some(c=>c.type==='pixi3d.modelRenderer'));
scene.entities.push(entity('Ground',[t3(0,-1,0,euler(-90,0,0),10),prim('plane','#8a8a8a',.9,0)]),entity('Mirror sphere',[t3(-1,0,0,euler(0,0,0),1.6),prim('sphere','#ffffff',.08,1)]),entity('Matte cube',[t3(1.4,-.3,0,euler(0,25,0),1.2),prim('cube','#d8d8d8',.9,0)]));
const vp=view.components.find(c=>c.type==='pixi3d.viewport').data,items=[];
if(kind==='hemisphere')Object.assign(vp,{environment:'hemisphere',skyColor:'#ffb070',groundColor:'#2050c0',environmentIntensity:1.5,background:'environment'});
const file=join(out,'3D Environment QA.pixieditor');await mkdir(join(file+'.assets','sources'),{recursive:true});
if(kind==='hdr'){const server=await vite({configFile:false,root:resolve('.'),optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true},ssr:{noExternal:[/^@rewrite\//]}}),cache=await mkdtemp(join(out,'build-'));
 try{const {buildEnvironment}=await server.ssrLoadModule('/modules/render-pixi3d/src/environment.node.ts'),bytes=hdrPanorama(256,128),asset={id:randomUUID(),name:'Warm sky',type:'pixi3d.environment',revision:createHash('sha256').update(bytes).digest('hex'),source:{extension:'hdr',bytes:bytes.length},metadata:{}};
  await mkdir(join(cache,'sources'));await writeFile(join(cache,'sources',`${asset.id}-${asset.revision}.hdr`),bytes);asset.metadata=(await buildEnvironment({root:cache,asset,importerId:'pixi3d-editor.hdr'})).metadata;await writeFile(join(file+'.assets','sources',`${asset.id}-${asset.revision}.hdr`),bytes);items.push(asset);
  Object.assign(vp,{environment:'hdr',environmentAssetId:asset.id,background:'environment',toneMapping:'aces',exposure:1});}finally{await server.close();await rm(cache,{recursive:true,force:true});}}
project.name=`3D Environment QA ${kind} ${renderer}`;project.extensions={'pixi.render':{version:1,renderer},'assets.registry':{version:1,items}};await writeFile(file,JSON.stringify(project,null,2)+'\n');
console.log(JSON.stringify({file,kind,renderer,sha:createHash('sha256').update(await readFile(file)).digest('hex')}));
