import {Filter, GlProgram, UniformGroup, defaultFilterVert, type FilterSystem, type RenderSurface, type Texture} from 'pixi.js';
import {z} from 'zod';
import type {ComponentDefinition, Json} from '@rewrite/sdk';

/**
 * Custom shaders: GLSL fragments kept in a project library (`pixi.shaders`) and applied to objects by the
 * `pixi.shader` component as the last filter of the object's stack. A shader is written as
 *
 *   uniform float uAmount; // 0..1 = 0.5
 *   vec4 effect(vec2 uv) { return mix(tex(uv), vec4(1.0), uAmount); }
 *
 * with `tex(uv)` (clamped sample), `unit(uv)` (0..1 across the object), `fromUnit(p)`, `uPixel` (one pixel in uv) and
 * `uTime` (seconds) provided. `uniform` lines become Inspector controls; the comment sets range, default or `color`.
 */
export const shadersSection = 'pixi.shaders';
export const shaderType = 'pixi.shader';
const Color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const ShaderItemSchema = z.object({id: z.string().min(1).max(64), name: z.string().trim().min(1).max(80), source: z.string().max(20000)}).strict();
export const ShaderLibrarySchema = z.object({version: z.literal(1), items: z.array(ShaderItemSchema).max(200)}).strict()
 .refine(v => new Set(v.items.map(i => i.id)).size === v.items.length, {message: 'Shader IDs must be unique'});
export type ShaderItem = z.infer<typeof ShaderItemSchema>;
export type ShaderLibrary = z.infer<typeof ShaderLibrarySchema>;
export const emptyShaderLibrary = (): ShaderLibrary => ({version: 1, items: []});
export const UniformValueSchema = z.union([z.number().finite(), z.array(z.number().finite()).min(2).max(4), Color]);
export const ShaderSchema = z.object({
 shaderId: z.string().max(64),
 /** Uniform values by name; missing ones use the default from the shader's comment. */
 values: z.record(z.string().regex(/^[A-Za-z_]\w{0,63}$/), UniformValueSchema),
 /** Extra pixels around the object the shader may draw into (waves, glows). */
 padding: z.number().min(0).max(512),
}).strict();
export type ShaderData = z.infer<typeof ShaderSchema>;
export const shaderDefinition: ComponentDefinition = {
 type: shaderType, version: 1, titleKey: 'component.shader',
 defaults: () => ({shaderId: '', values: {}, padding: 0}), parse: v => ShaderSchema.parse(v) as Json,
 fields: [{key: 'shaderId', titleKey: 'shader.shader', kind: 'string', visible: () => false}, {key: 'padding', titleKey: 'shader.padding', kind: 'number'}],
};

export interface UniformSpec {name: string; type: 'float' | 'vec2' | 'vec3' | 'vec4'; color: boolean; min: number; max: number; default: number | number[]; line: number}
/** Names the prelude declares; a shader may not declare them again. */
export const builtinUniforms = ['uTexture', 'uInputSize', 'uOutputFrame', 'uInputClamp', 'uTime'] as const;
const sizes = {float: 1, vec2: 2, vec3: 3, vec4: 4} as const;
const hex = (v: string) => { const n = Number.parseInt(v.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255].map(c => Math.round(c * 1000) / 1000); };
export const colorHex = (v: readonly number[]) => '#' + v.slice(0, 3).map(c => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, '0')).join('');
/**
 * `uniform` declarations with their control hints: `// 0..2 = 0.5` (range and default), `// = 1, 0` (vector default),
 * `// color = #ff8800` (colour picker for vec3 / vec4).
 */
