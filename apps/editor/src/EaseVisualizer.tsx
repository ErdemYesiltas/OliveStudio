import { useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Check, Play, Square } from 'lucide-react';
import { cameraEaseProgress, cameraEases, easeParameters, formatCameraEase, parseCameraEase,
  type CameraEase } from '@olivestudio/engine/runtime-camera';
import { IconButton, PreviewMode } from './chrome';
import { t } from './i18n';

type EditorProps = { value: CameraEase; change: (value: CameraEase) => void };
const parameterLabels = {
  overshoot: 'cameraEaseOvershoot', amplitude: 'cameraEaseAmplitude', period: 'cameraEasePeriod',
  steps: 'cameraEaseSteps', x1: 'cameraEaseX1', y1: 'cameraEaseY1', x2: 'cameraEaseX2', y2: 'cameraEaseY2',
} as const;

function EasePreset({ value, change, label }: EditorProps & { label: string }) {
  return <select aria-label={label} value={parseCameraEase(value)?.choice} onChange={event => {
    const choice = cameraEases.find(value => value === event.currentTarget.value);
    if (choice) change(formatCameraEase(choice));
  }}>
    {cameraEases.map(ease => <option key={ease} value={ease}>{ease === 'none' ? t('cameraEaseLinear') :
      ease === 'cubic-bezier' ? t('cameraEaseCustom') : ease}</option>)}
  </select>;
}

function EaseParameters({ value, change, commitExpression = change }: EditorProps & { commitExpression?: EditorProps['change'] }) {
  const [invalid, setInvalid] = useState(false);
  const parsed = parseCameraEase(value);
  if (!parsed) return null;
  const { choice, parameters } = parsed;
  const update = (input: HTMLInputElement) => {
    const next = parseCameraEase(input.value);
    setInvalid(!next);
    input.setCustomValidity(next ? '' : t('cameraEaseInvalid'));
    if (next) commitExpression(next.ease);
  };
  return <>
    <label className="ease-expression">
      <span>{t('cameraEaseExpression')}</span>
      <input defaultValue={value} spellCheck={false} maxLength={160} aria-invalid={invalid || undefined}
        onChange={event => {
          const valid = !!parseCameraEase(event.currentTarget.value);
          event.currentTarget.setCustomValidity(valid ? '' : t('cameraEaseInvalid'));
          if (valid) setInvalid(false);
        }}
        onBlur={event => update(event.currentTarget)}
        onKeyDown={event => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          update(event.currentTarget);
        }} />
    </label>
    {invalid && <span role="status" className="error">{t('cameraEaseInvalid')}</span>}
    {parameters.length > 0 && <div className="ease-parameters">
      {easeParameters(choice).map((field, index) => <label key={field.name}>
        <span>{t(parameterLabels[field.name])}</span>
        <input type="number" defaultValue={parameters[index]} min={field.min} max={field.max}
          step={'integer' in field ? 1 : 'any'} onBlur={event => {
            const input = event.currentTarget;
            if (!input.validity.valid || input.value === '') { input.value = String(parameters[index]); return; }
            if (input.valueAsNumber !== parameters[index]) {
              change(formatCameraEase(choice, parameters.map((value, i) => i === index ? input.valueAsNumber : value)));
            }
          }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } }} />
      </label>)}
    </div>}
  </>;
}

export function EaseEditor({ value, change, visualizer }: EditorProps & { visualizer?: boolean }) {
  return <div className="ease-visualizer">
    <div className="ease-toolbar"><span>{t('cameraEase')}</span>
      <EasePreset label={t('cameraEase')} value={value} change={change} />
    </div>
    <EaseParameters key={value} value={value} change={change} />
    {visualizer && <details className="ease-graph">
      <summary>{t('cameraEaseVisualizer')}</summary>
      <EaseVisualizer key={value} ease={value} apply={change} />
    </details>}
  </div>;
}

function sampleEase(ease: CameraEase, progress: number, distribution: boolean) {
  const value = cameraEaseProgress(ease, progress);
  return distribution ? Math.max(0, Math.min(1, value)) : value;
}

