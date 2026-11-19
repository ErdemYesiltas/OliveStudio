import {z} from 'zod';
import {BehaviorSubject, Subject, type Observable} from 'rxjs';

/**
 * Project globals (like Godot autoload values): numbers, booleans, strings, lists and objects that every scene, rule, state machine,
 * text and script of one play session shares. They start at their initial values when Preview or the game starts and
 * survive scene changes.
 */
export const globalsSection = 'interactions.globals';
export const globalTypes = ['number', 'boolean', 'string', 'list', 'object'] as const;
export type GlobalType = typeof globalTypes[number];
/** Numbers, on/off and text, and (for list and object globals) JSON lists and records of those. */
export type GlobalValue = number | boolean | string | GlobalValue[] | {[key: string]: GlobalValue};
/** Limits that keep a structured global small enough for every frame, template and save slot. */
export const globalLimits = {depth: 6, items: 1000, keys: 200, json: 20000} as const;
const KEY = /^[A-Za-z_$][A-Za-z0-9_$]{0,39}$/;
/** Why a value is not a valid global value, or null when it is. */
export function globalValueProblem(value: unknown, depth = 0): string | null {
 if (typeof value === 'number') return Number.isFinite(value) ? null : 'Numbers must be finite';
 if (typeof value === 'boolean') return null;
 if (typeof value === 'string') return value.length <= 1000 ? null : 'Text is longer than 1000 characters';
 if (depth >= globalLimits.depth) return `Lists and objects nest at most ${globalLimits.depth} deep`;
 if (Array.isArray(value)) { if (value.length > globalLimits.items) return `Lists hold at most ${globalLimits.items} items`; for (const item of value) { const p = globalValueProblem(item, depth + 1); if (p) return p; } return null; }
 if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype || value && typeof value === 'object' && Object.getPrototypeOf(value) === null) {
  const entries = Object.entries(value as object); if (entries.length > globalLimits.keys) return `Objects hold at most ${globalLimits.keys} fields`;
  for (const [k, v] of entries) { if (!KEY.test(k)) return `Field names use letters, digits, _ and $: ${k.slice(0, 40)}`; const p = globalValueProblem(v, depth + 1); if (p) return p; }
  return depth === 0 && JSON.stringify(value).length > globalLimits.json ? `A global is at most ${globalLimits.json} characters of JSON` : null;
 }
 return 'Values are numbers, true/false, text, lists or objects';
}
export const GlobalValueSchema = z.custom<GlobalValue>(v => globalValueProblem(v) === null, {message: 'Invalid global value'}).superRefine((v, c) => { if (Array.isArray(v) && JSON.stringify(v).length > globalLimits.json) c.addIssue({code: 'custom', message: `A global is at most ${globalLimits.json} characters of JSON`}); });
/** The type a value has as a global. */
export const typeOfGlobal = (v: GlobalValue): GlobalType => Array.isArray(v) ? 'list' : typeof v === 'object' ? 'object' : typeof v as GlobalType;
/** Value equality (lists and objects by content). */
export const sameGlobal = (a: GlobalValue, b: GlobalValue) => a === b || typeof a === 'object' && typeof b === 'object' && JSON.stringify(a) === JSON.stringify(b);
/** A deep, frozen copy: stored values cannot change behind the store's back. */
export function freezeGlobal<T extends GlobalValue>(v: T): T { if (typeof v !== 'object' || v === null) return v; const copy = (Array.isArray(v) ? v.map(x => freezeGlobal(x)) : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, freezeGlobal(x)]))) as T; return Object.freeze(copy); }
export const GlobalNameSchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,39}$/, 'Global names use letters, digits and _ and start with a letter');
export const GlobalSchema = z.object({id: z.string().min(1), name: GlobalNameSchema, type: z.enum(globalTypes), initial: GlobalValueSchema}).strict()
 .refine(g => typeOfGlobal(g.initial) === g.type, {message: 'The initial value must match the global’s type', path: ['initial']});
