export function SpineNumber({ label, value, min, max, disabled, step = 'any', change }: {
  label: string; value: number; min?: number; max?: number; disabled?: boolean; step?: number | 'any'; change: (value: number) => void;
}) {
  return <label>{label}<input key={value} type="number" step={step} min={min} max={max} defaultValue={value} disabled={disabled}
    onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} onBlur={event => {
      const next = event.currentTarget.valueAsNumber;
      if (!Number.isFinite(next) || !event.currentTarget.checkValidity()) event.currentTarget.value = String(value);
      else if (value !== next) change(next);
    }} /></label>;
}
