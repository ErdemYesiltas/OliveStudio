import { z } from 'zod';
import type { SceneObject } from './scene';
import { audioTween, authoredValue, timelineDuration, timelineLimits, timelineSchema, tweenValue, type TweenProperty, type TweenTrack } from './timeline';

export const mainClip = 'timeline';
export const clipLimit = 24;
export const nestedLimit = 12;
export const cueLimit = 64;
const maxDepth = 4;
const maxPlacements = 128;
const time = z.number().min(0).max(timelineLimits.time);
const id = z.string().min(1);
const name = z.string().trim().min(1).max(80);
const cueBase = { id, time, name };

const cueSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...cueBase, kind: z.literal('message'), message: z.string().max(200) }),
  z.strictObject({ ...cueBase, kind: z.literal('audio'), target: z.string(), action: z.enum(['play', 'stop']) }),
  z.strictObject({ ...cueBase, kind: z.literal('visibility'), target: z.string(), visible: z.boolean() }),
  z.strictObject({ ...cueBase, kind: z.literal('camera') }),
  z.strictObject({ ...cueBase, time: time.min(0.01), kind: z.literal('clip'), target: z.string(), fade: z.number().min(0).max(8) }),
  z.strictObject({ ...cueBase, kind: z.literal('global'), target: z.string(), value: z.string().max(1000) }),
  z.strictObject({ ...cueBase, kind: z.literal('scene'), target: z.string() }),
]);
const nestedSchema = z.strictObject({ id, clip: id, start: time, speed: z.number().min(0.25).max(4) });
const unique = <T extends { id: string }>(items: T[]) => new Set(items.map(item => item.id)).size === items.length;
const metadata = z.strictObject({
  cues: z.array(cueSchema).max(cueLimit).refine(unique).default([]),
  nested: z.array(nestedSchema).max(nestedLimit).refine(unique).default([]),
});
const clipSchema = metadata.extend({ id, name, tracks: timelineSchema.default([]) });

export const cinematicsSchema = z.strictObject({
  main: metadata.default({ cues: [], nested: [] }),
  clips: z.array(clipSchema).max(clipLimit).refine(unique).default([]),
  autoplay: id.optional(),
}).superRefine((library, ctx) => {
  const clips = new Map<string, ClipMetadata>([[mainClip, library.main]]);
  for (const clip of library.clips) clips.set(clip.id, clip);
  if (clips.size !== library.clips.length + 1 || (library.autoplay && !clips.has(library.autoplay))) {
    ctx.addIssue({ code: 'custom', message: 'Clip IDs and the autoplay clip must be valid' });
  }
  for (const clip of clips.keys()) {
    let placements = 0;
    function visit(id: string, parents: string[]): boolean {
      const item = clips.get(id);
      if (!item || parents.includes(id) || parents.length > maxDepth || ++placements > maxPlacements) return false;
      return item.nested.every(nested => visit(nested.clip, [...parents, id]));
    }
    if (!visit(clip, [])) {
      ctx.addIssue({ code: 'custom', message: 'Nested clips must exist, avoid cycles and stay within the nesting limits' });
      break;
    }
  }
});

export type Cue = z.output<typeof cueSchema>;
export type ClipMetadata = z.output<typeof metadata>;
export type Clip = z.output<typeof clipSchema>;
export type Cinematics = z.output<typeof cinematicsSchema>;
export type OnionSkin = { before: number; after: number; spacing: number };
export type ClipData = { timeline: TweenTrack[]; cinematics?: Cinematics };
export const emptyCinematics: Cinematics = { main: { cues: [], nested: [] }, clips: [] };

export function clipList(data: ClipData, baseName: string): Clip[] {
  return [{ id: mainClip, name: baseName, tracks: data.timeline, ...(data.cinematics ?? emptyCinematics).main },
    ...(data.cinematics?.clips ?? [])];
}

export function changeClip(data: ClipData, id: string, update: (clip: Clip) => Clip): ClipData {
  if (id === mainClip) {
    const { tracks, cues, nested } = update(clipList(data, '')[0]);
    const cinematic = data.cinematics || cues.length || nested.length ?
      { ...(data.cinematics ?? emptyCinematics), main: { cues, nested } } : undefined;
    return { timeline: tracks, ...(cinematic ? { cinematics: cinematic } : {}) };
  }
  const cinematics = data.cinematics ?? emptyCinematics;
  return { ...data, cinematics: { ...cinematics, clips: cinematics.clips.map(clip => clip.id === id ? update(clip) : clip) } };
}

