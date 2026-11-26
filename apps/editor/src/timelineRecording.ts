import { changeClip, sampleClip, type ClipData, type DirectedClip } from './cinematics';
import type { ObjectTransform, TransformPatch } from './runtime';
import type { SceneObject } from './scene';
import { authoredValue, timelineLimits, type TweenProperty } from './timeline';

export type RecordTarget = { id: string; time: number; clip: DirectedClip };

function channels(patch: TransformPatch): [TweenProperty, number][] {
  const result: [TweenProperty, number][] = [];
  if (patch.position) result.push(['x', patch.position.x], ['y', patch.position.y]);
  if (patch.scale) result.push(['scaleX', patch.scale.x], ['scaleY', patch.scale.y]);
  if (patch.skew) result.push(['skewX', patch.skew.x], ['skewY', patch.skew.y]);
  if (patch.rotation !== undefined) result.push(['rotation', patch.rotation]);
  return result;
}

export function recordTransforms(
  data: ClipData, target: RecordTarget, patches: readonly ObjectTransform[], find: (id: string) => SceneObject | undefined,
): ClipData | undefined {
  const pose = sampleClip(target.clip, target.time, find);
  let allowed = true;
  const result = changeClip(data, target.id, clip => {
    const tracks = [...clip.tracks];
    for (const { id, patch } of patches) {
      const node = find(id);
      if (!node) continue;
      for (const [property, value] of channels(patch)) {
        const base = authoredValue(node, property);
        if (Math.abs((pose.get(id)?.get(property) ?? base) - value) < 0.0001) continue;
        const index = tracks.findIndex(item => item.target === id && item.property === property);
        const track = tracks[index];
        if (!track) {
          if (tracks.length === timelineLimits.tracks) { allowed = false; break; }
          tracks.push({ id: crypto.randomUUID(), target: id, property, keys: [
            ...(target.time > 0 ? [{ id: crypto.randomUUID(), time: 0, value: base, ease: 'linear' as const }] : []),
            { id: crypto.randomUUID(), time: target.time, value, ease: 'linear' },
          ] });
        } else {
          const at = track.keys.find(key => Math.abs(key.time - target.time) < 1e-9);
          if (!at && track.keys.length === timelineLimits.keys) { allowed = false; break; }
          tracks[index] = { ...track, keys: at ? track.keys.map(key => key === at ? { ...key, value } : key) :
            [...track.keys, { id: crypto.randomUUID(), time: target.time, value, ease: 'linear' as const }].sort((a, b) => a.time - b.time) };
        }
      }
    }
    return { ...clip, tracks };
  });
  return allowed ? result : undefined;
}
