import { z } from 'zod';
import type { SpineDocument } from './spine-format.js';
import { putSpineAttachment, readSpineMesh, readSpineSequence, spineSkinAttachments, writeSpineMesh, type SpineAttachment,
  type SpineInfluence, type SpineMeshGeometry, type SpineMeshPoint } from './spine-attachments.js';
import { replaceSpineTrack, spineTrackKeys } from './spine-tracks.js';

export type SpineMeshTarget = { skin: string; slot: string; name: string };
const objectMap = z.record(z.string(), z.unknown());
const deformSchema = z.looseObject({
  time: z.number().nonnegative().optional(),
  offset: z.number().int().nonnegative().optional(),
  vertices: z.array(z.number()).nullable().optional(),
  curve: z.union([z.literal('stepped'), z.array(z.number()).length(4)]).nullable().optional(),
});
export type SpineDeformKey = z.output<typeof deformSchema>;
const keysSchema = z.array(deformSchema);
const identity = ({ skin, slot, name }: SpineMeshTarget) => JSON.stringify([skin, slot, name]);
export function spineMeshTargets(document: SpineDocument) {
  return (document.skins ?? []).flatMap(({ name: skin }) => Object.entries(spineSkinAttachments(document, skin))
    .flatMap(([slot, entries]) => Object.entries(entries)
      .filter(([, attachment]) => attachment.type === 'mesh' || attachment.type === 'linkedmesh')
      .map(([name, attachment]) => ({ skin, slot, name, attachment }))));
}

export function resolveSpineMesh(document: SpineDocument, target: SpineMeshTarget): { target: SpineMeshTarget; attachment: SpineAttachment; mesh: SpineMeshGeometry } {
  const visited = new Set<string>();
  for (;;) {
    const id = identity(target);
    if (visited.has(id)) throw new Error('Linked mesh parents form a cycle');
    visited.add(id);
    const attachment = spineSkinAttachments(document, target.skin)[target.slot]?.[target.name];
    if (!attachment) throw new Error('Mesh attachment not found');
    if (typeof attachment.parent !== 'string') return { target, attachment, mesh: readSpineMesh(attachment, document.bones.length) };
    target = { ...target, skin: typeof attachment.skin === 'string' && attachment.skin ? attachment.skin : 'default', name: attachment.parent };
  }
}

export function spineDeformPointLayout(mesh: SpineMeshGeometry) {
  const result: { start: number; count: number }[] = [];
  let start = 0;
  for (let index = 0; index < mesh.vertices.points.length; index++) {
    const count = mesh.vertices.weighted ? mesh.vertices.points[index].length : 1;
    result.push({ start, count });
    start += 2 * count;
  }
  return { points: result, length: start };
}

export function unpackSpineDeform(key: SpineDeformKey, length: number) {
  const { vertices, offset = 0 } = deformSchema.parse(key);
  if (!vertices?.length) return new Array<number>(length).fill(0);
  if (offset + vertices.length > length) throw new Error('Deform key exceeds the mesh vertex layout');
  const result = new Array<number>(length).fill(0);
  vertices.forEach((value, index) => { result[offset + index] = value; });
  return result;
}

export function packSpineDeform(key: SpineDeformKey, values: number[]): SpineDeformKey {
  const { offset: _offset, vertices: _vertices, ...rest } = key;
  if (values.some(value => !Number.isFinite(value))) throw new Error('Deform offsets must be finite');
  const start = values.findIndex(value => value !== 0);
  if (start === -1) return rest;
  let end = values.length;
  while (values[end - 1] === 0) end--;
  return { ...rest, ...(start ? { offset: start } : {}), vertices: values.slice(start, end) };
}

function clipEntry(clip: Record<string, unknown>, target: SpineMeshTarget) {
  const attachments = objectMap.parse(clip.attachments ?? {});
  const skin = objectMap.parse(attachments[target.skin] ?? {});
  const slot = objectMap.parse(skin[target.slot] ?? {});
  return { attachments, skin, slot, entry: objectMap.parse(slot[target.name] ?? {}) };
}

