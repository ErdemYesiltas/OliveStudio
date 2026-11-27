import { createGraphDefinition, GraphSchema } from '@rewrite/interactions';
import { logicTools } from './sceneLogic';
import { z } from 'zod';
import { findObject, objectSchema, type CameraObject, type PrefabLink, type SceneObject } from './scene';
import { selectionRoots, selectionTree } from './selection';
import { timelineSchema, type TweenTrack } from './timeline';
import type { Project, SceneRecord } from './project';

export const prefabLimit = 100;
const prefabSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(100),
  root: objectSchema,
  timeline: timelineSchema.default([]),
  base: z.string().min(1).optional(),
});
export type Prefab = z.output<typeof prefabSchema>;
export const prefabsSchema = z.array(prefabSchema).max(prefabLimit).default([]);

type Content = Pick<SceneRecord, 'objects' | 'timeline'>;
type IdMap = ReadonlyMap<string, string>;
const inverse = (map: IdMap) => new Map([...map].map(([key, value]) => [value, key]));

function remapEntries(items: Record<string, string>, ids: IdMap) {
  return Object.fromEntries(Object.entries(items).flatMap(([key, value]) => {
    const mapped = ids.get(value);
    return mapped ? [[key, mapped]] : [];
  }));
}

const remapGraph = createGraphDefinition(() => logicTools()).remapReferences!;

function remapCamera(camera: CameraObject['camera'], targetId: (id: string) => string): CameraObject['camera'] {
  return { ...camera,
    postFXs: camera.postFXs?.map(effect => 'target' in effect ? { ...effect, target: targetId(effect.target) } : effect) };
}

function remapNode(node: SceneObject, ids: IdMap, trackIds: IdMap, scenes?: IdMap): SceneObject {
  const id = ids.get(node.id)!;
  const prefab = node.prefab && { ...node.prefab, objects: remapEntries(node.prefab.objects, ids), tracks: remapEntries(node.prefab.tracks, trackIds) };
  const physics = node.physics && { ...node.physics, joints: node.physics.joints.map(joint => ({
    ...joint, data: { ...joint.data, target: ids.get(joint.data.target) ?? joint.data.target },
  })) };
  const remapRefs = (refs: Record<string, string>) => Object.fromEntries(Object.entries(refs)
    .map(([key, value]) => [key, ids.get(value) ?? value]));
  const logicGraph = node.logicGraph && GraphSchema.parse(remapGraph(node.logicGraph, { entities: ids, components: new Map(), scenes }));
  const metadata = { ...(logicGraph ? { logicGraph } : {}), ...(prefab ? { prefab } : {}), ...(physics ? { physics } : {}),
    ...(node.behavior ? { behavior: { ...node.behavior, refs: remapRefs(node.behavior.refs) } } : {}),
    ...(node.behaviour ? { behaviour: { ...node.behaviour, refs: remapRefs(node.behaviour.refs) } } : {}) };
  if (node.type === 'Camera2D') {
    return { ...node, ...metadata, id, camera: remapCamera(node.camera, target => ids.get(target) ?? target) };
  }
  return node.type === 'Container' ? { ...node, ...metadata, id, children: node.children.map(child => remapNode(child, ids, trackIds, scenes)) } :
    { ...node, ...metadata, id };
}

function remapTracks(timeline: readonly TweenTrack[], ids: IdMap, trackIds: IdMap) {
  return timeline.flatMap(track => {
    const target = ids.get(track.target), id = trackIds.get(track.id);
    return target && id ? [{ ...track, id, target }] : [];
  });
}

export function duplicateContent(content: Content, scenes?: IdMap) {
  const ids = new Map([...selectionTree(content.objects).keys()].map(id => [id, crypto.randomUUID()]));
  const trackIds = new Map(content.timeline.map(track => [track.id, crypto.randomUUID()]));
  return { objects: content.objects.map(node => remapNode(node, ids, trackIds, scenes)),
    timeline: remapTracks(content.timeline, ids, trackIds), ids, trackIds };
}

export function prefabOwner(nodes: SceneObject[], id: string | null) {
  function find(items: SceneObject[], owner?: SceneObject): SceneObject | undefined {
    for (const node of items) {
      const linked = owner ?? (node.prefab ? node : undefined);
      if (node.id === id) return linked;
      if (node.type === 'Container' && findObject(node.children, id)) return find(node.children, linked);
    }
  }
  return id ? find(nodes) : undefined;
}

