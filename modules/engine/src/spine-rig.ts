import { z } from 'zod';
import type { SpineAttachment, SpineMeshPoint } from './spine-attachments.js';
import { spineSkinAttachments } from './spine-attachments.js';
import { orderedSpineConstraints, removeSpineConstraint } from './spine-constraints.js';
import { spineDrawOrderOffsets, spineKeyDrawOrder } from './spine-draw-order.js';
import { packSpineDeform, resolveSpineMesh, unpackSpineDeform, type SpineDeformKey, type SpineMeshTarget } from './spine-deform.js';
import type { SpineBone, SpineDocument } from './spine-format.js';
import { spineTrackKeys } from './spine-tracks.js';

const bag = z.record(z.string(), z.unknown());
const boneLists = ['ik', 'transform', 'path'] as const;
function renamedObject(value: unknown, from: string, to: string) {
  const map = bag.parse(value);
  if (!Object.hasOwn(map, from)) return value;
  if (Object.hasOwn(map, to)) throw new Error('The destination name is already referenced');
  return Object.fromEntries(Object.entries(map).map(([key, value]) => [key === from ? to : key, value]));
}

function rename(value: string, entries: readonly { name: string }[], from: string) {
  const name = value.trim();
  if (!name || !entries.some(item => item.name === from) || (name !== from && entries.some(item => item.name === name))) {
    throw new Error('Choose an existing item and a unique name');
  }
  return name;
}

export function renameSpineAnimation(document: SpineDocument, from: string, value: string): SpineDocument {
  const animations = document.animations ?? {};
  const to = rename(value, Object.keys(animations).map(name => ({ name })), from);
  if (from === to) return document;
  if (to === '__proto__') throw new Error('Choose a different animation name');
  return { ...document, animations: Object.fromEntries(Object.entries(animations)
    .map(([name, clip]) => [name === from ? to : name, clip])) };
}

export function duplicateSpineAnimation(document: SpineDocument, from: string, value: string): SpineDocument {
  const animations = document.animations ?? {};
  const to = value.trim();
  if (!Object.hasOwn(animations, from) || !to || to === '__proto__' || Object.hasOwn(animations, to)) {
    throw new Error('Choose an existing animation and a unique name for its copy');
  }
  return { ...document, animations: { ...animations, [to]: structuredClone(animations[from]) } };
}

export function removeSpineAnimation(document: SpineDocument, name: string): SpineDocument {
  if (!document.animations || !Object.hasOwn(document.animations, name)) throw new Error('Choose an existing animation');
  const animations = { ...document.animations };
  delete animations[name];
  return { ...document, animations };
}

export function renameSpineEvent(document: SpineDocument, from: string, value: string): SpineDocument {
  const events = document.events ?? {};
  const to = rename(value, Object.keys(events).map(name => ({ name })), from);
  if (from === to) return document;
  if (to === '__proto__') throw new Error('Choose a different event name');
  return {
    ...rewriteEventKeys(document, from, to),
    events: Object.fromEntries(Object.entries(events).map(([name, event]) => [name === from ? to : name, event])),
  };
}

export function removeSpineEvent(document: SpineDocument, name: string): SpineDocument {
  if (!document.events || !Object.hasOwn(document.events, name)) throw new Error('Choose an existing event');
  const { [name]: _removed, ...events } = document.events;
  return { ...rewriteEventKeys(document, name), events };
}

function rewriteEventKeys(document: SpineDocument, from: string, to?: string): SpineDocument {
  if (!document.animations) return document;
  return { ...document, animations: Object.fromEntries(Object.entries(document.animations).map(([name, clip]) => {
    if (!clip.events) return [name, clip];
    const keys = spineTrackKeys(document, name, ['events']);
    if (!keys.some(key => key.name === from)) return [name, clip];
    const events = to === undefined ? keys.filter(key => key.name !== from) :
      keys.map(key => key.name === from ? { ...key, name: to } : key);
    const { events: _original, ...rest } = clip;
    return [name, events.length ? { ...rest, events } : rest];
  })) };
}

