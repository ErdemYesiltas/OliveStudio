import {expect, it} from 'vitest';
import {channelValue} from './index';
import type {TweenChannel} from './contracts';

const skew: TweenChannel = {componentType: 'scene.transform2d', version: 1, property: 'skewX', titleKey: 'skewX', min: -89, max: 89, defaultValue: 0};
const scale: TweenChannel = {componentType: 'scene.transform2d', version: 1, property: 'scaleX', titleKey: 'scaleX', min: -100, max: 100, nonZero: true};

it('animates skew (0 when absent) and lets scale cross zero without ever writing 0', () => {
 expect(channelValue(skew, undefined)).toBe(0);
 expect(channelValue(skew, 30)).toBe(30);
 expect(() => channelValue(skew, 95)).toThrow();
 expect(channelValue(scale, -1)).toBe(-1);
 expect(channelValue(scale, 0)).toBe(1e-4);
 expect(channelValue(scale, -0)).toBe(-1e-4);
 expect(channelValue(scale, -5e-5)).toBe(-1e-4);
 expect(channelValue(scale, .5)).toBe(.5);
});
