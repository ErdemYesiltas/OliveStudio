import {expect, it} from 'vitest';
import {EffectsSchema, MaskSchema, VisualEffectSchema, effectPlan, effectsDefaults, effectsDefinition, maskDefinition, migrateVisualEffects} from './effects';
import {flipbookFrame} from './flipbook';
import {ParticlesSchema, objectDefinitions, particleState} from './objects';

it('neutral effects add no filters; each enabled effect adds one in a fixed order', () => {
 expect(effectPlan(effectsDefaults)).toEqual([]);
 expect(effectPlan({...effectsDefaults, brightness: 1.2, blur: 4, outlineWidth: 2, glowStrength: 2, shadowAlpha: .5, pixelate: 4, noise: .2})).toEqual(['color', 'blur', 'outline', 'glow', 'shadow', 'pixelate', 'noise']);
 expect(effectPlan({...effectsDefaults, pixelate: 1, hue: 10})).toEqual(['color']);
 for (const d of [effectsDefinition, maskDefinition]) expect(d.parse(d.defaults())).toEqual(d.defaults());
 expect(() => EffectsSchema.parse({...effectsDefaults, blendMode: 'glow'})).toThrow();
 expect(() => MaskSchema.parse({...(maskDefinition.defaults() as object), width: 0})).toThrow();
 expect(VisualEffectSchema.array().parse(migrateVisualEffects({...effectsDefaults, blur: 4, shadowColor: '#ffffff'}))).toEqual([
  {type: 'blur', enabled: true, settings: {blur: 4}},
  {type: 'shadow', enabled: true, settings: {shadowAlpha: 0, shadowColor: '#ffffff', shadowX: 4, shadowY: 4, shadowBlur: 2}},
 ]);
});

it('sprite sheet play restarts from startedAt and stop freezes the reached frame', () => {
 const p = {frames: 4, fps: 10, loop: true, autoplay: false};
 expect(flipbookFrame(p, 3)).toBe(0);
 expect(flipbookFrame({...p, startedAt: 2}, 2.25)).toBe(2);
 expect(flipbookFrame({...p, startedAt: 2, stoppedAt: 2.15}, 9)).toBe(1);
 expect(flipbookFrame({...p, autoplay: true, stoppedAt: 0.35}, 9)).toBe(3);
 expect(flipbookFrame({...p, autoplay: true, startedAt: null, stoppedAt: null}, 0.1)).toBe(1);
});

it('particles: idle until started, burst once, stop lets living particles finish', () => {
 const base = ParticlesSchema.parse({...(objectDefinitions[4].defaults() as object), count: 10, lifetime: 1});
 const alive = (p: typeof base, t: number) => Array.from({length: p.count}, (_, i) => particleState(p, i, t)).filter(s => s.alive).length;
 expect(alive({...base, autoplay: false}, 5)).toBe(0);
 expect(alive({...base, autoplay: false, startedAt: 2}, 2.55)).toBe(6);
 const burst = {...base, emission: 'burst' as const, autoplay: false, startedAt: 3};
 expect([alive(burst, 2.9), alive(burst, 3.5), alive(burst, 4.01)]).toEqual([0, 10, 0]);
 expect(alive(base, 0)).toBe(10);
 expect(alive({...base, stoppedAt: 1}, 1.5)).toBe(5);
 expect(alive({...base, stoppedAt: 1}, 2.01)).toBe(0);
});

it('camera: follow centres the target, shake decays to nothing; tilemap helpers paint and resize by cell', async () => {
 const {cameraView, viewOffset, idleCamera} = await import('./runtime-camera');
 const {cellsAlong, resizeTiles, tileAt, TilemapSchema} = await import('./tilemap');
 const stage = {width: 960, height: 540}, offset = (state: Parameters<typeof cameraView>[0], time: number, target?: {x: number; y: number}) => viewOffset(cameraView(state, time, stage, undefined, target), stage);
 expect(offset({...idleCamera(), followId: 'p'}, 1, {x: 1000, y: 270})).toEqual({x: -520, y: 0});
 const shaking = {followId: null, shake: {startedAt: 2, duration: .5, amplitude: 10}};
 expect(offset({...shaking}, 1.9)).toEqual({x: 0, y: 0});
 const mid = offset({...shaking}, 2.1);
 expect(Math.abs(mid.x) + Math.abs(mid.y)).toBeGreaterThan(0);
 expect(offset({...shaking}, 2.5)).toEqual({x: 0, y: 0});
 expect(offset({...shaking}, 2.2)).toEqual(offset({...shaking}, 2.2));
 const map = TilemapSchema.parse({assetId: '', tileWidth: 10, tileHeight: 10, columns: 4, rows: 3, alpha: 1, tiles: Array(12).fill(-1)});
 expect(tileAt(map, 15, 25)).toEqual({column: 1, row: 2, index: 9});
 expect(tileAt(map, -1, 0)).toBeNull();
 expect(cellsAlong(map, {x: 1, y: 1}, {x: 39, y: 1})).toEqual([0, 1, 2, 3]);
 expect(resizeTiles({...map, tiles: map.tiles.map((_, i) => i)}, 2, 4)).toEqual([0, 1, 4, 5, 8, 9, -1, -1]);
 expect(() => TilemapSchema.parse({...map, tiles: [1]})).toThrow('Tile count');
});
