import { Howl } from 'howler';
import { Observable, defer, of } from 'rxjs';
import { type AudioAction } from '@olivestudio/engine/aperion-director';
import type { Ticker } from 'pixi.js';

type Play = Extract<AudioAction, { play: unknown }>['play'];
type Voice = { layer: string; alias: string; sound: Howl; gain: number; rate: number; cue: boolean; id?: number; done: () => void };
type Gains = { master: number; layers: Map<string, number>; aliases: Map<string, number> };
const clamp = (value: number) => Math.max(0, Math.min(1, value));

export class DirectorAudio {
  private voices = new Set<Voice>();
  private gains: Gains = { master: 1, layers: new Map(), aliases: new Map() };
  private snapshots = new Map<string, Gains>();
  private paused = false;
  private speed = 1;

  constructor(private readonly resolve: (alias: string) => string | undefined,
    private readonly mix: (layer: string) => { volume: number; muted: boolean }) {}

  run(action: AudioAction, ticker: Ticker): Observable<void> {
    return defer(() => {
      if ('playOnce' in action) return this.play(action.playOnce, true);
      if ('play' in action) return this.play(action.play, false);
      if ('stop' in action) {
        const { layer, alias } = action.stop;
        for (const voice of this.voices) if (voice.layer === layer && (!alias || voice.alias === alias)) voice.done();
        return of(undefined);
      }
      if ('fadeMaster' in action) return this.fade(ticker, this.gains.master, action.fadeMaster.to, action.fadeMaster.ms,
        gain => { this.gains.master = gain; });
      if ('fadeLayer' in action) {
        const { layer, to, ms } = action.fadeLayer;
        return this.fade(ticker, this.gains.layers.get(layer) ?? 1, to, ms, gain => this.gains.layers.set(layer, gain));
      }
      if ('fadeAlias' in action) {
        const { layer, alias, to, ms } = action.fadeAlias;
        const key = this.key(layer, alias);
        return this.fade(ticker, this.gains.aliases.get(key) ?? 1, to, ms, gain => this.gains.aliases.set(key, gain));
      }
      if ('crossfade' in action) {
        const { alias, ms = 500, loop = true, volume = 1 } = action.crossfade;
        const outgoing = [...this.voices].filter(voice => voice.layer === 'music').map(voice => [voice, voice.gain] as const);
        const incoming = this.create({ layer: 'music', alias, options: { loop } }, 0);
        return this.fade(ticker, 0, 1, ms, progress => {
          incoming.gain = progress * volume;
          for (const [voice, gain] of outgoing) {
            voice.gain = (1 - progress) * gain;
            if (progress === 1) voice.done();
          }
        });
      }
      if ('snapshot' in action) {
        const { master, layers, aliases } = this.gains;
        this.snapshots.set(action.snapshot.slot, { master, layers: new Map(layers), aliases: new Map(aliases) });
        return of(undefined);
      }
      if ('restore' in action) {
        const next = this.snapshots.get(action.restore.slot);
        if (!next) throw new Error('Unknown Director audio snapshot');
        const old = this.gains;
        const blend = (left: Map<string, number>, right: Map<string, number>, ratio: number) =>
          new Map([...new Set([...left.keys(), ...right.keys()])].map(key =>
            [key, (left.get(key) ?? 1) * (1 - ratio) + (right.get(key) ?? 1) * ratio]));
        return this.fade(ticker, 0, 1, action.restore.ms ?? 0, ratio => {
          this.gains = { master: old.master * (1 - ratio) + next.master * ratio,
            layers: blend(old.layers, next.layers, ratio), aliases: blend(old.aliases, next.aliases, ratio) };
        });
      }
      if ('atNextBeat' in action || 'atNextBar' in action) {
        throw new Error('Beat and bar scheduling requires an audio transport with tempo metadata');
      }
      throw new Error('This audio action requires an Aperion profile or adaptive music provider');
    });
  }

  private key(layer: string, alias: string) { return JSON.stringify([layer, alias]); }

  playCue(alias: string, volume: number, balance: number, source?: string) {
    if (this.paused || !Number.isFinite(volume) || volume <= 0) return;
    this.create({ layer: 'sfx', alias }, clamp(volume), undefined,
      Number.isFinite(balance) ? Math.max(-1, Math.min(1, balance)) : 0, source);
  }