export function renameSpineBone(document: SpineDocument, from: string, value: string): SpineDocument {
  const to = rename(value, document.bones, from);
  if (from === to) return document;
  const remap = (value: unknown) => value === from ? to : value;
  const next: SpineDocument = { ...document, bones: document.bones.map(bone => ({
    ...bone, name: bone.name === from ? to : bone.name, ...(bone.parent === from ? { parent: to } : {}),
  })) };
  if (document.slots) next.slots = document.slots.map(slot => slot.bone === from ? { ...slot, bone: to } : slot);
  for (const section of boneLists) if (document[section]) next[section] = document[section].map(item => ({
    ...item, ...(Array.isArray(item.bones) ? { bones: item.bones.map(remap) } : {}),
    ...(section !== 'path' && item.target === from ? { target: to } : {}),
  }));
  if (document.physics) next.physics = document.physics.map(item => item.bone === from ? { ...item, bone: to } : item);
  if (document.skins) next.skins = document.skins.map(skin => Array.isArray(skin.bones) ? { ...skin, bones: skin.bones.map(remap) } : skin);
  if (document.animations) next.animations = Object.fromEntries(Object.entries(document.animations).map(([name, clip]) =>
    [name, clip.bones === undefined ? clip : { ...clip, bones: renamedObject(clip.bones, from, to) }]));
  return next;
}

function mapSkinAttachments(document: SpineDocument, visit: (attachment: SpineAttachment) => SpineAttachment, from?: string, to?: string) {
  return document.skins?.map(skin => {
    if (skin.attachments === undefined) return skin;
    const mapped = Object.fromEntries(Object.entries(spineSkinAttachments(document, skin.name)).map(([slot, entries]) =>
      [slot, Object.fromEntries(Object.entries(entries).map(([name, item]) => [name, visit(item)]))]));
    return { ...skin, attachments: from !== undefined ? renamedObject(mapped, from, to!) : mapped };
  });
}

export function renameSpineSlot(document: SpineDocument, from: string, value: string): SpineDocument {
  const slots = document.slots ?? [];
  const to = rename(value, slots, from);
  if (from === to) return document;
  const next: SpineDocument = { ...document, slots: slots.map(slot => slot.name === from ? { ...slot, name: to } : slot) };
  if (document.skins) next.skins = mapSkinAttachments(document, item => item.type === 'clipping' && item.end === from
    ? { ...item, end: to } : item, from, to);
  if (document.path) next.path = document.path.map(item => item.target === from ? { ...item, target: to } : item);
  if (document.animations) next.animations = Object.fromEntries(Object.entries(document.animations).map(([name, clip]) => {
    const animation = { ...clip };
    if (clip.slots !== undefined) animation.slots = renamedObject(clip.slots, from, to);
    if (clip.attachments !== undefined) animation.attachments = Object.fromEntries(Object.entries(bag.parse(clip.attachments)).map(
      ([skin, slots]) => [skin, renamedObject(slots, from, to)]));
    if (Array.isArray(clip.drawOrder)) animation.drawOrder = clip.drawOrder.map(key => Array.isArray(key?.offsets)
      ? { ...key, offsets: key.offsets.map((offset: Record<string, unknown>) => offset.slot === from ? { ...offset, slot: to } : offset) }
      : key);
    return [name, animation];
  }));
  return next;
}

const withoutNames = (value: unknown, names: ReadonlySet<string>) =>
  Object.fromEntries(Object.entries(bag.parse(value)).filter(([name]) => !names.has(name)));

