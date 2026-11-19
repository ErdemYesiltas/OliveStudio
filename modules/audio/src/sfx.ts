import {z} from 'zod';

/**
 * Sound Lab: a small procedural synthesizer for game sound effects (in the spirit of sfxr). Pure and deterministic:
 * the same parameters give the same samples, so a sound can be regenerated, tweaked and saved as a WAV asset.
 */
export const waveforms = ['square', 'sawtooth', 'sine', 'triangle', 'noise'] as const;
export const SfxSchema = z.object({
 wave: z.enum(waveforms).default('square'),
 /** Start pitch in Hz and how much it slides per second (octaves; negative falls). */
 frequency: z.number().min(20).max(4000).default(440), slide: z.number().min(-8).max(8).default(0),
 /** Duty cycle of the square wave (0.05–0.95). */
 duty: z.number().min(.05).max(.95).default(.5),
 /** Envelope seconds and the sustain level's punch. */
 attack: z.number().min(0).max(2).default(.005), sustain: z.number().min(0).max(3).default(.1), decay: z.number().min(.005).max(3).default(.2), punch: z.number().min(0).max(1).default(0),
 /** Vibrato depth (semitones) and speed (Hz); arpeggio jump (semitones) after `arpTime` seconds (0 = off). */
 vibrato: z.number().min(0).max(12).default(0), vibratoSpeed: z.number().min(0).max(40).default(6),
 arp: z.number().min(-24).max(24).default(0), arpTime: z.number().min(0).max(2).default(0),
 /** Low-pass cutoff (Hz, 0 = off) and output volume. */
 lowpass: z.number().min(0).max(20000).default(0), volume: z.number().min(0).max(1).default(.6),
}).strict();
export type Sfx = z.infer<typeof SfxSchema>;
export const sfxDuration = (p: Sfx) => p.attack + p.sustain + p.decay;

/** A tiny seeded random generator (mulberry32) so presets are repeatable. */
export function seeded(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export const sfxPresets = ['pickup', 'jump', 'laser', 'explosion', 'powerup', 'hit', 'blip', 'click'] as const;
export type SfxPreset = typeof sfxPresets[number];
/** A variation of a preset kind: the seed picks the details, so "Pickup #12" always sounds the same. */
export function presetSfx(kind: SfxPreset, seed: number): Sfx {
 const r = seeded(seed * 9973 + sfxPresets.indexOf(kind) + 1), between = (a: number, b: number) => a + (b - a) * r();
 const base = SfxSchema.parse({});
 switch (kind) {
  case 'pickup': return {...base, wave: r() < .5 ? 'square' : 'sine', frequency: between(700, 1300), sustain: between(.03, .08), decay: between(.1, .25), punch: between(.3, .6), arp: between(4, 12), arpTime: between(.04, .08)};
  case 'jump': return {...base, wave: 'square', duty: between(.2, .5), frequency: between(250, 450), slide: between(1.2, 3), sustain: between(.05, .12), decay: between(.1, .2)};
  case 'laser': return {...base, wave: r() < .6 ? 'sawtooth' : 'square', frequency: between(900, 1800), slide: -between(3, 6), sustain: between(.04, .1), decay: between(.08, .2), duty: between(.1, .4)};
  case 'explosion': return {...base, wave: 'noise', frequency: between(80, 300), slide: -between(.5, 2), attack: .002, sustain: between(.1, .3), decay: between(.3, .7), punch: between(.4, .8), lowpass: between(1200, 4000), volume: .7};
  case 'powerup': return {...base, wave: r() < .5 ? 'square' : 'triangle', frequency: between(300, 600), slide: between(1, 2.5), sustain: between(.15, .3), decay: between(.15, .3), vibrato: between(.3, 1.5), vibratoSpeed: between(8, 16)};
  case 'hit': return {...base, wave: r() < .5 ? 'noise' : 'square', frequency: between(150, 400), slide: -between(2, 5), attack: .001, sustain: between(.02, .06), decay: between(.08, .18), punch: between(.4, .9), lowpass: between(2000, 6000)};
  case 'blip': return {...base, wave: r() < .5 ? 'square' : 'sine', frequency: between(500, 1100), sustain: between(.03, .06), decay: between(.03, .08)};
  case 'click': return {...base, wave: 'square', duty: .5, frequency: between(1500, 3000), attack: 0, sustain: .005, decay: between(.01, .03), volume: .4};
 }
}

/** The samples of a sound (mono, −1…1). */
export function renderSfx(input: Sfx, sampleRate = 44100): Float32Array {
 const p = SfxSchema.parse(input), length = Math.max(1, Math.round(sfxDuration(p) * sampleRate)), out = new Float32Array(length), noise = seeded(Math.round(p.frequency * 1000));
 let phase = 0, lp = 0, held = 0, heldPhase = -1;
 const alpha = p.lowpass > 0 ? 1 - Math.exp(-2 * Math.PI * p.lowpass / sampleRate) : 1;
 for (let i = 0; i < length; i++) {
  const t = i / sampleRate;
  let f = p.frequency * Math.pow(2, p.slide * t);
  if (p.vibrato) f *= Math.pow(2, p.vibrato / 12 * Math.sin(2 * Math.PI * p.vibratoSpeed * t));
  if (p.arp && p.arpTime && t >= p.arpTime) f *= Math.pow(2, p.arp / 12);
  f = Math.max(10, Math.min(20000, f));
  phase = (phase + f / sampleRate) % 1;
  let v: number;
  switch (p.wave) {
   case 'square': v = phase < p.duty ? 1 : -1; break;
   case 'sawtooth': v = 2 * phase - 1; break;
   case 'sine': v = Math.sin(2 * Math.PI * phase); break;
   case 'triangle': v = 1 - 4 * Math.abs(phase - .5); break;
   default: { const step = Math.floor(phase * 2); if (step !== heldPhase) { heldPhase = step; held = noise() * 2 - 1; } v = held; }
  }
  const env = t < p.attack ? t / Math.max(1e-6, p.attack) : t < p.attack + p.sustain ? 1 + p.punch * (1 - (t - p.attack) / Math.max(1e-6, p.sustain)) : Math.max(0, 1 - (t - p.attack - p.sustain) / p.decay);
  lp += alpha * (v - lp);
  out[i] = Math.max(-1, Math.min(1, lp * env * p.volume));
 }
 return out;
}

/** 16-bit PCM mono WAV bytes. */
export function encodeWav(samples: Float32Array, sampleRate = 44100): Uint8Array {
 const bytes = new Uint8Array(44 + samples.length * 2), view = new DataView(bytes.buffer), text = (at: number, s: string) => { for (let i = 0; i < s.length; i++) bytes[at + i] = s.charCodeAt(i); };
 text(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); text(8, 'WAVE'); text(12, 'fmt ');
 view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
 text(36, 'data'); view.setUint32(40, samples.length * 2, true);
 for (let i = 0; i < samples.length; i++) view.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), true);
 return bytes;
}
