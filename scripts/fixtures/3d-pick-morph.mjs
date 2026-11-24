// QA project for picking against deformed geometry, no animation: kind 'morph' (static morph weight 1, top edge
// +0.7 local X) or 'skin' (two-bone rig, tip bone posed 45° about Z). 'rest' builds the same mesh undeformed, as a
// pixel reference. A click rule on the mesh hides a marker quad.
// Usage: 3d-pick-morph.mjs [outDir] [morph|skin] [rest]
import {createServer as vite} from 'vite';
import {readFile,writeFile,mkdir,mkdtemp,rm,copyFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
const kind=process.argv[3]??'morph',rest=process.argv[4]==='rest';
function morphQuad(){
 const positions=[-.5,.5,0,.5,.5,0,-.5,-.5,0,.5,-.5,0],normals=[0,0,1,0,0,1,0,0,1,0,0,1],indices=[0,2,3,0,3,1],delta=[];for(let i=0;i<4;i++)delta.push((positions[i*3+1]+.5)*.7,0,0);
 const chunks=[],json={asset:{version:'2.0',generator:'OliveStudio pick QA'},scene:0,scenes:[{nodes:[0]}],nodes:[{name:'Morph quad',mesh:0,weights:[1]}],meshes:[{primitives:[],weights:[1]}],materials:[{name:'Green',pbrMetallicRoughness:{baseColorFactor:[.1,1,.2,1],roughnessFactor:1,metallicFactor:0},doubleSided:true}],buffers:[{byteLength:0}],bufferViews:[],accessors:[]};let byteLength=0;
 const view=data=>{const bytes=Buffer.from(data),index=json.bufferViews.length;json.bufferViews.push({buffer:0,byteOffset:byteLength,byteLength:bytes.length});chunks.push(bytes);byteLength+=bytes.length;const pad=(4-byteLength%4)%4;if(pad){chunks.push(Buffer.alloc(pad));byteLength+=pad;}return index;};
 const accessor=(values,type,componentType=5126,minmax)=>{const typed=componentType===5123?new Uint16Array(values):new Float32Array(values),index=json.accessors.length;json.accessors.push({bufferView:view(Buffer.from(typed.buffer)),componentType,count:values.length/({SCALAR:1,VEC3:3}[type]),type,...(minmax??{})});return index;};
 const primitive={attributes:{POSITION:accessor(positions,'VEC3',5126,{min:[-.5,-.5,0],max:[.5,.5,0]}),NORMAL:accessor(normals,'VEC3')},indices:accessor(indices,'SCALAR',5123),material:0};json.meshes[0].primitives.push(primitive);
 if(kind==='morph'){primitive.targets=[{POSITION:accessor(delta,'VEC3',5126,{min:[0,0,0],max:[.7,0,0]})}];json.nodes[0].weights=json.meshes[0].weights=[rest?0:1];}
 else{delete json.nodes[0].weights;delete json.meshes[0].weights;const joints=[],weights=[];for(let i=0;i<4;i++){const top=positions[i*3+1]>0;joints.push(top?1:0,0,0,0);weights.push(1,0,0,0);}
  const jv=json.bufferViews.length;primitive.attributes.JOINTS_0=(()=>{const bytes=Buffer.from(new Uint8Array(joints).buffer),index=json.accessors.length;json.accessors.push({bufferView:view(bytes),componentType:5121,count:4,type:'VEC4'});return index;})();void jv;
  primitive.attributes.WEIGHTS_0=(()=>{const typed=new Float32Array(weights),index=json.accessors.length;json.accessors.push({bufferView:view(Buffer.from(typed.buffer)),componentType:5126,count:4,type:'VEC4'});return index;})();
  const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],ibm=new Float32Array([...identity,...identity]),ibmIndex=json.accessors.length;json.accessors.push({bufferView:view(Buffer.from(ibm.buffer)),componentType:5126,count:2,type:'MAT4'});
  const h=rest?0:Math.PI/8;json.nodes[0].skin=0;json.nodes.push({name:'Root bone',children:[2]},{name:'Tip bone',rotation:[0,0,Math.sin(h),Math.cos(h)]});json.scenes[0].nodes=[0,1];json.skins=[{joints:[1,2],skeleton:1,inverseBindMatrices:ibmIndex}];}
 json.buffers[0].byteLength=byteLength;let text=Buffer.from(JSON.stringify(json));text=Buffer.concat([text,Buffer.alloc((4-text.length%4)%4,32)]);const bin=Buffer.concat(chunks),header=Buffer.alloc(20),binHeader=Buffer.alloc(8);
 header.writeUInt32LE(0x46546c67);header.writeUInt32LE(2,4);header.writeUInt32LE(28+text.length+bin.length,8);header.writeUInt32LE(text.length,12);header.writeUInt32LE(0x4e4f534a,16);binHeader.writeUInt32LE(bin.length);binHeader.writeUInt32LE(0x004e4942,4);
 return Buffer.concat([header,text,binHeader,bin]);
}
const from=resolve('outputs/uv-alpha3d-qa'),out=resolve(process.argv[2]??'outputs/pick3d-qa'),uv=JSON.parse(await readFile(join(from,'fixture.json'),'utf8'));await mkdir(out,{recursive:true});
const server=await vite({configFile:false,root:resolve('.'),optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true},ssr:{noExternal:[/^@rewrite\//]}}),cache=await mkdtemp(join(out,'build-'));
try{const {buildModel}=await server.ssrLoadModule('/modules/render-pixi3d/src/model.node.ts'),project=JSON.parse(await readFile(uv.file,'utf8')),scene=project.scenes[0];
 const marker=scene.entities.find(e=>e.id===uv.layout.uv.entityId),keep=new Set([marker.id]);scene.entities=scene.entities.filter(e=>!e.components.some(c=>c.type==='pixi3d.modelRenderer')||keep.has(e.id));project.name=`3D Pick ${kind}${rest?' rest':''} QA`;scene.name='Pick '+kind;
 const file=join(out,'3D Pick QA.pixieditor'),sources=join(file+'.assets','sources');await mkdir(sources,{recursive:true});await mkdir(join(cache,'sources'));
 const bytes=morphQuad(),asset={id:randomUUID(),name:kind==='morph'?'Morph quad':'Skinned quad',type:'pixi3d.model',revision:createHash('sha256').update(bytes).digest('hex'),source:{extension:'glb',bytes:bytes.length},metadata:{}};
 await writeFile(join(cache,'sources',`${asset.id}-${asset.revision}.glb`),bytes);asset.metadata=(await buildModel({root:cache,asset,importerId:'pixi3d-editor.glb'})).metadata;await writeFile(join(sources,`${asset.id}-${asset.revision}.glb`),bytes);
 const e=structuredClone(marker);e.id=randomUUID();e.name=kind==='morph'?'Morph quad':'Skinned quad';e.components=e.components.filter(c=>['scene3d.transform','pixi3d.modelRenderer'].includes(c.type));for(const c of e.components)c.id=randomUUID();
 Object.assign(e.components.find(c=>c.type==='scene3d.transform').data,{x:.5,y:0,z:0,qx:0,qy:0,qz:0,qw:1,scaleX:2,scaleY:2,scaleZ:2});e.components.find(c=>c.type==='pixi3d.modelRenderer').data={assetId:asset.id,overrideMaterial:false,color:'#ffffff',roughness:1,metallic:0,materialSlots:[]};
 e.components.push({id:randomUUID(),type:'interactions.bindings',version:1,data:{rules:[{id:randomUUID(),trigger:{type:'pointer.click',sourceId:e.id,event:''},actions:[{id:randomUUID(),type:'entity.active',targetId:marker.id,value:false}]}]}});scene.entities.push(e);
 const registry=project.extensions['assets.registry'].items.filter(a=>a.id===marker.components.find(c=>c.type==='pixi3d.modelRenderer').data.assetId);project.extensions['assets.registry'].items=[...registry,asset];for(const a of registry)await copyFile(join(uv.file+'.assets','sources',`${a.id}-${a.revision}.glb`),join(sources,`${a.id}-${a.revision}.glb`));
 await writeFile(file,JSON.stringify(project,null,2)+'\n');const sourceHash=createHash('sha256').update(await readFile(file)).digest('hex');
 await writeFile(join(out,'fixture.json'),JSON.stringify({file,sourceHash,kind,rest,morphEntityId:e.id,markerEntityId:marker.id,localPoints:{both:[.1,-.3],deformedOnly:[.9,.35],restOnly:[-.4,.35]},transform:{x:.5,y:0,scale:2}},null,2)+'\n');console.log(JSON.stringify({file,sourceHash}));
}finally{await server.close();await rm(cache,{recursive:true,force:true});}
