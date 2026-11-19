import {expect, it} from 'vitest';
import {SfxSchema, encodeWav, presetSfx, renderSfx, sfxDuration, sfxPresets} from './sfx';

it('renders repeatable, bounded samples for every preset and waveform', () => {
 for (const kind of sfxPresets) {
  const a = presetSfx(kind, 3), b = presetSfx(kind, 3), c = presetSfx(kind, 4);
  expect(a).toEqual(b); expect(a).not.toEqual(c);
  const samples = renderSfx(a, 8000);
  expect(samples.length).toBe(Math.max(1, Math.round(sfxDuration(a) * 8000)));
  expect(Math.max(...samples.map(Math.abs))).toBeLessThanOrEqual(1);
  expect(samples.some(v => Math.abs(v) > .05)).toBe(true);
  expect(renderSfx(a, 8000)).toEqual(samples);
 }
 for (const wave of ['square', 'sawtooth', 'sine', 'triangle', 'noise'] as const) expect(renderSfx(SfxSchema.parse({wave, sustain: .05, decay: .05}), 8000).some(v => v !== 0)).toBe(true);
 expect(() => SfxSchema.parse({frequency: 5})).toThrow();
});

it('fades out at the end and encodes 16-bit mono WAV', () => {
 const samples = renderSfx(SfxSchema.parse({wave: 'sine', frequency: 440, attack: 0, sustain: .1, decay: .1}), 8000);
 expect(Math.abs(samples[samples.length - 1])).toBeLessThan(.02);
 const wav = encodeWav(samples, 8000), view = new DataView(wav.buffer);
 expect(new TextDecoder().decode(wav.slice(0, 4))).toBe('RIFF'); expect(new TextDecoder().decode(wav.slice(8, 12))).toBe('WAVE');
 expect(view.getUint16(22, true)).toBe(1); expect(view.getUint32(24, true)).toBe(8000); expect(view.getUint16(34, true)).toBe(16);
 expect(view.getUint32(40, true)).toBe(samples.length * 2); expect(wav.length).toBe(44 + samples.length * 2);
});