function pruneSpineSlots(document: SpineDocument, removed: ReadonlySet<string>): SpineDocument {
  if (!removed.size) return document;
  const oldOrder = document.slots?.map(slot => slot.name) ?? [];
  const order = oldOrder.filter(slot => !removed.has(slot));
  const clippingEnds = new Map<string, string | undefined>();
  let previous: string | undefined;
  for (const slot of oldOrder) {
    if (removed.has(slot)) clippingEnds.set(slot, previous);
    else previous = slot;
  }
  let next: SpineDocument = { ...document, slots: document.slots?.filter(slot => !removed.has(slot.name)) };
  for (const path of document.path ?? []) {
    if (typeof path.target === 'string' && removed.has(path.target)) next = removeSpineConstraint(next, 'path', path.name);
  }
  if (next.skins) next.skins = next.skins.map(skin => {
    if (!skin.attachments) return skin;
    const source = spineSkinAttachments(document, skin.name);
    const attachments = Object.fromEntries(Object.entries(source).filter(([slot]) => !removed.has(slot)).map(([slot, entries]) => [
      slot, Object.fromEntries(Object.entries(entries).map(([name, attachment]) => {
        const end = attachment.end;
        if (attachment.type !== 'clipping' || typeof end !== 'string' || !removed.has(end)) return [name, attachment];
        const earlier = clippingEnds.get(end);
        return [name, { ...attachment, end: earlier && order.indexOf(earlier) >= order.indexOf(slot) ? earlier : slot }];
      })),
    ]));
    return { ...skin, attachments };
  });
  if (next.animations) next.animations = Object.fromEntries(Object.entries(next.animations).map(([name, clip]) => {
    const updated = { ...clip };
    if (clip.slots) updated.slots = withoutNames(clip.slots, removed);
    if (clip.attachments) updated.attachments = Object.fromEntries(Object.entries(bag.parse(clip.attachments)).map(([skin, slots]) => [
      skin, withoutNames(slots, removed),
    ]));
    if (Array.isArray(clip.drawOrder)) updated.drawOrder = clip.drawOrder.map(key => {
      if (!key.offsets) return key;
      const target = spineKeyDrawOrder(oldOrder, key).filter(slot => !removed.has(slot));
      const metadata = new Map<string, Record<string, unknown>>(key.offsets.map((item: { slot: string }) => [item.slot, item]));
      return { ...key, offsets: spineDrawOrderOffsets(order, target).map(item => ({ ...metadata.get(item.slot), ...item })) };
    });
    return [name, updated];
  }));
  return next;
}

export function removeSpineSlot(document: SpineDocument, name: string): SpineDocument {
  if (!document.slots?.some(slot => slot.name === name)) throw new Error('Choose an existing slot');
  return pruneSpineSlots(document, new Set([name]));
}

export function renameSpineSkin(document: SpineDocument, from: string, value: string): SpineDocument {
  const skins = document.skins ?? [];
  const to = rename(value, skins, from);
  if (from === to) return document;
  if (from === 'default' || to === 'default') throw new Error('The default skin name is reserved');
  const updated = mapSkinAttachments(document, item => item.parent && item.skin === from ? { ...item, skin: to } : item);
  const next: SpineDocument = { ...document, skins: updated?.map(skin => skin.name === from ? { ...skin, name: to } : skin) };
  if (document.animations) next.animations = Object.fromEntries(Object.entries(document.animations).map(([name, clip]) =>
    [name, clip.attachments === undefined ? clip : { ...clip, attachments: renamedObject(clip.attachments, from, to) }]));
  return next;
}

export function duplicateSpineSkin(document: SpineDocument, from: string, value: string): SpineDocument {
  const skins = document.skins ?? [];
  const source = skins.find(skin => skin.name === from);
  const name = value.trim();
  if (!source || !name || name === 'default' || name === '__proto__' || skins.some(skin => skin.name === name)) {
    throw new Error('Choose an existing skin and a unique name for its copy');
  }
  const copy: typeof source = { ...structuredClone(source), name };
  if (source.attachments !== undefined) {
    const attachments = structuredClone(spineSkinAttachments(document, from));
    for (const entries of Object.values(attachments)) for (const attachment of Object.values(entries)) {
      if (typeof attachment.parent === 'string' && (attachment.skin ?? 'default') === from) attachment.skin = name;
    }
    copy.attachments = attachments;
  }
  const next: SpineDocument = { ...document, skins: [...skins, copy] };
  if (document.animations) next.animations = Object.fromEntries(Object.entries(document.animations).map(([animation, clip]) => {
    if (!clip.attachments) return [animation, clip];
    const tracks = bag.parse(clip.attachments);
    if (Object.hasOwn(tracks, name)) throw new Error('The destination name is already referenced');
    return [animation, Object.hasOwn(tracks, from) ?
      { ...clip, attachments: { ...tracks, [name]: structuredClone(tracks[from]) } } : clip];
  }));
  return next;
}