export function removeClip(library: Cinematics, id: string): Cinematics {
  const removeNest = <T extends ClipMetadata>(clip: T): T => ({
    ...clip, nested: clip.nested.filter(item => item.clip !== id), cues: clip.cues.filter(cue => cue.kind !== 'clip' || cue.target !== id),
  });
  const { autoplay, ...metadata } = library;
  return { ...metadata, ...(autoplay && autoplay !== id ? { autoplay } : {}), main: removeNest(library.main),
    clips: library.clips.filter(clip => clip.id !== id).map(removeNest) };
}

type Lane = { track: TweenTrack; start: number; speed: number };
export type TimedCue = { cue: Cue; time: number };
export type DirectedClip = { duration: number; lanes: Lane[]; cues: TimedCue[] };

export function compileClip(clips: readonly Clip[], id: string): DirectedClip | undefined {
  const byId = new Map(clips.map(clip => [clip.id, clip]));
  let count = 0;
  function resolve(id: string, parents: string[]): DirectedClip | undefined {
    const clip = byId.get(id);
    if (!clip || parents.includes(id) || parents.length > maxDepth || ++count > maxPlacements) return;
    const lanes = clip.tracks.map(track => ({ track, start: 0, speed: 1 }));
    const cues = clip.cues.map(cue => ({ cue, time: cue.time }));
    let duration = Math.max(timelineDuration(clip.tracks), ...cues.map(item => item.time));
    for (const nested of [...clip.nested].sort((a, b) => a.start - b.start)) {
      const child = resolve(nested.clip, [...parents, id]);
      if (!child) return;
      duration = Math.max(duration, nested.start + child.duration / nested.speed);
      for (const lane of child.lanes) lanes.push({
        track: lane.track, start: nested.start + lane.start / nested.speed, speed: nested.speed * lane.speed,
      });
      for (const item of child.cues) cues.push({ cue: item.cue, time: nested.start + item.time / nested.speed });
    }
    return { duration, lanes, cues: cues.sort((a, b) => a.time - b.time) };
  }
  return resolve(id, []);
}

export type TweenPose = Map<string, Map<TweenProperty, number>>;
export function sampleClip(clip: DirectedClip, time: number, lookup: (id: string) => SceneObject | undefined): TweenPose {
  const pose: TweenPose = new Map();
  for (const { track, start, speed } of clip.lanes) {
    const node = lookup(track.target);
    if (!node || audioTween(track.property) && node.type !== 'AudioSource') continue;
    const target = pose.get(track.target) ?? new Map<TweenProperty, number>();
    if (time >= start) target.set(track.property, tweenValue(track, (time - start) * speed,
      target.get(track.property) ?? authoredValue(node, track.property)));
    else if (!target.has(track.property)) target.set(track.property, authoredValue(node, track.property));
    pose.set(track.target, target);
  }
  return pose;
}

export function crossedCues(cues: readonly TimedCue[], from: number, to: number, initial?: boolean) {
  if (initial) return cues.filter(item => Math.abs(item.time - to) < 1e-9);
  return from <= to ? cues.filter(item => item.time > from && item.time <= to) :
    cues.filter(item => item.time < from && item.time >= to).reverse();
}

export function remapCinematics(library: Cinematics | undefined, ids: ReadonlyMap<string, string>): Cinematics | undefined {
  if (!library) return;
  function metadata(clip: ClipMetadata) {
    return { ...clip, cues: clip.cues.map(cue => cue.kind === 'audio' || cue.kind === 'visibility' ?
      { ...cue, target: ids.get(cue.target) ?? cue.target } : cue) };
  }
  return {
    ...library, main: metadata(library.main),
    clips: library.clips.map(clip => ({
      ...clip, ...metadata(clip), tracks: clip.tracks.map(track => ({
        ...track, id: crypto.randomUUID(), target: ids.get(track.target) ?? track.target,
      })),
    })),
  };
}

export function pruneCinematics(library: Cinematics | undefined, ids: ReadonlySet<string>) {
  if (!library) return;
  function prune<T extends ClipMetadata>(clip: T): T {
    const cues = clip.cues.filter(cue => !(cue.kind === 'audio' || cue.kind === 'visibility') || !cue.target || ids.has(cue.target));
    return cues.length === clip.cues.length ? clip : { ...clip, cues };
  }
  const main = prune(library.main);
  const clips = library.clips.map(clip => {
    const next = prune(clip);
    const tracks = next.tracks.filter(track => ids.has(track.target));
    return tracks.length === next.tracks.length ? next : { ...next, tracks };
  });
  return main === library.main && clips.every((clip, i) => clip === library.clips[i]) ? library : { ...library, main, clips };
}
