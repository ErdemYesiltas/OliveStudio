import { z } from 'zod';
import type { SpineDocument } from './spine-format.js';

const offsetSchema = z.looseObject({ slot: z.string(), offset: z.number().int() });
const keySchema = z.looseObject({ offsets: z.array(offsetSchema).nullable().optional() });
const sourceSchema = z.looseObject({
  slots: z.array(z.looseObject({ name: z.string() })).optional(),
  animations: z.record(z.string(), z.looseObject({ drawOrder: z.array(keySchema).nullable().optional() })).optional(),
});

function resolveOffsets(setup: string[], offsets: z.output<typeof offsetSchema>[]) {
  const draw: (string | undefined)[] = Array.from({ length: setup.length });
  const indexes = new Map(setup.map((name, index) => [name, index]));
  const moved = new Set<string>();
  let previous = -1;
  for (const { slot, offset } of offsets) {
    const index = indexes.get(slot);
    if (index === undefined || index <= previous) throw new Error('Draw-order offsets must follow setup slot order');
    const position = index + offset;
    if (position < 0 || position >= setup.length || draw[position] !== undefined) throw new Error('Draw-order offsets must point to distinct slots');
    draw[position] = slot;
    previous = index;
    moved.add(slot);
  }
  const remaining = setup.filter(slot => !moved.has(slot));
  let index = 0;
  return draw.map(slot => slot ?? remaining[index++]);
}

export function assertSpineDrawOrders(input: unknown) {
  const document = sourceSchema.parse(input);
  const setup = document.slots?.map(slot => slot.name) ?? [];
  for (const clip of Object.values(document.animations ?? {})) {
    for (const key of clip.drawOrder ?? []) if (key.offsets) resolveOffsets(setup, key.offsets);
  }
}

export function spineKeyDrawOrder(setup: string[], key: unknown) {
  return resolveOffsets(setup, keySchema.parse(key).offsets ?? []);
}

export function spineDrawOrderOffsets(setup: string[], draw: string[]) {
  const positions = new Map(draw.map((name, index) => [name, index]));
  if (positions.size !== setup.length || draw.length !== setup.length || setup.some(name => !positions.has(name))) {
    throw new Error('Draw order must include each slot once');
  }
  return setup.flatMap((name, index) => {
    const offset = positions.get(name)! - index;
    return offset ? [{ slot: name, offset }] : [];
  });
}

export function moveSpineSlot(document: SpineDocument, name: string, index: number): SpineDocument {
  const slots = [...(document.slots ?? [])];
  const original = slots.map(slot => slot.name);
  const from = original.indexOf(name);
  if (from < 0 || !Number.isInteger(index) || index < 0 || index >= slots.length) throw new Error('Invalid setup slot order');
  if (from === index) return document;
  const [slot] = slots.splice(from, 1);
  slots.splice(index, 0, slot);
  const animations = document.animations && Object.fromEntries(Object.entries(document.animations).map(([name, clip]) => {
    if (!Array.isArray(clip.drawOrder)) return [name, clip];
    const drawOrder = z.array(keySchema).parse(clip.drawOrder).map(key => {
      if (!key.offsets) return key;
      const target = new Map(resolveOffsets(original, key.offsets).map((name, index) => [name, index]));
      const oldOffsets = new Map(key.offsets.map(offset => [offset.slot, offset]));
      const offsets = slots.flatMap(({ name }, index) => {
        const offset = target.get(name)! - index;
        return offset ? [{ ...oldOffsets.get(name), slot: name, offset }] : [];
      });
      return { ...key, offsets };
    });
    return [name, { ...clip, drawOrder }];
  }));
  return { ...document, slots, ...(animations ? { animations } : {}) };
}
