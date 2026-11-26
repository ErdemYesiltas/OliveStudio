import { z } from 'zod';
import { particleSettings, type ParticleObject } from './scene';

const preset = z.strictObject({
  id: z.string().min(1).max(100),
  name: z.string().trim().min(1).max(80),
  settings: particleSettings,
});

export const particlePresetsSchema = z.array(preset).max(64)
  .refine(items => new Set(items.map(item => item.id)).size === items.length);

export type ParticlePreset = z.output<typeof preset>;
export type ParticleSettings = ParticlePreset['settings'];

export const builtInParticles: ParticlePreset[] = [
  { id: 'fire', name: 'Fire', settings: { count: 160, lifetime: 1.4, speed: 95, spread: 28, gravity: -30, size: 16,
    endScale: 0.15, startColor: '#ffcf63', endColor: '#d83b16', spawnShape: 'circle', spawnRadius: 16 } },
  { id: 'smoke', name: 'Smoke', settings: { count: 90, lifetime: 4, speed: 30, spread: 35, gravity: -8,
    size: 9, endScale: 4, startColor: '#8e96a2', endColor: '#424953', startAlpha: 0.35, spawnShape: 'circle', rotationSpeed: 16 } },
  { id: 'snow', name: 'Snow', settings: { count: 160, lifetime: 5, speed: 30, direction: 90, spread: 30, gravity: 8,
    size: 4, endScale: 0.7, startColor: '#e4f4ff', spawnShape: 'rectangle', spawnWidth: 420, spawnHeight: 120 } },
  { id: 'rain', name: 'Rain', settings: { count: 250, lifetime: 1.6, speed: 260, direction: 100, spread: 4, gravity: 80,
    size: 3, endScale: 1, startColor: '#80b9ed', startAlpha: 0.6, spawnShape: 'rectangle', spawnWidth: 500, spawnHeight: 160 } },
  { id: 'sparkles', name: 'Sparkles', settings: { count: 100, lifetime: 2, speed: 18, spread: 360,
    size: 5, endScale: 0, startColor: '#cfadff', endColor: '#fff0a5', spawnShape: 'circle', spawnRadius: 90 } },
  { id: 'explosion', name: 'Explosion', settings: { count: 220, lifetime: 0.8, speed: 330, spread: 360, gravity: 150,
    size: 8, endScale: 0, startColor: '#ffda79', endColor: '#ed4d2c', emission: 'burst', rotationSpeed: 180 } },
].map(item => preset.parse(item));

const fields = Object.keys(particleSettings.shape) as (keyof ParticleSettings)[];

export function extractParticleSettings(node: ParticleObject): ParticleSettings {
  return particleSettings.parse(Object.fromEntries(fields.map(key => [key, node[key]])));
}
