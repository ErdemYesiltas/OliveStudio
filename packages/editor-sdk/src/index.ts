import { z } from 'zod';

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export const propertyKey=(entityId:string,componentId:string,property:string)=>JSON.stringify([entityId,componentId,property]);
export type Dispose = () => void | Promise<void>;
export interface Token<T> { readonly id: string; readonly owner: string; readonly __type?: T }
export const token = <T>(owner: string, id: string): Token<T> => Object.freeze({ owner, id });
export interface Slot<T> { readonly id: string; readonly __type?: T }
export const slot = <T>(id: string): Slot<T> => Object.freeze({ id });
export interface Diagnostic { owner: string; message: string; severity: 'error' | 'warning' }
export const ManifestSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9.-]*$/), version: z.string().min(1), apiVersion: z.literal(1),
  entries: z.object({ renderer:z.string().optional(),main:z.string().optional(),worker:z.string().optional(),runtime:z.string().optional() }).strict().optional(),
  capabilities: z.array(z.string().min(1)).optional(),
  requires: z.record(z.string(), z.string()).default({}), optional: z.record(z.string(), z.string()).default({}),
}).strict();
export type ModuleManifest = z.input<typeof ManifestSchema>;
export interface ModuleContext {
  readonly id: string;
  readonly signal: AbortSignal;
  provide<T>(key: Token<T>, service: T): void;
  get<T>(key: Token<T>): T;
  contribute<T>(target: Slot<T>, id: string, value: T): void;
  own(dispose: Dispose): void;
  report(message: string, severity?: 'error' | 'warning'): void;
}
export interface EditorModule { manifest: ModuleManifest; activate(context: ModuleContext): void | Dispose | Promise<void | Dispose> }
/** `shortcut` toggles the panel, e.g. `Alt+L` (Option on macOS); ignored while typing in a field. */
export interface PanelDefinition<View = unknown> { preferredWidth?:number;preferredHeight?:number;defaultDock?:'left'|'right'|'bottom'; titleKey: string; icon: string; view: View; shortcut?: string }
export interface CommandDefinition { titleKey: string; parse?(input: unknown): unknown; execute(input: unknown): unknown | Promise<unknown> }
/**
 * An editor preference contributed by a module (namespaced ID, e.g. `pixi.gridSnap`). Values persist per machine,
 * never in the project. `section` groups rows in Settings (defaults to the owner module).
 */
export interface SettingDefinition {
  titleKey: string; descriptionKey?: string; section?: string; order?: number;
  kind: 'boolean' | 'string' | 'number' | 'enum'; default: Json;
  min?: number; max?: number; step?: number; unit?: string;
  options?: readonly { value: string; titleKey: string }[];
}
/** Validates a stored value against its definition; anything invalid falls back to the default. */
export function readSetting(definition: SettingDefinition, value: unknown): Json {
  switch (definition.kind) {
    case 'boolean': return typeof value === 'boolean' ? value : definition.default;
    case 'string': return typeof value === 'string' && value.length <= 10000 ? value : definition.default;
    case 'enum': return typeof value === 'string' && (definition.options ?? []).some(o => o.value === value) ? value : definition.default;
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return definition.default;
      const step = definition.step, min = definition.min ?? -Infinity, max = definition.max ?? Infinity;
      const snapped = step ? Math.round((value - (Number.isFinite(min) ? min : 0)) / step) * step + (Number.isFinite(min) ? min : 0) : value;
      return Math.min(max, Math.max(min, Math.round(snapped * 1e6) / 1e6));
    }
  }
}
export interface SettingsService {
  get(id: string): Json;
  set(id: string, value: Json): void;
  reset(id?: string): void;
  subscribe(listener: (id: string) => void): () => void;
}
/**
 * Machine-local settings: definitions come from the `settings` slot, values from a string storage (localStorage in
 * the desktop app). Unknown IDs are kept on disk so a disabled module does not lose its preferences.
 */