  private create({ layer, alias, options }: Play, gain: number, end?: (error?: Error) => void, pan?: number, source?: string) {
    const src = source ?? this.resolve(alias);
    if (!src) throw new Error(`Unknown audio asset: ${alias}`);
    if (options?.sprite) throw new Error('Audio sprites require a sprite map');
    if (options?.singleInstance) {
      for (const voice of this.voices) if (voice.layer === layer && voice.alias === alias) voice.done();
    }
    const done = (error?: Error) => {
      if (!this.voices.delete(voice)) return;
      sound.unload();
      end?.(error);
    };
    const rate = options?.speed ?? 1;
    const sound = new Howl({ src: [src], preload: false, loop: options?.loop ?? false,
      rate: rate * this.speed, onend: () => { if (!sound.loop()) done(); },
      onload: () => {
        if (!this.paused && this.voices.has(voice) && voice.id === undefined) voice.id = sound.play();
      },
      onloaderror: (_id, error) => done(new Error(String(error))),
      onplayerror: (_id, error) => done(new Error(String(error))) });
    const voice: Voice = { layer, alias, sound, gain, rate, cue: pan !== undefined, done };
    this.voices.add(voice);
    if (pan !== undefined) sound.stereo(pan);
    this.refresh();
    sound.load();
    return voice;
  }

  private play(play: Play, wait: boolean) {
    return new Observable<void>(subscriber => {
      const voice = this.create(wait ? { ...play, options: { ...play.options, loop: false } } : play, play.options?.volume ?? 1,
        wait ? error => { if (error) subscriber.error(error); else { subscriber.next(); subscriber.complete(); } } : undefined);
      if (wait) return () => voice.done();
      subscriber.next();
      subscriber.complete();
    });
  }

  private fade(ticker: Ticker, from: number, to: number, ms: number, apply: (gain: number) => void) {
    if (!Number.isFinite(ms) || !Number.isFinite(to)) throw new Error('Invalid Director audio fade');
    return new Observable<void>(subscriber => {
      let elapsed = 0;
      const update = (delta: number) => {
        elapsed += delta;
        const ratio = ms <= 0 ? 1 : Math.min(1, elapsed / ms);
        apply(clamp(from + (to - from) * ratio));
        this.refresh();
        if (ratio === 1) { subscriber.next(); subscriber.complete(); }
      };
      const tick = (clock: Ticker) => update(clock.deltaMS);
      update(0);
      if (!subscriber.closed) ticker.add(tick);
      return () => ticker.remove(tick);
    });
  }

  refresh() {
    for (const { layer, alias, gain, sound } of this.voices) {
      const { volume, muted } = this.mix(layer);
      sound.volume(clamp(volume * gain * this.gains.master * (this.gains.layers.get(layer) ?? 1) *
        (this.gains.aliases.get(this.key(layer, alias)) ?? 1)));
      sound.mute(muted);
    }
  }

  pause(paused: boolean) {
    if (paused === this.paused) return;
    this.paused = paused;
    for (const voice of this.voices) {
      if (paused) {
        if (voice.id !== undefined) voice.sound.pause(voice.id);
      } else if (voice.sound.state() === 'loaded') voice.id = voice.sound.play(voice.id);
    }
  }

  stepClock(ms: number) {
    if (!this.paused) return;
    for (const { sound, id, rate, done } of this.voices) {
      if (id === undefined || sound.state() !== 'loaded') continue;
      const duration = sound.duration(id), position = sound.seek(id);
      if (!duration || typeof position !== 'number') continue;
      const next = position + ms * rate / 1000;
      if (!sound.loop() && next >= duration) done();
      else sound.seek(next % duration, id);
    }
  }

  setSpeed(speed: number) {
    for (const voice of this.voices) voice.sound.rate(voice.rate * speed);
    this.speed = speed;
  }

  stopCues() {
    for (const voice of this.voices) if (voice.cue) voice.done();
  }

  reset() {
    for (const voice of this.voices) voice.done();
    this.gains = { master: 1, layers: new Map(), aliases: new Map() };
    this.snapshots.clear();
  }
}