export const GlobalsSchema = z.object({version: z.literal(1), items: z.array(GlobalSchema).max(64)}).strict().superRefine((v, c) => {
 if (new Set(v.items.map(i => i.id)).size !== v.items.length || new Set(v.items.map(i => i.name)).size !== v.items.length) c.addIssue({code: 'custom', message: 'Global names and IDs must be unique'});
});
export type Global = z.infer<typeof GlobalSchema>;
export type Globals = z.infer<typeof GlobalsSchema>;
export const defaultGlobals: Globals = {version: 1, items: []};
export const defaultValue = (type: GlobalType): GlobalValue => type === 'number' ? 0 : type === 'boolean' ? false : type === 'list' ? [] : type === 'object' ? {} : '';
/** How a value reads in texts: integers without decimals, other numbers with at most two, booleans as true/false, lists as "a, b", objects as JSON. */
export const formatGlobal = (v: GlobalValue): string => typeof v === 'number' ? (Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100)) : Array.isArray(v) ? v.map(x => formatGlobal(x)).join(', ') : typeof v === 'object' ? JSON.stringify(v) : String(v);
/** A value inside a list/object global by a dotted path (`player.hp`, `inventory.0`, `inventory.length`). */
export function globalAt(v: GlobalValue | undefined, path: readonly string[]): GlobalValue | undefined {
 let at: GlobalValue | undefined = v;
 for (const part of path) {
  if (at === undefined || typeof at !== 'object') return undefined;
  if (Array.isArray(at)) at = part === 'length' ? at.length : /^\d+$/.test(part) ? at[Number(part)] : undefined;
  else at = Object.prototype.hasOwnProperty.call(at, part) ? (at as Record<string, GlobalValue>)[part] : undefined;
 }
 return at;
}
/** A typed value from a text field ('true'/'false' for booleans, JSON for lists and objects); throws when it does not fit the type. */
export function parseGlobal(type: GlobalType, raw: string): GlobalValue {
 if (type === 'string') return GlobalValueSchema.parse(raw);
 if (type === 'boolean') { if (raw === 'true' || raw === 'false') return raw === 'true'; throw Error('Enter true or false'); }
 if (type === 'list' || type === 'object') {
  let v: unknown; try { v = JSON.parse(raw); } catch { throw Error(type === 'list' ? 'Enter a JSON list, e.g. ["key", 3]' : 'Enter a JSON object, e.g. {"hp": 10}'); }
  if (type === 'list' ? !Array.isArray(v) : !v || typeof v !== 'object' || Array.isArray(v)) throw Error(type === 'list' ? 'Enter a JSON list, e.g. ["key", 3]' : 'Enter a JSON object, e.g. {"hp": 10}');
  const problem = globalValueProblem(v); if (problem) throw Error(problem); return v as GlobalValue;
 }
 const n = Number(raw);
 if (!raw.trim() || !Number.isFinite(n)) throw Error('Enter a finite number');
 return n;
}
/** A list item or field value typed in a text box: JSON when it parses (3, true, "a", [1]), else the text itself. */
export function parseItem(raw: string): GlobalValue { try { const v = JSON.parse(raw); if (globalValueProblem(v) === null) return v as GlobalValue; } catch { /* plain text */ } return raw; }
/** How an item shows in a text box (the inverse of parseItem for text that would parse as something else). */
export const showItem = (v: GlobalValue | undefined) => v === undefined ? '' : typeof v === 'string' ? (parseItem(v) === v ? v : JSON.stringify(v)) : JSON.stringify(v);

export interface GlobalChange {id: string; name: string; value: GlobalValue; previous: GlobalValue; silent: boolean}

/**
 * A play session's globals as RxJS state: every global is a `BehaviorSubject` (`value$` gives its value now and on each
 * change) and `changes$` streams every change; the session turns those into `global.change` interaction events. Values
 * keep their declared type, and writing the current value changes nothing (so it emits nothing).
 */
