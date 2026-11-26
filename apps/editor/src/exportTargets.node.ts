import { builtInExportTargets, type ExportIssue, type ExportOptions, type ExportTargetInfo } from './exportReport';
import type { Project } from './project';

type Context = { project: Project; options: ExportOptions };
type Stage = Context & { directory: string; webDirectory: string };

export type ExportTarget = ExportTargetInfo & {
  check?: (context: Context) => readonly ExportIssue[] | Promise<readonly ExportIssue[]>;
  prepare?: (context: Stage) => void | Promise<void>;
};

const targets = new Map<string, ExportTarget>(builtInExportTargets.map(target => [target.id, target]));

/** Built-in editor modules register trusted native hooks once during startup. */
export function registerExportTarget(target: ExportTarget) {
  if (!/^[a-z][a-z0-9-]{0,47}$/.test(target.id) || !target.label.trim() || targets.has(target.id) ||
      !builtInExportTargets.some(item => item.layout === target.layout)) throw new Error(`Invalid or duplicate export target "${target.id}"`);
  targets.set(target.id, { ...target });
}

export function exportTargets() {
  return [...targets.values()].map(({ id, layout, label }) => ({ id, layout, label }));
}

export function getExportTarget(id: string) { return targets.get(id); }
