import { z } from 'zod';

export const spineVersion = '4.2';
export const supportsSpineVersion = (version: unknown): version is string =>
  typeof version === 'string' && /^4\.2\.\d+(?:[-+].*)?$/.test(version);

const name = z.string().min(1);
const named = z.looseObject({ name });
export const spineInheritanceModes = ['normal', 'onlyTranslation', 'noRotationOrReflection', 'noScale', 'noScaleOrReflection'] as const;
export type SpineInheritanceMode = typeof spineInheritanceModes[number];
const bone = named.extend({
  parent: name.optional(), length: z.number().min(0).optional(),
  x: z.number().optional(), y: z.number().optional(), rotation: z.number().optional(),
  scaleX: z.number().optional(), scaleY: z.number().optional(), shearX: z.number().optional(), shearY: z.number().optional(),
  inherit: z.string().optional(),
});
const slot = named.extend({ bone: name, attachment: name.optional() });
const stringMap = z.record(name, z.record(name, z.unknown()));

export const spineSections = ['bones', 'slots', 'skins', 'ik', 'transform', 'path', 'physics', 'events', 'animations'] as const;
export type SpineSection = typeof spineSections[number];
export const spineDocumentSchema = z.looseObject({
  skeleton: z.looseObject({ spine: z.string().refine(supportsSpineVersion) }),
  bones: z.array(bone).min(1),
  slots: z.array(slot).optional(), skins: z.array(named).optional(),
  ik: z.array(named).optional(), transform: z.array(named).optional(),
  path: z.array(named).optional(), physics: z.array(named).optional(),
  events: stringMap.optional(), animations: stringMap.optional(),
}).superRefine((document, ctx) => {
  const bones = new Set<string>();
  document.bones.forEach((node, index) => {
    if (bones.has(node.name)) ctx.addIssue({ code: 'custom', path: ['bones', index, 'name'], message: 'Bone names must be unique' });
    if (node.parent ? !bones.has(node.parent) : index !== 0) {
      ctx.addIssue({ code: 'custom', path: ['bones', index, 'parent'],
        message: 'A bone must follow its parent. Only the first bone can be the root.' });
    }
    bones.add(node.name);
  });
  for (const section of ['slots', 'skins', 'ik', 'transform', 'path', 'physics'] as const) {
    const names = new Set<string>();
    document[section]?.forEach((node, index) => {
      if (names.has(node.name)) ctx.addIssue({ code: 'custom', path: [section, index, 'name'], message: 'Names must be unique' });
      names.add(node.name);
    });
  }
  document.slots?.forEach((item, index) => {
    if (!bones.has(item.bone)) ctx.addIssue({ code: 'custom', path: ['slots', index, 'bone'], message: 'Choose an existing bone' });
  });
});

export type SpineDocument = z.output<typeof spineDocumentSchema>;
export type SpineBone = SpineDocument['bones'][number];
export * from './spine-attachments.js';
export * from './spine-paths.js';
export * from './spine-constraints.js';
export * from './spine-draw-order.js';
export * from './spine-deform.js';
export * from './spine-tracks.js';
export * from './spine-dopesheet.js';
export * from './spine-rig.js';

export const spineBoneChannels = {
  rotate: ['value'], translate: ['x', 'y'], scale: ['x', 'y'], shear: ['x', 'y'],
  translatex: ['value'], translatey: ['value'], scalex: ['value'], scaley: ['value'],
  shearx: ['value'], sheary: ['value'], inherit: [],
} as const;
export type SpineBoneChannel = keyof typeof spineBoneChannels;
export const spineKeySchema = z.looseObject({
  time: z.number().min(0).optional(), value: z.number().optional(), x: z.number().optional(), y: z.number().optional(),
  inherit: z.string().optional(),
  curve: z.union([z.literal('stepped'), z.array(z.number())]).optional(),
});
export type SpineKey = z.output<typeof spineKeySchema>;
const record = z.record(z.string(), z.unknown());

export function spineBoneKeys(document: SpineDocument, animation: string, boneName: string, channel: SpineBoneChannel): SpineKey[] {
  const bones = record.parse(document.animations?.[animation]?.bones ?? {});
  const channels = record.parse(bones[boneName] ?? {});
  return z.array(spineKeySchema).parse(channels[channel] ?? []);
}

export function replaceSpineBoneKeys(document: SpineDocument, animation: string, boneName: string, channel: SpineBoneChannel, keys: SpineKey[]): SpineDocument {
  const clip = document.animations?.[animation];
  if (!clip || !document.bones.some(item => item.name === boneName)) throw new Error('The animation and bone must exist');
  const bones = record.parse(clip.bones ?? {});
  const channels = record.parse(bones[boneName] ?? {});
  const ordered = z.array(spineKeySchema).parse(keys).sort((a, b) => (a.time ?? 0) - (b.time ?? 0));
  if (new Set(ordered.map(key => key.time ?? 0)).size !== ordered.length) throw new Error('Key times must be unique within a track');
  if (ordered.length) channels[channel] = ordered;
  else delete channels[channel];
  const nextBones = { ...bones, [boneName]: channels };
  if (!Object.keys(channels).length) delete nextBones[boneName];
  return { ...document, animations: { ...document.animations, [animation]: { ...clip, bones: nextBones } } };
}

export function parseSpineDocument(text: string): SpineDocument {
  return spineDocumentSchema.parse(JSON.parse(text));
}

export function replaceSpineSection(document: SpineDocument, section: SpineSection, value: unknown): SpineDocument {
  return spineDocumentSchema.parse({ ...document, [section]: value });
}
