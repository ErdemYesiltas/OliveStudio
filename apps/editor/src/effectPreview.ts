export type EffectPreview =
  | { type: 'shake'; id: string; amplitude: number; duration: number; rotation: number }
  | { type: 'zoom'; id: string; zoom: number; min: number; max: number; duration: number }
  | { type: 'lightPulse'; id: string; amount: number; frequency: number; duration: number };

export function alternateTestZoom(current: number, min: number, max: number) {
  const inwards = Math.min(max, Number((current * 1.5).toPrecision(6)));
  const outwards = Math.max(min, Number((current / 1.5).toPrecision(6)));
  return inwards / current >= current / outwards ? inwards : outwards;
}
