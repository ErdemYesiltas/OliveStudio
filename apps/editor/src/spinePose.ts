import { AtlasAttachmentLoader, Physics, Skeleton, SkeletonJson, TextureAtlas, Vector2 } from '@esotericsoftware/spine-core';
import type { SpineBone, SpineInfluence, SpineMeshPoint } from '@olivestudio/engine/spine-format';
import { t } from './i18n';

export function spineSetupSkeleton(bones: SpineBone[]) {
  const atlas = new TextureAtlas('');
  try {
    const data = new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData({
      bones: bones.map(bone => ({ ...bone, skin: false })),
    });
    const skeleton = new Skeleton(data);
    skeleton.updateWorldTransform(Physics.none);
    return skeleton;
  } finally { atlas.dispose(); }
}

export function spineLocalPoint(skeleton: Skeleton, bone: number, point: Vector2) {
  const local = skeleton.bones[bone].worldToLocal(point);
  if (!Number.isFinite(local.x) || !Number.isFinite(local.y)) throw new Error(t('spineMeshInvalidTransform'));
  return local;
}

export function spineLocalDelta(skeleton: Skeleton, bone: number, x: number, y: number) {
  const origin = spineLocalPoint(skeleton, bone, new Vector2());
  const end = spineLocalPoint(skeleton, bone, new Vector2(x, y));
  return { x: end.x - origin.x, y: end.y - origin.y };
}

export function spineRebasePoint(skeleton: Skeleton, from: number, to: number, point: SpineMeshPoint, delta: boolean) {
  const source = skeleton.bones[from];
  const local = spineLocalPoint(skeleton, to, source.localToWorld(new Vector2(point.x, point.y)));
  if (!delta) return local;
  const origin = spineLocalPoint(skeleton, to, source.localToWorld(new Vector2()));
  return { x: local.x - origin.x, y: local.y - origin.y };
}

export function spineWeightedPoint(skeleton: Skeleton, influences: SpineInfluence[]) {
  const result = new Vector2();
  for (const influence of influences) {
    const world = skeleton.bones[influence.bone].localToWorld(new Vector2(influence.x, influence.y));
    result.x += world.x * influence.weight;
    result.y += world.y * influence.weight;
  }
  return result;
}
