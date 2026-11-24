import {materialSlotProblems} from './materials';
import {modelSourcePorts} from './model-loader';
import {SharedModelSources} from './shared-model-sources';
// Browser-only 3D projection shared by authoring and game integrations. No editor UI or clock.
import 'pixi.js/unsafe-eval';
import {Box,BatchedMesh3D,Matrix4,Vector3,Quaternion,Sphere,RenderPassBit,srgbToLinear,type ShaderBit,type Geometry3D,type BaseMaterial3D,ParticleContainer3D,View3D,Container3D,Model3D,type Scene3DSource,Mesh3D,MeshPass,type Skeleton,Sprite3D as PixiSprite3D,Geometry3D as PixiGeometry3D,getAttributeData,CubeGeometry,SphereGeometry,PlaneGeometry,CylinderGeometry,ConeGeometry,CapsuleGeometry,TorusGeometry,TorusKnotGeometry,IcosahedronGeometry,Material3D,PhongMaterial,FlatMaterial,Camera3D,DirectionalLight,AmbientLight,PointLight,SpotLight} from '@pixi/3d';
import {RenderTexture,CubeTexture,Texture,Rectangle,type Container as PixiContainer,TextureStyle,Matrix,Color,RendererType,type TextureSource,type Container,type Renderer,type PointData,} from 'pixi.js';
import type {Scene,Entity} from '@rewrite/scene';
import {transform3D,Viewport3DSchema,type Transform3D} from '@rewrite/scene3d';
import {ModelResources,type ModelAssetPort} from './model-resources';
import {Model3DSchema,modelComponentType,ModelPoseQuerySchema,ModelDeformationQuerySchema} from './model-contracts';
import {Primitive3DSchema,Camera3DSchema,Light3DSchema,lightShadow} from './contracts';
import {installCspUniformCompatibility} from './csp';
import {DeformedHitVolume} from './deformed-pick';
import {environmentSourcePorts,environmentAssetType,EnvironmentMetadataSchema} from './environment';
import {BloomEffect,SsaoEffect,TiltShiftEffect,TintEffect,FxaaEffect,MotionBlurEffect,ToonMaterial,OutlinePass,WireframePass,VelocityViewer,OrbitCamera,FPSCamera,PortalMaterial,PortalPass} from '@pixi/3d/extras';
import {CameraControlSchema,cameraControlType,yawPitch,type CameraControl} from './camera-control';
import {FollowSchema,followType,type Follow} from './follow';
import {BoneAimSchema,boneAimType,morphKeys,type BoneAim} from './rig';
import {DraggableSchema,draggableType,rayPlane,snapTo,type Draggable} from './interaction3d';
import {uvMatrix,scrolls,surfaceTextureKeys,sheenOn,renderState,type Surface,type SurfaceTextureKey} from './surface';
import {Instances3DSchema,instances3dType,instanceLayout,instanceMatrix,instanceColors,InstancesHitVolume,unitBox,maxInstanceSlots,type Instances3D,type InstanceBox} from './instances3d';
import {ColorLutEffect} from './color-lut';
import {edgeIndices,lodShapes} from './shapes';
import {cubeLayout,cubeFaces,lodFar,type CubeFace} from './cubemap';
import {Sprite3DSchema,sprite3dType} from './sprite3d';
import {videoAssetType,videoFile,VideoMetadataSchema} from './video-contracts';
import {decalsType,attachType,paintableType,DecalsSchema,AttachSchema,PaintableSchema,decalLook,hoverChanges,strokeDabs,boxAtlasUvs,type Decals,type Attach,type Paintable} from './place3d';
import {mesh3dType,Mesh3DSchema,buildScriptGeometry,standInGeometry,batch3dType,Batch3DSchema,batchStride,particleStride,type ScriptGeometry} from './mesh3d';
import {shader3dType,Shader3DSchema,ShaderLibrarySchema,emptyShaderLibrary,shaderBits,shaderHash,shaderProblems,ShaderMaterial3D,fingerprint,type ShaderItem,type ShaderLibrary} from './shader3d';
import type {ShaderValidatorPort,ShaderBackend} from './shader3d-validator';
import {mirror3dType,Mirror3DSchema,MirrorMaterial,MirrorPass} from './mirror3d';
import {lookAtType,pointerFollowType,LookAtSchema,PointerFollowSchema,lookRotation,slerp,alignUp,type LookAt,type PointerFollow} from './look3d';
import {outline3dType,wireframeOverlayType,boundsHelperType,highlight3dTypes,WireframeOverlaySchema,BoundsHelperSchema,Outline3DSchema,worldBox} from './debug3d';
import {Particles3DSchema,particle3dType,particle3DState,writeParticle3D,EmitterHistory,type Particles3D} from './particles3d';
const sourcePorts=modelSourcePorts();
const sharedSources=new SharedModelSources<Scene3DSource>(sourcePorts.load,sourcePorts.unload);
const defaultSources={load:(url:string)=>sharedSources.load(url),unload:(url:string,source:Scene3DSource)=>sharedSources.unload(url,source)};
interface Resource{destroy():void}
/** Multiplies a batched copy's albedo by its linear-light `tint` instance field (white material, per-copy colour). */
const instanceTintBit:ShaderBit={name:'instance-tint',bindings:{instance:{tint:'vec4<f32>'}},gpu:{fragment:{material:'albedo *= instance.tint.rgb;'}},gl:{fragment:{material:'albedo *= instance.tint.rgb;'}}};
const particleTextures=new Map<string,Texture>();
/** Built once per kind and never destroyed: views rebuild on every edit and would otherwise leak a canvas texture each time. */
function particleTexture(kind:Particles3D['particleTexture']){if(kind==='square'||typeof document==='undefined')return Texture.WHITE;let texture=particleTextures.get(kind);if(texture)return texture;
 const canvas=document.createElement('canvas');canvas.width=canvas.height=64;const ctx=canvas.getContext('2d');if(!ctx)return Texture.WHITE;
 if(kind==='soft'){const g=ctx.createRadialGradient(32,32,0,32,32,32);g.addColorStop(0,'#ffffff');g.addColorStop(.3,'#ffffffcc');g.addColorStop(1,'#ffffff00');ctx.fillStyle=g;ctx.fillRect(0,0,64,64);}else{ctx.fillStyle='#ffffff';ctx.beginPath();ctx.arc(32,32,31,0,Math.PI*2);ctx.fill();}
 texture=Texture.from(canvas);particleTextures.set(kind,texture);return texture;}
/** A just-made container's world transform, before the next render computes it. */
const refreshSpace=(n:Container3D)=>{n.getGlobalTransform(n.worldTransform);};
const decalTextures=new Map<string,Texture>();
/** Built-in decal shapes, white on transparent so the decal colour tints them; built once and kept, like particle dots. */
function decalTexture(shape:Decals['shape']){let texture=decalTextures.get(shape);if(texture)return texture;if(typeof document==='undefined')return Texture.WHITE;
 const canvas=document.createElement('canvas');canvas.width=canvas.height=128;const ctx=canvas.getContext('2d');if(!ctx)return Texture.WHITE;ctx.fillStyle='#ffffff';ctx.strokeStyle='#ffffff';
 if(shape==='ring'){ctx.lineWidth=14;ctx.beginPath();ctx.arc(64,64,48,0,Math.PI*2);ctx.stroke();}
 else if(shape==='star'){ctx.beginPath();for(let k=0;k<10;k++){const r=k%2?24:58,a=k*Math.PI/5-Math.PI/2;ctx.lineTo(64+Math.cos(a)*r,64+Math.sin(a)*r);}ctx.closePath();ctx.fill();}
 else{ctx.beginPath();for(let k=0;k<=48;k++){const a=k/48*Math.PI*2,r=40+10*Math.sin(a*5)+6*Math.sin(a*11+1);ctx.lineTo(64+Math.cos(a)*r,64+Math.sin(a)*r);}ctx.fill();for(let k=0;k<7;k++){const a=k*0.9+.3,r=50+k%3*5;ctx.beginPath();ctx.arc(64+Math.cos(a)*r,64+Math.sin(a)*r,4+k%3*2,0,Math.PI*2);ctx.fill();}}
 texture=Texture.from(canvas);decalTextures.set(shape,texture);return texture;}