export function spineDeformKeys(document: SpineDocument, animation: string, target: SpineMeshTarget) {
  const clip = document.animations?.[animation];
  return clip ? keysSchema.parse(clipEntry(clip, target).entry.deform ?? []) : [];
}

export function replaceSpineDeformKeys(document: SpineDocument, animation: string, target: SpineMeshTarget, keys: SpineDeformKey[]): SpineDocument {
  const clip = document.animations?.[animation];
  if (!clip) throw new Error('Animation not found');
  const { mesh } = resolveSpineMesh(document, target);
  const { length } = spineDeformPointLayout(mesh);
  const ordered = keysSchema.parse(keys).sort((a, b) => (a.time ?? 0) - (b.time ?? 0));
  if (new Set(ordered.map(key => key.time ?? 0)).size !== ordered.length) throw new Error('Deform key times must be unique');
  ordered.forEach(key => unpackSpineDeform(key, length));
  const { attachments, skin, slot, entry } = clipEntry(clip, target);
  if (ordered.length) entry.deform = ordered;
  else delete entry.deform;
  return { ...document, animations: { ...document.animations, [animation]: {
    ...clip, attachments: { ...attachments, [target.skin]: { ...skin, [target.slot]: { ...slot, [target.name]: entry } } },
  } } };
}

export function makeSpineMeshIndependent(document: SpineDocument, target: SpineMeshTarget): SpineDocument {
  const linked = spineSkinAttachments(document, target.skin)[target.slot]?.[target.name];
  if (!linked || typeof linked.parent !== 'string') throw new Error('Choose a linked mesh');
  const { parent, skin, timelines, ...own } = linked;
  const source = { skin: typeof skin === 'string' && skin ? skin : 'default', slot: target.slot, name: parent };
  const { attachment, mesh } = resolveSpineMesh(document, source);
  const nextMesh = writeSpineMesh({
    ...own, type: 'mesh', ...('hull' in attachment && { hull: attachment.hull }),
    ...(Array.isArray(attachment.edges) && { edges: [...attachment.edges] }),
  }, { ...mesh, uvs: [...mesh.uvs], triangles: [...mesh.triangles] }, document.bones.length);
  let next = putSpineAttachment(document, target.skin, target.slot, target.name, nextMesh);
  if (timelines === false) return next;

  const hasDependants = spineMeshTargets(document).some(item => item.slot === target.slot && item.attachment.parent === target.name &&
    (item.attachment.skin || 'default') === target.skin && item.attachment.timelines !== false);
  const sourceAttachment = spineSkinAttachments(document, source.skin)[source.slot][source.name];
  const sequencePath = ({ skin, slot, name }: SpineMeshTarget) => ['attachments', skin, slot, name, 'sequence'];
  for (const animation of Object.keys(document.animations ?? {})) {
    const deform = spineDeformKeys(document, animation, source);
    const ownDeform = spineDeformKeys(document, animation, target);
    if (ownDeform.length && JSON.stringify(ownDeform) !== JSON.stringify(deform)) {
      throw new Error(`"${animation}" has separate linked mesh deform keys. Turn off timeline inheritance before making this mesh independent to keep those keys.`);
    }
    const sequence = own.sequence && sourceAttachment.sequence ? spineTrackKeys(document, animation, sequencePath(source)) : [];
    if (sequence.length) {
      const ownSequence = spineTrackKeys(document, animation, sequencePath(target));
      if (ownSequence.length) throw new Error(`"${animation}" keys both image sequences. Turn off timeline inheritance before making this mesh independent to keep its own sequence keys.`);
      if (readSpineSequence(own.sequence).count !== readSpineSequence(sourceAttachment.sequence).count &&
        sequence.some(key => key.mode && key.mode !== 'hold')) {
        throw new Error(`"${animation}" uses an inherited image sequence with a different frame count.`);
      }
    }
    if (hasDependants && (deform.length || sequence.length)) {
      throw new Error('Make the meshes that inherit this mesh’s timelines independent first.');
    }
    if (deform.length) next = replaceSpineDeformKeys(next, animation, target, deform);
    if (sequence.length) next = replaceSpineTrack(next, animation, sequencePath(target), sequence);
  }
  return next;
}

