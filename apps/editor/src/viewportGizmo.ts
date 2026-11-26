import type { Graphics } from 'pixi.js';

export type Tool = 'select' | 'move' | 'rotate' | 'scale' | 'skew';
export type GizmoAxis = 'x' | 'y' | 'xy';
type Point = { x: number; y: number };
export type GizmoHandle = { point: Point; axis: GizmoAxis };
export const toolColors: Record<Tool, string> = {
  select: '#59b7ff', move: '#70caff', rotate: '#ffbf68', scale: '#82ddb0', skew: '#dc9bff',
};

const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
function offset(from: Point, toward: Point, distance: number): Point {
  const dx = toward.x - from.x, dy = toward.y - from.y;
  const length = Math.hypot(dx, dy);
  return length ? { x: from.x + dx / length * distance, y: from.y + dy / length * distance } : from;
}
const line = (g: Graphics, from: Point, to: Point) => g.moveTo(from.x, from.y).lineTo(to.x, to.y);

export function drawOriginMarkers(g: Graphics, pivot: Point, unit: number, color: string, anchor?: Point) {
  const background = '#171c25';
  if (anchor) {
    const { x, y } = anchor;
    const radius = 12 * unit;
    const diamond = [x, y - radius, x + radius, y, x, y + radius, x - radius, y];
    g.poly(diamond, true).stroke({ color: background, width: 4 * unit });
    g.poly(diamond, true).stroke({ color: '#f2f6ff', width: 1.5 * unit });
  }
  const { x, y } = pivot;
  g.circle(x, y, 6.5 * unit).fill(background)
    .circle(x, y, 5 * unit).stroke({ color, width: 1.75 * unit })
    .circle(x, y, 1.75 * unit).fill(color);
}

export function drawGizmo(g: Graphics, tool: Tool, corners: [Point, Point, Point, Point], pivot: Point,
  axes: [Point, Point], unit: number): GizmoHandle[] {
  const [tl, tr, br] = corners;
  const color = toolColors[tool];
  const stroke = { color, width: (tool === 'select' ? 1.5 : 2) * unit };
  g.poly(corners.flatMap(point => [point.x, point.y]), true).stroke(stroke);
  if (tool === 'select') return [];

  if (tool === 'move') {
    const handles: GizmoHandle[] = [{ point: pivot, axis: 'xy' }];
    axes.forEach((direction, index) => {
      const target = offset(pivot, direction, 34 * unit);
      const stem = offset(target, pivot, 8 * unit);
      const normal = { x: (target.y - stem.y) * 0.52, y: (stem.x - target.x) * 0.52 };
      const axisColor = index === 0 ? '#ff8a88' : '#86e5ba';
      line(g, pivot, target).stroke({ color: axisColor, width: stroke.width });
      g.poly([target.x, target.y, stem.x + normal.x, stem.y + normal.y, stem.x - normal.x, stem.y - normal.y], true)
        .fill(axisColor);
      handles.push({ point: target, axis: index === 0 ? 'x' : 'y' });
    });
    return handles;
  }

  if (tool === 'scale') {
    for (const point of corners) {
      g.rect(point.x - 4 * unit, point.y - 4 * unit, 8 * unit, 8 * unit).fill(color);
    }
    return corners.map(point => ({ point, axis: 'xy' }));
  }

  const center = midpoint(tl, br);
  const top = midpoint(tl, tr);
  const topHandle = offset(center, top, Math.hypot(top.x - center.x, top.y - center.y) + 19 * unit);
  line(g, top, topHandle).stroke(stroke);
  if (tool === 'rotate') {
    const radius = 7 * unit;
    const { x, y } = topHandle;
    const start = 0.1 * Math.PI;
    g.circle(x, y, radius).fill('#171c25');
    g.moveTo(x + radius * Math.cos(start), y + radius * Math.sin(start))
      .arc(x, y, radius, start, 1.8 * Math.PI).stroke(stroke);
    g.poly([x + radius, y - radius * 0.48, x + radius * 0.24, y - radius * 0.45, x + radius * 0.85, y - radius * 1.02], true)
      .fill(color);
    return [{ point: topHandle, axis: 'xy' }];
  }

  const right = midpoint(tr, br);
  const rightHandle = offset(center, right, Math.hypot(right.x - center.x, right.y - center.y) + 15 * unit);
  line(g, right, rightHandle).stroke(stroke);
  for (const { x, y } of [topHandle, rightHandle]) {
    g.poly([x - 3 * unit, y - 4 * unit, x + 6 * unit, y - 4 * unit,
      x + 3 * unit, y + 4 * unit, x - 6 * unit, y + 4 * unit], true).fill(color);
  }
  return [{ point: topHandle, axis: 'x' }, { point: rightHandle, axis: 'y' }];
}
