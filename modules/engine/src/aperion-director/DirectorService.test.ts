import type { Application, Ticker } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';
import { DirectorService, registerModuleStrategies } from './index.js';

function clock() {
  const callbacks = new Set<(ticker: { deltaMS: number }) => void>();
  const ticker = {
    add: (callback: (ticker: { deltaMS: number }) => void) => callbacks.add(callback),
    remove: (callback: (ticker: { deltaMS: number }) => void) => callbacks.delete(callback),
  } as unknown as Ticker;
  const director = new DirectorService({ ticker } as Application);
  return { director, tick: (deltaMS: number) => [...callbacks].forEach(callback => callback({ deltaMS })) };
}

describe('Aperion Director integration', () => {
  it('keeps dispatched timeline work running while a filtered trigger plays a composition', async () => {
    const { director, tick } = clock();
    const physics = vi.fn();
    registerModuleStrategies(director, {
      physics, audioSource: vi.fn(), scene: vi.fn(), particles: vi.fn(), visibility: vi.fn(), global: vi.fn(),
    });
    const applied = vi.fn();
    director.signals.on('completed', applied);
    director.register({ name: 'Impact', trigger: { event: 'contact', whenExpr: 'speed >= 5' },
      vars: { push: 80 }, root: { type: 'sequence', children: [
        { type: 'delay', ms: 20 },
        { type: 'physics', target: 'ball', action: 'impulse', x: '$push', y: 0 },
      ] } });
    const timeline = director.dispatch({ type: 'sequence', children: [
      { type: 'delay', ms: 40 }, { type: 'emit', event: 'completed' },
    ] });
    director.signals.emit({ type: 'contact', speed: 4 });
    expect(director.active).toBeNull();
    director.signals.emit({ type: 'contact', speed: 6 });
    const impact = director.active!;
    expect(impact).toBeTruthy();
    impact.pause();
    tick(20);
    expect(physics).not.toHaveBeenCalled();
    impact.resume();
    tick(20);
    await Promise.all([timeline.finished, impact.finished]);
    expect(physics).toHaveBeenCalledWith({ type: 'physics', target: 'ball', action: 'impulse', x: 80, y: 0 });
    expect(applied).toHaveBeenCalledOnce();
    director.destroy();
  });

  it('reports invalid module steps and cancels detached work at teardown', async () => {
    const { director, tick } = clock();
    const physics = vi.fn();
    registerModuleStrategies(director, {
      physics, audioSource: vi.fn(), scene: vi.fn(), particles: vi.fn(), visibility: vi.fn(), global: vi.fn(),
    });
    await expect(director.dispatch({ type: 'physics', action: 'impulse', x: 1, y: 2 }).finished).rejects.toThrow('Select a physics body');
    const delayed = director.dispatch({ type: 'sequence', children: [
      { type: 'delay', ms: 40 }, { type: 'physics', action: 'gravity', x: 0, y: 0 },
    ] });
    director.destroy();
    tick(100);
    await delayed.finished;
    expect(physics).not.toHaveBeenCalled();
  });
});
