// QA project for GLB instancing. Usage: 3d-instance-models.mjs <outDir> separate|instanced|tinted webgl|webgpu
// The generated "lamp" GLB has three parts: a textured base, a pole nested under a rotated, non-uniformly scaled
// node, and an alpha-blended shade (exercises the TRANSPARENT pass). separate places 5×4 Model renderer entities;
// instanced places the same 5×4 grid as one pixi3d.instances component; tinted adds a random colour mix.
import {createServer as vite} from 'vite';
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
const [out,mode='instanced',renderer='webgl']=[resolve(process.argv[2]??'outputs/instance-models3d-qa/instanced-webgl'),process.argv[3],process.argv[4]];await mkdir(out,{recursive:true});
if(!['separate','instanced','tinted'].includes(mode))throw Error('Mode must be separate, instanced or tinted');
const {Document,NodeIO}=createRequire(resolve('modules/render-pixi3d/package.json'))('@gltf-transform/core');
function png(size,pixel){const raw=Buffer.alloc((size*4+1)*size);for(let y=0;y<size;y++){raw[y*(size*4+1)]=0;for(let x=0;x<size;x++)raw.set(pixel(x,y),y*(size*4+1)+1+x*4);}
 const crc=b=>{let c=~0;for(const v of b){c^=v;for(let k=0;k<8;k++)c=c>>>1^(0xedb88320&-(c&1));}return ~c>>>0;},chunk=(t,d)=>{const h=Buffer.alloc(8);h.writeUInt32BE(d.length);h.write(t,4);const c=Buffer.alloc(4);c.writeUInt32BE(crc(Buffer.concat([Buffer.from(t),d])));return Buffer.concat([h,d,c]);};
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(size,0);ihdr.writeUInt32BE(size,4);ihdr[8]=8;ihdr[9]=6;return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);}
async function lamp(){const doc=new Document(),buffer=doc.createBuffer();
 const checker=doc.createTexture('checker').setImage(png(64,(x,y)=>((x>>3)+(y>>3))%2?[235,200,90,255]:[60,70,90,255])).setMimeType('image/png');
 const box=(name,material)=>{const p=[],n=[],uv=[],ix=[];const faces=[[0,1,2,1],[0,1,2,-1],[1,2,0,1],[1,2,0,-1],[2,0,1,1],[2,0,1,-1]];
  for(const [a,b,c,s] of faces){const base=p.length/3;for(const [u,v] of [[-1,-1],[1,-1],[1,1],[-1,1]]){const q=[0,0,0];q[a]=u*.5;q[b]=v*.5;q[c]=s*.5;p.push(...q);const nn=[0,0,0];nn[c]=s;n.push(...nn);uv.push((u+1)/2,(1-v)/2);}ix.push(...(s>0?[base,base+1,base+2,base,base+2,base+3]:[base,base+2,base+1,base,base+3,base+2]));}
  const acc=(type,arr)=>doc.createAccessor().setType(type).setArray(arr).setBuffer(buffer);
  return doc.createMesh(name).addPrimitive(doc.createPrimitive().setAttribute('POSITION',acc('VEC3',new Float32Array(p))).setAttribute('NORMAL',acc('VEC3',new Float32Array(n))).setAttribute('TEXCOORD_0',acc('VEC2',new Float32Array(uv))).setIndices(acc('SCALAR',new Uint16Array(ix))).setMaterial(material));};
 const baseMat=doc.createMaterial('Base').setBaseColorTexture(checker).setRoughnessFactor(.7).setMetallicFactor(0);
 const poleMat=doc.createMaterial('Pole').setBaseColorFactor([.55,.6,.68,1]).setRoughnessFactor(.4).setMetallicFactor(.6);
 const shadeMat=doc.createMaterial('Shade').setBaseColorFactor([1,.85,.45,.55]).setAlphaMode('BLEND').setRoughnessFactor(.5).setMetallicFactor(0);
 const shade=doc.createNode('Shade').setMesh(box('Shade',shadeMat)).setTranslation([0,.55,0]).setScale([3,.5,3]);
 const pole=doc.createNode('Pole').setMesh(box('Pole',poleMat)).setTranslation([0,1.1,0]).setRotation([0,Math.sin(Math.PI/8),0,Math.cos(Math.PI/8)]).setScale([.18,1.6,.18]).addChild(shade);
 const base=doc.createNode('Base').setMesh(box('Base',baseMat)).setScale([.8,.3,.8]);
 doc.createScene('Lamp').addChild(doc.createNode('Lamp').addChild(base).addChild(pole));
 return Buffer.from(await new NodeIO().writeBinary(doc));}
