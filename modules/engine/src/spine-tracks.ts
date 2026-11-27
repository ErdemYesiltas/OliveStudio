import { z } from 'zod';
import type { SpineDocument } from './spine-format.js';

const trackKey = z.looseObject({
  time: z.number().nonnegative().optional(),
  curve: z.union([z.literal('stepped'), z.array(z.number())]).nullable().optional(),
});
export type SpineTrackKey = z.output<typeof trackKey>;
const keysSchema = z.array(trackKey);
const object = z.record(z.string(), z.unknown());
const twoColorTracks = new Set(['rgb2', 'rgba2']);

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

export function resolveSpineEventAudioDefaults(input: unknown): unknown {
  const document = asRecord(input);
  const definitions = asRecord(document?.events);
  const animations = asRecord(document?.animations);
  if (!document || !definitions || !animations) return input;
  let updated: Record<string, unknown> | undefined;
  for (const [name, value] of Object.entries(animations)) {
    const animation = asRecord(value);
    if (!Array.isArray(animation?.events)) continue;
    let changed = false;
    const events = animation.events.map((value: unknown) => {
      const key = asRecord(value);
      const definition = typeof key?.name === 'string' && Object.hasOwn(definitions, key.name) ? asRecord(definitions[key.name]) : undefined;
      if (!key || !definition?.audio) return value;
      const inherited: Record<string, number> = {};
      for (const field of ['volume', 'balance']) {
        const setting = definition[field];
        if (key[field] === undefined && typeof setting === 'number' && Number.isFinite(setting)) inherited[field] = setting;
      }
      if (!Object.keys(inherited).length) return value;
      changed = true;
      return { ...key, ...inherited };
    });
    if (changed) (updated ??= { ...animations })[name] = { ...animation, events };
  }
  // Spine's JS reader substitutes literal defaults for omitted audio keys. Resolve inheritance for playback only.
  return updated ? { ...document, animations: updated } : input;
}

export function spineSlotHasTwoColorKeys(document: SpineDocument, slot: string) {
  return Object.values(document.animations ?? {}).some(clip => {
    const slots = object.safeParse(clip.slots);
    const tracks = object.safeParse(slots.data?.[slot]);
    return tracks.success && Object.entries(tracks.data).some(([name, keys]) =>
      twoColorTracks.has(name) && Array.isArray(keys) && keys.length > 0);
  });
}

export function spineTrackKeys(document: SpineDocument, animation: string, path: readonly string[]): SpineTrackKey[] {
  let value: unknown = document.animations?.[animation];
  for (const segment of path) value = object.parse(value ?? {})[segment];
  return keysSchema.parse(value ?? []);
}

export function replaceSpineTrack(document: SpineDocument, animation: string, path: readonly string[], keys: SpineTrackKey[]): SpineDocument {
  const clip = document.animations?.[animation];
  if (!clip || !path.length) throw new Error('Choose an animation track');
  const ordered = keysSchema.parse(keys).sort((a, b) => (a.time ?? 0) - (b.time ?? 0));
  if (path[0] !== 'events' && ordered.length !== new Set(ordered.map(key => key.time ?? 0)).size) {
    throw new Error('Track key times must be unique');
  }
  function patch(value: unknown, depth: number): Record<string, unknown> {
    const parent = object.parse(value ?? {});
    const segment = path[depth];
    if (depth === path.length - 1) {
      const { [segment]: _old, ...rest } = parent;
      return ordered.length ? { ...rest, [segment]: ordered } : rest;
    }
    const next = patch(parent[segment], depth + 1);
    const { [segment]: _old, ...rest } = parent;
    return Object.keys(next).length ? { ...rest, [segment]: next } : rest;
  }
  const next = { ...document, animations: { ...document.animations, [animation]: patch(clip, 0) } };
  if (path[0] === 'slots' && twoColorTracks.has(path[2]) && ordered.length && document.slots) {
    // Spine creates the runtime dark color only when the setup slot defines one.
    next.slots = document.slots.map(slot => slot.name === path[1] && !slot.dark ? { ...slot, dark: '000000' } : slot);
  }
  return next;
}