function replaceSharedGeometry(document: SpineDocument, root: SpineMeshTarget, attachment: SpineAttachment,
  before: SpineMeshGeometry, after: SpineMeshGeometry, remap: (values: number[]) => number[]) {
  const linked = spineMeshTargets(document).filter(item => item.slot === root.slot && identity(resolveSpineMesh(document, item).target) === identity(root));
  const { length } = spineDeformPointLayout(before);
  let changed = putSpineAttachment(document, root.skin, root.slot, root.name, writeSpineMesh(attachment, after, document.bones.length));
  for (const name of Object.keys(document.animations ?? {})) for (const item of linked) {
    const keys = spineDeformKeys(document, name, item);
    if (keys.length) changed = replaceSpineDeformKeys(changed, name, item,
      keys.map(key => packSpineDeform(key, remap(unpackSpineDeform(key, length)))));
  }
  return changed;
}

export function replaceSpineMeshInfluences(document: SpineDocument, target: SpineMeshTarget, vertex: number, influences: SpineInfluence[],
  remap: (offsets: SpineMeshPoint[]) => SpineMeshPoint[]): SpineDocument {
  return replaceSpineMeshInfluenceBatch(document, target, [{ vertex, influences, remap }]);
}

type SpineInfluenceChange = { vertex: number; influences: SpineInfluence[]; remap: (offsets: SpineMeshPoint[]) => SpineMeshPoint[] };

export function replaceSpineMeshInfluenceBatch(document: SpineDocument, target: SpineMeshTarget,
  changes: readonly SpineInfluenceChange[]): SpineDocument {
  if (!changes.length) return document;
  const { target: root, attachment, mesh } = resolveSpineMesh(document, target);
  const byVertex = new Map(changes.map(change => [change.vertex, change]));
  if (!mesh.vertices.weighted || byVertex.size !== changes.length || changes.some(change => !mesh.vertices.points[change.vertex])) {
    throw new Error('Choose unique weighted vertices');
  }
  const layout = spineDeformPointLayout(mesh).points;
  const next = { ...mesh, vertices: { weighted: true as const,
    points: mesh.vertices.points.map((point, vertex) => byVertex.get(vertex)?.influences ?? point) } };
  return replaceSharedGeometry(document, root, attachment, mesh, next, values => layout.flatMap(({ start, count }, vertex) => {
    const change = byVertex.get(vertex);
    if (!change) return values.slice(start, start + count * 2);
    const previous = Array.from({ length: count }, (_, index) => ({ x: values[start + index * 2], y: values[start + index * 2 + 1] }));
    const offsets = change.remap(previous);
    if (offsets.length !== change.influences.length) throw new Error('Deform offsets must match all vertex influences');
    return offsets.flatMap(({ x, y }) => [x, y]);
  }));
}

type Sample = { vertex: number; weight: number };
function blend(samples: Sample[], point: (index: number) => SpineMeshPoint) {
  let x = 0, y = 0;
  for (const { vertex, weight } of samples) {
    const value = point(vertex);
    x += value.x * weight;
    y += value.y * weight;
  }
  return { x, y };
}

function insert<T>(values: T[], index: number, added: T[]) {
  return [...values.slice(0, index), ...added, ...values.slice(index)];
}