interface Highlight3D{entityId:string;kind:'outline'|'wireframe'|'bounds';enabled:boolean;node:Container3D;toonInk:boolean;overlay?:Mesh3D;box?:Mesh3D;applied?:boolean;meshes?:number}
export interface ModelInstance{key:string;ready:boolean;error?:string;instance?:Model3D;pending?:Promise<void>}
export interface ProjectedView3D{
 id:string;host:Container;view:View3D;defaultCamera:Camera3D;cameraId?:string;
 nodes:Map<string,Container3D>;cameras:Map<string,Camera3D>;models:Map<string,ModelInstance>;
 resources:Resource[];releases:(()=>void)[];
 /** Pending asset loads besides models (GLB instances), part of the readiness gate. */
 loads:{pending?:Promise<void>;error?:string}[];
 /** Player camera controls by camera entity, started by `useSceneCameras`, and the one running. */
 controls?:Map<string,CameraControl>;feedSizes?:Map<string,{width:number;height:number}>;controller?:{destroy():void;camera:Camera3D;node:Container3D};
 /** Models posed by hand after their clip: morph weights, and bones aimed at another object (bone found once loaded). */
 /** Objects the player can drag, by entity. */
 drags?:Map<string,Draggable>;
 morphs?:{entityId:string;weights:number[]}[];aims?:{entityId:string;data:BoneAim;missing?:boolean}[];
 /** Surfaces showing a live 2D object, captured each frame by `setParticleTime`. */
 screens?:{sourceId:string;texture:RenderTexture;owner:string;missing?:boolean}[];
 /** Surfaces showing a camera's feed, and portal entries with their exit object, resolved once every node exists. */
 feeds?:{material:{textures:object};cameraId:string;owner:string}[];portals?:{entry:Mesh3D;exitId:string;texture:RenderTexture;owner:string}[];mirrors?:{mesh:Mesh3D;texture:RenderTexture}[];scriptMeshes?:{entityId:string;mesh:Mesh3D;geometryId:string}[];scriptGeometries?:Map<string,Geometry3D>;standIn?:Geometry3D;batches?:{entityId:string;batch:BatchedMesh3D;material:BaseMaterial3D;size:number;version:number;shown:string[]}[];shaded?:{entityId:string;material:BaseMaterial3D;item:ShaderItem;textures:Record<string,string>}[];shaderChecks?:Promise<unknown>[];shaderCandidates?:{owner:string;item:ShaderItem;key:string;make():BaseMaterial3D;attributes:{uv:boolean;color:boolean;color1:boolean}}[];
 /** Meshes that swap to a coarser geometry far from the camera, checked by `setParticleTime`. */
 lods?:{mesh:Mesh3D;near:Geometry3D;far:Geometry3D;distance:number;isFar:boolean}[];
 /** Set while building when a toon surface wants the ink outline, so the view gets an OutlinePass. */
 outline?:boolean;
 /** Outline, wireframe overlay and bounding-box add-ons; `enabled` changes without a rebuild. */
 highlights?:Highlight3D[];
 /** Objects turning toward a target while the view looks through its scene camera; `base` is the authored rotation. */
 looks?:{entityId:string;node:Container3D;data:LookAt;base:[number,number,number,number]}[];
 /** Objects that follow the pointer's point in the scene while the game runs. */
 pointerFollows?:{entityId:string;node:Container3D;data:PointerFollow}[];
 /** Decal stampers (one per view is typical) and the decals stamped so far, oldest first. */
 decals?:{entityId:string;data:Decals;stamped:Mesh3D[];count:number;texture?:Texture}[];
 /** Objects that ride on another while their attach add-on is on; `offset` is the hold taken when it switched on. */
 attaches?:{entityId:string;node:Container3D;data:Attach;offset?:Matrix4}[];
 decalSpaces?:Container3D[];
 /** Paintable primitives: their paint canvas and the brush settings changed at run time. */
 paints?:{entityId:string;data:Paintable;fill:string;box:boolean;canvas?:HTMLCanvasElement;texture?:Texture}[];
 /** Colour of the wireframe pass that draws models' overlays (one per view). */
 modelWireframe?:string;
 /** Surfaces whose UVs scroll, rewritten by `setParticleTime`. */
 surfaces?:{material:Material3D|PhongMaterial|FlatMaterial|ToonMaterial;data:Surface;flipV:boolean}[];
 /** Emitters written by `setParticleTime`; destroyed with the view. */
 particles:{container?:ParticleContainer3D;data:Particles3D;node:Container3D;entityId:string;history?:EmitterHistory}[];
 /** Pending HDR environment load, part of the readiness gate. */
 environment?:Promise<void>;
}
export interface ProjectionContext{
 node(id:string):Container|undefined;renderer?:Renderer;changed():void;report(error:unknown):void;
 flags?(id:string):{hidden:boolean;locked:boolean};beforeClear?():void;
 /** While the game runs: a dragged object's new local position (to write into the running scene), and pointer events for rules. */
 moved?(id:string,pose:{x:number;y:number;z:number;qx?:number;qy?:number;qz?:number;qw?:number}):void;emit?(type:string,sourceId:string):void;
 /** Shader 3D: the project's shaders, the hidden-app checker every shader passes first, and non-fatal notices (a shader that falls back). */
 shaderLibrary?():ShaderLibrary;shaderValidator?:ShaderValidatorPort;warn?(message:string):void;
 /** Rebuild from the current scene now (a shader check finished); hosts that sync every frame can leave it out. */
 resync?():void;
}
export function applyPose3D(node:Container3D,t:Transform3D){node.position.set(t.x,t.y,t.z);node.quaternion.set(t.qx,t.qy,t.qz,t.qw);node.scale.set(t.scaleX,t.scaleY,t.scaleZ);}
export function visible3D(node:Container3D){for(let p:Container3D|null=node;p;p=p.parent)if(!p.visible)return false;return true;}
export class Scene3DProjection{
 readonly slots:ProjectedView3D[]=[];readonly resources?:ModelResources<Scene3DSource>;
 /** Hovered object and drag per view, kept across rebuilds so a rebuild mid-hover still raises the leave; cleared when Play ends. */
 private pointers=new Map<string,{paint?:{entityId:string;last?:{u:number;v:number}};hovered?:string;chain?:string[];press?:{x:number;y:number};drag?:{id:string;normal:Vector3;offset:Vector3;point:Vector3;data:Draggable};dragged?:boolean}>();
 /** Script-made shapes for Mesh 3D (play-session data): kept here so a view rebuild rebuilds them; cleared with the session. */
 private scripted={geometries:new Map<string,ScriptGeometry>(),meshes:new Map<string,string>(),morphs:new Map<string,number[]>(),
  particles:new Map<string,{data:Float32Array;count:number}>(),batches:new Map<string,{geometries:string[];data:Float32Array;count:number;version:number}>()};
 private signature='';private dead=false;private revision=0;private invalidate!:()=>void;private changed=new Promise<void>(resolve=>{this.invalidate=resolve;});
 constructor(readonly context:ProjectionContext,assets?:ModelAssetPort,sources=defaultSources){
  if(context.renderer)installCspUniformCompatibility(context.renderer);
  if(assets)this.resources=new ModelResources(assets,sources.load,sources.unload,context.report);
 }
 private key(scene:Scene){const byId=new Map(scene.entities.map(e=>[e.id,e]));
  // Which view a 3D object is in, not its parent: moving it to another parent in the same view keeps the build (update() moves the node).
  const viewOf=(e:Entity)=>{if(e.spatial!=='scene3d.transform')return e.parentId;for(let p=byId.get(e.parentId??''),n=0;p&&n<10000;p=byId.get(p.parentId??''),n++)if(p.spatial!=='scene3d.transform')return p.id;return null;};
  return JSON.stringify([scene.id,scene.entities.filter(e=>e.spatial==='scene3d.transform'||e.components.some(c=>c.type==='pixi3d.viewport')).map(e=>({id:e.id,view:viewOf(e),components:e.components.filter(c=>c.type!=='scene3d.transform'&&c.type!=='scene.transform2d').map(c=>[c.type,c.version,c.type===particle3dType?{...c.data as object,startedAt:undefined,stoppedAt:undefined}:(highlight3dTypes as readonly string[]).includes(c.type)||c.type===attachType?{...c.data as object,enabled:undefined}:c.type===paintableType?{...c.data as object,brushColor:undefined,clears:undefined}:c.type===shader3dType?this.shaderKey(c.data):c.data])})),scene.entities.flatMap(e=>e.components.filter(c=>c.type===modelComponentType&&c.version===1).map(c=>this.resources?.key(Model3DSchema.parse(c.data).assetId)??'')),scene.entities.flatMap(e=>e.components.filter(c=>c.type===followType).map(c=>[e.id,c.data])),scene.entities.flatMap(e=>e.components.filter(c=>c.type===instances3dType&&c.version===1&&(c.data as {source?:string}).source==='model').map(c=>this.resources?.key(String((c.data as {assetId?:string}).assetId??''))??''))]);}
 /** Pose/active/visibility edits preserve Model3D, animation state and GPU resources. */
 sync(scene:Scene){if(this.dead)throw Error('3D projection disposed');const signature=this.key(scene),rebuild=signature!==this.signature||this.slots.some(s=>this.context.node(s.id)!==s.host);
  if(rebuild){this.clear();try{this.build(scene);this.signature=signature;}catch(error){this.clear();throw error;}}
  this.update(scene);this.setParticleTime(this.particleTime);return rebuild;
 }
 update(scene:Scene){const entities=new Map(scene.entities.map(e=>[e.id,e]));
  for(const slot of this.slots)for(const b of slot.batches??[])this.applyBatch(slot,b);
  for(const slot of this.slots)for(const sh of slot.shaded??[]){const c=entities.get(sh.entityId)?.components.find(c=>c.type===shader3dType);if(c)this.writeShaderValues(slot,sh,Shader3DSchema.parse(c.data));}
  for(const slot of this.slots)for(const m of slot.scriptMeshes??[]){const wanted=this.scripted.meshes.get(m.entityId)??'';if(wanted!==m.geometryId){m.mesh.geometry=this.scriptGeometry(slot,wanted);m.geometryId=wanted;}this.applyMorph(m.mesh,m.entityId);}
  for(const slot of this.slots)for(const paint of slot.paints??[]){const d=entities.get(paint.entityId)?.components.find(c=>c.type===paintableType)?.data as Partial<Paintable>|undefined;if(!d)continue;if(d.brushColor&&d.brushColor!==paint.data.brushColor)paint.data={...paint.data,brushColor:d.brushColor};if(d.clears!==undefined&&d.clears!==paint.data.clears){paint.data={...paint.data,clears:d.clears};this.fillPaint(paint);}}
  for(const slot of this.slots)for(const a of slot.attaches??[]){const c=entities.get(a.entityId)?.components.find(c=>c.type===attachType);if(c)a.data={...a.data,enabled:(c.data as {enabled?:boolean}).enabled===true};}
  for(const slot of this.slots)for(const h of slot.highlights??[]){const type=h.kind==='outline'?outline3dType:h.kind==='wireframe'?wireframeOverlayType:boundsHelperType,c=entities.get(h.entityId)?.components.find(c=>c.type===type);if(c)h.enabled=(c.data as {enabled?:boolean}).enabled!==false;}
  // Play / Stop actions change only when an emitter starts and stops, which is outside the rebuild signature.
  for(const slot of this.slots)for(const entry of slot.particles){const c=entities.get(entry.entityId)?.components.find(c=>c.type===particle3dType),d=c?.data as {startedAt?:number|null;stoppedAt?:number|null}|undefined;if(d&&(d.startedAt!==entry.data.startedAt||d.stoppedAt!==entry.data.stoppedAt))entry.data={...entry.data,startedAt:d.startedAt,stoppedAt:d.stoppedAt};}for(const slot of this.slots){this.reparentNodes(slot,entities);for(const [id,node]of slot.nodes){const entity=entities.get(id);if(!entity){node.visible=false;continue;}applyPose3D(node,transform3D(entity));const flags=this.context.flags?.(id);node.visible=entity.active&&!flags?.hidden;node.eventMode=flags?.locked?'none':'static';}}
  for(const slot of this.slots)for(const look of slot.looks??[]){const q=look.node.quaternion;look.base=[q.x,q.y,q.z,q.w];}}
 private shaderLibrary(){const raw=this.context.shaderLibrary?.();if(!raw)return emptyShaderLibrary();const parsed=ShaderLibrarySchema.safeParse(raw);return parsed.success?parsed.data:emptyShaderLibrary();}
 /** The rebuild signature of a Shader 3D add-on: which shader and its code, not its values (update() writes those). */
 private shaderKey(data:unknown){const d=Shader3DSchema.safeParse(data),item=d.success?this.shaderLibrary().items.find(i=>i.id===d.data.shaderId):undefined;return{shaderId:d.success?d.data.shaderId:'',hash:item?shaderHash(item):'',checked:item&&d.success?this.shaderStates.get(d.data.shaderId):undefined};}
 private shaderStates=new Map<string,string>();private shaderWarned=new Set<string>();
 private shaderWarn(key:string,message:string){if(this.shaderWarned.has(key))return;this.shaderWarned.add(key);if(this.context.warn)this.context.warn(message);else this.context.report(Error(message));}
 private backend():ShaderBackend{return this.context.renderer?.name==='webgpu'?'webgpu':'webgl';}
 /**
  * The material an object draws with when it has a Shader 3D: the shader joins only after it compiled and drew on this
  * view's backend in the hidden checker. Until then, and if it fails, the object keeps its own material.
  */
 private shaded(slot:ProjectedView3D,e:Entity,base:BaseMaterial3D,geometry:Geometry3D,color:string):BaseMaterial3D{const c=e.components.find(c=>c.type===shader3dType&&c.version===1);if(!c)return base;
  const data=Shader3DSchema.parse(c.data),item=this.shaderLibrary().items.find(i=>i.id===data.shaderId);
  if(!item){this.shaderWarn(`missing:${e.id}:${data.shaderId}`,`${e.name}: Shader 3D: no shader ${data.shaderId||'(none chosen)'} in this project`);return base;}
  const problems=shaderProblems(item);if(problems.length){this.shaderWarn(`static:${shaderHash(item)}`,`${e.name}: shader "${item.name}": ${problems.join('; ')}`);return base;}
  const make=()=>item.kind==='extra'?base.clone({extraBits:[...base.extraBits,...shaderBits(item)]}):new ShaderMaterial3D(item,color);
  const attributes={uv:'aUV' in geometry.attributes,color:'aColor' in geometry.attributes,color1:'aColor1' in geometry.attributes},backend=this.backend(),key=`${shaderHash(item)}|${item.kind}|${base.constructor.name}|${geometry.attributeKey}`;
  const validator=this.context.shaderValidator;(slot.shaderCandidates??=[]).push({owner:e.name,item,key,make,attributes});
  let ready=!validator;
  if(validator){const result=validator.peek(key,backend);
   if(!result){const check=validator.check(key,backend,()=>({material:make(),attributes,code:{webgl:fingerprint(item,'glsl'),webgpu:fingerprint(item,'wgsl')}})).then(r=>{if(this.dead)return;this.shaderStates.set(item.id,`${shaderHash(item)}:${r.state}`);
     if(r.state==='failed')this.shaderWarn(`failed:${key}:${backend}`,`${e.name}: shader "${item.name}" does not compile on ${backend === 'webgpu' ? 'WebGPU' : 'WebGL'}: ${r.errors.map(x=>`${x.section?`${x.section} line ${x.line}: `:''}${x.message}`).join(' | ')}`);
     this.signature='';if(this.context.resync)queueMicrotask(()=>{if(!this.dead)this.context.resync!();});else this.context.changed();});(slot.shaderChecks??=[]).push(check);}
   else if(result.state==='failed')this.shaderWarn(`failed:${key}:${backend}`,`${e.name}: shader "${item.name}" does not compile: ${result.errors.map(x=>`${x.section?`${x.section} line ${x.line}: `:''}${x.message}`).join(' | ')}`);
   ready=result?.state==='ok';}
  if(!ready)return base;
  const material=make();slot.resources.push(material);(slot.shaded??=[]).push({entityId:e.id,material,item,textures:{}});this.writeShaderValues(slot,(slot.shaded!.at(-1))!,data);return material;}
 /**
  * Before Play: every shader the views use, checked on each backend (as it will draw: the object's real base material
  * and attributes). Failures with the user's section and line; a backend this machine lacks is skipped, not a failure.
  */
 async verifyShaders(backends:readonly ShaderBackend[]=['webgl','webgpu']){const validator=this.context.shaderValidator;if(!validator)return[];const out:string[]=[],seen=new Set<string>();
  for(const slot of this.slots)for(const c of slot.shaderCandidates??[])for(const backend of backends){const id=`${backend}|${c.key}`;if(seen.has(id))continue;seen.add(id);
   const r=await validator.check(c.key,backend,()=>({material:c.make(),attributes:c.attributes,code:{webgl:fingerprint(c.item,'glsl'),webgpu:fingerprint(c.item,'wgsl')}}));
   if(r.state==='failed')out.push(`${c.owner}: shader "${c.item.name}" does not compile on ${backend==='webgpu'?'WebGPU':'WebGL'}: ${r.errors.map(x=>`${x.section?`${x.section} line ${x.line}: `:''}${x.message}`).join(' | ')}`);}
  return out;}
 /** Parameter values onto a shader material: numbers, colours (linear), vectors, and Library images for textures. */
 private writeShaderValues(slot:ProjectedView3D,entry:NonNullable<ProjectedView3D['shaded']>[number],data:{values:Record<string,unknown>}){const m=entry.material,store=m.data as unknown as Record<string,unknown>;
  for(const p of entry.item.params){const v=data.values[p.name]??p.default;
   if(p.type==='float')store[p.name]=typeof v==='number'?v:p.default;
   else if(p.type==='color'){const c=new Color(typeof v==='string'&&/^#[0-9a-fA-F]{6}$/.test(v)?v:p.default as string);store[p.name]=[srgbToLinear(c.red),srgbToLinear(c.green),srgbToLinear(c.blue),1];}
   else if(p.type==='vec2'||p.type==='vec4'){const n=p.type==='vec2'?2:4,a=Array.isArray(v)&&v.length===n?v:p.default as number[];store[p.name]=a;}
   else{const id=typeof v==='string'?v:'';if(id&&entry.textures[p.name]!==id){entry.textures[p.name]=id;this.libraryImage(slot,id,'surface',`shader "${entry.item.name}": ${p.name}`,(_source,texture)=>{
    // Shader textures tile (world-space projections and scrolled uvs), so sample past 0–1 without seams.
    texture.source.style.addressMode='repeat';(m.textures as unknown as Record<string,Texture>)[p.name]=texture;});}}}
  (m as unknown as {update?():void}).update?.();}
 /** A script's shape on one view (built once per view and geometry), or the stand-in cube. */
 private scriptGeometry(slot:ProjectedView3D,id:string):Geometry3D{const data=id?this.scripted.geometries.get(id):undefined;
  if(!data){if(!slot.standIn){slot.standIn=standInGeometry();slot.resources.push(slot.standIn);}return slot.standIn;}
  const cache=slot.scriptGeometries??=new Map();let g=cache.get(id);if(!g){g=buildScriptGeometry(data);cache.set(id,g);slot.resources.push(g);}return g;}
 private applyMorph(mesh:Mesh3D,entityId:string){const w=this.scripted.morphs.get(entityId),weights=mesh.weights;if(!w||!weights)return;for(let i=0;i<weights.length;i++)weights[i]=w[i]??0;}
 /** Scripts (through Script3D): a new shape, which Mesh 3D shows it (or '' for the stand-in), and its morph weights. */
 defineGeometry(id:string,data:ScriptGeometry){this.scripted.geometries.set(id,data);}
 setMeshGeometry(entityId:string,id:string){if(id&&!this.scripted.geometries.has(id))throw Error('That geometry is not known here');if(id)this.scripted.meshes.set(entityId,id);else this.scripted.meshes.delete(entityId);this.context.changed();}
 setMorph(entityId:string,weights:readonly number[]){this.scripted.morphs.set(entityId,[...weights]);this.context.changed();}
 /** Whether a Mesh 3D is drawn by any view, and how many morph targets its shape has. */
 meshInfo(entityId:string){for(const slot of this.slots){const m=slot.scriptMeshes?.find(x=>x.entityId===entityId);if(m)return{geometryId:m.geometryId,vertices:m.mesh.geometry.vertexCount,morphTargets:(m.mesh.geometry as Geometry3D).morphTargetCount??0};}return undefined;}
 /** Writes a script's batch items into a view's BatchedMesh3D when they changed: shape, pose, scale and tint per slot. */
 private applyBatch(slot:ProjectedView3D,entry:NonNullable<ProjectedView3D['batches']>[number]){const s=this.scripted.batches.get(entry.entityId);if(!s||s.version===entry.version)return;entry.version=s.version;
  const {batch}=entry,d=s.data,n=Math.min(s.count,entry.size),m=new Matrix4(),p=new Vector3(),q=new Quaternion(),k=new Vector3();
  for(let i=0;i<entry.size;i++){if(i>=n){if(batch.getVisibleAt(i))batch.setVisibleAt(i,false);continue;}const o=i*batchStride,id=s.geometries[Math.floor(d[o])]??'';
   if(entry.shown[i]!==id){batch.setGeometryAt(i,this.scriptGeometry(slot,id));entry.shown[i]=id;}
   p.set(d[o+1],d[o+2],d[o+3]);q.set(d[o+4],d[o+5],d[o+6],d[o+7]);const l=Math.hypot(q.x,q.y,q.z,q.w)||1;q.set(q.x/l,q.y/l,q.z/l,q.w/l);k.set(d[o+8],d[o+8],d[o+8]);
   batch.setMatrixAt(i,m.compose(p,q,k));batch.setInstanceDataAt(i,'tint',srgbToLinear(d[o+9]),srgbToLinear(d[o+10]),srgbToLinear(d[o+11]),1);if(!batch.getVisibleAt(i))batch.setVisibleAt(i,true);}
  this.context.changed();}
 /** Scripts: a Particles 3D in script mode takes this frame's particles (copied; `data` may be a view into the sandbox). */
 writeScriptParticles(entityId:string,data:Float32Array,count:number){let s=this.scripted.particles.get(entityId);if(!s||s.data.length<data.length){s={data:new Float32Array(Math.max(data.length,particleStride)),count:0};this.scripted.particles.set(entityId,s);}s.data.set(data);s.count=count;}
 /** Scripts: the shapes a Batch 3D's items pick from (by index), and its items (copied). */
 setBatchGeometries(entityId:string,ids:readonly string[]){for(const id of ids)if(id&&!this.scripted.geometries.has(id))throw Error('That geometry is not known here');const s=this.batchStore(entityId);s.geometries=[...ids];s.version++;this.context.changed();}
 writeBatch(entityId:string,data:Float32Array,count:number){const s=this.batchStore(entityId);if(s.data.length<data.length)s.data=new Float32Array(data.length);s.data.set(data);s.count=count;s.version++;this.context.changed();}
 private batchStore(entityId:string){let s=this.scripted.batches.get(entityId);if(!s){s={geometries:[],data:new Float32Array(0),count:0,version:0};this.scripted.batches.set(entityId,s);}return s;}
 batchInfo(entityId:string){for(const slot of this.slots){const b=slot.batches?.find(x=>x.entityId===entityId);if(b){let visible=0;for(let i=0;i<b.size;i++)if(b.batch.getVisibleAt(i))visible++;return{size:b.size,visible,shapes:new Set(b.shown.filter(Boolean)).size};}}return undefined;}
 /** Forgets script-made shapes (a new play session or scene). */
 resetScripted(){this.scripted.geometries.clear();this.scripted.meshes.clear();this.scripted.morphs.clear();this.scripted.particles.clear();this.scripted.batches.clear();for(const slot of this.slots)for(const b of slot.batches??[]){for(let i=0;i<b.size;i++)b.batch.setVisibleAt(i,false);b.version=-1;}for(const slot of this.slots)for(const m of slot.scriptMeshes??[]){if(m.geometryId){m.mesh.geometry=this.scriptGeometry(slot,'');m.geometryId='';}}}
 /** Puts each node under its entity's current parent (a script or rule moved it in the running scene); the parent's own local pose was already rewritten to keep its place. */
 private reparentNodes(slot:ProjectedView3D,entities:Map<string,Entity>){for(const [id,node]of slot.nodes){const e=entities.get(id);if(!e)continue;const parent=e.parentId===slot.id?slot.view.root:slot.nodes.get(e.parentId??'');
   if(!parent||parent===node.parent)continue;for(let p:Container3D|null=parent;p;p=p.parent as Container3D|null)if(p===node){this.context.report(Error(`${e.name}: it can't move under its own child`));return;}
   parent.addChild(node);}}
 private build(scene:Scene){this.follows=scene.entities.flatMap(e=>e.components.filter(c=>c.type===followType&&c.version===1).map(c=>({id:e.id,name:e.name,data:FollowSchema.parse(c.data)})));for(const entity of scene.entities){const component=entity.components.find(c=>c.type==='pixi3d.viewport'&&c.version===1),host=this.context.node(entity.id);if(!component||!host)continue;
  const data=Viewport3DSchema.parse(component.data),view=new View3D({width:data.width,height:data.height,autoResize:false,background:0x19212b,...holdsGlass(scene,entity.id)?{composite:true}:{}});view.shadowQuality=data.shadowQuality;view.shadowFilter=data.shadowFilter;view.toneMapping=data.toneMapping;view.exposure=data.exposure;view.fog=data.fog==='none'?null:data.fog==='linear'?{type:'linear',color:new Color(data.fogColor).toNumber(),near:data.fogNear,far:data.fogFar}:{type:data.fog,color:new Color(data.fogColor).toNumber(),density:data.fogDensity};host.addChild(view);view.eventMode='none';const defaultCamera=view.camera;defaultCamera.position.set(4,3,7);defaultCamera.lookAt({x:0,y:0,z:0});
  const slot:ProjectedView3D={id:entity.id,host,view,defaultCamera,cameraId:data.cameraId,nodes:new Map(),cameras:new Map(),models:new Map(),resources:[],releases:[],particles:[],loads:[]};this.slots.push(slot);this.environment(slot,data);view.passes=this.postEffects(slot,data);
  const pending=scene.entities.filter(e=>e.spatial==='scene3d.transform');let progress=true;
  while(pending.length&&progress){progress=false;for(let i=pending.length-1;i>=0;i--){const e=pending[i],parent=e.parentId===entity.id?view.root:slot.nodes.get(e.parentId??'');if(!parent)continue;pending.splice(i,1);progress=true;
   // The entity owns a transform group. Render, camera and light components can coexist.
   const node=new Container3D();node.label=e.id;applyPose3D(node,transform3D(e));parent.addChild(node);slot.nodes.set(e.id,node);
   for(const component of e.components){if(component.version!==1)continue;
    if(component.type===batch3dType){const d=Batch3DSchema.parse(component.data),material=new Material3D({baseColor:'#ffffff',roughness:d.roughness,metallic:d.metallic,extraBits:[instanceTintBit]}),batch=new BatchedMesh3D({size:d.size,label:'batch',instanceData:{tint:{value:[1,1,1,1],type:'vec4<f32>'}}}),standIn=this.scriptGeometry(slot,''),passes=RenderPassBit.OPAQUE|(d.castShadow?RenderPassBit.SHADOW:0);
     for(let i=0;i<d.size;i++){batch.setGeometryAt(i,standIn);batch.setMaterialAt(i,material);batch.setPassesAt(i,passes);batch.setVisibleAt(i,false);if(!d.receiveShadow){batch.items[i].receiveShadow=false;batch.invalidate(i);}}
     (material as Material3D).baseColor=d.color;batch.eventMode='static';slot.resources.push(material);node.addChild(batch);const entry={entityId:e.id,batch,material,size:d.size,version:-1,shown:new Array<string>(d.size).fill('')};(slot.batches??=[]).push(entry);this.applyBatch(slot,entry);}
    if(component.type===mesh3dType){const d=Mesh3DSchema.parse(component.data),wanted=this.scripted.meshes.get(e.id)??'',geometry=this.scriptGeometry(slot,wanted),material=this.shaded(slot,e,new Material3D({baseColor:d.color,roughness:d.roughness,metallic:d.metallic,vertexColors:d.vertexColors,doubleSided:d.doubleSided,flatShading:d.flatShading}),geometry,d.color),mesh=new Mesh3D({geometry,material,castShadow:d.castShadow,receiveShadow:d.receiveShadow});
     if(d.texture)this.libraryImage(slot,d.texture,'surface',`${e.name}: colour map`,(_source,texture)=>{(material.textures as unknown as Record<string,Texture>).baseColor=texture;});
     mesh.eventMode='static';slot.resources.push(material);node.addChild(mesh);(slot.scriptMeshes??=[]).push({entityId:e.id,mesh,geometryId:wanted});this.applyMorph(mesh,e.id);}
    if(component.type==='pixi3d.primitive'){const d=Primitive3DSchema.parse(component.data),geometry=shapeGeometry(d),portal=d.portalExitId?this.portalFeed(slot,data):undefined,mirrorData=portal?undefined:e.components.find(c=>c.type===mirror3dType&&c.version===1),mirror=mirrorData?Mirror3DSchema.parse(mirrorData.data):undefined,mirrorFeed=mirror?this.portalFeed(slot,{width:Math.max(1,Math.round(data.width*mirror.resolution)),height:Math.max(1,Math.round(data.height*mirror.resolution))}):undefined,material=portal?new PortalMaterial({texture:portal}):mirrorFeed?new MirrorMaterial({texture:mirrorFeed,baseColor:mirror!.tint}):this.shaded(slot,e,this.surface(slot,e.name,d,(d.shape==='cube')!==Boolean(d.screenSourceId)),geometry,d.color),mesh=new Mesh3D({geometry,material,castShadow:d.castShadow&&!portal&&!mirrorFeed,receiveShadow:d.receiveShadow});if(mirrorFeed)(slot.mirrors??=[]).push({mesh,texture:mirrorFeed});if(d.hitVolume==='sphere'){const b=geometry.bounds3D;mesh.hitVolume=new Sphere(new Vector3((b.min.x+b.max.x)/2,(b.min.y+b.max.y)/2,(b.min.z+b.max.z)/2),Math.hypot(b.max.x-b.min.x,b.max.y-b.min.y,b.max.z-b.min.z)/2);}else if(d.hitVolume==='box'||d.hitVolume==='geometry')mesh.hitVolume=d.hitVolume;if(portal)(slot.portals??=[]).push({entry:mesh,exitId:d.portalExitId,texture:portal,owner:e.name});else if(d.feedCameraId&&!mirrorFeed)(slot.feeds??=[]).push({material,cameraId:d.feedCameraId,owner:e.name});// A null hit volume falls back to the default one, so "none" takes the mesh out of picking instead.
    mesh.eventMode=d.hitVolume==='none'?'none':'static';slot.resources.push(geometry,material);node.addChild(mesh);if(d.lodDistance>0&&lodShapes.includes(d.shape)){const far=shapeGeometry({...d,segments:d.lodSegments,detail:0});slot.resources.push(far);(slot.lods??=[]).push({mesh,near:geometry,far,distance:d.lodDistance,isFar:false});}if(d.material==='toon'&&d.toonOutline)slot.outline=true;}
    if(component.type===sprite3dType){const d=Sprite3DSchema.parse(component.data),sprite=new PixiSprite3D({texture:Texture.WHITE,tint:d.tint,alpha:d.alphaMode==='blend'?d.alpha:1,alphaMode:d.alphaMode,alphaCutoff:d.alphaCutoff,billboardMode:d.billboard,pixelSize:d.pixelSize,anchor:{x:d.anchorX,y:d.anchorY},castShadow:d.castShadow,receiveShadow:d.receiveShadow});
     // Until the image decodes the sprite is a 1-pixel white quad: invisible at any useful pixel size.
     sprite.eventMode='static';node.addChild(sprite);slot.resources.push(sprite);if(d.texture)this.libraryImage(slot,d.texture,'surface',`${e.name}: image`,(_source,texture)=>{sprite.texture=texture;});}
    if(component.type===instances3dType)this.instances(slot,node,e,Instances3DSchema.parse(component.data));
    if(component.type===particle3dType){const d=Particles3DSchema.parse(component.data),entry:ProjectedView3D['particles'][number]={data:d,node,entityId:e.id,...d.space==='world'?{history:new EmitterHistory(d.lifetime+d.burstInterval+.5)}:{}};slot.particles.push(entry);
     // The container's frames are fixed when it is made, so a Library image makes it once the image has loaded.
     const make=(texture:Texture|Texture[])=>{entry.container?.destroy();const container=new ParticleContainer3D({texture,capacity:d.count,blendMode:d.blendMode,space:d.space,billboard:d.billboard});container.eventMode='none';container.label='particles';node.addChild(container);entry.container=container;};
     if(d.textureAsset)this.libraryImage(slot,d.textureAsset,'surface',`${e.name}: particle image`,source=>{const columns=d.frameColumns,rows=d.frameRows,w=source.width/columns,h=source.height/rows;
      const frames=Array.from({length:columns*rows},(_,k)=>new Texture({source,frame:new Rectangle((k%columns)*w,Math.floor(k/columns)*h,w,h)}));slot.resources.push(...frames);make(frames.length>1?frames:frames[0]);if(this.slots.includes(slot))this.writeParticles(slot,entry,this.particleTime);});
     else make(particleTexture(d.particleTexture));}
    if(component.type==='pixi3d.camera'){const d=Camera3DSchema.parse(component.data),camera=new Camera3D(d);node.addChild(camera);slot.cameras.set(e.id,camera);slot.feedSizes??=new Map();slot.feedSizes.set(e.id,{width:d.feedWidth,height:d.feedHeight});const control=e.components.find(c=>c.type===cameraControlType&&c.version===1);if(control)(slot.controls??=new Map()).set(e.id,CameraControlSchema.parse(control.data));}
    if(component.type==='pixi3d.light'){const d=Light3DSchema.parse(component.data),shadow=lightShadow(d);const base={color:d.color,intensity:d.intensity};node.addChild(d.kind==='ambient'?new AmbientLight(base):d.kind==='point'?new PointLight({...base,range:d.range,radius:d.radius}):d.kind==='spot'?new SpotLight({...base,range:d.range,radius:d.radius,coneAngle:d.coneAngle,penumbra:d.penumbra,castShadow:d.castShadow,...shadow?{shadow:{bias:shadow.bias,update:shadow.update,...shadow.normalBias===undefined?{}:{normalBias:shadow.normalBias}}}:{}}):new DirectionalLight({...base,castShadow:d.castShadow,...shadow?{shadow:'bounds' in shadow?{...shadow,bounds:Box.fromCenterSize(shadow.bounds.center,shadow.bounds.size)}:shadow}:{}}));}
    if(component.type===modelComponentType){const d=Model3DSchema.parse(component.data);
     // A script can unload a model (loaded false): the object stays, its GPU resources are released until it loads again.
     if(!d.loaded)continue;this.model(slot,node,e,d);if(d.morphOverride)(slot.morphs??=[]).push({entityId:e.id,weights:morphKeys.map(k=>d[k])});}
    if(component.type===boneAimType)(slot.aims??=[]).push({entityId:e.id,data:BoneAimSchema.parse(component.data)});
    if(component.type===draggableType)(slot.drags??=new Map()).set(e.id,DraggableSchema.parse(component.data));
    if(component.type===lookAtType){const q=node.quaternion;(slot.looks??=[]).push({entityId:e.id,node,data:LookAtSchema.parse(component.data),base:[q.x,q.y,q.z,q.w]});}
    if(component.type===decalsType){const data=DecalsSchema.parse(component.data),entry:NonNullable<ProjectedView3D['decals']>[number]={entityId:e.id,data,stamped:[],count:0};(slot.decals??=[]).push(entry);
     if(data.image)this.libraryImage(slot,data.image,'surface',`${e.name}: decal image`,(_source,texture)=>{entry.texture=texture;});}
    if(component.type===paintableType){const p=e.components.find(c=>c.type==='pixi3d.primitive'),data=PaintableSchema.parse(component.data);{const pd=p?Primitive3DSchema.parse(p.data):undefined;(slot.paints??=[]).push({entityId:e.id,data,fill:data.background||(pd?.color??'#ffffff'),box:pd?.shape==='cube'&&pd.draw==='surface'});}}
    if(component.type===attachType)(slot.attaches??=[]).push({entityId:e.id,node,data:AttachSchema.parse(component.data)});
    if(component.type===pointerFollowType)(slot.pointerFollows??=[]).push({entityId:e.id,node,data:PointerFollowSchema.parse(component.data)});
    if((highlight3dTypes as readonly string[]).includes(component.type)){const kind=component.type===outline3dType?'outline':component.type===wireframeOverlayType?'wireframe':'bounds',primitive=e.components.find(c=>c.type==='pixi3d.primitive'),p=primitive?Primitive3DSchema.parse(primitive.data):undefined,enabled=(kind==='outline'?Outline3DSchema:kind==='wireframe'?WireframeOverlaySchema:BoundsHelperSchema).parse(component.data).enabled;
     const h:Highlight3D={entityId:e.id,kind,enabled,node,toonInk:p?.material==='toon'&&p.toonOutline};(slot.highlights??=[]).push(h);
     if(kind==='outline')slot.outline=true;
     else if(kind==='wireframe'){const color=WireframeOverlaySchema.parse(component.data).color;
      // Primitives get their exact edges (the pass pairs triangle indices and misses some); models use the wireframe pass.
      if(p){const geometry=shapeGeometry({...p,draw:'wireframe'}),material=new FlatMaterial({baseColor:color}),overlay=new Mesh3D({geometry,material,castShadow:false,receiveShadow:false});overlay.label='wireframe-overlay';overlay.eventMode='none';overlay.scale.set(1.002);node.addChild(overlay);slot.resources.push(geometry,material);h.overlay=overlay;}
      else slot.modelWireframe??=color;}
     else{const color=BoundsHelperSchema.parse(component.data).color,geometry=boxEdges(),material=new FlatMaterial({baseColor:color}),box=new Mesh3D({geometry,material,castShadow:false,receiveShadow:false});box.label='bounds-box';box.eventMode='none';box.visible=false;view.root.addChild(box);slot.resources.push(geometry,material);h.box=box;}}
   }
  }}
  this.connectFeeds(slot,data);
  this.pointerEvents(slot);
  if(slot.outline){const pass=new OutlinePass({width:data.outlineWidth,color:new Color(data.outlineColor).toNumber()});slot.resources.push(pass);view.passes=[pass,...view.passes];}
  for(const paint of slot.paints??[])this.setUpPaint(slot,paint);
  if(slot.modelWireframe){const pass=new WireframePass({color:new Color(slot.modelWireframe).toNumber()});slot.resources.push(pass);view.passes=[pass,...view.passes];}
  this.applyHighlights(slot);
 }}
 private model(slot:ProjectedView3D,node:Container3D,entity:Entity,data:ReturnType<typeof Model3DSchema.parse>){
  const geometry=new CubeGeometry(),material=new Material3D({baseColor:'#c48869'}),placeholder=new Mesh3D({geometry,material});placeholder.eventMode='static';node.addChild(placeholder);slot.resources.push(geometry,material);
  const state:ModelInstance={key:this.resources?.key(data.assetId)??'',ready:false};slot.models.set(entity.id,state);
  try{if(!this.resources)throw Error('Model asset service unavailable');const lease=this.resources.acquire(data.assetId);let cancelled=false;slot.releases.push(()=>{cancelled=true;lease.release();});
   const pending=lease.promise.then(source=>{if(this.dead||cancelled)return;const problems=materialSlotProblems(data,this.resources!.assets.get(data.assetId));if(problems.length)throw Error(problems.join('; '));
    const overrides=new Map(data.materialSlots.map(slot=>[slot.index,slot]));
    const materials=data.overrideMaterial||overrides.size?source.materials.map((original,index)=>{const values=overrides.get(index)??(data.overrideMaterial?data:undefined);if(!values)return original;if(!(original instanceof Material3D))throw Error(`Material slot ${index+1} does not support PBR overrides`);const material=original.clone({baseColor:values.color});material.roughness=values.roughness;material.metallic=values.metallic;slot.resources.push(material);return material;}):undefined;
    const instance=new Model3D({source,autoUpdate:false,materials,...data.scene?{scene:data.scene}:{}});
    // glTF nodes default to passive, even under an interactive entity group.
    // Register real mesh surfaces; picking resolves the hit back to the stable entity ID.
    // Morph/skin meshes otherwise pick against their rest pose; deform on the CPU only when a pick asks.
    instance.traverse(child=>{if(child instanceof Mesh3D){child.eventMode='static';child.castShadow=data.castShadow;child.receiveShadow=data.receiveShadow;const volume=DeformedHitVolume.forMesh(child);if(volume)child.hitVolume=volume;}});
    placeholder.visible=false;node.addChild(instance);state.instance=instance;state.ready=true;this.context.changed();
   }).catch(error=>{if(!this.dead&&!cancelled){state.error=String(error);this.context.report(Error(`${entity.name}: ${String(error)}`));this.context.changed();}});
   state.pending=pending;void pending.catch(()=>{});
  }catch(error){state.error=String(error);this.context.report(Error(`${entity.name}: ${String(error)}`));}
 }
 /** Copies of a primitive (built now) or of a static GLB's parts (built when its lease resolves), as slots of one batch. */
 private instances(slot:ProjectedView3D,node:Container3D,entity:Entity,d:Instances3D){
  const layout=instanceLayout(d),copies=layout.length/5,colors=instanceColors(d,layout);
  const build=(parts:{geometry:Geometry3D;material:BaseMaterial3D;matrix?:Matrix4;passes:number}[],shape:'box'|'sphere',box:InstanceBox)=>{
   const size=copies*parts.length;if(size>maxInstanceSlots)throw Error(`${copies} copies × ${parts.length} model parts is ${size} batch slots; the limit is ${maxInstanceSlots}`);
   const batch=new BatchedMesh3D({size,label:'instances',cull:d.cull,...colors?{instanceData:{tint:{value:[1,1,1,1],type:'vec4<f32>'}}}:{}}),m=new Array<number>(16),copy=new Matrix4(),matrix=new Matrix4();
   for(let i=0;i<copies;i++){instanceMatrix(layout,i,m);copy.set(m[0],m[1],m[2],m[3],m[4],m[5],m[6],m[7],m[8],m[9],m[10],m[11],m[12],m[13],m[14],m[15]);
    for(let j=0;j<parts.length;j++){const part=parts[j],k=i*parts.length+j;batch.setGeometryAt(k,part.geometry);batch.setMaterialAt(k,part.material);batch.setMatrixAt(k,part.matrix?matrix.multiplyMatrices(copy,part.matrix):copy);batch.setPassesAt(k,part.passes);
     if(colors)batch.setInstanceDataAt(k,'tint',srgbToLinear(colors[i*3]),srgbToLinear(colors[i*3+1]),srgbToLinear(colors[i*3+2]),1);if(!d.receiveShadow){batch.items[k].receiveShadow=false;batch.invalidate(k);}}}
   batch.hitVolume=new InstancesHitVolume(layout,shape,box);batch.eventMode='static';node.addChild(batch);};
  if(d.source==='primitive'){const geometry=d.shape==='cube'?new CubeGeometry():new SphereGeometry({radius:.5}),material=new Material3D({baseColor:colors?'#ffffff':d.color,roughness:d.roughness,metallic:d.metallic,...colors?{extraBits:[instanceTintBit]}:{}});slot.resources.push(geometry,material);
   build([{geometry,material,passes:RenderPassBit.OPAQUE|(d.castShadow?RenderPassBit.SHADOW:0)}],d.shape==='cube'?'box':'sphere',unitBox);return;}
  const load:{pending?:Promise<void>;error?:string}={};slot.loads.push(load);
  const fail=(error:unknown)=>{load.error=String(error);this.context.report(Error(`${entity.name}: ${String(error)}`));this.context.changed();};
  try{if(!this.resources)throw Error('Model asset service unavailable');if(!d.assetId)throw Error('Choose a GLB model for the instances');const lease=this.resources.acquire(d.assetId);let cancelled=false;slot.releases.push(()=>{cancelled=true;lease.release();});
   load.pending=lease.promise.then(source=>{if(this.dead||cancelled)return;
    // A throwaway Model3D gives the loader's own scene, visibility and materials; its geometry and materials stay the shared source's.
    const model=new Model3D({source,autoUpdate:false}),parts:{geometry:Geometry3D;material:BaseMaterial3D;matrix:Matrix4;passes:number}[]=[],tinted=new Map<BaseMaterial3D,BaseMaterial3D>(),local=new Matrix4();
    try{model.traverse(child=>{if(!(child instanceof Mesh3D))return;let shown=true;for(let n:Container3D|null=child;n&&n!==model;n=n.parent as Container3D|null)if(!n.visible)shown=false;if(!shown)return;
      if(child.skeleton)throw Error('Skinned models cannot be instanced; use a Model renderer');child.castShadow=d.castShadow;
      const matrix=new Matrix4();for(let n:Container3D|null=child;n&&n!==model;n=n.parent as Container3D|null)matrix.premultiply(local.compose(n.position,n.quaternion,n.scale));
      let material=child.material;if(colors&&material instanceof Material3D){let clone=tinted.get(material);if(!clone){clone=material.clone({extraBits:[...material.extraBits,instanceTintBit]});tinted.set(material,clone);slot.resources.push(clone);}material=clone;}
      parts.push({geometry:child.geometry,material,matrix,passes:child.renderPassMask});});
    }finally{model.destroy({children:true});}
    if(!parts.length)throw Error('The model has no visible meshes to instance');
    const box:InstanceBox={min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]},corner=new Vector3();
    for(const part of parts){const b=part.geometry.bounds3D;for(const x of [b.min.x,b.max.x])for(const y of [b.min.y,b.max.y])for(const z of [b.min.z,b.max.z]){corner.set(x,y,z).applyMatrix4(part.matrix);const v=[corner.x,corner.y,corner.z];for(let a=0;a<3;a++){box.min[a]=Math.min(box.min[a],v[a]);box.max[a]=Math.max(box.max[a],v[a]);}}}
    build(parts,'box',box);this.context.changed();
   }).catch(error=>{if(!this.dead&&!cancelled)fail(error);});void load.pending.catch(()=>{});
  }catch(error){fail(error);}
 }
 /** Wait only for this projection's active sources; stale callbacks never attach to a new session. */
/** Hemisphere is applied at once; an HDR cube is shared per URL, released with the slot, and gated by ready(). */
 private particleTime=0;private particleScratch=particle3DState();
 /** Writes every emitter as it is at `time` seconds; pure in time, so any order of calls shows the same frame for the same time. */
 setParticleTime(time:number){this.particleTime=time;
  for(const slot of this.slots)for(const {material,data,flipV} of slot.surfaces??[])if(!material.destroyed)material.uvTransform=toMatrix(uvMatrix(data,time,flipV));
  this.captureScreens();this.placeFollowers();this.poseRigs();this.holdAttached();this.turnLookers();for(const slot of this.slots)for(const space of slot.decalSpaces??[]){const t=space.parent as Container3D|null;if(t)space.scale.set(1/(t.scale.x||1),1/(t.scale.y||1),1/(t.scale.z||1));}for(const slot of this.slots)this.applyHighlights(slot);
  for(const slot of this.slots){const lods=slot.lods;if(!lods?.length)continue;const eye=slot.view.camera.getGlobalPosition();
   for(const lod of lods){if(lod.mesh.destroyed)continue;const p=lod.mesh.getGlobalPosition(),far=lodFar(lod.distance,Math.hypot(p.x-eye.x,p.y-eye.y,p.z-eye.z),lod.isFar);if(far!==lod.isFar){lod.isFar=far;lod.mesh.geometry=far?lod.far:lod.near;}}}
  for(const slot of this.slots)for(const entry of slot.particles)this.writeParticles(slot,entry,time);
  // Shader 3D's `time`: game seconds, so Pause, frame steps and replays show the same picture.
  for(const slot of this.slots)for(const sh of slot.shaded??[])(sh.material.data as unknown as {time:number}).time=time;
 }
 /** Gives a paintable primitive its paint canvas: the colour map becomes the canvas, tinted white, and hits report triangles (UVs). */
 private setUpPaint(slot:ProjectedView3D,paint:NonNullable<ProjectedView3D['paints']>[number]){const node=slot.nodes.get(paint.entityId),mesh=node?.children.find(c=>c instanceof Mesh3D&&c.label!=='wireframe-overlay') as Mesh3D|undefined;if(!mesh||typeof document==='undefined')return;
  if(paint.box){const old=mesh.geometry,count=old.vertexCount,positions=getAttributeData(old,'aPosition',3,new Float32Array(count*3)),normals=getAttributeData(old,'aNormal',3,new Float32Array(count*3)),uvs=getAttributeData(old,'aUV',2,new Float32Array(count*2)),geometry=new PixiGeometry3D({positions,normals,uvs:boxAtlasUvs(normals,uvs),indices:old.indices});slot.resources.push(geometry);mesh.geometry=geometry;}
  const canvas=document.createElement('canvas');canvas.width=canvas.height=paint.data.resolution;const texture=Texture.from(canvas);paint.canvas=canvas;paint.texture=texture;this.fillPaint(paint);
  const material=mesh.material as Material3D;material.textures.baseColor=texture;material.baseColor=0xffffff;mesh.hitVolume='geometry';slot.resources.push({destroy:()=>texture.destroy(true)} as never);}
 private fillPaint(paint:NonNullable<ProjectedView3D['paints']>[number]){const g=paint.canvas?.getContext('2d');if(!g||!paint.canvas)return;g.fillStyle=paint.fill;g.fillRect(0,0,paint.canvas.width,paint.canvas.height);paint.texture?.source.update();}
 /** The paintable surface and texture point (UV) under `global`, if the nearest hit is a paintable primitive. */
 private paintAt(slot:ProjectedView3D,global:{x:number;y:number}){const hit=slot.view.raycast(global);if(!hit||hit.triangleIndex<0)return undefined;let n=hit.target as Container3D|null;while(n&&slot.nodes.get(n.label??'')!==n)n=n.parent as Container3D|null;
  const paint=n?slot.paints?.find(p=>p.entityId===n.label):undefined;return paint?.canvas?{paint,uv:{u:hit.uv.x,v:hit.uv.y}}:undefined;}
 /** Lays round brush dabs at texture points; UV (0, 0) is the canvas's top-left, as the colour map samples it. */
 private dab(paint:NonNullable<ProjectedView3D['paints']>[number],points:readonly {u:number;v:number}[]){const c=paint.canvas,g=c?.getContext('2d');if(!c||!g)return;const r=paint.data.brushSize*c.width;g.fillStyle=paint.data.brushColor;
  for(const p of points){g.beginPath();g.arc(p.u*c.width,p.v*c.height,r,0,Math.PI*2);g.fill();}paint.texture?.source.update();this.context.changed();}
 /** Keeps each attached object at its hold on its target while the attach add-on is on (Play only), written back through `moved`. */
 private holdAttached(){for(const slot of this.slots){if(!slot.attaches?.length||slot.view.camera===slot.defaultCamera)continue;
  for(const a of slot.attaches){const target=slot.nodes.get(a.data.targetId);if(!a.data.enabled||!target||a.node.destroyed){a.offset=undefined;continue;}
   const targetWorld=target.getGlobalTransform();if(!a.offset)a.offset=new Matrix4().getInverse(targetWorld).multiply(a.node.getGlobalTransform());
   const world=new Matrix4().copyFrom(targetWorld).multiply(a.offset),parent=a.node.parent as Container3D|null,local=parent?new Matrix4().getInverse(parent.getGlobalTransform()).multiply(world):world;
   const p=new Vector3(),q=new Quaternion(),sc=new Vector3();local.decompose(p,q,sc);a.node.position.set(p.x,p.y,p.z);a.node.quaternion.set(q.x,q.y,q.z,q.w);
   this.context.moved?.(a.entityId,{x:p.x,y:p.y,z:p.z,qx:q.x,qy:q.y,qz:q.z,qw:q.w});}}}
 /** Stamps every decal stamper of the view at the surface under `global`, on the object hit, oldest replaced past `max`. */
 private stampDecals(slot:ProjectedView3D,global:{x:number;y:number}){if(!slot.decals?.length)return;const hit=slot.view.raycast(global);if(!hit)return;
  let target=hit.target as Container3D|null;while(target&&slot.nodes.get(target.label??'')!==target)target=target.parent as Container3D|null;if(!target)return;
  const n=hit.normal,l=Math.hypot(n.x,n.y,n.z),normal=l>1e-6?{x:n.x/l,y:n.y/l,z:n.z/l}:{x:0,y:1,z:0};
  for(const d of slot.decals){if(d.data.onlyOn&&d.data.onlyOn!==target.label)continue;
   const look=decalLook(d.data,d.count++),turn=lookRotation(normal)??[0,0,0,1],spin=new Quaternion(0,0,Math.sin(look.spin/2),Math.cos(look.spin/2)),q=new Quaternion(turn[0],turn[1],turn[2],turn[3]).multiply(spin);
   const space=this.decalSpace(slot,target),world=new Matrix4().compose(new Vector3(hit.point.x+normal.x*.01,hit.point.y+normal.y*.01,hit.point.z+normal.z*.01),q,new Vector3(look.size,look.size,look.size)),local=new Matrix4().getInverse(space.getGlobalTransform()).multiply(world);
   const material=new Material3D({baseColor:look.color,alphaMode:'blend',roughness:.8,metallic:0}),mesh=new Mesh3D({geometry:this.decalGeometry(),material,castShadow:false,receiveShadow:true});material.textures.baseColor=d.texture??decalTexture(d.data.shape);
   mesh.label='decal';mesh.eventMode='none';const p=new Vector3(),r=new Quaternion(),sc=new Vector3();local.decompose(p,r,sc);mesh.position.set(p.x,p.y,p.z);mesh.quaternion.set(r.x,r.y,r.z,r.w);mesh.scale.set(sc.x,sc.y,sc.z);space.addChild(mesh);
   d.stamped.push(mesh);while(d.stamped.length>d.data.max)this.dropDecal(d.stamped.shift()!);}
  this.context.changed();}
 /**
  * A child of the hit object that undoes the object's own scale, so a decal on a stretched object (a wall scaled 8 × 2)
  * stays square instead of shearing; it rides with the object and follows later scale changes each frame.
  */
 private decalSpace(slot:ProjectedView3D,target:Container3D){let space=target.children.find(c=>c.label==='decal-space') as Container3D|undefined;
  if(!space){space=new Container3D();space.label='decal-space';target.addChild(space);(slot.decalSpaces??=[]).push(space);}
  space.scale.set(1/(target.scale.x||1),1/(target.scale.y||1),1/(target.scale.z||1));refreshSpace(space);return space;}
 private decalPlane?:PlaneGeometry;
 /** One square facing +Z, shared by every decal of every view and never destroyed with a view. */
 private decalGeometry(){return this.decalPlane??=new PlaneGeometry({flipV:true});}
 private dropDecal(mesh:Mesh3D){if(mesh.destroyed)return;const material=mesh.material;mesh.removeFromParent();mesh.destroy();material.destroy();}
 /**
  * Turns each Look at object toward its target while its view looks through the scene camera (Play), so the editor's
  * own camera still shows and edits the authored rotation. Up is world up seen from the object's parent.
  */
 private turnLookers(){for(const slot of this.slots){if(!slot.looks?.length||slot.view.camera===slot.defaultCamera)continue;
  for(const look of slot.looks){const target=slot.nodes.get(look.data.targetId);if(!target||look.node.destroyed)continue;
   const parent=look.node.parent as Container3D|null,t=target.getGlobalPosition(),inverse=parent?new Matrix4().getInverse(parent.getGlobalTransform()):undefined,local=inverse?new Vector3(t.x,t.y,t.z).applyMatrix4(inverse):new Vector3(t.x,t.y,t.z);
   const e=inverse?.elements,up=e?{x:e[4],y:e[5],z:e[6]}:{x:0,y:1,z:0},p=look.node.position,q=lookRotation({x:local.x-p.x,y:local.y-p.y,z:local.z-p.z},up,look.data.axis,look.data.yawOnly);if(!q)continue;
   const r=look.data.weight>=1?q:slerp(look.base,q,look.data.weight);look.node.quaternion.set(r[0],r[1],r[2],r[3]);}}}
 /**
  * Moves each Follow the pointer object to the point under the pointer: the nearest object's surface (its own meshes
  * never block the ray) or the ground plane, lifted along the normal and optionally lying flat on it. The place is
  * written back through `moved` like a drag, so rules and the runtime see it.
  */
 private followPointer(slot:ProjectedView3D,global:{x:number;y:number}){for(const f of slot.pointerFollows??[]){if(f.node.destroyed)continue;
  for(const m of this.ownMeshes(slot,f.node))m.eventMode='none';
  const hit=f.data.surface==='objects'?slot.view.raycast(global):null;let point:{x:number;y:number;z:number}|null=null,normal={x:0,y:1,z:0};
  if(hit){point={x:hit.point.x,y:hit.point.y,z:hit.point.z};const n=hit.normal,l=Math.hypot(n.x,n.y,n.z);if(l>1e-6)normal={x:n.x/l,y:n.y/l,z:n.z/l};}
  else{const ray=slot.view.screenToRay(global);point=rayPlane(ray.origin,ray.direction,{x:0,y:f.data.groundY,z:0},{x:0,y:1,z:0});}
  if(!point){if(f.data.hideWhenMissed)f.node.visible=false;continue;}
  f.node.visible=true;const world=new Vector3(point.x+normal.x*f.data.lift,point.y+normal.y*f.data.lift,point.z+normal.z*f.data.lift),parent=f.node.parent as Container3D|null;
  const inverse=parent?new Matrix4().getInverse(parent.getGlobalTransform()):undefined,local=inverse?world.applyMatrix4(inverse):world,pose:{x:number;y:number;z:number;qx?:number;qy?:number;qz?:number;qw?:number}={x:local.x,y:local.y,z:local.z};
  f.node.position.set(local.x,local.y,local.z);
  if(f.data.align){const e=inverse?.elements,n=e?{x:e[0]*normal.x+e[4]*normal.y+e[8]*normal.z,y:e[1]*normal.x+e[5]*normal.y+e[9]*normal.z,z:e[2]*normal.x+e[6]*normal.y+e[10]*normal.z}:normal,l=Math.hypot(n.x,n.y,n.z)||1,q=alignUp({x:n.x/l,y:n.y/l,z:n.z/l});f.node.quaternion.set(q[0],q[1],q[2],q[3]);Object.assign(pose,{qx:q[0],qy:q[1],qz:q[2],qw:q[3]});}
  this.context.moved?.(f.entityId,pose);}}
 /** An object's own meshes: its subtree without other objects' groups and without the overlay and box helpers. */
 private ownMeshes(slot:ProjectedView3D,node:Container3D){const out:Mesh3D[]=[],owned=new Set(slot.nodes.values()),walk=(n:Container3D)=>{for(const c of n.children){if(!(c instanceof Container3D)||owned.has(c))continue;if(c instanceof Mesh3D&&c.label!=='wireframe-overlay'&&c.label!=='decal')out.push(c);walk(c);}};walk(node);return out;}
 /**
  * Brings outline / wireframe / box add-ons in line with their `enabled` flags: passes are joined or left only when a
  * flag or the mesh count changes (a model swaps its placeholder for real meshes when it loads); boxes follow every frame.
  */
 private applyHighlights(slot:ProjectedView3D){for(const h of slot.highlights??[]){
  if(h.box){const show=h.enabled&&h.node.visible&&!h.node.destroyed;h.box.visible=show;if(show){const b=h.node.getLocalBounds(),w=worldBox(b.min,b.max,h.node.getGlobalTransform().elements);h.box.position.set((w.min.x+w.max.x)/2,(w.min.y+w.max.y)/2,(w.min.z+w.max.z)/2);// A little larger than the object, so the edges of a box-shaped object don't lose the depth test to its own faces.
   const pad=(d:number)=>d*1.02+.01;h.box.scale.set(pad(w.max.x-w.min.x),pad(w.max.y-w.min.y),pad(w.max.z-w.min.z));}continue;}
  if(h.overlay){h.overlay.visible=h.enabled;continue;}
  const meshes=this.ownMeshes(slot,h.node);if(h.applied===h.enabled&&h.meshes===meshes.length)continue;h.applied=h.enabled;h.meshes=meshes.length;
  const pass=h.kind==='outline'?'outline':'wireframe';
  // A toon surface's own ink is the same pass; switching the add-on off must not take that away.
  for(const m of meshes){if(h.enabled)m.enablePass(pass);else if(!h.toonInk)m.disablePass(pass);}}}
 /** Writes one emitter's particles at `time`: local space in the emitter's frame, world space from where it was at each birth. */
 private writeParticles(slot:ProjectedView3D,entry:ProjectedView3D['particles'][number],time:number){const {container,data,node,history}=entry,out=this.particleScratch;if(!container||container.destroyed)return;
  // Driven by a script: its latest write, as is (positions in the container's space; colours sRGB like tint).
  if(data.driver==='script'){const s=this.scripted.particles.get(entry.entityId),d=s?.data,n=s?Math.min(s.count,data.count):0,c=(v:number)=>Math.round(Math.max(0,Math.min(1,v))*255);
   for(let i=0;i<data.count;i++){if(i>=n||!d){container.setParticleAt(i,0,0,0,0);continue;}const o=i*particleStride;container.setParticleAt(i,d[o],d[o+1],d[o+2],d[o+3],0,(c(d[o+4])<<16)|(c(d[o+5])<<8)|c(d[o+6]),Math.max(0,Math.min(1,d[o+7])),0);}
   container.upload();return;}
  if(history){const m=node.getGlobalTransform().elements;history.record(time,m);const fall=-data.gravity;
   for(let i=0;i<data.count;i++){writeParticle3D(data,i,time,out,0,0,0);if(!out.alive){container.setParticleAt(i,0,0,0,0);continue;}
    const e=history.at(time-out.age),x=out.x,y=out.y,z=out.z,half=.5*out.age*out.age;
    container.setParticleAt(i,e[0]*x+e[4]*y+e[8]*z+e[12],e[1]*x+e[5]*y+e[9]*z+e[13]+fall*half,e[2]*x+e[6]*y+e[10]*z+e[14],out.size,out.rotation,out.color,out.alpha,out.frame);}
   container.upload();return;}
  // Gravity is world-down; the container draws in the emitter's local space, so undo each ancestor's rotation and scale.
  const chain:Container3D[]=[];for(let n:Container3D|null=node;n&&n!==slot.view.root;n=n.parent as Container3D|null)chain.unshift(n);
  let gx=0,gy=-data.gravity,gz=0;for(const n of chain){const q=n.quaternion,x=-q.x,y=-q.y,z=-q.z,w=q.w,tx=2*(y*gz-z*gy),ty=2*(z*gx-x*gz),tz=2*(x*gy-y*gx);
   gx+=w*tx+y*tz-z*ty;gy+=w*ty+z*tx-x*tz;gz+=w*tz+x*ty-y*tx;gx/=n.scale.x||1;gy/=n.scale.y||1;gz/=n.scale.z||1;}
  for(let i=0;i<data.count;i++){writeParticle3D(data,i,time,out,gx,gy,gz);if(out.alive)container.setParticleAt(i,out.x,out.y,out.z,out.size,out.rotation,out.color,out.alpha,out.frame);else container.setParticleAt(i,0,0,0,0);}
  container.upload();
 }
 /** The view's post chain in order: SSAO and bloom on linear light (float targets), then camera motion blur, tilt-shift, tint, colour LUT and FXAA. */
 private postEffects(slot:ProjectedView3D,data:ReturnType<typeof Viewport3DSchema.parse>){const passes:(SsaoEffect|BloomEffect|MotionBlurEffect|TiltShiftEffect|TintEffect|ColorLutEffect|FxaaEffect|VelocityViewer)[]=[],float=this.floatTargets();
  const lit=(name:string,make:()=>SsaoEffect|BloomEffect)=>{if(float)passes.push(make());else this.context.report(Error(`3D view ${name}: this device cannot render float post effects (EXT_color_buffer_float); ${name} is off`));};
  if(data.ssao)lit('ambient occlusion',()=>new SsaoEffect({radius:data.ssaoRadius,intensity:data.ssaoIntensity}));
  if(data.bloom)lit('bloom',()=>new BloomEffect({threshold:data.bloomThreshold,intensity:data.bloomIntensity,radius:data.bloomRadius}));
  if(data.motionBlur)passes.push(new MotionBlurEffect({intensity:data.motionBlurIntensity,samples:data.motionBlurSamples,maxLength:data.motionBlurMaxLength}));
  if(data.depthOfField)passes.push(new TiltShiftEffect({focalDepth:data.focusDistance,focalNear:data.focusRange,focalFar:data.focusFalloff,maxBlur:data.focusBlur}));
  if(data.tint.toLowerCase()!=='#ffffff')passes.push(new TintEffect({tint:data.tint}));
  if(data.lutAssetId)passes.push(this.colorLut(slot,data.lutAssetId,data.lutIntensity));
  if(data.antialias)passes.push(new FxaaEffect());
  if(data.debugView==='velocity')passes.push(new VelocityViewer({scale:data.velocityScale}));
  slot.resources.push(...passes);return passes;}
/** A Library image shared per URL and use: decoded once, handed to every view that shows it, closed with the last one. */
 private images=new Map<string,{refs:number;promise:Promise<TextureSource>;source?:TextureSource;texture?:Texture;bitmap?:ImageBitmap}>();
 private libraryImage(slot:ProjectedView3D,assetId:string,use:'lut'|'surface',what:string,apply:(source:TextureSource,texture:Texture)=>void){
  const assets=this.resources?.assets,asset=assets?.get(assetId),fail=(error:unknown)=>this.context.report(Error(`${what}: ${error instanceof Error?error.message:String(error)}`));
  if(!assets||!asset||asset.type!=='pixi.texture'){fail('the image is missing from the Library');return;}
  const url=assets.url(asset,'image.webp'),key=`${use}:${url}`;let entry=this.images.get(key);
  if(!entry){const created:{refs:number;promise:Promise<TextureSource>;source?:TextureSource;texture?:Texture;bitmap?:ImageBitmap}={refs:0,promise:Promise.resolve(Texture.WHITE.source)};
   // No colour management: the shaders decode colour maps themselves, and normal, roughness and LUT texels are data a display-profile conversion would bend.
   // Material shaders read premultiplied texels (they divide by alpha), so surface maps are premultiplied while decoding: WebGL ignores
   // its upload flag for an ImageBitmap and would otherwise get straight alpha while WebGPU premultiplies on upload.
   created.promise=fetch(url).then(r=>{if(!r.ok)throw Error('the image is unavailable');return r.blob();}).then(blob=>createImageBitmap(blob,{colorSpaceConversion:'none',premultiplyAlpha:use==='surface'?'premultiply':'none'})).then(bitmap=>{created.bitmap=bitmap;const source=Texture.from(bitmap).source;
    if(use==='surface'){source.style=new TextureStyle({addressMode:'repeat',scaleMode:'linear',mipmapFilter:'linear',maxAnisotropy:4});source.autoGenerateMipmaps=true;}
    created.source=source;created.texture=new Texture({source});return source;});
   entry=created;this.images.set(key,entry);}
  entry.refs++;const owned=entry;let released=false;
  slot.releases.push(()=>{if(released)return;released=true;owned.refs--;queueMicrotask(()=>{if(!owned.refs&&this.images.get(key)===owned){this.images.delete(key);void owned.promise.then(source=>{owned.texture?.destroy();source.destroy();owned.bitmap?.close();},()=>{});}});});
  const run=()=>{try{apply(owned.source!,owned.texture!);}catch(error){fail(error);}};
  if(owned.source)run();
  else{const load:{pending?:Promise<void>;error?:string}={};slot.loads.push(load);
   load.pending=owned.promise.then(()=>{if(released||this.dead)return;run();this.context.changed();},error=>{if(released||this.dead)return;load.error=`${what}: ${String(error)}`;fail(error);});}
 }
 private videos=new Map<string,{refs:number;promise:Promise<Texture>;texture?:Texture;video?:HTMLVideoElement;objectUrl?:string}>();
 /** A Library video playing muted in a loop, one element per clip; the first frame gates readiness, the last release stops it. */
 private libraryVideo(slot:ProjectedView3D,assetId:string,what:string,apply:(texture:Texture)=>void){
  const assets=this.resources?.assets,asset=assets?.get(assetId),fail=(error:unknown)=>this.context.report(Error(`${what}: ${error instanceof Error?error.message:String(error)}`));
  if(!assets||!asset||asset.type!==videoAssetType){fail('the video is missing from the Library');return;}
  if(typeof document==='undefined'){fail('video needs a browser');return;}
  const url=assets.url(asset,videoFile(VideoMetadataSchema.parse(asset.metadata)));let entry=this.videos.get(url);
  if(!entry){const created:{refs:number;promise:Promise<Texture>;texture?:Texture;video?:HTMLVideoElement;objectUrl?:string}={refs:0,promise:Promise.resolve(Texture.WHITE)};
   const video=document.createElement('video');Object.assign(video,{muted:true,loop:true,playsInline:true,autoplay:true,preload:'auto',crossOrigin:'anonymous'});video.setAttribute('muted','');created.video=video;
   // Played from a blob of the fetched file: the editor's CSP lets media load only from blobs, and a blob needs no range requests.
   created.promise=fetch(url).then(r=>{if(!r.ok)throw Error('the video is unavailable');return r.blob();}).then(blob=>new Promise<Texture>((resolve,reject)=>{created.objectUrl=URL.createObjectURL(blob);
    video.addEventListener('loadeddata',()=>{const texture=Texture.from(video);created.texture=texture;void video.play().catch(()=>{});resolve(texture);},{once:true});video.addEventListener('error',()=>reject(Error('the video cannot be played here')),{once:true});video.src=created.objectUrl;}));
   entry=created;this.videos.set(url,entry);}
  entry.refs++;const owned=entry;let released=false;
  slot.releases.push(()=>{if(released)return;released=true;owned.refs--;queueMicrotask(()=>{if(!owned.refs&&this.videos.get(url)===owned){this.videos.delete(url);owned.video?.pause();owned.texture?.destroy(true);if(owned.video){owned.video.removeAttribute('src');owned.video.load();}if(owned.objectUrl)URL.revokeObjectURL(owned.objectUrl);}});});
  const run=()=>{try{apply(owned.texture!);}catch(error){fail(error);}};
  if(owned.texture)run();
  else{const load:{pending?:Promise<void>;error?:string}={};slot.loads.push(load);
   load.pending=owned.promise.then(()=>{if(released||this.dead)return;run();this.context.changed();},error=>{if(released||this.dead)return;load.error=`${what}: ${String(error)}`;fail(error);});}
 }
 private cubes=new Map<string,{refs:number;promise:Promise<CubeTexture>;cube?:CubeTexture;bitmaps:ImageBitmap[]}>();
 /** A cube map cut from one Library image (cross, strip or column), shared per URL; its first decode gates readiness. */
 private libraryCube(slot:ProjectedView3D,assetId:string,apply:(cube:CubeTexture)=>void){
  const assets=this.resources?.assets,asset=assets?.get(assetId),fail=(error:unknown)=>this.context.report(Error(`3D view cube map: ${error instanceof Error?error.message:String(error)}`));
  if(!assets||!asset||asset.type!=='pixi.texture'){fail('the image is missing from the Library');return;}
  const url=assets.url(asset,'image.webp');let entry=this.cubes.get(url);
  if(!entry){const created:{refs:number;promise:Promise<CubeTexture>;cube?:CubeTexture;bitmaps:ImageBitmap[]}={refs:0,promise:Promise.resolve(null as unknown as CubeTexture),bitmaps:[]};
   created.promise=fetch(url).then(r=>{if(!r.ok)throw Error('the image is unavailable');return r.blob();}).then(blob=>createImageBitmap(blob,{colorSpaceConversion:'none',premultiplyAlpha:'none'})).then(async whole=>{
    try{const layout=cubeLayout(whole.width,whole.height),faces={} as Record<CubeFace,TextureSource>;
     for(const face of cubeFaces){const {x,y}=layout.faces[face],bitmap=await createImageBitmap(whole,x,y,layout.size,layout.size,{colorSpaceConversion:'none',premultiplyAlpha:'none'});created.bitmaps.push(bitmap);faces[face]=Texture.from(bitmap).source;}
     const cube=CubeTexture.from({faces});created.cube=cube;return cube;}finally{whole.close();}});
   entry=created;this.cubes.set(url,entry);}
  entry.refs++;const owned=entry;let released=false;
  slot.releases.push(()=>{if(released)return;released=true;owned.refs--;queueMicrotask(()=>{if(!owned.refs&&this.cubes.get(url)===owned){this.cubes.delete(url);void owned.promise.then(cube=>{cube.destroy(true);for(const b of owned.bitmaps)b.close();},()=>{});}});});
  const run=()=>{try{apply(owned.cube!);}catch(error){fail(error);}};
  if(owned.cube)run();
  else{const load:{pending?:Promise<void>;error?:string}={};slot.loads.push(load);
   load.pending=owned.promise.then(()=>{if(released||this.dead)return;run();this.context.changed();},error=>{if(released||this.dead)return;load.error=`3D view cube map: ${String(error)}`;fail(error);});}
 }
 /** A view-sized texture a portal's far side is drawn into: float where the device renders float targets, so the opening keeps its light. */
 private portalFeed(slot:ProjectedView3D,data:{width:number;height:number}){const texture=RenderTexture.create({width:data.width,height:data.height,...this.floatTargets()?{format:'rgba16float' as const}:{}});slot.resources.push(texture);return texture;}
 /**
  * Draws each camera a surface shows into its own texture (one opaque pass per camera, before the view's effects) and
  * each portal's far side from behind its exit. A camera can't feed the view it is the active camera of.
  */
 private connectFeeds(slot:ProjectedView3D,data:{cameraId?:string}){const textures=new Map<string,RenderTexture>();const extra:(MeshPass|PortalPass|MirrorPass)[]=[];
  for(const feed of slot.feeds??[]){const camera=slot.cameras.get(feed.cameraId);
   if(!camera){this.context.report(Error(`${feed.owner}: no camera ${feed.cameraId} in this 3D view`));continue;}
   if(feed.cameraId===data.cameraId){this.context.report(Error(`${feed.owner}: the view's own camera can't be shown on a surface; add a second camera`));continue;}
   let texture=textures.get(feed.cameraId);
   if(!texture){const size=slot.feedSizes?.get(feed.cameraId)??{width:512,height:288};texture=RenderTexture.create({...size,antialias:true});textures.set(feed.cameraId,texture);camera.renderTexture=texture;const pass=new MeshPass({name:'opaque',camera});slot.resources.push(texture,pass);extra.push(pass);}
   (feed.material.textures as Record<string,Texture>).baseColor=texture;}
  for(const portal of slot.portals??[]){const exit=slot.nodes.get(portal.exitId)?.children.find(c=>c instanceof Mesh3D) as Mesh3D|undefined;
   if(!exit){this.context.report(Error(`${portal.owner}: the portal exit ${portal.exitId} is not a primitive in this 3D view`));continue;}
   const pass=new PortalPass({entry:portal.entry,exit,texture:portal.texture});slot.resources.push(pass);extra.push(pass);}
  for(const m of slot.mirrors??[]){const pass=new MirrorPass(m.mesh,m.texture);slot.resources.push(pass);extra.push(pass);}
  if(extra.length)slot.view.passes=[...extra,...slot.view.passes];}
 /**
  * Hands each view's scene camera to its Camera control, once per Play: the camera moves to the view's root keeping
  * its world pose (so the controller works in world space), and `stopCameraControls` puts it back.
  */
 private startCameraControl(s:ProjectedView3D,camera:Camera3D){const control=s.cameraId?s.controls?.get(s.cameraId):undefined;if(!control||s.controller?.camera===camera)return;
  const node=camera.parent as Container3D;s.view.root.reparentChild(camera);
  let controller:{destroy():void};
  if(control.mode==='firstPerson'){const forward=new Vector3(0,0,-1).applyQuaternion(camera.quaternion),{yaw,pitch}=yawPitch(forward);
   controller=new FPSCamera({view:s.view,position:{x:camera.x,y:camera.y,z:camera.z},yaw,pitch,moveSpeed:control.moveSpeed,lookSpeed:control.lookSpeed,pointerLock:control.pointerLock});}
  else controller=new OrbitCamera({view:s.view,target:{x:control.targetX,y:control.targetY,z:control.targetZ},minDistance:control.minDistance,maxDistance:control.maxDistance,enableZoom:control.enableZoom,enablePan:control.enablePan,enableDamping:control.damping,autoRotate:control.autoRotate,autoRotateSpeed:control.autoRotateSpeed});
  s.controller={destroy:()=>controller.destroy(),camera,node};}
 /** Ends Play's camera controls and returns each controlled camera to its entity, as authored. */
 stopCameraControls(){for(const s of this.slots){const c=s.controller;if(!c)continue;s.controller=undefined;c.destroy();if(!c.node.destroyed&&!c.camera.destroyed){c.node.addChild(c.camera);c.camera.position.set(0,0,0);c.camera.quaternion.set(0,0,0,1);c.camera.scale.set(1,1,1);}}}
 private follows:{id:string;name:string;data:Follow}[]=[];private hiddenFollowers=new Set<string>();
 /** Hand-set morph weights, then bone aims, over whatever the clip posed this frame. */
 private poseRigs(){for(const slot of this.slots){
  for(const m of slot.morphs??[]){const instance=slot.models.get(m.entityId)?.instance;if(!instance)continue;instance.traverse(child=>{if(child instanceof Mesh3D&&child.weights)for(let i=0;i<Math.min(child.weights.length,m.weights.length);i++)child.weights[i]=m.weights[i];});}
  for(const aim of slot.aims??[]){const instance=slot.models.get(aim.entityId)?.instance,target=slot.nodes.get(aim.data.targetId);if(!instance||!target||!aim.data.bone||aim.missing)continue;
   const skeleton=instance.skeletons.find(k=>k.indexOf(aim.data.bone)>=0);if(!skeleton){aim.missing=true;this.context.report(Error(`Aim a bone: no bone "${aim.data.bone}" in the model`));continue;}
   aimBone(skeleton,skeleton.indexOf(aim.data.bone),instance.getGlobalTransform(),target.getGlobalPosition(),aim.data);}}}
 /**
  * Draws each 2D object a surface shows into its texture, without moving it: rendered on its own, at its own origin,
  * shown just for the capture if it is hidden on the stage. Needs the renderer.
  */
 private captureScreens(){const renderer=this.context.renderer;if(!renderer)return;
  for(const slot of this.slots)for(const screen of slot.screens??[]){const node=this.context.node(screen.sourceId) as PixiContainer|undefined;
   if(!node||node.destroyed){if(!screen.missing){screen.missing=true;this.context.report(Error(`${screen.owner}: no 2D object ${screen.sourceId} to show`));}continue;}
   // Rendered as the root of its own pass, the object draws at its own origin: its position on the stage is ignored.
   screen.missing=false;const shown=node.visible;node.visible=true;
   try{renderer.render({container:node,target:screen.texture,clear:true,clearColor:[0,0,0,0],transform:identity,flipY:true});}finally{node.visible=shown;}}}
 /** Moves each following 2D object onto its 3D target's place on screen while that view looks through its scene camera. */
 private placeFollowers(){for(const f of this.follows){const slot=this.slots.find(s=>s.nodes.has(f.data.targetId)),node=this.context.node(f.id) as PixiContainer|undefined;if(!slot||!node?.parent||slot.view.camera===slot.defaultCamera)continue;
   const p=slot.nodes.get(f.data.targetId)!.getGlobalPosition(),at=slot.view.worldToScreen({x:p.x+f.data.offsetX,y:p.y+f.data.offsetY,z:p.z+f.data.offsetZ});
   if(!at){if(f.data.hideBehind&&node.visible){node.visible=false;this.hiddenFollowers.add(f.id);}continue;}
   if(this.hiddenFollowers.delete(f.id))node.visible=true;const local=node.parent.toLocal(at);node.position.set(local.x,local.y);}}
 /**
  * Game-time pointer handling on a view (it hears pointers only while the game runs): hover enter/leave events for
  * rules, and dragging a Draggable object along its plane, written back through `moved`.
  */
 private pointerEvents(slot:ProjectedView3D){const view=slot.view,state=this.pointers.get(slot.id)??{};this.pointers.set(slot.id,state);
  const objectAt=(global:{x:number;y:number})=>{const hit=view.raycast(global);let target=hit?.target as Container3D|null|undefined;while(target&&slot.nodes.get(target.label??'')!==target)target=target.parent as Container3D|null;return target?{id:target.label!,node:target}:undefined;};
  // The hovered object and the groups it sits in, innermost first: entering a child enters its groups too.
  const chainOf=(id:string|undefined)=>{const out:string[]=[];for(let n=id?slot.nodes.get(id):undefined;n;){out.push(n.label!);let p=n.parent as Container3D|null;while(p&&slot.nodes.get(p.label??'')!==p)p=p.parent as Container3D|null;n=p??undefined;}return out;};
  const hover=(id:string|undefined)=>{if(id===state.hovered)return;const chain=chainOf(id),{leave,enter}=hoverChanges(state.chain??[],chain);state.hovered=id;state.chain=chain;for(const x of leave)this.context.emit?.('pixi3d.pointerLeave',x);for(const x of enter)this.context.emit?.('pixi3d.pointerEnter',x);};
  view.on('pointerdown',e=>{state.press={x:e.global.x,y:e.global.y};state.paint=undefined;if(slot.paints?.length&&slot.view.camera!==slot.defaultCamera){const at=this.paintAt(slot,e.global);if(at){state.paint={entityId:at.paint.entityId,last:at.uv};this.dab(at.paint,[at.uv]);}}const hit=objectAt(e.global),data=hit&&slot.drags?.get(hit.id);state.dragged=false;if(!hit||!data)return;
   // The plane runs through the object's origin (the ground at its height, or facing the camera); the press point on
   // it gives the offset the object keeps from the pointer.
   const origin=hit.node.getGlobalPosition(),eye=view.camera.getGlobalPosition(),toward=new Vector3(eye.x-origin.x,eye.y-origin.y,eye.z-origin.z),length=Math.hypot(toward.x,toward.y,toward.z)||1;
   const normal=data.plane==='ground'?new Vector3(0,1,0):new Vector3(toward.x/length,toward.y/length,toward.z/length),point=new Vector3(origin.x,origin.y,origin.z),ray=view.screenToRay(e.global),press=rayPlane(ray.origin,ray.direction,point,normal);if(!press)return;
   state.drag={id:hit.id,normal,point,offset:new Vector3(origin.x-press.x,origin.y-press.y,origin.z-press.z),data};e.stopPropagation();});
  view.on('globalpointermove',e=>{this.followPointer(slot,e.global);if(state.paint){const at=this.paintAt(slot,e.global);if(at&&at.paint.entityId===state.paint.entityId){this.dab(at.paint,state.paint.last?strokeDabs(state.paint.last,at.uv,at.paint.data.brushSize):[at.uv]);state.paint.last=at.uv;}else state.paint.last=undefined;}const drag=state.drag,node=drag&&slot.nodes.get(drag.id);if(!drag||!node){hover(objectAt(e.global)?.id);return;}
   const ray=view.screenToRay(e.global),at=rayPlane(ray.origin,ray.direction,drag.point,drag.normal);if(!at)return;
   const world=new Vector3(at.x+drag.offset.x,at.y+drag.offset.y,at.z+drag.offset.z),parent=node.parent as Container3D|null;
   const local=parent?world.applyMatrix4(new Matrix4().getInverse(parent.getGlobalTransform())):world,p={x:snapTo(local.x,drag.data.snap),y:local.y,z:snapTo(local.z,drag.data.snap)};
   if(drag.data.plane==='view')p.y=snapTo(local.y,drag.data.snap);node.position.set(p.x,p.y,p.z);state.dragged=true;this.context.moved?.(drag.id,p);});
  // A press and release without moving is a click (pointer.click), not a drop.
  const drop=(release?:{x:number;y:number})=>{state.paint=undefined;const id=state.drag?.id,dragged=state.dragged,press=state.press;state.drag=undefined;state.dragged=false;state.press=undefined;if(id&&dragged)this.context.emit?.('pixi3d.dragEnd',id);
   if(release&&press&&!dragged&&Math.hypot(release.x-press.x,release.y-press.y)<6&&slot.view.camera!==slot.defaultCamera)this.stampDecals(slot,release);};
  view.on('pointerup',e=>drop(e.global));view.on('pointerupoutside',()=>drop());
 }
 /** A strip LUT effect; until its image decodes the picture passes through unchanged. */
 private colorLut(slot:ProjectedView3D,assetId:string,intensity:number){const effect=new ColorLutEffect({intensity});this.libraryImage(slot,assetId,'lut','3D view colour LUT',source=>{effect.lut=source;});return effect;}
 /** A primitive's material for its lighting model, with its Library maps filled in as they decode and its UVs placed (and scrolled). */
 private surface(slot:ProjectedView3D,owner:string,d:Surface&{color:string;roughness:number;metallic:number;emissiveColor:string;emissiveStrength:number},flipV:boolean){
  const textured=surfaceTextureKeys.some(k=>d[k])||Boolean(d.videoTexture)||Boolean(d.screenSourceId),glow=d.emissiveStrength>0||Boolean(d.emissiveTexture);
  const common={baseColor:d.color,alphaMode:d.alphaMode,alpha:d.alphaMode==='blend'?d.alpha:1,alphaCutoff:d.alphaCutoff,doubleSided:d.doubleSided,flatShading:d.material==='flat'?false:d.flatShading,...textured?{uvTransform:toMatrix(uvMatrix(d,this.particleTime,flipV))}:{}};
  // A map's emissive slot exists only when the material is built with an emissive group; a glow map alone glows at strength 1.
  const emissive=glow?{emissive:{color:d.emissiveTexture&&d.emissiveColor==='#000000'?'#ffffff':d.emissiveColor,strength:d.emissiveStrength>0?d.emissiveStrength:1,...d.emissiveTexture?{texture:Texture.WHITE}:{}}}:{};
  const material=d.material==='phong'?new PhongMaterial({...common,shininess:d.shininess,specularStrength:d.specularStrength,specularColor:d.specularColor,normalScale:d.normalScale,...emissive})
   :d.material==='flat'?new FlatMaterial(common)
   :d.material==='toon'?new ToonMaterial({...common,bands:d.toonBands,specularSize:d.toonSpecularSize,rimIntensity:d.toonRimIntensity,outline:d.toonOutline})
   :new Material3D({...common,roughness:d.roughness,metallic:d.metallic,normalScale:d.normalScale,occlusionStrength:d.occlusionStrength,...emissive,...pbrExtensions(d)});
  const pbr=d.material==='pbr',lit=pbr||d.material==='phong';
  const slots:Record<SurfaceTextureKey,[string,boolean]>={baseColorTexture:['baseColor',true],normalTexture:['normal',lit],metallicRoughnessTexture:['metallicRoughness',pbr],occlusionTexture:['occlusion',pbr],emissiveTexture:['emissive',lit&&glow],
   clearcoatTexture:['clearcoat',pbr&&d.clearcoat>0],sheenTexture:['sheen',pbr&&sheenOn(d)],transmissionTexture:['transmission',pbr&&d.transmission>0],iridescenceTexture:['iridescence',pbr&&d.iridescence>0]};
  for(const key of surfaceTextureKeys){const id=d[key];if(!id||!slots[key][1])continue;
   this.libraryImage(slot,id,'surface',`${owner}: ${key}`,(_source,texture)=>{(material.textures as unknown as Record<string,Texture>)[slots[key][0]]=texture;});}
  // A live 2D object replaces the colour map; the capture stores its bottom row first, hence the opposite V flip.
  if(d.screenSourceId){const texture=RenderTexture.create({width:d.screenWidth,height:d.screenHeight,antialias:true});slot.resources.push(texture);material.textures.baseColor=texture;(slot.screens??=[]).push({sourceId:d.screenSourceId,texture,owner});}
  // A video replaces the colour map; every surface showing one clip shares its element, so they show the same frame.
  if(d.videoTexture)this.libraryVideo(slot,d.videoTexture,`${owner}: video`,texture=>{material.textures.baseColor=texture;});
  if(textured&&scrolls(d))(slot.surfaces??=[]).push({material,data:d,flipV});
  // Set before the first draw; the alpha mode and two-sidedness set their own parts of the state first.
  const state=renderState(d);material.state.depthTest=state.depthTest;material.state.depthMask=state.depthMask;material.state.cullMode=state.cullMode;if(state.blendMode!=='normal')material.state.blendMode=state.blendMode;
  return material;}
 /** WebGPU always renders to float targets; WebGL needs EXT_color_buffer_float (HDR prefilter, before-tone-mapping post effects). */
 private floatTargets(){const renderer=this.context.renderer as (Renderer&{gl?:WebGL2RenderingContext})|undefined;return !renderer||renderer.type===RendererType.WEBGPU||!renderer.gl||Boolean(renderer.gl.getExtension('EXT_color_buffer_float'));}
 private environments=new Map<string,{refs:number;promise:Promise<CubeTexture>}>();private environmentPorts=environmentSourcePorts();
 private environment(slot:ProjectedView3D,data:ReturnType<typeof Viewport3DSchema.parse>){
  const view=slot.view,color=new Color(data.backgroundColor).toNumber();view.background=data.background==='transparent'?null:color;
  if(data.environment==='hemisphere'){const sky={skyColor:new Color(data.skyColor).toNumber(),groundColor:new Color(data.groundColor).toNumber(),intensity:data.environmentIntensity};view.environment=sky;if(data.background==='environment')view.background=sky;return;}
  if(data.environment==='cubemap'){if(!data.cubemapAssetId)return;
   if(!this.floatTargets()){this.context.report(Error('3D view environment: this device cannot render cube map lighting (EXT_color_buffer_float); using the plain background'));return;}
   this.libraryCube(slot,data.cubemapAssetId,cube=>{view.environment=cube;if(data.background==='environment')view.background=cube;});return;}
  if(data.environment!=='hdr'||!data.environmentAssetId)return;
  const assets=this.resources?.assets,asset=assets?.get(data.environmentAssetId);
  if(!assets||!asset||asset.type!==environmentAssetType){this.context.report(Error('3D view environment: the HDR asset is missing'));return;}
  EnvironmentMetadataSchema.parse(asset.metadata);
  // WebGL prefilters the HDR cube into float targets; without EXT_color_buffer_float it would throw, so keep the colour background instead.
  if(!this.floatTargets()){this.context.report(Error('3D view environment: this device cannot render HDR lighting (EXT_color_buffer_float); using the plain background'));return;}
  const url=assets.url(asset,'environment.hdr');let entry=this.environments.get(url);if(!entry){entry={refs:0,promise:this.environmentPorts.load(url)};this.environments.set(url,entry);}entry.refs++;const owned=entry;let released=false;
  slot.releases.push(()=>{if(released)return;released=true;owned.refs--;queueMicrotask(()=>{if(!owned.refs&&this.environments.get(url)===owned){this.environments.delete(url);void owned.promise.then(()=>this.environmentPorts.unload(url),()=>{}).catch(e=>this.context.report(e));}});});
  slot.environment=owned.promise.then(cube=>{if(released||this.dead)return;view.environment=cube;if(data.background==='environment')view.background=cube;this.context.changed();},error=>{if(!released)this.context.report(Error(`3D view environment: ${String(error)}`));});
 }
 async ready(){if(this.dead)throw Error('3D projection disposed');const revision=this.revision,models=[...this.slots.flatMap(s=>[...s.models.values()]),...this.slots.flatMap(s=>s.loads)];await Promise.race([Promise.all([...models.map(m=>m.pending),...this.slots.map(s=>s.environment),...this.slots.flatMap(s=>s.shaderChecks??[])]),this.changed]);if(this.dead)throw Error('3D projection disposed');if(revision!==this.revision)throw Error('3D projection changed during preparation');const errors=models.flatMap(m=>m.error?[m.error]:[]);if(errors.length)throw Error(errors.join('\n'));}
 useSceneCameras(){for(const s of this.slots){const camera=s.cameraId?s.cameras.get(s.cameraId):undefined;if(!camera||!visible3D(camera))throw Error(`3D view ${s.id} needs an active camera inside its own hierarchy`);if(s.view.camera!==camera){s.view.camera=camera;camera.resetHistory();}this.startCameraControl(s,camera);}}
 pick(slot:ProjectedView3D,point:PointData,clickable?:(id:string)=>boolean){
  const skipped:[Container3D,Container3D['eventMode']][]=[];
  try{for(;;){const hit=slot.view.raycast(point);let target=hit?.target;while(target&&slot.nodes.get(target.label??'')!==target)target=target.parent??undefined;if(!target)return null;
   if(!clickable)return target.label;
   const top=target;for(;target;target=target.parent??undefined)if(slot.nodes.get(target.label??'')===target&&clickable(target.label??''))return target.label;
   skipped.push([top,top.eventMode]);top.eventMode='none';
  }}finally{for(const [node,mode]of skipped.reverse())node.eventMode=mode;}
 }
 /** The closest 3D object under a global point in any view (top view first), for scripts: the owning object, world point, normal and UV (triangle hits only). */
 raycastHit(point:PointData){for(const slot of [...this.slots].reverse()){if(!slot.host.visible)continue;const hit=slot.view.raycast(point);let target=hit?.target as Container3D|null|undefined;while(target&&slot.nodes.get(target.label??'')!==target)target=target.parent as Container3D|null;if(!hit||!target)continue;
  const v=(p:{x:number;y:number;z:number})=>({x:p.x,y:p.y,z:p.z});return{entityId:target.label!,point:v(hit.point),normal:hit.triangleIndex>=0?v(hit.normal):null,uv:hit.triangleIndex>=0?{u:hit.uv.x,v:hit.uv.y}:null,distance:hit.distance};}return null;}
 /** A Model 3D object's load state ('unloaded' while its `loaded` is off). */
 modelState(entityId:string):{state:'unloaded'|'loading'|'ready'|'error';error?:string}{for(const slot of this.slots){const m=slot.models.get(entityId);if(m)return m.error?{state:'error',error:m.error}:{state:m.ready?'ready':'loading'};}return{state:'unloaded'};}
 /** Actual node TRS after animation evaluation; bounded and opt-in, never serialized every frame. */
 inspectModel(input:unknown){const q=ModelPoseQuerySchema.parse(input),slot=this.slots.find(s=>s.models.has(q.entityId)),model=slot?.models.get(q.entityId);if(!model)throw Error('3D model entity is missing');if(!model.instance)return{entityId:q.entityId,ready:false,error:model.error??null,offset:q.offset,nextOffset:null,nodes:[]};
  const stack:{node:Container3D;path:number[]}[]=[{node:model.instance,path:[]}],nodes:{path:number[];label:string|null;kind:string;position:{x:number;y:number;z:number};quaternion:{x:number;y:number;z:number;w:number};scale:{x:number;y:number;z:number};worldPosition:{x:number;y:number;z:number}}[]=[];let count=0,more=false;
  while(stack.length){const item=stack.pop()!;if(count++>=q.offset){if(nodes.length===q.limit){more=true;break;}const n=item.node,world=n.getGlobalPosition();nodes.push({path:item.path,label:n.label?.slice(0,256)??null,kind:n instanceof Mesh3D?'mesh':'node',position:{x:n.x,y:n.y,z:n.z},quaternion:{x:n.quaternion.x,y:n.quaternion.y,z:n.quaternion.z,w:n.quaternion.w},scale:{x:n.scale.x,y:n.scale.y,z:n.scale.z},worldPosition:{x:world.x,y:world.y,z:world.z}});}for(let i=item.node.children.length-1;i>=0;i--)stack.push({node:item.node.children[i],path:[...item.path,i]});
  }
  return{entityId:q.entityId,ready:true,error:model.error??null,offset:q.offset,nextOffset:more?q.offset+nodes.length:null,nodes};
 }
 inspectDeformation(input:unknown){const q=ModelDeformationQuerySchema.parse(input),model=this.slots.find(s=>s.models.has(q.entityId))?.models.get(q.entityId);if(!model)throw Error('3D model entity is missing');if(!model.instance)return{entityId:q.entityId,ready:false,error:model.error??null,meshIndex:q.meshIndex,meshCount:0,totalWeights:0,weightsTruncated:false,weights:[],skeleton:null,material:null};const meshes:Mesh3D[]=[];model.instance.traverse(node=>{if(node instanceof Mesh3D)meshes.push(node);});const mesh=meshes[q.meshIndex];if(!mesh)throw Error('Model mesh index is out of range');const s=mesh.skeleton,nodes=[];if(s){s.updateWorld();for(let i=q.offset;i<Math.min(s.nodeCount,q.offset+q.limit);i++){const jointIndex=Array.from(s.joints).indexOf(i);nodes.push({index:i,jointIndex:jointIndex<0?null:jointIndex,position:Array.from(s.localPosition.slice(i*3,i*3+3)),quaternion:Array.from(s.localRotation.slice(i*4,i*4+4)),scale:Array.from(s.localScale.slice(i*3,i*3+3)),skinningMatrix:jointIndex<0?null:Array.from(s.worldMatrix.slice(jointIndex*12,jointIndex*12+12))});}}const totalWeights=mesh.weights?.length??0,texture=mesh.material.textures.baseColor;return{material:{color:'#'+mesh.material.baseColor.toString(16).padStart(6,'0'),alpha:mesh.material.alpha,alphaMode:mesh.material.alphaMode,texture:{textured:Boolean(texture&&texture!==Texture.WHITE),width:texture?.width??0,height:texture?.height??0}},entityId:q.entityId,ready:true,error:null,meshIndex:q.meshIndex,meshCount:meshes.length,totalWeights,weightsTruncated:totalWeights>128,weights:Array.from(mesh.weights?.slice(0,128)??[]),skeleton:s?{matrixFormat:'row-major-3x4',nodeCount:s.nodeCount,jointCount:s.jointCount,offset:q.offset,nextOffset:q.offset+nodes.length<s.nodeCount?q.offset+nodes.length:null,nodes}:null};}
 inspectMaterials(input:unknown){const q=ModelPoseQuerySchema.parse(input),model=this.slots.find(s=>s.models.has(q.entityId))?.models.get(q.entityId);if(!model)throw Error('3D model entity is missing');const instance=model.instance;if(!instance)return{entityId:q.entityId,ready:false,error:model.error??null,offset:q.offset,totalMaterials:0,nextOffset:null,materials:[]};const list=instance.materials,materials=list.slice(q.offset,q.offset+q.limit).map((material,i)=>({index:q.offset+i,label:material.label?.slice(0,256)??null,overridden:material!==instance.source.materials[q.offset+i],color:'#'+material.baseColor.toString(16).padStart(6,'0'),...(material instanceof Material3D?{roughness:material.roughness,metallic:material.metallic}:{})}));return{entityId:q.entityId,ready:true,error:null,offset:q.offset,totalMaterials:list.length,nextOffset:q.offset+materials.length<list.length?q.offset+materials.length:null,materials};}
 diagnostics(){return{rebuilds:this.revision,views:this.slots.map(s=>({id:s.id,highlights:(s.highlights??[]).slice(0,32).map(h=>({entityId:h.entityId,kind:h.kind,enabled:h.enabled,...h.box?{box:{visible:h.box.visible,inScene:h.box.parent===s.view.root,position:[h.box.x,h.box.y,h.box.z].map(v=>+v.toFixed(3)),scale:[h.box.scale.x,h.box.scale.y,h.box.scale.z].map(v=>+v.toFixed(3))}}:{}})),models:[...s.models].map(([id,m])=>({id,key:m.key,ready:m.ready,error:m.error??null}))})),resources:this.resources?.stats??null,sharedResources:sharedSources.stats};}
 /** Forgets hover and drag state, so the next Play starts with nothing hovered or held. */
 resetPointers(){this.resetScripted();for(const state of this.pointers.values()){state.paint=undefined;state.hovered=undefined;state.chain=undefined;state.press=undefined;state.drag=undefined;state.dragged=false;}
  // Decals and holds belong to one play session.
  for(const slot of this.slots){for(const d of slot.decals??[]){for(const m of d.stamped)this.dropDecal(m);d.stamped.length=0;d.count=0;}for(const space of slot.decalSpaces??[])if(!space.destroyed){space.removeFromParent();space.destroy();}if(slot.decalSpaces)slot.decalSpaces.length=0;for(const a of slot.attaches??[])a.offset=undefined;for(const paint of slot.paints??[])this.fillPaint(paint);}}
 clear(){this.stopCameraControls();this.revision++;this.invalidate();this.changed=new Promise<void>(resolve=>{this.invalidate=resolve;});this.context.beforeClear?.();for(const s of this.slots){s.view.destroy({children:true});for(const resource of s.resources)resource.destroy();for(const release of s.releases)release();}this.slots.length=0;this.signature='';}
 async dispose(){if(this.dead)return;this.dead=true;this.clear();await this.resources?.dispose();}
}
function toMatrix(m:readonly number[]){return new Matrix(m[0],m[1],m[2],m[3],m[4],m[5]);}
/** Group options for a PBR surface's glTF extensions; a texture placeholder reserves the slot a Library map fills later. */
function pbrExtensions(d:Surface){const map=(id:string)=>id?{texture:Texture.WHITE}:{};return{
 ...d.ior!==1.5?{ior:d.ior}:{},
 ...d.specularFactor!==1||d.specularColor.toLowerCase()!=='#ffffff'?{specular:{factor:d.specularFactor,color:d.specularColor}}:{},
 ...d.clearcoat>0?{clearcoat:{factor:d.clearcoat,roughness:d.clearcoatRoughness,...map(d.clearcoatTexture)}}:{},
 ...sheenOn(d)?{sheen:{color:d.sheenColor,roughness:d.sheenRoughness,...map(d.sheenTexture)}}:{},
 ...d.transmission>0?{transmission:{factor:d.transmission,thickness:d.thickness,attenuationColor:d.attenuationColor,...d.attenuationDistance>0?{attenuationDistance:d.attenuationDistance}:{},...map(d.transmissionTexture)}}:{},
 ...d.iridescence>0?{iridescence:{factor:d.iridescence,ior:d.iridescenceIor,thicknessMinimum:d.iridescenceThicknessMin,thicknessMaximum:d.iridescenceThicknessMax,...map(d.iridescenceTexture)}}:{},
 ...d.anisotropy>0?{anisotropy:{strength:d.anisotropy,rotation:d.anisotropyRotation*Math.PI/180}}:{},
};}
/**
 * Whether a view has a glass (transmission) surface inside it. On WebGL a view drawn straight onto the opaque canvas
 * shows nothing through glass, so such a view draws through its own texture (`composite`).
 */
function holdsGlass(scene:Scene,viewId:string){const byId=new Map(scene.entities.map(e=>[e.id,e]));
 const inside=(e:Entity)=>{for(let p=e.parentId?byId.get(e.parentId):undefined,steps=0;p&&steps<10000;p=p.parentId?byId.get(p.parentId):undefined,steps++)if(p.id===viewId)return true;return false;};
 return scene.entities.some(e=>e.components.some(c=>{if(c.type!=='pixi3d.primitive'||c.version!==1)return false;const v=c.data as {material?:string;transmission?:number};return(v.material??'pbr')==='pbr'&&(v.transmission??0)>0;})&&inside(e));}
/** The geometry of a primitive's shape at unit size (radius 0.5), as a surface, a wireframe of its triangle edges, or its vertices as points. */
/** A unit box's twelve edges as lines (a triangulated cube would also draw each face's diagonal). */
function boxEdges(){const positions=new Float32Array(24);for(let k=0;k<8;k++)positions.set([k&1?.5:-.5,k&2?.5:-.5,k&4?.5:-.5],k*3);
 const indices=new Uint32Array([0,1,2,3,4,5,6,7,0,2,1,3,4,6,5,7,0,4,1,5,2,6,3,7]);return new PixiGeometry3D({positions,normals:new Float32Array(24),uvs:new Float32Array(16),indices,topology:'line-list'});}
function shapeGeometry(d:{shape:string;segments:number;radiusTop:number;openEnded:boolean;capsuleLength:number;tube:number;arc:number;knotP:number;knotQ:number;detail:number;draw:'surface'|'wireframe'|'points'}):PixiGeometry3D{
 const n=d.segments,surface:PixiGeometry3D=d.shape==='cube'?new CubeGeometry():d.shape==='sphere'?new SphereGeometry({radius:.5,widthSegments:n,heightSegments:Math.max(2,Math.round(n/2))}):d.shape==='plane'?new PlaneGeometry({flipV:true})
  :d.shape==='cylinder'?new CylinderGeometry({radiusTop:d.radiusTop,radiusBottom:.5,height:1,radialSegments:n,openEnded:d.openEnded})
  :d.shape==='cone'?new ConeGeometry({radius:.5,height:1,radialSegments:n,openEnded:d.openEnded})
  :d.shape==='capsule'?new CapsuleGeometry({radius:.25,height:d.capsuleLength+.5,radialSegments:n,heightSegments:Math.max(2,Math.round(n/4))})
  :d.shape==='torus'?new TorusGeometry({radius:.5-d.tube,tube:d.tube,tubularSegments:n*2,radialSegments:Math.max(6,Math.round(n/2)),arc:d.arc*Math.PI/180})
  :d.shape==='torusKnot'?new TorusKnotGeometry({radius:.5-d.tube*2,tube:d.tube,tubularSegments:n*4,radialSegments:Math.max(6,Math.round(n/4)),p:d.knotP,q:d.knotQ})
  :new IcosahedronGeometry({radius:.5,detail:d.detail});
 if(d.draw==='surface')return surface;
 const vertices=surface.vertexCount,positions=getAttributeData(surface,'aPosition',3,new Float32Array(vertices*3)),normals=getAttributeData(surface,'aNormal',3,new Float32Array(vertices*3)),uvs=getAttributeData(surface,'aUV',2,new Float32Array(vertices*2));
 const lines=d.draw==='wireframe',triangles=surface.indices,geometry=new PixiGeometry3D({positions,normals,uvs,...lines?{indices:edgeIndices(triangles)}:{},topology:lines?'line-list':'point-list'});
 surface.destroy();return geometry;}
const identity=new Matrix();
const aimScratch={chain:new Matrix4(),local:new Matrix4(),inverse:new Matrix4(),p:new Vector3(),q:new Quaternion(),aim:new Quaternion(),s:new Vector3(),axis:new Vector3(),dir:new Vector3()};
/**
 * Turns skeleton node `i` so its chosen axis points at `target` (world), by the shortest arc in its parent's space,
 * then blends from the clip's pose by `weight`. `modelWorld` is the model's world transform, which the skeleton's
 * root nodes sit in.
 */
export function aimBone(skeleton:Skeleton,i:number,modelWorld:Matrix4,target:{x:number;y:number;z:number},d:BoneAim){const k=aimScratch,lp=skeleton.localPosition,lr=skeleton.localRotation,ls=skeleton.localScale;
 const ancestors:number[]=[];for(let n=skeleton.parent[i];n>=0;n=skeleton.parent[n])ancestors.unshift(n);
 k.chain.copyFrom(modelWorld);for(const n of ancestors){k.local.compose(k.p.set(lp[n*3],lp[n*3+1],lp[n*3+2]),k.q.set(lr[n*4],lr[n*4+1],lr[n*4+2],lr[n*4+3]),k.s.set(ls[n*3],ls[n*3+1],ls[n*3+2]));k.chain.multiplyMatrices(k.chain,k.local);}
 k.inverse.getInverse(k.chain);k.dir.set(target.x,target.y,target.z).applyMatrix4(k.inverse);k.dir.set(k.dir.x-lp[i*3],k.dir.y-lp[i*3+1],k.dir.z-lp[i*3+2]);const len=Math.hypot(k.dir.x,k.dir.y,k.dir.z);if(len<1e-6)return;k.dir.set(k.dir.x/len,k.dir.y/len,k.dir.z/len);
 const a=d.axis,sign=a[0]==='-'?-1:1;k.axis.set(a[1]==='X'?sign:0,a[1]==='Y'?sign:0,a[1]==='Z'?sign:0);k.aim.setFromUnitVectors(k.axis,k.dir);
 k.q.set(lr[i*4],lr[i*4+1],lr[i*4+2],lr[i*4+3]);if(d.weight<1)k.aim.copyFrom(k.q.slerp(k.aim,d.weight));
 lr.set([k.aim.x,k.aim.y,k.aim.z,k.aim.w],i*4);skeleton.dirty=true;}
