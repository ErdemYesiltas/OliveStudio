import {expect, it} from 'vitest';
import type {ComponentDefinition} from '@rewrite/sdk';
import {t} from './strings';
import {shapeDefinition, textDefinition, bitmapTextDefinition, spriteDefinition, flipbookDefinition, objectDefinitions, effectsDefinition, maskDefinition, tilemapDefinition, pixiCreateItems} from '@rewrite/render-pixi';
import {layoutContainerDefinition, layoutItemDefinition} from '@rewrite/layout/contracts';
import {builtinActions, builtinTriggers, mediaActions, mediaTriggers, visualActions, languageActions, cameraActions, saveActions, stateTriggers} from '@rewrite/interactions';
import {inputTriggers} from '@rewrite/input';
import {transformDefinition} from '@rewrite/scene';

const keys = (d: ComponentDefinition) => [d.titleKey, ...d.fields.flatMap(f => [f.titleKey, ...(f.options ?? []).map(o => o.titleKey)])];
it('every contributed title key has an English string', () => {
 const definitions = [transformDefinition, tilemapDefinition, shapeDefinition, textDefinition, bitmapTextDefinition, spriteDefinition, flipbookDefinition, ...objectDefinitions, effectsDefinition, maskDefinition, layoutContainerDefinition, layoutItemDefinition];
 const all = [
  ...definitions.flatMap(keys),
  ...Object.values(pixiCreateItems).flatMap(i => [i.titleKey, `create.category.${i.category}`]),
  ...[...builtinActions, ...mediaActions, ...visualActions, ...languageActions, ...cameraActions, ...saveActions, ...stateTriggers, ...builtinTriggers, ...mediaTriggers, ...inputTriggers].map(a => a.titleKey),
 ].filter(k => !/^\d+ px$/.test(k));
 expect([...new Set(all)].filter(k => t(k) === k)).toEqual([]);
});
