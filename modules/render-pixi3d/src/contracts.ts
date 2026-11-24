import {z} from 'zod';
import {shader3dDefinition} from './shader3d';
import {mirror3dDefinition} from './mirror3d';
import {mesh3dDefinition,batch3dDefinition} from './mesh3d';
import type {ComponentDefinition} from '@rewrite/sdk';
import {space3d} from '@rewrite/scene3d';
import {Instances3DSchema,instances3dDefaults,instances3dType} from './instances3d';
import {surfaceShape,surfaceFields} from './surface';
import {primitiveShapes,shapeOptions,shapeFields} from './shapes';
import {Sprite3DSchema,sprite3dDefaults,sprite3dFields,sprite3dType} from './sprite3d';
import {CameraControlSchema,cameraControlFields,cameraControlType} from './camera-control';
import {FollowSchema,followFields,followType} from './follow';
import {BoneAimSchema,boneAimFields,boneAimType} from './rig';
import {DraggableSchema,draggableFields,draggableType} from './interaction3d';
import {decalsType,attachType,paintableType,DecalsSchema,AttachSchema,PaintableSchema,decalsFields,attachFields,paintableFields} from './place3d';
import {lookAtType,pointerFollowType,LookAtSchema,PointerFollowSchema,lookAtFields,pointerFollowFields} from './look3d';
import {outline3dType,wireframeOverlayType,boundsHelperType,Outline3DSchema,WireframeOverlaySchema,BoundsHelperSchema,outline3dFields,wireframeOverlayFields,boundsHelperFields} from './debug3d';
import {Particles3DSchema,particles3dDefaults,particle3dType,particleSpawnShapes,particleTextures,particleSpaces,particleFrameModes,particleBillboards} from './particles3d';
const color=z.string().regex(/^#[0-9a-fA-F]{6}$/),number=z.number().finite();
/** Meshes cast and receive shadows by default; nothing is shadowed until a directional light casts. */
const shadowFlags={castShadow:z.boolean().default(true),receiveShadow:z.boolean().default(true)};
/** Emissive strength past 1 is light brighter than white: that is what a view's bloom picks up. */
export const Primitive3DSchema=z.object({shape:z.enum(primitiveShapes),color,roughness:number.min(0).max(1),metallic:number.min(0).max(1),...shadowFlags,emissiveColor:color.default('#000000'),emissiveStrength:number.min(0).max(50).default(0),...shapeOptions,...surfaceShape}).strict();
export {shadowFlags as meshShadowFlags};
export const Camera3DSchema=z.object({mode:z.enum(['perspective','orthographic']),fov:number.min(1).max(170),near:number.min(.001).max(10000),far:number.min(.002).max(1e6),orthographicSize:number.min(.01).max(10000),feedWidth:z.number().int().min(16).max(4096).default(512),feedHeight:z.number().int().min(16).max(4096).default(288)}).strict().refine(v=>v.far>v.near,'Far must exceed near');
export const shadowPlacements=['fit','bounds','cascades'] as const;
/**
 * Directional shadow placement: `fit` sizes one map to the scene's casters (the default and the older behaviour), `bounds`
 * covers a world-space box, `cascades` splits the camera's view into 1–4 maps that follow it, for large scenes.
 */
const shadowFields={shadowPlacement:z.enum(shadowPlacements).default('fit'),
 shadowBoundsX:number.min(-1e6).max(1e6).default(0),shadowBoundsY:number.min(-1e6).max(1e6).default(0),shadowBoundsZ:number.min(-1e6).max(1e6).default(0),
 shadowBoundsWidth:number.min(.01).max(1e5).default(20),shadowBoundsHeight:number.min(.01).max(1e5).default(20),shadowBoundsDepth:number.min(.01).max(1e5).default(20),
 shadowCascades:z.number().int().min(1).max(4).default(3),shadowMaxDistance:number.min(.1).max(1e5).default(50),shadowLambda:number.min(0).max(1).default(.5),
 shadowBias:number.min(0).max(.1).default(.001),shadowNormalBiasAuto:z.boolean().default(true),shadowNormalBias:number.min(0).max(10).default(.05),shadowUpdate:z.number().int().min(1).max(60).default(1)};
export const lightKinds=['directional','ambient','point','spot'] as const;
/** Point and spot lights sit at the entity; a spot shines along the entity's local -Z. `range` 0 means no limit. Spot cones over 89° cannot shadow. */
const localLightFields={range:number.min(0).max(1e5).default(10),radius:number.min(.01).max(100).default(.1),coneAngle:number.min(1).max(89).default(30),penumbra:number.min(0).max(1).default(.2)};
export const Light3DSchema=z.object({kind:z.enum(lightKinds),color,intensity:number.min(0).max(1000),castShadow:z.boolean().default(false),...localLightFields,...shadowFields}).strict();
export type Light3D=z.infer<typeof Light3DSchema>;
/** Plain shadow options for a directional light; the projection turns `bounds` into a Box. Undefined when it casts none. */
/** Lights that can cast a shadow at all; point and ambient cannot. */
export const shadowCasting=(kind:string)=>kind==='directional'||kind==='spot';
export function lightShadow(d:Light3D){if(!shadowCasting(d.kind)||!d.castShadow)return undefined;
 const common={bias:d.shadowBias,update:d.shadowUpdate,...d.shadowNormalBiasAuto?{}:{normalBias:d.shadowNormalBias}};
 if(d.kind==='spot')return common;
 if(d.shadowPlacement==='cascades')return{...common,cascades:d.shadowCascades as 1|2|3|4,maxDistance:d.shadowMaxDistance,lambda:d.shadowLambda};
 if(d.shadowPlacement==='bounds')return{...common,bounds:{center:{x:d.shadowBoundsX,y:d.shadowBoundsY,z:d.shadowBoundsZ},size:{x:d.shadowBoundsWidth,y:d.shadowBoundsHeight,z:d.shadowBoundsDepth}}};
 return common;}
const def=(type:string,titleKey:string,schema:z.ZodType,defaults:()=>Record<string,string|number|boolean>,fields:ComponentDefinition['fields']):ComponentDefinition=>({type,version:1,titleKey,defaults,parse:v=>schema.parse(v) as Record<string,string|number|boolean>,get dataSchema(){return z.toJSONSchema(schema,{unrepresentable:'any'});},fields,supportedSpaces:[space3d],...(type==='pixi3d.primitive'?{exclusiveGroup:'render.visual'}:{})});
const numeric=(...keys:string[]):ComponentDefinition['fields']=>keys.map(key=>({key,titleKey:'field.'+key,kind:'number'}));
const booleans=(...keys:string[]):ComponentDefinition['fields']=>keys.map(key=>({key,titleKey:'field.'+key,kind:'boolean'}));
const enums=(key:string,values:string[]):ComponentDefinition['fields'][number]=>({key,titleKey:'field.'+key,kind:'enum',options:values.map(value=>({value,titleKey:'scene3d.'+value}))});
export const primitive3dDefinition=def('pixi3d.primitive','component.primitive3d',Primitive3DSchema,()=>({shape:'cube',color:'#b7ca8f',roughness:.5,metallic:0,castShadow:true,receiveShadow:true,emissiveColor:'#000000',emissiveStrength:0}),[enums('shape',[...primitiveShapes]),...shapeFields(),{key:'color',titleKey:'field.color',kind:'color'},...numeric('roughness','metallic'),...booleans('castShadow','receiveShadow'),{key:'emissiveColor',titleKey:'field.emissiveColor',kind:'color'},...numeric('emissiveStrength'),...surfaceFields()]);
export const camera3dDefinition=def('pixi3d.camera','component.camera3d',Camera3DSchema,()=>({mode:'perspective',fov:50,near:.1,far:1000,orthographicSize:10}),[enums('mode',['perspective','orthographic']),...numeric('fov','near','far','orthographicSize','feedWidth','feedHeight')]);
export const light3dDefinition=def('pixi3d.light','component.light3d',Light3DSchema,()=>({kind:'directional',color:'#ffffff',intensity:2,castShadow:false}),[enums('kind',[...lightKinds]),{key:'color',titleKey:'field.color',kind:'color'},...numeric('intensity'),...(['range','radius'] as const).map(key=>({key,titleKey:'field.'+key,kind:'number' as const,visible:(d:unknown)=>['point','spot'].includes((d as {kind?:string}).kind??'')})),...(['coneAngle','penumbra'] as const).map(key=>({key,titleKey:'field.'+key,kind:'number' as const,visible:(d:unknown)=>(d as {kind?:string}).kind==='spot'})),{key:'castShadow',titleKey:'field.castShadow',kind:'boolean',visible:data=>shadowCasting((data as {kind?:string}).kind??'')},
 ...shadowInspector()]);
function shadowInspector():ComponentDefinition['fields']{const casting=(d:unknown)=>{const v=d as {kind?:string;castShadow?:boolean};return shadowCasting(v.kind??'')&&v.castShadow===true;},sun=(d:unknown)=>(d as {kind?:string}).kind==='directional',placed=(p:string)=>(d:unknown)=>casting(d)&&sun(d)&&((d as {shadowPlacement?:string}).shadowPlacement??'fit')===p;
 const n=(key:string,visible:(d:unknown)=>boolean)=>({key,titleKey:'field.'+key,kind:'number' as const,visible});
 return[{key:'shadowPlacement',titleKey:'field.shadowPlacement',kind:'enum',options:shadowPlacements.map(value=>({value,titleKey:'scene3d.shadow.'+value})),visible:d=>casting(d)&&sun(d)},
  ...['shadowBoundsX','shadowBoundsY','shadowBoundsZ','shadowBoundsWidth','shadowBoundsHeight','shadowBoundsDepth'].map(k=>n(k,placed('bounds'))),
  ...['shadowCascades','shadowMaxDistance','shadowLambda'].map(k=>n(k,placed('cascades'))),n('shadowBias',casting),{key:'shadowNormalBiasAuto',titleKey:'field.shadowNormalBiasAuto',kind:'boolean',visible:casting},
  n('shadowNormalBias',d=>casting(d)&&(d as {shadowNormalBiasAuto?:boolean}).shadowNormalBiasAuto===false),n('shadowUpdate',casting)];}
const pick=(key:string,values:readonly string[]):ComponentDefinition['fields'][number]=>({key,titleKey:'field.'+key,kind:'enum',options:values.map(value=>({value,titleKey:'particles3d.'+value}))});
const shape=(...shapes:string[])=>(data:unknown)=>shapes.includes((data as {spawnShape?:string}).spawnShape??'');
const burst=(data:unknown)=>(data as {emission?:string}).emission==='burst',sheet=(data:unknown)=>Boolean((data as {textureAsset?:string}).textureAsset)&&Number((data as {frameColumns?:number}).frameColumns??1)*Number((data as {frameRows?:number}).frameRows??1)>1;
// Play actions write startedAt/stoppedAt (null when unset), which the flat defaults type has no room for.
export const particles3dDefinition=def(particle3dType,'component.particles3d',Particles3DSchema,particles3dDefaults as ()=>Record<string,string|number|boolean>,[pick('driver',['emitter','script']),pick('emission',['continuous','burst']),{key:'burstInterval',titleKey:'field.burstInterval',kind:'number',visible:burst},pick('space',particleSpaces),...booleans('autoplay'),...numeric('count','seed','lifetime','lifetimeRandom','speed','speedRandom','spread','gravity'),
 pick('spawnShape',particleSpawnShapes),{key:'spawnRadius',titleKey:'field.spawnRadius',kind:'number',visible:shape('sphere')},...(['spawnWidth','spawnHeight','spawnDepth'] as const).map(key=>({key,titleKey:'field.'+key,kind:'number' as const,visible:shape('box')})),
 ...numeric('size','sizeRandom','endScale','alpha','endAlpha'),{key:'tint',titleKey:'field.tint',kind:'color'},{key:'endTint',titleKey:'field.endTint',kind:'color'},...numeric('rotationSpeed'),{...pick('particleTexture',particleTextures),visible:(d:unknown)=>!(d as {textureAsset?:string}).textureAsset},{key:'textureAsset',titleKey:'field.particleImage',kind:'asset',assetType:'pixi.texture'},
 ...(['frameColumns','frameRows'] as const).map(key=>({key,titleKey:'field.'+key,kind:'number' as const,visible:(d:unknown)=>Boolean((d as {textureAsset?:string}).textureAsset)})),{...pick('frameMode',particleFrameModes),visible:sheet},{key:'frameRate',titleKey:'field.frameRate',kind:'number',visible:(d:unknown)=>sheet(d)&&(d as {frameMode?:string}).frameMode==='loop'},
 pick('billboard',particleBillboards),pick('blendMode',['normal','add'])]);
const when=(key:string,value:string)=>(data:unknown)=>(data as Record<string,unknown>)[key]===value;
export const instances3dDefinition=def(instances3dType,'component.instances3d',Instances3DSchema,instances3dDefaults,[pick('source',['primitive','model']),{key:'assetId',titleKey:'scene3d.modelAsset',kind:'asset',assetType:'pixi3d.model',visible:when('source','model')},{...enums('shape',['cube','sphere']),visible:when('source','primitive')},pick('colorMode',['single','random','gradient']),{key:'color',titleKey:'field.color',kind:'color',visible:(d:unknown)=>(d as {source?:string}).source!=='model'||(d as {colorMode?:string}).colorMode!=='single'},{key:'color2',titleKey:'field.color2',kind:'color',visible:(d:unknown)=>(d as {colorMode?:string}).colorMode!=='single'},{...pick('gradientAxis',['x','y','z']),visible:when('colorMode','gradient')},...(['roughness','metallic'] as const).map(key=>({key,titleKey:'field.'+key,kind:'number' as const,visible:when('source','primitive')})),...booleans('castShadow','receiveShadow'),pick('layout',['grid','scatter']),
 ...(['columns','rows','layers','spacing','jitter'] as const).map(key=>({key,titleKey:'field.'+key,kind:'number' as const,visible:when('layout','grid')})),...(['count','areaWidth','areaDepth','areaHeight'] as const).map(key=>({key,titleKey:'field.'+key,kind:'number' as const,visible:when('layout','scatter')})),
 ...numeric('seed','scale','scaleRandom','yawRandom'),pick('cull',['off','cpu','gpu'])]);
export const sprite3dDefinition=def(sprite3dType,'component.sprite3d',Sprite3DSchema,sprite3dDefaults as ()=>Record<string,string|number|boolean>,sprite3dFields);
export const cameraControlDefinition=def(cameraControlType,'component.cameraControl',CameraControlSchema,()=>CameraControlSchema.parse({}) as Record<string,string|number|boolean>,cameraControlFields);
/** Lives on a 2D object (a label or bar) and moves it to a 3D object's place on screen during the game. */
export const followDefinition:ComponentDefinition={...def(followType,'component.follow3d',FollowSchema,()=>FollowSchema.parse({}) as Record<string,string|number|boolean>,followFields),supportedSpaces:['scene.2d']};
/** Turns one bone of the Model 3D on the same object toward another object, after its clip poses it. */
export const boneAimDefinition=def(boneAimType,'component.boneAim',BoneAimSchema,()=>BoneAimSchema.parse({}) as Record<string,string|number|boolean>,boneAimFields);
/** Lets the player drag the object along a plane while the game runs. */
export const draggableDefinition=def(draggableType,'component.draggable3d',DraggableSchema,()=>DraggableSchema.parse({}) as Record<string,string|number|boolean>,draggableFields);
export const outline3dDefinition=def(outline3dType,'component.outline3d',Outline3DSchema,()=>Outline3DSchema.parse({}) as Record<string,string|number|boolean>,outline3dFields);
export const wireframeOverlayDefinition=def(wireframeOverlayType,'component.wireframeOverlay3d',WireframeOverlaySchema,()=>WireframeOverlaySchema.parse({}) as Record<string,string|number|boolean>,wireframeOverlayFields);
export const boundsHelperDefinition=def(boundsHelperType,'component.boundsHelper3d',BoundsHelperSchema,()=>BoundsHelperSchema.parse({}) as Record<string,string|number|boolean>,boundsHelperFields);
export const lookAtDefinition=def(lookAtType,'component.lookAt3d',LookAtSchema,()=>LookAtSchema.parse({}) as Record<string,string|number|boolean>,lookAtFields);
export const pointerFollowDefinition=def(pointerFollowType,'component.pointerFollow3d',PointerFollowSchema,()=>PointerFollowSchema.parse({}) as Record<string,string|number|boolean>,pointerFollowFields);
export const decalsDefinition=def(decalsType,'component.decals3d',DecalsSchema,()=>DecalsSchema.parse({}) as Record<string,string|number|boolean>,decalsFields);
export const attachDefinition=def(attachType,'component.attach3d',AttachSchema,()=>AttachSchema.parse({}) as Record<string,string|number|boolean>,attachFields);
export const paintableDefinition=def(paintableType,'component.paintable3d',PaintableSchema,()=>PaintableSchema.parse({}) as Record<string,string|number|boolean>,paintableFields);
export const authoring3dDefinitions=[shader3dDefinition,batch3dDefinition,mesh3dDefinition,mirror3dDefinition,paintableDefinition,decalsDefinition,attachDefinition,lookAtDefinition,pointerFollowDefinition,outline3dDefinition,wireframeOverlayDefinition,boundsHelperDefinition,primitive3dDefinition,camera3dDefinition,light3dDefinition,particles3dDefinition,instances3dDefinition,sprite3dDefinition,cameraControlDefinition,followDefinition,boneAimDefinition,draggableDefinition];
