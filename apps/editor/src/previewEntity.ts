import type { Entity } from '@rewrite/scene';
import { behaviourType } from '@rewrite/scripts/contracts';
import { behaviorType } from '@rewrite/behavior/contracts';
import { graphType } from '@rewrite/interactions';
import { characterType } from '@rewrite/production-tools/contracts';
import { BitmapText, type Container, Text } from 'pixi.js';
import type { SceneObject } from './scene';

const degrees = 180 / Math.PI;

export function gameEntity(node: SceneObject, parentId: string | null, display: () => Container | undefined): Entity {
  const transform = {
    get pivotX() { return display()?.pivot.x ?? node.pivot.x; },
    get pivotY() { return display()?.pivot.y ?? node.pivot.y; },
    get x() { return display()?.x ?? node.position.x; },
    set x(value) { const item = display(); if (item) item.x = value; },
    get y() { return display()?.y ?? node.position.y; },
    set y(value) { const item = display(); if (item) item.y = value; },
    get rotation() { return display()?.angle ?? node.rotation; },
    set rotation(value) { const item = display(); if (item) item.angle = value; },
    get scaleX() { return display()?.scale.x ?? node.scale.x; },
    set scaleX(value) { const item = display(); if (item) item.scale.x = value; },
    get scaleY() { return display()?.scale.y ?? node.scale.y; },
    set scaleY(value) { const item = display(); if (item) item.scale.y = value; },
    get skewX() { const item = display(); return item ? item.skew.x * degrees : node.skew.x; },
    set skewX(value) { const item = display(); if (item) item.skew.x = value / degrees; },
    get skewY() { const item = display(); return item ? item.skew.y * degrees : node.skew.y; },
    set skewY(value) { const item = display(); if (item) item.skew.y = value / degrees; },
  };
  const visual = {
    get alpha() { return display()?.alpha ?? node.alpha; },
    set alpha(value) { const item = display(); if (item) item.alpha = value; },
    get text() { const item = display(); return item instanceof Text || item instanceof BitmapText ? item.text : ''; },
    set text(value) { const item = display(); if (item instanceof Text || item instanceof BitmapText) item.text = value; },
  };
  return {
    id: node.id, name: node.label, parentId,
    get active() { return display()?.visible ?? node.visible; },
    components: [
      { id: `${node.id}:transform`, type: 'scene.transform2d', version: 1, data: transform },
      { id: `${node.id}:visual`, type: node.type === 'Text' ? 'pixi.text' : node.type === 'BitmapText' ? 'pixi.bitmapText' : 'pixi.sprite', version: 1, data: visual },
      ...(node.type === 'Spine' ? [{ id: `${node.id}:spine`, type: 'spine.renderer', version: 1, data: { assetId: node.asset } }] : []),
      ...(node.behaviour?.scriptId ? [{ id: `${node.id}:script`, type: behaviourType, version: 1, data: node.behaviour }] : []),
      ...(node.behavior?.scriptId ? [{ id: `${node.id}:behavior`, type: behaviorType, version: 1, data: node.behavior }] : []),
      ...(node.logicGraph ? [{ id: `${node.id}:logic`, type: graphType, version: 1, data: node.logicGraph }] : []),
      ...(node.character ? [{ id: `${node.id}:character`, type: characterType, version: 1, data: node.character }] : []),
      ...(node.platform ? [{ id: `${node.id}:platform`, type: 'production.platform', version: 1, data: node.platform }] : []),
    ],
  };
}
