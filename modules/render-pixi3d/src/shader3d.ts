import {z} from 'zod';
import {BaseMaterial3D,createLightingBit,type ShaderBit} from '@pixi/3d';
import type {ComponentDefinition} from '@rewrite/sdk';
// Shader 3D: shader code a project keeps (project section pixi3d.shaders, not a Library asset: it is text the editor
// owns, like scripts) and objects use through the Shader 3D add-on. Every shader is written twice, WGSL for WebGPU
// and GLSL for WebGL, and never reaches a drawn material before it compiled on that view's backend (a broken shader
// blanks the whole frame; see the shader spike in SCRIPT-SHADER-3D.md §4 B4).
export const shaderSection='pixi3d.shaders',shader3dType='pixi3d.shader';
/**
 * extra: code added to the object's own material (after its colour and maps), in its `material` slot.
 * material: a material of its own, unlit: the code alone decides albedo and alpha.
 * lighting: a plain surface (colour, colour map) whose light comes from the code: before / per light / after the loop.
 */
export const shaderKinds=['extra','material','lighting'] as const;
export const paramTypes=['float','color','vec2','vec4','texture'] as const;
export type ShaderKind=typeof shaderKinds[number];
const sectionsOf:Record<ShaderKind,readonly string[]>={extra:['header','material'],material:['header','material'],lighting:['header','material','preLighting','perLight','postLighting']};
export const shaderSections=(kind:ShaderKind)=>sectionsOf[kind];
/** Names a shader may not use for its parameters: the built-in materials' own fields, the automatic time, language keywords. */
const reserved=new Set(['baseColor','displayBaseColor','pbrParams','transmissionVolume','attenuationColorIrid','uvTransformRow0','uvOffset','alphaCutoff','normalScale','emissive','time','bands','specularSize','rimPower','rimIntensity',
 'material','camera','global','input','output','albedo','alpha','normal','finalColor','light','lightDir','viewDir','attenuation','nDotL','shadow','fn','let','var','const','if','else','for','while','loop','return','struct','true','false','float','int','uint','bool','vec2','vec3','vec4','mat3','mat4','in','out','uniform','discard']);
