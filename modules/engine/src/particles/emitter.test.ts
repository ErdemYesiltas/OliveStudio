import { Container, ParticleContainer, Texture } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { Emitter, Particle, createParticleEmitter, type EmitterConfigV3 } from './index.js';

function emitterConfig(overrides: Partial<EmitterConfigV3> = {}): EmitterConfigV3 {
  return {
    lifetime: { min: 1, max: 1 }, frequency: 0.25, particlesPerWave: 2, maxParticles: 4,
    pos: { x: 8, y: 4 }, emit: false,
    behaviors: [
      { type: 'textureSingle', config: { texture: Texture.WHITE } },
      { type: 'moveSpeedStatic', config: { min: 20, max: 20 } },
      { type: 'alpha', config: { alpha: { list: [{ time: 0, value: 1 }, { time: 1, value: 0 }] } } },
      { type: 'color', config: { color: { list: [{ time: 0, value: '#ffffff' }, { time: 1, value: '#ffffff' }] } } },
    ],
    ...overrides,
  };
}

describe('Aperion particle emitter', () => {
  it('drives behaviors from seconds, caps waves, and reuses dead particles', () => {
    const display = new ParticleContainer();
    const emitter = new Emitter(display, emitterConfig());
    expect(emitter.particleImages).toEqual([Texture.WHITE]);
    emitter.emitNow();
    const initial = display.particleChildren[0] as Particle;
    expect(initial).toMatchObject({ x: 8, y: 4, age: 0, alpha: 1 });
    emitter.update(0.5);
    expect(initial).toMatchObject({ x: 18, y: 4, age: 0.5, alpha: 0.5 });
    emitter.emitNow();
    emitter.emitNow();
    expect(emitter.particleCount).toBe(4);
    emitter.update(1.25);
    expect(display.particleChildren).toHaveLength(0);
    emitter.emit = true;
    emitter.update(0.3);
    expect(emitter.particleCount).toBe(4);
    expect(display.particleChildren).toContain(initial);
    emitter.destroy();
    expect(display.particleChildren).toHaveLength(0);
    display.destroy();
  });

  it('honors a zero spawn chance and preserves caller-owned particle containers', () => {
    const display = new ParticleContainer();
    const emitter = new Emitter(display, emitterConfig({ spawnChance: 0 }));
    emitter.emitNow();
    emitter.emit = true;
    emitter.update(0.5);
    expect(emitter.particleCount).toBe(0);
    emitter.destroy();

    const supplied = createParticleEmitter(display, emitterConfig());
    supplied.start();
    supplied.update(0.125);
    expect(display.particleChildren).toHaveLength(2);
    supplied.stopEmitting();
    expect(supplied.isComplete()).toBe(false);
    supplied.update(1);
    expect(supplied.isComplete()).toBe(true);
    supplied.destroy();
    expect(display.destroyed).toBe(false);
    expect(display.particleChildren).toHaveLength(0);
    display.destroy();

    const parent = new Container();
    const owned = createParticleEmitter(parent, emitterConfig());
    expect(parent.children).toHaveLength(1);
    owned.destroy();
    expect(parent.children).toHaveLength(0);
    parent.destroy();
  });
});
