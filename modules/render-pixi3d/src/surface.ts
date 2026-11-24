import {z} from 'zod';
import type {ComponentDefinition} from '@rewrite/sdk';
// How a primitive's surface looks: lighting model, opacity, sides, texture maps and UV placement. Pure: no pixi.
const color=z.string().regex(/^#[0-9a-fA-F]{6}$/),number=z.number().finite(),assetId=z.string().max(128).default('');
export const surfaceModels=['pbr','phong','flat','toon'] as const,alphaModes=['opaque','mask','blend'] as const;
/** Texture slots a primitive can fill from the Library (`pixi.texture` assets). Empty means none. */
export const surfaceTextureKeys=['baseColorTexture','normalTexture','metallicRoughnessTexture','occlusionTexture','emissiveTexture','clearcoatTexture','sheenTexture','transmissionTexture','iridescenceTexture'] as const;
export type SurfaceTextureKey=typeof surfaceTextureKeys[number];
/** Every field has a default, so primitives saved before materials existed keep their look (PBR, opaque, one-sided). */
export const surfaceShape={
 material:z.enum(surfaceModels).default('pbr'),
 alphaMode:z.enum(alphaModes).default('opaque'),alpha:number.min(0).max(1).default(1),alphaCutoff:number.min(0).max(1).default(.5),
 doubleSided:z.boolean().default(false),flatShading:z.boolean().default(false),
 baseColorTexture:assetId,videoTexture:assetId,feedCameraId:z.string().max(128).default(''),screenSourceId:z.string().max(128).default(''),screenWidth:z.number().int().min(16).max(4096).default(512),screenHeight:z.number().int().min(16).max(4096).default(256),portalExitId:z.string().max(128).default(''),normalTexture:assetId,normalScale:number.min(0).max(4).default(1),metallicRoughnessTexture:assetId,occlusionTexture:assetId,occlusionStrength:number.min(0).max(1).default(1),emissiveTexture:assetId,
 uvScaleX:number.min(-1000).max(1000).default(1),uvScaleY:number.min(-1000).max(1000).default(1),uvOffsetX:number.min(-1000).max(1000).default(0),uvOffsetY:number.min(-1000).max(1000).default(0),uvRotation:number.min(-3600).max(3600).default(0),
 uvScrollX:number.min(-100).max(100).default(0),uvScrollY:number.min(-100).max(100).default(0),
 shininess:number.min(1).max(1024).default(32),specularStrength:number.min(0).max(4).default(1),specularColor:color.default('#ffffff'),
 // PBR extensions (glTF KHR_materials_*): a group exists only when it does something, so plain surfaces pay for none.
 ior:number.min(1).max(3).default(1.5),specularFactor:number.min(0).max(1).default(1),
 clearcoat:number.min(0).max(1).default(0),clearcoatRoughness:number.min(0).max(1).default(0),clearcoatTexture:assetId,
 sheenColor:color.default('#000000'),sheenRoughness:number.min(0).max(1).default(0),sheenTexture:assetId,
 transmission:number.min(0).max(1).default(0),thickness:number.min(0).max(100).default(0),attenuationColor:color.default('#ffffff'),attenuationDistance:number.min(0).max(1e4).default(0),transmissionTexture:assetId,
 iridescence:number.min(0).max(1).default(0),iridescenceIor:number.min(1).max(3).default(1.3),iridescenceThicknessMin:number.min(0).max(2000).default(100),iridescenceThicknessMax:number.min(0).max(2000).default(400),iridescenceTexture:assetId,
 anisotropy:number.min(0).max(1).default(0),anisotropyRotation:number.min(-3600).max(3600).default(0),
 // Render state: depth test and write, which faces draw, and how the colour blends with what is behind.
 depthTest:z.boolean().default(true),depthWrite:z.boolean().default(true),cull:z.enum(['back','front','none']).default('back'),blend:z.enum(['normal','add','multiply','screen']).default('normal'),
 toonBands:z.number().int().min(1).max(8).default(3),toonSpecularSize:number.min(0).max(1).default(.15),toonRimIntensity:number.min(0).max(2).default(.4),toonOutline:z.boolean().default(true),
};
export type Surface=z.infer<z.ZodObject<typeof surfaceShape>>;
type Fields=ComponentDefinition['fields'];
const is=(...models:Surface['material'][])=>(d:unknown)=>models.includes(((d as {material?:Surface['material']}).material??'pbr'));
const textured=(d:unknown)=>surfaceTextureKeys.some(k=>Boolean((d as Record<string,unknown>)[k]))||Boolean((d as {videoTexture?:string}).videoTexture)||Boolean((d as {screenSourceId?:string}).screenSourceId);
/** A PBR extension group is on when its strength is above 0; sheen when its colour is not black. */
const on=(key:'clearcoat'|'transmission'|'iridescence'|'anisotropy')=>(d:unknown)=>is('pbr')(d)&&Number((d as Record<string,unknown>)[key]??0)>0;
const sheen=(d:unknown)=>((d as {sheenColor?:string}).sheenColor??'#000000').toLowerCase()!=='#000000';
export const sheenOn=(d:Pick<Surface,'sheenColor'>)=>sheen(d);
/** Inspector rows for the surface, each shown only where it does something for the chosen model. */
export function surfaceFields():Fields{
 const n=(key:string,visible?:(d:unknown)=>boolean):Fields[number]=>({key,titleKey:'field.'+key,kind:'number',...visible?{visible}:{}});
 const tex=(key:SurfaceTextureKey,visible?:(d:unknown)=>boolean):Fields[number]=>({key,titleKey:'field.'+key,kind:'asset',assetType:'pixi.texture',...visible?{visible}:{}});
 return[
  {key:'material',titleKey:'field.material',kind:'enum',options:surfaceModels.map(value=>({value,titleKey:'scene3d.material.'+value}))},
  {key:'alphaMode',titleKey:'field.alphaMode',kind:'enum',options:alphaModes.map(value=>({value,titleKey:'scene3d.alpha.'+value}))},
  n('alpha',d=>(d as {alphaMode?:string}).alphaMode==='blend'),n('alphaCutoff',d=>(d as {alphaMode?:string}).alphaMode==='mask'),
  {key:'doubleSided',titleKey:'field.doubleSided',kind:'boolean'},{key:'flatShading',titleKey:'field.flatShading',kind:'boolean',visible:is('pbr','phong','toon')},
  tex('baseColorTexture'),{key:'videoTexture',titleKey:'field.videoTexture',kind:'asset',assetType:'media.video'},{key:'feedCameraId',titleKey:'field.feedCameraId',kind:'string'},{key:'screenSourceId',titleKey:'field.screenSourceId',kind:'string'},{key:'screenWidth',titleKey:'field.screenWidth',kind:'number',visible:d=>Boolean((d as {screenSourceId?:string}).screenSourceId)},{key:'screenHeight',titleKey:'field.screenHeight',kind:'number',visible:d=>Boolean((d as {screenSourceId?:string}).screenSourceId)},{key:'portalExitId',titleKey:'field.portalExitId',kind:'string'},tex('normalTexture',is('pbr','phong')),n('normalScale',d=>is('pbr','phong')(d)&&Boolean((d as Surface).normalTexture)),
  tex('metallicRoughnessTexture',is('pbr')),tex('occlusionTexture',is('pbr')),n('occlusionStrength',d=>is('pbr')(d)&&Boolean((d as Surface).occlusionTexture)),tex('emissiveTexture',is('pbr','phong')),
  ...(['uvScaleX','uvScaleY','uvOffsetX','uvOffsetY','uvRotation','uvScrollX','uvScrollY'] as const).map(k=>n(k,textured)),
  n('shininess',is('phong')),n('specularStrength',is('phong')),
  // PBR extension groups: the strength opens each group's other rows.
  n('ior',is('pbr')),n('specularFactor',is('pbr')),{key:'specularColor',titleKey:'field.specularColor',kind:'color',visible:is('pbr','phong')},
  n('clearcoat',is('pbr')),...['clearcoatRoughness','clearcoatTexture'].map(k=>k.endsWith('Texture')?tex(k as SurfaceTextureKey,on('clearcoat')):n(k,on('clearcoat'))),
  {key:'sheenColor',titleKey:'field.sheenColor',kind:'color',visible:is('pbr')},n('sheenRoughness',d=>is('pbr')(d)&&sheen(d)),tex('sheenTexture',d=>is('pbr')(d)&&sheen(d)),
  n('transmission',is('pbr')),...(['thickness','attenuationDistance'] as const).map(k=>n(k,on('transmission'))),{key:'attenuationColor',titleKey:'field.attenuationColor',kind:'color',visible:on('transmission')},tex('transmissionTexture',on('transmission')),
  n('iridescence',is('pbr')),...(['iridescenceIor','iridescenceThicknessMin','iridescenceThicknessMax'] as const).map(k=>n(k,on('iridescence'))),tex('iridescenceTexture',on('iridescence')),
  n('anisotropy',is('pbr')),n('anisotropyRotation',on('anisotropy')),
  {key:'depthTest',titleKey:'field.depthTest',kind:'boolean'},{key:'depthWrite',titleKey:'field.depthWrite',kind:'boolean'},{key:'cull',titleKey:'field.faceCull',kind:'enum',options:['back','front','none'].map(value=>({value,titleKey:'scene3d.cull.'+value})),visible:d=>!(d as {doubleSided?:boolean}).doubleSided},{key:'blend',titleKey:'field.blend',kind:'enum',options:['normal','add','multiply','screen'].map(value=>({value,titleKey:'scene3d.blend.'+value}))},
  n('toonBands',is('toon')),n('toonSpecularSize',is('toon')),n('toonRimIntensity',is('toon')),{key:'toonOutline',titleKey:'field.toonOutline',kind:'boolean',visible:is('toon')},
 ];
}
/** The Library textures a surface reads, without duplicates. */
export const surfaceTextureIds=(d:Partial<Record<SurfaceTextureKey,string>>)=>[...new Set(surfaceTextureKeys.map(k=>d[k]??'').filter(Boolean))];
/**
 * The 2D UV matrix (a, b, c, d, tx, ty in pixi's `Matrix` order) for a surface at `time` seconds:
 * scale, then turn by `uvRotation` degrees about the texture's centre, then shift by offset plus scroll × time.
 * `flipV` first mirrors V, for geometry whose V runs upward (cube faces), so images read the right way up.
 */
export function uvMatrix(d:Pick<Surface,'uvScaleX'|'uvScaleY'|'uvOffsetX'|'uvOffsetY'|'uvRotation'|'uvScrollX'|'uvScrollY'>,time=0,flipV=false):[number,number,number,number,number,number]{
 // Compose as affine maps on (u, v): p' = R·S·F·p + (centre − R·centre) + offset
 const f=flipV?-1:1,fy=flipV?1:0,r=d.uvRotation*Math.PI/180,cos=Math.cos(r),sin=Math.sin(r);
 const sa=d.uvScaleX,sd=d.uvScaleY*f,sty=d.uvScaleY*fy; // S·F: u' = sx·u, v' = sy·(f·v + fy)
 const a=cos*sa,b=sin*sa,c=-sin*sd,dd=cos*sd;
 const tx0=-sin*sty,ty0=cos*sty; // R applied to the flip's translation
 const tx=tx0+.5-(cos*.5-sin*.5)+d.uvOffsetX+d.uvScrollX*time,ty=ty0+.5-(sin*.5+cos*.5)+d.uvOffsetY+d.uvScrollY*time;
 return[a,b,c,dd,tx,ty];
}
/** Applies a pixi-order matrix to a UV point, for tests and tools. */
export const applyUv=(m:readonly number[],u:number,v:number):[number,number]=>[m[0]*u+m[2]*v+m[4],m[1]*u+m[3]*v+m[5]];
/** Whether the surface's UVs move over time, so the projection rewrites them each frame. */
export const scrolls=(d:Pick<Surface,'uvScrollX'|'uvScrollY'>)=>d.uvScrollX!==0||d.uvScrollY!==0;
/** Pixi render state for a surface: depth test and write, face culling (two-sided surfaces draw both) and blend mode. */
export function renderState(d:Pick<Surface,'depthTest'|'depthWrite'|'cull'|'blend'|'doubleSided'>){return{depthTest:d.depthTest,depthMask:d.depthWrite,cullMode:d.doubleSided?'none' as const:d.cull,blendMode:d.blend};}
