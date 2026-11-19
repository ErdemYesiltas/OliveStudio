import {describe, expect, it} from 'vitest';
import {ShaderLibrarySchema, colorHex, fragmentSource, lintShader, parseShaderLog, parseUniforms, resolveShader, shaderPresets, uniformValue} from './shaders';

describe('custom shaders', () => {
 it('reads uniform controls from declarations and comments', () => {
  const specs = parseUniforms(`uniform float uAmount; // 0..2 = 0.5
uniform vec2 uDir; // = 1, 0
uniform vec3 uTint; // color = #ff8000
uniform vec4 uGlow; // color
uniform float uPlain;
uniform sampler2D uOther;
  float notAUniform;`);
  expect(specs.map(s => s.name)).toEqual(['uAmount', 'uDir', 'uTint', 'uGlow', 'uPlain']);
  expect(specs[0]).toMatchObject({type: 'float', min: 0, max: 2, default: .5, color: false, line: 1});
  expect(specs[1].default).toEqual([1, 0]);
  expect(specs[2]).toMatchObject({color: true, default: [1, .502, 0]});
  expect(specs[3]).toMatchObject({color: true, default: [1, 1, 1, 1]});
  expect(specs[4]).toMatchObject({min: 0, max: 1, default: 0});
 });
 it('uses component values that fit the type, defaults otherwise', () => {
  const [amount, dir, tint, glow] = parseUniforms('uniform float uA; // = 3\nuniform vec2 uD;\nuniform vec3 uT; // color\nuniform vec4 uG; // color');
  expect(uniformValue(amount, {uA: 7})).toBe(7); expect(uniformValue(amount, {uA: [1, 2]})).toBe(3); expect(uniformValue(amount, {})).toBe(3);
  expect(uniformValue(dir, {uD: [4, 5]})).toEqual([4, 5]); expect(uniformValue(dir, {uD: [1, 2, 3]})).toEqual([0, 0]);
  expect(uniformValue(tint, {uT: '#00ff00'})).toEqual([0, 1, 0]); expect(uniformValue(glow, {uG: '#0000ff'})).toEqual([0, 0, 1, 1]);
  expect(uniformValue(dir, {uD: '#ffffff'})).toEqual([0, 0]);
  expect(colorHex([1, .5, 0])).toBe('#ff8000'); expect(colorHex([2, -1, .2, 1])).toBe('#ff0033');
 });
 it('lints missing effect() and redeclared built-ins, maps GPU errors to user lines', () => {
  expect(lintShader('void main() {}')[0].message).toMatch(/effect/);
  expect(lintShader('uniform float uTime;\nvec4 effect(vec2 uv) { return tex(uv); }')).toEqual([{line: 1, message: 'uTime is already provided'}]);
  expect(lintShader('vec4 effect(vec2 p) { return tex(p); }')).toEqual([]);
  expect(parseShaderLog("ERROR: 0:3: 'x' : undeclared identifier\nERROR: 0:3: '' : compilation terminated\n")).toEqual([{line: 3, message: "'x' : undeclared identifier"}, {line: 3, message: "'' : compilation terminated"}]);
  expect(parseShaderLog('weird')).toEqual([{line: 1, message: 'weird'}]);
  const full = fragmentSource('vec4 effect(vec2 uv) { return tex(uv); }');
  expect(full).toMatch(/#line 1\nvec4 effect/); expect(full).toMatch(/finalColor = effect\(vTextureCoord\)/);
 });
 it('ships presets that lint clean and parse their controls', () => {
  for (const p of shaderPresets) { expect(lintShader(p.source), p.id).toEqual([]); expect(parseUniforms(p.source).length, p.id).toBeGreaterThan(0); }
  expect(new Set(shaderPresets.map(p => p.id)).size).toBe(shaderPresets.length);
 });
 it('resolves the component shader from the library and rejects bad data', () => {
  const library = {version: 1, items: [{id: 's1', name: 'Gray', source: shaderPresets[1].source}]};
  expect(resolveShader(library, {shaderId: 's1', values: {uAmount: .3}, padding: 0})).toMatchObject({source: shaderPresets[1].source, data: {values: {uAmount: .3}}});
  expect(resolveShader(library, {shaderId: 'nope', values: {}, padding: 0})).toBeNull();
  expect(resolveShader(library, {shaderId: 's1'})).toBeNull();
  expect(resolveShader({version: 1, items: [{id: 's1', name: 'Bad', source: 'nothing'}]}, {shaderId: 's1', values: {}, padding: 0})).toBeNull();
  expect(() => ShaderLibrarySchema.parse({version: 1, items: [library.items[0], library.items[0]]})).toThrow(/unique/);
 });
});
