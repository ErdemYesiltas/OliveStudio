/**
 * What an assistant turn changed, for review before keeping it: objects added, removed or edited (with the fields that
 * changed, before → after), scenes added, removed or renamed, and project settings (sections) that changed.
 */
export interface ProjectShape {scenes: readonly {id: string; name: string; entities: readonly EntityShape[]}[]; extensions?: Record<string, unknown>}
interface EntityShape {id: string; name: string; parentId?: string | null; active?: boolean; components: readonly {id: string; type: string; data?: unknown}[]}
export interface FieldChange {path: string; from?: string; to?: string}
export interface DiffEntry {kind: 'added' | 'removed' | 'changed'; scope: 'object' | 'scene' | 'setting'; name: string; scene?: string; fields?: FieldChange[]}

const short = (v: unknown) => { if (v === undefined) return undefined; const text = typeof v === 'string' ? v : JSON.stringify(v); return text.length > 60 ? `${text.slice(0, 57)}…` : text; };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** Field-level changes of two plain values, one level into objects (deeper values compare as JSON). */
function fields(prefix: string, a: unknown, b: unknown, out: FieldChange[]) {
 if (same(a, b)) return;
 const objects = a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b);
 if (!objects) { out.push({path: prefix, from: short(a), to: short(b)}); return; }
 for (const key of new Set([...Object.keys(a as object), ...Object.keys(b as object)])) { const x = (a as Record<string, unknown>)[key], y = (b as Record<string, unknown>)[key]; if (!same(x, y)) out.push({path: `${prefix}.${key}`, from: short(x), to: short(y)}); }
}
function entityFields(a: EntityShape, b: EntityShape, label: (type: string) => string): FieldChange[] {
 const out: FieldChange[] = [];
 if (a.name !== b.name) out.push({path: 'name', from: a.name, to: b.name});
 if ((a.parentId ?? null) !== (b.parentId ?? null)) out.push({path: 'parent', from: short(a.parentId ?? null), to: short(b.parentId ?? null)});
 if ((a.active ?? true) !== (b.active ?? true)) out.push({path: 'active', from: String(a.active ?? true), to: String(b.active ?? true)});
 const before = new Map(a.components.map(c => [c.id, c])), after = new Map(b.components.map(c => [c.id, c]));
 for (const c of b.components) { const old = before.get(c.id); if (!old) out.push({path: `+ ${label(c.type)}`, to: short(c.data)}); else fields(label(c.type), old.data, c.data, out); }
 for (const c of a.components) if (!after.has(c.id)) out.push({path: `− ${label(c.type)}`, from: short(c.data)});
 return out;
}

export function projectDiff(before: ProjectShape, after: ProjectShape, label: (componentType: string) => string = type => type): DiffEntry[] {
 const out: DiffEntry[] = [], oldScenes = new Map(before.scenes.map(s => [s.id, s])), newScenes = new Map(after.scenes.map(s => [s.id, s]));
 for (const s of after.scenes) { const old = oldScenes.get(s.id); if (!old) out.push({kind: 'added', scope: 'scene', name: s.name}); else if (old.name !== s.name) out.push({kind: 'changed', scope: 'scene', name: s.name, fields: [{path: 'name', from: old.name, to: s.name}]}); }
 for (const s of before.scenes) if (!newScenes.has(s.id)) out.push({kind: 'removed', scope: 'scene', name: s.name});
 for (const s of after.scenes) {
  const old = oldScenes.get(s.id), was = new Map((old?.entities ?? []).map(e => [e.id, e]));
  for (const e of s.entities) { const prev = was.get(e.id); if (!prev) { out.push({kind: 'added', scope: 'object', name: e.name, scene: s.name, fields: e.components.map(c => ({path: `+ ${label(c.type)}`, to: short(c.data)}))}); continue; } const changed = entityFields(prev, e, label); if (changed.length) out.push({kind: 'changed', scope: 'object', name: e.name, scene: s.name, fields: changed}); }
  if (old) { const now = new Set(s.entities.map(e => e.id)); for (const e of old.entities) if (!now.has(e.id)) out.push({kind: 'removed', scope: 'object', name: e.name, scene: s.name}); }
 }
 const a = before.extensions ?? {}, b = after.extensions ?? {};
 for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) if (!same(a[key], b[key])) { const f: FieldChange[] = []; fields(key, a[key], b[key], f); out.push({kind: key in a ? key in b ? 'changed' : 'removed' : 'added', scope: 'setting', name: key, fields: f}); }
 return out;
}
/** One line per entry: `+ Coin (Main)`, `~ Box: Shape.color #fff → #f00`, `− Old`. */
export const diffSummary = (entries: readonly DiffEntry[]) => entries.map(e => `${e.kind === 'added' ? '+' : e.kind === 'removed' ? '−' : '~'} ${e.name}${e.scene ? ` (${e.scene})` : ''}`);
