import { WorldSchema } from '@rewrite/production-tools/contracts';
import { z } from 'zod';
import type { Project } from './project';
import { t } from './i18n';

export type World = z.output<typeof WorldSchema>;
export const emptyWorld: World = { version: 1, rooms: [], portals: [] };

export function worldDiagnostics(project: Project) {
  const starts = new Set([project.startup]);
  const edges = project.scenes.flatMap(scene => scene.links.filter(link => link.mode !== 'remove').map(link => [scene.id, link.target]));
  const portals = project.world?.portals ?? [];
  edges.push(...portals.map(portal => [portal.fromScene, portal.toScene]));
  for (let index = 0; index < project.scenes.length; index++) {
    for (const [from, to] of edges) if (starts.has(from)) starts.add(to);
  }
  const invalid = portals.filter(portal => {
    const roots = (id: string) => project.scenes.find(scene => scene.id === id)?.objects ?? [];
    const includes = (scene: string, id: string) => roots(scene).some(node => node.id === id && node.type !== 'Camera2D' && !node.screenSpace);
    return !includes(portal.fromScene, portal.fromEntity) || !includes(portal.fromScene, portal.fromActor) ||
      !includes(portal.toScene, portal.toSpawn) || !includes(portal.toScene, portal.toActor) ||
      !!portal.action && !project.inputMap.actions.some(action => action.kind === 'button' && action.name === portal.action);
  }).map(portal => t('invalidWorldPortal', { name: portal.name }));
  return { invalid, unreachable: project.scenes.filter(scene => !starts.has(scene.id)) };
}