export class GlobalStore {
 private readonly subjects = new Map<string, BehaviorSubject<GlobalValue>>();
 private readonly definitions = new Map<string, Global>();
 private readonly ids = new Map<string, string>();
 private readonly changed = new Subject<GlobalChange>();
 readonly changes$: Observable<GlobalChange> = this.changed.asObservable();
 constructor(definition: Globals) {
  for (const g of GlobalsSchema.parse(definition).items) { this.definitions.set(g.id, g); this.ids.set(g.name, g.id); this.subjects.set(g.id, new BehaviorSubject<GlobalValue>(freezeGlobal(g.initial))); }
 }
 private definition(id: string) { const g = this.definitions.get(id); if (!g) throw Error('Unknown global'); return g; }
 get list(): readonly Global[] { return [...this.definitions.values()]; }
 get(id: string): GlobalValue { this.definition(id); return this.subjects.get(id)!.value; }
 type(id: string): GlobalType { return this.definition(id).type; }
 set(id: string, value: GlobalValue, silent = false) {
  const g = this.definition(id), subject = this.subjects.get(id)!, previous = subject.value;
  const problem = globalValueProblem(value); if (problem) throw Error(`${g.name}: ${problem}`);
  if (typeOfGlobal(value) !== g.type) throw Error(`${g.name} is a ${g.type}, not a ${typeOfGlobal(value)}`);
  if (sameGlobal(previous, value)) return;
  const next = freezeGlobal(value);
  subject.next(next);
  this.changed.next({id, name: g.name, value: next, previous, silent});
 }
 add(id: string, amount: number, silent = false) { const v = this.get(id); if (typeof v !== 'number') throw Error(`${this.definition(id).name} is not a number`); this.set(id, v + amount, silent); }
 /** Lists: append an item. */
 push(id: string, item: GlobalValue, silent = false) { const v = this.get(id); if (!Array.isArray(v)) throw Error(`${this.definition(id).name} is not a list`); this.set(id, [...v, item], silent); }
 /** Lists: remove the first item equal to this one (nothing when absent). */
 removeItem(id: string, item: GlobalValue, silent = false) { const v = this.get(id); if (!Array.isArray(v)) throw Error(`${this.definition(id).name} is not a list`); const i = v.findIndex(x => sameGlobal(x, item)); if (i >= 0) this.set(id, [...v.slice(0, i), ...v.slice(i + 1)], silent); }
 /** Objects: set (or with undefined, remove) one field. */
 setField(id: string, key: string, value: GlobalValue | undefined, silent = false) { const v = this.get(id); if (!v || typeof v !== 'object' || Array.isArray(v)) throw Error(`${this.definition(id).name} is not an object`); const next: Record<string, GlobalValue> = {...v as Record<string, GlobalValue>}; if (value === undefined) delete next[key]; else next[key] = value; this.set(id, next, silent); }
 toggle(id: string, silent = false) { const v = this.get(id); if (typeof v !== 'boolean') throw Error(`${this.definition(id).name} is not a boolean`); this.set(id, !v, silent); }
 /** The global's value now and on every change. */
 value$(id: string): Observable<GlobalValue> { this.definition(id); return this.subjects.get(id)!.asObservable(); }
 idOf(name: string) { return this.ids.get(name); }
 byName = (name: string): GlobalValue | undefined => { const id = this.ids.get(name); return id === undefined ? undefined : this.subjects.get(id)!.value; };
 /** Values by name (text templates, localized strings). */
 snapshot(): Record<string, GlobalValue> { return Object.fromEntries([...this.definitions.values()].map(g => [g.name, this.subjects.get(g.id)!.value])); }
 /** Values by ID (save slot). */
 values(): Record<string, GlobalValue> { return Object.fromEntries([...this.subjects].map(([id, s]) => [id, s.value])); }
 /** Puts saved values back: unknown IDs and values of another type are skipped; each change is reported. */
 restore(saved: Record<string, unknown>, silent = false) {
  for (const [id, value] of Object.entries(saved)) {
   const g = this.definitions.get(id), parsed = GlobalValueSchema.safeParse(value);
   if (g && parsed.success && typeOfGlobal(parsed.data) === g.type) this.set(id, parsed.data, silent);
  }
 }
 dispose() { this.changed.complete(); for (const s of this.subjects.values()) s.complete(); }
}
