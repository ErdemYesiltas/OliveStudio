import { Graphics } from 'pixi.js';
import { expect, it } from 'vitest';
import { drawGizmo, drawOriginMarkers } from './viewportGizmo';

it('keeps the rotation arc local to its handle', () => {
  const graphics = new Graphics();
  try {
    const handles = drawGizmo(graphics, 'rotate', [
      { x: 410, y: 154 }, { x: 550, y: 154 }, { x: 550, y: 298 }, { x: 410, y: 298 },
    ], { x: 480, y: 226 }, [{ x: 481, y: 226 }, { x: 480, y: 227 }], 1);

    expect(handles).toEqual([{ point: { x: 480, y: 135 }, axis: 'xy' }]);
    expect(graphics.context.bounds.minX).toBeGreaterThan(400);
    expect(graphics.context.bounds.minY).toBeGreaterThan(120);
  } finally {
    graphics.destroy();
  }
});

it('draws the anchor diamond around a coincident pivot', () => {
  const graphics = new Graphics();
  try {
    const origin = { x: 480, y: 226 };
    drawOriginMarkers(graphics, origin, 1, '#ffbf68');
    expect(graphics.context.bounds.minX).toBeCloseTo(473.5);
    expect(graphics.context.bounds.maxX).toBeCloseTo(486.5);

    graphics.clear();
    drawOriginMarkers(graphics, origin, 1, '#ffbf68', origin);
    const { minX, maxX, minY, maxY } = graphics.context.bounds;
    expect(minX).toBeLessThan(470);
    expect(maxX).toBeGreaterThan(490);
    expect(minY).toBeLessThan(216);
    expect(maxY).toBeGreaterThan(236);
  } finally {
    graphics.destroy();
  }
});
