import { describe, expect, it } from 'vitest';
import { duplicateSpineAnimation, parseSpineDocument, removeSpineAnimation, renameSpineAnimation } from '@olivestudio/engine/spine-format';
import { duplicateScene, projectFromScene } from './project';
import { emptyCinematics } from './cinematics';
import { createObject, emptyScene, findObject } from './scene';
import { remapProjectSpineReferences, spineEventAudioChanges } from './spineAssets';
import { parseDirectorSource } from './directorModel';

function projectWithRigs() {
  const rig = { ...createObject('Spine'), id: 'rig', label: 'Relay', asset: 'relay.json', animation: 'charge', skin: 'warm',
    mix: { duration: 0, pairs: [{ from: 'idle', to: 'charge', duration: 0.45 }, { from: 'charge', to: 'hop', duration: 0.6 }] } };
  const other = { ...rig, id: 'other', label: 'Another rig', asset: 'other.json' };
  const project = projectFromScene(emptyScene());
  const scene = project.scenes[0];
  const objects = [...scene.objects, { ...createObject('Container'), children: [rig] }, other];
  const source = {
    vars: { clip: 'charge' },
    root: { type: 'sequence', children: [
      { type: 'race', children: [
        { type: 'animation', target: 'Relay', key: 'charge' },
        { type: 'delay', ms: 150 },
      ] },
      { type: 'if', when: '$ready', then: { type: 'animation', target: ['rig', 'other'], key: 'charge', overrides: { speed: 2 } } },
      { type: 'animation', target: 'rig', key: '$clip' },
      { type: 'animation', target: 'other', key: 'charge' },
      { type: 'emit', event: 'sample', payload: { type: 'animation', target: 'rig', key: 'charge' } },
    ] },
  };
  project.scenes = [{ ...scene, objects, cinematics: { ...emptyCinematics, director: [{
    id: 'showcase', name: 'Showcase', source: JSON.stringify(source), event: '', whenExpr: '',
  }] } }];
  project.prefabs = [{ id: 'relay', name: 'Relay source', root: { ...rig, id: 'prefab-rig' }, timeline: [] }];
  return { project, rig, other, source };
}

