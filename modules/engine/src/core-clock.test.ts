import { Ticker, type Application } from 'pixi.js';
import { expect, it, vi } from 'vitest';
import { GameClock } from './core-clock';

it('steps simulation time without the playback rate or frame cap and preserves both afterwards', () => {
  const ticker = new Ticker();
  const advance = vi.fn();
  const clock = new GameClock({ ticker } as Application, { step: advance });
  const frames: number[] = [];
  ticker.add(tick => frames.push(tick.deltaMS));
  ticker.lastTime = 100;
  ticker.maxFPS = 15;
  try {
    expect(clock.speed(2)).toBe(2);
    expect(clock.step(75)).toBe(0);
    clock.pause();
    expect(clock.step(75)).toBe(75);
    expect(frames.reduce((elapsed, value) => elapsed + value, 0)).toBeCloseTo(75);
    expect(advance).toHaveBeenCalledTimes(frames.length);
    expect(ticker.speed).toBe(2);
    expect(ticker.maxFPS).toBe(15);
    expect(clock.state).toBe('paused');
    expect(ticker.started).toBe(false);
  } finally { ticker.destroy(); }
});

it('stops, unloads and reloads a game through the lifecycle hooks', () => {
  const ticker = new Ticker();
  const events: string[] = [];
  const clock = new GameClock({ ticker } as Application, {
    pause: () => events.push('pause'), resume: () => events.push('resume'), stop: () => events.push('stop'),
    unload: () => events.push('unload'), reload: () => events.push('reload'),
  });
  try {
    clock.pause();
    clock.stop();
    clock.reload();
    expect(events).toEqual(['pause', 'stop', 'unload', 'resume', 'reload']);
    expect(clock.state).toBe('running');
  } finally { ticker.destroy(); }
});
