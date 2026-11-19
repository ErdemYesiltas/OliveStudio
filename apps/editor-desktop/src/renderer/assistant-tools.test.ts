import {expect, it} from 'vitest';
import {ProjectService} from '@rewrite/project';
import {SceneService, transformDefinition} from '@rewrite/scene';
import {shapeDefinition, textDefinition, pixiCreateItems} from '@rewrite/render-pixi';
import {interactionDefinition, builtinActions, builtinTriggers} from '@rewrite/interactions';
import type {AssetService} from '@rewrite/assets';
import {createEditorTools, editorToolSpecs} from './assistant-tools';

function setup() {
 const defs = new Map([transformDefinition, shapeDefinition, textDefinition, interactionDefinition].map(d => [d.type, d]));
 const project = new ProjectService(() => defs, () => []), scene = new SceneService(() => defs, project.sceneDocument);
 project.fresh({formatVersion: 1, id: 's1', name: 'Main', entities: []});
 const selected: string[][] = [];
 const tools = createEditorTools({
  project, scene, assets: {items: []} as unknown as AssetService, definitions: () => defs,
  createItems: () => Object.entries(pixiCreateItems).filter(([, v]) => v.components.every(c => defs.has(c.type))).map(([id, value]) => ({id: `pixi.${id}`, value})),
  triggers: () => builtinTriggers, actions: () => builtinActions, catalog: () => ({entities: scene.document.current.entities, scenes: project.document.current.scenes}),
  selection: () => [], select: ids => selected.push([...ids]), text: k => k, busy: () => false, useSkill: name => { if (name !== 'Pixel art sprite') throw Error('Unknown skill'); return 'pixel rules'; },
  generate: async () => 'asset-1', preview: async () => {},
 });
 return {project, scene, tools, selected};
}

it('every tool spec is a valid function schema with a handler', async () => {
 const {tools} = setup();
 expect(new Set(editorToolSpecs.map(t => t.function.name)).size).toBe(editorToolSpecs.length);
 for (const spec of editorToolSpecs) expect(spec.function.parameters).toMatchObject({type: 'object'});
 await expect(Promise.resolve().then(() => tools.execute('nope', {}))).rejects.toThrow('Unknown tool');
});