export class SettingsStore implements SettingsService {
  private values: Record<string, unknown> = {};
  private listeners = new Set<(id: string) => void>();
  constructor(private definitions: () => ReadonlyMap<string, SettingDefinition>, private storage: { read(): string | null; write(value: string): void }) {
    try { const raw = JSON.parse(storage.read() ?? '{}'); if (raw && typeof raw === 'object' && !Array.isArray(raw)) this.values = raw as Record<string, unknown>; } catch { this.values = {}; }
  }
  /** Raw persisted value, for composition code that runs before modules contribute definitions. */
  stored(id: string): unknown { return this.values[id]; }
  /** Imports a legacy preference once; an existing value wins. */
  seed(id: string, value: unknown) { if (id in this.values || value === undefined) return; this.values = { ...this.values, [id]: value }; this.save(); }
  private definition(id: string) { const d = this.definitions().get(id); if (!d) throw new Error(`Unknown setting: ${id}`); return d; }
  get(id: string): Json { return readSetting(this.definition(id), this.values[id]); }
  isDefault(id: string) { return JSON.stringify(this.get(id)) === JSON.stringify(this.definition(id).default); }
  set(id: string, value: Json) {
    const next = readSetting(this.definition(id), value);
    if (JSON.stringify(next) === JSON.stringify(this.get(id))) return;
    this.values = { ...this.values, [id]: next }; this.save(); this.emit(id);
  }
  reset(id?: string) {
    const ids = id ? [id] : [...this.definitions().keys()].filter(key => key in this.values);
    if (!ids.length) return;
    const before = new Map(ids.map(key => [key, JSON.stringify(this.get(key))]));
    const values = { ...this.values }; for (const key of ids) delete values[key]; this.values = values; this.save();
    for (const key of ids) if (before.get(key) !== JSON.stringify(this.get(key))) this.emit(key);
  }
  subscribe(listener: (id: string) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private save() { this.storage.write(JSON.stringify(this.values)); }
  private emit(id: string) { for (const listener of [...this.listeners]) listener(id); }
}
export interface MenuDefinition { titleKey: string; command: string }
export interface DocumentType { extension: string; parse(value: unknown): Json }
/** A feature-owned coordinate system; parent payloads run root → immediate parent, excluding the view boundary. */
export interface SpatialDefinition {
 space:string;
 requiresBoundary?:boolean;
 reparent(local:Json,oldParents:readonly Json[],newParents:readonly Json[]):Json;
 resetPosition(local:Json):Json;
}
export interface ComponentDefinition<T = Json> {
  type: string; version: number; titleKey: string;
  spatial?:SpatialDefinition;
  /** This component opens a separate child coordinate system on its host entity. */
  spatialBoundary?:{hostSpace:string;childSpace:string};
  supportedSpaces?:readonly string[];
  exclusiveGroup?:string;editorOnly?:boolean;addable?:boolean;hiddenInInspector?:boolean;preserveLocalIdsOnDuplicate?:boolean;
  /** At most one entity per scene may carry this component (e.g. the camera); the value names it in errors. */
  uniqueInScene?:string;
  dataSchema?:Record<string,unknown>;
  defaults(): T; parse(value: unknown): T;
  fields: readonly { key: string; titleKey: string; kind: 'number' | 'string' | 'boolean' | 'color' | 'asset' | 'enum';options?:readonly {value:string;titleKey:string}[];assetType?:string;/** Empty asset uses a built-in fallback. */optionalAsset?:boolean;
    /** Hide a field that does not apply to the current value (e.g. star points on a rectangle). */
    visible?(value: Json): boolean }[];
  sceneReferences?(value:Json):readonly (string|null)[];
  remapReferences?(value:Json,ids:{entities:ReadonlyMap<string,string>;components:ReadonlyMap<string,string>;scenes?:ReadonlyMap<string,string>;preserveLocalIds?:boolean}):Json;
  migrate?(value: Json, fromVersion: number): T;
  compile?(value: T, entityId: string): Json;
}
export interface ProviderDescriptor {
  id: string; service: string; version: string; capabilities: readonly string[];
  targets: readonly string[]; runtimeEntry: string;
}
export interface RuntimeSystem {
  id: string; after?: readonly string[]; before?: readonly string[];
  start?(context?:{paused:boolean}): void; fixedUpdate?(dtSeconds: number): void; update?(dtSeconds: number): void;
  pause?(): void; resume?(): void; dispose(): void;
  /** Objects added to the running world (spawned by scripts): pick up their bodies, tweens, scripts… */
  spawned?(ids: readonly string[]): void;
  /** Objects removed from the running world (destroyed): release what belongs to them. */
  removed?(ids: readonly string[]): void;
}
export interface ExportContext { signal: AbortSignal; profile: Json; report(message: string): void }
export interface ExportTarget {
  id: string; titleKey: string;
  validate(context: ExportContext): Promise<Diagnostic[]>;
  prepare(context: ExportContext): Promise<void>;
  build(context: ExportContext): Promise<void>;
  package(context: ExportContext): Promise<readonly string[]>;
  cleanup(): Promise<void>;
}
export const panels = slot<PanelDefinition>('editor.panels');
/** A section of the Settings dialog that edits the open project (not machine-local preferences), shown first. */
export interface SettingsSectionDefinition<View = unknown> { titleKey: string; view: View; /** Extra words for the Settings search. */ keywords?: readonly string[];
 /** `project` (default): edits the open project, with undo; `editor`: this computer's preferences, listed under Editor. */ scope?: 'project' | 'editor' }
export const settingsSections = slot<SettingsSectionDefinition>('editor.settingsSections');
export const commands = slot<CommandDefinition>('editor.commands');
export const settings = slot<SettingDefinition>('editor.settings');
export const menus = slot<MenuDefinition>('editor.menus');
export const documentTypes = slot<DocumentType>('editor.documents');
export const components = slot<ComponentDefinition>('scene.components');
export const providers = slot<ProviderDescriptor>('runtime.providers');
export const exportTargets = slot<ExportTarget>('build.targets');
/** Toolbar button; an `add` tool renders the Add menu from `createItems` and runs its command with the item ID. */
export interface ToolDefinition { titleKey: string; icon: string; command: string; group: 'edit' | 'play' | 'add' }
export const tools = slot<ToolDefinition>('editor.tools');
/** One entry of the toolbar Add menu: a named entity with these components (data merges over component defaults). */
export interface CreateItemDefinition {
  titleKey: string; category: string; icon?: string; order?: number; name: string;
  /** Optional module-owned creation command; the host does not manufacture a Transform2D for it. */
  command?:string;
  components: readonly { type: string; data?: { [key: string]: Json } }[];
}
export const createItems = slot<CreateItemDefinition>('editor.create');
/** Add menu category order; unknown categories follow in contribution order. */
export const createCategories = ['basic', 'camera', 'layout', 'shapes', 'sprites', 'text', 'meshes', 'effects', 'skeletal', 'audio', 'logic'] as const;
export const settingsToken = token<SettingsService>('settings', 'settings.service');
export const workspaces = slot<PanelDefinition>('editor.workspaces');

export const overlays = slot<{view:unknown}>('editor.overlays');

export * from './automation';
