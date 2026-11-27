import { gsap } from 'gsap';
import { CustomEase } from 'gsap/dist/CustomEase';
import { z } from 'zod';

const families = ['power1', 'power2', 'power3', 'power4', 'sine', 'expo', 'circ', 'back', 'elastic', 'bounce'] as const;
const directions = ['in', 'out', 'inOut'] as const;
const presets = ['none', ...families.flatMap(family => directions.map(direction => `${family}.${direction}` as const))] as const;
const presetNames = new Set<string>(presets);
export const cameraEases = [...presets, 'steps', 'cubic-bezier'] as const;

type Preset = typeof presets[number];
export type CameraEaseChoice = typeof cameraEases[number];
export type CameraEase = Preset | `${'back' | 'elastic'}.${typeof directions[number]}(${string})`
  | `steps(${string})` | `cubic-bezier(${string})`;
export const defaultCameraEase = 'power2.out' satisfies CameraEase;

const cameraEaseParameters = {
  back: [{ name: 'overshoot', initial: 1.70158, min: -10, max: 10 }],
  elastic: [{ name: 'amplitude', initial: 1, min: 0.01, max: 10 }, { name: 'period', initial: 0.3, min: 0.01, max: 10 }],
  steps: [{ name: 'steps', initial: 5, min: 1, max: 100, integer: true }],
  custom: [
    { name: 'x1', initial: 0.25, min: 0, max: 1 }, { name: 'y1', initial: 0.1, min: -1, max: 2 },
    { name: 'x2', initial: 0.25, min: 0, max: 1 }, { name: 'y2', initial: 1, min: -1, max: 2 },
  ],
} as const;

export function easeParameters(choice: CameraEaseChoice) {
  if (choice === 'cubic-bezier') return cameraEaseParameters.custom;
  if (choice === 'steps') return cameraEaseParameters.steps;
  if (choice.startsWith('back.')) return cameraEaseParameters.back;
  if (choice.startsWith('elastic.')) return cameraEaseParameters.elastic;
  return [];
}

function defaultParameters(choice: CameraEaseChoice) {
  return easeParameters(choice).map(param => param.name === 'period' && choice === 'elastic.inOut' ? 0.45 : param.initial);
}

const numberText = /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;

export function parseCameraEase(input: string): { ease: CameraEase; choice: CameraEaseChoice; parameters: number[] } | undefined {
  if (input.length > 160) return;
  const value = input.trim();
  if (presetNames.has(value)) {
    const choice = value as Preset;
    return { ease: choice, choice, parameters: defaultParameters(choice) };
  }
  const match = /^([a-zA-Z.-]+)\(([^()]*)\)$/.exec(value);
  const choice = cameraEases.find(item => item === match?.[1]);
  if (!choice || !match) return;
  const fields = easeParameters(choice);
  const parts = match[2].split(',').map(part => part.trim());
  if (!fields.length || (parts.length !== fields.length && !(choice.startsWith('elastic.') && parts.length === 1))) return;
  if (!parts.every(part => numberText.test(part))) return;
  const parameters = parts.map(Number);
  if (!parameters.every((number, index) => {
    const field = fields[index];
    return number >= field.min && number <= field.max && (!('integer' in field) || Number.isInteger(number));
  })) return;
  return { ease: value as CameraEase, choice, parameters: [...parameters, ...defaultParameters(choice).slice(parameters.length)] };
}

export function formatCameraEase(choice: CameraEaseChoice, parameters: readonly number[] = defaultParameters(choice)): CameraEase {
  return (parameters.length ? choice + '(' + parameters.join(', ') + ')' : choice) as CameraEase;
}

export const CameraEaseSchema = z.custom<CameraEase>(
  value => typeof value === 'string' && !!parseCameraEase(value),
  { message: 'Unsupported camera ease or parameters' },
);

CustomEase.register(gsap);
const cache = new Map<CameraEase, (progress: number) => number>();

export function resolveCameraEase(ease: CameraEase) {
  const cached = cache.get(ease);
  if (cached) return cached;
  const resolved = ease.trim().startsWith('cubic-bezier(')
    ? CustomEase.create('', ease.trim().slice('cubic-bezier('.length, -1))
    : gsap.parseEase(ease.trim());
  if (cache.size >= 128) cache.clear();
  cache.set(ease, resolved);
  return resolved;
}

export function cameraEaseProgress(ease: CameraEase, progress: number) {
  if (progress <= 0) return 0;
  if (progress >= 1) return 1;
  return resolveCameraEase(ease)(progress);
}
