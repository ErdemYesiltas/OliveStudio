import { z } from 'zod';
import type { SpineDocument } from './spine-format.js';
import { replaceSpineTrack, spineTrackKeys } from './spine-tracks.js';

export type SpineAttachment = Record<string, unknown>;
const attachmentsSchema = z.record(z.string(), z.record(z.string(), z.record(z.string(), z.unknown())));

export function spineSkinAttachments(document: SpineDocument, skinName: string) {
  return attachmentsSchema.parse(document.skins?.find(skin => skin.name === skinName)?.attachments ?? {});
}

export function putSpineAttachment(document: SpineDocument, skinName: string, slotName: string, attachmentName: string,
  attachment: SpineAttachment): SpineDocument {
  if (!document.slots?.some(slot => slot.name === slotName) || !document.skins?.some(skin => skin.name === skinName)) {
    throw new Error('The slot and skin must exist');
  }
  const attachments = spineSkinAttachments(document, skinName);
  return { ...document, skins: document.skins.map(skin => skin.name !== skinName ? skin : {
    ...skin, attachments: { ...attachments, [slotName]: { ...attachments[slotName], [attachmentName]: attachment } },
  }) };
}

const frameNumber = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const sequenceSchema = z.looseObject({
  start: frameNumber.default(1), digits: frameNumber.default(0),
  count: frameNumber.min(1), setup: frameNumber.default(0),
});
export type SpineSequence = z.output<typeof sequenceSchema>;

export function readSpineSequence(value: unknown) {
  return sequenceSchema.parse(value);
}

function spineSequenceRegion(prefix: string, sequence: SpineSequence, index: number) {
  return prefix + String(sequence.start + index).padStart(sequence.digits, '0');
}

export function setSpineAttachmentSequence(document: SpineDocument, target: { skin: string; slot: string; name: string },
  prefix: string | undefined, sequence: SpineSequence | undefined, regions: ReadonlySet<string>): SpineDocument {
  const { skin, slot, name } = target;
  const attachment = spineSkinAttachments(document, skin)[slot]?.[name];
  if (!attachment || !['region', 'mesh', 'linkedmesh'].includes(String(attachment.type ?? 'region'))) {
    throw new Error('Choose a textured attachment');
  }
  let path = prefix ?? String(attachment.path ?? attachment.name ?? name);
  const assertRange = (sequence: SpineSequence) => {
    if (sequence.setup >= sequence.count || sequence.count > regions.size ||
        !Number.isSafeInteger(sequence.start + sequence.count - 1) ||
        ![...regions].some(region => region.length >= path.length + sequence.digits)) throw new Error('Invalid sequence frame range');
  };
  if (sequence) {
    sequence = readSpineSequence(sequence);
    assertRange(sequence);
    for (let index = 0; index < sequence.count; index++) {
      const region = spineSequenceRegion(path, sequence, index);
      if (!regions.has(region)) throw new Error(`Atlas region missing: ${region}`);
    }
  } else {
    const previous = readSpineSequence(attachment.sequence);
    assertRange(previous);
    path = spineSequenceRegion(path, previous, previous.setup);
    if (!regions.has(path)) throw new Error(`Atlas region missing: ${path}`);
  }
  const { sequence: _previous, ...rest } = attachment;
  let next = putSpineAttachment(document, skin, slot, name, sequence ? { ...rest, path, sequence } : { ...rest, path });
  const track = ['attachments', skin, slot, name, 'sequence'];
  for (const name of Object.keys(document.animations ?? {})) {
    const keys = spineTrackKeys(document, name, track);
    if (!keys.length) continue;
    if (!sequence) next = replaceSpineTrack(next, name, track, []);
    else if (keys.some(key => typeof key.index === 'number' && key.index >= sequence.count)) {
      const last = sequence.count - 1;
      next = replaceSpineTrack(next, name, track, keys.map(key =>
        typeof key.index === 'number' && key.index > last ? { ...key, index: last } : key));
    }
  }
  return next;
}

const meshTopology = z.looseObject({
  uvs: z.array(z.number()).min(6).refine(uvs => uvs.length % 2 === 0),
  triangles: z.array(z.number().int().nonnegative()).min(3).refine(triangles => triangles.length % 3 === 0),
  vertices: z.array(z.number()),
});