export function removeSpineSkin(document: SpineDocument, name: string): SpineDocument {
  if (name === 'default' || !document.skins?.some(skin => skin.name === name)) {
    throw new Error('Choose an existing skin other than the default');
  }
  const targets = Object.entries(spineSkinAttachments(document, name)).flatMap(([slot, entries]) =>
    Object.keys(entries).map(attachment => ({ skin: name, slot, name: attachment })));
  const next = pruneSpineAttachments(document, targets);
  return { ...next, skins: next.skins?.filter(skin => skin.name !== name),
    animations: next.animations && Object.fromEntries(Object.entries(next.animations).map(([animation, clip]) => [
      animation, clip.attachments ? { ...clip, attachments: withoutNames(clip.attachments, new Set([name])) } : clip,
    ])) };
}

export function renameSpineAttachment(document: SpineDocument, slotName: string, from: string, value: string): SpineDocument {
  const slot = document.slots?.find(slot => slot.name === slotName);
  if (!slot) throw new Error('Choose an existing slot');
  const skins = (document.skins ?? []).map(skin => ({ skin, attachments: spineSkinAttachments(document, skin.name) }));
  const names = skins.flatMap(({ attachments }) => Object.keys(attachments[slotName] ?? {})).map(name => ({ name }));
  const to = rename(value, names, from);
  if (from === to) return document;
  const next: SpineDocument = {
    ...document,
    slots: document.slots?.map(item => item === slot && slot.attachment === from ? { ...item, attachment: to } : item),
    skins: skins.map(({ skin, attachments }) => {
      if (!attachments[slotName]) return skin;
      const entries = Object.fromEntries(Object.entries(attachments[slotName]).map(([name, item]) => {
        const type = item.type ?? 'region';
        let attachment = item;
        if (name === from && (type === 'region' || type === 'mesh' || type === 'linkedmesh') && item.path === undefined) {
          attachment = { ...attachment, path: typeof item.name === 'string' ? item.name : from };
        }
        if (item.parent === from) attachment = { ...attachment, parent: to };
        return [name === from ? to : name, attachment];
      }));
      return { ...skin, attachments: { ...attachments, [slotName]: entries } };
    }),
  };
  if (document.animations) next.animations = Object.fromEntries(Object.entries(document.animations).map(([name, clip]) => {
    const animation = { ...clip };
    if (clip.slots !== undefined) {
      const slots = bag.parse(clip.slots);
      const track = bag.parse(slots[slotName] ?? {});
      if (Array.isArray(track.attachment)) animation.slots = { ...slots, [slotName]: {
        ...track, attachment: track.attachment.map(frame => frame?.name === from ? { ...frame, name: to } : frame),
      } };
    }
    if (clip.attachments !== undefined) animation.attachments = Object.fromEntries(Object.entries(bag.parse(clip.attachments)).map(
      ([skin, value]) => {
        const slots = bag.parse(value);
        return [skin, slots[slotName] === undefined ? value :
          { ...slots, [slotName]: renamedObject(slots[slotName], from, to) }];
      }));
    return [name, animation];
  }));
  return next;
}

export function removeSpineAttachment(document: SpineDocument, skin: string, slot: string, name: string): SpineDocument {
  if (!Object.hasOwn(spineSkinAttachments(document, skin)[slot] ?? {}, name)) {
    throw new Error('Choose an existing attachment');
  }
  return pruneSpineAttachments(document, [{ skin, slot, name }]);
}

