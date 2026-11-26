import { expect, it } from 'vitest';
import { parseProject, serializeProject } from './project';
import { objectSchema } from './scene';
import { collectLighting } from './sceneLighting';

it('resolves light and shadow sources while leaving screen space outside the world', () => {
  const data = { width: 30, height: 80, sensor: false, offsetX: 15, offsetY: 40 };
  const box = { id: 'box', kind: 'box', data };
  const nodes = [
    objectSchema.parse({ id: 'lamp', type: 'Light2D', label: 'Lamp' }),
    objectSchema.parse({ id: 'wall', type: 'Graphics', label: 'Wall', physics: { colliders: [box] } }),
    objectSchema.parse({ id: 'ignored', type: 'Graphics', label: 'Ignored', shadowCaster: 'off', physics: { colliders: [box] } }),
    objectSchema.parse({ id: 'sensor', type: 'Graphics', label: 'Sensor', physics: { colliders: [{ ...box, data: { ...data, sensor: true } }] } }),
    objectSchema.parse({ id: 'art', type: 'Graphics', label: 'Art', shadowCaster: 'bounds' }),
    objectSchema.parse({ id: 'hud', type: 'Container', label: 'HUD', screenSpace: { anchor: 'top-left' }, children: [
      { id: 'hud-lamp', type: 'Light2D', label: 'HUD Lamp' },
      { id: 'hud-wall', type: 'Graphics', label: 'HUD Wall', shadowCaster: 'bounds' },
    ] }),
  ];
  const { lights, occluders } = collectLighting(nodes);
  expect(lights.map(node => node.id)).toEqual(['lamp']);
  expect(occluders.find(node => node.id === 'art')?.points).toBeUndefined();
  expect(occluders.find(node => node.id === 'wall')?.points).toHaveLength(4);
  expect(occluders.map(node => node.id).sort()).toEqual(['art', 'wall']);
});

it('round-trips lighting and its defaults in both scene document formats', () => {
  const lighting = { enabled: true, ambient: '#343836' };
  const objects = [{ id: 'light', type: 'Light2D', label: 'Light' }];
  for (const file of [{ version: 1, objects, lighting }, {
    version: 2, startup: 'main', scenes: [{ id: 'main', name: 'Main', objects, lighting }],
  }]) {
    const project = parseProject(file);
    const reopened = parseProject(JSON.parse(serializeProject(project)));
    expect(reopened.scenes[0].lighting).toEqual(lighting);
    expect(reopened.scenes[0].objects[0]).toMatchObject({ type: 'Light2D', light: { radius: 220, shadows: true } });
  }
});
