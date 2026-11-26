import { LayoutContainerSchema, LayoutItemSchema, containerDefaults, itemDefaults, type LayoutContainerData, type LayoutEntity } from '@rewrite/layout/contracts';
import { z } from 'zod';
import type { SceneObject } from './scene';

const units = z.enum(['px', '%']).default('px');
export const flexContainerSchema = LayoutContainerSchema.extend({ widthUnit: units, heightUnit: units });
export const flexItemSchema = LayoutItemSchema;
export type FlexContainer = z.output<typeof flexContainerSchema>;
export type FlexItem = z.output<typeof flexItemSchema>;
type Size = { width: number; height: number };

export const defaultFlexContainer = () => flexContainerSchema.parse(containerDefaults);
export const defaultFlexItem = () => flexItemSchema.parse(itemDefaults);

export function isLayoutChild(node: SceneObject, parent?: SceneObject) {
  return node.type !== 'Camera2D' && parent?.type === 'Container' && !!parent.layout;
}

function resolveLayout(layout: FlexContainer, ref: Size): LayoutContainerData {
  const { widthUnit, heightUnit, width, height, ...style } = layout;
  function resolve(value: number, unit: 'px' | '%', available: number) {
    if (unit === 'px' || !value) return value;
    return Math.max(1, Math.min(10000, available * value / 100));
  }
  return { ...style, width: resolve(width, widthUnit, ref.width), height: resolve(height, heightUnit, ref.height) };
}

export function layoutEntities(objects: readonly SceneObject[], viewport: Size) {
  const entities: LayoutEntity[] = [];
  function visit(nodes: readonly SceneObject[], parentId: string | null, parentSize: Size) {
    for (const node of nodes) {
      if (node.type === 'Camera2D') continue;
      const layout = node.type === 'Container' && node.layout && resolveLayout(node.layout, parentSize);
      const components = [
        ...(layout ? [{ type: 'layout.container', version: 1, data: layout }] : []),
        ...(node.layoutItem ? [{ type: 'layout.item', version: 1, data: node.layoutItem }] : []),
      ];
      entities.push({ id: node.id, parentId, components });
      if (node.type === 'Container') visit(node.children, node.id, layout ? {
        width: Math.max(1, (layout.width || parentSize.width) - layout.padding * 2),
        height: Math.max(1, (layout.height || parentSize.height) - layout.padding * 2),
      } : viewport);
    }
  }
  visit(objects, null, viewport);
  return entities;
}