export function parseUniforms(source: string): UniformSpec[] {
 const out: UniformSpec[] = [];
 source.split('\n').forEach((text, index) => {
  const m = /^\s*uniform\s+(float|vec2|vec3|vec4)\s+([A-Za-z_]\w*)\s*;\s*(?:\/\/(.*))?$/.exec(text);
  if (!m) return;
  const type = m[1] as UniformSpec['type'], hint = (m[3] ?? '').trim(), size = sizes[type];
  const color = /^color\b/i.test(hint) && size >= 3, range = /(-?[\d.]+)\s*\.\.\s*(-?[\d.]+)/.exec(hint), def = /=\s*(.+)$/.exec(hint)?.[1].trim();
  let value: number[] = Array(size).fill(0);
  if (color) value = def && /^#[0-9a-f]{6}$/i.test(def) ? hex(def) : [1, 1, 1];
  else if (def) { const parts = def.split(',').map(Number); if (parts.every(Number.isFinite)) value = Array.from({length: size}, (_, i) => parts[i] ?? parts[parts.length - 1]); }
  if (color && size === 4) value = [...value.slice(0, 3), 1];
  const min = range ? Number(range[1]) : 0, max = range ? Number(range[2]) : Math.max(1, ...value.map(Math.abs));
  out.push({name: m[2], type, color, min: Number.isFinite(min) ? min : 0, max: Number.isFinite(max) && max > min ? max : min + 1, default: size === 1 ? value[0] : value, line: index + 1});
 });
 return out;
}
/** The value a uniform gets: the component's (when it fits the type) or the default. */
export function uniformValue(spec: UniformSpec, values: ShaderData['values']): number | number[] {
 const v = values[spec.name], size = sizes[spec.type];
 if (typeof v === 'string') { if (!spec.color) return spec.default; const rgb = hex(v); return size === 4 ? [...rgb, 1] : rgb; }
 if (typeof v === 'number') return size === 1 ? v : spec.default;
 if (Array.isArray(v) && v.length === size) return [...v];
 return spec.default;
}
const prelude = `in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uInputClamp;
uniform float uTime;
#define uPixel (uInputSize.zw)
vec4 tex(vec2 uv) { return texture(uTexture, clamp(uv, uInputClamp.xy, uInputClamp.zw)); }
vec2 unit(vec2 uv) { return uv * uInputSize.xy / uOutputFrame.zw; }
vec2 fromUnit(vec2 p) { return p * uOutputFrame.zw / uInputSize.xy; }
#line 1
`;
/** Full fragment program for Pixi (which adds the version and precision lines). `#line 1` keeps error lines in the user's numbering. */
export const fragmentSource = (source: string) => `${prelude}${source}\nvoid main() { finalColor = effect(vTextureCoord); }\n`;
export interface ShaderProblem {line: number; message: string}
/** Problems found without a GPU: missing `effect`, redeclared built-ins. */
export function lintShader(source: string): ShaderProblem[] {
 const problems: ShaderProblem[] = [];
 if (!/\bvec4\s+effect\s*\(\s*vec2\s+\w+\s*\)/.test(source)) problems.push({line: 1, message: 'Define vec4 effect(vec2 uv) — it returns the colour of each pixel'});
 source.split('\n').forEach((text, i) => { for (const name of builtinUniforms) if (new RegExp(`^\\s*uniform\\s+\\w+\\s+${name}\\b`).test(text)) problems.push({line: i + 1, message: `${name} is already provided`}); });
 return problems;
}
let gl: WebGL2RenderingContext | null | undefined;
const checked = new Map<string, ShaderProblem[]>();
/** Compiles the fragment on a small private WebGL2 context and returns its errors in the user's line numbers (empty when it compiles). */
export function checkShader(source: string): ShaderProblem[] {
 const lint = lintShader(source); if (lint.length) return lint;
 const known = checked.get(source); if (known) return known;
 if (gl === undefined) gl = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('webgl2');
 if (!gl) return [];
 const shader = gl.createShader(gl.FRAGMENT_SHADER); if (!shader) return [];
 gl.shaderSource(shader, `#version 300 es\nprecision highp float;\n${fragmentSource(source)}`); gl.compileShader(shader);
 const ok = gl.getShaderParameter(shader, gl.COMPILE_STATUS), log = ok ? '' : gl.getShaderInfoLog(shader) ?? 'Compile failed';
 gl.deleteShader(shader);
 const problems = ok ? [] : parseShaderLog(log);
 if (checked.size > 200) checked.clear();
 checked.set(source, problems); return problems;
}
/** `ERROR: 0:12: 'x' : undeclared identifier` → {line: 12, message: …}. */
export function parseShaderLog(log: string): ShaderProblem[] {
 const out = log.split('\n').map(l => /^(?:ERROR|WARNING):\s*\d+:(\d+):\s*(.*)$/.exec(l.trim())).filter(Boolean).map(m => ({line: Math.max(1, Number(m![1])), message: m![2].trim()}));
 return out.length ? out : log.trim() ? [{line: 1, message: log.trim()}] : [];
}
const groupType = {float: 'f32', vec2: 'vec2<f32>', vec3: 'vec3<f32>', vec4: 'vec4<f32>'} as const;
class ShaderFilter extends Filter {
 private readonly started = performance.now();
 override apply(filterManager: FilterSystem, input: Texture, output: RenderSurface, clearMode: boolean) {
  (this.resources.shaderUniforms as UniformGroup).uniforms.uTime = (performance.now() - this.started) / 1000;
  filterManager.applyFilter(this, input, output, clearMode);
 }
}
/** A Pixi filter for one shader with these values (WebGL). */
export function createShaderFilter(source: string, data: ShaderData): Filter {
 const uniforms: Record<string, {value: number | Float32Array; type: string}> = {uTime: {value: 0, type: 'f32'}};
 for (const spec of parseUniforms(source)) { const v = uniformValue(spec, data.values); uniforms[spec.name] = {value: typeof v === 'number' ? v : new Float32Array(v), type: groupType[spec.type]}; }
 return new ShaderFilter({glProgram: GlProgram.from({vertex: defaultFilterVert, fragment: fragmentSource(source), name: 'olive-shader', preferredFragmentPrecision: 'highp'}), resources: {shaderUniforms: new UniformGroup(uniforms as never)}, padding: data.padding});
}
/** The shader an object's component points at, if it exists and compiles. */
export function resolveShader(library: unknown, data: Json): {source: string; data: ShaderData} | null {
 const parsed = ShaderSchema.safeParse(data), lib = ShaderLibrarySchema.safeParse(library ?? emptyShaderLibrary());
 if (!parsed.success || !lib.success) return null;
 const item = lib.data.items.find(i => i.id === parsed.data.shaderId);
 if (!item || checkShader(item.source).length) return null;
 return {source: item.source, data: parsed.data};
}

