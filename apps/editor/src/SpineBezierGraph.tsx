import { useEffect, useState, type PointerEvent } from 'react';
import { t } from './i18n';

const width = 280, height = 124, inset = 14;
type Point = { x: number; y: number };
type Range = { low: number; high: number };
type Drag = { pointer: number; handle: 0 | 2; values: number[]; range: Range; origin: Point; grip: Point };

export function SpineBezierGraph({ start, end, from, to, values, disabled, change }: {
  start: number; end: number; from: number; to: number; values: number[]; disabled?: boolean; change: (points: number[]) => void;
}) {
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const [drag, setDrag] = useState<Drag>();
  const lower = Math.min(from, to, values[1], values[3]);
  const upper = Math.max(from, to, values[1], values[3]);
  const padding = (upper - lower || 1) * 0.15;
  const range = drag?.range ?? { low: lower - padding, high: upper + padding };
  const points = drag?.values ?? values;
  const project = (time: number, value: number): Point => ({
    x: inset + (time - start) / (end - start) * (width - 2 * inset),
    y: height - inset - (value - range.low) / (range.high - range.low) * (height - 2 * inset),
  });
  const [first, second] = [project(points[0], points[1]), project(points[2], points[3])];

  useEffect(() => {
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const style = getComputedStyle(canvas);
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.strokeStyle = style.getPropertyValue('--line');
    ctx.strokeRect(inset, inset, width - 2 * inset, height - 2 * inset);
    ctx.beginPath();
    for (let division = 1; division < 4; division++) {
      const x = inset + division * (width - 2 * inset) / 4;
      const y = inset + division * (height - 2 * inset) / 4;
      ctx.moveTo(x, inset); ctx.lineTo(x, height - inset);
      ctx.moveTo(inset, y); ctx.lineTo(width - inset, y);
    }
    ctx.stroke();

    const left = project(start, from), right = project(end, to);
    ctx.strokeStyle = style.getPropertyValue('--muted');
    ctx.beginPath();
    ctx.moveTo(left.x, left.y); ctx.lineTo(first.x, first.y);
    ctx.moveTo(right.x, right.y); ctx.lineTo(second.x, second.y);
    ctx.stroke();
    ctx.strokeStyle = style.getPropertyValue('--accent');
    ctx.beginPath();
    ctx.moveTo(left.x, left.y);
    ctx.bezierCurveTo(first.x, first.y, second.x, second.y, right.x, right.y);
    ctx.stroke();
    ctx.fillStyle = ctx.strokeStyle;
    [first, second].forEach(({ x, y }) => {
      ctx.beginPath(); ctx.arc(x, y, 4.5, 0, 2 * Math.PI); ctx.fill();
    });
  });

  const locate = (event: PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * width / rect.width, y: (event.clientY - rect.top) * height / rect.height };
  };
  const move = (drag: Drag, { x, y }: Point) => {
    const horizontal = Math.max(0, Math.min(1, (x + drag.grip.x - inset) / (width - 2 * inset)));
    const vertical = Math.max(0, Math.min(1, (height - inset - y - drag.grip.y) / (height - 2 * inset)));
    const points = [...drag.values];
    points[drag.handle] = start + horizontal * (end - start);
    points[drag.handle + 1] = drag.range.low + vertical * (drag.range.high - drag.range.low);
    return points;
  };

  return <canvas ref={setCanvas} className="spine-bezier-graph" aria-label={t('spineBezierGraph')}
    width={width * 2} height={height * 2} onPointerDown={event => {
      if (disabled || drag || event.button !== 0) return;
      const position = locate(event);
      const firstDistance = Math.hypot(first.x - position.x, first.y - position.y);
      const secondDistance = Math.hypot(second.x - position.x, second.y - position.y);
      if (Math.min(firstDistance, secondDistance) > 10) return;
      const handle = firstDistance <= secondDistance ? 0 : 2;
      const selected = handle === 0 ? first : second;
      setDrag({ pointer: event.pointerId, handle, values, range, origin: position,
        grip: { x: selected.x - position.x, y: selected.y - position.y } });
      event.currentTarget.setPointerCapture(event.pointerId);
    }} onPointerMove={event => {
      if (drag?.pointer === event.pointerId && !disabled) setDrag({ ...drag, values: move(drag, locate(event)) });
    }} onPointerUp={event => {
      if (drag?.pointer !== event.pointerId) return;
      setDrag(undefined);
      const position = locate(event);
      if (!disabled && Math.hypot(position.x - drag.origin.x, position.y - drag.origin.y) > 1) {
        const moved = move(drag, position);
        if (moved.some((point, index) => point !== values[index])) change(moved);
      }
    }} onPointerCancel={() => setDrag(undefined)} onLostPointerCapture={() => setDrag(undefined)} />;
}
