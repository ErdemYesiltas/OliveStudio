import { useRef, useState, type PointerEvent } from 'react';
import { t } from './i18n';
import { timelineLimits, tweenValue, type TweenKey, type TweenTrack } from './timeline';

const framesPerSecond = 60;
const width = 460;
const height = 130;
const inset = 15;

export function TimelineCurve({ track, duration, time, editable, seek, update }: {
  track: TweenTrack; duration: number; time: number; editable: boolean;
  seek: (time: number) => void; update: (id: string, patch: Partial<TweenKey>) => void;
}) {
  const [draft, setDraft] = useState<TweenKey>();
  const graph = useRef<SVGSVGElement>(null);
  const drag = useRef<{ key: TweenKey; min: number; max: number; x: number; y: number }>(null);
  const low = Math.min(...track.keys.map(key => key.value));
  const high = Math.max(...track.keys.map(key => key.value));
  const domain = drag.current ?? { min: low - Math.max(1, (high - low) * 0.12), max: high + Math.max(1, (high - low) * 0.12) };
  const keys = track.keys.map(key => draft?.id === key.id ? draft : key).sort((a, b) => a.time - b.time);
  const sample = { ...track, keys };
  const x = (time: number) => inset + (width - 2 * inset) * time / duration;
  const y = (value: number) => height - inset - (height - 2 * inset) * (value - domain.min) / (domain.max - domain.min);
  const points = [...new Set([...keys.map(key => key.time), ...Array.from({ length: 91 }, (_, i) => duration * i / 90)])]
    .sort((a, b) => a - b).map(time => `${x(time)},${y(tweenValue(sample, time, keys[0].value))}`).join(' ');

  function adjust(event: PointerEvent<SVGSVGElement>): TweenKey | undefined {
    const bounds = graph.current?.getBoundingClientRect(), current = drag.current;
    if (!bounds || !current || !bounds.width || !bounds.height ||
        Math.hypot(event.clientX - current.x, event.clientY - current.y) < 2) return;
    const fx = ((event.clientX - bounds.left) / bounds.width * width - inset) / (width - inset * 2);
    const fy = (height - inset - (event.clientY - bounds.top) / bounds.height * height) / (height - inset * 2);
    const snap = event.shiftKey ? framesPerSecond : 100;
    const rawTime = Math.max(0, Math.min(duration, fx * duration));
    const nextTime = Math.min(timelineLimits.time, Math.round(rawTime * snap) / snap);
    const time = event.altKey || keys.some(key => key.id !== current.key.id && Math.abs(key.time - nextTime) < 1e-8) ?
      current.key.time : nextTime;
    const rawValue = Math.round((domain.min + fy * (domain.max - domain.min)) * 100) / 100;
    const value = track.property === 'alpha' ? Math.min(1, Math.max(0, rawValue)) : rawValue;
    return { ...current.key, time, value };
  }

  return <svg ref={graph} className="timeline-curve" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none"
    role="img" aria-label={t('timelineCurve')} aria-description={t('timelineCurveHint')}
    onPointerMove={event => { const next = adjust(event); if (next) setDraft(next); }}
    onPointerUp={event => {
      const next = adjust(event);
      const original = drag.current?.key;
      drag.current = null;
      setDraft(undefined);
      if (next && original && (next.time !== original.time || next.value !== original.value)) update(next.id, next);
    }}
    onLostPointerCapture={() => { drag.current = null; setDraft(undefined); }}>
    <rect x={inset} y={inset} width={width - 2 * inset} height={height - 2 * inset} className="curve-background" />
    <path d={`M${x(time)},${inset} V${height - inset}`} className="curve-playhead" />
    <polyline points={points} className="curve-line" />
    {keys.map((key, i) => <circle key={key.id} cx={x(key.time)} cy={y(key.value)} r={5} className="curve-key"
      data-key={i + 1}
      onPointerDown={event => {
        if (!editable || event.button !== 0) return;
        event.preventDefault();
        drag.current = { key, min: domain.min, max: domain.max, x: event.clientX, y: event.clientY };
        graph.current?.setPointerCapture(event.pointerId);
      }}
      onDoubleClick={() => seek(key.time)}>
      <title>{t('timelineKeyLabel', { field: t('timelineKeyValue'), index: i + 1 })}</title>
    </circle>)}
  </svg>;
}