function subdivide(document: SpineDocument, source: ReturnType<typeof resolveSpineMesh>, index: number,
  samples: Sample[], triangles: number[], attachment = source.attachment) {
  const { target, mesh } = source;
  const uv = blend(samples, vertex => ({ x: mesh.uvs[vertex * 2], y: mesh.uvs[vertex * 2 + 1] }));
  const vertices = mesh.vertices;
  const byBone = new Map<number, { vertex: number; index: number; weight: number; item: SpineInfluence }[]>();
  if (vertices.weighted) for (const { vertex, weight } of samples) {
    vertices.points[vertex].forEach((item, index) => {
      const value = weight * item.weight;
      if (!value) return;
      const entries = byBone.get(item.bone) ?? [];
      entries.push({ vertex, index, weight: value, item });
      byBone.set(item.bone, entries);
    });
  }
  const groups = [...byBone].map(([bone, entries]) => ({
    bone, entries, weight: entries.reduce((total, entry) => total + entry.weight, 0),
  }));
  if (vertices.weighted && !groups.length) throw new Error('The selected mesh vertices have no weighted bone influences');
  function average(group: typeof groups[number], value: (entry: typeof group.entries[number]) => SpineMeshPoint) {
    return blend(group.entries.map(({ weight }, vertex) => ({ vertex, weight: weight / group.weight })),
      index => value(group.entries[index]));
  }
  const next: SpineMeshGeometry = {
    uvs: insert(mesh.uvs, index * 2, [uv.x, uv.y]),
    triangles,
    vertices: vertices.weighted ? { weighted: true, points: insert(vertices.points, index, [groups.map(group => ({
      bone: group.bone, weight: group.weight, ...average(group, entry => entry.item),
    }))]) } : { weighted: false, points: insert(vertices.points, index, [blend(samples, index => vertices.points[index])]) },
  };
  const { points, length } = spineDeformPointLayout(mesh);
  const offset = points[index]?.start ?? length;
  const read = (values: number[], point: number, influence = 0) => {
    const offset = points[point].start + influence * 2;
    return { x: values[offset], y: values[offset + 1] };
  };
  return replaceSharedGeometry(document, target, attachment, mesh, next, values => {
    const added = vertices.weighted
      ? groups.map(group => average(group, entry => read(values, entry.vertex, entry.index)))
      : [blend(samples, vertex => read(values, vertex))];
    return insert(values, offset, added.flatMap(({ x, y }) => [x, y]));
  });
}

export function splitSpineMeshTriangle(document: SpineDocument, target: SpineMeshTarget, triangle: number) {
  const source = resolveSpineMesh(document, target);
  const start = triangle * 3;
  const corners = source.mesh.triangles.slice(start, start + 3);
  if (!Number.isInteger(triangle) || triangle < 0 || new Set(corners).size !== 3) throw new Error('Choose a valid mesh triangle');
  const added = source.mesh.vertices.points.length;
  const [a, b, c] = corners;
  const triangles = [...source.mesh.triangles.slice(0, start), a, b, added, b, c, added, c, a, added,
    ...source.mesh.triangles.slice(start + 3)];
  return subdivide(document, source, added, corners.map(vertex => ({ vertex, weight: 1 / 3 })), triangles);
}

export function spineMeshEdges(mesh: SpineMeshGeometry) {
  const edges = new Map<string, { a: number; b: number; faces: number[] }>();
  for (let start = 0; start < mesh.triangles.length; start += 3) {
    const triangle = mesh.triangles.slice(start, start + 3);
    triangle.forEach((vertex, i) => {
      const other = triangle[(i + 1) % 3];
      if (vertex === other) return;
      const a = Math.min(vertex, other), b = Math.max(vertex, other);
      const key = a + ':' + b;
      const edge = edges.get(key) ?? { a, b, faces: [] };
      edge.faces.push(start / 3);
      edges.set(key, edge);
    });
  }
  return [...edges.values()].sort((left, right) => left.a - right.a || left.b - right.b);
}

