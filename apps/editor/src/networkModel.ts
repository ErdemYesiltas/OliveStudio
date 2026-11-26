import {
  defaultMultiplayer, ServerRulesSchema, type MultiplayerSettings, type NetworkPlayer, type ServerRules,
} from '@rewrite/multiplayer/contracts';
import type { Project } from './project';
import type { SceneObject } from './scene';
import { selectionTree } from './selection';
import { t } from './i18n';

export type NetworkTemplate = { scene: string; node: SceneObject; player: NetworkPlayer };
export type NetworkPlan = { settings: MultiplayerSettings; template?: NetworkTemplate; rules?: ServerRules; problems: string[] };

export function networkPlan(project: Project): NetworkPlan {
  const settings = project.multiplayer ?? defaultMultiplayer();
  const candidates = project.scenes.flatMap(scene => [...selectionTree(scene.objects).values()].flatMap(({ node, parent }) =>
    node.networkPlayer ? [{ node, parent, scene: scene.id, player: node.networkPlayer }] : []));
  if (!settings.enabled) return { settings, ...(candidates.length === 1 ? { template: candidates[0] } : {}), problems: [] };
  if (candidates.length !== 1) return { settings, problems: [t(candidates.length ? 'networkOneTemplate' : 'networkMissingTemplate')] };
  const template = candidates[0];
  const { node, parent, player } = template;
  const problems: string[] = [];
  if (parent || node.screenSpace) problems.push(t('networkRootTemplate'));
  if (['Light2D', 'Camera2D', 'AudioListener', 'AudioSource'].includes(node.type)) problems.push(t('networkVisualTemplate'));
  if ([...selectionTree([node]).values()].some(({ node }) => node.physics?.body?.bodyType === 'dynamic')) {
    problems.push(t('networkDynamicTemplate'));
  }
  const actions = new Set(project.inputMap.actions.filter(action => action.kind === 'button').map(action => action.name));
  if (![player.left, player.right, player.up, player.down].some(Boolean)) problems.push(t('networkMovementRequired'));
  for (const action of new Set([player.left, player.right, player.up, player.down])) {
    if (action && !actions.has(action)) problems.push(t('networkMissingAction', { action }));
  }
  const { width, height } = project.config.renderer;
  const rules = ServerRulesSchema.safeParse({
    version: 1, room: settings.room, maxPlayers: settings.maxPlayers, tickRate: settings.tickRate,
    reconnectSeconds: settings.reconnectSeconds, speed: player.speed, bounds: { width, height },
    spawn: { x: Math.min(width, Math.max(0, node.position.x)), y: Math.min(height, Math.max(0, node.position.y)) },
  });
  if (!rules.success) problems.push(t('networkInvalidWorld'));
  return { settings, template, rules: !problems.length && rules.success ? rules.data : undefined, problems };
}