export function EaseVisualizer({ ease: initial, apply, distribution = false }: {
  ease: CameraEase; apply?: (ease: CameraEase) => void; distribution?: boolean;
}) {
  const title = useId();
  const [ease, setEase] = useState(initial);
  const [progress, setProgress] = useState(0);
  const [playing, setPlaying] = useState(false);
  const mode = useContext(PreviewMode);
  useLayoutEffect(() => { setPlaying(false); }, [mode]);
  useLayoutEffect(() => { setEase(initial); setPlaying(false); }, [initial]);
  const samples = useMemo(() => Array.from({ length: 121 }, (_, index) => sampleEase(ease, index / 120, distribution)), [ease, distribution]);
  const graphLabel = t(distribution ? 'cameraDepthDistribution' : 'cameraEaseVisualizer');
  const progressLabel = t(distribution ? 'cameraLayerDepth' : 'cameraEaseProgress');
  const valueLabel = t(distribution ? 'cameraDepthWeight' : 'cameraEaseValue');
  const drag = useRef<{ handle: number; pointer: number } | null>(null);
  const parsed = parseCameraEase(ease);
  const handles = parsed?.choice === 'cubic-bezier' ? parsed.parameters : undefined;
  const low = handles ? -1 : Math.min(0, ...samples), high = handles ? 2 : Math.max(1, ...samples);
  const change = (value: CameraEase) => { setPlaying(false); setEase(value); };
  const commit = (value: CameraEase) => {
    change(value);
    if (distribution) apply?.(value);
  };
  const x = (value: number) => 10 + value * 180;
  const y = (value: number) => 100 - (value - low) / (high - low) * 90;
  const value = sampleEase(ease, progress, distribution);

  useEffect(() => {
    if (!playing) return;
    let frame: number;
    let start: number | undefined;
    const tick = (now: number) => {
      start ??= now;
      const next = Math.min(1, (now - start) / 1000);
      setProgress(next);
      if (next < 1) frame = requestAnimationFrame(tick);
      else setPlaying(false);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  return <div className="ease-visualizer">
    <div className="ease-toolbar">
      <span id={title}>{graphLabel}</span>
      <EasePreset label={graphLabel} value={ease} change={commit} />
      <IconButton icon={playing ? Square : Play} label={t(playing ? 'cameraEaseStop' : 'cameraEasePlay')}
        onClick={() => { if (!playing) setProgress(0); setPlaying(!playing); }} />
    </div>
    <EaseParameters key={ease} value={ease} change={change} commitExpression={commit} />
    {!distribution && <input type="hidden" name="ease" value={ease} />}
    <svg viewBox="0 0 200 110" role="img" aria-labelledby={title}
      onPointerMove={event => {
        if (!handles || drag.current?.pointer !== event.pointerId) return;
        const matrix = event.currentTarget.getScreenCTM();
        if (!matrix) return;
        const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
        const clamp = (value: number, min: number, max: number) =>
          Math.round(Math.max(min, Math.min(max, value)) * 1000) / 1000;
        const index = drag.current.handle * 2;
        const next = [...handles];
        next[index] = clamp((point.x - 10) / 180, 0, 1);
        next[index + 1] = clamp(low + (100 - point.y) / 90 * (high - low), low, high);
        change(formatCameraEase('cubic-bezier', next));
      }}
      onLostPointerCapture={() => { drag.current = null; }}>
      {samples.filter((_, index) => index % 12 === 0).map((_, index) => <path className="ease-grid" key={index}
        d={`M${x(index / 10)},6 V104 M6,${y(index / 10)} H194`} />)}
      <path className="ease-guide" d={`M${x(progress)},104 V${y(value)} H6`} />
      <polyline className="ease-curve" points={samples.map((point, index) => `${x(index / 120)},${y(point)}`).join(' ')} />
      <circle className="ease-point" cx={x(progress)} cy={y(value)} r={3} />
      {handles && [0, 1].map(index => {
        const cx = x(handles[index * 2]), cy = y(handles[index * 2 + 1]);
        return <g key={index}>
          <path className="ease-guide" d={`M${x(index)},${y(index)} L${cx},${cy}`} />
          <circle className="ease-handle" cx={cx} cy={cy} r={5} onPointerDown={event => {
            if (event.button !== 0) return;
            const svg = event.currentTarget.ownerSVGElement;
            if (!svg) return;
            event.preventDefault();
            svg.setPointerCapture(event.pointerId);
            drag.current = { handle: index, pointer: event.pointerId };
            setPlaying(false);
          }} />
        </g>;
      })}
    </svg>
    <input type="range" min={0} max={1} step={0.001} value={progress} aria-label={progressLabel}
      onChange={event => { setPlaying(false); setProgress(event.currentTarget.valueAsNumber); }} />
    <div className="ease-values">
      <span>{progressLabel} {Math.round(progress * 100)}%</span>
      <span>{valueLabel} {Math.round(value * 100)}%</span>
      {apply && <IconButton icon={Check} label={t(distribution ? 'cameraDepthApply' : 'cameraEaseApply')}
        disabled={!distribution && ease === initial} onClick={() => apply(ease)} />}
    </div>
  </div>;
}
