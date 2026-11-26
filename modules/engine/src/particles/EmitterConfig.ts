import type { EaseSegment, SimpleEase } from './ParticleUtils.js';

/**
 * The current emitter configuration format.
 *
 * Everything about *how a particle looks and moves* lives in `behaviors`; the
 * fields here only govern the emitter itself — when particles spawn, how many,
 * and how long they live.
 */
export interface EmitterConfigV3 {
  /** Range each particle's lifetime is drawn from, in seconds. */
  lifetime: RandNumber;
  /**
   * Easing applied to every interpolated or stepped value across a particle's
   * life, so one curve can shape the whole effect without editing each list.
   */
  ease?: SimpleEase | EaseSegment[];
  /** Particles released per spawn. Defaults to one. */
  particlesPerWave?: number;
  /** Seconds between spawns; `0.5` is twice a second. */
  frequency: number;
  /**
   * Probability that a due spawn actually happens, `0`–`1`. Below `1` it
   * scatters the rhythm; omitted, every spawn fires.
   */
  spawnChance?: number;
  /** Seconds to keep spawning for. Omitted, the emitter runs until stopped. */
  emitterLifetime?: number;
  /** Ceiling on simultaneously alive particles. */
  maxParticles?: number;
  /**
   * Add new particles behind existing ones so they are less conspicuous as they
   * pop in. Omitted, they are added on top.
   */
  addAtBack?: boolean;
  /** Spawn origin within the parent container. */
  pos: { x: number; y: number };
  /** Start emitting immediately. Treated as `true` when omitted. */
  emit?: boolean;
  /**
   * Attach to PixiJS's shared ticker. When `false` or omitted, the caller must
   * drive {@link Emitter.update} itself — which is what a host with its own
   * clock wants, so that pause and time-scaling apply.
   */
  autoUpdate?: boolean;
  /**
   * The behaviors applied to every particle. See the `behaviors` namespace for
   * what ships; register more with {@link Emitter.registerBehavior}.
   */
  behaviors: BehaviorEntry[];
}

/**
 * One entry of {@link EmitterConfigV3.behaviors}.
 *
 * {@link BehaviorConfigs} is the checked form of this pair — prefer it when
 * authoring in TypeScript, since it ties `config` to the named `type`.
 */
export interface BehaviorEntry {
  /** The behavior's registered `type`. */
  type: string;
  /** Configuration for that behavior. */
  config: unknown;
}

/** An inclusive numeric range to draw a random value from. */
export interface RandNumber {
  /** Highest pickable value. */
  max: number;
  /** Lowest pickable value. */
  min: number;
}

/** A start/end pair, the legacy way of expressing a two-keyframe list. */
export interface BasicTweenable<T> {
  /** Value at time `0`. */
  start: T;
  /** Value at time `1`. */
  end: T;
}
