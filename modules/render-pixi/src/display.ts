import {Graphics} from 'pixi.js';
import type {Shape} from './contracts';

/** Outline points of a shape, centred on the origin (rect and ellipse use native Pixi paths instead). */
export function shapePoints(p: Pick<Shape, 'kind' | 'width' | 'height' | 'sides' | 'innerRadius'>): number[] {
 const rx = p.width / 2, ry = p.height / 2;
 if (p.kind === 'triangle') return [0, -ry, rx, ry, -rx, ry];
 const count = p.kind === 'star' ? p.sides * 2 : p.sides, points: number[] = [];
 for (let i = 0; i < count; i++) {
  const angle = -Math.PI / 2 + i * 2 * Math.PI / count, r = p.kind === 'star' && i % 2 ? p.innerRadius : 1;
  points.push(Math.round(Math.cos(angle) * rx * r * 1e4) / 1e4, Math.round(Math.sin(angle) * ry * r * 1e4) / 1e4);
 }
 return points;
}

/** One drawing routine for the editor and the exported player. */
export function drawShape(p: Shape, g = new Graphics()): Graphics {
 g.clear();
 if (p.kind === 'line') return g.moveTo(-p.width / 2, -p.height / 2).lineTo(p.width / 2, p.height / 2).stroke({color: p.color, width: Math.max(1, p.strokeWidth), cap: 'round'});
 if (p.kind === 'rect') g.roundRect(-p.width / 2, -p.height / 2, p.width, p.height, p.rounded);
 else if (p.kind === 'ellipse') g.ellipse(0, 0, p.width / 2, p.height / 2);
 else g.poly(shapePoints(p));
 g.fill(p.color);
 if (p.strokeWidth > 0) g.stroke({color: p.strokeColor, width: p.strokeWidth, join: 'round'});
 return g;
}
