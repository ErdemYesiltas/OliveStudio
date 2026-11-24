import {Application, type WebGPURenderer} from 'pixi.js';
import {AmbientLight, CubeGeometry, Material3D, Mesh3D, View3D, type ShaderBit} from '@pixi/3d';
/**
 * Spike (SCRIPT-SHADER-3D.md §4 B4, S3 prerequisite): the editor runs one renderer, but a user's Shader 3D needs its
 * WGSL and its GLSL both to compile. Can the editor compile the other backend's half invisibly, and how do errors look?
 * Per backend: a hidden Application (never added to the page), a 3D view with one cube whose material carries the
 * user's bit, drawn once; then the same with a broken bit, then a good one again (does a bad shader poison the app?).
 * Not part of the product; run by scripts/fixtures/spike-shader-chrome.mjs.
 */
export type Backend = 'webgl' | 'webgpu';
const user = (gl: string, gpu: string, name: string): ShaderBit => ({name, gl: {fragment: {material: gl}}, gpu: {fragment: {material: gpu}}}) as unknown as ShaderBit;
// Three lines each, so an error's line number can be traced back to the user's text (line 2 is the broken one).
export const goodBit = (n: number) => user(`// user line 1\n  albedo *= vec3(0.1, 0.9, 0.2);\n  // user line 3`, `// user line 1\n  albedo *= vec3<f32>(0.1, 0.9, 0.2);\n  // user line 3`, `user-good-${n}`);
export const badBit = (n: number) => user(`// user line 1\n  albedo *= nope_${n};\n  // user line 3`, `// user line 1\n  albedo *= nope_${n};\n  // user line 3`, `user-bad-${n}`);
export interface CompileProbe {backend: Backend; initMs: number; good: Draw; bad: Draw; goodAfterBad: Draw}
export interface Draw {ms: number; threw: string | null; logged: string[]; gpuErrors: string[]; centre: number[]; mentionsUserLine: boolean; generatedLine: number | null; userLine: number | null}
/** The marker opening every user snippet (its first line); its line in the generated source gives the offset. */
const markerOf = (text: string) => /\/\/ user line 1/.exec(text);
/** Draws one cube with `bit` into a hidden app and reports what happened. */
async function draw(app: Application, view: View3D, bit: ShaderBit, gpu: GPUDevice | undefined, sources: string[]): Promise<Draw> {
 sources.length = 0;
 const logged: string[] = [], gpuErrors: string[] = [], keep = {error: console.error, warn: console.warn};
 console.error = (...a: unknown[]) => { logged.push(a.map(String).join(' ').slice(0, 4000)); };
 console.warn = (...a: unknown[]) => { logged.push(a.map(String).join(' ').slice(0, 4000)); };
 const mesh = new Mesh3D({geometry: new CubeGeometry({width: 2, height: 2, depth: 2}), material: new Material3D({baseColor: '#ffffff', extraBits: [bit]})});
 view.root.addChild(mesh);
 let threw: string | null = null; const start = performance.now();
 gpu?.pushErrorScope('validation');
 try { app.renderer.render(app.stage); } catch (error) { threw = error instanceof Error ? error.message : String(error); }
 if (gpu) { const e = await gpu.popErrorScope(); if (e) gpuErrors.push(e.message.slice(0, 4000)); await gpu.queue.onSubmittedWorkDone(); }
 const ms = performance.now() - start;
 let centre: number[] = [];
 try { const {pixels, width, height} = app.renderer.extract.pixels({target: app.stage}); const o = (Math.floor(height / 2) * width + Math.floor(width / 2)) * 4; centre = Array.from(pixels.slice(o, o + 4)); } catch (error) { logged.push('extract: ' + String(error)); }
 console.error = keep.error; console.warn = keep.warn;
 mesh.removeFromParent(); mesh.destroy();
 const text = [threw ?? '', ...logged, ...gpuErrors].join('\n');
 // The error's line in the generated source (WGSL ":line:col error", GLSL "ERROR: 0:line:"), and the user's own line:
 // that minus the marker's line in the same generated source (the source the hidden app handed to the GPU).
 const at = /:(\d+):\d+ error/.exec(text) ?? /ERROR: 0:(\d+):/.exec(text), generatedLine = at ? Number(at[1]) : null;
 let userLine: number | null = null;
 if (generatedLine !== null) for (const src of sources) { const m = markerOf(src); if (!m) continue; const markerLine = src.slice(0, m.index).split('\n').length; const candidate = generatedLine - markerLine + 1; if (candidate >= 1 && candidate <= 3) { userLine = candidate; break; } }
 return {ms: +ms.toFixed(1), threw, logged: logged.slice(0, 3).map(l => l.slice(0, 300)), gpuErrors: gpuErrors.slice(0, 3).map(l => l.slice(0, 300)), centre, mentionsUserLine: /nope_/.test(text), generatedLine, userLine};
}
export async function probe(backend: Backend): Promise<CompileProbe> {
 const start = performance.now(), app = new Application();
 await app.init({preference: backend, width: 64, height: 64, background: '#000000', autoStart: false, antialias: false});
 if (app.renderer.name !== backend) throw Error(`asked for ${backend}, got ${app.renderer.name}`);
 const initMs = performance.now() - start, view = new View3D({width: 64, height: 64, autoResize: false});
 view.camera.position.set(0, 0, 5); view.camera.lookAt({x: 0, y: 0, z: 0}); view.root.addChild(new AmbientLight({intensity: 1})); app.stage.addChild(view);
 const gpu = backend === 'webgpu' ? (app.renderer as WebGPURenderer).gpu.device : undefined;
 // The hidden app owns its device or context, so it can see every shader source it compiles.
 const sources: string[] = [];
 if (gpu) { const create = gpu.createShaderModule.bind(gpu); gpu.createShaderModule = d => { sources.push(d.code); return create(d); }; }
 else { const gl = (app.renderer as unknown as {gl: WebGL2RenderingContext}).gl, set = gl.shaderSource.bind(gl); gl.shaderSource = (sh, src) => { sources.push(src); set(sh, src); }; }
 const uncaptured: string[] = []; gpu?.addEventListener('uncapturederror', e => uncaptured.push((e as GPUUncapturedErrorEvent).error.message.slice(0, 2000)));
 try {
  const good = await draw(app, view, goodBit(1), gpu, sources), bad = await draw(app, view, badBit(2), gpu, sources), goodAfterBad = await draw(app, view, goodBit(3), gpu, sources);
  if (uncaptured.length) bad.gpuErrors.push(...uncaptured.map(u => 'uncaptured: ' + u));
  return {backend, initMs: +initMs.toFixed(1), good, bad, goodAfterBad};
 } finally { app.destroy(true); }
}
