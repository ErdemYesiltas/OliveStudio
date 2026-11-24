import {shouldInterruptAfterDeadline, type QuickJSWASMModule} from 'quickjs-emscripten-core';
/**
 * Spike (SCRIPT-SHADER-3D.md §3 A2): how fast can a script hand the host a frame of particle data? A script
 * simulates `count` particles × 8 floats (position, size, colour, alpha) each frame in QuickJS; the host gets them by
 *  - compute: no transfer (the script's own cost, the floor every method pays),
 *  - json: the bridge scripts use today (a JSON string of the numbers, parsed by the host),
 *  - buffer: one ArrayBuffer copy out of the sandbox (getArrayBuffer) into a host Float32Array,
 *  - calls: one host call per particle (the pattern the design forbids), for contrast.
 * Not part of the product; run by array-bridge.spike.test.ts (Node) and the Chrome page in scripts/fixtures.
 */
export type BridgeMethod = 'compute' | 'json' | 'buffer' | 'calls';
export interface BridgeResult {method: BridgeMethod; count: number; frames: number; medianMs: number; p95Ms: number; checksum: number}
const FLOATS = 8;
const script = `"use strict";
const count = __count, data = new Float32Array(count * ${FLOATS});
let t = 0;
globalThis.__step = dt => {
  t += dt;
  for (let i = 0; i < count; i++) {
    const o = i * ${FLOATS}, a = i * 0.37 + t, r = 1 + (i % 50) * 0.04;
    data[o] = Math.cos(a) * r; data[o + 1] = (i % 97) * 0.02 + Math.sin(t + i) * 0.1; data[o + 2] = Math.sin(a) * r;
    data[o + 3] = 0.05 + (i % 7) * 0.01; data[o + 4] = (i % 255) / 255; data[o + 5] = 0.5; data[o + 6] = 1 - (i % 255) / 255; data[o + 7] = 0.8;
  }
};
globalThis.__compute = dt => { __step(dt); return 0; };
globalThis.__json = dt => { __step(dt); return JSON.stringify(Array.from(data)); };
globalThis.__buffer = dt => { __step(dt); return data.buffer; };
globalThis.__calls = dt => { __step(dt); for (let i = 0; i < count; i++) { const o = i * ${FLOATS}; __put(i, data[o], data[o + 1], data[o + 2], data[o + 3], data[o + 4], data[o + 5], data[o + 6], data[o + 7]); } return 0; };
`;
const percentile = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
export function runBridge(module: QuickJSWASMModule, method: BridgeMethod, count = 4000, frames = 300, warmup = 30, now: () => number = () => performance.now()): BridgeResult {
 const runtime = module.newRuntime(); runtime.setMemoryLimit(64 * 1024 * 1024); runtime.setMaxStackSize(1024 * 1024);
 const vm = runtime.newContext(), out = new Float32Array(count * FLOATS);
 try {
  const put = vm.newFunction('__put', (...args) => { const i = vm.getNumber(args[0]); for (let k = 0; k < FLOATS; k++) out[i * FLOATS + k] = vm.getNumber(args[k + 1]); });
  vm.setProp(vm.global, '__put', put); put.dispose();
  const n = vm.newNumber(count); vm.setProp(vm.global, '__count', n); n.dispose();
  vm.unwrapResult(vm.evalCode(script, 'bridge.js')).dispose();
  const fn = vm.getProp(vm.global, `__${method}`), times: number[] = [];
  for (let f = 0; f < warmup + frames; f++) {
   const start = now(), dt = vm.newNumber(1 / 60);
   runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + 250));
   const result = vm.unwrapResult(vm.callFunction(fn, vm.undefined, dt)); dt.dispose(); runtime.removeInterruptHandler();
   if (method === 'json') out.set(JSON.parse(vm.getString(result)) as number[]);
   else if (method === 'buffer') { const bytes = vm.getArrayBuffer(result); out.set(new Float32Array(bytes.value.buffer, bytes.value.byteOffset, count * FLOATS)); bytes.dispose(); }
   result.dispose();
   if (f >= warmup) times.push(now() - start);
  }
  fn.dispose();
  times.sort((a, b) => a - b);
  let checksum = 0; for (let i = 0; i < out.length; i += 97) checksum += out[i];
  return {method, count, frames, medianMs: +percentile(times, .5).toFixed(3), p95Ms: +percentile(times, .95).toFixed(3), checksum: +checksum.toFixed(3)};
 } finally { vm.dispose(); runtime.dispose(); }
}
