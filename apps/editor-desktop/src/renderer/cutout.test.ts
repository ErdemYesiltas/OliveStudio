import {expect, it} from 'vitest';
import {cutoutBackground} from './cutout';

/** A w×h image: background colour everywhere, a subject square, and a hole of background colour inside it. */
function image(w: number, h: number) {
 const px = new Uint8ClampedArray(w * h * 4);
 for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
  const i = (y * w + x) * 4, subject = x >= 3 && x < 9 && y >= 3 && y < 9, hole = x === 6 && y === 6;
  const [r, g, b] = subject && !hole ? [200, 30, 30] : [12 + (x % 2) * 4, 200, 40];
  px.set([r, g, b, 255], i);
 }
 return px;
}
const alpha = (p: Uint8ClampedArray, w: number, x: number, y: number) => p[(y * w + x) * 4 + 3];

it('clears the background connected to the edges, keeps the subject and the background-coloured hole inside it', () => {
 const w = 12, h = 12, out = cutoutBackground(image(w, h), w, h);
 expect(out.background[1]).toBe(200);
 expect(alpha(out.pixels, w, 0, 0)).toBe(0);
 expect(alpha(out.pixels, w, 11, 5)).toBe(0);
 expect(alpha(out.pixels, w, 4, 4)).toBe(255);
 expect(alpha(out.pixels, w, 6, 6)).toBe(255);
 expect(out.removed).toBe(w * h - 36);
});

it('fades the near-background edge, votes on corners and refuses mismatched sizes', () => {
 const w = 5, h = 1, px = new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 255, 40, 0, 0, 255, 255, 0, 0, 255, 0, 0, 0, 255]);
 const out = cutoutBackground(px, w, h, 32, 16);
 expect([0, 1, 2, 3, 4].map(x => alpha(out.pixels, w, x, 0))).toEqual([0, 0, 128, 255, 0]);
 // One corner covered by the subject: the other three decide.
 const big = image(12, 12); big.set([200, 30, 30, 255], 0);
 expect(cutoutBackground(big, 12, 12).background[1]).toBe(200);
 expect(() => cutoutBackground(new Uint8ClampedArray(4), 2, 2)).toThrow('does not match');
});