export type SpineMeshPoint = { x: number; y: number };
export type SpineInfluence = SpineMeshPoint & { bone: number; weight: number };
export type SpineMeshGeometry = {
  uvs: number[]; triangles: number[];
  vertices: { weighted: false; points: SpineMeshPoint[] } | { weighted: true; points: SpineInfluence[][] };
};

export function readSpineMesh(attachment: SpineAttachment, boneCount: number): SpineMeshGeometry {
  if (attachment.type !== 'mesh' || attachment.parent) throw new Error('Choose an independent mesh');
  const { uvs, triangles, vertices } = meshTopology.parse(attachment);
  const count = uvs.length / 2;
  if (triangles.some(index => index >= count)) throw new Error('A triangle refers to a missing mesh vertex');
  if (vertices.length === uvs.length) return { uvs, triangles, vertices: {
    weighted: false, points: Array.from({ length: count }, (_, index) => ({ x: vertices[index * 2], y: vertices[index * 2 + 1] })),
  } };
  const points: SpineInfluence[][] = [];
  let index = 0;
  for (let vertex = 0; vertex < count; vertex++) {
    const size = vertices[index++];
    if (!Number.isInteger(size) || size < 1 || index + size * 4 > vertices.length) throw new Error('Invalid weighted vertex');
    const influences: SpineInfluence[] = [];
    for (let influence = 0; influence < size; influence++) {
      const [bone, x, y, weight] = vertices.slice(index, index + 4);
      if (!Number.isInteger(bone) || bone < 0 || bone >= boneCount || weight < 0) throw new Error('Invalid bone influence');
      influences.push({ bone, x, y, weight });
      index += 4;
    }
    points.push(influences);
  }
  if (index !== vertices.length) throw new Error('Unexpected extra weighted vertices');
  return { uvs, triangles, vertices: { weighted: true, points } };
}

export function writeSpineMesh(attachment: SpineAttachment, geometry: SpineMeshGeometry, boneCount: number): SpineAttachment {
  if (geometry.vertices.points.length * 2 !== geometry.uvs.length) throw new Error('Mesh vertices and UVs must match');
  const vertices = geometry.vertices.weighted
    ? geometry.vertices.points.flatMap(point => [point.length, ...point.flatMap(({ bone, x, y, weight }) => [bone, x, y, weight])])
    : geometry.vertices.points.flatMap(({ x, y }) => [x, y]);
  const next = { ...attachment, uvs: geometry.uvs, triangles: geometry.triangles, vertices };
  readSpineMesh(next, boneCount);
  return next;
}

export function regionToSpineMesh(attachment: SpineAttachment, trim?: { left: number; top: number; right: number; bottom: number }): SpineAttachment {
  if (attachment.type !== undefined && attachment.type !== 'region') throw new Error('Choose a region attachment');
  const { x, y, rotation, scaleX, scaleY, width, height, ...other } = z.looseObject({
    x: z.number().default(0), y: z.number().default(0), rotation: z.number().default(0),
    scaleX: z.number().default(1), scaleY: z.number().default(1), width: z.number().positive(), height: z.number().positive(),
  }).parse(attachment);
  const angle = rotation * Math.PI / 180;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const { left, top, right, bottom } = trim ?? { left: 0, top: 0, right: 1, bottom: 1 };
  const corners = [[left, top], [right, top], [right, bottom], [left, bottom]];
  const vertices = corners.flatMap(([u, v]) => {
    const dx = (u - 0.5) * width * scaleX, dy = (0.5 - v) * height * scaleY;
    return [x + dx * cos - dy * sin, y + dx * sin + dy * cos];
  });
  return { ...other, type: 'mesh', width, height, uvs: corners.flat(),
    triangles: [0, 1, 2, 0, 2, 3], vertices, hull: 4, edges: [0, 2, 2, 4, 4, 6, 6, 0] };
}

export function editSpineInfluenceWeight(influences: SpineInfluence[], index: number, weight: number): SpineInfluence[] {
  if (!influences[index] || !Number.isFinite(weight)) throw new Error('Choose a bone influence and a valid weight');
  const value = influences.length === 1 ? 1 : Math.min(1, Math.max(0, weight));
  const other = influences.reduce((total, influence, i) => i === index ? total : total + influence.weight, 0);
  return influences.map((influence, i) => ({ ...influence,
    weight: i === index ? value : (1 - value) * (other > 0 ? influence.weight / other : 1 / (influences.length - 1)),
  }));
}
