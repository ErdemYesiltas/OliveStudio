import type { SpineDocument } from './spine-format.js';
import { replaceSpineTrack, spineTrackKeys, type SpineTrackKey } from './spine-tracks.js';

const depths: Record<string, number> = {
  bones: 2, slots: 2, ik: 1, transform: 1, path: 2, physics: 2, attachments: 4, events: 0, drawOrder: 0,
};

export type SpineDopesheetTrack = { path: string[]; keys: SpineTrackKey[] };
export type SpineKeyClipboard = { path: string[]; frames: { key: SpineTrackKey; end?: number }[] }[];
export type SpineKeySelection = { path: string[]; index: number };
export const spineKeyTime = (key: SpineTrackKey) => key.time ?? 0;
export const spineKeyId = ({ path, index }: SpineKeySelection) => JSON.stringify([path, index]);
const timePrecision = 1e6;

export function spineDopesheetTracks(document: SpineDocument, animation: string): SpineDopesheetTrack[] {
  const clip = document.animations?.[animation];
  if (!clip) return [];
  const tracks: SpineDopesheetTrack[] = [];
  function walk(value: unknown, path: string[], depth: number) {
    if (depth === 0) {
      if (Array.isArray(value) && value.length) tracks.push({ path, keys: spineTrackKeys(document, animation, path) });
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [key, child] of Object.entries(value)) walk(child, [...path, key], depth - 1);
    }
  }
  for (const [name, depth] of Object.entries(depths)) walk(clip[name], [name], depth);
  return tracks;
}

function selectedByTrack(document: SpineDocument, animation: string, selection: SpineKeySelection[]) {
  const groups = new Map<string, { path: string[]; keys: SpineTrackKey[]; indices: Set<number> }>();
  for (const { path, index } of selection) {
    const id = JSON.stringify(path);
    const group = groups.get(id) ?? { path, keys: spineTrackKeys(document, animation, path), indices: new Set<number>() };
    if (!Number.isInteger(index) || !group.keys[index]) throw new Error('A selected keyframe no longer exists');
    group.indices.add(index);
    groups.set(id, group);
  }
  return [...groups.values()];
}

export function spineKeyShiftRange(document: SpineDocument, animation: string, selection: SpineKeySelection[]) {
  let min = -Infinity, max = Infinity;
  for (const { path, keys, indices } of selectedByTrack(document, animation, selection)) {
    const gap = path[0] === 'events' ? 0 : 1 / timePrecision;
    for (const index of indices) {
      const time = spineKeyTime(keys[index]);
      min = Math.max(min, -time);
      if (index > 0 && !indices.has(index - 1)) min = Math.max(min, spineKeyTime(keys[index - 1]) - time + gap);
      if (index + 1 < keys.length && !indices.has(index + 1)) max = Math.min(max, spineKeyTime(keys[index + 1]) - time - gap);
    }
  }
  return { min: Math.min(0, min), max: Math.max(0, max) };
}

function remapCurve(key: SpineTrackKey, transform: (time: number) => number): SpineTrackKey {
  if (!Array.isArray(key.curve)) return key;
  return { ...key, curve: key.curve.map((value, index) => index % 2 === 0 ? transform(value) : value) };
}