function pruneSpineAttachments(document: SpineDocument, targets: SpineMeshTarget[]): SpineDocument {
  if (!targets.length) return document;
  const skins = (document.skins ?? []).map(skin => ({ skin, attachments: spineSkinAttachments(document, skin.name) }));
  const slotsAffected = new Set(targets.map(item => item.slot));
  const slotKey = (skin: string, slot: string) => JSON.stringify([skin, slot]);
  const key = (skin: string, slot: string, name: string) => JSON.stringify([skin, slot, name]);
  const children = new Map<string, SpineMeshTarget[]>();
  for (const item of skins) for (const slot of slotsAffected) {
    for (const [name, attachment] of Object.entries(item.attachments[slot] ?? {})) {
      if (typeof attachment.parent !== 'string') continue;
      const parent = key(typeof attachment.skin === 'string' ? attachment.skin : 'default', slot, attachment.parent);
      const linked = children.get(parent) ?? [];
      linked.push({ skin: item.skin.name, slot, name });
      children.set(parent, linked);
    }
  }
  const removed = new Map<string, Set<string>>();
  const unavailable = new Map<string, Set<string>>();
  const queue = [...targets];
  for (const item of queue) {
    const id = slotKey(item.skin, item.slot);
    const names = removed.get(id) ?? new Set<string>();
    if (names.has(item.name)) continue;
    names.add(item.name);
    removed.set(id, names);
    const unavailableInSlot = unavailable.get(item.slot) ?? new Set<string>();
    unavailableInSlot.add(item.name);
    unavailable.set(item.slot, unavailableInSlot);
    queue.push(...(children.get(key(item.skin, item.slot, item.name)) ?? []));
  }
  const nextSkins = skins.map(({ skin, attachments }) => {
    if (!skin.attachments) return skin;
    const next = Object.fromEntries(Object.entries(attachments).flatMap(([slot, entries]) => {
      const names = removed.get(slotKey(skin.name, slot));
      const remaining = names ? Object.fromEntries(Object.entries(entries).filter(([name]) => !names.has(name))) : entries;
      const missing = unavailable.get(slot);
      if (missing) Object.keys(remaining).forEach(name => missing.delete(name));
      return !names || Object.keys(remaining).length ? [[slot, remaining]] : [];
    }));
    return { ...skin, attachments: next };
  });
  const next: SpineDocument = { ...document, skins: nextSkins, slots: document.slots?.map(item => {
    if (!item.attachment || !unavailable.get(item.name)?.has(item.attachment)) return item;
    const { attachment: _removed, ...rest } = item;
    return rest;
  }) };
  if (document.animations) next.animations = Object.fromEntries(Object.entries(document.animations).map(([animation, clip]) => {
    const updated = { ...clip };
    if (clip.slots) updated.slots = Object.fromEntries(Object.entries(bag.parse(clip.slots)).map(([slot, value]) => {
      const names = unavailable.get(slot);
      if (!names?.size) return [slot, value];
      const track = bag.parse(value);
      if (!Array.isArray(track.attachment)) return [slot, value];
      return [slot, { ...track, attachment: track.attachment.map(key => typeof key?.name === 'string' && names.has(key.name)
        ? { ...key, name: null } : key) }];
    }));
    if (clip.attachments) updated.attachments = Object.fromEntries(Object.entries(bag.parse(clip.attachments)).map(([skin, value]) => {
      const entries = Object.entries(bag.parse(value)).flatMap(([slot, tracks]) => {
        const names = removed.get(slotKey(skin, slot));
        if (!names) return [[slot, tracks]];
        const remaining = withoutNames(tracks, names);
        return Object.keys(remaining).length ? [[slot, remaining]] : [];
      });
      return [skin, Object.fromEntries(entries)];
    }));
    return [animation, updated];
  }));
  return next;
}

export function spineBoneParents(bones: SpineBone[], name: string) {
  if (!bones.find(bone => bone.name === name)?.parent) return [];
  const branch = new Set([name]);
  for (const bone of bones) if (bone.parent && branch.has(bone.parent)) branch.add(bone.name);
  return bones.filter(bone => !branch.has(bone.name));
}