export function splitSpineMeshEdge(document: SpineDocument, target: SpineMeshTarget, a: number, b: number, ratio = 0.5) {
  const source = resolveSpineMesh(document, target);
  const { attachment, mesh } = source;
  const edge = spineMeshEdges(mesh).find(edge => edge.a === Math.min(a, b) && edge.b === Math.max(a, b));
  if (!edge || edge.faces.length > 2 || !(ratio > 0 && ratio < 1)) throw new Error('Choose a mesh edge and a fraction between 0 and 1');
  const count = mesh.vertices.points.length;
  const hull = typeof attachment.hull === 'number' ? attachment.hull : 0;
  if (!Number.isInteger(hull) || hull < 0 || hull > count) throw new Error('Invalid mesh hull');
  const boundary = edge.faces.length === 1 && edge.b < hull && (edge.b === edge.a + 1 || edge.a === 0 && edge.b === hull - 1);
  const added = boundary ? edge.b === edge.a + 1 ? edge.b : hull : count;
  const remap = (vertex: number) => vertex >= added ? vertex + 1 : vertex;
  const triangles: number[] = [];
  for (let start = 0; start < mesh.triangles.length; start += 3) {
    const triangle = mesh.triangles.slice(start, start + 3);
    const side = triangle.findIndex((vertex, index) => (vertex === a && triangle[(index + 1) % 3] === b)
      || (vertex === b && triangle[(index + 1) % 3] === a));
    if (side < 0) triangles.push(...triangle.map(remap));
    else {
      const [one, two, opposite] = [0, 1, 2].map(i => remap(triangle[(i + side) % 3]));
      triangles.push(one, added, opposite, added, two, opposite);
    }
  }
  const next = { ...attachment };
  if (boundary) next.hull = hull + 1;
  if (attachment.edges !== undefined && attachment.edges !== null) {
    const edges = z.array(z.number().int().nonnegative()).parse(attachment.edges);
    if (edges.length % 2 || edges.some(value => value % 2 || value >= 2 * count)) throw new Error('Invalid mesh edge metadata');
    const mapped = [];
    for (let index = 0; index < edges.length; index += 2) {
      const one = edges[index] / 2, two = edges[index + 1] / 2;
      mapped.push(remap(one) * 2);
      if (one === a && two === b || one === b && two === a) mapped.push(added * 2, added * 2);
      mapped.push(remap(two) * 2);
    }
    next.edges = mapped;
  }
  return { document: subdivide(document, source, added, [{ vertex: a, weight: 1 - ratio }, { vertex: b, weight: ratio }], triangles, next),
    vertex: added };
}

export function flipSpineMeshEdge(document: SpineDocument, target: SpineMeshTarget, a: number, b: number): SpineDocument {
  const { target: root, attachment, mesh } = resolveSpineMesh(document, target);
  const edges = spineMeshEdges(mesh);
  const edge = edges.find(edge => edge.a === Math.min(a, b) && edge.b === Math.max(a, b));
  if (!edge || edge.faces.length !== 2) throw new Error('Only an interior edge between two triangles can be flipped');
  if (Array.isArray(attachment.edges) && attachment.edges.some((value: unknown, index, pairs) => index % 2 === 0 &&
    (value === a * 2 && pairs[index + 1] === b * 2 || value === b * 2 && pairs[index + 1] === a * 2))) {
    throw new Error('Remove the edge constraint before flipping the diagonal');
  }
  const [left, right] = edge.faces.map(face => mesh.triangles.slice(face * 3, face * 3 + 3));
  const direction = (triangle: number[], a: number, b: number) =>
    triangle.some((vertex, index) => vertex === a && triangle[(index + 1) % 3] === b);
  const [one, two] = direction(left, a, b) ? [a, b] : [b, a];
  const c = left.find(vertex => vertex !== a && vertex !== b);
  const d = right.find(vertex => vertex !== a && vertex !== b);
  if (c === undefined || d === undefined || c === d || !direction(right, two, one) ||
      edges.some(edge => edge.a === Math.min(c, d) && edge.b === Math.max(c, d))) throw new Error('The new diagonal would overlap existing topology');
  const winding = ([a, b, c]: number[]) => {
    const [ax, ay] = mesh.uvs.slice(2 * a, 2 * a + 2);
    const [bx, by] = mesh.uvs.slice(2 * b, 2 * b + 2);
    const [cx, cy] = mesh.uvs.slice(2 * c, 2 * c + 2);
    return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  };
  const newLeft = [c, d, two], newRight = [d, c, one];
  const old = Math.sign(winding(left));
  if (!old || ![right, newLeft, newRight].every(triangle => Math.sign(winding(triangle)) === old)) {
    throw new Error('The selected UV triangles must form a convex quadrilateral');
  }
  const triangles = [...mesh.triangles];
  triangles.splice(edge.faces[0] * 3, 3, ...newLeft);
  triangles.splice(edge.faces[1] * 3, 3, ...newRight);
  return putSpineAttachment(document, root.skin, root.slot, root.name, writeSpineMesh(attachment, { ...mesh, triangles }, document.bones.length));
}
