import type { SceneObject } from './scene';

export type Point = { x: number; y: number };
export type Alignment = 'left' | 'centerX' | 'right' | 'top' | 'centerY' | 'bottom' | 'spacingX' | 'spacingY';
type Box = { x: number; y: number; width: number; height: number };

export function selectionTree(nodes: readonly SceneObject[]) {
  const items = new Map<string, { node: SceneObject; parent: string | null; inheritedLock: boolean }>();
  function walk(children: readonly SceneObject[], parent: string | null, inheritedLock: boolean) {
    for (const node of children) {
      items.set(node.id, { node, parent, inheritedLock });
      if (node.type === 'Container') walk(node.children, node.id, inheritedLock || !!node.locked);
    }
  }
  walk(nodes, null, false);
  return items;
}

export function selectionRoots(tree: ReturnType<typeof selectionTree>, ids: readonly string[]) {
  const selected = new Set(ids);
  return ids.filter(id => {
    let parent = tree.get(id)?.parent;
    while (parent) {
      if (selected.has(parent)) return false;
      parent = tree.get(parent)?.parent;
    }
    return tree.has(id);
  });
}

export function changeSelection(nodes: SceneObject[], ids: ReadonlySet<string>, change: (node: SceneObject) => SceneObject | null): SceneObject[] {
  let changed = false;
  const next = nodes.flatMap(node => {
    let updated = ids.has(node.id) ? change(node) : node;
    if (updated?.type === 'Container') {
      const children = changeSelection(updated.children, ids, change);
      if (updated.children !== children) updated = { ...updated, children };
    }
    changed ||= updated !== node;
    return updated ? [updated] : [];
  });
  return changed ? next : nodes;
}

export function toggleSelection(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? ids.filter(item => item !== id) : [...ids, id];
}

export function boxBetween(a: Point, b: Point): Box {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}

export function unionBoxes(boxes: readonly Box[]): Box | undefined {
  if (!boxes.length) return;
  return boxBetween(
    { x: Math.min(...boxes.map(box => box.x)), y: Math.min(...boxes.map(box => box.y)) },
    { x: Math.max(...boxes.map(box => box.x + box.width)), y: Math.max(...boxes.map(box => box.y + box.height)) },
  );
}

export function alignedOffsets(bounds: readonly (Box & { id: string })[], command: Alignment) {
  const union = unionBoxes(bounds);
  const spacing = command === 'spacingX' || command === 'spacingY';
  if (!union || bounds.length < (spacing ? 3 : 2)) return [];
  const horizontal = command === 'left' || command === 'centerX' || command === 'right' || command === 'spacingX';
  const axis = horizontal ? 'x' : 'y';
  const size = horizontal ? 'width' : 'height';
  let cursor = union[axis];
  const ordered = spacing ? [...bounds].sort((a, b) => a[axis] - b[axis]) : bounds;
  const gap = spacing ? (union[size] - bounds.reduce((sum, box) => sum + box[size], 0)) / (bounds.length - 1) : 0;
  const ratio = command === 'centerX' || command === 'centerY' ? 0.5 : command === 'right' || command === 'bottom' ? 1 : 0;
  return ordered.map(box => {
    const offset = (spacing ? cursor : union[axis] + (union[size] - box[size]) * ratio) - box[axis];
    cursor += box[size] + gap;
    return { id: box.id, x: horizontal ? offset : 0, y: horizontal ? 0 : offset };
  });
}
