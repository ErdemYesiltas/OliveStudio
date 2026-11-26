import { z } from 'zod';
import { changeObject, findObject, type SceneObject } from './scene';

const id = z.string().min(1).max(120);
const coordinate = z.number().min(-100000).max(100000);
const actions = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('rename'), id, label: z.string().trim().min(1).max(120) }),
  z.strictObject({ action: z.literal('move'), id, x: coordinate, y: coordinate }),
  z.strictObject({ action: z.literal('setText'), id, text: z.string().max(2000) }),
  z.strictObject({ action: z.literal('visibility'), id, visible: z.boolean() }),
]);
export const assistantEditsSchema = z.array(actions).min(1).max(20);
export type AssistantEdit = z.output<typeof actions>;

export function parseAssistantEdits(reply: string) {
  const markdown = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/i.exec(reply);
  return assistantEditsSchema.parse(JSON.parse(markdown?.[1] ?? reply));
}

export function applyAssistantEdits(objects: SceneObject[], input: AssistantEdit[], blocked: ReadonlySet<string>) {
  const edits = assistantEditsSchema.parse(input);
  let next = objects;
  for (const edit of edits) {
    const node = findObject(next, edit.id);
    if (!node || node.type === 'Camera2D' || blocked.has(edit.id)) throw new Error(`Object cannot be edited: ${edit.id}`);
    switch (edit.action) {
      case 'rename': next = changeObject(next, edit.id, node => ({ ...node, label: edit.label })); break;
      case 'move': next = changeObject(next, edit.id, node => ({ ...node, position: { x: edit.x, y: edit.y } })); break;
      case 'visibility': next = changeObject(next, edit.id, node => ({ ...node, visible: edit.visible })); break;
      case 'setText':
        if (node.type !== 'Text' && node.type !== 'BitmapText') throw new Error(`Object is not text: ${node.label}`);
        next = changeObject(next, edit.id, node => node.type === 'Text' || node.type === 'BitmapText' ?
          { ...node, text: edit.text } : node);
        break;
    }
  }
  return next;
}
