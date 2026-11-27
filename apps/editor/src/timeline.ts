import { Observable } from 'rxjs';
import { UPDATE_PRIORITY, type Container, type Ticker } from 'pixi.js';
import { z } from 'zod';
import type { IStepStrategy, DirectorStep } from '@olivestudio/engine/aperion-director';
import type { SceneObject } from './scene';

export const timelineProperties = ['x', 'y', 'rotation', 'scaleX', 'scaleY', 'skewX', 'skewY', 'alpha', 'volume', 'rate'] as const;
export const timelineEases = ['linear', 'easeIn', 'easeOut', 'easeInOut'] as const;
export const timelineLimits = { time: 600, tracks: 64, keys: 128 };
export type TweenProperty = typeof timelineProperties[number];
const keySchema = z.strictObject({
  id: z.string().min(1),
  time: z.number().min(0).max(timelineLimits.time),
  value: z.number(),
  ease: z.enum(timelineEases).default('linear'),
});
const trackSchema = z.strictObject({
  id: z.string().min(1), target: z.string().min(1), property: z.enum(timelineProperties),
  keys: z.array(keySchema).min(1).max(timelineLimits.keys),
}).refine(track => new Set(track.keys.map(key => key.time)).size === track.keys.length &&
  new Set(track.keys.map(key => key.id)).size === track.keys.length, { path: ['keys'] })
  .transform(track => ({ ...track, keys: [...track.keys].sort((a, b) => a.time - b.time) }));

export const timelineSchema = z.array(trackSchema).max(timelineLimits.tracks).refine(tracks =>
  new Set(tracks.map(track => track.id)).size === tracks.length &&
  new Set(tracks.map(track => JSON.stringify([track.target, track.property]))).size === tracks.length);
export type TweenTrack = z.output<typeof trackSchema>;
export type TweenKey = z.output<typeof keySchema>;

export function audioTween(property: TweenProperty): property is 'volume' | 'rate' {
  return property === 'volume' || property === 'rate';
}

export function authoredValue(node: SceneObject, property: TweenProperty) {
  switch (property) {
    case 'x': return node.position.x;
    case 'y': return node.position.y;
    case 'scaleX': return node.scale.x;
    case 'scaleY': return node.scale.y;
    case 'skewX': return node.skew.x;
    case 'skewY': return node.skew.y;
    case 'volume': case 'rate': return node.type === 'AudioSource' ? node[property] : 1;
    default: return node[property];
  }
}

export function applyTween(display: Container, property: TweenProperty, value: number) {
  switch (property) {
    case 'scaleX': display.scale.x = value; break;
    case 'scaleY': display.scale.y = value; break;
    case 'skewX': display.skew.x = value * Math.PI / 180; break;
    case 'skewY': display.skew.y = value * Math.PI / 180; break;
    case 'rotation': display.angle = value; break;
    case 'alpha': display.alpha = Math.min(1, Math.max(0, value)); break;
    case 'volume': case 'rate': break;
    default: display[property] = value;
  }
}

const easing: Record<TweenKey['ease'], (t: number) => number> = {
  linear: t => t,
  easeIn: t => t * t,
  easeOut: t => 1 - (1 - t) ** 2,
  easeInOut: t => t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2,
};

export function tweenValue(track: TweenTrack, time: number, base: number) {
  const next = track.keys.findIndex(key => key.time > time);
  if (next === 0) return base;
  if (next < 0) return track.keys[track.keys.length - 1].value;
  const previous = track.keys[next - 1], end = track.keys[next];
  const progress = easing[end.ease]((time - previous.time) / (end.time - previous.time));
  return previous.value * (1 - progress) + end.value * progress;
}

export function timelineDuration(tracks: readonly TweenTrack[]) {
  return Math.max(1, ...tracks.map(track => track.keys.at(-1)!.time));
}

interface TimelineStep extends DirectorStep {
  type: 'timeline';
  start: number;
  duration: number;
  speed: number;
  reverse: boolean;
  loop: boolean;
  holdUntil: number;
}
type Sample = (time: number, span: { from: number; initial?: boolean } | undefined, elapsed: number) => void;
export type TimelineTransport = { speed: number; reverse: boolean; loop: boolean };
export const defaultTransport: TimelineTransport = { speed: 1, reverse: false, loop: false };

export const timelineStrategy: IStepStrategy<TimelineStep> = {
  type: 'timeline',
  run(step, context) {
    const sample = context.vars.get('sample') as Sample;
    const ticker = context.ticker;
    return new Observable<void>(subscriber => {
      let time = step.start;
      let elapsed = 0;
      let paused = false;
      const allowed = context.vars.get('allowed') as (() => boolean) | undefined;
      const pause = context.pause$.subscribe(() => { paused = true; });
      const resume = context.resume$.subscribe(() => { paused = false; });
      const beginning = step.reverse ? step.duration : 0;
      const end = step.reverse ? 0 : step.duration;
      const direction = step.reverse ? -1 : 1;
      const tick = ({ deltaMS }: Ticker) => {
        if (paused || subscriber.closed || allowed?.() === false) return;
        const dt = deltaMS / 1000;
        elapsed += dt;
        let remaining = dt * step.speed;
        while (remaining > 1e-9 && !subscriber.closed) {
          const distance = Math.abs(end - time);
          const advance = Math.min(remaining, distance);
          const to = advance === distance ? end : time + advance * direction;
          if (advance) sample(to, { from: time }, elapsed);
          time = to;
          remaining -= advance;
          if (time !== end) break;
          if (!step.loop) {
            if (elapsed < step.holdUntil) {
              if (!advance) sample(time, undefined, elapsed);
              break;
            }
            subscriber.next();
            subscriber.complete();
            break;
          }
          time = beginning;
          sample(time, { from: time, initial: true }, elapsed);
        }
      };
      sample(time, time === beginning ? { from: time, initial: true } : undefined, 0);
      ticker.add(tick, undefined, UPDATE_PRIORITY.HIGH);
      return () => {
        ticker.remove(tick);
        pause.unsubscribe();
        resume.unsubscribe();
      };
    });
  },
};

export function timelineStep(start: number, duration: number, transport = defaultTransport, holdUntil = 0): TimelineStep {
  return { type: 'timeline', start, duration, ...transport, holdUntil };
}
