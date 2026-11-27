import { useState } from 'react';
import { t } from './i18n';
import { SpineBezierGraph } from './SpineBezierGraph';
import { SpineNumber } from './SpineNumber';

const pointLabels = ['spineBezierTime1', 'spineBezierValue1', 'spineBezierTime2', 'spineBezierValue2'] as const;

export type SpineCurveComponent = { label: string; from: number; to: number };

export function SpineCurveFields({ curve, start, end, components, disabled, change }: {
  curve?: number[] | 'stepped' | null; start: number; end?: number; components: SpineCurveComponent[];
  disabled?: boolean; change: (curve: number[] | 'stepped' | undefined) => void;
}) {
  const [graphChannel, setGraphChannel] = useState(0);
  const bezier = Array.isArray(curve) ? curve : undefined;
  const active = end !== undefined && end > start && components.length > 0;
  const duration = (end ?? start) - start;
  const defaults = active ? components.flatMap(({ from, to }) => [
    start + duration / 3, from + (to - from) / 3, start + 2 * duration / 3, from + 2 * (to - from) / 3,
  ]) : [];
  const graphIndex = Math.min(graphChannel, components.length - 1);
  const graph = components[graphIndex];
  const points = bezier && defaults.map((point, i) => bezier[i] ?? point);
  const changePoints = (start: number, updated: number[]) => {
    if (points) change([...points.slice(0, start), ...updated, ...points.slice(start + updated.length)]);
  };
  return <>
    <label>{t('spineInterpolation')}<select value={bezier ? 'bezier' : curve === 'stepped' ? 'stepped' : 'linear'}
      disabled={disabled} onChange={event => {
        const mode = event.currentTarget.value;
        change(mode === 'bezier' ? defaults : mode === 'stepped' ? 'stepped' : undefined);
      }}>
      <option value="linear">{t('spineLinear')}</option>
      <option value="stepped">{t('spineStepped')}</option>
      <option value="bezier" disabled={!active}>{t('spineBezier')}</option>
    </select></label>
    {active && points && graph && end !== undefined && <>
      {components.length > 1 && <label>{t('spineBezierChannel')}<select value={graphIndex} disabled={disabled}
        onChange={event => setGraphChannel(Number(event.currentTarget.value))}>
        {components.map(({ label }, i) => <option key={label} value={i}>{label}</option>)}
      </select></label>}
      <SpineBezierGraph key={graph.label} start={start} end={end} from={graph.from} to={graph.to} disabled={disabled}
        values={points.slice(graphIndex * 4, graphIndex * 4 + 4)} change={updated => changePoints(graphIndex * 4, updated)} />
    </>}
    {active && bezier && components.map(({ label }, index) => <fieldset className="spine-key" key={label} disabled={disabled}>
      <legend>{components.length === 1 ? t('spineBezier') : t('spineBezierAxis', { axis: label })}</legend>
      {pointLabels.map((pointLabel, pointIndex) => {
        const slot = index * 4 + pointIndex;
        const isTime = pointIndex % 2 === 0;
        return <SpineNumber key={pointLabel} label={t(pointLabel)} value={bezier[slot] ?? defaults[slot]}
          min={isTime ? start : undefined} max={isTime ? end : undefined} change={value => changePoints(slot, [value])} />;
      })}
    </fieldset>)}
  </>;
}
