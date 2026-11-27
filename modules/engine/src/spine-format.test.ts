import { describe, expect, it } from 'vitest';
import { copySpineKeys, deleteSpineKeys, pasteSpineKeys, retimeSpineKeys, spineDopesheetTracks, spineKeyShiftRange } from './spine-dopesheet.js';
import { duplicateSpineSkin, removeSpineAttachment, removeSpineBoneBranch, removeSpineEvent, removeSpineSkin, removeSpineSlot, renameSpineEvent } from './spine-rig.js';
import { spineDrawOrderOffsets, spineKeyDrawOrder } from './spine-draw-order.js';
import { addSpineConstraint, assertSpineDrawOrders, editSpineInfluenceWeight, makeSpineMeshIndependent, moveSpineConstraint, moveSpineSlot, resolveSpineEventAudioDefaults,
  flipSpineMeshEdge, readSpineMesh, regionToSpineMesh, removeSpineConstraint, renameSpineAttachment, renameSpineBone, renameSpineSkin, renameSpineSlot, reparentSpineBone,
  replaceSpineBoneKeys, replaceSpineMeshInfluenceBatch, replaceSpineMeshInfluences, replaceSpineTrack, resolveSpineMesh, setSpineAttachmentSequence, spineBoneKeys, spineDeformKeys, spineDeformPointLayout, spineDocumentSchema,
  spineSkinAttachments, spineSlotHasTwoColorKeys, spineTrackKeys, splitSpineMeshEdge, splitSpineMeshTriangle, unpackSpineDeform, writeSpineMesh } from './spine-format.js';

