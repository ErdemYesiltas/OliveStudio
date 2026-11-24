import {z} from 'zod';
import type {RenderTexture} from 'pixi.js';
import {BackgroundPass,BaseMaterial3D,Camera3D,Matrix4,Pass3D,Plane,type BaseMaterial3DOptions,type ColorSpace,type Mesh3D,type PassContext,type RenderGraph,type RenderSession,type ShaderBit} from '@pixi/3d';
import {PortalFeedPass,portalExitClipPlane} from '@pixi/3d/extras';
import type {ComponentDefinition} from '@rewrite/sdk';
// A flat mirror on a plane primitive. @pixi/3d has a portal (a camera turned half round behind the exit) but no mirror:
// turning keeps the picture's handedness, so a "portal into itself" shows the room flipped left to right. A true
// reflection has a negative determinant, which would flip every triangle's winding and break back-face culling. So the
// camera is the viewer reflected in the mirror plane and then flipped in x (two flips: an ordinary rigid camera, normal
// culling); its picture is the reflection mirrored in x, and the mirror material samples it at 1 − u to undo that.
export const mirror3dType='pixi3d.mirror';
const hex=z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const Mirror3DSchema=z.object({tint:hex.default('#e6ecf0'),resolution:z.number().finite().min(.25).max(1).default(1)}).strict();
export type Mirror3D=z.infer<typeof Mirror3DSchema>;
export const mirror3dDefinition:ComponentDefinition={type:mirror3dType,version:1,titleKey:'component.mirror3d',defaults:()=>Mirror3DSchema.parse({}),parse:v=>Mirror3DSchema.parse(v),get dataSchema(){return z.toJSONSchema(Mirror3DSchema);},
 fields:[{key:'tint',titleKey:'field.mirrorTint',kind:'color'},{key:'resolution',titleKey:'field.mirrorResolution',kind:'number'}]};

const SURFACE_FLIP=new Matrix4().set(1,0,0,0,0,1,0,0,0,0,-1,0,0,0,0,1),X_FLIP=new Matrix4().set(-1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1);
const _inverse=new Matrix4(),_reflect=new Matrix4();
/**
 * The mirror camera's world transform: the viewer reflected in the mirror's local z = 0 plane (it faces +Z), then
 * flipped in its own x so the transform stays a rotation (`mirror · flipZ · mirror⁻¹ · viewer · flipX`).
 */
export function mirrorCameraMatrix(mirrorWorld:Matrix4,viewerWorld:Matrix4,out=new Matrix4()){
 _inverse.getInverse(mirrorWorld);_reflect.multiplyMatrices(mirrorWorld,SURFACE_FLIP).multiply(_inverse);
 return out.multiplyMatrices(_reflect,viewerWorld).multiply(X_FLIP);
}
const screenUv={gpu:`
fn mirrorScreenUV(worldPos: vec3<f32>) -> vec2<f32> {
  let clip = camera.uViewProjectionMatrix * vec4<f32>(worldPos, 1.0);
  let ndc = clip.xy / clip.w;
  return vec2<f32>(0.5 - ndc.x * 0.5, 1.0 - (ndc.y * 0.5 + 0.5));
}
`,gl:`
vec2 mirrorScreenUV(vec3 worldPos) {
  vec4 clip = uViewProjectionMatrix * vec4(worldPos, 1.0);
  vec2 ndc = clip.xy / clip.w;
  return vec2(0.5 - ndc.x * 0.5, 1.0 - (ndc.y * 0.5 + 0.5));
}
`};
/** The portal bit with the picture read mirrored in x (see the note at the top). */
export const mirrorBit:ShaderBit={name:'mirror',textures:['mirror'],bindings:{material:{baseColor:'vec4<f32>',displayBaseColor:'vec4<f32>'}},
 gpu:{header:screenUv.gpu,fragment:{material:`
  let mirrorFeed = sampleMirror(mirrorScreenUV(input.vPosition));
  let mirrorTint = inputTint(material.baseColor, material.displayBaseColor);
  albedo *= decodeFrame(mirrorFeed.rgb) * mirrorTint.rgb;
  alpha *= mirrorTint.a;
`}},
 gl:{header:screenUv.gl,fragment:{material:`
  vec4 mirrorFeed = sampleMirror(mirrorScreenUV(vPosition));
  vec4 mirrorTint = inputTint(material.baseColor, material.displayBaseColor);
  albedo *= decodeFrame(mirrorFeed.rgb) * mirrorTint.rgb;
  alpha *= mirrorTint.a;
`}}} as unknown as ShaderBit;
/** Unlit: shows the reflection as drawn, tinted by `baseColor`. */
export class MirrorMaterial extends BaseMaterial3D{
 override _skipsToneCurve=true;override colorSpace:ColorSpace='display';override lit=false;
 constructor(options:BaseMaterial3DOptions&{texture:RenderTexture}){super({...options,descriptor:{bitsGpu:[mirrorBit],bitsGl:[mirrorBit]},textures:{mirror:options.texture,...options.textures}} as BaseMaterial3DOptions);}
}
/** Poses the mirror camera once per frame, from whichever of the mirror's passes asks first. */
class MirrorSky extends BackgroundPass{
 constructor(options:ConstructorParameters<typeof BackgroundPass>[0],private draw:(session:RenderSession)=>boolean){super(options);}
 override condition(session:RenderSession){return this.draw(session)&&super.condition(session);}
}
/**
 * Draws the reflection into `texture` before the scene (sky, opaque, transparent) while the mirror is visible and the
 * viewer is in front of it. Everything behind the mirror plane is clipped out, so the wall it hangs on does not show.
 */
export class MirrorPass extends Pass3D{
 readonly stage='beforeOpaque';readonly camera:Camera3D;private clip=new Plane();private decidedFor:unknown=null;private drawThisFrame=false;
 constructor(readonly mirror:Mesh3D,readonly texture:RenderTexture){super();this.camera=new Camera3D({renderTexture:texture});this.camera.clippingPlane=this.clip;mirror.addChild(this.camera);}
 build(graph:RenderGraph,ctx:PassContext){const draw=(session:RenderSession)=>this.shouldDraw(session),camera=this.camera;
  graph.addPass(new MirrorSky({renderer:ctx.renderer,camera},draw));
  graph.addPass(new PortalFeedPass({renderer:ctx.renderer,name:'opaque',sort:'key',camera,shouldDraw:draw}));
  graph.addPass(new PortalFeedPass({renderer:ctx.renderer,name:'transparent',sort:'distance',camera,shouldDraw:draw}));}
 private shouldDraw(session:RenderSession){if(this.decidedFor===session)return this.drawThisFrame;this.decidedFor=session;
  const view=session.view3d.camera,e=this.mirror.worldTransform.elements,v=view.worldTransform.elements;
  const inFront=e[8]*(v[12]-e[12])+e[9]*(v[13]-e[13])+e[10]*(v[14]-e[14])>0;
  this.drawThisFrame=this.mirror.worldVisible!==0&&inFront&&view.frustum.intersectsSphere(this.mirror.boundingSphere);
  if(this.drawThisFrame){const c=this.camera;c.mode=view.mode;c.fov=view.fov;c.zoom=view.zoom;c.near=view.near;c.far=view.far;c.orthographicSize=view.orthographicSize;
   mirrorCameraMatrix(this.mirror.worldTransform,view.worldTransform,c.worldTransform);portalExitClipPlane(this.mirror.worldTransform,c.worldTransform,this.clip);}
  return this.drawThisFrame;}
 override destroy(){this.camera.destroy();}
}