export function retimeSpineKeys(document: SpineDocument, animation: string, selection: SpineKeySelection[],
  { offset = 0, scale = 1 }: { offset?: number; scale?: number }) {
  if (!selection.length) return document;
  if (!Number.isFinite(offset) || !Number.isFinite(scale) || scale <= 0) throw new Error('Choose a finite offset and positive time scale');
  const groups = selectedByTrack(document, animation, selection);
  const pivot = Math.min(...groups.flatMap(({ keys, indices }) => [...indices].map(index => spineKeyTime(keys[index]))));
  let next = document;
  for (const { path, keys, indices } of groups) {
    const before = keys.map(spineKeyTime);
    const after = before.map((time, index) => indices.has(index)
      ? Math.round((pivot + (time - pivot) * scale + offset) * timePrecision) / timePrecision : time);
    if (after.some((time, index) => time < 0 || (index > 0 && (time < after[index - 1] ||
      (time === after[index - 1] && path[0] !== 'events'))))) throw new Error('The selection would collide with or pass another keyframe');
    next = replaceSpineTrack(next, animation, path, keys.map((key, index) => {
      const start = before[index], end = before[index + 1];
      const target = after[index], targetEnd = after[index + 1];
      const mapped = end !== undefined && end !== start && targetEnd !== undefined && (start !== target || end !== targetEnd)
        ? remapCurve(key, value => target + (value - start) * (targetEnd - target) / (end - start)) : key;
      return indices.has(index) ? { ...mapped, time: target } : mapped;
    }));
  }
  return next;
}

export function deleteSpineKeys(document: SpineDocument, animation: string, selection: SpineKeySelection[]) {
  return selectedByTrack(document, animation, selection).reduce((current, { path, keys, indices }) => {
    const kept = keys.map((key, index) => ({ key, index })).filter(({ index }) => !indices.has(index));
    return replaceSpineTrack(current, animation, path, kept.map(({ key, index }, i) => {
      const start = spineKeyTime(key), oldEnd = keys[index + 1], nextEnd = kept[i + 1]?.key;
      if (!oldEnd || !nextEnd || oldEnd === nextEnd || spineKeyTime(oldEnd) === start) return key;
      return remapCurve(key, value => start + (value - start) * (spineKeyTime(nextEnd) - start) / (spineKeyTime(oldEnd) - start));
    }));
  }, document);
}

export function copySpineKeys(document: SpineDocument, animation: string, selection: SpineKeySelection[]): SpineKeyClipboard {
  const groups = selectedByTrack(document, animation, selection);
  const pivot = Math.min(...groups.flatMap(({ keys, indices }) => [...indices].map(index => spineKeyTime(keys[index]))));
  return groups.map(({ path, keys, indices }) => ({ path, frames: keys.flatMap((key, index) => indices.has(index) ? [{
    key: { ...remapCurve(key, value => value - pivot), time: spineKeyTime(key) - pivot },
    end: keys[index + 1] ? spineKeyTime(keys[index + 1]) - pivot : undefined,
  }] : []) }));
}

export function pasteSpineKeys(document: SpineDocument, animation: string, copied: SpineKeyClipboard, time: number) {
  if (!Number.isFinite(time) || time < 0) throw new Error('Paste time must be nonnegative');
  let next = document;
  const selection: SpineKeySelection[] = [];
  for (const { path, frames } of copied) {
    const original = spineTrackKeys(next, animation, path);
    const existing = original.map((key, index) => ({ key, pasted: false, end: original[index + 1] && spineKeyTime(original[index + 1]) }));
    const pasted = frames.map(({ key, end }) => ({
      key: { ...remapCurve(key, value => value + time), time: Math.round((spineKeyTime(key) + time) * 1e6) / 1e6 },
      pasted: true, end: end === undefined ? undefined : end + time,
    }));
    const combined = [...existing, ...pasted].sort((a, b) => spineKeyTime(a.key) - spineKeyTime(b.key));
    const reflowed = combined.map(({ key, end, pasted }, index) => {
      if (pasted) selection.push({ path, index });
      const following = combined[index + 1]?.key;
      if (!following || !Array.isArray(key.curve)) return key;
      const start = spineKeyTime(key), target = spineKeyTime(following);
      if (end === undefined || end <= start) {
        const { curve: _inactive, ...rest } = key;
        return rest;
      }
      return end === target ? key : remapCurve(key, value => start + (value - start) * (target - start) / (end - start));
    });
    next = replaceSpineTrack(next, animation, path, reflowed);
  }
  return { document: next, selection };
}