function reindexWeights(attachment: SpineAttachment, indices: number[],
  transform?: (bone: number, point: SpineMeshPoint) => SpineMeshPoint) {
  const corners = attachment.type === 'mesh' && !attachment.parent
    ? (Array.isArray(attachment.uvs) ? attachment.uvs.length / 2 : undefined)
    : attachment.type === 'boundingbox' || attachment.type === 'path' || attachment.type === 'clipping' ? attachment.vertexCount : undefined;
  if (corners === undefined) return attachment;
  if (typeof corners !== 'number' || !Number.isInteger(corners) || corners < 0) throw new Error('Invalid attachment vertex count');
  const vertices = z.array(z.number()).parse(attachment.vertices);
  if (vertices.length === corners * 2) return attachment;
  let cursor = 0;
  for (let vertex = 0; vertex < corners; vertex++) {
    const count = vertices[cursor++];
    if (!Number.isInteger(count) || count < 1 || cursor + count * 4 > vertices.length) throw new Error('Invalid weighted vertex layout');
    for (let influence = 0; influence < count; influence++, cursor += 4) {
      const bone = vertices[cursor];
      const next = indices[bone];
      if (next === undefined) throw new Error('Weighted attachment refers to a missing bone');
      vertices[cursor] = next;
      if (transform) {
        const point = transform(bone, { x: vertices[cursor + 1], y: vertices[cursor + 2] });
        vertices[cursor + 1] = point.x;
        vertices[cursor + 2] = point.y;
      }
    }
  }
  if (cursor !== vertices.length) throw new Error('Unexpected weighted vertex data');
  return { ...attachment, vertices };
}

type BoneSpaceTransform = (from: number, to: number, point: SpineMeshPoint, delta: boolean) => SpineMeshPoint;

