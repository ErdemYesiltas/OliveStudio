import {readFile,mkdir,mkdtemp,writeFile,rename,rm,lstat,realpath} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {createRequire} from 'node:module';
import {existsSync,realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {join,dirname,basename,extname,resolve,relative,sep,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {NodeIO,Logger,type GLTF,type Document} from '@gltf-transform/core';
import {KHRLightsPunctual,KHRMaterialsUnlit,KHRMeshQuantization,KHRTextureTransform,EXTMeshoptCompression,KHRDracoMeshCompression,KHRTextureBasisu} from '@gltf-transform/extensions';
import {MeshoptDecoder} from 'meshoptimizer';
import draco3d from 'draco3dgltf';
import sharp from 'sharp';
import type {BuildJob,BuildResult,PreparedSource} from '@rewrite/assets/node';
import {modelImporter,ModelMetadataSchema} from './model-contracts';
const supported=new Set(['KHR_lights_punctual','KHR_materials_unlit','KHR_mesh_quantization','KHR_texture_transform']);
const compressed=new Set(['KHR_draco_mesh_compression','EXT_meshopt_compression','KHR_meshopt_compression','KHR_texture_basisu']);
/** Check allocation/external-resource boundaries before NodeIO instantiates accessors or textures. */
export function preflightGlb(json:GLTF.IGLTF){
 if(json.asset.version!=='2.0')throw Error('Only glTF 2.0 GLB models are supported');
 const used=json.extensionsUsed??[];for(const extension of [...used,...json.extensionsRequired??[]])if(compressed.has(extension))throw Error(`${extension} requires an offline decoder OliveStudio does not ship (EXT_meshopt_compression, KHR_draco_mesh_compression and KHR_texture_basisu are decoded at import); export without that compression`);
 for(const extension of json.extensionsRequired??[])if(!supported.has(extension))throw Error(`Unsupported required GLB extension: ${extension}`);
 for(const buffer of json.buffers??[])if(buffer.uri)throw Error('GLB buffers must be embedded in the container');
 for(const image of json.images??[])if(image.uri&&!/^data:image\/(png|jpeg|webp);base64,/i.test(image.uri))throw Error('GLB images must be embedded PNG, JPEG or WebP (no external files or URLs)');
 if((json.nodes?.length??0)>10000||(json.accessors?.length??0)>10000||(json.materials?.length??0)>1000||(json.images?.length??0)>128)throw Error('GLB exceeds the editor model complexity limits');
 let bytes=0;for(const accessor of json.accessors??[]){const size=({SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT2:4,MAT3:9,MAT4:16} as const)[accessor.type];if(!size||!Number.isSafeInteger(accessor.count)||accessor.count<1||accessor.count>2000000)throw Error('Invalid or oversized GLB accessor');bytes+=accessor.count*size*4;}if(bytes>64*1024*1024)throw Error('Decoded GLB accessors exceed 64 MB');
 const nodes=json.nodes??[],parents=new Map<number,number>(),active=new Set<number>(),done=new Set<number>();
 const walk=(id:number,depth:number)=>{if(!Number.isSafeInteger(id)||!nodes[id])throw Error('Invalid GLB node reference');if(depth>128||active.has(id))throw Error('GLB hierarchy is cyclic or too deep');if(done.has(id))return;active.add(id);for(const child of nodes[id].children??[]){if(parents.has(child)&&parents.get(child)!==id)throw Error('GLB nodes cannot have multiple parents');parents.set(child,id);walk(child,depth+1);}active.delete(id);done.add(id);};for(let i=0;i<nodes.length;i++)walk(i,0);
 for(const mesh of json.meshes??[])for(const primitive of mesh.primitives)if(primitive.mode!==undefined&&primitive.mode!==4)throw Error('Only triangle GLB primitives are supported');
 return used.filter(extension=>!supported.has(extension)).map(extension=>`Optional extension may be ignored: ${extension}`);
}
type Triangle={points:number[][];color:number[];depth:number};
/** A bounded, geometry-based isometric thumbnail; materials are flat approximations, not a GPU render. */
function geometry(doc:Document){const scene=doc.getRoot().getDefaultScene()??doc.getRoot().listScenes()[0];if(!scene)throw Error('GLB has no scene');let vertices=0,triangles=0;const faces:Triangle[]=[],min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
 scene.traverse(node=>{const matrix=node.getWorldMatrix();for(const primitive of node.getMesh()?.listPrimitives()??[]){const pos=primitive.getAttribute('POSITION');if(!pos||pos.getElementSize()!==3)throw Error('GLB mesh needs VEC3 POSITION');vertices+=pos.getCount();if(vertices>2000000)throw Error('GLB scene exceeds two million instanced vertices');const indices=primitive.getIndices(),count=indices?.getCount()??pos.getCount();if(count%3)throw Error('Triangle index count must be a multiple of three');triangles+=count/3;
  const point=(index:number)=>{if(!Number.isInteger(index)||index<0||index>=pos.getCount())throw Error('GLB triangle index is out of range');const p=pos.getElement(index,[]);if(!p.every(Number.isFinite))throw Error('GLB positions must be finite');const world=[matrix[0]*p[0]+matrix[4]*p[1]+matrix[8]*p[2]+matrix[12],matrix[1]*p[0]+matrix[5]*p[1]+matrix[9]*p[2]+matrix[13],matrix[2]*p[0]+matrix[6]*p[1]+matrix[10]*p[2]+matrix[14]];if(!world.every(v=>Number.isFinite(v)&&Math.abs(v)<=1e9))throw Error('GLB bounds are not finite or exceed one billion units');for(let i=0;i<3;i++){min[i]=Math.min(min[i],world[i]);max[i]=Math.max(max[i],world[i]);}return world;};
  // Validate every vertex and index, regardless of the thumbnail triangle budget.
  for(let i=0;i<pos.getCount();i++)point(i);
  const stride=Math.max(1,Math.ceil((count/3)/2048)),color=primitive.getMaterial()?.getBaseColorFactor().slice(0,3)??[.7,.8,.5];
  for(let i=0;i<count;i+=3){const points=[0,1,2].map(j=>point(indices?indices.getScalar(i+j):i+j));if(i/3%stride===0&&faces.length<4096)faces.push({points,color,depth:points.reduce((n,p)=>n+p[0]+p[1]+p[2],0)/3});}
 }});if(!vertices)throw Error('GLB scene has no renderable triangle meshes');return{vertices,triangles,faces,min,max};}
async function thumbnail(faces:Triangle[]){const project=(p:number[])=>[(p[0]-p[2])*.7071,p[1]*-.8165+(p[0]+p[2])*.4082],points=faces.flatMap(f=>f.points.map(project)),xmin=Math.min(...points.map(p=>p[0])),xmax=Math.max(...points.map(p=>p[0])),ymin=Math.min(...points.map(p=>p[1])),ymax=Math.max(...points.map(p=>p[1])),scale=132/Math.max(xmax-xmin,ymax-ymin,.001),projected=(p:number[])=>{const v=project(p);return[80+(v[0]-(xmin+xmax)/2)*scale,80+(v[1]-(ymin+ymax)/2)*scale];};
 const paths=faces.sort((a,b)=>a.depth-b.depth).map(f=>{const [a,b,c]=f.points,u=b.map((v,i)=>v-a[i]),v=c.map((n,i)=>n-a[i]),normal=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],length=Math.hypot(...normal)||1,shade=.45+.55*Math.max(0,(normal[0]*.4+normal[1]*.8+normal[2]*.5)/length),color=f.color.map(n=>Math.round(Math.pow(Math.max(0,Math.min(1,n)),1/2.2)*255*shade));return `<polygon points="${f.points.map(p=>projected(p).map(n=>n.toFixed(2)).join(',')).join(' ')}" fill="rgb(${color.join(',')})"/>`;}).join('');return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><rect width="160" height="160" rx="16" fill="#202a34"/>${paths}</svg>`)).webp({lossless:true}).toBuffer();}
const sourceLimit=20*1024*1024;
async function readContained(root:string,uri:string,limit:number){
 if(/^[a-z][a-z0-9+.-]*:/i.test(uri)||uri.startsWith('//'))throw Error(`glTF resource must be a relative file path: ${uri.slice(0,80)}`);
 let name:string;try{name=decodeURIComponent(uri);}catch{throw Error('glTF resource URI is malformed');}
 if(isAbsolute(name)||name.includes('\0'))throw Error('glTF resource must be a relative file path');
 const path=resolve(root,name),rel=relative(root,path);if(!rel||rel.startsWith('..')||isAbsolute(rel))throw Error('glTF resource escapes the model folder');
 let current=root;for(const part of rel.split(sep)){current=join(current,part);if((await lstat(current)).isSymbolicLink())throw Error('glTF resource symlinks are not supported');}
 const info=await lstat(path);if(!info.isFile()||info.size<1||info.size>limit)throw Error(`glTF resource is missing or too large: ${name.slice(0,80)}`);return readFile(path);
}
/** A .gltf with sibling .bin/image files becomes one self-contained GLB at import, so the stored source, cache and
 * exports stay single-file and the regular GLB preflight still applies. Resources are read here (no network, no
 * folder escape, no symlinks); a .glb passes through unchanged. */
/** Compressed geometry (EXT_meshopt_compression, KHR_draco_mesh_compression) and KTX2 textures (KHR_texture_basisu) are decoded once here, on the import
 * side, and the model is stored uncompressed, so players need no decoder (no extra WASM or CSP) and the regular GLB
 * preflight sees a plain model. */
let dracoDecoder:Promise<unknown>|undefined;
/** The Basis Universal CLI that AssetPack already ships (asar-unpacked in the app). */
/** A package's real folder as seen from `from`, without going through its `exports` map. */
function packageDir(from:string,name:string){const require=createRequire(from);for(const base of require.resolve.paths(name)??[]){const dir=join(base,name);if(existsSync(join(dir,'package.json')))return realpathSync(dir);}throw Error(`${name} is not installed`);}
function basisuPackage(){const own=fileURLToPath(import.meta.url);try{return join(packageDir(own,'@gpu-tex-enc/basis'),'package.json');}catch{
 // The desktop app reaches it through AssetPack (dev builds keep pnpm's strict layout): @assetpack/core → gpu-tex-enc → @gpu-tex-enc/basis.
 const assetpack=packageDir(own,'@assetpack/core'),encoders=packageDir(join(assetpack,'package.json'),'gpu-tex-enc');return join(packageDir(join(encoders,'package.json'),'@gpu-tex-enc/basis'),'package.json');}}
function basisu(){const dir=dirname(basisuPackage()).replace(`${sep}app.asar${sep}`,`${sep}app.asar.unpacked${sep}`);return join(dir,'bin',`${process.platform}-${process.arch}`,process.platform==='win32'?'basisu.exe':'basisu');}
/** KTX2/Basis (ETC1S or UASTC) to PNG through the BC7 RGBA transcode target, base level only, in a private temp folder. */
export async function ktx2ToPng(bytes:Uint8Array):Promise<Uint8Array>{
 if(bytes.length<12||Buffer.from(bytes.subarray(0,12)).toString('latin1')!=='\u00abKTX 20\u00bb\r\n\u001a\n')throw Error('KHR_texture_basisu image is not a KTX2 file');
 const dir=await mkdtemp(join(tmpdir(),'olive-ktx2-'));try{
  await writeFile(join(dir,'t.ktx2'),bytes);
  await new Promise<void>((done,fail)=>execFile(basisu(),['-unpack','t.ktx2','-no_ktx','-format_only','6'],{cwd:dir,timeout:60000,maxBuffer:4*1024*1024,windowsHide:true},error=>error?fail(Error(`KTX2 transcode failed: ${String(error.message).slice(0,200)}`)):done()));
  const png=await readFile(join(dir,'t_unpacked_rgba_BC7_RGBA_0_0000.png'));
  return new Uint8Array(await sharp(png,{limitInputPixels:8192*8192,failOn:'error'}).png().toBuffer());
 }finally{await rm(dir,{recursive:true,force:true});}
}
async function decodeCompressed(io:NodeIO,json:GLTF.IGLTF,read:(io:NodeIO)=>Promise<Document>):Promise<Uint8Array>{
 const used=new Set([...json.extensionsUsed??[],...json.extensionsRequired??[]]),decoding=new NodeIO().setAllowNetwork(false).setStrictResources(true).setLogger(new Logger(Logger.Verbosity.SILENT)).registerExtensions([KHRLightsPunctual,KHRMaterialsUnlit,KHRMeshQuantization,KHRTextureTransform,EXTMeshoptCompression,KHRDracoMeshCompression,KHRTextureBasisu]);
 if(used.has('EXT_meshopt_compression')){await MeshoptDecoder.ready;decoding.registerDependencies({'meshopt.decoder':MeshoptDecoder});}
 if(used.has('KHR_draco_mesh_compression'))decoding.registerDependencies({'draco3d.decoder':await (dracoDecoder??=draco3d.createDecoderModule())});
 const doc=await read(decoding);
 for(const texture of doc.getRoot().listTextures())if(texture.getMimeType()==='image/ktx2'){const data=texture.getImage();if(!data)throw Error('KTX2 texture data is missing');texture.setImage(await ktx2ToPng(data)).setMimeType('image/png');if(texture.getURI())texture.setURI(texture.getURI().replace(/\.ktx2$/i,'.png'));}
 for(const extension of doc.getRoot().listExtensionsUsed())if(['EXT_meshopt_compression','KHR_draco_mesh_compression','KHR_texture_basisu'].includes(extension.extensionName))extension.dispose();return io.writeBinary(doc);
}
const compressedGeometry=(json:GLTF.IGLTF)=>[...json.extensionsUsed??[],...json.extensionsRequired??[]].some(e=>e==='EXT_meshopt_compression'||e==='KHR_draco_mesh_compression'||e==='KHR_texture_basisu');
const glbJson=(bytes:Uint8Array):GLTF.IGLTF|null=>{const view=Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength);if(view.length<20||view.readUInt32LE(0)!==0x46546c67||view.readUInt32LE(16)!==0x4e4f534a)return null;const length=view.readUInt32LE(12);if(length>view.length-20)return null;try{return JSON.parse(view.subarray(20,20+length).toString('utf8'));}catch{return null;}};
export async function prepareModel(path:string):Promise<PreparedSource>{
 const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink())throw Error('Choose a regular model file');
 const extension=extname(path).toLowerCase(),name=basename(path,extname(path)).slice(0,120);
 const plain=()=>new NodeIO().setAllowNetwork(false).setStrictResources(true).setLogger(new Logger(Logger.Verbosity.SILENT)).registerExtensions([KHRLightsPunctual,KHRMaterialsUnlit,KHRMeshQuantization,KHRTextureTransform]);
 if(extension==='.glb'){let bytes:Uint8Array=await readFile(path);if(bytes.length!==info.size||bytes.length>sourceLimit)throw Error('GLB changed during import or exceeds 20 MB');const json=glbJson(bytes);
  if(json&&compressedGeometry(json)){const source=bytes;bytes=await decodeCompressed(plain(),json,io=>io.readBinary(source));if(bytes.length>sourceLimit)throw Error('Decompressed GLB exceeds 20 MB');}return{name,extension:'glb',bytes};}
 if(extension!=='.gltf')throw Error('Choose a .glb or .gltf model');
 const root=await realpath(dirname(path)),text=await readContained(root,basename(path),8*1024*1024);let json:GLTF.IGLTF;try{json=JSON.parse(text.toString('utf8'));}catch{throw Error('glTF JSON is invalid');}
 if(json?.asset?.version!=='2.0')throw Error('Only glTF 2.0 models are supported');
 const resources:Record<string,Uint8Array<ArrayBuffer>>={};let total=text.length;
 const take=async(uri:string|undefined,data:RegExp)=>{if(!uri||data.test(uri)||uri in resources)return;const bytes=await readContained(root,uri,sourceLimit);total+=bytes.length;if(total>sourceLimit)throw Error('glTF model and its resources exceed 20 MB');resources[uri]=new Uint8Array(bytes);};
 if((json.buffers?.length??0)>64||(json.images?.length??0)>128)throw Error('glTF has too many buffers or images');
 for(const buffer of json.buffers??[])await take(buffer.uri,/^data:application\/(octet-stream|gltf-buffer);base64,/i);
 for(const image of json.images??[]){if(image.uri&&/^data:/i.test(image.uri)&&!/^data:image\/(png|jpeg|webp|ktx2);base64,/i.test(image.uri))throw Error('glTF images must be PNG, JPEG, WebP or KTX2');await take(image.uri,/^data:image\/(png|jpeg|webp|ktx2);base64,/i);}
 const io=plain(),bytes=compressedGeometry(json)?await decodeCompressed(io,json,reader=>reader.readJSON({json,resources})):await io.writeBinary(await io.readJSON({json,resources}));if(bytes.length>sourceLimit)throw Error('Packed GLB exceeds 20 MB');return{name,extension:'glb',bytes};
}
export async function buildModel(job:BuildJob):Promise<BuildResult>{if(job.importerId!==modelImporter.id||job.asset.type!==modelImporter.assetType||job.asset.source.extension!=='glb')throw Error('Unknown GLB model job');const asset=job.asset,bytes=await readFile(join(job.root,'sources',`${asset.id}-${asset.revision}.glb`));if(bytes.length!==asset.source.bytes||createHash('sha256').update(bytes).digest('hex')!==asset.revision)throw Error('GLB source checksum mismatch');
 const io=new NodeIO().setAllowNetwork(false).setStrictResources(true).setLogger(new Logger(Logger.Verbosity.SILENT)).registerExtensions([KHRLightsPunctual,KHRMaterialsUnlit,KHRMeshQuantization,KHRTextureTransform]);if(bytes.length<20||bytes.readUInt32LE(0)!==0x46546c67||bytes.readUInt32LE(4)!==2||bytes.readUInt32LE(8)!==bytes.length||bytes.readUInt32LE(16)!==0x4e4f534a||bytes.readUInt32LE(12)>bytes.length-20)throw Error('Invalid or truncated GLB 2.0 container');const raw=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString('utf8')) as GLTF.IGLTF,warnings=preflightGlb(raw),doc=await io.readBinary(bytes);let pixels=0;
 const textures:{width:number;height:number;format:string}[]=[];for(const image of doc.getRoot().listTextures()){const data=image.getImage();if(!data)throw Error('Embedded model image is missing');const meta=await sharp(data,{limitInputPixels:8192*8192,failOn:'error'}).metadata();if(!meta.width||!meta.height||!['png','jpeg','webp'].includes(meta.format??'')||(meta.pages??1)>1)throw Error('Model images must be static PNG, JPEG or WebP up to 8192²');pixels+=meta.width*meta.height;textures.push({width:meta.width,height:meta.height,format:meta.format!});}if(pixels>64*1024*1024)throw Error('Embedded model textures exceed 64 million pixels');
 const data=geometry(doc),root=doc.getRoot(),primitives=root.listMeshes().flatMap(m=>m.listPrimitives());
 const capabilities={skins:root.listSkins().length,maxJoints:Math.max(0,...root.listSkins().map(skin=>skin.listJoints().length)),jointInfluences:Math.max(0,...primitives.map(p=>p.getAttribute('JOINTS_1')?8:p.getAttribute('JOINTS_0')?4:0)),morphTargets:Math.max(0,...primitives.map(p=>p.listTargets().length)),textures,texturePixels:pixels};
 // Advisory budget, measured on the import side; the hard limits above still refuse a model outright.
 const budget=[...data.triangles>300000?[`Heavy model: ${data.triangles} triangles (budget 300000)`]:[],...pixels>4096*4096?[`Large textures: ${Math.round(pixels/1e6)} million pixels (budget 16.8 million)`]:[],...capabilities.jointInfluences>4?['Uses 8 joint influences per vertex; only the first 4 are drawn']:[],...capabilities.maxJoints>256?[`Skeleton has ${capabilities.maxJoints} joints (budget 256)`]:[]];
 const metadata=ModelMetadataSchema.parse({pipeline:'gltf-transform-4.5.1/glb-v1',nodes:root.listNodes().length,meshes:root.listMeshes().length,vertices:data.vertices,triangles:data.triangles,bounds:{min:data.min,max:data.max},materials:root.listMaterials().map((m,index)=>({index,name:m.getName()||`Material ${index+1}`})),scenes:root.listScenes().map(scene=>scene.getName()).filter(Boolean),animations:root.listAnimations().map((a,index)=>({name:a.getName()||`anim_${index}`,duration:Math.max(0,...a.listSamplers().map(s=>{const input=s.getInput();return input?.getCount()?input.getScalar(input.getCount()-1):0;}))})),warnings:[...warnings,...budget],capabilities});
 const temporary=await mkdtemp(join(job.root,'model-build-')),target=join(job.root,'cache',`${asset.id}-${asset.revision}`);try{await mkdir(target,{recursive:true});for(const [name,contents] of [['model.glb',raw.images?.some(image=>image.uri)?Buffer.from(await io.writeBinary(doc)):bytes],['thumb.webp',await thumbnail(data.faces)]] as const){await writeFile(join(temporary,name),contents);await rename(join(temporary,name),join(target,name));}}finally{await rm(temporary,{recursive:true,force:true});}
 return{metadata,files:[{name:'model.glb',mime:'model/gltf-binary'},{name:'thumb.webp',mime:'image/webp'}]};}

export {buildEnvironment,decodeRadiance} from './environment.node';
export {prepareCubeLut} from './cube-lut.node';
export {buildVideo} from './video.node';
