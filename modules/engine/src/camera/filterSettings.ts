import { z } from 'zod';
import { CameraEaseSchema } from './easing.js';

type Control = { kind: 'number'; min: number; max: number; initial: number } |
  { kind: 'color' | 'texture'; initial: string };
const number = (min: number, max: number, initial: number): Control => ({ kind: 'number', min, max, initial });
const color = (initial: string): Control => ({ kind: 'color', initial });
const opacity = (initial: number) => number(0, 1, initial);
const center = { centerX: opacity(0.5), centerY: opacity(0.5) };
const radius = number(1, 2400, 300);
const angle = number(-180, 180, 0);
const time = number(0, 10, 1);
export const cameraFilterControls = {
  colorGrade: { brightness: number(0, 3, 1.1), contrast: number(0, 3, 1.15), saturation: number(0, 3, 1.25), gamma: number(0.1, 4, 1) },
  fog: { color: color('#a8b7c8'), opacity: opacity(0.42), contrast: number(0, 1, 0.7), saturation: number(0, 1, 0.55) },
  bloom: { intensity: number(0, 5, 1.4), threshold: opacity(0.55), blur: number(0, 32, 5) },
  glow: { intensity: number(0, 8, 2), radius: number(1, 48, 10), color: color('#ffd27a') },
  dropShadow: { opacity: opacity(0.55), offsetX: number(-80, 80, 6), offsetY: number(-80, 80, 9), blur: number(0, 32, 5), color: color('#000000') },
  outline: { thickness: number(0, 20, 2), opacity: opacity(1), color: color('#fff0b8') },
  heatHaze: { amplitude: number(0, 35, 5), wavelength: number(2, 200, 26), speed: time },
  distortion: { angle: number(-10, 10, 1.5), radius },
  lut: { texture: { kind: 'texture', initial: '' } as const, opacity: opacity(1) },
  gradient: { color: color('#243458'), endColor: color('#e2a56e'), angle: number(-180, 180, 90), opacity: opacity(0.35) },
  crt: { curvature: number(0, 8, 2), thickness: number(0.5, 8, 2), contrast: opacity(0.28), noise: opacity(0.1), vignette: opacity(0.3) },
  oldFilm: { sepia: opacity(0.55), noise: opacity(0.15), scratch: opacity(0.25), vignette: opacity(0.25) },
  rgbSplit: { offsetX: number(-32, 32, 3), offsetY: number(-32, 32, 1) },
  glitch: { amplitude: number(0, 60, 15), slices: number(1, 32, 8), angle, speed: number(0, 12, 6) },
  vignette: { opacity: opacity(0.55), radius: number(0.05, 1.5, 0.5), softness: number(0.01, 1, 0.4) },
  zoomBlur: { strength: opacity(0.22), ...center, innerRadius: number(0, 800, 24) },
  radialBlur: { angle: number(-60, 60, 9), ...center, radius },
  shockwave: { ...center, amplitude: number(0, 100, 24), wavelength: number(1, 500, 140),
    speed: number(1, 1800, 420), duration: number(0.1, 10, 1.2) },
  bulgePinch: { ...center, strength: number(-1, 1, 0.5), radius },
  reflection: { boundary: opacity(0.55), amplitude: number(0, 35, 8), wavelength: number(2, 200, 40),
    opacity: opacity(0.6), speed: time },
  parallax: { amountX: number(-1, 1, 0.55), amountY: number(-1, 1, 0.3) },
} satisfies Record<string, Record<string, Control>>;

export type CameraFilterKind = keyof typeof cameraFilterControls;
export const cameraFilterKinds = Object.keys(cameraFilterControls) as CameraFilterKind[];
const kinds = new Set<string>(cameraFilterKinds);
export const cameraFilterHasDepth = (kind: CameraFilterKind) => !['crt', 'oldFilm', 'vignette', 'shockwave'].includes(kind);
const settings = z.record(z.string(), z.union([z.number(), z.string()]));

function cameraFilter<T extends CameraFilterKind>(type: T) {
  return z.strictObject({
    type: z.literal(type),
    enabled: z.boolean().default(true),
    effectId: z.string().min(1).optional(),
    useDepth: z.boolean().default(type === 'parallax' || type === 'fog'),
    distribution: CameraEaseSchema.default('none'),
    settings: settings.default({}),
  }).superRefine((effect, ctx) => {
    const controls: Record<string, Control> = cameraFilterControls[type];
    for (const [key, value] of Object.entries(effect.settings)) {
      const control = controls[key];
      const valid = Object.hasOwn(controls, key) && (control.kind === 'number' ?
        typeof value === 'number' && value >= control.min && value <= control.max :
        typeof value === 'string' && (control.kind === 'color' ? /^#[0-9a-f]{6}$/i.test(value) : value.length <= 512));
      if (!valid) ctx.addIssue({ code: 'custom', path: ['settings', key], message: 'Invalid camera filter setting' });
    }
  });
}

export const cameraFilterSchemas = cameraFilterKinds.map(cameraFilter);
export type CameraFilterData = z.output<typeof cameraFilterSchemas[number]>;
export function isCameraFilter(effect: {type: string}): effect is CameraFilterData {
  return kinds.has(effect.type);
}

export function cameraFilterValue(effect: CameraFilterData, key: string) {
  const controls: Record<string, Control> = cameraFilterControls[effect.type];
  return effect.settings[key] ?? controls[key]?.initial;
}
