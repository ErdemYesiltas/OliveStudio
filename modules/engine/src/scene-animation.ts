import { AnimatedSprite, type Container, type PointData, type Texture, type Ticker } from 'pixi.js';
import { BoundingBoxAttachment, PointAttachment, Vector2, type TrackEntry } from '@esotericsoftware/spine-core';
import type { Spine } from '@esotericsoftware/spine-pixi-v8';
import type { DirectorAnimationControl } from './aperion-director/host.js';
import { applySpineSkins, type SpineSource } from './spine.js';

export const maxDirectorSpineTrack = 255;
export type AnimationSource = SpineSource |
  { kind: 'sheet'; clips: Map<string, Texture[]>; frames: Texture[]; dispose: () => void };
export type SpineCue = { animation: string; loop: boolean; delay: number };
type PlaybackOptions = { animation: string | null; playing: boolean; loop: boolean; speed: number };
export type SpineAnimationOptions = PlaybackOptions & {
  type: 'Spine';
  skin: string | null;
  skinLayers?: readonly string[];
  mix?: { duration: number; pairs: readonly { from: string; to: string; duration: number }[] };
  playback?: { queue: readonly SpineCue[]; tracks: readonly { weight: number; clips: readonly SpineCue[] }[] };
};
export type AnimationObject = SpineAnimationOptions | (PlaybackOptions & { type: 'AnimatedSprite'; anchor: PointData });
export type SpineSignal =
  { type: 'spine.event'; animation: string; name: string; time: number; track: number; int: number; float: number; text: string;
    audio?: { path: string; volume: number; balance: number } } |
  { type: 'spine.complete'; animation: string; name: string; time: number; track: number };
export type SpineBonePose = PointData & { a: number; b: number; c: number; d: number };
export type SpineBoundingBox = { slot: string; name: string; vertices: PointData[] };
export type SpinePointPose = PointData & { name: string; rotation: number };

export class SceneAnimation {
  readonly display: Container;
  private readonly spine?: Spine;
  private readonly clearSpineTrack?: (track: number) => void;
  private readonly refreshSpineSkin?: () => void;
  private skinOverride?: { skin: string | null; layers: readonly string[] };
  private readonly playedSpineTracks = new Map<number, DirectorAnimationControl>();
  private readonly updateFrame: (ticker: Ticker, directorOnly: boolean) => void;
  private readonly setPlayback: (node: AnimationObject, blend: boolean) => void;
  private readonly startDirected: (key: string, loop: boolean, speed: number, track: number, mixDuration?: number, weight?: number) => () => void;
  private readonly directed = new Map<number, { settle: (seek: boolean) => void; paused: boolean }>();
  private hasActiveAuthored = () => !this.directed.has(0) && !this.finished;
  private finished = false;
  private playing = false;
  private model: AnimationObject;

