import { expect, it, vi } from 'vitest';
import { SceneAudio, audioOptions, audioSourceOptions } from './audio';

const howl = vi.hoisted(() => ({
  state: vi.fn(() => 'loaded'), stereo: vi.fn(), play: vi.fn(() => 1), pause: vi.fn(), rate: vi.fn(),
  duration: vi.fn(() => 1), seek: vi.fn((...args: number[]) => args.length === 1 ? 0.25 : undefined),
  stop: vi.fn(), unload: vi.fn(),
}));
vi.mock('howler', () => ({ Howl: class { constructor() { return howl; } } }));

it('pauses, seeks and resumes scene voices on the game clock at the selected rate', () => {
  const audio = new SceneAudio(() => audioOptions.parse({}), vi.fn());
  const point = { x: 0, y: 0 };
  const source = audioSourceOptions.parse({ rate: 1.5 });
  audio.sync([{ id: 'sound', url: 'preview.wav', source, position: point }], point);
  audio.play('sound');
  audio.setClockPaused(true);
  expect(howl.pause).toHaveBeenCalledWith(1);
  audio.setClockSpeed(2);
  expect(howl.rate).toHaveBeenCalledWith(3);
  audio.stepClock(100);
  expect(howl.seek).toHaveBeenCalledWith(0.4, 1);
  expect(howl.play).toHaveBeenCalledTimes(1);
  audio.setClockPaused(false);
  expect(howl.play).toHaveBeenLastCalledWith(1);
  audio.stopScene();
  expect(howl.unload).toHaveBeenCalledTimes(1);
});
