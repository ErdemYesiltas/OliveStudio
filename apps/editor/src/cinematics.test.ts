import { describe, expect, it } from 'vitest';
import { changeClip, cinematicsSchema, clipList, compileClip, crossedCues, emptyCinematics, mainClip, sampleClip } from './cinematics';
import { createObject, sampleScene } from './scene';
import { isLayoutChild } from './layout';
import { recordTransforms } from './timelineRecording';
import type { TweenTrack } from './timeline';

describe('Director clip data', () => {
  it('leaves existing scene groups positionable when they do not author a layout', () => {
    const group = sampleScene.objects[0];
    expect(group.type).toBe('Container');
    if (group.type !== 'Container') return;
    expect(group.layout).toBeUndefined();
    expect(isLayoutChild(group.children[0], group)).toBe(false);
  });

  it('composes nested timing and sorts coincident cues in authored order', () => {
    const node = { ...createObject('Graphics'), id: 'card' };
    const tracks: TweenTrack[] = [{ id: 'x', target: node.id, property: 'x', keys: [
      { id: 'a', time: 0, value: 0, ease: 'linear' }, { id: 'b', time: 2, value: 400, ease: 'easeIn' },
    ] }];
    const library = cinematicsSchema.parse({ main: {
      nested: [{ id: 'one', clip: 'inner', start: 0.5, speed: 2 }],
      cues: [{ id: 'parent', kind: 'message', time: 1, name: 'parent', message: '' }],
    }, clips: [{ id: 'inner', name: 'Inner', tracks, cues: [{ id: 'nested', kind: 'message', time: 1, name: 'nested', message: '' }] }] });
    const clip = compileClip(clipList({ timeline: [], cinematics: library }, 'Main'), mainClip)!;
    expect(clip.duration).toBe(1.5);
    expect(sampleClip(clip, 0.25, () => node).get(node.id)?.get('x')).toBe(node.position.x);
    expect(sampleClip(clip, 1, () => node).get(node.id)?.get('x')).toBe(100);
    expect(crossedCues(clip.cues, 0.5, 1).map(item => item.cue.name)).toEqual(['parent', 'nested']);
    expect(crossedCues(clip.cues, 1, 1.2)).toHaveLength(0);
    expect(crossedCues(clip.cues, 1.25, 1).map(item => item.cue.name)).toEqual(['nested', 'parent']);
    expect(cinematicsSchema.safeParse({ ...library, clips: [{ ...library.clips[0], nested: [{ id: 'cycle', clip: mainClip, start: 0, speed: 1 }] }] }).success).toBe(false);
  });

  it('records over the sampled pose and preserves legacy authored transforms', () => {
    const node = { ...createObject('Graphics'), id: 'card', position: { x: 45, y: 20 } };
    const data = { timeline: [], cinematics: emptyCinematics };
    const clip = compileClip(clipList(data, 'Main'), mainClip)!;
    const target = { id: mainClip, time: 0.5, clip };
    const next = recordTransforms(data, target, [{ id: node.id, patch: { position: { x: 70, y: 20 } } }], () => node)!;
    expect(next.timeline).toHaveLength(1);
    expect(next.timeline[0].keys.map(({ time, value }) => [time, value])).toEqual([[0, 45], [0.5, 70]]);
    const revised = changeClip(next, mainClip, clip => ({ ...clip, cues: [{ id: 'cue', kind: 'message', time: 0, name: 'ready', message: '' }] }));
    expect(revised.cinematics?.main.cues).toHaveLength(1);
    expect(data.timeline).toEqual([]);
    expect(node.position.x).toBe(45);
  });
});
