import { Howl } from 'howler';
import { z } from 'zod';
import { t } from './i18n';
import { busEffects, type Mixer } from '@rewrite/audio/contracts';
import { howlerProvider, routeHowlerVoice } from '@rewrite/audio-howler';

export const audioBuses = ['music', 'sfx', 'ui'] as const;
export const audioRolloffs = ['linear', 'inverse', 'exponential'] as const;
const gain = () => z.number().min(0).max(1).default(1);
export const audioOptions = z.strictObject({
  volume: gain(),
  muted: z.boolean().default(false),
  music: gain(),
  sfx: gain(),
  ui: gain(),
}).prefault({});

export const audioSourceOptions = z.strictObject({
  asset: z.string().min(1).nullable().default(null),
  volume: gain(),
  rate: z.number().min(0.25).max(4).default(1),
  loop: z.boolean().default(false),
  autoplay: z.boolean().default(false),
  voiceLimit: z.number().int().min(1).max(16).default(1),
  bus: z.enum(audioBuses).default('sfx'),
  pan: z.number().min(-1).max(1).default(0),
  spatial: z.boolean().default(false),
  minDistance: z.number().min(0).max(99999).default(100),
  maxDistance: z.number().min(1).max(100000).default(1000),
  rolloff: z.enum(audioRolloffs).default('linear'),
  panAmount: gain(),
});

type Options = z.output<typeof audioOptions>;
type Source = z.output<typeof audioSourceOptions>;
type Point = { x: number; y: number };

export function spatialMix(source: Source, position: Point, listener: Point) {
  if (!source.spatial) return { gain: 1, pan: source.pan };
  const { minDistance: min, maxDistance: max } = source;
  const dx = position.x - listener.x;
  const distance = Math.min(max, Math.hypot(dx, position.y - listener.y));
  const ratio = Math.max(1, min) / Math.max(1, distance);
  let gain = 1;
  if (distance > min) {
    if (source.rolloff === 'linear') gain = (max - distance) / (max - min);
    else if (source.rolloff === 'inverse') gain = ratio;
    else gain = ratio ** 2;
  }
  const side = Math.max(-1, Math.min(1, dx / (max / 2)));
  return { gain, pan: Math.max(-1, Math.min(1, source.pan + side * source.panAmount)) };
}

export type AudioStatus = { state: 'idle' } | {
  state: 'loading' | 'playing' | 'error';
  alias: string;
  message?: string;
};

export type SourceStatus = { state: 'loading' | 'playing' | 'paused' | 'error'; message?: string };
export type AudioTransport = 'stopped' | 'playing' | 'paused';
type PositionedSource = { id: string; source: Source; position: Point; url: string };
type Mix = { volume: number; pan: number; rate: number; loop: boolean; muted: boolean; limit: number; bus: Source['bus'] };

class SourceVoice {
  private readonly howl: Howl;
  private readonly ids = new Set<number>();
  private pending: number[] = [];
  private paused = false;
  private disposed = false;

  constructor(readonly url: string, private mix: Mix, private readonly publish: (status?: SourceStatus) => void) {
    this.howl = new Howl({
      src: [url], preload: false,
      volume: mix.volume, rate: mix.rate, loop: mix.loop, mute: mix.muted,
      onload: () => this.startPending(),
      onloaderror: (_id, error) => this.fail(t('audioLoadError', { error: String(error) })),
      onplayerror: (id, error) => {
        if (!this.disposed && this.ids.delete(id) && !this.ids.size) this.fail(t('audioPlayError', { error: String(error) }));
      },
      onplay: id => {
        if (this.disposed || this.paused || !this.ids.has(id)) return;
        routeHowlerVoice(this.howl, id, this.mix.bus, false);
        this.publish({ state: 'playing' });
      },
      onend: id => {
        if (!this.disposed && !this.mix.loop && this.ids.delete(id) && !this.ids.size && !this.pending.length) this.publish();
      },
    });
  }

  play() {
    if (this.mix.limit === 1 && (this.ids.size || this.pending.length)) return;
    if (this.pending.length < this.mix.limit) this.pending.push(0);
    if (this.paused) { this.publish({ state: 'paused' }); return; }
    if (this.howl.state() === 'loaded') this.startPending();
    else if (this.howl.state() === 'unloaded') {
      this.publish({ state: 'loading' });
      this.howl.load();
    }
  }

  private startPending() {
    if (this.disposed || this.paused || !this.pending.length) return;
    this.howl.stereo(this.mix.pan);
    const duration = this.howl.duration();
    while (this.pending.length) {
      const elapsed = this.pending.shift()!;
      if (duration && !this.mix.loop && elapsed >= duration) continue;
      this.trim(this.mix.limit - 1);
      const id = this.howl.play();
      if (id === null) {
        this.fail(t('audioPlayError', { error: t('audioUnavailable') }));
        return;
      }
      this.ids.add(id);
      if (elapsed > 0 && duration) this.howl.seek(this.mix.loop ? elapsed % duration : elapsed, id);
      this.howl.stereo(this.mix.pan, id);
    }
    if (!this.ids.size) this.publish();
  }

