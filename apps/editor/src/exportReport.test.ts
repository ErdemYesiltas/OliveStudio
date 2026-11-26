import { expect, it } from 'vitest';
import { serviceWorker } from '@rewrite/html-export/webapp';
import { assessExport, initialExportOptions } from './exportReport';
import { parseProject } from './project';

it('reports broken references with names and checks the selected export target', () => {
  const project = parseProject({
    version: 2, startup: 'main', scenes: [{ id: 'main', name: 'Opening', objects: [{
      id: 'tile', label: 'Tile', type: 'Sprite', texture: 'wrong.mp3',
      behaviour: { scriptId: 'deleted', params: {}, refs: {} },
    }] }],
  });
  const options = { ...initialExportOptions('Example'), format: 'capacitor' as const, appId: 'bad' };
  const issues = assessExport(project, options, new Map([['wrong.mp3', { kind: 'audio' }]]));
  expect(issues.filter(issue => issue.level === 'error')).toHaveLength(3);
  expect(issues.filter(issue => issue.scope === 'Opening / Tile').map(issue => issue.message)).toEqual([
    'Asset wrong.mp3 is missing or has the wrong type. Expected image.', 'The attached script is missing.',
  ]);
});

it('isolates offline caches by deployed game scope', () => {
  const worker = serviceWorker(['assets/play.js', 'project.json'], 'a1b2', true);
  expect(worker).toContain('self.registration.scope');
  expect(worker).toContain('caches.open(CACHE)');
  expect(worker).toContain('"./project.json"');
  expect(serviceWorker([], 'a1b2')).toContain('"pixi-game-a1b2"');
});
