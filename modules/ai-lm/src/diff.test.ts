import {expect, it} from 'vitest';
import {diffSummary, projectDiff} from './diff';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const box: any = {id: 'b', name: 'Box', parentId: null, active: true, components: [{id: 't', type: 'scene.transform2d', data: {x: 0, y: 0}}, {id: 's', type: 'pixi.shape', data: {color: '#ffffff', width: 10}}]};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const before: any = {scenes: [{id: 'main', name: 'Main', entities: [box, {id: 'old', name: 'Old', components: []}]}, {id: 'gone', name: 'Gone', entities: []}], extensions: {'interactions.globals': {version: 1, items: []}, keep: 1}};

it('lists added, removed and edited objects field by field, scenes and settings', () => {
 const after = structuredClone(before);
 const b = after.scenes[0].entities[0];
 b.components[1].data.color = '#ff0000'; b.name = 'Crate'; b.components.push({id: 'r', type: 'physics.rigidBody2d', data: {bodyType: 'dynamic'}});
 after.scenes[0].entities = [b, {id: 'coin', name: 'Coin', parentId: null, active: true, components: [{id: 'c', type: 'pixi.shape', data: {color: '#ffd166'}}]}];
 after.scenes = [after.scenes[0], {id: 'level', name: 'Level 2', entities: []}];
 after.scenes[0].name = 'Start';
 after.extensions['interactions.globals'] = {version: 1, items: [{id: 'g', name: 'score'}]};
 const diff = projectDiff(before, after, type => ({'pixi.shape': 'Shape', 'physics.rigidBody2d': 'Rigid Body'} as Record<string, string>)[type] ?? type);
 expect(diffSummary(diff)).toEqual(['~ Start', '+ Level 2', '− Gone', '~ Crate (Start)', '+ Coin (Start)', '− Old (Start)', '~ interactions.globals']);
 expect(diff.find(d => d.name === 'Crate')!.fields).toEqual([{path: 'name', from: 'Box', to: 'Crate'}, {path: 'Shape.color', from: '#ffffff', to: '#ff0000'}, {path: '+ Rigid Body', to: '{"bodyType":"dynamic"}'}]);
 expect(diff.find(d => d.name === 'Coin')!.fields).toEqual([{path: '+ Shape', to: '{"color":"#ffd166"}'}]);
 expect(diff.find(d => d.scope === 'setting')!.fields).toEqual([{path: 'interactions.globals.items', from: '[]', to: '[{"id":"g","name":"score"}]'}]);
 expect(projectDiff(before, structuredClone(before))).toEqual([]);
});

it('shortens long values', () => {
 const after = structuredClone(before);
 after.scenes[0].entities[0].components[1].data.color = 'x'.repeat(100);
 expect(projectDiff(before, after)[0].fields![0].to).toHaveLength(58);
});
