import {expect, it} from 'vitest';
import {makeEntity, type Entity} from '@rewrite/scene';
import {AudioSession, ramp, MixerSchema, defaultMixer, type AudioEvent, type AudioProvider, type AudioVoice, type VoiceSnapshot, type VoiceSpec} from './index';
import {Subject} from 'rxjs';

/** A provider double with live volume/rate and a controllable playback position. */
class Voice implements AudioVoice {
 snapshot: VoiceSnapshot = {state: 'ready', starts: 0}; listeners = new Set<() => void>(); volume: number; rate: number; at = 0;
 constructor(spec: VoiceSpec) { this.volume = spec.volume; this.rate = spec.rate; }
 subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
 emit(state: VoiceSnapshot['state']) { this.snapshot = {...this.snapshot, state}; for (const fn of this.listeners) fn(); }
 play() { this.snapshot = {...this.snapshot, starts: this.snapshot.starts + 1}; this.emit('playing'); }
 pause() { if (this.snapshot.state === 'playing') this.emit('paused'); }
 stop() { this.emit('stopped'); }
 dispose() { this.listeners.clear(); }
 setVolume(v: number) { this.volume = v; } setRate(r: number) { this.rate = r; } position() { return this.at; }
}
function fixture(sources: Record<string, Partial<{volume: number; bus: string; autoplay: boolean; bpm: number; beatOffset: number; pitchJitter: number; volumeJitter: number; rate: number}>>, mixer = defaultMixer, random = () => .5) {
 const voices: Voice[] = [], entities: Entity[] = Object.entries(sources).map(([id, s]) => { const e = makeEntity(id); e.id = id; e.components.push({id, type: 'audio.source', version: 1, data: {assetId: '', volume: 1, rate: 1, loop: false, autoplay: false, bus: 'sfx', ...s}} as never); return e; });
 const provider: AudioProvider = {id: 'test', supports: () => true, create: spec => { const v = new Voice(spec); voices.push(v); return v; }};
 const session = new AudioSession(() => entities, source => ({url: 'clip.wav', format: 'wav', volume: source.volume, loop: source.loop, rate: source.rate}), provider, {mixer, random});
 session.system.start!();
 const voice = (i: number) => voices[i];
 const data = (id: string) => entities.find(e => e.id === id)!.components[1].data as Record<string, unknown>;
 return {session, voice, data, entities, step: (dt = .1, times = 1) => { for (let i = 0; i < times; i++) session.system.update!(dt); }};
}

it('ramp: emits on the frame stream from → to and completes', () => {
 const frame$ = new Subject<number>(), out: number[] = [];
 let done = false;
 ramp(frame$, 1, 0, .5).subscribe({next: v => out.push(Math.round(v * 100) / 100), complete: () => { done = true; }});
 for (let i = 0; i < 6; i++) frame$.next(.1);
 expect(out).toEqual([1, .8, .6, .4, .2, 0]); expect(done).toBe(true);
});

it('live gains: volume, rate and bus changes reach the running voice without a restart; mixer and runtime bus gain multiply', () => {
 const f = fixture({music: {bus: 'music', autoplay: true, volume: .8}}, MixerSchema.parse({...defaultMixer, master: .5, music: .5}));
 const v = f.voice(0);
 expect(v.volume).toBeCloseTo(.2); expect(v.snapshot.starts).toBe(1);
 f.data('music').volume = .4; f.data('music').rate = 2; f.step();
 expect(f.voice(0)).toBe(v); expect(v.volume).toBeCloseTo(.1); expect(v.rate).toBe(2); expect(v.snapshot.starts).toBe(1);
 f.session.setBus('music', .5); expect(v.volume).toBeCloseTo(.05); expect(f.session.bus('music')).toBe(.5);
 f.session.setMixer({...defaultMixer}); expect(v.volume).toBeCloseTo(.2);
 expect(() => f.session.setBus('music', 2)).toThrow('0–1');
});

it('ducking: while effects play the music bus ramps down (attack) and back up (release) on game time', () => {
 const f = fixture({music: {bus: 'music', autoplay: true}, shot: {bus: 'sfx'}}, MixerSchema.parse({...defaultMixer, ducking: [{id: 'd', trigger: 'sfx', target: 'music', amount: .2, attack: .2, release: .4}]}));
 const music = f.voice(0), shot = f.voice(1);
 f.session.play('shot'); f.step(.1);
 expect(music.volume).toBeCloseTo(.6);
 f.step(.1); expect(music.volume).toBeCloseTo(.2);
 shot.emit('ended'); f.step(.2); expect(music.volume).toBeCloseTo(.6);
 f.step(.2); expect(music.volume).toBeCloseTo(1);
});