  constructor(readonly source: AnimationSource, node: AnimationObject, signal?: (signal: SpineSignal) => void) {
    this.model = node;
    if (source.kind === 'spine' && node.type === 'Spine') {
      const spine = source.createSpine();
      this.spine = spine;
      spine.skeleton.setToSetupPose();
      this.display = spine;
      let configuredClip: string | undefined;
      let configuredQueue = '';
      let baseEntry: TrackEntry | undefined;
      let overlayPlans: string[] = [];
      let overlayWeights: number[] = [];
      let configuredSkin: string | null | undefined;
      let configuredLayers: readonly string[] = [];
      let pending: SpineSignal[] = [];
      let collecting: SpineSignal[] | undefined;
      let heldTracks: ReadonlySet<number> | undefined;
      const applyPose = (events?: SpineSignal[]) => {
        const previous = collecting;
        collecting = events;
        try { spine.update(0); }
        finally { collecting = previous; }
      };
      this.clearSpineTrack = index => {
        pending = pending.filter(event => event.track !== index);
        spine.state.clearTrack(index);
        spine.skeleton.setToSetupPose();
        applyPose();
      };
      const mixFor = (from: string | undefined, to: string) => {
        const mix = this.model.type === 'Spine' ? this.model.mix : undefined;
        return mix?.pairs.find(pair => pair.from === from && pair.to === to)?.duration ?? mix?.duration ?? 0;
      };
      const transition = (index: number, key: string, loop: boolean, speed: number, override?: number) => {
        const from = spine.state.getCurrent(index)?.animation?.name;
        const track = spine.state.setAnimation(index, key, loop);
        track.timeScale = speed;
        track.mixDuration = track.mixingFrom ? override ?? mixFor(from, key) : 0;
        pending = pending.filter(event => event.track !== index);
        return track;
      };
      const enqueue = (index: number, first: TrackEntry, cues: readonly SpineCue[], rate: number, weight: number) => {
        let previous = first;
        for (const cue of cues) {
          const animation = source.skeleton.findAnimation(cue.animation);
          if (!animation) continue;
          const entry = spine.state.addAnimationWith(index, animation, cue.loop);
          entry.delay = previous.getTrackComplete() + cue.delay;
          entry.mixDuration = mixFor(previous.animation?.name, cue.animation);
          entry.timeScale = rate;
          entry.alpha = weight;
          previous = entry;
        }
      };
      const updateTrack = (track: TrackEntry | null, rate: number, weight: number) => {
        for (let entry = track; entry; entry = entry.next) {
          entry.timeScale = rate;
          entry.alpha = weight;
          if (entry.next?.animation) entry.next.mixDuration = mixFor(entry.animation?.name, entry.next.animation.name);
        }
      };
      const ended = (entry: TrackEntry) =>
        !entry.loop && !entry.next && !entry.mixingFrom && !entry.delay && entry.trackTime >= entry.animationEnd - entry.animationStart;
      const applySkin = (model: SpineAnimationOptions) => {
        const skin = this.skinOverride ? this.skinOverride.skin : model.skin;
        const layers = this.skinOverride?.layers ?? model.skinLayers ?? [];
        if (skin === configuredSkin && layers.length === configuredLayers.length &&
            layers.every((name, index) => configuredLayers[index] === name)) return false;
        applySpineSkins(spine.skeleton, skin, layers);
        configuredSkin = skin;
        configuredLayers = layers;
        return true;
      };
      this.refreshSpineSkin = () => {
        if (this.model.type === 'Spine' && applySkin(this.model)) applyPose();
      };
      this.hasActiveAuthored = () => spine.state.tracks.some((entry, index) =>
        !this.directed.has(index) && !!entry && (index === 0 ? !this.finished : !ended(entry)));
      this.setPlayback = (model, blend) => {
        if (model.type !== 'Spine') return;
        const skinChanged = applySkin(model);
        const clip = (model.animation ? source.skeleton.findAnimation(model.animation) : undefined) ?? source.skeleton.animations[0];
        const track = spine.state.getCurrent(0);
        const restart = this.finished && model.playing && !this.playing;
        const queue = model.playback?.queue ?? [];
        const queueKey = JSON.stringify(queue);
        let newEntries = false;
        let refreshedPose = skinChanged;
        if (clip && (!track || clip.name !== configuredClip || queueKey !== configuredQueue || restart)) {
          baseEntry = transition(0, clip.name, model.loop, model.speed, blend && model.playing && !restart ? undefined : 0);
          enqueue(0, baseEntry, queue, model.speed, 1);
          newEntries = true;
          this.finished = false;
        } else if (track) {
          if (track === baseEntry) track.loop = model.loop;
          updateTrack(track, model.speed, 1);
        } else {
          this.finished = true;
        }
        const overlays = model.playback?.tracks ?? [];
        const plans = overlays.map(track => JSON.stringify(track.clips));
        const weights = overlays.map(track => track.weight);
        for (const [offset, overlay] of overlays.entries()) {
          const index = offset + 1;
          if (restart || plans[offset] !== overlayPlans[offset]) {
            const clips = overlay.clips.filter(cue => !!source.skeleton.findAnimation(cue.animation));
            const [first, ...following] = clips;
            if (first) {
              const entry = transition(index, first.animation, first.loop, model.speed, blend && model.playing && !restart ? undefined : 0);
              entry.alpha = overlay.weight;
              entry.delay = first.delay;
              enqueue(index, entry, following, model.speed, overlay.weight);
              newEntries = true;
            } else {
              spine.state.clearTrack(index);
              pending = pending.filter(event => event.track !== index);
              refreshedPose = true;
            }
          } else {
            updateTrack(spine.state.getCurrent(index), model.speed, overlay.weight);
            refreshedPose ||= overlayWeights[offset] !== overlay.weight;
          }
        }
        if (overlayPlans.length > overlays.length) {
          for (let index = overlays.length + 1; index <= overlayPlans.length; index++) spine.state.clearTrack(index);
          pending = pending.filter(event => event.track <= overlays.length);
          spine.skeleton.setToSetupPose();
          refreshedPose = true;
        } else if (refreshedPose && !skinChanged) {
          spine.skeleton.setToSetupPose();
        }
        if (newEntries || refreshedPose) applyPose(newEntries ? pending : undefined);
        overlayPlans = plans;
        overlayWeights = weights;
        configuredClip = clip?.name;
        configuredQueue = queueKey;
      };
      this.updateFrame = (ticker, directorOnly) => {
        const canAdvance = (index: number) => {
          const control = this.directed.get(index);
          return control ? !control.paused : !directorOnly && this.playing;
        };
        const events = pending.filter(event => canAdvance(event.track));
        pending = pending.filter(event => !canAdvance(event.track));
        collecting = events;
        try {
          const held: [number, TrackEntry][] = [];
          const { state } = spine;
          for (const [index, entry] of state.tracks.entries()) {
            if (entry && !canAdvance(index)) held.push([index, entry]);
          }
          if (held.length) {
            heldTracks = new Set(held.map(([index]) => index));
            // Keep paused tracks in the pose while skipping their time and crossfade updates.
            const update = state.update;
            state.update = delta => {
              for (const [index, entry] of held) {
                for (let paused: TrackEntry | null = entry; paused; paused = paused.mixingFrom) {
                  paused.animationLast = paused.nextAnimationLast;
                  paused.trackLast = paused.nextTrackLast;
                }
                state.tracks[index] = null;
              }
              try { update.call(state, delta); }
              finally { for (const [index, entry] of held) state.tracks[index] = entry; }
            };
            try { spine.update(ticker.deltaMS / 1000); }
            finally { state.update = update; }
          } else spine.update(ticker.deltaMS / 1000);
        }
        finally { collecting = undefined; heldTracks = undefined; }
        for (const event of events) signal?.(event);
        const base = spine.state.getCurrent(0);
        if (base && ended(base) && !this.directed.has(0)) this.finished = true;
        for (const [index, control] of this.directed) {
          const track = spine.state.getCurrent(index);
          if (!control.paused && (!track || ended(track))) control.settle(false);
        }
      };
      this.startDirected = (key, loop, rate, index, mixDuration, weight) => {
        const track = transition(index, key, loop, rate, mixDuration);
        if (index > 0) track.alpha = weight ?? (this.model.type === 'Spine' ? this.model.playback?.tracks[index - 1]?.weight ?? 1 : 1);
        applyPose(pending);
        return () => {
          if (spine.destroyed || spine.state.getCurrent(index) !== track) return;
          pending = pending.filter(event => event.track !== index);
          track.loop = false;
          track.trackTime = track.animationEnd - track.animationStart;
          track.mixTime = track.mixDuration;
          applyPose();
        };
      };
      spine.state.addListener({
        event: (track, event) => {
          if (collecting && !heldTracks?.has(track.trackIndex) && track.animation && track === spine.state.getCurrent(track.trackIndex)) collecting.push({
            type: 'spine.event', animation: track.animation.name, name: event.data.name,
            time: event.time, track: track.trackIndex, int: event.intValue, float: event.floatValue, text: event.stringValue ?? '',
            ...(event.data.audioPath && { audio: { path: event.data.audioPath, volume: event.volume, balance: event.balance } }),
          });
        },
        complete: track => {
          if (heldTracks?.has(track.trackIndex) || track !== spine.state.getCurrent(track.trackIndex)) return;
          const name = track.animation?.name;
          if (name) collecting?.push({ type: 'spine.complete', animation: name, name, time: track.animationEnd, track: track.trackIndex });
        },
        dispose: track => { if (track === baseEntry) baseEntry = undefined; },
      });
      this.sync(node);
    } else if (source.kind === 'sheet' && node.type === 'AnimatedSprite') {
      const sprite = new AnimatedSprite({
        textures: (node.animation && source.clips.get(node.animation)) || source.clips.values().next().value || source.frames,
        autoUpdate: false,
      });
      this.display = sprite;
      this.setPlayback = model => {
        sprite.loop = model.loop;
        sprite.animationSpeed = model.speed / 60;
        if (model.type === 'AnimatedSprite') sprite.anchor.copyFrom(model.anchor);
        if (model.playing && !this.playing) {
          if (this.finished) sprite.gotoAndPlay(0);
          else sprite.play();
          this.finished = false;
        } else if (!model.playing) sprite.stop();
      };
      this.updateFrame = ticker => sprite.update(ticker);
      this.startDirected = (key, loop, speed) => {
        const textures = source.clips.get(key) ?? (key === 'default' ? source.frames : undefined);
        if (!textures?.length) throw new Error(`Unknown spritesheet animation: ${key}`);
        sprite.textures = textures;
        sprite.loop = loop;
        sprite.animationSpeed = speed / 60;
        sprite.gotoAndPlay(0);
        return () => { if (!sprite.destroyed) sprite.gotoAndStop(sprite.totalFrames - 1); };
      };
      sprite.onComplete = () => this.complete();
      this.sync(node);
    } else {
      throw new Error('Animation source does not match the scene object type');
    }
  }

