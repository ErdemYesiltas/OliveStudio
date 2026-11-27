import { t } from './i18n';
import { SpineNumber } from './SpineNumber';

export function spineColorValue(value: string, alpha?: boolean) {
  const digits = value.replace(/^#/, '').toLowerCase();
  if (!/^[0-9a-f]{6}(?:[0-9a-f]{2})?$/.test(digits)) return alpha ? 'ffffffff' : 'ffffff';
  return alpha ? digits.padEnd(8, 'f') : digits.slice(0, 6);
}

export function SpineColorFields({ label, value, alpha, alphaLabel = t('spineTimeline_alpha'), disabled, change }: {
  label: string; value: string; alpha?: boolean; alphaLabel?: string; disabled?: boolean; change: (color: string) => void;
}) {
  const color = spineColorValue(value, alpha);
  return <>
    <label>{label}<input type="color" value={`#${color.slice(0, 6)}`} disabled={disabled}
      onChange={event => change(event.currentTarget.value.slice(1) + color.slice(6))} /></label>
    {alpha && <SpineNumber label={alphaLabel} min={0} max={255} step={1} value={parseInt(color.slice(6), 16)}
      disabled={disabled} change={value => change(color.slice(0, 6) + value.toString(16).padStart(2, '0'))} />}
  </>;
}