export interface ShaderPreset {id: string; name: string; source: string}
export const shaderPresets: readonly ShaderPreset[] = [
 {id: 'wave', name: 'Wave', source: `uniform float uAmplitude; // 0..40 = 6
uniform float uFrequency; // 1..60 = 12
uniform float uSpeed; // 0..12 = 3

vec4 effect(vec2 uv) {
  vec2 p = unit(uv);
  uv.x += sin(p.y * uFrequency + uTime * uSpeed) * uAmplitude * uPixel.x;
  return tex(uv);
}`},
 {id: 'grayscale', name: 'Grayscale', source: `uniform float uAmount; // 0..1 = 1

vec4 effect(vec2 uv) {
  vec4 c = tex(uv);
  float g = dot(c.rgb, vec3(0.299, 0.587, 0.114));
  return vec4(mix(c.rgb, vec3(g) * c.a, uAmount), c.a);
}`},
 {id: 'chromatic', name: 'Chromatic aberration', source: `uniform float uOffset; // 0..20 = 3

vec4 effect(vec2 uv) {
  vec2 d = vec2(uOffset, 0.0) * uPixel;
  vec4 c = tex(uv);
  return vec4(tex(uv - d).r, c.g, tex(uv + d).b, max(c.a, max(tex(uv - d).a, tex(uv + d).a)));
}`},
 {id: 'scanlines', name: 'Scanlines', source: `uniform float uDensity; // 1..8 = 3
uniform float uStrength; // 0..1 = 0.35
uniform float uSpeed; // 0..60 = 20

vec4 effect(vec2 uv) {
  vec4 c = tex(uv);
  float row = uv.y / uPixel.y + uTime * uSpeed;
  float line = step(0.5, fract(row / uDensity));
  return vec4(c.rgb * (1.0 - uStrength * line), c.a);
}`},
 {id: 'vignette', name: 'Vignette', source: `uniform float uRadius; // 0..1.5 = 0.75
uniform float uSoftness; // 0.01..1 = 0.45
uniform vec3 uColor; // color = #000000

vec4 effect(vec2 uv) {
  vec4 c = tex(uv);
  float d = distance(unit(uv), vec2(0.5)) * 1.414;
  float v = smoothstep(uRadius, uRadius - uSoftness, d);
  return vec4(mix(uColor * c.a, c.rgb, v), c.a);
}`},
 {id: 'dissolve', name: 'Dissolve', source: `uniform float uProgress; // 0..1 = 0.4
uniform float uEdge; // 0..0.2 = 0.05
uniform float uScale; // 1..80 = 24
uniform vec3 uEdgeColor; // color = #ff8a00

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
vec4 effect(vec2 uv) {
  vec4 c = tex(uv);
  float n = noise(unit(uv) * uScale);
  if (n < uProgress) return vec4(0.0);
  float edge = 1.0 - smoothstep(uProgress, uProgress + uEdge, n);
  return vec4(mix(c.rgb, uEdgeColor * c.a, edge), c.a);
}`},
 {id: 'flash', name: 'Hit flash', source: `uniform float uAmount; // 0..1 = 0
uniform vec3 uColor; // color = #ffffff

vec4 effect(vec2 uv) {
  vec4 c = tex(uv);
  return vec4(mix(c.rgb, uColor * c.a, uAmount), c.a);
}`},
 {id: 'ripple', name: 'Ripple', source: `uniform float uStrength; // 0..30 = 8
uniform float uRings; // 1..40 = 12
uniform float uSpeed; // 0..12 = 4

vec4 effect(vec2 uv) {
  vec2 p = unit(uv) - 0.5;
  float d = length(p);
  vec2 dir = d > 0.0 ? p / d : vec2(0.0);
  uv += dir * sin(d * uRings * 6.2832 - uTime * uSpeed) * uStrength * uPixel * (1.0 - smoothstep(0.3, 0.5, d));
  return tex(uv);
}`},
];