const nameRule=z.string().regex(/^[a-z][A-Za-z0-9]{0,23}$/,'Parameter names start with a lowercase letter: letters and digits, at most 24').refine(n=>!reserved.has(n),{message:'That name is taken by the built-in shader code; choose another'});
const vec=(n:number)=>z.array(z.number().finite().min(-1e6).max(1e6)).length(n);
export const ShaderParamSchema=z.discriminatedUnion('type',[
 z.object({name:nameRule,type:z.literal('float'),default:z.number().finite().min(-1e6).max(1e6).default(0),min:z.number().finite().optional(),max:z.number().finite().optional()}).strict(),
 z.object({name:nameRule,type:z.literal('color'),default:z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#ffffff')}).strict(),
 z.object({name:nameRule,type:z.literal('vec2'),default:vec(2).default([0,0])}).strict(),
 z.object({name:nameRule,type:z.literal('vec4'),default:vec(4).default([0,0,0,0])}).strict(),
 z.object({name:nameRule,type:z.literal('texture'),default:z.string().max(128).default('')}).strict(),
]);
export type ShaderParam=z.infer<typeof ShaderParamSchema>;
const code=z.string().max(20000);
const SourceSchema=z.object({header:code.default(''),material:code.default(''),preLighting:code.default(''),perLight:code.default(''),postLighting:code.default('')}).strict();
export const ShaderItemSchema=z.object({id:z.string().min(1).max(128),name:z.string().trim().min(1).max(100),kind:z.enum(shaderKinds),params:z.array(ShaderParamSchema).max(12).default([]),wgsl:SourceSchema.default(SourceSchema.parse({})),glsl:SourceSchema.default(SourceSchema.parse({}))}).strict()
 .refine(s=>new Set(s.params.map(p=>p.name)).size===s.params.length,'Two parameters have the same name').refine(s=>s.params.filter(p=>p.type==='texture').length<=4,'At most 4 texture parameters');
export type ShaderItem=z.infer<typeof ShaderItemSchema>;
export const ShaderLibrarySchema=z.object({version:z.literal(1),items:z.array(ShaderItemSchema).max(256).default([])}).strict();
export type ShaderLibrary=z.infer<typeof ShaderLibrarySchema>;
export const emptyShaderLibrary=():ShaderLibrary=>({version:1,items:[]});

/** The add-on: which shader an object uses and its parameter values (values change without a rebuild). */
export const Shader3DSchema=z.object({shaderId:z.string().max(128).default(''),values:z.record(z.string(),z.union([z.number().finite(),z.string().max(128),z.array(z.number().finite()).max(4)])).default({})}).strict();
export type Shader3D=z.infer<typeof Shader3DSchema>;
export const shader3dDefinition:ComponentDefinition={type:shader3dType,version:1,titleKey:'component.shader3d',supportedSpaces:['scene.3d'],defaults:()=>Shader3DSchema.parse({}) as never,parse:v=>Shader3DSchema.parse(v) as never,get dataSchema(){return z.toJSONSchema(Shader3DSchema);},
 fields:[{key:'shaderId',titleKey:'field.shaderId',kind:'string'}]};

/** Stable hash of what decides the compiled shader (not the name or default values). */
export function shaderHash(s:ShaderItem){const text=JSON.stringify([s.kind,s.params.map(p=>[p.name,p.type]),s.wgsl,s.glsl]);let h=2166136261;for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619);}return(h>>>0).toString(36);}
/**
 * GPU-hang guard before anything compiles (best effort, no guarantee): no `while` or `loop`, and every `for` counts up
 * to a number written in the code, at most 256. A bounded loop can still be slow; context-loss recovery is not built yet.
 */
export function loopProblems(s:ShaderItem):string[]{const out:string[]=[];
 for(const lang of ['wgsl','glsl'] as const)for(const section of shaderSections(s.kind)){const text=s[lang][section as keyof ShaderItem['wgsl']].replace(/\/\/[^\n]*/g,'').replace(/\/\*[\s\S]*?\*\//g,'');
  if(/\b(while|loop)\b/.test(text))out.push(`${lang.toUpperCase()} ${section}: while and loop are not allowed (a GPU can hang); use a for loop up to a fixed number`);
  for(const m of text.matchAll(/\bfor\s*\(([^)]*)\)/g)){const parts=m[1].split(';');const bound=/<=?\s*(\d+(?:\.\d+)?)u?\s*$/.exec((parts[1]??'').trim());if(!bound||Number(bound[1])>256)out.push(`${lang.toUpperCase()} ${section}: a for loop must stop at a number written in the code, at most 256 (i < 16)`);}}
 return out;}
/** Problems that need no GPU: loops and empty required code. */
export function shaderProblems(s:ShaderItem):string[]{const out=loopProblems(s);
 if(s.kind==='material'&&(!s.wgsl.material.trim()||!s.glsl.material.trim()))out.push('A material shader needs material code (WGSL and GLSL)');
 if(s.kind==='lighting'&&(!s.wgsl.perLight.trim()||!s.glsl.perLight.trim()))out.push('A lighting shader needs per-light code (WGSL and GLSL)');
 return out;}

const binding=(p:ShaderParam)=>p.type==='float'?'f32':p.type==='vec2'?'vec2<f32>':'vec4<f32>';
const marker=(section:string)=>`// @olive-shader ${section}`,endMarker='// @olive-shader-end';
/** A user section as inserted: between markers, so an error line can be traced to the user's own line. */
export const wrap=(section:string,text:string)=>text.trim()?`\n${marker(section)}\n${text}\n${endMarker}\n`:'';
/**
 * The shader bits for a shader, named after its content (pixi3d refuses one name with two contents). Every bit gets
 * the parameters as material fields (textures as sampleName(uv)) and `time`, game seconds the 3D view writes.
 */
