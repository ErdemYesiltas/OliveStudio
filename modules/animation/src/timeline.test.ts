import {expect, it} from 'vitest';
import {gsapProvider} from '@rewrite/tween-gsap';
import {makeEntity, type Entity} from '@rewrite/scene';
import type {TweenChannel} from '@rewrite/tween';
import {AnimationSession, compileAnimations, mixColor, newClip, type AnimationClip, type AnimationEvent} from './index';

const channels: TweenChannel[] = [{componentType: 'scene.transform2d', version: 1, property: 'x', titleKey: 'x'}];
const key = (time: number, value: number | string | boolean, ease: string = 'linear') => ({id: crypto.randomUUID(), time, value, ease}) as AnimationClip['tracks'][number]['keys'][number];
function scene() {
 const box = makeEntity('Box', 0, 0);
 box.components.push({id: 'shape', type: 'pixi.shape', version: 1, data: {alpha: 1, kind: 'rect', width: 10, height: 10, color: '#000000', strokeWidth: 0}} as never);
 box.components.push({id: 'label', type: 'pixi.text', version: 1, data: {alpha: 1, text: 'one', fontSize: 20, color: '#ffffff', font: ''}} as never);
 const t = box.components[0].id, clip = newClip('Main');
 clip.duration = 1;
 clip.tracks.push({id: 'x', entityId: box.id, componentId: t, property: 'x', keys: [key(0, 0), key(1, 100)]});
 clip.markers.push({id: 'm1', time: .25, name: 'quarter', message: 'hit', action: {service: 'audio', method: 'play', targetId: 'snd'}}, {id: 'm2', time: .75, name: 'late'});
 box.components.push({id: 'player', type: 'animation.player', version: 1, data: {activeClipId: clip.id, autoplay: false, clips: [clip]}} as never);
 return {box, clip, t};
}
const x = (e: Entity) => (e.components[0].data as {x: number}).x;

it('RxJS runner: speed, pause/resume, reverse with markers in playing order, one completion per play, seeks are silent', () => {
 const {box} = scene(), events: AnimationEvent[] = [], s = new AnimationSession(() => [box], channels, gsapProvider, {event: e => events.push(e)});
 s.start();
 expect(x(box)).toBe(0); // autoplay off: nothing posed
 s.play('player'); s.setSpeed('player', 2);
 s.advance(.25); expect(x(box)).toBeCloseTo(50);
 s.pause('player'); s.advance(.25); expect(x(box)).toBeCloseTo(50);
 s.resume('player'); s.advance(.25); expect(x(box)).toBe(100);
 expect(events.map(e => [e.kind, e.name])).toEqual([['marker', 'quarter'], ['marker', 'late'], ['complete', 'complete']]);
 expect(events[0]).toMatchObject({message: 'hit', action: {service: 'audio', method: 'play', targetId: 'snd'}, reverse: false});
 events.length = 0;
 s.reverse('player'); s.setSpeed('player', 1); s.resume('player');
 s.advance(.5); expect(x(box)).toBeCloseTo(50);
 s.advance(.6); expect(x(box)).toBe(0);
 expect(events.map(e => [e.kind, e.name, e.reverse])).toEqual([['marker', 'late', true], ['marker', 'quarter', true], ['complete', 'complete', false]]);
 events.length = 0;
 s.seekPlayer('player', .6); expect(x(box)).toBeCloseTo(60); expect(events).toEqual([]);
 expect(s.state('player')).toMatchObject({time: .6, total: 1, running: false, speed: 1, direction: -1});
 expect(() => s.setSpeed('player', 0)).toThrow('Speed');
 s.dispose();
});

it('more channels: colour blends, on/off and text step, visibility, any numeric field; unknown properties are errors', () => {
 const {box, clip} = scene();
 clip.tracks.push(
  {id: 'c', entityId: box.id, componentId: 'shape', property: 'color', keys: [key(0, '#000000'), key(1, '#ff0080')]},
  {id: 'v', entityId: box.id, componentId: '@entity', property: 'active', keys: [key(0, true, 'hold'), key(.5, false, 'hold')]},
  {id: 'txt', entityId: box.id, componentId: 'label', property: 'text', keys: [key(0, 'one', 'hold'), key(.5, 'two', 'hold')]},
  {id: 'w', entityId: box.id, componentId: 'shape', property: 'strokeWidth', keys: [key(0, 0), key(1, 8)]},
 );
 const s = new AnimationSession(() => [box], channels, gsapProvider);
 s.start(); s.play('player'); s.advance(.5);
 const shape = box.components.find(c => c.id === 'shape')!.data as {color: string; strokeWidth: number}, label = box.components.find(c => c.id === 'label')!.data as {text: string};
 expect(shape.color).toBe(mixColor('#000000', '#ff0080', .5)); expect(shape.color).toBe('#800040');
 expect(box.active).toBe(false); expect(label.text).toBe('two'); expect(shape.strokeWidth).toBeCloseTo(4);
 s.seekPlayer('player', .25); expect(box.active).toBe(true); expect(label.text).toBe('one');
 s.dispose();
 clip.tracks.push({id: 'bad', entityId: box.id, componentId: 'shape', property: 'kind', keys: [key(0, 1), key(1, 2)]});
 expect(compileAnimations([box], channels).errors.join()).toContain('kind keys must be text');
 clip.tracks.at(-1)!.property = 'nope';
 expect(compileAnimations([box], channels).errors.join()).toContain('pixi.shape.nope cannot be animated');
});

