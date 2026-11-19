/** Smart guides: snap a moving box's edges/centre to other boxes' edges/centres and the stage frame. */
export interface GuideBox {x: number; y: number; width: number; height: number}
export interface GuideLine {axis: 'x' | 'y'; value: number}
export interface GuideTargets {x: number[]; y: number[]}

const lines = (b: GuideBox) => ({x: [b.x, b.x + b.width / 2, b.x + b.width], y: [b.y, b.y + b.height / 2, b.y + b.height]});
/** Candidate lines from other boxes and the stage (edges and centres), deduplicated. */
export function guideTargets(boxes: readonly GuideBox[], stage?: {width: number; height: number}): GuideTargets {
 const xs = new Set<number>(), ys = new Set<number>();
 for (const b of [...boxes, ...(stage ? [{x: 0, y: 0, ...stage}] : [])]) { const l = lines(b); l.x.forEach(v => xs.add(Math.round(v * 1000) / 1000)); l.y.forEach(v => ys.add(Math.round(v * 1000) / 1000)); }
 return {x: [...xs], y: [...ys]};
}
/**
 * Smallest correction (per axis, within `threshold`) that aligns one of the moving box's lines with a target, plus
 * the guides to draw. Ties prefer the centre line.
 */
export function snapToGuides(moving: GuideBox, targets: GuideTargets, threshold: number): {dx: number; dy: number; guides: GuideLine[]} {
 const own = lines(moving), guides: GuideLine[] = [];
 const best = (axis: 'x' | 'y') => {
  let delta = 0, distance = threshold + 1e-9, value: number | undefined;
  for (const [i, line] of own[axis].entries()) for (const target of targets[axis]) {
   const d = Math.abs(target - line), centre = i === 1;
   if (d < distance - 1e-9 || (Math.abs(d - distance) <= 1e-9 && centre)) { distance = d; delta = target - line; value = target; }
  }
  if (value !== undefined) guides.push({axis, value});
  return delta;
 };
 const dx = best('x'), dy = best('y');
 return {dx, dy, guides};
}
