import {expect, it} from 'vitest';
import {bezierEase, createTrackSampler, ClipSchema, newClip} from './index';
import type {TweenProvider} from '@rewrite/tween';

const unused: TweenProvider = {id: 'unused', create: () => { throw Error('curve segments must not use the tween provider'); }};

it('solves cubic bezier easing like CSS, including overshoot', () => {
 expect(bezierEase([0, 0, 1, 1], 0.3)).toBeCloseTo(0.3, 5);
 // CSS `ease` at 50% progress ≈ 0.8024.
 expect(bezierEase([0.25, 0.1, 0.25, 1], 0.5)).toBeCloseTo(0.8024, 3);
 expect(bezierEase([0.34, 1.56, 0.64, 1], 0.6)).toBeGreaterThan(1);
 expect(bezierEase([0.36, 0, 0.66, -0.56], 0.2)).toBeLessThan(0);
 expect([bezierEase([0.42, 0, 0.58, 1], 0), bezierEase([0.42, 0, 0.58, 1], 1)]).toEqual([0, 1]);
});

it('samples curve segments without the tween provider and validates control points', () => {
 const sampler = createTrackSampler({id: 't', entityId: 'e', componentId: 'c', property: 'x', keys: [
  {id: 'k0', time: 0, value: 100, ease: 'curve', curve: [0.42, 0, 0.58, 1]},
  {id: 'k1', time: 2, value: 300, ease: 'linear'},
 ]}, unused);
 expect(sampler.sample(1)).toBeCloseTo(200, 5);
 expect(sampler.sample(0.5)).toBeLessThan(150);
 const clip = newClip();
 clip.tracks.push({id: 't', entityId: 'e', componentId: 'c', property: 'x', keys: [{id: 'k', time: 0, value: 0, ease: 'curve'}]});
 expect(() => ClipSchema.parse(clip)).toThrow('Curve easing needs control points');
 clip.tracks[0].keys[0] = {id: 'k', time: 0, value: 0, ease: 'curve', curve: [1.5, 0, 0.5, 1]};
 expect(() => ClipSchema.parse(clip)).toThrow();
});