  matches(source: AnimationSource, node: AnimationObject) {
    const current = this.model;
    return source === this.source && current.type === node.type &&
      (node.type === 'Spine' || current.animation === node.animation);
  }

  get directing() { return this.directed.size > 0; }

  private get directingActive() { return [...this.directed.values()].some(control => !control.paused); }
  get active() { return this.directingActive || this.playing && this.hasActiveAuthored(); }

  /** The current bone transform in the Spine display's local coordinate space. */
  getSpineBonePose(name: string): SpineBonePose | undefined {
    if (!this.spine || this.spine.destroyed) return;
    const bone = this.spine.skeleton.findBone(name);
    if (bone?.active) return { x: bone.worldX, y: bone.worldY, a: bone.a, b: bone.b, c: bone.c, d: bone.d };
  }

  /** Override the displayed skin without replacing the animation tracks. */
  setSpineSkin(skin: string | null, layers: readonly string[] = []) {
    if (!this.spine || this.spine.destroyed) throw new Error('Spine skin changes are unavailable');
    for (const name of skin === null ? layers : [skin, ...layers]) {
      if (!this.spine.skeleton.data.findSkin(name)) throw new Error(`Unknown Spine skin: ${name}`);
    }
    this.skinOverride = { skin, layers: [...new Set(layers)] };
    this.refreshSpineSkin?.();
  }

