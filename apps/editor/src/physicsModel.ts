import {
  BoxColliderSchema, CapsuleColliderSchema, CircleColliderSchema, JointSchema, PolygonColliderSchema, RigidBodySchema,
  defaultJoint, parsePoints,
} from '@rewrite/physics/contracts';
import { z } from 'zod';

const colliderOffset = { offsetX: 0, offsetY: 0, sensor: false };
const collider = z.discriminatedUnion('kind', [
  z.strictObject({ id: z.string().min(1), kind: z.literal('box'), data: BoxColliderSchema }),
  z.strictObject({ id: z.string().min(1), kind: z.literal('circle'), data: CircleColliderSchema }),
  z.strictObject({ id: z.string().min(1), kind: z.literal('capsule'), data: CapsuleColliderSchema }),
  z.strictObject({ id: z.string().min(1), kind: z.literal('polygon'), data: PolygonColliderSchema.refine(data => {
    try { parsePoints(data.points); return true; }
    catch { return false; }
  }) }),
]);

const joint = z.strictObject({ id: z.string().min(1), data: JointSchema });
const unique = <T extends { id: string }>(items: T[]) => new Set(items.map(item => item.id)).size === items.length;

export const objectPhysicsSchema = z.strictObject({
  body: RigidBodySchema.optional(),
  colliders: z.array(collider).max(16).refine(unique).default([]),
  joints: z.array(joint).max(16).refine(unique).default([]),
});
export type ObjectPhysics = z.output<typeof objectPhysicsSchema>;
export type Collider = z.output<typeof collider>;

export const emptyPhysics = (): ObjectPhysics => ({ colliders: [], joints: [] });
export const newJoint = () => ({ id: crypto.randomUUID(), data: { ...defaultJoint } });
export const colliderKinds = ['box', 'circle', 'capsule', 'polygon'] as const;

export function newCollider(kind: Collider['kind']): Collider {
  const id = crypto.randomUUID();
  switch (kind) {
    case 'box': return { id, kind, data: { ...colliderOffset, width: 100, height: 100, chamfer: 0 } };
    case 'circle': return { id, kind, data: { ...colliderOffset, radius: 50 } };
    case 'capsule': return { id, kind, data: { ...colliderOffset, width: 60, height: 120 } };
    case 'polygon': return { id, kind, data: { ...colliderOffset, points: '-50,-40 50,-40 50,40 -50,40' } };
  }
}

export function hasPhysics(node: { physics?: ObjectPhysics; collision?: string }) {
  const data = node.physics;
  return !!(data?.body || data?.colliders.length || data?.joints.length || node.collision === 'solid');
}