it('nested clips follow the parent time with offset and speed, fire their own markers, share channels with their player, refuse loops', () => {
 const {box, clip} = scene(), child = makeEntity('Child', 0, 0), inner = newClip('Spin');
 inner.duration = 1;
 inner.tracks.push({id: 'r', entityId: child.id, componentId: child.components[0].id, property: 'x', keys: [key(0, 0), key(1, 10)]});
 inner.markers.push({id: 'im', time: .5, name: 'inner-half'});
 child.components.push({id: 'child-player', type: 'animation.player', version: 1, data: {activeClipId: inner.id, autoplay: false, clips: [inner]}} as never);
 clip.duration = 2;
 clip.clips.push({id: 'n1', playerId: 'child-player', clipId: inner.id, start: .5, speed: 2});
 const events: AnimationEvent[] = [], s = new AnimationSession(() => [box, child], channels, gsapProvider, {event: e => events.push(e)});
 s.start(); expect(s.errors).toEqual([]);
 s.play('player');
 s.advance(.5); expect(x(child)).toBe(0);
 s.advance(.25); expect(x(child)).toBeCloseTo(5);
 s.advance(.5); expect(x(child)).toBe(10);
 expect(events.filter(e => e.kind === 'marker').map(e => [e.name, e.playerId])).toEqual([['quarter', 'player'], ['late', 'player'], ['inner-half', 'child-player']]); // same instant (0.75 s): the parent's markers first
 // The child's own player can still play it standalone.
 s.play('child-player'); s.advance(.5); expect(x(child)).toBeCloseTo(5);
 s.dispose();
 inner.clips.push({id: 'back', playerId: 'player', clipId: clip.id, start: 0, speed: 1});
 expect(compileAnimations([box, child], channels).errors.join()).toContain('loop');
});

it('play switches clips at runtime and keeps the speed', () => {
 const {box, clip} = scene(), other = newClip('Other');
 other.tracks.push({id: 'o', entityId: box.id, componentId: box.components[0].id, property: 'x', keys: [key(0, 500), key(1, 600)]});
 const player = box.components.find(c => c.id === 'player')!.data as {clips: AnimationClip[]};
 player.clips.push(other);
 const s = new AnimationSession(() => [box], channels, gsapProvider);
 s.start(); s.play('player'); s.setSpeed('player', 2); s.advance(.25); expect(x(box)).toBeCloseTo(50);
 s.play('player', other.id); s.advance(.25); expect(x(box)).toBeCloseTo(550);
 expect(s.state('player')).toMatchObject({clipId: other.id, speed: 2});
 expect(clip.id).not.toBe(other.id);
 s.dispose();
});

it('cross-fades to another clip from the current pose over game time; colours blend; text switches at once', () => {
 const {box, clip, t} = scene(), other = newClip('Away');
 other.duration = 1;
 other.tracks.push({id: 'x2', entityId: box.id, componentId: t, property: 'x', keys: [key(0, 500), key(1, 500)]}, {id: 'c2', entityId: box.id, componentId: 'shape', property: 'color', keys: [key(0, '#ffffff'), key(1, '#ffffff')]}, {id: 't2', entityId: box.id, componentId: 'label', property: 'text', keys: [key(0, 'two')]});
 (box.components[3].data as {clips: AnimationClip[]}).clips.push(other);
 const s = new AnimationSession(() => [box], channels, gsapProvider);
 s.start(); s.play('player'); s.advance(.5);
 expect(x(box)).toBeCloseTo(50, 5);
 s.crossFade('player', 'Away', .5);
 s.advance(.25);
 expect(x(box)).toBeCloseTo(50, 5); // the first blended frame still shows the old pose
 s.advance(.125);
 expect(x(box)).toBeCloseTo(50 + 450 * .5, 5);
 expect((box.components[1].data as {color: string}).color).toBe(mixColor('#000000', '#ffffff', .5));
 expect((box.components[2].data as {text: string}).text).toBe('two');
 s.advance(.25); s.advance(.1);
 expect(x(box)).toBe(500);
 expect(s.state('player')?.clipId).toBe(other.id);
 expect(() => s.crossFade('player', 'Nowhere', 1)).toThrow('No clip named "Nowhere"');
 s.play('player', clip.id); s.advance(.5);
 expect(x(box)).toBeCloseTo(50, 5); // a plain switch does not blend
 s.dispose();
});