  resetSpineSkin() {
    if (!this.skinOverride || this.spine?.destroyed) return;
    this.skinOverride = undefined;
    this.refreshSpineSkin?.();
  }

  /** The slot's active point attachment in rig-local pixels and degrees. */
  getSpinePoint(slotName: string): SpinePointPose | undefined {
    if (!this.spine || this.spine.destroyed) return;
    const slot = this.spine.skeleton.findSlot(slotName);
    if (!slot?.bone.active) return;
    const attachment = slot.getAttachment();
    if (!(attachment instanceof PointAttachment)) return;
    const { bone } = slot;
    const { x, y } = attachment.computeWorldPosition(bone, new Vector2());
    const radians = attachment.rotation * Math.PI / 180;
    const cos = Math.cos(radians), sin = Math.sin(radians);
    // Convert the transformed direction directly. Spine 4.2.120's atan2Deg uses the inverse conversion factor.
    const rotation = Math.atan2(bone.c * cos + bone.d * sin, bone.a * cos + bone.b * sin) * 180 / Math.PI;
    return { x, y, name: attachment.name, rotation };
  }

  /** Active bounding box attachments, including weighted and deformed vertices, in rig-local pixels. */
  getSpineBoundingBoxes(slotName?: string): SpineBoundingBox[] {
    const boxes: SpineBoundingBox[] = [];
    if (!this.spine || this.spine.destroyed) return boxes;
    for (const slot of this.spine.skeleton.drawOrder) {
      if (!slot.bone.active || (slotName !== undefined && slot.data.name !== slotName)) continue;
      const attachment = slot.getAttachment();
      if (!(attachment instanceof BoundingBoxAttachment)) continue;
      const coordinates = new Float32Array(attachment.worldVerticesLength);
      attachment.computeWorldVertices(slot, 0, coordinates.length, coordinates, 0, 2);
      const vertices: PointData[] = [];
      for (let index = 0; index < coordinates.length; index += 2) {
        vertices.push({ x: coordinates[index], y: coordinates[index + 1] });
      }
      boxes.push({ slot: slot.data.name, name: attachment.name, vertices });
    }
    return boxes;
  }