export function removeSpineBoneBranch(document: SpineDocument, name: string, transform: BoneSpaceTransform): SpineDocument {
  const parent = document.bones.find(bone => bone.name === name)?.parent;
  if (!parent) throw new Error('Choose a bone other than the root');
  const removed = new Set([name]);
  for (const bone of document.bones) if (bone.parent && removed.has(bone.parent)) removed.add(bone.name);
  const bones = document.bones.filter(bone => !removed.has(bone.name));
  const oldParent = document.bones.findIndex(bone => bone.name === parent);
  const boneIndices = new Map(bones.map((bone, index) => [bone.name, index]));
  const indices = document.bones.map(bone => boneIndices.get(bone.name) ?? boneIndices.get(parent)!);
  const moved = new Set(document.bones.flatMap((bone, index) => removed.has(bone.name) ? [index] : []));
  const mapPoint = (bone: number, point: SpineMeshPoint, delta: boolean) => {
    if (!moved.has(bone)) return point;
    const mapped = transform(bone, oldParent, point, delta);
    if (!Number.isFinite(mapped.x) || !Number.isFinite(mapped.y)) throw new Error('Bone weight transfer must use finite coordinates');
    return mapped;
  };

  const removedSlots = new Set((document.slots ?? []).filter(slot => removed.has(slot.bone)).map(slot => slot.name));
  let next: SpineDocument = { ...pruneSpineSlots(document, removedSlots), bones };
  for (const { kind, constraint } of orderedSpineConstraints(next)) {
    const pointsIntoBranch = kind === 'physics' ? removed.has(String(constraint.bone)) :
      kind !== 'path' && removed.has(String(constraint.target));
    if (pointsIntoBranch || Array.isArray(constraint.bones) && constraint.bones.some(bone => removed.has(bone))) {
      next = removeSpineConstraint(next, kind, constraint.name);
    }
  }
  const layoutKey = (skin: string, slot: string, name: string) => JSON.stringify([skin, slot, name]);
  const deformLayouts = new Map<string, number[]>();
  const sourceAttachments = new Map<string, ReturnType<typeof spineSkinAttachments>>();
  if (next.skins) next.skins = next.skins.map(skin => {
    const patched = { ...skin };
    if (Array.isArray(skin.bones)) {
      const assigned = skin.bones.filter(bone => !removed.has(bone));
      if (document.bones[oldParent].skin === true && skin.bones.some(bone => removed.has(bone)) && !assigned.includes(parent)) {
        assigned.push(parent);
      }
      patched.bones = assigned;
    }
    if (!skin.attachments) return patched;
    const source = spineSkinAttachments(next, skin.name);
    sourceAttachments.set(skin.name, source);
    return { ...patched, attachments: Object.fromEntries(Object.entries(source).map(([slot, attachments]) => [
      slot, Object.fromEntries(Object.entries(attachments).map(([name, attachment]) => {
        const layout: number[] = [];
        const mapped = reindexWeights(attachment, indices, (bone, point) => {
          layout.push(bone);
          return mapPoint(bone, point, false);
        });
        if (layout.some(bone => moved.has(bone))) deformLayouts.set(layoutKey(skin.name, slot, name), layout);
        return [name, mapped];
      })),
    ])) };
  });
  if (next.animations) next.animations = Object.fromEntries(Object.entries(next.animations).map(([name, clip]) => {
    const updated = { ...clip };
    if (clip.bones) updated.bones = withoutNames(clip.bones, removed);
    if (clip.attachments && deformLayouts.size) updated.attachments = Object.fromEntries(Object.entries(bag.parse(clip.attachments)).map(([skin, entries]) => [
      skin, Object.fromEntries(Object.entries(bag.parse(entries)).map(([slot, attachments]) => [
        slot, Object.fromEntries(Object.entries(bag.parse(attachments)).map(([name, data]) => {
          const tracks = bag.parse(data);
          if (!Array.isArray(tracks.deform)) return [name, data];
          const attachment = sourceAttachments.get(skin)?.[slot]?.[name];
          const root = typeof attachment?.parent === 'string' ? resolveSpineMesh(document, { skin, slot, name }).target : { skin, slot, name };
          const layout = deformLayouts.get(layoutKey(root.skin, root.slot, root.name));
          if (!layout) return [name, data];
          return [name, { ...tracks, deform: tracks.deform.map((key: SpineDeformKey) => {
            const offsets = unpackSpineDeform(key, layout.length * 2);
            return packSpineDeform(key, layout.flatMap((bone, index) => {
              const point = mapPoint(bone, { x: offsets[index * 2], y: offsets[index * 2 + 1] }, true);
              return [point.x, point.y];
            }));
          }) }];
        })),
      ])),
    ]));
    return [name, updated];
  }));
  return next;
}

export function reparentSpineBone(document: SpineDocument, name: string, parent: string): SpineDocument {
  const { bones } = document;
  const chosen = bones.find(bone => bone.name === name);
  if (!chosen || !spineBoneParents(bones, name).some(bone => bone.name === parent)) throw new Error('Choose a parent outside the bone branch');
  if (chosen.parent === parent) return document;
  if (document.ik?.some(item => Array.isArray(item.bones) && item.bones.length === 2 && item.bones[1] === name &&
    item.bones[0] === chosen.parent && item.bones[0] !== parent)) {
    throw new Error('This bone is the child in a two-bone IK chain. Update the constraint before changing the parent.');
  }
  const patched = { ...chosen, parent };
  const parentIndex = bones.findIndex(bone => bone.name === parent);
  const index = bones.indexOf(chosen);
  if (parentIndex < index) return { ...document, bones: bones.map(bone => bone === chosen ? patched : bone) };
  const branch = new Set([name]);
  for (const bone of bones) if (bone.parent && branch.has(bone.parent)) branch.add(bone.name);
  const moved = bones.filter(bone => branch.has(bone.name)).map(bone => bone === chosen ? patched : bone);
  const ordered = bones.flatMap(bone => bone.name === parent ? [bone, ...moved] : branch.has(bone.name) ? [] : [bone]);
  const indexByName = new Map(ordered.map((bone, index) => [bone.name, index]));
  const indices = bones.map(bone => indexByName.get(bone.name)!);
  return { ...document, bones: ordered, ...(document.skins ? { skins: mapSkinAttachments(document, item => reindexWeights(item, indices)) } : {}) };
}
