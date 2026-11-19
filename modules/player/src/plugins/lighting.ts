import {createLightingDecorator} from '@rewrite/lighting/decorator';
import type {PlayerPlugin} from '../plugin';
/** 2D lights for exported games: ambient darkness, coloured lights, flicker and shadows (one chunk, only when used). */
export default {id: 'lighting', create() {
 const lighting = createLightingDecorator();
 return {decorate: (entities, node, renderer) => lighting.apply(entities, node, renderer), clear: () => lighting.clear(), dispose: () => lighting.clear()};
}} satisfies PlayerPlugin;
