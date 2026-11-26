import { describe, expect, it } from 'vitest';
import { instantiatePrefab, revisePrefab, type Prefab } from './prefabs';
import { parseProject, projectFromScene, serializeProject } from './project';
import { createObject, emptyScene, findObject } from './scene';

describe('linked prefab sources', () => {
  it('propagates base and nested source changes while preserving local values and Timeline targets', () => {
    const sprite = { ...createObject('Sprite'), label: 'Banner', texture: 'images/olive-crystal.png' };
    const leaf: Prefab = { id: 'leaf', name: 'Leaf', root: sprite, timeline: [{
      id: 'movement', target: sprite.id, property: 'rotation', keys: [{ id: 'start', time: 0, value: 15, ease: 'linear' }],
    }] };
    const variant: Prefab = { ...leaf, id: 'variant', base: leaf.id, name: 'Variant', root: { ...sprite, label: 'Variant Label' } };
    const nested = instantiatePrefab(leaf, { x: 11, y: 12 });
    const parent: Prefab = { id: 'parent', name: 'Parent', root: { ...createObject('Container'), children: [nested.root] }, timeline: nested.timeline };
    const placed = instantiatePrefab(parent, { x: 50, y: 90 });
    const second = instantiatePrefab(variant, { x: 23, y: 42 });
    const liveNested = findObject([placed.root], placed.timeline[0].target)!;
    liveNested.label = 'Local Label';
    const base = projectFromScene(emptyScene());
    base.version = 2;
    base.prefabs = [parent, variant, leaf];
    base.scenes[0] = { ...base.scenes[0], objects: [placed.root, second.root], timeline: [...placed.timeline, ...second.timeline] };

    const next = revisePrefab(base, { ...leaf, root: { ...sprite, label: 'New Label', alpha: 0.6 },
      timeline: [{ ...leaf.timeline[0], keys: [{ id: 'start', time: 0, value: 90, ease: 'linear' }] }] })!;
    const doc = parseProject(JSON.parse(serializeProject(next)));
    const scene = doc.scenes[0];
    expect(findObject(scene.objects, liveNested.id)).toMatchObject({ label: 'Local Label', alpha: 0.6, position: { x: 11, y: 12 } });
    expect(findObject(scene.objects, second.root.id)).toMatchObject({ label: 'Variant Label', alpha: 0.6, position: { x: 23, y: 42 } });
    expect(scene.timeline.find(track => track.id === placed.timeline[0].id)).toMatchObject({
      target: liveNested.id, keys: [{ value: 90 }],
    });
  });
});
