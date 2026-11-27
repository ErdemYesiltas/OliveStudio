import { AtlasAttachmentLoader, SkeletonJson, TextureAtlas } from '@esotericsoftware/spine-core';
import { Spine } from '@esotericsoftware/spine-pixi-v8';
import type { Ticker } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { createObject } from './scene';
import { SceneAnimation, type SpineSignal } from '@olivestudio/engine/scene-animation';

function rig(withAudio = false, animationName: string | null = 'idle') {
  const atlas = new TextureAtlas('');
  const skeleton = new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData({
    skeleton: { spine: '4.2.120' },
    bones: [{ name: 'root' }, { name: 'hand', parent: 'root' }],
    slots: [{ name: 'hitbox', bone: 'hand', attachment: 'hand-box' }, { name: 'emitter', bone: 'hand', attachment: 'spark' }],
    skins: [{ name: 'default', attachments: { hitbox: { 'hand-box': {
      type: 'boundingbox', vertexCount: 4, vertices: [-4, -2, 4, -2, 4, 2, -4, 2],
    } }, emitter: { spark: { type: 'point', x: 12 } } } },
    { name: 'costume', attachments: { emitter: { spark: { type: 'point', x: 24 } } } },
    { name: 'equipment', attachments: { emitter: { spark: { type: 'point', x: 36 } } } }],
    ...(withAudio && { events: { beep: { audio: 'sfx/beep.wav', string: 'pulse' } } }),
    animations: {
      idle: { bones: { root: { translate: [{ x: 0 }, { time: 1, x: 0 }] } },
        ...(withAudio && { events: [{ name: 'beep', volume: 0.4, balance: -0.25 }, { name: 'beep', time: 0.25 }] }) },
      move: { bones: { root: { translate: [{ x: 100 }, { time: 0.2, x: 100 }] } } },
      gesture: { bones: { root: { translate: [{ x: 30 }, { time: 1, x: 60 }] } } },
      wave: { bones: { hand: { rotate: [{ value: 30 }, { time: 1, value: 30 }] } },
        ...(withAudio && { events: [{ name: 'beep' }, { name: 'beep', time: 0.25 }] }) },
    },
  });
  const spine = new Spine({ skeletonData: skeleton, autoUpdate: false });
  const node = { ...createObject('Spine'), animation: animationName };
  const signals: string[] = [];
  const messages: SpineSignal[] = [];
  const source = { kind: 'spine' as const, skeleton, createSpine: () => spine, dispose: () => atlas.dispose() };
  const animation = new SceneAnimation(source, node, signal => { signals.push(signal.animation); messages.push(signal); });
  const tick = (deltaMS: number, directorOnly = false) => animation.tick({ deltaMS } as Ticker, directorOnly);
  const bone = spine.skeleton.bones[0];
  return { node, animation, spine, source, signals, messages, tick, bone };
}