  update(mix: Mix) {
    const old = this.mix;
    this.mix = mix;
    this.pending.length = Math.min(this.pending.length, mix.limit);
    if (this.howl.state() === 'unloaded') return;
    if (old.volume !== mix.volume) this.howl.volume(mix.volume);
    if (old.rate !== mix.rate) this.howl.rate(mix.rate);
    if (old.loop !== mix.loop) this.howl.loop(mix.loop);
    if (old.muted !== mix.muted) this.howl.mute(mix.muted);
    if (old.pan !== mix.pan && this.howl.state() === 'loaded') this.howl.stereo(mix.pan);
    if (old.bus !== mix.bus) for (const id of this.ids) routeHowlerVoice(this.howl, id, mix.bus, false);
    this.trim(mix.limit);
  }

  private trim(limit: number) {
    for (const id of this.ids) {
      if (this.ids.size <= limit) break;
      this.ids.delete(id);
      this.howl.stop(id);
    }
  }

  pause() {
    this.paused = true;
    for (const id of this.ids) this.howl.pause(id);
    if (this.ids.size || this.pending.length) this.publish({ state: 'paused' });
  }

  resume() {
    this.paused = false;
    for (const id of this.ids) this.howl.play(id);
    if (this.howl.state() === 'loaded') this.startPending();
    else if (this.pending.length) {
      this.publish({ state: 'loading' });
      if (this.howl.state() === 'unloaded') this.howl.load();
    }
  }

  step(ms: number, authoredRate: number) {
    const elapsed = ms / 1000 * authoredRate;
    this.pending = this.pending.map(position => position + elapsed);
    for (const id of this.ids) {
      const duration = this.howl.duration(id);
      const position = this.howl.seek(id);
      if (!duration || typeof position !== 'number') continue;
      const next = position + elapsed;
      if (!this.mix.loop && next >= duration) {
        this.ids.delete(id);
        this.howl.stop(id);
      } else {
        this.howl.seek(this.mix.loop ? next % duration : next, id);
      }
    }
    if (!this.ids.size && !this.pending.length) this.publish();
  }

  private fail(message: string) {
    if (this.disposed) return;
    this.destroy();
    this.publish({ state: 'error', message });
  }

  destroy() {
    if (this.disposed) return;
    this.disposed = true;
    this.howl.unload();
    this.ids.clear();
    this.pending.length = 0;
  }

  get failed() { return this.disposed; }
  get playing() { return [...this.ids].filter(id => this.howl.playing(id)).length; }
}

export class SceneAudio {
  private sources = new Map<string, PositionedSource>();
  private voices = new Map<string, SourceVoice>();
  private listener: Point = { x: 0, y: 0 };
  private transport: AudioTransport = 'stopped';
  private clockPaused = false;
  private clockSpeed = 1;
  private mixer?: Mixer;
  private readonly duckGain = new Map<string, number>();

  constructor(private readonly options: () => Options, private readonly publish: (id: string, status?: SourceStatus) => void) {}

  sync(sources: PositionedSource[], listener: Point) {
    this.sources = new Map(sources.map(source => [source.id, source]));
    this.listener = listener;
    for (const [id, voice] of this.voices) {
      const source = this.sources.get(id);
      if (source?.url !== voice.url) this.stop(id);
      else if (!voice.failed) voice.update(this.mix(source));
    }
  }

  private mix({ source, position }: PositionedSource): Mix {
    const options = this.options();
    const { gain, pan } = spatialMix(source, position, this.listener);
    return { volume: source.volume * this.busVolume(source.bus) * gain, pan, bus: source.bus,
      rate: Math.max(0.25, Math.min(4, source.rate * this.clockSpeed)), loop: source.loop, muted: options.muted,
      limit: source.loop ? 1 : source.voiceLimit };
  }

  setMixer(mixer: Mixer | undefined) {
    this.mixer = mixer;
    this.duckGain.clear();
    for (const bus of audioBuses) howlerProvider.setBusEffects?.(bus, busEffects(mixer, bus));
  }

  private busVolume(bus: Source['bus']) {
    const options = this.options();
    return (this.mixer?.ducking ?? []).reduce((gain, rule) => rule.target === bus ? gain * (this.duckGain.get(rule.id) ?? 1) : gain,
      options.volume * options[bus]);
  }

  levels() {
    const result = {
      music: { gain: this.busVolume('music'), playing: 0 },
      sfx: { gain: this.busVolume('sfx'), playing: 0 },
      ui: { gain: this.busVolume('ui'), playing: 0 },
    };
    for (const [id, voice] of this.voices) {
      const source = this.sources.get(id);
      if (source) result[source.source.bus].playing += voice.playing;
    }
    return result;
  }

