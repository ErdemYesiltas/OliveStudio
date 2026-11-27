import { useEffect, useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { SpineAttachment } from '@olivestudio/engine/spine-format';
import { IconButton } from './chrome';
import { t } from './i18n';
import { SpineNumber } from './SpineNumber';

export const spineShapes = ['point', 'boundingbox', 'clipping', 'path'] as const;
export type SpineShape = typeof spineShapes[number];

export function createSpineShape(type: SpineShape): SpineAttachment {
  switch (type) {
    case 'point': return { type, x: 0, y: 0, rotation: 0 };
    case 'path': return { type, closed: false, constantSpeed: true, vertexCount: 6,
      vertices: [-50, 0, -40, 0, -40 / 3, 0, 40 / 3, 0, 40, 0, 50, 0], lengths: [80, 160] };
    default: return { type, vertexCount: 4, vertices: [-32, -32, 32, -32, 32, 32, -32, 32] };
  }
}

export function SpineShapeFields({ attachment, type, slots, disabled, deformKeyed, change }: {
  attachment: SpineAttachment; type: SpineShape; slots: string[]; disabled: boolean; deformKeyed: boolean; change: (value: SpineAttachment) => void;
}) {
  const [vertex, selectVertex] = useState(0);
  if (type === 'point') return <>
    {(['x', 'y', 'rotation'] as const).map(field => <SpineNumber key={field} label={t(`spineAttachment_${field}`)}
      value={Number(attachment[field] ?? 0)} disabled={disabled} change={value => change({ ...attachment, [field]: value })} />)}
  </>;
  const { vertices, vertexCount } = attachment;
  const count = typeof vertexCount === 'number' && Number.isInteger(vertexCount) && vertexCount >= 3 ? vertexCount : 0;
  if (!Array.isArray(vertices) || !count || vertices.length !== count * 2 || !vertices.every(Number.isFinite)) {
    return <small>{t('spineWeightedShapeJson')}</small>;
  }
  if (type === 'path' && (count < 6 || count % 3)) return <small role="alert">{t('spinePathVerticesInvalid')}</small>;
  const active = Math.min(vertex, count - 1);
  return <>
    <ShapeCanvas vertices={vertices} active={active} path={type === 'path'} closed={attachment.closed === true} select={selectVertex} />
    <label>{t('spineVertex')}<select value={active} disabled={disabled} onChange={event => selectVertex(Number(event.currentTarget.value))}>
      {Array.from({ length: count }, (_, i) => <option key={i} value={i}>{i + 1}</option>)}
    </select></label>
    {(['x', 'y'] as const).map((axis, i) => <SpineNumber key={axis} label={t(`spineKey_${axis}`)}
      value={vertices[active * 2 + i]} disabled={disabled} change={value => change({ ...attachment,
        vertices: vertices.map((previous, index) => index === active * 2 + i ? value : previous) })} />)}
    {type !== 'path' && !deformKeyed && <div className="spine-studio-add">
      <IconButton icon={Plus} label={t('spineInsertVertex')} disabled={disabled} onClick={() => {
        const next = (active + 1) % count;
        const point = [0, 1].map(axis => (vertices[active * 2 + axis] + vertices[next * 2 + axis]) / 2);
        change({ ...attachment, vertexCount: count + 1, vertices: [
          ...vertices.slice(0, active * 2 + 2), ...point, ...vertices.slice(active * 2 + 2),
        ] });
        selectVertex(active + 1);
      }} />
      <IconButton icon={Trash2} label={t('spineRemoveVertex')} disabled={disabled || count < 4} onClick={() => {
        change({ ...attachment, vertexCount: count - 1, vertices: vertices.filter((_, index) => Math.floor(index / 2) !== active) });
      }} />
    </div>}
    {type === 'clipping' && <label>{t('spineClipEndSlot')}<select value={String(attachment.end ?? '')} disabled={disabled} onChange={event => {
      const { end: _end, ...rest } = attachment;
      const end = event.currentTarget.value;
      change(end ? { ...rest, end } : rest);
    }}>
      <option value="">—</option>{slots.map(slot => <option key={slot}>{slot}</option>)}
    </select></label>}
    {type === 'path' && <>
      <label>{t('spinePathClosed')}<input type="checkbox" disabled={disabled} checked={attachment.closed === true}
        onChange={event => change({ ...attachment, closed: event.currentTarget.checked })} /></label>
      <label>{t('spinePathConstantSpeed')}<input type="checkbox" disabled={disabled} checked={attachment.constantSpeed !== false}
        onChange={event => {
          const lengths = Array.isArray(attachment.lengths) ? attachment.lengths : [];
          const complete = Array.from({ length: count / 3 }, (_, index) => Number.isFinite(lengths[index])
            ? Math.max(0.01, lengths[index]) : (index + 1) * 80);
          for (let index = 1; index < complete.length; index++) complete[index] = Math.max(complete[index], complete[index - 1] + 0.01);
          change({ ...attachment, constantSpeed: event.currentTarget.checked, lengths: complete });
        }} /></label>
      {attachment.constantSpeed === false && Array.isArray(attachment.lengths) && attachment.lengths.map((value, index, lengths) =>
        <SpineNumber key={index} label={t('spinePathLength', { index: index + 1 })} value={value} disabled={disabled}
          min={index ? lengths[index - 1] + 0.001 : 0.001} max={index + 1 < lengths.length ? lengths[index + 1] - 0.001 : undefined}
          change={value => change({ ...attachment, lengths: lengths.map((length, i) => i === index ? value : length) })} />)}
    </>}
  </>;
}

function ShapeCanvas({ vertices, active, path, closed, select }: {
  vertices: number[]; active: number; path: boolean; closed: boolean; select: (index: number) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const width = 200, height = 148;
  const xs = vertices.filter((_, index) => index % 2 === 0), ys = vertices.filter((_, index) => index % 2 === 1);
  const left = Math.min(...xs), bottom = Math.min(...ys), right = Math.max(...xs), top = Math.max(...ys);
  const scale = Math.min((width - 32) / Math.max(1, right - left), (height - 32) / Math.max(1, top - bottom));
  const points = xs.map((x, i) => ({ x: width / 2 + (x - (left + right) / 2) * scale, y: height / 2 - (ys[i] - (bottom + top) / 2) * scale }));
  useEffect(() => {
    if (!canvas.current) return;
    const ctx = canvas.current.getContext('2d');
    if (!ctx) return;
    const style = getComputedStyle(canvas.current);
    ctx.clearRect(0, 0, width, height);
    ctx.strokeStyle = style.getPropertyValue('--muted');
    ctx.beginPath();
    points.forEach(({ x, y }, index) => index ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    if (!path || closed) ctx.closePath();
    ctx.stroke();
    if (path) {
      const controls = closed ? [...points.slice(1), points[0], points[1]] : points.slice(1, -1);
      ctx.strokeStyle = style.getPropertyValue('--accent');
      ctx.beginPath(); ctx.moveTo(controls[0].x, controls[0].y);
      for (let i = 1; i + 2 < controls.length; i += 3) {
        const [a, b, c] = controls.slice(i, i + 3);
        ctx.bezierCurveTo(a.x, a.y, b.x, b.y, c.x, c.y);
      }
      ctx.stroke();
    }
    points.forEach(({ x, y }, index) => {
      ctx.fillStyle = style.getPropertyValue(index === active ? '--accent' : '--text');
      ctx.beginPath(); ctx.arc(x, y, index === active ? 5 : 3, 0, Math.PI * 2); ctx.fill();
    });
  });
  return <canvas className="spine-uv-canvas" aria-label={t('spineShapeCanvas')} ref={canvas} width={width} height={height} onClick={event => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - bounds.left) * width / bounds.width, y = (event.clientY - bounds.top) * height / bounds.height;
    let nearest = -1, distance = 10;
    for (const [index, point] of points.entries()) {
      const gap = Math.hypot(x - point.x, y - point.y);
      if (gap < distance) { nearest = index; distance = gap; }
    }
    if (nearest >= 0) select(nearest);
  }} />;
}
