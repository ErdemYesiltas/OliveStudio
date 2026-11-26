import { DataSchema } from '@rewrite/production-tools/contracts';
import { validateData } from '@rewrite/production-tools/models';
import type { Project } from './project';
import { selectionTree } from './selection';
import { t } from './i18n';

export type GameData = NonNullable<Project['gameData']>;
export const emptyGameData: GameData = { version: 1, tables: [], bindings: [] };

export const bindingFields = [
  ['transform', 'x', 'number'], ['transform', 'y', 'number'], ['transform', 'rotation', 'number'],
  ['transform', 'scaleX', 'number'], ['transform', 'scaleY', 'number'], ['visual', 'alpha', 'number'],
  ['visual', 'text', 'string'],
] as const;

export function gameDataProblems(project: Project, catalog: GameData) {
  const objects = new Map(project.scenes.flatMap(scene => [...selectionTree(scene.objects).entries()]));
  const problems: string[] = [];
  const properties = new Set<string>();
  for (const binding of catalog.bindings) {
    const table = catalog.tables.find(item => item.id === binding.tableId);
    const field = table?.fields.find(item => item.key === binding.field);
    const node = objects.get(binding.entityId)?.node;
    const target = bindingFields.find(([group, property, kind]) =>
      binding.componentId === `${binding.entityId}:${group}` && property === binding.property && kind === field?.kind);
    const key = `${binding.componentId}:${binding.property}`;
    if (!target || !node || !table?.rows.some(row => row.id === binding.rowId) ||
        (binding.property === 'text' && node.type !== 'Text' && node.type !== 'BitmapText') ||
        (target[0] === 'transform' && !!node.physics?.body) || properties.has(key)) problems.push(t('dataInvalidBinding', { property: binding.property }));
    properties.add(key);
  }
  return problems;
}

export function parseGameData(project: Project, raw: GameData) {
  const data = DataSchema.parse(raw);
  validateData(data);
  const problems = gameDataProblems(project, data);
  if (problems.length) throw new Error(problems.join('\n'));
  return data;
}
