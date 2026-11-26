import {createLayoutDecorator} from '@rewrite/layout';
import type {PlayerPlugin} from '../plugin';
/** Flexbox layout (`@pixi/layout` + Yoga) for the exported player; importing it installs the Pixi mixins. */
export default {id: 'layout', create() {
 const layout = createLayoutDecorator();
 return {decorators:[layout],dispose(){}};
}} satisfies PlayerPlugin;