function visit(nodes: SceneObject[], update: (node: SceneObject) => SceneObject, skipLinked = false): SceneObject[] {
  let changed = false;
  const next = nodes.map(node => {
    let item = update(node);
    if (item === node && node.type === 'Container' && !(skipLinked && node.prefab)) {
      const children = visit(node.children, update, skipLinked);
      if (children !== node.children) item = { ...node, children };
    }
    changed ||= item !== node;
    return item;
  });
  return changed ? next : nodes;
}

export function capturable(nodes: SceneObject[], ids: string[]) {
  const tree = selectionTree(nodes);
  const roots = selectionRoots(tree, ids).map(id => tree.get(id)!);
  const parent = roots[0]?.parent;
  if (!roots.length || roots.some(item => item.parent !== parent || prefabOwner(nodes, item.node.id))) return;
  const rootIds = new Set(roots.map(item => item.node.id));
  const container = parent ? tree.get(parent)?.node : undefined;
  const siblings = container?.type === 'Container' ? container.children : nodes;
  return { parent: parent ?? null, nodes: siblings.filter(node => rootIds.has(node.id)) };
}

export function capturePrefab(scene: SceneRecord, capture: NonNullable<ReturnType<typeof capturable>>, group: SceneObject) {
  const root = capture.nodes.length === 1 ? capture.nodes[0] :
    group.type === 'Container' ? { ...group, children: capture.nodes } : group;
  const members = selectionTree([root]);
  const copied = duplicateContent({ objects: [root], timeline: scene.timeline.filter(track => members.has(track.target)) });
  const id = crypto.randomUUID();
  const prefab: Prefab = { id, name: root.label.slice(0, 100), root: { ...copied.objects[0], position: { x: 0, y: 0 } }, timeline: copied.timeline };
  const linked = { ...root, prefab: { source: id, objects: Object.fromEntries(inverse(copied.ids)), tracks: Object.fromEntries(inverse(copied.trackIds)) } };
  const selected = new Set(capture.nodes.map(node => node.id));
  const replace = (nodes: SceneObject[]) => {
    let placed = false;
    return nodes.flatMap(node => {
      if (!selected.has(node.id)) return [node];
      if (placed) return [];
      placed = true;
      return [linked];
    });
  };
  const objects = capture.parent ?
    visit(scene.objects, node => node.id === capture.parent && node.type === 'Container' ? { ...node, children: replace(node.children) } : node) :
    replace(scene.objects);
  return { prefab, scene: { ...scene, objects }, root: root.id };
}

export function instantiatePrefab(prefab: Prefab, position: SceneObject['position']) {
  const { objects, timeline, ids, trackIds } = duplicateContent({ objects: [prefab.root], timeline: prefab.timeline });
  const root = { ...objects[0], position, prefab: { source: prefab.id, objects: Object.fromEntries(ids), tracks: Object.fromEntries(trackIds) } };
  return { root, timeline };
}

