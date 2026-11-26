import { Application, ExtensionType, extensions, type ApplicationOptions } from 'pixi.js';

type ClockState = 'running' | 'paused' | 'stopped';
type ClockHooks = {
  pause?(): void;
  resume?(): void;
  step?(ms: number): void;
  speed?(value: number): void;
  stop?(): void;
  unload?(): void;
  reload?(): void;
};

export interface GameClockControls {
  readonly clock: GameClock;
  pause(): void;
  resume(): void;
  step(ms?: number): number;
  stop(): void;
  unload(): void;
  reload(): void;
  speed(value?: number): number;
}

export class GameClock {
  private stateValue: ClockState = 'running';
  private autoStart?: boolean;
  get state() { return this.stateValue; }

  constructor(private readonly app: Application, private readonly hooks: ClockHooks) {}

  private halt(state: ClockState) {
    const { ticker } = this.app;
    this.autoStart ??= ticker.autoStart;
    this.stateValue = state;
    ticker.autoStart = false;
    ticker.stop();
  }

  pause() {
    if (this.state !== 'running') return;
    this.halt('paused');
    this.hooks.pause?.();
  }

  resume() {
    if (this.state === 'running') return;
    const { ticker } = this.app;
    this.stateValue = 'running';
    ticker.autoStart = this.autoStart ?? ticker.autoStart;
    this.autoStart = undefined;
    this.hooks.resume?.();
    ticker.start();
  }

  step(ms = 1000 / 60) {
    if (this.state !== 'paused' || !Number.isFinite(ms) || ms <= 0) return 0;
    if (ms > 60_000) throw new RangeError('A game clock step cannot exceed 60 seconds.');
    const { ticker } = this.app;
    const { maxFPS, speed } = ticker;
    const cap = Math.min(1000 / 60, 1000 / Math.max(1, ticker.minFPS));
    let advanced = 0;
    try {
      // Manual steps advance simulation milliseconds, independent of the playback speed and FPS limit.
      ticker.maxFPS = 0;
      ticker.speed = 1;
      if (ticker.lastTime < 0) ticker.lastTime = 0;
      while (advanced < ms && this.state === 'paused') {
        const slice = Math.min(cap, ms - advanced);
        this.hooks.step?.(slice);
        ticker.update(ticker.lastTime + slice);
        advanced += slice;
      }
    } finally {
      ticker.speed = speed;
      ticker.maxFPS = maxFPS;
    }
    return advanced;
  }

  speed(value?: number) {
    const { ticker } = this.app;
    if (value !== undefined && Number.isFinite(value) && value > 0) {
      ticker.speed = value;
      this.hooks.speed?.(value);
    }
    return ticker.speed;
  }

  stop() {
    if (this.state === 'stopped') return;
    this.halt('stopped');
    this.hooks.stop?.();
  }

  unload() {
    this.stop();
    this.hooks.unload?.();
  }

  reload() {
    this.unload();
    this.resume();
    this.hooks.reload?.();
  }
}

export type ClockApplicationOptions = Partial<ApplicationOptions> & { oliveClock?: ClockHooks };

extensions.add({
  // Pixi installs its ticker and its instance-level stop function first.
  extension: { type: ExtensionType.Application, priority: -1000 },
  init(this: Application, { oliveClock }: ClockApplicationOptions) {
    if (!oliveClock) return;
    const clock = new GameClock(this, oliveClock);
    Object.assign(this, {
      clock, pause: clock.pause.bind(clock), resume: clock.resume.bind(clock), step: clock.step.bind(clock),
      stop: clock.stop.bind(clock), unload: clock.unload.bind(clock), reload: clock.reload.bind(clock), speed: clock.speed.bind(clock),
    });
  },
  destroy(this: Application & Partial<GameClockControls>) { this.clock?.stop(); },
});
