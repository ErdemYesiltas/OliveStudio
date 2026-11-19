import {describe, expect, it} from 'vitest';
import {ProfileRecorder, breakdown, categoryOf, countDrawCalls, summarize, toCsv, type ProfileSample} from './index';

const sample = (frameMs: number, systems: Record<string, number> = {}, extra: Partial<ProfileSample> = {}): ProfileSample => ({time: 0, frameMs, renderMs: 2, systems, drawCalls: 10, objects: 5, steps: 1, ...extra});
describe('profiler', () => {
 it('groups systems into categories and leaves the rest of the frame idle', () => {
  expect(categoryOf('motion')).toBe('physics'); expect(categoryOf('tween')).toBe('animation'); expect(categoryOf('timers')).toBe('logic');
  const b = breakdown(sample(16, {scripts: 3, physics: 1, motion: 1, timers: .5}));
  expect(b).toMatchObject({scripts: 3, physics: 2, logic: .5, render: 2}); expect(b.idle).toBeCloseTo(8.5);
  expect(breakdown(sample(1, {scripts: 3})).idle).toBe(0);
 });
 it('keeps a bounded ring, pauses and notifies', () => {
  const r = new ProfileRecorder(3); let calls = 0; r.subscribe(() => calls++);
  for (let i = 0; i < 5; i++) r.push(sample(i + 1));
  expect(r.samples().map(s => s.frameMs)).toEqual([3, 4, 5]); expect(calls).toBe(5);
  r.paused = true; r.push(sample(9)); r.push(sample(NaN)); expect(r.samples()).toHaveLength(3);
  r.paused = false; r.push(sample(-1)); expect(r.samples()).toHaveLength(3);
  r.clear(); expect(r.samples()).toHaveLength(0);
 });
 it('summarizes rate, percentiles, spikes, catch-up frames and system shares', () => {
  const frames = [...Array(19)].map(() => sample(16.7, {scripts: 2})).concat(sample(50, {scripts: 20}, {steps: 3}));
  const s = summarize(frames);
  expect(s.frames).toBe(20); expect(s.fps).toBe(Math.round(20000 / (16.7 * 19 + 50))); expect(s.worst).toBe(50); expect(s.p95).toBe(50);
  expect(s.spikes).toBe(1); expect(s.catchUp).toBe(1); expect(s.drawCalls).toBe(10);
  expect(s.systems[0]).toMatchObject({id: 'scripts', category: 'scripts', max: 20}); expect(s.systems[0].average).toBeCloseTo(2.9);
  expect(s.systems.reduce((a, x) => a + x.share, 0)).toBeCloseTo(1);
  expect(summarize([])).toMatchObject({frames: 0, fps: 0, average: 0, worst: 0, systems: []});
 });
 it('writes CSV with a column per system', () => {
  const csv = toCsv([sample(16, {scripts: 1.23456}, {time: 100}), sample(17, {physics: 2}, {time: 116, heapMb: 40})]).trim().split('\n');
  expect(csv[0]).toBe('frame,time_ms,frame_ms,render_ms,physics_ms,scripts_ms,draw_calls,objects,steps,heap_mb');
  expect(csv[1]).toBe('0,0,16,2,0,1.235,10,5,1,'); expect(csv[2]).toBe('1,16,17,2,2,0,10,5,1,40');
 });
 it('counts draw calls through the context and restores it', () => {
  const proto = {drawElements() { return 'e'; }, drawArrays() { return 'a'; }}, gl = Object.create(proto);
  const counter = countDrawCalls(gl);
  expect(gl.drawElements()).toBe('e'); gl.drawArrays(); gl.drawArrays();
  expect(counter.take()).toBe(3); expect(counter.take()).toBe(0);
  counter.dispose(); gl.drawArrays(); expect(counter.take()).toBe(0); expect(Object.keys(gl)).toEqual([]);
  expect(countDrawCalls(null).take()).toBe(0);
 });
});