const bytes=await lamp(),server=await vite({configFile:false,root:resolve('.'),optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true},ssr:{noExternal:[/^@rewrite\//]}}),cache=await mkdtemp(join(out,'build-'));
try{const {buildModel}=await server.ssrLoadModule('/modules/render-pixi3d/src/model.node.ts'),project=JSON.parse(await readFile('outputs/material3d-qa/3D Material Slots QA.pixieditor','utf8')),scene=project.scenes[0],template=scene.entities.find(e=>e.components.some(c=>c.type==='pixi3d.modelRenderer'));
 scene.entities=scene.entities.filter(e=>!e.components.some(c=>c.type==='pixi3d.modelRenderer'));const view=scene.entities.find(e=>e.components.some(c=>c.type==='pixi3d.viewport'));
 const camera=scene.entities.find(e=>e.components.some(c=>c.type==='pixi3d.camera')),h=Math.PI/360*-30;camera.parentId=view.id;camera.components.find(c=>c.type==='scene3d.transform').data={x:0,y:7,z:11,qx:Math.sin(h),qy:0,qz:0,qw:Math.cos(h),scaleX:1,scaleY:1,scaleZ:1};
 project.name='3D Instance Models QA';const file=join(out,'3D Instance Models QA.pixieditor'),sources=join(file+'.assets','sources');await mkdir(sources,{recursive:true});await mkdir(join(cache,'sources'));
 const asset={id:'5b0e2c1a-3f4d-4e8a-9c6b-1d2e3f4a5b6c',name:'Lamp',type:'pixi3d.model',revision:createHash('sha256').update(bytes).digest('hex'),source:{extension:'glb',bytes:bytes.length},metadata:{}};
 await writeFile(join(cache,'sources',`${asset.id}-${asset.revision}.glb`),bytes);asset.metadata=(await buildModel({root:cache,asset,importerId:'pixi3d-editor.glb'})).metadata;await writeFile(join(sources,`${asset.id}-${asset.revision}.glb`),bytes);
 const transform=(x,z)=>({id:randomUUID(),type:'scene3d.transform',version:1,data:{x,y:0,z,qx:0,qy:0,qz:0,qw:1,scaleX:1,scaleY:1,scaleZ:1}});
 if(mode==='separate'){for(let i=0;i<20;i++){const e=structuredClone(template);e.id=randomUUID();e.name='Lamp '+i;e.parentId=view.id;e.components=[transform(((i%5)-2)*2.2,(Math.floor(i/5)-1.5)*2.2),{id:randomUUID(),type:'pixi3d.modelRenderer',version:1,data:{assetId:asset.id,overrideMaterial:false,color:'#ffffff',roughness:.5,metallic:0,materialSlots:[],castShadow:true,receiveShadow:true}}];scene.entities.push(e);}}
 else scene.entities.push({id:randomUUID(),name:'Lamps',parentId:view.id,active:true,spatial:'scene3d.transform',components:[transform(0,0),{id:randomUUID(),type:'pixi3d.instances',version:1,data:{source:'model',assetId:asset.id,shape:'cube',color:'#ffffff',colorMode:mode==='tinted'?'random':'single',color2:'#7fb0ff',gradientAxis:'x',roughness:.5,metallic:0,castShadow:true,receiveShadow:true,layout:'grid',columns:5,rows:4,layers:1,spacing:2.2,count:20,areaWidth:10,areaDepth:10,areaHeight:0,seed:3,scale:1,scaleRandom:0,yawRandom:0,jitter:0}}]});
 project.extensions={'pixi.render':{version:1,renderer},'assets.registry':{version:1,items:[asset]}};await writeFile(file,JSON.stringify(project,null,2)+'\n');
 console.log(JSON.stringify({file,parts:asset.metadata.meshes,materials:asset.metadata.materials.length,capabilities:asset.metadata.capabilities}));
}finally{await server.close();await rm(cache,{recursive:true,force:true});}
