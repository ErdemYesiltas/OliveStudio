import {expect, it} from 'vitest';
import {scriptSceneReferences} from './index';

it('finds literal scene changes in scripts run by objects and scene scripts, ignoring unknown names', () => {
 const project = {formatVersion: 1, name: 'P', entrySceneId: 'a', modules: {}, providers: {}, scenes: [
  {formatVersion: 1, id: 'a', name: 'Menu', entities: [{id: 'e', name: 'Button', parentId: null, active: true, components: [{id: 'c', type: 'scripts.behaviour', version: 1, data: {scriptId: 's1', params: {}, refs: {}}}]}]},
  {formatVersion: 1, id: 'b', name: 'Level 2', entities: []},
 ], extensions: {'scripts.library': {version: 1, items: [
  {id: 's1', name: 'Go', source: "game.changeScene('Level 2'); game.changeScene(\"Nowhere\");", code: ''},
  {id: 's2', name: 'Back', source: 'game.changeScene(`Menu`)', code: ''},
 ], scenes: {b: {scriptId: 's2', params: {}, refs: {}}}}}};
 expect(scriptSceneReferences(project as never)).toEqual([
  {sceneId: 'a', targetSceneId: 'b', label: 'Menu / Button · script Go'},
  {sceneId: 'b', targetSceneId: 'a', label: 'Level 2 / scene script · script Back'},
 ]);
});

it('counts addScene and removeScene as scene references', () => {
 const project = {formatVersion: 1, name: 'P', entrySceneId: 'a', modules: {}, providers: {}, scenes: [
  {formatVersion: 1, id: 'a', name: 'Main', entities: []}, {formatVersion: 1, id: 'h', name: 'HUD', entities: []},
 ], extensions: {'scripts.library': {version: 1, items: [{id: 's', name: 'Load', source: "game.addScene('HUD'); game.removeScene( 'HUD' );", code: ''}], scenes: {a: {scriptId: 's', params: {}, refs: {}}}}}};
 expect(scriptSceneReferences(project as never)).toEqual([{sceneId: 'a', targetSceneId: 'h', label: 'Main / scene script · script Load'}, {sceneId: 'a', targetSceneId: 'h', label: 'Main / scene script · script Load'}]);
});
