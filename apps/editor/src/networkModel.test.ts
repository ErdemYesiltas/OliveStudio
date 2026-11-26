import { defaultMultiplayer, defaultNetworkPlayer, ensureMovementActions } from '@rewrite/multiplayer/contracts';
import { expect, it } from 'vitest';
import { networkPlan } from './networkModel';
import { parseProject, serializeProject } from './project';

it('derives authoritative rules from the authored network template and persists its input bindings', () => {
  const player = defaultNetworkPlayer();
  const project = parseProject({
    version: 2, startup: 'main', multiplayer: { ...defaultMultiplayer(), enabled: true },
    scenes: [{ id: 'main', name: 'Main', objects: [
      { id: 'hero', type: 'Graphics', label: 'Hero', position: { x: 250, y: 200 }, networkPlayer: player },
    ] }],
  });
  expect(networkPlan(project).problems).toHaveLength(4);
  project.inputMap = ensureMovementActions(project.inputMap, player);
  const reopened = parseProject(JSON.parse(serializeProject(project)));
  expect(networkPlan(reopened)).toMatchObject({
    problems: [], rules: { speed: 220, bounds: { width: 960, height: 540 }, spawn: { x: 250, y: 200 } },
  });
});