  tickMixer(seconds: number) {
    if (!this.mixer?.ducking.length) return;
    const levels = this.levels();
    for (const rule of this.mixer.ducking) {
      const playing = levels[rule.trigger].playing > 0;
      const gain = this.duckGain.get(rule.id) ?? 1;
      const target = playing ? rule.amount : 1;
      const duration = playing ? rule.attack : rule.release;
      const advance = duration > 0 ? Math.min(1, seconds / duration) * (1 - rule.amount) : 1;
      this.duckGain.set(rule.id, gain < target ? Math.min(target, gain + advance) : Math.max(target, gain - advance));
    }
  }

  play(id: string) {
    const source = this.sources.get(id);
    if (!source || this.transport === 'paused') return;
    let voice = this.voices.get(id);
    if (!voice || voice.failed) {
      voice = new SourceVoice(source.url, this.mix(source), status => this.publish(id, status));
      this.voices.set(id, voice);
      if (this.clockPaused) voice.pause();
    }
    voice.play();
  }

  stop(id: string) {
    const voice = this.voices.get(id);
    if (!voice) return;
    this.voices.delete(id);
    voice.destroy();
    this.publish(id);
  }

  playScene(): AudioTransport {
    if (this.transport === 'paused') {
      this.transport = 'playing';
      if (!this.clockPaused) for (const voice of this.voices.values()) if (!voice.failed) voice.resume();
    } else if (this.transport === 'stopped') {
      this.transport = 'playing';
      for (const { id, source } of this.sources.values()) if (source.autoplay) this.play(id);
    }
    return this.transport = 'playing';
  }

  pauseScene(): AudioTransport {
    if (this.transport !== 'playing') return this.transport;
    for (const voice of this.voices.values()) if (!voice.failed) voice.pause();
    return this.transport = 'paused';
  }

  stopScene(): AudioTransport {
    for (const id of this.voices.keys()) this.stop(id);
    this.duckGain.clear();
    return this.transport = 'stopped';
  }

  setClockPaused(paused: boolean) {
    if (this.clockPaused === paused) return;
    this.clockPaused = paused;
    if (this.transport === 'paused') return;
    for (const voice of this.voices.values()) {
      if (voice.failed) continue;
      if (paused) voice.pause();
      else voice.resume();
    }
  }

  setClockSpeed(speed: number) {
    this.clockSpeed = speed;
    for (const [id, voice] of this.voices) {
      const source = this.sources.get(id);
      if (source && !voice.failed) voice.update(this.mix(source));
    }
  }

  stepClock(ms: number) {
    if (!this.clockPaused || this.transport === 'paused') return;
    for (const [id, voice] of this.voices) {
      const source = this.sources.get(id);
      if (source && !voice.failed) voice.step(ms, source.source.rate);
    }
  }

  destroy() {
    for (const voice of this.voices.values()) voice.destroy();
    this.voices.clear();
    this.sources.clear();
  }
}

export class EditorAudio {
  private active?: Howl;
  readonly sources: SceneAudio;

  constructor(
    private options: Options,
    private readonly sourceFor: (alias: string) => string | undefined,
    private readonly publish: (status: AudioStatus) => void,
    publishSource: (id: string, status?: SourceStatus) => void,
  ) {
    this.sources = new SceneAudio(() => this.options, publishSource);
  }

  configure(options: Options) {
    if (options.volume !== this.options.volume) this.active?.volume(options.volume);
    if (options.muted !== this.options.muted) this.active?.mute(options.muted);
    this.options = options;
  }

  play(alias: string) {
    this.release();
    const src = this.sourceFor(alias);
    if (!src) {
      this.publish({ state: 'error', alias, message: t('audioMissing') });
      return;
    }

    const fail = (message: string) => {
      if (this.active !== sound) return;
      this.release();
      this.publish({ state: 'error', alias, message });
    };
    const sound = new Howl({
      src: [src],
      preload: false,
      volume: this.options.volume,
      mute: this.options.muted,
      onplay: () => {
        if (this.active === sound) this.publish({ state: 'playing', alias });
      },
      onloaderror: (_id, error) => fail(t('audioLoadError', { error: String(error) })),
      onplayerror: (_id, error) => fail(t('audioPlayError', { error: String(error) })),
      onend: () => {
        if (this.active === sound) this.stop();
      },
    });
    this.active = sound;
    this.publish({ state: 'loading', alias });
    try {
      sound.load();
      sound.play();
    } catch (error) {
      fail(t('audioPlayError', { error: String(error) }));
    }
  }

  stop() {
    this.release();
    this.publish({ state: 'idle' });
  }

  destroy() {
    this.release();
    this.sources.destroy();
  }

  private release() {
    const active = this.active;
    this.active = undefined;
    active?.unload();
  }
}
