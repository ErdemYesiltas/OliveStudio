import type { SpineDocument } from './spine-format.js';

export const spineConstraintKinds = ['ik', 'transform', 'path', 'physics'] as const;
export type SpineConstraintKind = typeof spineConstraintKinds[number];
export type SpineConstraint = NonNullable<SpineDocument[SpineConstraintKind]>[number];

export function orderedSpineConstraints(document: SpineDocument) {
  return spineConstraintKinds.flatMap(kind => (document[kind] ?? []).map(constraint => ({ kind, constraint })))
    .sort((a, b) => Number(a.constraint.order ?? 0) - Number(b.constraint.order ?? 0));
}

function applyConstraintOrder(document: SpineDocument, entries: ReturnType<typeof orderedSpineConstraints>) {
  const order = new Map(entries.map(({ constraint }, index) => [constraint, index]));
  const next = { ...document };
  for (const kind of spineConstraintKinds) {
    if (document[kind]) next[kind] = document[kind]?.map(constraint => ({ ...constraint, order: order.get(constraint) }));
  }
  return next;
}

export function moveSpineConstraint(document: SpineDocument, kind: SpineConstraintKind, name: string, index: number) {
  const entries = orderedSpineConstraints(document);
  const current = entries.findIndex(entry => entry.kind === kind && entry.constraint.name === name);
  if (current < 0 || !Number.isInteger(index) || index < 0 || index >= entries.length) throw new Error('Invalid constraint order');
  const [entry] = entries.splice(current, 1);
  entries.splice(index, 0, entry);
  return applyConstraintOrder(document, entries);
}

export function addSpineConstraint(document: SpineDocument, kind: SpineConstraintKind, constraint: SpineConstraint) {
  if (document[kind]?.some(item => item.name === constraint.name)) throw new Error('Constraint names must be unique');
  const next = { ...document, [kind]: [...(document[kind] ?? []), constraint] };
  return applyConstraintOrder(next, [...orderedSpineConstraints(document), { kind, constraint }]);
}

export function removeSpineConstraint(document: SpineDocument, kind: SpineConstraintKind, name: string) {
  const next = { ...document, [kind]: document[kind]?.filter(constraint => constraint.name !== name) };
  if (document.skins) next.skins = document.skins.map(skin => Array.isArray(skin[kind])
    ? { ...skin, [kind]: skin[kind].filter(value => value !== name) } : skin);
  if (document.animations) next.animations = Object.fromEntries(Object.entries(document.animations).map(([clipName, clip]) => {
    const value = clip[kind];
    if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.hasOwn(value, name)) return [clipName, clip];
    const { [name]: _removed, ...remaining } = value as Record<string, unknown>;
    return [clipName, { ...clip, [kind]: remaining }];
  }));
  return applyConstraintOrder(next, orderedSpineConstraints(next));
}