export function shaderBits(s:ShaderItem):ShaderBit[]{const hash=shaderHash(s),name=`olive-${s.kind}-${hash}`;
 const material={time:'f32',...Object.fromEntries(s.params.filter(p=>p.type!=='texture').map(p=>[p.name,binding(p)]))},textures=s.params.filter(p=>p.type==='texture').map(p=>p.name);
 const section=(lang:'wgsl'|'glsl',key:keyof ShaderItem['wgsl'])=>wrap(key,s[lang][key]);
 if(s.kind!=='lighting')return[{name,bindings:{material},...textures.length?{textures}:{},gpu:{...s.wgsl.header.trim()?{header:section('wgsl','header')}:{},fragment:{material:section('wgsl','material')}},gl:{...s.glsl.header.trim()?{header:section('glsl','header')}:{},fragment:{material:section('glsl','material')}}} as unknown as ShaderBit];
 // Lighting: a plain surface (colour × colour map, viewDir) plus the user's material code, then the light loop around the user's maths.
 const surface={name:`${name}-surface`,bindings:{material:{baseColor:'vec4<f32>',...material}},textures:['baseColor',...textures],
  gpu:{...s.wgsl.header.trim()?{header:section('wgsl','header')}:{},fragment:{material:`
  var baseColor = material.baseColor;
  if (HAS_UVS == 1) { let baseTex = sampleBaseColor(input.vUV); baseColor *= vec4<f32>(baseTex.rgb / max(baseTex.a, 0.001), baseTex.a); }
  albedo *= baseColor.rgb;
  alpha *= baseColor.a;
  var viewDir = normalize(camera.uCameraPosition.xyz - input.vPosition);
`+section('wgsl','material')}},
  gl:{...s.glsl.header.trim()?{header:section('glsl','header')}:{},fragment:{material:`
  vec4 baseColor = material.baseColor;
  if (HAS_UVS == 1) { vec4 baseTex = sampleBaseColor(vUV); baseTex.rgb /= max(baseTex.a, 0.001); baseColor *= baseTex; }
  albedo *= baseColor.rgb;
  alpha *= baseColor.a;
  vec3 viewDir = normalize(uCameraPosition.xyz - vPosition);
`+section('glsl','material')}}} as unknown as ShaderBit;
 const lighting=createLightingBit({name:`${name}-lighting`,preLighting:{gpu:section('wgsl','preLighting'),gl:section('glsl','preLighting')},perLight:{gpu:section('wgsl','perLight'),gl:section('glsl','perLight')},postLighting:{gpu:section('wgsl','postLighting'),gl:section('glsl','postLighting')}});
 return[surface,lighting];}
/** A material for kinds that replace the surface (material: unlit; lighting: lit by the user's loop). */
export class ShaderMaterial3D extends BaseMaterial3D{
 constructor(s:ShaderItem,baseColor:string){const bits=shaderBits(s);super({baseColor,descriptor:{bitsGpu:bits,bitsGl:bits}} as never);if(s.kind==='material'){this.lit=false;this.colorSpace='display';}}
}

/** Text that only this shader's code has in a generated source of that language: its first non-empty section, as inserted. */
export function fingerprint(s:ShaderItem,lang:'wgsl'|'glsl'){for(const section of shaderSections(s.kind)){const text=s[lang][section as keyof ShaderItem['wgsl']];if(text.trim())return text.trim();}return'';}
/** Where an error line of a generated source falls among the user's sections: section and the user's own line, or null. */
export function userLine(source:string,line:number):{section:string;line:number}|null{const lines=source.split('\n');if(line<1||line>lines.length)return null;
 for(let i=line-1;i>=0;i--){const t=lines[i].trim();if(t===endMarker&&i!==line-1)return null;const m=/^\/\/ @olive-shader (\w+)$/.exec(t);if(m)return i===line-1?null:{section:m[1],line:line-1-i};}
 return null;}
