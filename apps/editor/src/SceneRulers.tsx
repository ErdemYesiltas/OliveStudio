import { useEffect, useState, type RefObject } from 'react';
import { rulerStep } from '@rewrite/render-pixi/badges';
import { locale, t } from './i18n';
import type { SceneView } from './runtime';

type Measure = { origin: number; scale: number; length: number };
const band = 19;
const label = new Intl.NumberFormat(locale, { maximumFractionDigits: 3, useGrouping: false });

function ticks({ origin, scale, length }: Measure) {
  if (!(scale > 0)) return [];
  const major = rulerStep(scale, 58);
  const count = major * scale / 5 >= 6 ? 5 : 2;
  const step = major / count;
  const first = Math.ceil((band - origin) / (step * scale));
  const last = Math.floor((length - origin) / (step * scale));
  const visible = [];
  for (let i = first; i <= last && visible.length < 512; i++) {
    visible.push({ offset: origin + i * step * scale, text: i % count === 0 ? label.format(i * step) : undefined });
  }
  return visible;
}

export function SceneRulers({ viewport, view, version }: {
  viewport: RefObject<HTMLDivElement | null>; view: RefObject<SceneView | null>; version: number;
}) {
  const [measures, setMeasures] = useState<{ x: Measure; y: Measure }>();
  useEffect(() => {
    const host = viewport.current?.parentElement;
    const app = view.current?.app;
    if (!host || !app) return;
    const update = () => {
      if (view.current?.app !== app || !app.renderer) return;
      const area = host.getBoundingClientRect();
      const canvas = app.canvas.getBoundingClientRect();
      setMeasures({
        x: { origin: canvas.left - area.left, scale: canvas.width / app.screen.width, length: area.width },
        y: { origin: canvas.top - area.top, scale: canvas.height / app.screen.height, length: area.height },
      });
    };
    const observer = new ResizeObserver(update);
    const canvas = app.canvas;
    const attributes = new MutationObserver(update);
    observer.observe(host);
    observer.observe(canvas);
    attributes.observe(canvas, { attributes: true, attributeFilter: ['width', 'height', 'style'] });
    update();
    return () => { observer.disconnect(); attributes.disconnect(); };
  }, [version, view, viewport]);

  return <div className="scene-rulers" role="img" aria-label={t('sceneRulers')}>
    <div className="ruler-corner" aria-hidden="true" />
    {measures && (['x', 'y'] as const).map(axis => <div key={axis} data-axis={axis} className="scene-ruler" aria-hidden="true">
      {ticks(measures[axis]).map(({ offset, text }) => <span key={offset} data-major={text !== undefined}
        style={axis === 'x' ? { left: offset } : { top: offset }}>{text !== undefined && <small>{text}</small>}</span>)}
    </div>)}
  </div>;
}
