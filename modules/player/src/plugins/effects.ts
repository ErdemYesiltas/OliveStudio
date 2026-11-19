import {createEffectsDecorator} from '@rewrite/render-pixi/effects';
import type {PlayerPlugin} from '../plugin';
/** Blend modes, filters, custom shaders and shape masks for the exported player (one chunk, included only when used). */
export default {id: 'effects', create(context) {
 const effects = createEffectsDecorator({shaders: () => context.bundle.project.extensions['pixi.shaders']});
 return {decorate: (entities, node, renderer) => effects.apply(entities, node, renderer), clear: () => effects.clear(), dispose: () => effects.clear()};
}} satisfies PlayerPlugin;
