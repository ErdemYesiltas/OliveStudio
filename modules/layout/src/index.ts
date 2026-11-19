import {components, createItems, type CreateItemDefinition, type EditorModule} from '@rewrite/sdk';
import {sceneDecorators, type SceneDecorator} from '@rewrite/render-pixi/visuals';
import {SceneLayout} from './apply';
import {layoutContainerDefinition, layoutItemDefinition, layoutManaged} from './contracts';
export * from './contracts';
export {SceneLayout} from './apply';

/** The scene decorator both hosts use: applies layouts and locks laid-out positions. */
export function createLayoutDecorator(): SceneDecorator {
 const layout = new SceneLayout();
 return {apply: (entities, node, renderer, context) => layout.apply(entities, node, renderer, context?.rtl ?? false), positionLocked: entities => layoutManaged(entities), clear: () => layout.clear()};
}
const box = (direction: string, extra: Record<string, string | number | boolean> = {}): CreateItemDefinition['components'] => [{type: 'layout.container', data: {direction, ...extra}}];
/** Toolbar Add menu entries owned by the layout module. */
export const layoutCreateItems: Record<string, CreateItemDefinition> = {
 row: {titleKey: 'create.layoutRow', category: 'layout', icon: 'row', name: 'Row', components: box('row')},
 column: {titleKey: 'create.layoutColumn', category: 'layout', icon: 'column', name: 'Column', components: box('column', {width: 240, height: 360})},
 grid: {titleKey: 'create.layoutGrid', category: 'layout', icon: 'grid', name: 'Grid', components: box('row', {wrap: true, width: 420, height: 320, justify: 'flex-start', align: 'flex-start'})},
};
export const layoutModule: EditorModule = {
 manifest: {id: 'layout', version: '1.0.0', apiVersion: 1, requires: {scene: '^1', pixi: '^1'}, entries: {runtime: '@rewrite/layout'}},
 activate(c) {
  c.contribute(components, 'layout.container', layoutContainerDefinition);
  c.contribute(components, 'layout.item', layoutItemDefinition);
  for (const [id, item] of Object.entries(layoutCreateItems)) c.contribute(createItems, `layout.${id}`, item);
  c.contribute(sceneDecorators, 'layout.flex', createLayoutDecorator());
 },
};
