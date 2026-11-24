import {FullscreenPass,PostEffect,type EffectFragment,type EffectIO,type FullscreenPassOptions,type RenderGraph,type ShaderBit} from '@pixi/3d';
import {Texture,TextureStyle,UniformGroup,type BindGroup,type TextureSource} from 'pixi.js';
export {maxLutSize,lutSize,lutLookup} from './color-lut-size';
import {lutSize} from './color-lut-size';
// The image arrives premultiplied; grade the straight colour and premultiply again so transparent views stay transparent.
const fragment:EffectFragment={
 gpu:`
fn effect(uv: vec2<f32>) -> vec4<f32> {
  let src = sampleColor(uv);
  let a = src.a;
  let c = clamp(select(src.rgb, src.rgb / a, a > 0.0001), vec3<f32>(0.0), vec3<f32>(1.0));
  let n = fx.uLutInfo.x;
  let b = c.b * (n - 1.0);
  let b0 = floor(b);
  let b1 = min(b0 + 1.0, n - 1.0);
  let x = (c.r * (n - 1.0) + 0.5) / (n * n);
  let y = (c.g * (n - 1.0) + 0.5) / n;
  let s0 = textureSampleLevel(uLut, uLutSampler, vec2<f32>(x + b0 / n, y), 0.0).rgb;
  let s1 = textureSampleLevel(uLut, uLutSampler, vec2<f32>(x + b1 / n, y), 0.0).rgb;
  let graded = mix(c, mix(s0, s1, b - b0), fx.uLutInfo.y);
  return vec4<f32>(graded * a, a);
}
`,
 gl:`
vec4 effect(vec2 uv) {
  vec4 src = sampleColor(uv);
  float a = src.a;
  vec3 c = clamp(a > 0.0001 ? src.rgb / a : src.rgb, 0.0, 1.0);
  float n = uLutInfo.x;
  float b = c.b * (n - 1.0);
  float b0 = floor(b);
  float b1 = min(b0 + 1.0, n - 1.0);
  float x = (c.r * (n - 1.0) + 0.5) / (n * n);
  float y = (c.g * (n - 1.0) + 0.5) / n;
  vec3 s0 = textureLod(uLut, vec2(x + b0 / n, y), 0.0).rgb;
  vec3 s1 = textureLod(uLut, vec2(x + b1 / n, y), 0.0).rgb;
  vec3 graded = mix(c, mix(s0, s1, b - b0), uLutInfo.y);
  return vec4(graded * a, a);
}
`};
/** Declares the strip texture in the effect's `fx` group; the pass below puts the texture there. */
const lutBindingBit:ShaderBit={name:'color-lut-binding',bindings:{fx:{uLut:'texture_2d<f32>',uLutSampler:'sampler'}}};
const lutStyle=()=>new TextureStyle({scaleMode:'linear',addressMode:'clamp-to-edge'});
/**
 * A fullscreen pass with one extra texture. @pixi/3d 0.1 binds only graph handles (which must be transients), so
 * the strip goes into the pass's own `fx` bind group by name, next to the input the graph binds each frame.
 */
class LutPass extends FullscreenPass{
 private readonly lutGroup:BindGroup;
 constructor(options:FullscreenPassOptions,source:TextureSource){super(options);
  const group=(this as unknown as {_fxBindGroup?:BindGroup})._fxBindGroup;if(!group)throw Error('@pixi/3d FullscreenPass changed: no fx bind group for the colour LUT');
  // A group keyed by name only accepts names its constructor saw, so give the two LUT slots the next binding numbers.
  const layout=(group as unknown as {layout:Record<string,number>|null}).layout;if(!layout)throw Error('@pixi/3d FullscreenPass changed: its fx bind group is not keyed by name');
  let next=Math.max(-1,...Object.values(layout))+1;for(const name of ['uLut','uLutSampler'])if(layout[name]===undefined)layout[name]=next++;
  this.lutGroup=group;this.setLut(source);group.setResource(lutStyle(),'uLutSampler' as unknown as number);}
 setLut(source:TextureSource){this.lutGroup.setResource(source,'uLut' as unknown as number);}
}
/**
 * Colour grading through a strip LUT on the finished picture (after the tone curve, before FXAA), the way grading
 * tools export it. Until `lut` is set it passes the image through unchanged.
 */
export class ColorLutEffect extends PostEffect{
 protected override readonly uniforms=new UniformGroup({uLutInfo:{value:new Float32Array([2,0,0,0]),type:'vec4<f32>'}});
 private source:TextureSource=Texture.WHITE.source;private _intensity=1;private loaded=false;private pass:LutPass|null=null;
 constructor(options:{intensity?:number}={}){super({stage:'afterToneMapping'});this.intensity=options.intensity??1;}
 /** Blend between the original (0) and the graded colour (1). */
 get intensity(){return this._intensity;}
 set intensity(value:number){this._intensity=Math.min(1,Math.max(0,value));this.write();}
 /** The strip texture; its size must pass `lutSize`. Filtering is set to linear and clamped. */
 get lut():TextureSource|null{return this.loaded?this.source:null;}
 set lut(source:TextureSource|null){if(!source){this.source=Texture.WHITE.source;this.loaded=false;this.write();this.pass?.setLut(this.source);return;}const size=lutSize(source.pixelWidth,source.pixelHeight);source.style=lutStyle();source.autoGenerateMipmaps=false;
  this.source=source;this.loaded=true;this.uniforms.uniforms.uLutInfo[0]=size;this.write();this.pass?.setLut(source);}
 private write(){this.uniforms.uniforms.uLutInfo[1]=this.loaded?this._intensity:0;this.uniforms.update();}
 override build(graph:RenderGraph,io:EffectIO){const pass=new LutPass({renderer:io.renderer,label:'color-lut',fragment,uniforms:this.uniforms,reads:{color:io.input},writes:io.output,extraBits:[lutBindingBit]},this.source);this.pass=pass;graph.addPass(pass);}
}