describe('Spine authoring transforms', () => {
  it('resolves event audio defaults only for playback and keeps explicit overrides', () => {
    const document = spineDocumentSchema.parse({
      skeleton: { spine: '4.2.120' }, bones: [{ name: 'root' }],
      events: { cue: { audio: 'cue.wav', volume: 0.7, balance: -0.2 } },
      animations: { take: { events: [{ name: 'cue' }, { time: 1, name: 'cue', volume: 0 }] } },
    });
    const resolve = (input: typeof document) => spineTrackKeys(
      resolveSpineEventAudioDefaults(input) as typeof document, 'take', ['events'],
    );
    expect(resolve(document)).toEqual([
      { name: 'cue', volume: 0.7, balance: -0.2 }, { time: 1, name: 'cue', volume: 0, balance: -0.2 },
    ]);
    expect(spineTrackKeys(document, 'take', ['events'])[0]).toEqual({ name: 'cue' });
    document.events!.cue.balance = 0.5;
    expect(resolve(document)[0].balance).toBe(0.5);
  });

  it('bounds a moved group by stationary neighbors and permits tied event times', () => {
    const path = ['bones', 'root', 'rotate'];
    const document = spineDocumentSchema.parse({
      skeleton: { spine: '4.2.120' }, bones: [{ name: 'root' }],
      animations: { take: {
        bones: { root: { rotate: [{ value: 0 }, { time: 0.5 }, { time: 1 }, { time: 1.5 }] } },
        events: [{ time: 0.4, name: 'a' }, { time: 0.75, name: 'b' }],
      } },
    });
    const keys = [{ path, index: 1 }, { path, index: 2 }, { path: ['events'], index: 0 }];
    const range = spineKeyShiftRange(document, 'take', keys);
    expect(range.min).toBe(-0.4);
    expect(range.max).toBe(0.35);
    expect(spineTrackKeys(retimeSpineKeys(document, 'take', keys, { offset: range.max }), 'take', ['events'])
      .map(key => key.time)).toEqual([0.75, 0.75]);
    expect(spineKeyShiftRange(document, 'take', keys.slice(0, 2)).max).toBeCloseTo(0.499999, 8);
  });

  it('updates multiple weighted vertices against the same deform layout', () => {
    const mesh = { type: 'mesh', uvs: [0, 0, 1, 0, 1, 1], triangles: [0, 1, 2],
      vertices: [1, 0, 0, 0, 1, 1, 0, 10, 0, 1, 1, 0, 10, 10, 1] };
    const target = { skin: 'default', slot: 'wing', name: 'shape' };
    const document = spineDocumentSchema.parse({
      skeleton: { spine: '4.2.120' }, bones: [{ name: 'root' }, { name: 'wing', parent: 'root' }],
      slots: [{ name: 'wing', bone: 'root' }],
      skins: [{ name: 'default', attachments: { wing: { shape: mesh } } }],
      animations: { flap: { attachments: { default: { wing: { shape: { deform: [{ vertices: [1, 2, 3, 4, 5, 6] }] } } } } } },
    });
    const patch = (vertex: number) => ({ vertex, influences: [
      { bone: 0, x: vertex ? 10 : 0, y: vertex ? 10 : 0, weight: 0.7 }, { bone: 1, x: 0, y: 0, weight: 0.3 },
    ], remap: (offsets: { x: number; y: number }[]) => [offsets[0], offsets[0]] });
    const next = replaceSpineMeshInfluenceBatch(document, target, [patch(2), patch(0)]);
    const resolved = resolveSpineMesh(next, target).mesh;
    expect(spineDeformPointLayout(resolved).points.map(point => point.count)).toEqual([2, 1, 2]);
    expect(spineDeformKeys(next, 'flap', target)[0].vertices).toEqual([1, 2, 1, 2, 3, 4, 5, 6, 5, 6]);
  });

  it('makes a linked mesh independent with its geometry and inherited deformation', () => {
    const mesh = { type: 'mesh', path: 'wing', uvs: [0, 0, 1, 0, 1, 1], triangles: [0, 1, 2], vertices: [0, 0, 10, 0, 10, 10], hull: 3 };
    const source = { skin: 'default', slot: 'wing', name: 'base' };
    const target = { ...source, skin: 'night', name: 'wing' };
    const document = spineDocumentSchema.parse({
      skeleton: { spine: '4.2.120' }, bones: [{ name: 'root' }], slots: [{ name: 'wing', bone: 'root' }],
      skins: [
        { name: 'default', attachments: { wing: { base: mesh } } },
        { name: 'night', attachments: { wing: { wing: { type: 'linkedmesh', path: 'night-wing', parent: 'base' } } } },
      ],
      animations: { flap: { attachments: { default: { wing: { base: {
        deform: [{ time: 0.25, offset: 2, vertices: [4], curve: 'stepped' }],
      } } } } } },
    });
    const detached = makeSpineMeshIndependent(document, target);
    expect(spineSkinAttachments(detached, 'night').wing.wing).toEqual({ ...mesh, path: 'night-wing' });
    expect(spineDeformKeys(detached, 'flap', target)).toEqual(spineDeformKeys(document, 'flap', source));
    expect(spineDeformKeys(detached, 'flap', source)).toEqual(spineDeformKeys(document, 'flap', source));
    const conflict = replaceSpineTrack(document, 'flap', ['attachments', 'night', 'wing', 'wing', 'deform'], [{ vertices: [3] }]);
    expect(() => makeSpineMeshIndependent(conflict, target)).toThrow(/separate linked mesh deform keys/);
  });

  it('initializes a setup dark tint only on the slot with two-color keys', () => {
    const document = spineDocumentSchema.parse({
      skeleton: { spine: '4.2.120' }, bones: [{ name: 'root' }],
      slots: [{ name: 'face', bone: 'root' }, { name: 'body', bone: 'root', dark: '123456' }],
      animations: { tint: {} },
    });
    const path = ['slots', 'face', 'rgba2'];
    const keyed = replaceSpineTrack(document, 'tint', path, [{ light: 'ffffffff', dark: 'abcdef' }]);
    expect(keyed.slots?.map(slot => slot.dark)).toEqual(['000000', '123456']);
    expect(spineSlotHasTwoColorKeys(keyed, 'face')).toBe(true);
    expect(spineSlotHasTwoColorKeys(keyed, 'body')).toBe(false);
    expect(spineSlotHasTwoColorKeys(replaceSpineTrack(keyed, 'tint', path, []), 'face')).toBe(false);
  });

  it('validates atlas frame names and edits sequence tracks independently of mesh deform', () => {
    const target = { skin: 'default', slot: 'wing', name: 'light' };
    const document = spineDocumentSchema.parse({
      skeleton: { spine: '4.2.120' }, bones: [{ name: 'root' }],
      slots: [{ name: 'wing', bone: 'root' }],
      skins: [{ name: 'default', attachments: { wing: { light: { type: 'mesh', path: 'flash03' } } } }],
      animations: { glow: { attachments: { default: { wing: { light: {
        deform: [{ time: 0.25, vertices: [12] }], sequence: [{ mode: 'hold', index: 2 }],
      } } } } } },
    });
    const regions = new Set(['flash03', 'flash04', 'other']);
    const sequence = { start: 3, digits: 2, count: 2, setup: 1 };
    expect(() => setSpineAttachmentSequence(document, target, 'flash', { ...sequence, count: 3 }, regions)).toThrow(/flash05/);
    expect(() => setSpineAttachmentSequence(document, target, 'flash', { ...sequence, setup: 2 }, regions)).toThrow(/range/);
    const withSequence = setSpineAttachmentSequence(document, target, 'flash', sequence, regions);
    const path = ['attachments', 'default', 'wing', 'light'];
    expect(spineTrackKeys(withSequence, 'glow', [...path, 'sequence'])).toEqual([{ mode: 'hold', index: 1 }]);
    const single = setSpineAttachmentSequence(withSequence, target, undefined, undefined, regions);
    expect(spineSkinAttachments(single, 'default').wing.light).toEqual({ type: 'mesh', path: 'flash04' });
    expect(spineTrackKeys(single, 'glow', [...path, 'sequence'])).toEqual([]);
    expect(spineTrackKeys(single, 'glow', [...path, 'deform'])).toEqual([{ time: 0.25, vertices: [12] }]);
  });

  it('duplicates a skin and its own linked meshes, then removes its source and dependent links across slots', () => {
    const mesh = { type: 'mesh', uvs: [0, 0, 1, 0, 0, 1], triangles: [0, 1, 2], vertices: [0, 0, 10, 0, 0, 10] };
    const document = spineDocumentSchema.parse({
      skeleton: { spine: '4.2.120' }, bones: [{ name: 'root' }],
      slots: [{ name: 'panel', bone: 'root', attachment: 'base' }, { name: 'overlay', bone: 'root', attachment: 'tile' }],
      skins: [
        { name: 'default', attachments: { panel: { common: mesh } } },
        { name: 'warm', bones: ['root'], ik: ['move'], attachments: {
          panel: { base: mesh, local: { type: 'linkedmesh', skin: 'warm', parent: 'base' },
            external: { type: 'linkedmesh', parent: 'common' } },
          overlay: { tile: { type: 'region', path: 'green' } },
        } },
        { name: 'cool', attachments: { panel: { badge: { type: 'linkedmesh', skin: 'warm', parent: 'local' } },
          overlay: { badge: { type: 'region' } } } },
      ],
      animations: { pose: { attachments: {
        warm: { panel: { base: { deform: [{ time: 1, vertices: [1, 2] }] } }, overlay: { tile: { sequence: [{ time: 1 }] } } },
        cool: { panel: { badge: { deform: [{ time: 1 }] } }, overlay: { badge: { sequence: [{ time: 1 }] } } },
      }, slots: { panel: { attachment: [{ name: 'badge' }] }, overlay: { attachment: [{ name: 'badge' }] } } } },
    });
    const duplicated = duplicateSpineSkin(document, 'warm', 'amber');
    const attachments = spineSkinAttachments(duplicated, 'amber');
    expect(attachments.panel.local.skin).toBe('amber');
    expect(attachments.panel.external).toEqual({ type: 'linkedmesh', parent: 'common' });
    expect(duplicated.skins?.at(-1)).toMatchObject({ bones: ['root'], ik: ['move'] });
    expect((duplicated.animations?.pose.attachments as Record<string, unknown>).amber).toEqual(
      (document.animations?.pose.attachments as Record<string, unknown>).warm,
    );
    expect(resolveSpineMesh(duplicated, { skin: 'amber', slot: 'panel', name: 'local' }).target.skin).toBe('amber');
    const removed = removeSpineSkin(duplicated, 'warm');
    expect(removed.skins?.map(skin => skin.name)).toEqual(['default', 'cool', 'amber']);
    expect(spineSkinAttachments(removed, 'cool')).toEqual({ overlay: { badge: { type: 'region' } } });
    expect(spineTrackKeys(removed, 'pose', ['slots', 'panel', 'attachment'])).toEqual([{ name: null }]);
    expect(spineTrackKeys(removed, 'pose', ['slots', 'overlay', 'attachment'])).toEqual([{ name: 'badge' }]);
    expect(removed.slots?.map(slot => slot.attachment)).toEqual(['base', 'tile']);
    expect(removed.animations?.pose.attachments).toMatchObject({ cool: { overlay: { badge: { sequence: [{ time: 1 }] } } } });
    expect(removed.animations?.pose.attachments).not.toHaveProperty('warm');
    expect(() => removeSpineSkin(document, 'default')).toThrow();
  });
  it('removes linked attachment trees and preserves slots that can still resolve the same attachment name', () => {
    const document = spineDocumentSchema.parse({
      skeleton: { spine: '4.2.120' }, bones: [{ name: 'root' }],
      slots: [{ name: 'panel', bone: 'root', attachment: 'base' }, { name: 'overlay', bone: 'root' }],
      skins: [
        { name: 'default', attachments: { panel: { base: { type: 'mesh' } } } },
        { name: 'alternate', attachments: { panel: { base: { type: 'region' }, link: { type: 'linkedmesh', parent: 'base' } } } },
        { name: 'third', attachments: { panel: { leaf: { type: 'linkedmesh', skin: 'alternate', parent: 'link' } } } },
      ],
      path: [{ name: 'p', target: 'panel', order: 0, bones: ['root'] }],
      animations: { pose: {
        slots: { panel: { attachment: [{ name: 'base' }, { name: 'leaf', time: 0.5 }] } },
        path: { p: { position: [{ value: 2 }] } },
        attachments: { alternate: { panel: { link: { deform: [{ time: 1 }] } } },
          third: { panel: { leaf: { sequence: [{ time: 1 }] } } } },
        drawOrder: [{ offsets: [{ slot: 'panel', offset: 1 }] }],
      } },
    });
    const next = removeSpineAttachment(document, 'default', 'panel', 'base');
    expect(spineSkinAttachments(next, 'alternate').panel).toEqual({ base: { type: 'region' } });
    expect(spineSkinAttachments(next, 'third')).toEqual({});
    expect(next.slots?.[0].attachment).toBe('base');
    expect(spineTrackKeys(next, 'pose', ['slots', 'panel', 'attachment'])).toEqual([{ name: 'base' }, { name: null, time: 0.5 }]);
    expect(next.animations?.pose.attachments).toEqual({ alternate: {}, third: {} });
    const cleared = removeSpineAttachment(next, 'alternate', 'panel', 'base');
    expect(cleared.slots?.[0].attachment).toBeUndefined();
    const pruned = removeSpineSlot(next, 'panel');
    expect(pruned.slots?.map(slot => slot.name)).toEqual(['overlay']);
    expect(pruned.path).toEqual([]);
    expect(pruned.animations?.pose).toMatchObject({ slots: {}, path: {}, drawOrder: [{ offsets: [] }] });
    expect(document.slots?.[0].attachment).toBe('base');
    expect(Object.keys(spineSkinAttachments(document, 'third').panel)).toEqual(['leaf']);
  });
  it('removes a bone branch, transfers surviving weights and preserves linked mesh deformation order', () => {
    const before = ['mask', 'removed', 'panel', 'foreground'];
    const mesh = { type: 'mesh', uvs: [0, 0, 1, 0, 0, 1], triangles: [0, 1, 2],
      vertices: [2, 2, 2, 3, .5, 3, 9, 10, .5, 1, 2, 4, 5, 1, 1, 3, 6, 7, 1] };
    const key = { time: 0.5, offset: 0, vertices: [3, 4, 5, 6, 7, 8] };
    const document = spineDocumentSchema.parse({
      skeleton: { spine: '4.2.120' }, bones: [
        { name: 'root' }, { name: 'branch', parent: 'root' }, { name: 'tip', parent: 'branch' }, { name: 'keep', parent: 'root' },
      ],
      slots: before.map((name, index) => ({ name, bone: index === 1 ? 'tip' : index === 2 ? 'keep' : 'root' })),
      ik: [{ name: 'old', order: 0, target: 'tip', bones: ['keep'] }],
      path: [{ name: 'oldPath', order: 1, target: 'removed', bones: ['keep'] }],
      physics: [{ name: 'keepPhysics', order: 2, bone: 'keep' }],
      skins: [
        { name: 'default', bones: ['branch', 'tip', 'keep'], ik: ['old'], path: ['oldPath'], attachments: {
          panel: { mesh }, mask: { clip: { type: 'clipping', end: 'removed', vertexCount: 3, vertices: [0, 0, 8, 0, 0, 8] } },
          removed: { tile: { type: 'region' } },
        } },
        { name: 'other', attachments: { panel: { linked: { type: 'linkedmesh', skin: 'default', parent: 'mesh' } } } },
      ],
      animations: { pose: {
        bones: { tip: { rotate: [{ value: 3 }] }, keep: { rotate: [{ value: 2 }] } },
        slots: { removed: { alpha: [{ value: .5 }] } }, ik: { old: [{ mix: .5 }] },
        drawOrder: [{ offsets: spineDrawOrderOffsets(before, ['mask', 'foreground', 'removed', 'panel']) }],
        attachments: { other: { panel: { linked: { deform: [key] } } }, default: { removed: { tile: { sequence: [] } } } },
      } },
    });
    const next = removeSpineBoneBranch(document, 'branch', (from, to, point, delta) => {
      expect([from, to]).toEqual([2, 0]);
      return { x: point.x * 2 + (delta ? 0 : 20), y: point.y };
    });
    expect(next.bones.map(bone => bone.name)).toEqual(['root', 'keep']);
    expect(next.slots?.map(slot => slot.name)).toEqual(['mask', 'panel', 'foreground']);
    expect(next.ik).toEqual([]);
    expect(next.path).toEqual([]);
    expect(next.physics?.[0].order).toBe(0);
    expect(next.skins?.[0]).toMatchObject({ bones: ['keep'], ik: [], path: [] });
    expect(spineSkinAttachments(next, 'default').mask.clip.end).toBe('mask');
    const attachment = spineSkinAttachments(next, 'default').panel.mesh;
    expect(attachment.vertices).toEqual([2, 0, 24, 3, .5, 1, 9, 10, .5, 1, 0, 28, 5, 1, 1, 1, 6, 7, 1]);
    expect(next.animations?.pose.slots).toEqual({});
    expect(next.animations?.pose.bones).toEqual({ keep: { rotate: [{ value: 2 }] } });
    expect(spineDeformKeys(next, 'pose', { skin: 'other', slot: 'panel', name: 'linked' })[0].vertices).toEqual([6, 4, 5, 6, 14, 8]);
    expect(next.animations?.pose.drawOrder).toEqual([{ offsets: spineDrawOrderOffsets(['mask', 'panel', 'foreground'], ['mask', 'foreground', 'panel']) }]);
    expect(spineKeyDrawOrder(before, (document.animations?.pose.drawOrder as unknown[])[0])).toEqual(['mask', 'foreground', 'removed', 'panel']);
    expect(() => removeSpineBoneBranch(document, 'root', (_from, _to, point) => point)).toThrow();
  });
  it('renames and removes event definitions and keys across every animation', () => {
    const definition = { audio: 'fx/chime.wav', int: 4, string: 'ready' };
    const document = spineDocumentSchema.parse({
      skeleton: { spine: '4.2.120' }, bones: [{ name: 'root' }],
      events: { start: definition, finish: {} },
      animations: {
        idle: { events: [{ name: 'start', time: .2, volume: .5 }, { name: 'finish', time: .2 }] },
        jump: { events: [{ name: 'start', time: .9, int: 0 }], custom: { label: 'start' } },
      },
    });
    expect(() => renameSpineEvent(document, 'start', 'finish')).toThrow();
    const renamed = renameSpineEvent(document, 'start', 'rise');
    expect(renamed.events).toEqual({ rise: definition, finish: {} });
    expect(spineTrackKeys(renamed, 'idle', ['events'])).toEqual([
      { name: 'rise', time: .2, volume: .5 }, { name: 'finish', time: .2 },
    ]);
    expect(spineTrackKeys(renamed, 'jump', ['events'])).toEqual([{ name: 'rise', time: .9, int: 0 }]);
    const removed = removeSpineEvent(renamed, 'rise');
    expect(removed.events).toEqual({ finish: {} });
    expect(removed.animations?.idle.events).toEqual([{ name: 'finish', time: .2 }]);
    expect(removed.animations?.jump).toEqual({ custom: { label: 'start' } });
    expect(document.events).toEqual({ start: definition, finish: {} });
  });
  it('preserves trimmed region framing and round-trips weighted vertices', () => {
    const mesh = regionToSpineMesh({ width: 100, height: 80, x: 10, y: -20, path: 'part' },
      { left: 0.2, right: 0.9, top: 0.25, bottom: 0.75 });
    expect(mesh.uvs).toEqual([0.2, 0.25, 0.9, 0.25, 0.9, 0.75, 0.2, 0.75]);
    expect(mesh.vertices).toEqual([-20, 0, 50, 0, 50, -40, -20, -40]);
    const geometry = readSpineMesh(mesh, 2);
    if (geometry.vertices.weighted) throw new Error('Expected an unweighted mesh');
    const points = geometry.vertices.points.map(point => editSpineInfluenceWeight([
      { ...point, bone: 0, weight: 1 }, { ...point, bone: 1, weight: 0 },
    ], 1, 0.4));
    const weighted = writeSpineMesh(mesh, { ...geometry, vertices: { weighted: true, points } }, 2);
    expect(readSpineMesh(weighted, 2).vertices).toEqual({ weighted: true, points });
  });

  it('re-encodes explicit draw order for the new setup order', () => {
    const document = spineDocumentSchema.parse({
      skeleton: { spine: '4.2.120' }, bones: [{ name: 'root' }],
      slots: ['floor', 'body', 'cap'].map(name => ({ name, bone: 'root' })),
      animations: { turn: { drawOrder: [{ time: 1, offsets: [{ slot: 'floor', offset: 2 }] }, { time: 2 }] } },
    });
    const next = moveSpineSlot(document, 'cap', 0);
    expect(next.slots?.map(slot => slot.name)).toEqual(['cap', 'floor', 'body']);
    expect(next.animations?.turn.drawOrder).toEqual([{ time: 1, offsets: [
      { slot: 'cap', offset: 1 }, { slot: 'floor', offset: 1 }, { slot: 'body', offset: -2 },
    ] }, { time: 2 }]);
    expect(() => assertSpineDrawOrders(next)).not.toThrow();
  });

  it('keeps constraint orders dense and removes only matching references', () => {
    const document = spineDocumentSchema.parse({
      skeleton: { spine: '4.2.120' }, bones: [{ name: 'root' }, { name: 'arm', parent: 'root' }],
      ik: [{ name: 'reach', bones: ['arm'], target: 'root', order: 0 }],
      skins: [{ name: 'default', ik: ['reach'] }],
      animations: { move: { ik: { reach: [{ mix: 0.3 }] }, physics: { sway: { mix: [{ value: 0.2 }] } } } },
    });
    const next = addSpineConstraint(document, 'physics', { name: 'sway', bone: 'arm' });
    const moved = moveSpineConstraint(next, 'physics', 'sway', 0);
    expect(moved.ik?.[0].order).toBe(1);
    const removed = removeSpineConstraint(moved, 'ik', 'reach');
    expect(removed.skins?.[0].ik).toEqual([]);
    expect(removed.animations?.move.ik).toEqual({});
    expect(removed.animations?.move.physics).toEqual(document.animations?.move.physics);
    expect(removed.physics?.[0].order).toBe(0);
  });

  it('keeps parent and linked deform channels aligned through weighted topology edits', () => {
    const shape = { type: 'mesh', uvs: [0, 0, 1, 0, 0, 1], triangles: [0, 1, 2],
      vertices: [1, 0, 0, 0, 1, 2, 0, 12, 0, 0.5, 1, 12, 0, 0.5, 1, 1, 0, 12, 1] };
    const document = spineDocumentSchema.parse({
      skeleton: { spine: '4.2.120' }, bones: [{ name: 'root' }, { name: 'arm', parent: 'root' }],
      slots: [{ name: 'wing', bone: 'root' }],
      skins: [{ name: 'default', attachments: { wing: { normal: shape } } },
        { name: 'alternate', attachments: { wing: { glow: { type: 'linkedmesh', parent: 'normal', timelines: false } } } }],
      animations: { flap: { attachments: {
        default: { wing: { normal: { deform: [{ time: 1, offset: 2, vertices: [6, 12, 9, 15, 3, 0], curve: 'stepped' }] } } },
        alternate: { wing: { glow: { deform: [{ time: 1, offset: 6, vertices: [12] }], sequence: [{ index: 1 }] } } },
      } } },
    });
    const root = { skin: 'default', slot: 'wing', name: 'normal' };
    const link = { skin: 'alternate', slot: 'wing', name: 'glow' };
    const changed = splitSpineMeshTriangle(document, root, 0);
    const { mesh } = resolveSpineMesh(changed, link);
    const { length } = spineDeformPointLayout(mesh);
    const [key] = spineDeformKeys(changed, 'flap', root);
    expect(mesh.triangles).toEqual([0, 1, 3, 1, 2, 3, 2, 0, 3]);
    expect(key.curve).toBe('stepped');
    expect(unpackSpineDeform(key, length)).toEqual([0, 0, 6, 12, 9, 15, 3, 0, 2, 4, 5, 5]);
    expect(unpackSpineDeform(spineDeformKeys(changed, 'flap', link)[0], length).slice(-4)).toEqual([0, 0, 8, 0]);
    const removed = replaceSpineMeshInfluences(changed, root, 1, [{ bone: 0, x: 12, y: 0, weight: 1 }], offsets => offsets.slice(0, 1));
    const layout = spineDeformPointLayout(resolveSpineMesh(removed, link).mesh);
    expect(unpackSpineDeform(spineDeformKeys(removed, 'flap', root)[0], layout.length)).toEqual([0, 0, 6, 12, 3, 0, 2, 4, 5, 5]);
    expect(unpackSpineDeform(spineDeformKeys(removed, 'flap', link)[0], layout.length)).toEqual([0, 0, 0, 0, 12, 0, 0, 0, 8, 0]);
    expect(spineDeformKeys(document, 'flap', root)[0].vertices).toEqual([6, 12, 9, 15, 3, 0]);
    expect(removed.animations?.flap.attachments).toMatchObject({ alternate: { wing: { glow: { sequence: [{ index: 1 }] } } } });
  });

  it('edits one nested channel and keeps coincident events and neighboring channels', () => {
    const document = spineDocumentSchema.parse({
      skeleton: { spine: '4.2.120' }, bones: [{ name: 'root' }],
      slots: [{ name: 'face', bone: 'root' }],
      events: { start: {}, sound: {} },
      animations: { play: { slots: { face: { attachment: [{ time: 0, name: 'eye' }], rgba: [{ color: 'ffffffff' }] } } } },
    });
    const path = ['slots', 'face', 'attachment'];
    const changed = replaceSpineTrack(document, 'play', path, [{ time: 2, name: null }, { time: 0, name: 'eye' }]);
    expect(spineTrackKeys(changed, 'play', path).map(key => key.name)).toEqual(['eye', null]);
    const removed = replaceSpineTrack(changed, 'play', path, []);
    expect(removed.animations?.play.slots).toEqual({ face: { rgba: [{ color: 'ffffffff' }] } });
    const events = [{ time: 1, name: 'start' }, { time: 1, name: 'sound' }];
    expect(spineTrackKeys(replaceSpineTrack(removed, 'play', ['events'], events), 'play', ['events'])).toEqual(events);
  });

  it('splits a hull edge in order and interpolates the inserted weighted deform segment', () => {
    const target = { skin: 'default', slot: 'wing', name: 'side' };
    const shape = regionToSpineMesh({ width: 4, height: 4 });
    const mesh = readSpineMesh(shape, 2);
    if (mesh.vertices.weighted) throw new Error('Expected region geometry');
    const weighted = writeSpineMesh(shape, { ...mesh, vertices: { weighted: true, points: mesh.vertices.points.map((vertex, index) =>
      [{ ...vertex, bone: index ? 1 : 0, weight: 1 }]) } }, 2);
    const document = spineDocumentSchema.parse({
      skeleton: { spine: '4.2.120' }, bones: [{ name: 'root' }, { name: 'child', parent: 'root' }],
      slots: [{ name: 'wing', bone: 'root' }], skins: [{ name: 'default', attachments: { wing: { side: weighted } } }],
      animations: { flap: { attachments: { default: { wing: { side: { deform: [{ time: 1, vertices: [4, 0, 12, 0, 7] }] } } } } } },
    });
    const flipped = flipSpineMeshEdge(document, target, 0, 2);
    const alternate = resolveSpineMesh(flipped, target);
    expect(alternate.mesh.triangles).toEqual([1, 3, 0, 3, 1, 2]);
    expect(spineDeformKeys(flipped, 'flap', target)).toEqual(spineDeformKeys(document, 'flap', target));
    const { document: split, vertex } = splitSpineMeshEdge(document, target, 0, 1, 0.25);
    const result = resolveSpineMesh(split, target);
    expect(vertex).toBe(1);
    expect(result.attachment.hull).toBe(5);
    expect(result.attachment.edges).toEqual([0, 2, 2, 4, 4, 6, 6, 8, 8, 0]);
    expect(result.mesh.triangles).toEqual([0, 1, 3, 1, 2, 3, 0, 3, 4]);
    expect(result.mesh.vertices.points[1]).toEqual([
      { bone: 0, x: -2, y: 2, weight: 0.75 }, { bone: 1, x: 2, y: 2, weight: 0.25 },
    ]);
    expect(unpackSpineDeform(spineDeformKeys(split, 'flap', target)[0], 12)).toEqual([4, 0, 4, 0, 12, 0, 12, 0, 7, 0, 0, 0]);
  });

  it('updates bone and slot references and reindexes vertex attachments when reparenting', () => {
    const vertices = [1, 1, 0, 0, 1, 1, 2, 4, 0, 1, 1, 3, 0, 4, 1];
    const document = spineDocumentSchema.parse({
      skeleton: { spine: '4.2.120' },
      bones: [{ name: 'root' }, { name: 'elbow', parent: 'root' }, { name: 'hand', parent: 'elbow' }, { name: 'anchor', parent: 'root' }],
      slots: [{ name: 'end', bone: 'elbow' }, { name: 'shape', bone: 'anchor' }],
      ik: [{ name: 'reach', bones: ['elbow', 'hand'], target: 'anchor' }],
      path: [{ name: 'follow', bones: ['elbow'], target: 'end' }],
      physics: [{ name: 'sway', bone: 'elbow' }],
      skins: [{ name: 'default', bones: ['elbow'], attachments: {
        end: { mask: { type: 'clipping', vertexCount: 3, vertices, end: 'shape' } },
        shape: { hit: { type: 'boundingbox', vertexCount: 3, vertices } },
      } }],
      animations: { wave: { bones: { elbow: { rotate: [{ value: 25 }] } }, slots: { end: { attachment: [{ name: 'mask' }] } },
        drawOrder: [{ offsets: [{ slot: 'end', offset: 1 }] }] } },
    });
    const renamed = renameSpineSlot(renameSpineBone(document, 'elbow', 'arm'), 'end', 'sleeve');
    const next = reparentSpineBone(renamed, 'arm', 'anchor');
    expect(next.bones.map(bone => [bone.name, bone.parent])).toEqual([['root', undefined], ['anchor', 'root'], ['arm', 'anchor'], ['hand', 'arm']]);
    expect(next.ik?.[0].bones).toEqual(['arm', 'hand']);
    expect(next.path?.[0]).toMatchObject({ target: 'sleeve', bones: ['arm'] });
    expect(next.physics?.[0].bone).toBe('arm');
    expect(next.skins?.[0].bones).toEqual(['arm']);
    expect(next.animations?.wave).toMatchObject({ bones: { arm: { rotate: [{ value: 25 }] } },
      slots: { sleeve: { attachment: [{ name: 'mask' }] } }, drawOrder: [{ offsets: [{ slot: 'sleeve', offset: 1 }] }] });
    const attachments = spineSkinAttachments(next, 'default');
    expect(attachments.sleeve.mask).toMatchObject({ end: 'shape', vertices: [1, 2, 0, 0, 1, 1, 3, 4, 0, 1, 1, 1, 0, 4, 1] });
    expect(attachments.shape.hit.vertices).toEqual(attachments.sleeve.mask.vertices);
    expect(spineSkinAttachments(document, 'default').end.mask.vertices).toEqual(vertices);
  });

  it('renames a skin and a shared attachment without changing atlas paths or neighboring slots', () => {
    const document = spineDocumentSchema.parse({
      skeleton: { spine: '4.2.120' }, bones: [{ name: 'root' }],
      slots: [{ name: 'wing', bone: 'root', attachment: 'mark' }, { name: 'face', bone: 'root', attachment: 'mark' }],
      skins: [
        { name: 'default', attachments: { wing: { mark: { type: 'mesh' }, glow: { type: 'linkedmesh', skin: 'alternate', parent: 'mark' } } } },
        { name: 'alternate', attachments: { wing: { mark: { type: 'mesh', name: 'atlas-original' } }, face: { mark: { path: 'dots' } } } },
      ],
      animations: { turn: {
        slots: { wing: { attachment: [{ name: 'mark' }, { time: 1, name: null }] }, face: { attachment: [{ name: 'mark' }] } },
        attachments: { alternate: { wing: { mark: { deform: [{ time: 1 }] } } } },
      } },
    });
    const next = renameSpineAttachment(renameSpineSkin(document, 'alternate', 'night'), 'wing', 'mark', 'feather');
    const primary = spineSkinAttachments(next, 'default');
    const alternate = spineSkinAttachments(next, 'night');
    expect(primary.wing).toEqual({ feather: { type: 'mesh', path: 'mark' }, glow: { type: 'linkedmesh', skin: 'night', parent: 'feather' } });
    expect(alternate.wing.feather.path).toBe('atlas-original');
    expect(alternate.face.mark.path).toBe('dots');
    expect(next.animations?.turn).toEqual({
      slots: { wing: { attachment: [{ name: 'feather' }, { time: 1, name: null }] }, face: { attachment: [{ name: 'mark' }] } },
      attachments: { night: { wing: { feather: { deform: [{ time: 1 }] } } } },
    });
    expect(next.slots?.map(slot => slot.attachment)).toEqual(['feather', 'mark']);
    expect(spineSkinAttachments(document, 'alternate').wing.mark.name).toBe('atlas-original');
  });

  it('preserves setup inheritance while editing and retiming discrete inheritance keys', () => {
    const document = spineDocumentSchema.parse({
      skeleton: { spine: '4.2.120' },
      bones: [{ name: 'root' }, { name: 'wing', parent: 'root', inherit: 'NoScale' }],
      animations: { take: { bones: { wing: { rotate: [{ value: 25 }] } } } },
    });
    const edited = replaceSpineBoneKeys(document, 'take', 'wing', 'inherit', [
      { inherit: 'onlyTranslation' }, { time: 1, inherit: 'normal' },
    ]);
    const path = ['bones', 'wing', 'inherit'];
    const moved = retimeSpineKeys(edited, 'take', [{ path, index: 1 }], { offset: 0.25 });
    expect(moved.bones[1].inherit).toBe('NoScale');
    expect(spineBoneKeys(moved, 'take', 'wing', 'inherit')).toEqual([
      { inherit: 'onlyTranslation' }, { time: 1.25, inherit: 'normal' },
    ]);
    expect(spineBoneKeys(moved, 'take', 'wing', 'rotate')).toEqual([{ value: 25 }]);
  });

  it('retimes selected keys on different tracks and remaps the Bézier segments on both sides', () => {
    const path = ['bones', 'root', 'rotate'], events = ['events'];
    const document = spineDocumentSchema.parse({
      skeleton: { spine: '4.2.120' }, bones: [{ name: 'root' }],
      animations: { take: {
        bones: { root: { rotate: [{ curve: [0.25, 0, 0.75, 1] }, { time: 1, curve: [1.25, 1, 1.75, 2] }, { time: 2 }] } },
        events: [{ time: 0.5, name: 'ping' }],
      } },
    });
    const selection = [{ path, index: 1 }, { path: events, index: 0 }];
    const moved = retimeSpineKeys(document, 'take', selection, { offset: 0.25, scale: 1 });
    expect(spineDopesheetTracks(moved, 'take').map(track => track.path)).toEqual([path, events]);
    expect(spineTrackKeys(moved, 'take', path).map(key => key.curve)).toEqual([
      [0.3125, 0, 0.9375, 1], [1.4375, 1, 1.8125, 2], undefined,
    ]);
    expect(spineTrackKeys(moved, 'take', events)[0].time).toBe(0.75);
    expect(() => retimeSpineKeys(document, 'take', selection, { offset: 1 })).toThrow(/collide/);
    expect(spineTrackKeys(document, 'take', path)[1].time).toBe(1);
    const copied = copySpineKeys(moved, 'take', [{ path, index: 1 }]);
    const paste = pasteSpineKeys(moved, 'take', copied, 1.5);
    expect(paste.selection).toEqual([{ path, index: 2 }]);
    expect(spineTrackKeys(paste.document, 'take', path).slice(1, 3).map(key => key.curve)).toEqual([
      [1.3125, 1, 1.4375, 2], [1.625, 1, 1.875, 2],
    ]);
    const removed = deleteSpineKeys(paste.document, 'take', paste.selection);
    expect(spineTrackKeys(removed, 'take', path)).toEqual(spineTrackKeys(moved, 'take', path));
  });
});
