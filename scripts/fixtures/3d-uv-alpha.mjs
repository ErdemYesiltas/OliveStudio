// Separate QA project for UV orientation and blended sort order. Original quads; no remote assets.
// UVs are derived from vertex position (u=x+.5, v=.5-y), so with glTF's top-left UV origin the
// camera-facing quad must show red top-left, green top-right, blue bottom-left, yellow bottom-right.
import {createServer as vite} from 'vite';
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const sharp=createRequire(new URL('../../modules/render-pixi3d/package.json',import.meta.url))('sharp');
const quadrants=await sharp(Buffer.from([255,40,40,255,40,230,60,255,40,90,255,255,255,225,35,255]),{raw:{width:2,height:2,channels:4}}).png().toBuffer();
function quad({color=[1,1,1,1],blend=false,texture}){
 const positions=[-.5,.5,0,.5,.5,0,-.5,-.5,0,.5,-.5,0],normals=[0,0,1,0,0,1,0,0,1,0,0,1],uv=[],indices=[0,2,3,0,3,1];
 for(let i=0;i<4;i++)uv.push(positions[i*3]+.5,.5-positions[i*3+1]);
 const chunks=[],json={asset:{version:'2.0',generator:'OliveStudio UV/alpha QA'},scene:0,scenes:[{nodes:[0]}],nodes:[{name:'Quad',mesh:0}],meshes:[{primitives:[]}],materials:[{name:'Quad',pbrMetallicRoughness:{baseColorFactor:color,roughnessFactor:1,metallicFactor:0},doubleSided:true,...(blend?{alphaMode:'BLEND'}:{})}],buffers:[{byteLength:0}],bufferViews:[],accessors:[]};let byteLength=0;
 const view=data=>{const bytes=Buffer.from(data),index=json.bufferViews.length;json.bufferViews.push({buffer:0,byteOffset:byteLength,byteLength:bytes.length});chunks.push(bytes);byteLength+=bytes.length;const pad=(4-byteLength%4)%4;if(pad){chunks.push(Buffer.alloc(pad));byteLength+=pad;}return index;};
 const accessor=(values,type,componentType=5126,minmax)=>{const typed=componentType===5123?new Uint16Array(values):new Float32Array(values),index=json.accessors.length;json.accessors.push({bufferView:view(Buffer.from(typed.buffer)),componentType,count:values.length/({SCALAR:1,VEC2:2,VEC3:3}[type]),type,...(minmax??{})});return index;};
 const primitive={attributes:{POSITION:accessor(positions,'VEC3',5126,{min:[-.5,-.5,0],max:[.5,.5,0]}),NORMAL:accessor(normals,'VEC3'),TEXCOORD_0:accessor(uv,'VEC2')},indices:accessor(indices,'SCALAR',5123),material:0};json.meshes[0].primitives.push(primitive);
 if(texture){json.images=[{bufferView:view(texture),mimeType:'image/png'}];json.samplers=[{magFilter:9728,minFilter:9728,wrapS:33071,wrapT:33071}];json.textures=[{source:0,sampler:0}];json.materials[0].pbrMetallicRoughness.baseColorTexture={index:0};}
 json.buffers[0].byteLength=byteLength;let text=Buffer.from(JSON.stringify(json));text=Buffer.concat([text,Buffer.alloc((4-text.length%4)%4,32)]);const bin=Buffer.concat(chunks),header=Buffer.alloc(20),binHeader=Buffer.alloc(8);
 header.writeUInt32LE(0x46546c67);header.writeUInt32LE(2,4);header.writeUInt32LE(28+text.length+bin.length,8);header.writeUInt32LE(text.length,12);header.writeUInt32LE(0x4e4f534a,16);binHeader.writeUInt32LE(bin.length);binHeader.writeUInt32LE(0x004e4942,4);
 return Buffer.concat([header,text,binHeader,bin]);
}
const out=resolve(process.argv[2]??'outputs/uv-alpha3d-qa');await mkdir(out,{recursive:true});
const server=await vite({configFile:false,root:resolve('.'),optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true},ssr:{noExternal:[/^@rewrite\//]}}),cache=await mkdtemp(join(out,'build-'));
try{const {buildModel}=await server.ssrLoadModule('/modules/render-pixi3d/src/model.node.ts'),project=JSON.parse(await readFile('outputs/material3d-qa/3D Material Slots QA.pixieditor','utf8')),scene=project.scenes[0],template=scene.entities.find(e=>e.components.some(c=>c.type==='pixi3d.modelRenderer'));
 scene.entities=scene.entities.filter(e=>!e.components.some(c=>c.type==='pixi3d.modelRenderer'));scene.name='UV and alpha';project.name='3D UV Alpha QA';
 const file=join(out,'3D UV Alpha QA.pixieditor'),sources=join(file+'.assets','sources');await mkdir(sources,{recursive:true});await mkdir(join(cache,'sources'));
 const assets={};for(const [key,name,bytes] of [['uv','UV quadrant quad',quad({texture:quadrants})],['red','Red blend quad',quad({color:[1,.1,.1,.5],blend:true})],['blue','Blue blend quad',quad({color:[.1,.1,1,.5],blend:true})]]){
  const asset={id:randomUUID(),name,type:'pixi3d.model',revision:createHash('sha256').update(bytes).digest('hex'),source:{extension:'glb',bytes:bytes.length},metadata:{}};await writeFile(join(cache,'sources',`${asset.id}-${asset.revision}.glb`),bytes);asset.metadata=(await buildModel({root:cache,asset,importerId:'pixi3d-editor.glb'})).metadata;await writeFile(join(sources,`${asset.id}-${asset.revision}.glb`),bytes);assets[key]=asset;}
 const place=(name,key,x,y,z,scale)=>{const e=structuredClone(template);e.id=randomUUID();e.name=name;e.components=e.components.filter(c=>['scene3d.transform','pixi3d.modelRenderer'].includes(c.type));for(const c of e.components)c.id=randomUUID();Object.assign(e.components.find(c=>c.type==='scene3d.transform').data,{x,y,z,qx:0,qy:0,qz:0,qw:1,scaleX:scale,scaleY:scale,scaleZ:scale});e.components.find(c=>c.type==='pixi3d.modelRenderer').data={assetId:assets[key].id,overrideMaterial:false,color:'#ffffff',roughness:1,metallic:0,materialSlots:[]};scene.entities.push(e);return{name,entityId:e.id,x,y,z};};
 // Pair A is authored back-to-front, pair B front-to-back; correct depth sorting renders both overlaps red-dominant.
 const layout={uv:place('UV quad','uv',-2.2,0,0,1.6),pairA:[place('A back blue','blue',.35,-.3,-.6,1.4),place('A front red','red',-.05,.1,.6,1.4)],pairB:[place('B front red','red',1.95,.1,.6,1.4),place('B back blue','blue',2.35,-.3,-.6,1.4)]};
 project.extensions={'assets.registry':{version:1,items:Object.values(assets)}};await writeFile(file,JSON.stringify(project,null,2)+'\n');
 const sourceHash=createHash('sha256').update(await readFile(file)).digest('hex');await writeFile(join(out,'fixture.json'),JSON.stringify({file,sourceHash,layout,expected:{uv:{topLeft:'red',topRight:'green',bottomLeft:'blue',bottomRight:'yellow'},overlap:'red-dominant in both pairs'}},null,2)+'\n');console.log(JSON.stringify({file,sourceHash}));
}finally{await server.close();await rm(cache,{recursive:true,force:true});}
