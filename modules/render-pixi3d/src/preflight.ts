import {attachType,decalsType,paintableType} from './place3d';
import {shader3dType,Shader3DSchema,ShaderLibrarySchema,shaderProblems} from './shader3d';
import {mirror3dType} from './mirror3d';
import {lookAtType} from './look3d';
import {highlight3dTypes} from './debug3d';
import {materialSlotProblems} from './materials';
import {is2DEntity,parseScene,type Scene} from '@rewrite/scene';
import {transform3dDefinition,viewport3dDefinition,Viewport3DSchema,transform3dType} from '@rewrite/scene3d';
import {transformDefinition} from '@rewrite/scene';
import {authoring3dDefinitions} from './contracts';
import {modelAnimationDefinition,modelAnimationType,ModelAnimationSchema,resolveModelClip} from './animation-contracts';
import type {AssetRecord} from '@rewrite/assets';
import {Model3DSchema,ModelMetadataSchema,modelComponentType,model3dDefinition,modelAssetType} from './model-contracts';
import {Instances3DSchema,instances3dType} from './instances3d';
import {lutSize} from './color-lut-size';
import {cubeLayout} from './cubemap';
import {Primitive3DSchema} from './contracts';
import {surfaceTextureKeys} from './surface';
const definitions=new Map([transformDefinition,transform3dDefinition,viewport3dDefinition,...authoring3dDefinitions,model3dDefinition,modelAnimationDefinition].map(d=>[d.type,d]));
/** CPU-only capability checks shared by the browser player and export preflight. */
export function runtime3DProblems(input:Scene,asset?:(id:string)=>AssetRecord|undefined,shaders?:unknown):string[]{
 const library=shaders===undefined?undefined:ShaderLibrarySchema.safeParse(shaders??{version:1,items:[]});
 const errors:string[]=[];let scene:Scene;
 try{scene=parseScene(input,definitions);}catch(e){return[String(e)];}
 const all=new Map(scene.entities.map(e=>[e.id,e]));
 const active=(id:string)=>{for(let e=all.get(id);e;e=e.parentId?all.get(e.parentId):undefined)if(!e.active)return false;return true;};
 for(const e of scene.entities){
  for(const c of e.components){const definition=definitions.get(c.type);if(definition&&c.version!==definition.version)errors.push(`${e.name}: unsupported ${c.type} version ${c.version}`);}
  if(e.spatial===transform3dType)for(const c of e.components){
   if(/^(pixi\.|physics\.|layout\.|navigation\.|production\.|multiplayer\.)/.test(c.type)||c.type==='audio.listener'||c.type==='audio.source'&&(c.data as {spatial?:boolean}).spatial)errors.push(`${e.name}: ${c.type} only supports 2D runtime space`);
  }
  const renderer=e.components.find(c=>c.type===modelComponentType&&c.version===1);if(renderer&&asset){const data=Model3DSchema.parse(renderer.data);for(const problem of materialSlotProblems(data,asset(data.assetId)))errors.push(`${e.name}: ${problem}`);}
  for(const c of e.components){if(c.type!==instances3dType||c.version!==1)continue;const data=Instances3DSchema.parse(c.data);if(data.source!=='model')continue;
   if(!data.assetId){errors.push(`${e.name}: choose a GLB model for the instances`);continue;}if(!asset)continue;const record=asset(data.assetId);
   if(!record||record.type!==modelAssetType)errors.push(`${e.name}: instances model asset is missing`);else{const metadata=ModelMetadataSchema.safeParse(record.metadata);if(metadata.success&&(metadata.data.capabilities?.skins??0)>0)errors.push(`${e.name}: skinned models cannot be instanced; use a Model renderer`);}}
  const animation=e.components.find(c=>c.type===modelAnimationType&&c.version===1);if(animation){const data=ModelAnimationSchema.parse(animation.data),model=e.components.find(c=>c.type===modelComponentType&&c.version===1);if(!model||!data.clip)errors.push(`${e.name}: choose a GLB model and animation clip`);else if(asset){try{const metadata=ModelMetadataSchema.parse(asset(Model3DSchema.parse(model.data).assetId)?.metadata);if(!resolveModelClip(metadata.animations,data.clip))errors.push(`${e.name}: animation clip is missing or ambiguous: ${data.clip}`);}catch(error){errors.push(`${e.name}: ${String(error)}`);}}}
  if(asset)for(const c of e.components){if(c.type!=='pixi3d.primitive'||c.version!==1)continue;const data=Primitive3DSchema.parse(c.data);
   for(const key of surfaceTextureKeys){const id=data[key];if(!id)continue;const record=asset(id);if(!record||record.type!=='pixi.texture')errors.push(`${e.name}: the ${key.replace(/Texture$/,'')} map image is missing from the Library`);}
   if(data.videoTexture&&asset(data.videoTexture)?.type!=='media.video')errors.push(`${e.name}: the video is missing from the Library`);}
  if(asset)for(const c of e.components){if(c.type!=='pixi3d.mesh'||c.version!==1)continue;const id=(c.data as {texture?:string}).texture;if(id&&asset(id)?.type!=='pixi.texture')errors.push(`${e.name}: the Mesh 3D colour map is missing from the Library`);}
  if(asset)for(const c of e.components){if(c.type!=='pixi3d.particles'||c.version!==1)continue;const id=(c.data as {textureAsset?:string}).textureAsset;if(id&&asset(id)?.type!=='pixi.texture')errors.push(`${e.name}: the particle image is missing from the Library`);}
  if(asset)for(const c of e.components){if(c.type!=='pixi3d.sprite3d'||c.version!==1)continue;const id=(c.data as {texture?:string}).texture;if(id&&asset(id)?.type!=='pixi.texture')errors.push(`${e.name}: the sprite image is missing from the Library`);}
  if(asset)for(const c of e.components){if(c.type!==modelComponentType||c.version!==1)continue;const d=Model3DSchema.parse(c.data);if(!d.scene)continue;const m=ModelMetadataSchema.safeParse(asset(d.assetId)?.metadata);const names=m.success?m.data.scenes:undefined;if(names&&!names.includes(d.scene))errors.push(`${e.name}: the model has no scene "${d.scene}" (it has ${names.length?names.join(', '):'no named scenes'})`);}
  for(const c of e.components){if(c.type!==shader3dType||c.version!==1)continue;const d=Shader3DSchema.safeParse(c.data);if(!d.success){errors.push(`${e.name}: Shader 3D data is invalid`);continue;}
   const prim=e.components.find(x=>x.type==='pixi3d.primitive')?.data as {portalExitId?:string;feedCameraId?:string;screenSourceId?:string}|undefined,mesh=e.components.some(x=>x.type==='pixi3d.mesh');
   if(!prim&&!mesh)errors.push(`${e.name}: Shader 3D needs a primitive or a Mesh 3D on the same object`);
   if(prim&&(prim.portalExitId||prim.feedCameraId||prim.screenSourceId)||e.components.some(x=>x.type===mirror3dType||x.type===paintableType||x.type===instances3dType))errors.push(`${e.name}: Shader 3D can't go with a portal, mirror, camera or 2D screen, Paintable 3D or instances`);
   if(!d.data.shaderId){errors.push(`${e.name}: Shader 3D needs a shader (Shaders panel)`);continue;}
   if(!library)continue;const item=library.success?library.data.items.find(i=>i.id===d.data.shaderId):undefined;if(!item){errors.push(`${e.name}: Shader 3D: the shader ${d.data.shaderId} is not in this project`);continue;}
   for(const p of shaderProblems(item))errors.push(`${e.name}: shader "${item.name}": ${p}`);
   for(const [name,v] of Object.entries(d.data.values)){const p=item.params.find(x=>x.name===name);if(!p){errors.push(`${e.name}: shader "${item.name}" has no parameter ${name}`);continue;}
    const ok=p.type==='float'?typeof v==='number':p.type==='color'?typeof v==='string'&&/^#[0-9a-fA-F]{6}$/.test(v):p.type==='texture'?typeof v==='string':Array.isArray(v)&&v.length===(p.type==='vec2'?2:4);
    if(!ok)errors.push(`${e.name}: shader "${item.name}": ${name} must be ${p.type==='float'?'a number':p.type==='color'?'a #rrggbb colour':p.type==='texture'?'a Library image':`${p.type==='vec2'?2:4} numbers`}`);
    else if(p.type==='texture'&&v&&asset&&asset(String(v))?.type!=='pixi.texture')errors.push(`${e.name}: shader "${item.name}": the image for ${name} is missing from the Library`);}}
  if(e.components.some(c=>c.type===mirror3dType)){const prim=e.components.find(c=>c.type==='pixi3d.primitive')?.data as {shape?:string;portalExitId?:string;feedCameraId?:string}|undefined;
   if(!prim||prim.shape!=='plane')errors.push(`${e.name}: Mirror 3D needs a plane primitive on the same object (it reflects on the plane's front, +Z)`);else if(prim.portalExitId||prim.feedCameraId)errors.push(`${e.name}: a mirror can't also be a portal or show a camera`);
   if(e.components.some(c=>c.type===instances3dType))errors.push(`${e.name}: mirrors don't work on instanced copies`);}
  if(e.components.some(c=>c.type===paintableType)&&!e.components.some(c=>c.type==='pixi3d.primitive'))errors.push(`${e.name}: Paintable 3D needs a primitive on the same object`);
  for(const c of e.components){if(c.type!==attachType||c.version!==1)continue;const id=(c.data as {targetId?:string}).targetId??'';if(!id)errors.push(`${e.name}: Attach to needs the ID of the object to ride on`);else if(id===e.id)errors.push(`${e.name}: an object can't ride on itself`);else if(all.get(id)?.spatial!=='scene3d.transform')errors.push(`${e.name}: the object it rides on (${id}) is not a 3D object`);}
  if(asset)for(const c of e.components){if(c.type!==decalsType||c.version!==1)continue;const id=(c.data as {image?:string}).image;if(id&&asset(id)?.type!=='pixi.texture')errors.push(`${e.name}: the decal image is missing from the Library`);}
  for(const c of e.components){if(c.type!==lookAtType||c.version!==1)continue;const id=(c.data as {targetId?:string}).targetId??'';if(!id)errors.push(`${e.name}: Look at needs the ID of the object to face`);else if(id===e.id)errors.push(`${e.name}: an object can't look at itself`);else if(all.get(id)?.spatial!=='scene3d.transform')errors.push(`${e.name}: the object it looks at (${id}) is not a 3D object`);}
  if(e.components.some(c=>(highlight3dTypes as readonly string[]).includes(c.type))){if(e.components.some(c=>c.type===instances3dType))errors.push(`${e.name}: outline, wireframe overlay and bounding box don't work on instanced copies yet`);else if(!e.components.some(c=>c.type==='pixi3d.primitive'||c.type===modelComponentType))errors.push(`${e.name}: outline, wireframe overlay and bounding box need a primitive or a model on the same object`);}
  if(e.components.some(c=>c.type==='pixi3d.cameraControl'&&c.version===1)&&!e.components.some(c=>c.type==='pixi3d.camera'))errors.push(`${e.name}: Camera control needs a camera on the same object`);
  for(const c of e.components){if(c.type!=='pixi3d.primitive'||c.version!==1)continue;const d=c.data as {feedCameraId?:string;portalExitId?:string};
   if(d.feedCameraId){const cam=all.get(d.feedCameraId);if(!cam?.components.some(x=>x.type==='pixi3d.camera'))errors.push(`${e.name}: the camera it shows (${d.feedCameraId}) is missing`);else{const viewIds=new Set(scene.entities.flatMap(v=>v.components.filter(x=>x.type==='pixi3d.viewport').map(x=>(x.data as {cameraId?:string}).cameraId)));if(viewIds.has(d.feedCameraId))errors.push(`${e.name}: a view's own camera can't be shown on a surface; add a second camera`);}}
   if(d.portalExitId&&!all.get(d.portalExitId)?.components.some(x=>x.type==='pixi3d.primitive'))errors.push(`${e.name}: the portal exit (${d.portalExitId}) is not a primitive`);}
  for(const c of e.components){if(c.type==='pixi3d.primitive'&&c.version===1){const id=(c.data as {screenSourceId?:string}).screenSourceId;if(id){const source=all.get(id);if(!source||source.spatial===transform3dType)errors.push(`${e.name}: the 2D object it shows (${id}) is missing or not 2D`);}}
   if(c.type==='pixi3d.follow'&&c.version===1){const id=(c.data as {targetId?:string}).targetId;if(!id||all.get(id)?.spatial!==transform3dType)errors.push(`${e.name}: Follow 3D object needs the ID of a 3D object`);}}
  const view=e.components.find(c=>c.type==='pixi3d.viewport'&&c.version===1);if(!view)continue;
  const data=Viewport3DSchema.parse(view.data),camera=all.get(data.cameraId??'');
  let inside=false;for(let n=camera;n?.parentId;){const parent=all.get(n.parentId);if(parent?.id===e.id){inside=true;break;}if(!parent||is2DEntity(parent))break;n=parent;}
  if(data.lutAssetId&&asset){const record=asset(data.lutAssetId),meta=record?.metadata as {width?:unknown;height?:unknown}|undefined;
   if(!record||record.type!=='pixi.texture')errors.push(`${e.name}: the colour LUT image is missing from the Library`);
   else if(typeof meta?.width==='number'&&typeof meta.height==='number'){try{lutSize(meta.width,meta.height);}catch(error){errors.push(`${e.name}: ${(error as Error).message}`);}}}
  if(data.environment==='cubemap'&&data.cubemapAssetId&&asset){const record=asset(data.cubemapAssetId),meta=record?.metadata as {width?:unknown;height?:unknown}|undefined;
   if(!record||record.type!=='pixi.texture')errors.push(`${e.name}: the cube map image is missing from the Library`);
   else if(typeof meta?.width==='number'&&typeof meta.height==='number'){try{cubeLayout(meta.width,meta.height);}catch(error){errors.push(`${e.name}: ${(error as Error).message}`);}}}
  if(!camera||!inside||!camera.components.some(c=>c.type==='pixi3d.camera'&&c.version===1)||!active(camera.id))errors.push(`${e.name}: 3D view needs an active camera inside its own hierarchy`);
 }
 return errors;
}