describe('Spine animation library', () => {
  it('updates graph trigger names and removes deleted Spine triggers without changing unrelated sources', () => {
    const { project, other, rig } = projectWithRigs();
    const graph = {
      nodes: [
        { id: 'cue', kind: 'event', x: 0, y: 0, trigger: { type: 'spine.event', sourceId: rig.id, event: 'ping' } },
        { id: 'done', kind: 'event', x: 0, y: 0, trigger: { type: 'spine.complete', sourceId: rig.id, event: 'charge' } },
        { id: 'another', kind: 'event', x: 0, y: 0, trigger: { type: 'spine.event', sourceId: other.id, event: 'ping' } },
        { id: 'wait', kind: 'delay', x: 0, y: 0, seconds: 1 },
      ],
      links: [{ id: 'cue-link', from: 'cue', port: 'next', to: 'wait' }, { id: 'done-link', from: 'done', port: 'next', to: 'wait' }],
    } as const;
    Object.assign(other, { logicGraph: graph });
    const mapped = remapProjectSpineReferences(project, 'relay.json', {
      skins: [], animations: [{ from: 'charge', to: null }], events: [{ from: 'ping', to: 'spark' }],
    });
    expect(findObject(mapped.scenes[0].objects, other.id)?.logicGraph).toEqual({
      nodes: [{ ...graph.nodes[0], trigger: { ...graph.nodes[0].trigger, event: 'spark' } }, graph.nodes[2], graph.nodes[3]],
      links: [graph.links[0]],
    });
  });

  it('carries existing event sound overrides and mutes to edited paths in scenes and prefabs', () => {
    const { project, rig, other } = projectWithRigs();
    const before = {
      cue: { audio: 'old.wav' }, pause: { audio: 'mute.wav' }, clap: { audio: 'shared.wav' },
      hit: { audio: 'shared.wav' }, removal: { audio: 'unused.wav' },
    };
    const after = {
      cue: { audio: 'new.wav' }, pause: { audio: 'silence.wav' },
      clap: { audio: 'clap.wav' }, hit: before.hit,
    };
    const overrides = { 'old.wav': 'sound-1', 'mute.wav': null, 'shared.wav': 'sound-2', 'unused.wav': 'sound-3' };
    Object.assign(rig, { eventAudio: overrides });
    Object.assign(other, { eventAudio: overrides });
    Object.assign(project.prefabs[0].root, { eventAudio: { ...overrides, 'new.wav': 'existing' } });
    const next = remapProjectSpineReferences(project, 'relay.json', {
      skins: [], animations: [], eventAudio: spineEventAudioChanges(before, after),
    });
    const expected = { 'new.wav': 'sound-1', 'silence.wav': null, 'shared.wav': 'sound-2', 'clap.wav': 'sound-2' };
    expect(findObject(next.scenes[0].objects, rig.id)).toMatchObject({ eventAudio: expected });
    expect(findObject(next.scenes[0].objects, rig.id)).not.toHaveProperty(['eventAudio', 'old.wav']);
    expect(findObject(next.scenes[0].objects, rig.id)).not.toHaveProperty(['eventAudio', 'unused.wav']);
    expect(findObject(next.scenes[0].objects, other.id)).toBe(other);
    expect(next.prefabs[0].root).toMatchObject({ eventAudio: { ...expected, 'new.wav': 'existing' } });
  });

  it('keeps authored queues and overlays consistent with animation renames and removals', () => {
    const { project, rig } = projectWithRigs();
    project.scenes[0].objects = project.scenes[0].objects.map(node => node.type === 'Container' ? {
      ...node, children: node.children.map(child => child === rig ? { ...rig, playback: {
        queue: [{ animation: 'charge', loop: false, delay: 0.25 }],
        tracks: [{ weight: 0.6, clips: [{ animation: 'hop', loop: true, delay: 0 }] }],
      } } : child),
    } : node);
    const next = remapProjectSpineReferences(project, 'relay.json', {
      skins: [], animations: [{ from: 'charge', to: 'spark' }, { from: 'hop', to: null }],
    });
    expect(findObject(next.scenes[0].objects, rig.id)).toMatchObject({ playback: {
      queue: [{ animation: 'spark', loop: false, delay: 0.25 }], tracks: [],
    } });
  });
  it('clears a removed skin only from objects and prefabs using its rig', () => {
    const { project, rig, other } = projectWithRigs();
    const next = remapProjectSpineReferences(project, 'relay.json', {
      skins: [{ from: 'warm', to: 'amber' }, { from: 'amber', to: null }], animations: [],
    });
    expect(findObject(next.scenes[0].objects, rig.id)).toMatchObject({ skin: null, animation: 'charge' });
    expect(findObject(next.scenes[0].objects, other.id)).toBe(other);
    expect(next.prefabs[0].root).toMatchObject({ skin: null, animation: 'charge' });
  });

  it('rewrites ordered skin layers across objects and prefabs on save', () => {
    const { project, rig, other } = projectWithRigs();
    rig.skinLayers = ['hood', 'boots', 'coat'];
    const prefab = project.prefabs[0].root;
    if (prefab.type !== 'Spine') throw new Error('Expected a Spine prefab');
    prefab.skinLayers = ['boots', 'coat'];
    const next = remapProjectSpineReferences(project, 'relay.json', {
      skins: [{ from: 'hood', to: 'helmet' }, { from: 'boots', to: null }], animations: [],
    });
    expect(findObject(next.scenes[0].objects, rig.id)).toMatchObject({ skin: 'warm', skinLayers: ['helmet', 'coat'] });
    expect(findObject(next.scenes[0].objects, other.id)).toBe(other);
    expect(next.prefabs[0].root).toMatchObject({ skin: 'warm', skinLayers: ['coat'] });
  });
  it('duplicates all clip data independently and preserves ordering during rename', () => {
    const rig = parseSpineDocument(JSON.stringify({
      skeleton: { spine: '4.2.120' }, bones: [{ name: 'root' }],
      animations: { charge: { events: [{ time: 0.5, name: 'ready' }], custom: { tags: ['spark'] } }, hop: {} },
    }));
    const copy = duplicateSpineAnimation(rig, 'charge', 'charge-long');
    expect(copy.animations?.['charge-long']).toEqual(rig.animations?.charge);
    expect(copy.animations?.['charge-long']?.events).not.toBe(rig.animations?.charge?.events);
    expect(() => renameSpineAnimation(copy, 'charge', 'hop')).toThrow();
    const renamed = renameSpineAnimation(copy, 'charge', 'spark');
    expect(Object.keys(renamed.animations!)).toEqual(['spark', 'hop', 'charge-long']);
    expect(Object.keys(removeSpineAnimation(renamed, 'spark').animations!)).toEqual(['hop', 'charge-long']);
  });

  it('rewrites linked nodes, pairs, prefabs and nested Director targets without changing other rigs', () => {
    const { project, other, source } = projectWithRigs();
    const next = remapProjectSpineReferences(project, 'relay.json', {
      skins: [{ from: 'warm', to: 'amber' }],
      animations: [{ from: 'charge', to: 'temp' }, { from: 'temp', to: 'spark' }],
    });
    const scene = next.scenes[0];
    expect(findObject(scene.objects, 'rig')).toMatchObject({ animation: 'spark', skin: 'amber', mix: { pairs: [
      { from: 'idle', to: 'spark', duration: 0.45 }, { from: 'spark', to: 'hop', duration: 0.6 },
    ] } });
    expect(findObject(scene.objects, other.id)).toBe(other);
    expect(next.prefabs[0].root).toMatchObject({ animation: 'spark', skin: 'amber' });
    const composition = parseDirectorSource(scene.cinematics!.director![0].source);
    const first = source.root.children[0].children![0];
    expect(composition.vars).toEqual(source.vars);
    expect(composition.root.children).toEqual([
      { ...source.root.children[0], children: [{ ...first, key: 'spark' }, source.root.children[0].children![1]] },
      { ...source.root.children[1], then: { type: 'parallel', children: [
        { type: 'animation', target: ['rig'], key: 'spark', overrides: { speed: 2 } },
        { type: 'animation', target: ['other'], key: 'charge', overrides: { speed: 2 } },
      ] } },
      ...source.root.children.slice(2),
    ]);
    const copied = duplicateScene(scene);
    const copiedComposition = parseDirectorSource(copied.cinematics!.director![0].source);
    const copiedSteps = copiedComposition.root.children;
    if (!Array.isArray(copiedSteps)) throw new Error('The duplicated composition should have a sequence');
    const copiedRig = copied.objects.find(node => node.type === 'Container');
    const copiedOther = copied.objects.find(node => node.label === other.label);
    expect(copiedRig?.children[0].id).not.toBe('rig');
    expect(copiedSteps[1]).toMatchObject({ then: { children: [
      { target: [copiedRig?.children[0].id], key: 'spark' },
      { target: [copiedOther?.id], key: 'charge' },
    ] } });
    expect(copiedSteps[4]).toEqual(source.root.children[4]);
  });

  it('keeps a Director target addressed by hierarchy path when its Spine clip is renamed', () => {
    const { project } = projectWithRigs();
    const scene = project.scenes[0];
    const parent = scene.objects.find(node => node.type === 'Container')!;
    parent.label = 'Actors';
    const definition = scene.cinematics!.director![0];
    definition.source = JSON.stringify({ root: { type: 'sequence', children: [
      { type: 'animation', target: 'Actors/Relay', key: 'charge' },
      { type: 'animation', target: 'Other/Relay', key: 'charge' },
    ] } });
    const next = remapProjectSpineReferences(project, 'relay.json', {
      skins: [], animations: [{ from: 'charge', to: 'spark' }],
    });
    expect(parseDirectorSource(next.scenes[0].cinematics!.director![0].source).root.children).toEqual([
      { type: 'animation', target: 'Actors/Relay', key: 'spark' },
      { type: 'animation', target: 'Other/Relay', key: 'charge' },
    ]);
  });

  it('clears a deleted clip from every typed reference and removes its race branch', () => {
    const { project, source } = projectWithRigs();
    const next = remapProjectSpineReferences(project, 'relay.json', { skins: [], animations: [{ from: 'charge', to: null }] });
    const scene = next.scenes[0];
    expect(findObject(scene.objects, 'rig')).toMatchObject({ animation: null, mix: { pairs: [] } });
    expect(next.prefabs[0].root).toMatchObject({ animation: null });
    const composition = parseDirectorSource(scene.cinematics!.director![0].source);
    expect(composition.root.children).toEqual([
      { ...source.root.children[0], children: [{ type: 'delay', ms: 150 }] },
      { ...source.root.children[1], then: { type: 'animation', target: ['other'], key: 'charge', overrides: { speed: 2 } } },
      ...source.root.children.slice(2),
    ]);
  });
});