function equal(before: unknown, value: unknown) {
  return before === value || JSON.stringify(before) === JSON.stringify(value);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

function merge(before: unknown, local: unknown, after: unknown): unknown {
  if (equal(before, local)) return after;
  if (!isRecord(before) || !isRecord(local) || !isRecord(after)) return local;
  return Object.fromEntries([...new Set([...Object.keys(after), ...Object.keys(local)])].flatMap(key => {
    const value = merge(before[key], local[key], after[key]);
    return value === undefined ? [] : [[key, value]];
  }));
}

function values(node: SceneObject) {
  const fields: Record<string, unknown> = { ...node };
  delete fields.id;
  delete fields.children;
  delete fields.prefab;
  return fields;
}

function authoredIndex(content: Content) {
  return { nodes: selectionTree(content.objects), tracks: new Map(content.timeline.map(track => [track.id, track])) };
}

function variantRoot(root: SceneObject, before: ReturnType<typeof selectionTree>, live: ReturnType<typeof selectionTree>): SceneObject {
  if (root.type !== 'Container') return root;
  const local = live.get(root.id)?.node;
  const inherited = root.children.flatMap(child => !before.has(child.id) || live.has(child.id) ? [variantRoot(child, before, live)] : []);
  const additions = local?.type === 'Container' ? local.children.filter(child =>
    !before.has(child.id) && !inherited.some(node => node.id === child.id)) : [];
  return { ...root, children: [...inherited, ...additions] };
}

function rebase(previous: Prefab, next: Prefab, liveRoot: SceneObject, timeline: TweenTrack[], link: PrefabLink, mode: 'merge' | 'revert' | 'variant' = 'merge') {
  const before = authoredIndex({ objects: [previous.root], timeline: previous.timeline });
  const current = authoredIndex({ objects: [liveRoot], timeline });
  const remap = (id: string, map: Record<string, string>) => Object.hasOwn(map, id) ? map[id] :
    mode === 'variant' ? id : crypto.randomUUID();
  const template = mode === 'variant' ? variantRoot(next.root, before.nodes, current.nodes) : next.root;
  const ids = new Map([...selectionTree([template]).keys()].map(id => [id, remap(id, link.objects)]));
  ids.set(next.root.id, liveRoot.id);
  const adopted = new Map<string, TweenTrack>();
  const trackIds = new Map(next.timeline.map(track => {
    if (mode === 'merge' && !Object.hasOwn(link.tracks, track.id)) {
      const existing = timeline.find(local => local.target === ids.get(track.target) && local.property === track.property);
      if (existing) { adopted.set(track.id, existing); return [track.id, existing.id]; }
    }
    return [track.id, remap(track.id, link.tracks)];
  }));
  if (mode === 'variant') {
    for (const track of timeline) if (!trackIds.has(track.id)) trackIds.set(track.id, track.id);
  }
  function build(source: SceneObject, mapped: SceneObject): SceneObject {
    const old = before.nodes.get(source.id)?.node, local = current.nodes.get(mapped.id)?.node;
    const baseline = old?.type === 'Camera2D' ?
      { ...old, camera: remapCamera(old.camera, target => link.objects[target] ?? target) } : old;
    const fields = mode !== 'revert' && baseline && local ? merge(values(baseline), values(local), values(mapped)) : values(mapped);
    const result = { ...(fields as SceneObject), id: mapped.id, ...(mapped.prefab ? { prefab: mapped.prefab } : {}) } as SceneObject;
    return source.type === 'Container' && mapped.type === 'Container' ?
      { ...result, type: 'Container', children: source.children.map((child, index) => build(child, mapped.children[index])) } : result;
  }
  const mappedRoot = build(template, remapNode(template, ids, trackIds));
  const { position, rotation, scale } = liveRoot;
  const root = { ...mappedRoot, ...(mode === 'variant' ? {} : { position, rotation, scale }),
    prefab: { source: next.id, objects: Object.fromEntries(ids), tracks: Object.fromEntries(trackIds) } };
  const oldTracks = new Set([...Object.values(link.tracks), ...[...adopted.values()].map(track => track.id)]);
  const survivingIds = new Set(ids.values());
  const removedNodes = new Set(Object.values(link.objects).filter(id => !survivingIds.has(id)));
  const inheritedTracks = mode === 'variant' ? new Set(previous.timeline.map(track => track.id)) : oldTracks;
  const kept = timeline.filter(track => !inheritedTracks.has(track.id) && !removedNodes.has(track.target) &&
    (mode !== 'revert' || !current.nodes.has(track.target)));
  const occupied = new Set(kept.map(track => JSON.stringify([track.target, track.property])));
  const tracks = next.timeline.flatMap(track => {
    const id = trackIds.get(track.id)!, target = ids.get(track.target);
    if (!target || occupied.has(JSON.stringify([target, track.property]))) return [];
    const oldId = link.tracks[track.id];
    const old = before.tracks.get(track.id), local = oldId ? current.tracks.get(oldId) : undefined;
    if (mode !== 'revert' && old && oldId && !local) return [];
    const keys = adopted.get(track.id)?.keys ?? (mode !== 'revert' && old && local && !equal(old.keys, local.keys) ? local.keys : track.keys);
    return [{ ...track, id, target, keys }];
  });
  return { root, timeline: [...kept, ...tracks] };
}

function refresh(content: Content, previous: Prefab, next: Prefab): Content {
  let timeline = content.timeline;
  const objects = visit(content.objects, node => {
    if (node.prefab?.source !== next.id) return node;
    const revised = rebase(previous, next, node, timeline, node.prefab);
    timeline = revised.timeline;
    return revised.root;
  }, true);
  return objects === content.objects ? content : { objects, timeline };
}

export function dependencies(prefab: Prefab) {
  return new Set([...(prefab.base ? [prefab.base] : []),
    ...[...selectionTree([prefab.root]).values()].flatMap(({ node }) => node.prefab ? [node.prefab.source] : [])]);
}

export function orderedPrefabs(prefabs: readonly Prefab[]) {
  const pending = new Map(prefabs.map(prefab => [prefab.id, prefab]));
  const ordered: Prefab[] = [];
  const seen = new Set<string>();
  while (pending.size) {
    const ready = [...pending.values()].filter(prefab => [...dependencies(prefab)].every(id => seen.has(id)));
    if (!ready.length) return undefined;
    ready.forEach(prefab => { pending.delete(prefab.id); seen.add(prefab.id); ordered.push(prefab); });
  }
  return ordered;
}

export function dependsOn(prefabs: readonly Prefab[], id: string, target: string) {
  const byId = new Map(prefabs.map(prefab => [prefab.id, prefab]));
  const visited = new Set<string>();
  function check(id: string): boolean {
    if (id === target) return true;
    if (visited.has(id)) return false;
    visited.add(id);
    const source = byId.get(id);
    return !!source && [...dependencies(source)].some(check);
  }
  return check(id);
}

function refreshVariant(previousBase: Prefab, nextBase: Prefab, variant: Prefab): Prefab {
  const ids = Object.fromEntries([...selectionTree([variant.root]).keys()].map(id => [id, id]));
  const tracks = Object.fromEntries(variant.timeline.map(track => [track.id, track.id]));
  const { root, timeline } = rebase(previousBase, nextBase, variant.root, variant.timeline, { source: nextBase.id, objects: ids, tracks }, 'variant');
  const { prefab: _link, ...fields } = root;
  return { ...variant, root: fields as SceneObject, timeline };
}

export function revisePrefab(project: Project, revised: Prefab): Project | undefined {
  const before = new Map(project.prefabs.map(prefab => [prefab.id, prefab]));
  const ordered = orderedPrefabs(project.prefabs.map(prefab => prefab.id === revised.id ? revised : prefab));
  if (!ordered) return;
  const changes: { old: Prefab; next: Prefab }[] = [];
  const prefabs = ordered.map(prefab => {
    let current = prefab;
    for (const { old, next } of changes) {
      if (current.base === next.id) current = refreshVariant(old, next, current);
      const source = { objects: [current.root], timeline: current.timeline };
      const updated = refresh(source, old, next);
      if (source !== updated) current = { ...current, root: updated.objects[0], timeline: updated.timeline };
    }
    const old = before.get(current.id)!;
    if (current !== old) changes.push({ old, next: current });
    return current;
  });
  const scenes = project.scenes.map(scene => {
    let current: Content = scene;
    for (const { old, next } of changes) current = refresh(current, old, next);
    return current === scene ? scene : { ...scene, ...current };
  });
  return { ...project, prefabs, scenes };
}

export function revertPrefab(scene: SceneRecord, root: SceneObject, source: Prefab): SceneRecord {
  if (!root.prefab) return scene;
  const { root: restored, timeline } = rebase(source, source, root, scene.timeline, root.prefab, 'revert');
  return { ...scene, objects: visit(scene.objects, node => node.id === root.id ? restored : node), timeline };
}

export function applyPrefab(scene: SceneRecord, root: SceneObject, source: Prefab): Prefab {
  if (!root.prefab) return source;
  const ids = inverse(new Map(Object.entries(root.prefab.objects)));
  const trackIds = inverse(new Map(Object.entries(root.prefab.tracks)));
  const timeline = scene.timeline.filter(track => ids.has(track.target));
  for (const track of timeline) if (!trackIds.has(track.id)) trackIds.set(track.id, crypto.randomUUID());
  const { prefab: _link, ...mapped } = remapNode(root, ids, trackIds);
  const { position, rotation, scale } = source.root;
  return { ...source, root: { ...mapped, position, rotation, scale } as SceneObject, timeline: remapTracks(timeline, ids, trackIds) };
}

export function unpackPrefab(scene: SceneRecord, id: string): SceneRecord {
  return { ...scene, objects: visit(scene.objects, node => {
    if (node.id !== id || !node.prefab) return node;
    const { prefab: _link, ...fields } = node;
    return fields as SceneObject;
  }) };
}
