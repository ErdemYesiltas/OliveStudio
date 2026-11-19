import {createLayoutDecorator} from '@rewrite/layout';
import type {PlayerPlugin} from '../plugin';
/** Flexbox layout (`@pixi/layout` + Yoga) for the exported player; importing it installs the Pixi mixins. */
export default {id: 'layout', create(c) {
 const layout = createLayoutDecorator();
 return {decorate: (entities, node, renderer) => layout.apply(entities, node, renderer, {rtl: c.language?.()?.direction === 'rtl'}), clear: () => layout.clear(), dispose: () => layout.clear()};
}} satisfies PlayerPlugin;
