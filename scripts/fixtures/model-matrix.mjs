// Original technical models, derived from the repository's MIT cube. No remote assets/decoders.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {resolve,join} from 'node:path';
const require=createRequire(new URL('../../modules/render-pixi3d/package.json',import.meta.url)),sharp=require('sharp');
export async function modelMatrix(options={}){
 const original=await readFile(new URL('../../modules/pixi3d-lab/src/fixtures/animated-cube.glb',import.meta.url)),length=original.readUInt32LE(12),raw=JSON.parse(original.subarray(20,20+length).toString()),bin=original.subarray(28+length);
 const array=index=>{const a=raw.accessors[index],v=raw.bufferViews[a.bufferView],n=a.count*({VEC3:3,VEC2:2,SCALAR:1}[a.type]);return Array.from(new Float32Array(bin.buffer,bin.byteOffset+(v.byteOffset??0)+(a.byteOffset??0),n));};
 const positions=array(raw.meshes[0].primitives[0].attributes.POSITION),normals=array(raw.meshes[0].primitives[0].attributes.NORMAL),count=positions.length/3,uv=[];
 // Each face has two triangles; this gives each face the same known UV quadrant layout.
 for(let face=0;face<6;face++)uv.push(0,0,1,0,1,1,0,0,1,1,0,1);
 const image=await sharp(Buffer.from([255,40,40,255,40,230,60,255,40,90,255,255,255,225,35,255]),{raw:{width:2,height:2,channels:4}}).png().toBuffer(),result=[];const texture=options.image??image;
 for(const kind of options.kinds??['uv','alpha','skin','morph','clips']){
  const chunks=[],json={asset:{version:'2.0',generator:'OliveStudio original model matrix'},scene:0,scenes:[{nodes:kind==='skin'?[0,1]:[0]}],nodes:[{name:'Model',mesh:0}],meshes:[{primitives:[]}],materials:[{name:'Paint',pbrMetallicRoughness:{baseColorFactor:[1,1,1,1],roughnessFactor:.6,metallicFactor:0},doubleSided:true}],buffers:[{byteLength:0}],bufferViews:[],accessors:[]};let byteLength=0;
  const buffer=data=>{const bytes=Buffer.from(data),index=json.bufferViews.length;json.bufferViews.push({buffer:0,byteOffset:byteLength,byteLength:bytes.length});chunks.push(bytes);byteLength+=bytes.length;const pad=(4-byteLength%4)%4;if(pad){chunks.push(Buffer.alloc(pad));byteLength+=pad;}return index;};
  const accessor=(values,type,min,max,integer=false)=>{const typed=integer?new Uint16Array(values):new Float32Array(values),index=json.accessors.length;json.accessors.push({bufferView:buffer(Buffer.from(typed.buffer)),componentType:integer?5123:5126,count:values.length/({SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16}[type]),type,...(min?{min,max}:{})});return index;};
  const primitive={attributes:{POSITION:accessor(positions,'VEC3',[-.5,-.5,-.5],[.5,.5,.5]),NORMAL:accessor(normals,'VEC3')},material:0};json.meshes[0].primitives.push(primitive);
  const times=()=>accessor([0,1,2],'SCALAR',[0],[2]);
  const animation=(name,path,output,type,node=0)=>{json.animations??=[];json.animations.push({name,samplers:[{input:times(),output:accessor(output,type),interpolation:'LINEAR'}],channels:[{sampler:0,target:{node,path}}]});};
  if(kind==='uv'){primitive.attributes.TEXCOORD_0=accessor(uv,'VEC2');json.images=[{bufferView:buffer(texture),mimeType:'image/png'}];json.samplers=[{magFilter:9728,minFilter:9728,wrapS:33071,wrapT:33071}];json.textures=[{source:0,sampler:0}];json.materials[0].pbrMetallicRoughness.baseColorTexture={index:0};}
  if(kind==='alpha'){json.materials[0].alphaMode='BLEND';json.materials[0].pbrMetallicRoughness.baseColorFactor=[.15,.6,.95,.45];}
  if(kind==='skin'){json.nodes[0].skin=0;json.nodes.push({name:'Root bone',children:[2]},{name:'Tip bone'});const joints=[],weights=[];for(let i=0;i<count;i++){const top=positions[i*3+1]+.5;joints.push(0,1,0,0);weights.push(1-top,top,0,0);}primitive.attributes.JOINTS_0=accessor(joints,'VEC4',undefined,undefined,true);primitive.attributes.WEIGHTS_0=accessor(weights,'VEC4');const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];json.skins=[{name:'Two-bone rig',joints:[1,2],skeleton:1,inverseBindMatrices:accessor([...identity,...identity],'MAT4')}];const angle=Math.PI/6;animation('Bend','rotation',[0,0,0,1,0,0,Math.sin(angle),Math.cos(angle),0,0,0,1],'VEC4',2);}
  if(kind==='morph'){const delta=[];for(let i=0;i<count;i++)delta.push((positions[i*3+1]+.5)*.7,0,0);primitive.targets=[{POSITION:accessor(delta,'VEC3')}];json.meshes[0].weights=[0];json.nodes[0].weights=[0];animation('Stretch','weights',[0,1,0],'SCALAR');}
  if(kind==='clips'){json.nodes[0].translation=[0,.3,0];animation('Lift','translation',[0,0,0,0,1,0,0,0,0],'VEC3');animation('Turn','rotation',[0,0,0,1,0,Math.SQRT1_2,0,Math.SQRT1_2,0,0,0,1],'VEC4');}
  json.buffers[0].byteLength=byteLength;let text=Buffer.from(JSON.stringify(json));text=Buffer.concat([text,Buffer.alloc((4-text.length%4)%4,32)]);const bytes=Buffer.concat(chunks),header=Buffer.alloc(20),binaryHeader=Buffer.alloc(8);header.writeUInt32LE(0x46546c67);header.writeUInt32LE(2,4);header.writeUInt32LE(28+text.length+bytes.length,8);header.writeUInt32LE(text.length,12);header.writeUInt32LE(0x4e4f534a,16);binaryHeader.writeUInt32LE(bytes.length);binaryHeader.writeUInt32LE(0x004e4942,4);result.push({kind,name:({uv:'UV quadrants',alpha:'Alpha blend',skin:'Skin bend',morph:'Morph stretch',clips:'Two clips'})[kind],bytes:Buffer.concat([header,text,binaryHeader,bytes])});
 }
 return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const root=resolve(process.argv[2]??'outputs/model-matrix3d-qa/models');await mkdir(root,{recursive:true});for(const model of await modelMatrix()){await writeFile(join(root,model.kind+'.glb'),model.bytes);console.log(`${model.kind}: ${model.bytes.length} bytes`);}}