describe('Spine scene playback', () => {
  it('switches and restores gameplay skins without restarting a base or overlay track', () => {
    const { animation, spine, source, tick, node } = rig(false, 'gesture');
    try {
      animation.playSpineTrack('wave', { track: 1, loop: true });
      tick(200);
      const baseTime = spine.state.getCurrent(0)?.trackTime;
      const overlayTime = spine.state.getCurrent(1)?.trackTime;
      const offset = () => {
        const bone = animation.getSpineBonePose('hand')!;
        return (animation.getSpinePoint('emitter')!.x - bone.x) / bone.a;
      };
      expect(offset()).toBeCloseTo(12);
      animation.setSpineSkin('costume', ['equipment']);
      expect(offset()).toBeCloseTo(36);
      animation.sync(node);
      expect(offset()).toBeCloseTo(36);
      expect(() => animation.setSpineSkin('unknown')).toThrow('Unknown Spine skin');
      expect(offset()).toBeCloseTo(36);
      animation.resetSpineSkin();
      expect(offset()).toBeCloseTo(12);
      expect(spine.state.getCurrent(0)?.trackTime).toBe(baseTime);
      expect(spine.state.getCurrent(1)?.trackTime).toBe(overlayTime);
    } finally { animation.dispose(); spine.destroy(); source.dispose(); }
  });

  it('pauses, resumes and clears a gameplay overlay without interrupting the base or controlling a replacement', () => {
    const { animation, spine, source, tick, bone } = rig(false, 'gesture');
    try {
      animation.playSpineTrack('wave', { track: 1, loop: true });
      tick(100);
      const overlay = spine.state.getCurrent(1)!;
      const hand = spine.skeleton.findBone('hand')!;
      expect(overlay.trackTime).toBeCloseTo(0.1);
      expect(hand.rotation).toBeCloseTo(30);
      expect(animation.controlSpineTrack(1, 'pause')).toBe(true);
      const previousX = bone.x;
      tick(200);
      expect(overlay.trackTime).toBeCloseTo(0.1);
      expect(bone.x).toBeGreaterThan(previousX);
      expect(animation.controlSpineTrack(1, 'resume')).toBe(true);
      tick(100);
      expect(overlay.trackTime).toBeCloseTo(0.2);
      expect(animation.controlSpineTrack(1, 'stop')).toBe(true);
      expect(spine.state.getCurrent(1)).toBeNull();
      expect(hand.rotation).toBeCloseTo(0);
      expect(spine.state.getCurrent(0)?.trackTime).toBeCloseTo(0.4);
      animation.playSpineTrack('wave', { track: 1 });
      animation.direct('wave', { track: 1 });
      expect(animation.controlSpineTrack(1, 'stop')).toBe(false);
      expect(spine.state.getCurrent(1)).not.toBeNull();
    } finally { animation.dispose(); spine.destroy(); source.dispose(); }
  });

  it('reads an active point attachment after the animation rotates its bone', () => {
    const { animation, spine, source, tick } = rig();
    try {
      expect(animation.getSpinePoint('emitter')).toMatchObject({ name: 'spark', x: 12, y: 0 });
      animation.direct('wave');
      tick(100, true);
      const point = animation.getSpinePoint('emitter')!;
      expect(point.x).toBeCloseTo(12 * Math.cos(Math.PI / 6));
      expect(Math.abs(point.y)).toBeCloseTo(6);
      expect(Math.abs(point.rotation)).toBeCloseTo(30);
      expect(animation.getSpinePoint('hitbox')).toBeUndefined();
      spine.skeleton.findSlot('emitter')!.setAttachment(null);
      expect(animation.getSpinePoint('emitter')).toBeUndefined();
    } finally { animation.dispose(); spine.destroy(); source.dispose(); }
  });

  it('reads animated bone positions and active bounding box vertices without modifying the rig', () => {
    const { animation, spine, source, tick } = rig();
    try {
      const initial = animation.getSpineBoundingBoxes('hitbox')[0];
      expect(initial).toMatchObject({ slot: 'hitbox', name: 'hand-box' });
      expect(initial.vertices).toHaveLength(4);
      expect(animation.getSpineBonePose('hand')).toMatchObject({ x: 0, y: 0 });
      animation.direct('move', { mixDuration: 0 });
      tick(100, true);
      expect(animation.getSpineBonePose('hand')).toMatchObject({ x: 100, y: 0 });
      const box = animation.getSpineBoundingBoxes()[0];
      expect(box.vertices.map(({ x }) => x)).toEqual(initial.vertices.map(({ x }) => x + 100));
      expect(box.vertices.map(({ y }) => y)).toEqual(initial.vertices.map(({ y }) => y));
      expect(animation.getSpineBonePose('missing')).toBeUndefined();
      expect(animation.getSpineBoundingBoxes('missing')).toEqual([]);
      spine.skeleton.findSlot('hitbox')!.setAttachment(null);
      expect(animation.getSpineBoundingBoxes()).toEqual([]);
    } finally { animation.dispose(); spine.destroy(); source.dispose(); }
  });

  it('advances parallel Director tracks independently and preserves a paused track pose', async () => {
    const { animation, spine, source, tick, bone, messages } = rig(true);
    try {
      const base = animation.direct('move', { track: 0, mixDuration: 0 });
      const overlay = animation.direct('wave', { track: 1, weight: 0.5 });
      tick(100, true);
      expect(bone.x).toBeCloseTo(100);
      expect(spine.skeleton.bones[1].rotation).toBeCloseTo(15);
      expect(messages.filter(signal => signal.type === 'spine.event')).toMatchObject([{ track: 1, time: 0 }]);
      overlay.pause();
      tick(400, true);
      expect(spine.state.getCurrent(1)?.trackTime).toBeCloseTo(0.1);
      expect(spine.skeleton.bones[1].rotation).toBeCloseTo(15);
      expect(messages.filter(signal => signal.type === 'spine.event')).toHaveLength(1);
      await base.finished;
      overlay.resume();
      tick(900, true);
      expect(animation.directing).toBe(false);
      await overlay.finished;
      expect(messages.filter(signal => signal.type === 'spine.event')).toMatchObject([
        { track: 1, time: 0 }, { track: 1, time: 0.25 },
      ]);
    } finally { animation.dispose(); spine.destroy(); source.dispose(); }
  });

  it('holds authored tracks during Director-only playback and resumes their first frame events on the game clock', () => {
    const { node, animation, spine, source, tick, messages } = rig(true);
    try {
      animation.sync({ ...node, playback: {
        queue: [],
        tracks: [{ weight: 0.5, clips: [{ animation: 'wave', loop: true, delay: 0 }] }],
      } });
      expect(() => animation.direct('gesture', { track: 0.5 })).toThrow();
      animation.direct('gesture', { track: 2 });
      tick(500, true);
      expect(spine.state.getCurrent(0)?.trackTime).toBe(0);
      expect(spine.state.getCurrent(1)?.trackTime).toBe(0);
      expect(spine.state.getCurrent(2)?.trackTime).toBeCloseTo(0.5);
      expect(messages).toHaveLength(0);
      tick(100);
      expect(messages).toMatchObject([{ track: 0, time: 0 }, { track: 1, time: 0 }]);
    } finally { animation.dispose(); spine.destroy(); source.dispose(); }
  });

  it('plays queued clips and weighted overlays concurrently on the game clock', () => {
    const { node, animation, spine, source, messages, tick, bone } = rig(true);
    try {
      const playback = {
        queue: [{ animation: 'move', loop: false, delay: 0.2 }],
        tracks: [{ weight: 0.5, clips: [{ animation: 'wave', loop: true, delay: 0 }] }],
      };
      animation.sync({ ...node, loop: true, playback });
      expect(spine.skeleton.bones[1].rotation).toBeCloseTo(15);
      expect(spine.state.getCurrent(0)?.next?.delay).toBeCloseTo(1.2);
      tick(100);
      expect(messages).toContainEqual(expect.objectContaining({ type: 'spine.event', animation: 'wave', track: 1, time: 0 }));
      animation.sync({ ...node, loop: true, playback, playing: false });
      tick(500);
      expect(spine.state.getCurrent(0)?.trackTime).toBeCloseTo(0.1);
      expect(spine.state.getCurrent(1)?.trackTime).toBeCloseTo(0.1);
      animation.sync({ ...node, loop: true, playback });
      for (let step = 0; step < 12; step++) tick(100);
      expect(spine.state.getCurrent(0)?.animation?.name).toBe('move');
      expect(spine.state.getCurrent(0)?.loop).toBe(false);
      animation.sync({ ...node, loop: true, playback });
      expect(spine.state.getCurrent(0)?.loop).toBe(false);
      expect(bone.x).toBeCloseTo(100);
      tick(400);
      expect(animation.active).toBe(true);
      expect(spine.skeleton.bones[1].rotation).toBeCloseTo(15);
      animation.sync({ ...node, playback: { ...playback, tracks: [] } });
      expect(spine.skeleton.bones[1].rotation).toBeCloseTo(0);
      expect(animation.active).toBe(false);
    } finally { animation.dispose(); spine.destroy(); source.dispose(); }
  });
  it('emits audio metadata and delivers the first frame event only when the scene clock advances', () => {
    const { animation, spine, source, tick, messages } = rig(true, null);
    try {
      expect(messages).toHaveLength(0);
      tick(100);
      expect(messages).toMatchObject([{ type: 'spine.event', name: 'beep', time: 0, text: 'pulse',
        audio: { path: 'sfx/beep.wav', volume: 0.4, balance: -0.25 } }]);
      tick(200);
      expect(messages).toHaveLength(2);
      expect(messages[1]).toMatchObject({ time: 0.25, audio: { volume: 1, balance: 0 } });
    } finally { animation.dispose(); spine.destroy(); source.dispose(); }
  });
  it('keeps the same display and applies a direction-specific blend in game-clock seconds', async () => {
    const { node, animation, spine, source, signals, tick, bone } = rig();
    try {
      const configured = { ...node, mix: { duration: 0.25, pairs: [{ from: 'idle', to: 'move', duration: 0.8 }] } };
      animation.sync(configured);
      expect(animation.matches(source, { ...configured, animation: 'move' })).toBe(true);
      const control = animation.direct('move', { speed: 2 });
      const completed = control.finished.then(() => true);
      let settled = false;
      void completed.then(() => { settled = true; });
      tick(200);
      expect(bone.x).toBeCloseTo(25);
      expect(signals).toEqual(['move']);
      control.pause();
      tick(500);
      expect(bone.x).toBeCloseTo(25);
      control.resume();
      tick(300);
      await Promise.resolve();
      expect(settled).toBe(false);
      expect(bone.x).toBeCloseTo(62.5);
      tick(300);
      tick(1);
      await expect(completed).resolves.toBe(true);
      expect(bone.x).toBeCloseTo(100);
      expect(spine.state.getCurrent(0)?.mixingFrom).toBeNull();
      expect(animation.directing).toBe(false);
      expect(signals).toEqual(['move']);
    } finally { animation.dispose(); spine.destroy(); source.dispose(); }
  });

  it('uses the default across model changes, and immediately displays an edit while the game clock is stopped', () => {
    const { node, animation, spine, source, tick, bone } = rig();
    try {
      const configured = { ...node, mix: { duration: 0.5, pairs: [] } };
      animation.sync({ ...configured, animation: 'move' }, true);
      tick(250);
      expect(bone.x).toBeCloseTo(50);
      animation.sync({ ...configured, animation: 'gesture' });
      expect(bone.x).toBeCloseTo(30);
      expect(animation.display).toBe(spine);
    } finally { animation.dispose(); spine.destroy(); source.dispose(); }
  });

  it('supports one-step overrides and lands a stopped looping step on its last frame without emitting events', async () => {
    const { node, animation, spine, source, tick, bone, signals } = rig();
    try {
      animation.sync({ ...node, mix: { duration: 1, pairs: [] } });
      const control = animation.direct('gesture', { loop: true, mixDuration: 0.4 });
      tick(200);
      expect(bone.x).toBeCloseTo(18);
      control.finish();
      await control.finished;
      expect(bone.x).toBeCloseTo(60);
      expect(signals).toEqual([]);
    } finally { animation.dispose(); spine.destroy(); source.dispose(); }
  });
});