it('fades: fade in starts a stopped source from silence, fade out stops it at the end, stop resets', () => {
 const f = fixture({a: {}}), v = f.voice(0);
 f.session.fade('a', 1, .5);
 expect(v.snapshot.state).toBe('playing'); expect(v.volume).toBe(0);
 f.step(.25); expect(v.volume).toBeCloseTo(.5);
 f.step(.25); expect(v.volume).toBe(1);
 f.session.fade('a', 0, .2, true); f.step(.1); expect(v.volume).toBeCloseTo(.5);
 f.step(.1); expect(v.snapshot.state).toBe('stopped'); expect(f.session.state('a')).toMatchObject({fade: 1, state: 'stopped'});
 expect(() => f.session.fade('a', 2, 1)).toThrow('0–1');
});

it('beats, end events and per-play variation', () => {
 const f = fixture({loop: {bus: 'music', bpm: 120, beatOffset: .25, autoplay: true}, hit: {pitchJitter: .2, volumeJitter: .5}}, defaultMixer, () => 1);
 const events: AudioEvent[] = [];
 f.session.events$.subscribe(e => events.push(e));
 const loop = f.voice(0);
 for (const at of [.1, .3, .76, 1.26, 2.26]) { loop.at = at; f.step(.01); }
 expect(events.map(e => [e.kind, e.beat, e.bar])).toEqual([['beat', 0, true], ['beat', 1, false], ['beat', 2, false], ['beat', 4, true]]);
 f.session.play('hit');
 expect(f.voice(1).rate).toBeCloseTo(1.2); expect(f.voice(1).volume).toBeCloseTo(.5);
 f.voice(1).emit('ended');
 expect(events.at(-1)).toMatchObject({kind: 'ended', key: 'hit', entityId: 'hit'});
});

it('spatial sources follow their object and the listener: distance gain and pan reach the voice live', () => {
 const voices: {volume: number; pan: number}[] = [];
 const provider: AudioProvider = {id: 'test', supports: () => true, create: spec => { const v = {volume: spec.volume, pan: spec.pan ?? 0, snapshot: {state: 'ready' as const, starts: 0}, subscribe: () => () => {}, play() {}, pause() {}, stop() {}, dispose() {}, setVolume(x: number) { v.volume = x; }, setRate() {}, setPan(x: number) { v.pan = x; }}; voices.push(v); return v; }};
 const source = makeEntity('Bird'), at = (e: Entity) => e.components[0].data as {x: number; y: number};
 source.components.push({id: 'bird', type: 'audio.source', version: 1, data: {assetId: '', volume: 0.8, rate: 1, loop: true, autoplay: false, bus: 'sfx', spatial: true, minDistance: 100, maxDistance: 1100}} as never);
 Object.assign(at(source), {x: 600, y: 0});
 const entities: Entity[] = [source];
 let camera = {x: 0, y: 0};
 const session = new AudioSession(() => entities, s => ({url: 'a.wav', format: 'wav', volume: s.volume, loop: s.loop, rate: s.rate}), provider, {listener: () => camera});
 session.system.start!();
 expect(voices[0].volume).toBeCloseTo(0.4); expect(voices[0].pan).toBeCloseTo(1);
 Object.assign(at(source), {x: 0, y: 50}); session.system.update!(1 / 60);
 expect(voices[0].volume).toBeCloseTo(0.8); expect(voices[0].pan).toBeCloseTo(0);
 camera = {x: 0, y: 1150}; session.system.update!(1 / 60);
 expect(voices[0].volume).toBe(0);
 const ears = makeEntity('Ears'); ears.components.push({id: 'ears', type: 'audio.listener', version: 1, data: {}} as never); Object.assign(at(ears), {x: -550, y: 50}); entities.push(ears);
 session.system.update!(1 / 60);
 expect(voices[0].volume).toBeCloseTo(0.8 * (1 - 450 / 1000)); expect(voices[0].pan).toBeCloseTo(1);
 expect(session.state('bird')!.spatial!.gain).toBeCloseTo(0.55);
 session.dispose();
});
