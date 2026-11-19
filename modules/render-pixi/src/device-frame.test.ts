import {expect, it} from 'vitest';
import {defaultRenderSettings, RenderSettingsSchema} from './contracts';
import {deviceFrame} from './device-frame';

it('shows what a screen sees of the stage per scale mode and device profile', () => {
 const stage = {width: 960, height: 540}, phone = {width: 393, height: 852};
 const fit = deviceFrame(defaultRenderSettings(), stage, phone);
 expect(fit.width).toBeCloseTo(960, 6); expect(fit.height).toBeCloseTo(960 * 852 / 393, 6); expect(fit.y).toBeLessThan(0);
 const fill = deviceFrame(RenderSettingsSchema.parse({version: 1, scaleMode: 'fill'}), stage, phone);
 expect(fill.height).toBeCloseTo(540, 6); expect(fill.width).toBeCloseTo(540 * 393 / 852, 6); expect(fill.x).toBeGreaterThan(0);
 expect(deviceFrame(RenderSettingsSchema.parse({version: 1, scaleMode: 'stretch'}), stage, phone)).toMatchObject({x: 0, y: 0, width: 960, height: 540});
 const profiled = deviceFrame(RenderSettingsSchema.parse({version: 1, profiles: {mobile: {portrait: {width: 540, height: 960, scaleMode: 'fill'}}}}), stage, phone);
 expect(profiled.profile).toEqual({width: 540, height: 960}); expect(profiled.scaleMode).toBe('fill');
});
