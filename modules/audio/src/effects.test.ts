import {expect, it} from 'vitest';
import {AudioSession, MixerSchema, busEffects, defaultMixer, effectsActive, noBusEffects, reverbImpulse, voiceSpec, type AudioProvider, type BusEffects} from './index';

it('bus effects: schema limits, defaults per bus, active only when they change the sound', () => {
 const mixer = MixerSchema.parse({...defaultMixer, effects: {music: {lowpass: 800, reverb: 0, reverbSeconds: 2}, sfx: {reverb: .4}}});
 expect(busEffects(mixer, 'music')).toEqual({lowpass: 800, reverb: 0, reverbSeconds: 2});
 expect(busEffects(mixer, 'sfx')).toEqual({lowpass: 20000, reverb: .4, reverbSeconds: 2});
 expect(busEffects(mixer, 'ui')).toEqual(noBusEffects);
 expect([effectsActive(busEffects(mixer, 'music')), effectsActive(busEffects(mixer, 'sfx')), effectsActive(noBusEffects)]).toEqual([true, true, false]);
 expect(() => MixerSchema.parse({...defaultMixer, effects: {music: {lowpass: 10}}})).toThrow();
 expect(() => MixerSchema.parse({...defaultMixer, effects: {voice: {}}})).toThrow();
 expect(MixerSchema.parse(defaultMixer).effects).toBeUndefined();
});

it('reverb impulse: seeded stereo noise of the given length that decays to silence', () => {
 const [left, right] = reverbImpulse(1000, 2);
 expect([left.length, right.length]).toEqual([2000, 2000]);
 const energy = (a: Float32Array, from: number, to: number) => a.slice(from, to).reduce((s, v) => s + v * v, 0);
 expect(energy(left, 0, 200)).toBeGreaterThan(energy(left, 1600, 1800) * 20);
 expect(Math.abs(left[1999])).toBeLessThan(1e-6);
 expect(reverbImpulse(1000, 2)[0]).toEqual(left);
 expect(left).not.toEqual(right);
});

it('the session sends each bus its effects at start and on mix changes, and clears them when disposed; voices know their bus', () => {
 const calls: string[] = [], provider: AudioProvider = {id: 'fx', supports: () => true, create: () => { throw Error('unused'); }, setBusEffects: (bus, fx: BusEffects) => calls.push(`${bus}:${fx.lowpass}/${fx.reverb}`), busEffects: () => ({music: {...noBusEffects, voices: 0}})};
 const mix = MixerSchema.parse({...defaultMixer, effects: {music: {lowpass: 500, reverb: 0, reverbSeconds: 2}}});
 const session = new AudioSession(() => [], () => { throw Error('unused'); }, provider, {mixer: mix});
 expect(calls).toEqual(['music:500/0', 'sfx:20000/0', 'ui:20000/0']);
 session.setMixer({...mix, effects: {ui: {lowpass: 20000, reverb: .5, reverbSeconds: 1}}});
 expect(calls.slice(3)).toEqual(['music:20000/0', 'sfx:20000/0', 'ui:20000/0.5']);
 expect(session.effects).toEqual({music: {...noBusEffects, voices: 0}});
 session.dispose();
 expect(calls.slice(6)).toEqual(['music:20000/0', 'sfx:20000/0', 'ui:20000/0']);
 const asset = {id: 'a', type: 'audio.clip', name: 'a', metadata: {format: 'wav', duration: 1, sampleRate: 44100, channels: 1, codec: 'pcm', processedBytes: 10, pipeline: 'x'}} as never;
 expect(voiceSpec({volume: 1, loop: false, rate: 1, bus: 'music'}, asset, () => 'u', provider).bus).toBe('music');
});
