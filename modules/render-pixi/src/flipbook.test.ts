import {expect, it} from 'vitest';
import {FlipbookSchema, flipbookDefinition, flipbookFrame} from './flipbook';

it('chooses sprite-sheet frames from runtime time: loop, hold, paused and editing', () => {
 const p = {frames: 4, fps: 10, loop: true, autoplay: true};
 expect([0, 0.09, 0.1, 0.35, 0.4, 0.95].map(t => flipbookFrame(p, t))).toEqual([0, 0, 1, 3, 0, 1]);
 expect(flipbookFrame({...p, loop: false}, 5)).toBe(3);
 expect(flipbookFrame({...p, autoplay: false}, 5)).toBe(0);
 expect(flipbookFrame(p, Number.NaN)).toBe(0);
});

it('rejects more frames than the grid holds', () => {
 const value = flipbookDefinition.defaults() as Record<string, unknown>;
 expect(FlipbookSchema.parse(value)).toMatchObject({columns: 4, frames: 4});
 expect(() => FlipbookSchema.parse({...value, frames: 5})).toThrow('Frame count exceeds');
});