it('builds a scene from tool calls, reports useful errors, and a squashed turn undoes in one step', async () => {
 const {project, scene, tools, selected} = setup();
 const before = project.document.historyLength;
 const created = await tools.execute('create_scene', {name: 'Level 2'}) as {sceneId: string};
 expect(project.activeSceneId).toBe(created.sceneId);
 const circle = await tools.execute('add_object', {item: 'pixi.circle', name: 'Sun', x: 800, y: 100, fields: {'pixi.shape': {color: '#ffcc00', width: 120, height: 120}}}) as {id: string};
 const label = await tools.execute('add_object', {item: 'text', fields: {'pixi.text': {text: 'Score {score}'}}}) as {id: string};
 await tools.execute('set_fields', {objectId: 'Sun', component: 'pixi.shape', values: {strokeWidth: 4}});
 await tools.execute('set_transform', {objectId: circle.id, y: 140, scaleX: 2});
 await tools.execute('set_global', {name: 'score', type: 'number', initial: 3});
 await tools.execute('set_global', {name: 'hero', type: 'string', initial: 'Ada'});
 await expect(Promise.resolve().then(() => tools.execute('set_global', {name: 'flag', type: 'boolean', initial: 'yes'}))).rejects.toThrow('must be a boolean');
 await tools.execute('add_rule', {objectId: 'Sun', trigger: {type: 'pointer.click', sourceId: 'Sun'}, actions: [{type: 'global.add', targetId: (project.document.current.extensions['interactions.globals'] as {items: {id: string}[]}).items[0].id, amount: 1}, {type: 'global.set', targetId: (project.document.current.extensions['interactions.globals'] as {items: {id: string}[]}).items[1].id, to: 'Bo'}]});
 await tools.execute('select_objects', {ids: [label.id]});
 const sun = scene.document.current.entities.find(e => e.id === circle.id)!;
 expect(sun.components.find(c => c.type === 'pixi.shape')!.data).toMatchObject({kind: 'ellipse', color: '#ffcc00', width: 120, strokeWidth: 4});
 expect(sun.components.find(c => c.type === 'scene.transform2d')!.data).toMatchObject({x: 800, y: 140, scaleX: 2});
 expect(sun.components.find(c => c.type === 'interactions.bindings')!.data).toMatchObject({rules: [{trigger: {type: 'pointer.click', sourceId: circle.id}, actions: [{type: 'global.add', amount: 1}, {type: 'global.set', to: 'Bo'}]}]});
 expect(project.document.current.extensions['interactions.globals']).toMatchObject({items: [{name: 'score', type: 'number', initial: 3}, {name: 'hero', type: 'string', initial: 'Ada'}]});
 expect(selected).toEqual([[label.id]]);
 const state = await tools.execute('get_editor_state', {}) as {scenes: {name: string; open: boolean}[]; objects: {name: string}[]; createItems: {id: string}[]};
 expect(state.scenes.map(s => [s.name, s.open])).toEqual([['Main', false], ['Level 2', true]]);
 expect(state.objects.map(o => o.name)).toEqual(['Sun', 'Text']);
 expect(state.createItems.map(i => i.id)).toContain('pixi.star');
 await expect(Promise.resolve().then(() => tools.execute('set_fields', {objectId: 'Sun', component: 'pixi.shape', values: {colour: '#000000'}}))).rejects.toThrow('has no field colour');
 await expect(Promise.resolve().then(() => tools.execute('add_object', {item: 'dragon'}))).rejects.toThrow('Unknown item');
 await expect(Promise.resolve().then(() => tools.execute('delete_objects', {ids: ['ghost']}))).rejects.toThrow('No object ghost');
 const described = await tools.execute('describe_component', {component: 'pixi.shape'}) as {fields: {key: string; options?: string[]}[]};
 expect(described.fields.find(f => f.key === 'kind')!.options).toContain('star');
 project.document.squash('Assistant: build', before);
 expect(project.document.historyLength).toBe(before + 1);
 project.document.undo();
 expect(project.document.current.scenes.map(s => s.name)).toEqual(['Main']);
 project.document.redo();
 expect(project.document.current.scenes).toHaveLength(2);
});

it('objects in another scene point the model to open_scene', async () => {
 const {project, tools} = setup();
 await tools.execute('create_scene', {name: 'Two'});
 await tools.execute('add_object', {item: 'pixi.rect', name: 'Box'});
 await tools.execute('open_scene', {sceneId: 'Main'});
 await expect(Promise.resolve().then(() => tools.execute('rename_object', {objectId: 'Box', name: 'B'}))).rejects.toThrow('is in scene "Two"');
 expect(project.document.current.scenes).toHaveLength(2);
});

it('strings: set_strings adds languages and texts marked for review; list_strings and use_skill read', async () => {
 const {project, tools} = setup();
 expect(await tools.execute('set_strings', {strings: [{key: 'menu.play', values: {en: 'Play', tr: 'Oyna'}, note: 'Main menu'}]})).toEqual({written: 2});
 const table = await tools.execute('list_strings', {}) as {languages: {id: string; name: string}[]; entries: unknown[]};
 expect(table.languages).toEqual([{id: 'en', name: 'English'}, {id: 'tr', name: 'Turkish'}]);
 expect(table.entries).toEqual([{key: 'menu.play', values: {en: 'Play', tr: 'Oyna'}, review: ['en', 'tr'], note: 'Main menu'}]);
 expect(project.document.current.extensions['interactions.strings']).toBeDefined();
 expect(await tools.execute('use_skill', {name: 'Pixel art sprite'})).toEqual({instructions: 'pixel rules'});
 await expect(Promise.resolve().then(() => tools.execute('set_strings', {strings: [{key: 'bad key', values: {en: 'x'}}]}))).rejects.toThrow();
});