  private complete() {
    this.finished = true;
    this.directed.get(0)?.settle(false);
  }

  checkDirectorTarget(key: string, overrides?: Record<string, unknown>) {
    const requested = overrides?.track ?? 0;
    if (typeof requested !== 'number' || !Number.isInteger(requested) || requested < 0 || requested > maxDirectorSpineTrack) {
      throw new Error('Animation track must be a valid nonnegative track index');
    }
    if (requested && this.source.kind !== 'spine') throw new Error('Overlay tracks require a Spine target');
    if (this.source.kind === 'spine') {
      if (!key || !this.source.skeleton.findAnimation(key)) throw new Error(`Unknown Spine animation: ${key}`);
    } else if (!this.source.clips.get(key)?.length && !(key === 'default' && this.source.frames.length)) {
      throw new Error(`Unknown spritesheet animation: ${key}`);
    }
    return requested;
  }

  direct(key: string, overrides?: Record<string, unknown>): DirectorAnimationControl {
    const index = this.checkDirectorTarget(key, overrides);
    this.playedSpineTracks.delete(index);
    this.directed.get(index)?.settle(false);
    const speed = typeof overrides?.speed === 'number' && Number.isFinite(overrides.speed) && overrides.speed > 0 ?
      overrides.speed : this.model.speed;
    const mix = overrides?.mixDuration;
    const mixDuration = typeof mix === 'number' && Number.isFinite(mix) ? Math.max(0, mix) : undefined;
    const weight = typeof overrides?.weight === 'number' && Number.isFinite(overrides.weight) ?
      Math.max(0, Math.min(1, overrides.weight)) : undefined;
    const finishFrame = this.startDirected(key, overrides?.loop === true, speed, index, mixDuration, weight);
    let resolve!: () => void;
    const finished = new Promise<void>(done => { resolve = done; });
    const state = { paused: false, settle: (seek: boolean) => {
      if (this.directed.get(index) !== state) return;
      this.directed.delete(index);
      if (index === 0) this.finished = true;
      if (seek) finishFrame();
      resolve();
    } };
    this.directed.set(index, state);
    return { finished, finish: () => state.settle(true), pause: () => { state.paused = true; }, resume: () => { state.paused = false; } };
  }

  /** Play a Spine track through the gameplay API. Director can replace it without sharing its controls. */
  playSpineTrack(key: string, overrides?: Record<string, unknown>) {
    if (!this.spine || this.spine.destroyed) throw new Error('Spine playback is unavailable');
    const index = this.checkDirectorTarget(key, overrides);
    const control = this.direct(key, overrides);
    this.playedSpineTracks.set(index, control);
  }

  controlSpineTrack(track: number, command: 'pause' | 'resume' | 'stop') {
    const control = this.playedSpineTracks.get(track);
    if (!control || this.spine?.destroyed) return false;
    if (command === 'stop') {
      this.playedSpineTracks.delete(track);
      this.directed.get(track)?.settle(false);
      this.clearSpineTrack?.(track);
      return true;
    }
    if (!this.directed.has(track)) return false;
    control[command]();
    return true;
  }

  dispose() {
    for (const control of this.directed.values()) control.settle(false);
    this.playedSpineTracks.clear();
  }

  sync(node: AnimationObject, blend = false) {
    this.model = node;
    if (!this.directing) this.setPlayback(node, blend);
    this.playing = node.playing;
  }

  tick(ticker: Ticker, directorOnly = false) {
    if (directorOnly ? this.directingActive : this.active) this.updateFrame(ticker, directorOnly);
  }
}
