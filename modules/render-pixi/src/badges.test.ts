import {expect, it} from 'vitest';
import {markerGlyph, rulerStep} from './badges';

it('picks a glyph per role for objects without a visual', () => {
 expect(markerGlyph(['scene.transform2d', 'interactions.bindings'])).toBe('⚙');
 expect(markerGlyph(['scene.transform2d', 'interactions.timer', 'interactions.bindings'])).toBe('◷');
 expect(markerGlyph(['scene.transform2d', 'physics.boxCollider2d'])).toBe('⬚');
 expect(markerGlyph(['scene.transform2d'])).toBe('◇');
});

it('spaces ruler labels on a 1-2-5 scale at least 64 px apart', () => {
 expect(rulerStep(1)).toBe(100);
 expect(rulerStep(.5)).toBe(200);
 expect(rulerStep(4)).toBe(20);
 expect(rulerStep(.05)).toBe(2000);
 for (const s of [.13, .7, 1.9, 3.3]) expect(rulerStep(s) * s).toBeGreaterThanOrEqual(64);
});
