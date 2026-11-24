import {z} from 'zod';
import {mat3,mat4,quat,type ReadonlyMat4} from 'gl-matrix';
import {components,type ComponentDefinition,type EditorModule,type Json} from '@rewrite/sdk';
import {spatialComponent,makeEntity,type Entity} from '@rewrite/scene';
import {tweenChannels} from '@rewrite/tween/contracts';
import {transform3dTweenChannels} from './tween-channels';
export const space3d='scene.3d',transform3dType='scene3d.transform';
const position=z.number().finite().min(-1e9).max(1e9),scale=z.number().finite().min(-10000).max(10000).refine(v=>Math.abs(v)>=1e-8,'Scale is singular');
export const Transform3DSchema=z.object({x:position,y:position,z:position,qx:z.number().finite(),qy:z.number().finite(),qz:z.number().finite(),qw:z.number().finite(),scaleX:scale,scaleY:scale,scaleZ:scale}).strict().refine(v=>Math.abs(Math.hypot(v.qx,v.qy,v.qz,v.qw)-1)<1e-6,'Quaternion must be normalized');
export type Transform3D=z.infer<typeof Transform3DSchema>;
export const identity3D=():Transform3D=>({x:0,y:0,z:0,qx:0,qy:0,qz:0,qw:1,scaleX:1,scaleY:1,scaleZ:1});
const matrix=():mat4=>[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
/** Double-precision output arrays; never change gl-matrix's global allocation policy. */
export function matrix3D(data:Json):mat4{const t=Transform3DSchema.parse(data);return mat4.fromRotationTranslationScale(matrix(),[t.qx,t.qy,t.qz,t.qw],[t.x,t.y,t.z],[t.scaleX,t.scaleY,t.scaleZ]);}
export function world3D(parents:readonly Json[],data?:Json):mat4{const result=matrix();for(const t of [...parents,...(data?[data]:[])])mat4.multiply(result,result,matrix3D(t));return result;}
export function decompose3D(value:ReadonlyMat4):Transform3D{
 const scales=[Math.hypot(value[0],value[1],value[2]),Math.hypot(value[4],value[5],value[6]),Math.hypot(value[8],value[9],value[10])];
 if(scales.some(s=>s<1e-8)||!Number.isFinite(mat4.determinant(value)))throw Error('3D transform is singular');
 if(mat4.determinant(value)<0)scales[0]*=-1;
 const rotation:mat3=[1,0,0,0,1,0,0,0,1];mat3.fromMat4(rotation,value);
 for(let column=0;column<3;column++)for(let row=0;row<3;row++)rotation[column*3+row]/=scales[column];
 const q:quat=[0,0,0,1];quat.fromMat3(q,rotation);quat.normalize(q,q);if(q[3]<0)quat.scale(q,q,-1);
 const next=Transform3DSchema.parse({x:value[12],y:value[13],z:value[14],qx:q[0],qy:q[1],qz:q[2],qw:q[3],scaleX:scales[0],scaleY:scales[1],scaleZ:scales[2]});
 const rebuilt=matrix3D(next);
 if(Array.from(value).some((v,i)=>Math.abs(v-rebuilt[i])>1e-6*Math.max(1,Math.abs(v),Math.abs(rebuilt[i]))))throw Error('This parent would require 3D shear; world pose cannot be preserved as TRS');
 return next;
}
export function reparent3D(local:Json,oldParents:readonly Json[],newParents:readonly Json[]):Json{
 const inverse=mat4.invert(matrix(),world3D(newParents));if(!inverse)throw Error('Parent transform cannot be inverted');
 return decompose3D(mat4.multiply(matrix(),inverse,world3D(oldParents,local)));
}
export const transform3dDefinition:ComponentDefinition={type:transform3dType,version:1,titleKey:'component.transform3d',addable:false,defaults:identity3D,parse:v=>Transform3DSchema.parse(v),get dataSchema(){return z.toJSONSchema(Transform3DSchema,{unrepresentable:'any'});},fields:['x','y','z','qx','qy','qz','qw','scaleX','scaleY','scaleZ'].map(key=>({key,titleKey:'field.'+key,kind:'number'})),spatial:{space:space3d,requiresBoundary:true,reparent:reparent3D,resetPosition:data=>({...Transform3DSchema.parse(data),x:0,y:0,z:0})}};
/** Per-view shadow quality profile: map size (low 512 … ultra 4096) and edge filtering. Only directional lights cast. */
export const shadowQualities=['low','medium','high','ultra'] as const,shadowFilters=['hard','pcf','pcf-high'] as const;
/** Image-based and procedural ambient light for a view. 'hdr' reads an equirectangular Radiance asset. */
export const fogKinds=['none','linear','exponential','exp2'] as const,environmentKinds=['none','hemisphere','hdr','cubemap'] as const,backgroundKinds=['color','environment','transparent'] as const,toneMappings=['none','aces','reinhard','uncharted2'] as const,environmentAssetType='pixi3d.environment';
const hex=z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const Viewport3DSchema=z.object({width:z.number().int().min(1).max(16384),height:z.number().int().min(1).max(16384),cameraId:z.string().max(128).optional(),shadowQuality:z.enum(shadowQualities).default('medium'),shadowFilter:z.enum(shadowFilters).default('pcf'),
 environment:z.enum(environmentKinds).default('none'),skyColor:hex.default('#9cc8ff'),groundColor:hex.default('#5a4a3a'),environmentIntensity:z.number().finite().min(0).max(10).default(1),environmentAssetId:z.string().max(128).default(''),cubemapAssetId:z.string().max(128).default(''),
 background:z.enum(backgroundKinds).default('color'),backgroundColor:hex.default('#19212b'),toneMapping:z.enum(toneMappings).default('none'),exposure:z.number().finite().min(0).max(16).default(1),
 fog:z.enum(fogKinds).default('none'),fogColor:hex.default('#adb2ba'),fogNear:z.number().finite().min(0).max(1e6).default(10),fogFar:z.number().finite().min(0).max(1e6).default(60),fogDensity:z.number().finite().min(0).max(10).default(.04),
 bloom:z.boolean().default(false),bloomThreshold:z.number().finite().min(0).max(10).default(1),bloomIntensity:z.number().finite().min(0).max(10).default(1),bloomRadius:z.number().finite().min(0).max(1).default(.7),
 ssao:z.boolean().default(false),ssaoRadius:z.number().finite().min(.01).max(10).default(.5),ssaoIntensity:z.number().finite().min(0).max(5).default(1),
 depthOfField:z.boolean().default(false),focusDistance:z.number().finite().min(.1).max(1e4).default(10),focusRange:z.number().finite().min(0).max(1e4).default(2),focusFalloff:z.number().finite().min(.01).max(1e4).default(8),focusBlur:z.number().finite().min(0).max(64).default(10),
 motionBlur:z.boolean().default(false),motionBlurIntensity:z.number().finite().min(0).max(4).default(.5),motionBlurSamples:z.number().int().min(2).max(32).default(12),motionBlurMaxLength:z.number().finite().min(1).max(256).default(48),
 tint:hex.default('#ffffff'),lutAssetId:z.string().max(128).default(''),lutIntensity:z.number().finite().min(0).max(1).default(1),antialias:z.boolean().default(false),outlineWidth:z.number().finite().min(0).max(1).default(.03),outlineColor:hex.default('#000000'),debugView:z.enum(['none','velocity']).default('none'),velocityScale:z.number().finite().min(.01).max(100).default(1)}).strict().refine(v=>v.fog!=='linear'||v.fogFar>v.fogNear,'Fog far must exceed fog near').refine(v=>!v.depthOfField||v.focusFalloff>v.focusRange,'Focus falloff must exceed the sharp range');
/** Serializable view boundary contract; this module does not import any renderer. */
export const viewport3dDefinition:ComponentDefinition={type:'pixi3d.viewport',version:1,titleKey:'component.viewport3d',defaults:()=>({width:640,height:360}),parse:v=>Viewport3DSchema.parse(v),fields:[...['width','height'].map(key=>({key,titleKey:'field.'+key,kind:'number' as const})),{key:'cameraId',titleKey:'field.cameraId',kind:'string'},{key:'shadowQuality',titleKey:'field.shadowQuality',kind:'enum',options:shadowQualities.map(value=>({value,titleKey:'scene3d.shadow.'+value}))},{key:'shadowFilter',titleKey:'field.shadowFilter',kind:'enum',options:shadowFilters.map(value=>({value,titleKey:'scene3d.shadow.'+value}))},
 {key:'environment',titleKey:'field.environment',kind:'enum',options:environmentKinds.map(value=>({value,titleKey:'scene3d.environment.'+value}))},
 {key:'skyColor',titleKey:'field.skyColor',kind:'color',visible:d=>(d as {environment?:string}).environment==='hemisphere'},{key:'groundColor',titleKey:'field.groundColor',kind:'color',visible:d=>(d as {environment?:string}).environment==='hemisphere'},
 {key:'environmentAssetId',titleKey:'field.environmentAsset',kind:'asset',assetType:environmentAssetType,visible:d=>(d as {environment?:string}).environment==='hdr'},{key:'cubemapAssetId',titleKey:'field.cubemapAsset',kind:'asset',assetType:'pixi.texture',visible:d=>(d as {environment?:string}).environment==='cubemap'},
 {key:'environmentIntensity',titleKey:'field.environmentIntensity',kind:'number',visible:d=>(d as {environment?:string}).environment==='hemisphere'},
 {key:'background',titleKey:'field.background',kind:'enum',options:backgroundKinds.map(value=>({value,titleKey:'scene3d.background.'+value}))},{key:'backgroundColor',titleKey:'field.backgroundColor',kind:'color',visible:d=>(d as {background?:string}).background!=='environment'},
 {key:'toneMapping',titleKey:'field.toneMapping',kind:'enum',options:toneMappings.map(value=>({value,titleKey:'scene3d.tone.'+value}))},{key:'exposure',titleKey:'field.exposure',kind:'number'},
 {key:'fog',titleKey:'field.fog',kind:'enum',options:fogKinds.map(value=>({value,titleKey:'scene3d.fog.'+value}))},{key:'fogColor',titleKey:'field.fogColor',kind:'color',visible:d=>(d as {fog?:string}).fog!==undefined&&(d as {fog?:string}).fog!=='none'},
 {key:'fogNear',titleKey:'field.fogNear',kind:'number',visible:d=>(d as {fog?:string}).fog==='linear'},{key:'fogFar',titleKey:'field.fogFar',kind:'number',visible:d=>(d as {fog?:string}).fog==='linear'},{key:'fogDensity',titleKey:'field.fogDensity',kind:'number',visible:d=>['exponential','exp2'].includes((d as {fog?:string}).fog??'')},
 {key:'bloom',titleKey:'field.bloom',kind:'boolean'},...(['bloomThreshold','bloomIntensity','bloomRadius'] as const).map(key=>({key,titleKey:'field.'+key,kind:'number' as const,visible:(d:unknown)=>(d as {bloom?:boolean}).bloom===true})),
 {key:'ssao',titleKey:'field.ssao',kind:'boolean'},...(['ssaoRadius','ssaoIntensity'] as const).map(key=>({key,titleKey:'field.'+key,kind:'number' as const,visible:(d:unknown)=>(d as {ssao?:boolean}).ssao===true})),
 {key:'depthOfField',titleKey:'field.depthOfField',kind:'boolean'},...(['focusDistance','focusRange','focusFalloff','focusBlur'] as const).map(key=>({key,titleKey:'field.'+key,kind:'number' as const,visible:(d:unknown)=>(d as {depthOfField?:boolean}).depthOfField===true})),
 {key:'motionBlur',titleKey:'field.motionBlur',kind:'boolean'},...(['motionBlurIntensity','motionBlurSamples','motionBlurMaxLength'] as const).map(key=>({key,titleKey:'field.'+key,kind:'number' as const,visible:(d:unknown)=>(d as {motionBlur?:boolean}).motionBlur===true})),
 {key:'tint',titleKey:'field.viewTint',kind:'color'},{key:'lutAssetId',titleKey:'field.lutAsset',kind:'asset',assetType:'pixi.texture'},{key:'lutIntensity',titleKey:'field.lutIntensity',kind:'number',visible:d=>Boolean((d as {lutAssetId?:string}).lutAssetId)},{key:'antialias',titleKey:'field.antialias',kind:'boolean'},{key:'outlineWidth',titleKey:'field.outlineWidth',kind:'number'},{key:'outlineColor',titleKey:'field.outlineColor',kind:'color'},{key:'debugView',titleKey:'field.debugView',kind:'enum',options:[{value:'none',titleKey:'scene3d.debug.none'},{value:'velocity',titleKey:'scene3d.debug.velocity'}]},{key:'velocityScale',titleKey:'field.velocityScale',kind:'number',visible:d=>(d as {debugView?:string}).debugView==='velocity'}],remapReferences:(v,ids)=>{const value=Viewport3DSchema.parse(v);return value.cameraId?{...value,cameraId:ids.entities.get(value.cameraId)??value.cameraId}:value;},spatialBoundary:{hostSpace:'scene.2d',childSpace:space3d},supportedSpaces:['scene.2d']};
export function makeViewport3D(name='3D View',x=0,y=0):Entity{const entity=makeEntity(name,x,y);entity.components.push({id:crypto.randomUUID(),type:viewport3dDefinition.type,version:1,data:viewport3dDefinition.defaults()});return entity;}
export function transform3D(entity:Entity):Transform3D{if(entity.spatial!==transform3dType)throw Error('Entity needs Transform3D');return Transform3DSchema.parse(spatialComponent(entity).data);}
/** Data contracts only. Enable in composition together with the optional 3D authoring renderer. */
export {transform3dTweenChannels};
export const scene3dModule:EditorModule={manifest:{id:'scene3d',version:'1.0.0',apiVersion:1,requires:{scene:'^1'},optional:{tween:'^1'}},activate(c){c.contribute(components,'scene3d.transform',transform3dDefinition);c.contribute(components,'scene3d.viewport',viewport3dDefinition);for(const channel of transform3dTweenChannels)c.contribute(tweenChannels,`scene3d.tween.${channel.property}`,channel);}};
