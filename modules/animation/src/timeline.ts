import {BehaviorSubject, Subject, filter, map, withLatestFrom, type Observable, type Subscription} from 'rxjs';
import type {Json} from '@rewrite/sdk';
import type {Entity} from '@rewrite/scene';
import {channelValue, type TweenChannel} from '@rewrite/tween';

/**
 * RxJS timeline core: a runner turns the frame stream into clip time under play/pause/speed/direction control, and
 * reports the time ranges it actually played (for markers) and completion. Channels describe what a track writes.
 */

/** Playback control of one timeline. */
export interface TimelineControl {playing: boolean; speed: number; direction: 1 | -1}
/** A played range (from → to; to < from when reversed). Seeks are not played ranges. */
export interface PlayedRange {from: number; to: number}

export class TimelineRunner {
 readonly control$: BehaviorSubject<TimelineControl>;
 readonly time$ = new BehaviorSubject(0);
 readonly played$ = new Subject<PlayedRange>();
 readonly complete$ = new Subject<number>();
 private readonly subscription: Subscription;
 constructor(frame$: Observable<number>, readonly total: number, playing: boolean, gate: () => boolean = () => true) {
  this.control$ = new BehaviorSubject<TimelineControl>({playing, speed: 1, direction: 1});
  this.subscription = frame$.pipe(
   withLatestFrom(this.control$),
   filter(([dt, c]) => c.playing && dt > 0 && gate()),
   map(([dt, c]) => ({c, from: this.time$.value, to: Math.max(0, Math.min(this.total, this.time$.value + dt * c.speed * c.direction))})),
  ).subscribe(({c, from, to}) => {
   // Played range first (poses with markers), then the time (observers see the new time; the pose is not repeated).
   if (to !== from) { this.played$.next({from, to}); this.time$.next(to); }
   if (c.direction > 0 ? to >= this.total : to <= 0) { this.control$.next({...this.control$.value, playing: false}); this.complete$.next(to); }
  });
 }
 /** Starts from the beginning (or the end when reversed); markers at the start point fire. */
 play() { const c = this.control$.value, start = c.direction > 0 ? 0 : this.total; this.played$.next({from: c.direction > 0 ? -1 : this.total + 1, to: start}); this.time$.next(start); this.control$.next({...c, playing: true}); }
 pause() { this.control$.next({...this.control$.value, playing: false}); }
 resume() { const c = this.control$.value, t = this.time$.value; if (c.direction > 0 ? t >= this.total : t <= 0) return this.play(); this.control$.next({...c, playing: true}); }
 seek(time: number) { if (Number.isFinite(time)) this.time$.next(Math.max(0, Math.min(this.total, time))); }
 setSpeed(speed: number) { if (!Number.isFinite(speed) || speed <= 0 || speed > 100) throw Error('Speed must be between 0 and 100'); this.control$.next({...this.control$.value, speed}); }
 reverse() { const c = this.control$.value; this.control$.next({...c, direction: c.direction > 0 ? -1 : 1}); }
 dispose() { this.subscription.unsubscribe(); this.played$.complete(); this.complete$.complete(); this.time$.complete(); this.control$.complete(); }
}

/** What a track writes. Numbers can have a registered channel (limits); other kinds follow the property's value. */
export type TrackKind = 'number' | 'color' | 'bool' | 'text';
export type TrackValue = number | string | boolean;
/** Visibility tracks target the entity itself (`active`). */
export const entityTarget = '@entity';
export interface ResolvedChannel {kind: TrackKind; numeric?: TweenChannel; read(): TrackValue; write(value: TrackValue): void; check(value: unknown): TrackValue}
const hex = /^#[0-9a-fA-F]{6}$/;
export const trackKindOf = (value: unknown): TrackKind | null => typeof value === 'number' && Number.isFinite(value) ? 'number' : typeof value === 'boolean' ? 'bool' : typeof value === 'string' ? hex.test(value) ? 'color' : 'text' : null;

/** Resolves a track target on a live entity list; throws a readable error when it cannot be animated. */
export function resolveChannel(channels: readonly TweenChannel[], entity: Entity | undefined, componentId: string, property: string): ResolvedChannel {
 if (!entity) throw Error('Animation target object is missing');
 if (componentId === entityTarget) {
  if (property !== 'active') throw Error(`Objects can only animate visibility, not ${property}`);
  const check = (v: unknown) => { if (typeof v !== 'boolean') throw Error('Visibility keys are on/off'); return v; };
  return {kind: 'bool', read: () => entity.active, write: v => { entity.active = Boolean(v); }, check};
 }
 const component = entity.components.find(c => c.id === componentId);
 if (!component || !component.data || typeof component.data !== 'object' || Array.isArray(component.data)) throw Error('Animation target component is missing');
 const data = component.data as Record<string, Json>, numeric = channels.find(c => c.componentType === component.type && c.version === component.version && c.property === property && !c.quaternion);
 if (channels.some(c => c.componentType === component.type && c.version === component.version && (c.property === property || c.quaternion?.includes(property)) && c.quaternion)) throw Error(`${component.type}.${property} is a rotation: use a tween rotation track`);
 const kind: TrackKind | null = numeric ? 'number' : trackKindOf(data[property]);
 if (!kind) throw Error(`${component.type}.${property} cannot be animated`);
 const check = (v: unknown): TrackValue => {
  if (kind === 'number') { if (numeric) return channelValue(numeric, v); if (typeof v !== 'number' || !Number.isFinite(v)) throw Error(`${property} keys must be numbers`); return v; }
  if (kind === 'color') { if (typeof v !== 'string' || !hex.test(v)) throw Error(`${property} keys must be #rrggbb colours`); return v.toLowerCase(); }
  if (kind === 'bool') { if (typeof v !== 'boolean') throw Error(`${property} keys must be on/off`); return v; }
  if (typeof v !== 'string' || v.length > 2000) throw Error(`${property} keys must be text`); return v;
 };
 return {kind, numeric, read: () => data[property] as TrackValue, write: v => { data[property] = v; }, check};
}

/** Linear RGB blend of two #rrggbb colours (progress may overshoot with springy curves; channels clamp). */
export function mixColor(a: string, b: string, t: number) {
 const p = (s: string, i: number) => parseInt(s.slice(1 + i * 2, 3 + i * 2), 16);
 return '#' + [0, 1, 2].map(i => Math.round(Math.max(0, Math.min(255, p(a, i) + (p(b, i) - p(a, i)) * t))).toString(16).padStart(2, '0')).join('');
}
