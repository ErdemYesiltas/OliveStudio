import {analyzeWorkflow, type Workflow} from './contracts';

/**
 * ComfyUI UI-format workflow (what the ComfyUI app saves: litegraph `nodes` + `links`, subgraphs under
 * `definitions.subgraphs`) → API format (what `/prompt` runs). Which inputs are widgets, their order, dynamic combos and
 * defaults come from the server's `/object_info`, exactly as the ComfyUI frontend uses it. Pure: no network.
 *
 * Handled: subgraphs (nested, promoted widget values on the instance), muted (dropped) and bypassed (passed through by
 * type) nodes, Reroute, legacy PrimitiveNode, GetNode/SetNode, notes, control_after_generate companions, V3 dynamic
 * combos. Reported, not guessed: node types the server lacks, paid API nodes and model files that are not installed.
 */

type Spec = readonly unknown[];
type Section = Record<string, Spec>;
export interface NodeSchema {input?: {required?: Section; optional?: Section}; input_order?: {required?: string[]; optional?: string[]}; output?: unknown[]; display_name?: string; api_node?: boolean; output_node?: boolean}
export type ObjectInfo = Record<string, NodeSchema>;
export interface ConversionReport {workflow: Workflow; missingNodes: string[]; paidNodes: string[]; missingModels: {node: string; input: string; value: string}[]}

interface UiInput {name?: string; link?: unknown; type?: unknown; widget?: unknown}
interface UiNode {id?: unknown; type?: unknown; mode?: unknown; title?: unknown; inputs?: unknown; outputs?: unknown; widgets_values?: unknown}
interface SubgraphDef {id: string; nodes?: unknown; links?: unknown; inputs?: {name?: string; type?: unknown; linkIds?: unknown[]}[]; outputs?: unknown[]}
interface Node {id: string; type: string; mode: number; title?: string; inputs: {name: string; link: string | null; type: string; widget: boolean}[]; outputs: string[]; widgets: unknown; overrides: Record<string, unknown>}
interface Link {origin: string; slot: number}

const muted = 2, bypassed = 4, uiOnly = new Set(['Note', 'MarkdownNote', 'PrimitiveNode', 'Reroute', 'GetNode', 'SetNode']);
const controls = new Set(['fixed', 'increment', 'decrement', 'randomize']), widgetTypes = new Set(['INT', 'FLOAT', 'STRING', 'BOOLEAN', 'COMBO']);
const modelFile = /\.(safetensors|ckpt|pt|pth|bin|gguf|sft|onnx)$/i;
const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/** True for a ComfyUI UI/app save (as opposed to an "Export (API)" file). */
export function isUiWorkflow(json: unknown): json is {nodes: unknown[]; links: unknown[]} {
 return isObject(json) && Array.isArray(json.nodes) && Array.isArray(json.links);
}

const options = (spec: Spec | undefined) => (spec && isObject(spec[1]) ? spec[1] : {}) as Record<string, unknown>;
/** [isWidget, isDynamicCombo] for an INPUT_TYPES entry, as the frontend decides which inputs own a widget value. */
function widgetKind(spec: Spec | undefined): [boolean, boolean] {
 if (!Array.isArray(spec) || !spec.length) return [false, false];
 const o = options(spec), type = spec[0];
 if (o.forceInput || o.defaultInput) return [false, false];
 if (typeof o.widgetType === 'string' && o.widgetType) return [true, false];
 if (o.socketless || Array.isArray(type)) return [true, false];
 if (typeof type !== 'string') return [false, false];
 if (widgetTypes.has(type)) return [true, false];
 if (type.startsWith('COMFY_') && type.includes('COMBO')) return [true, true];
 return [false, false];
}
const comboOptions = (spec: Spec | undefined): unknown[] | undefined => !spec ? undefined : Array.isArray(spec[0]) ? spec[0] : spec[0] === 'COMBO' && Array.isArray(options(spec).options) ? options(spec).options as unknown[] : undefined;
const dynamicKeys = (spec: Spec | undefined) => ((options(spec).options as {key?: unknown}[] | undefined) ?? []).map(o => o?.key);
function dynamicSubs(name: string, spec: Spec, selected: unknown): [string, Spec][] {
 const option = ((options(spec).options as {key?: unknown; inputs?: {required?: Section; optional?: Section}}[] | undefined) ?? []).find(o => o?.key === selected);
 if (!option || !isObject(option.inputs)) return [];
 return (['required', 'optional'] as const).flatMap(s => Object.entries(option.inputs?.[s] ?? {}).map(([sub, subSpec]): [string, Spec] => [`${name}.${sub}`, subSpec]));
}
function orderedInputs(schema: NodeSchema): [string, Spec][] {
 return (['required', 'optional'] as const).flatMap(section => {
  const def = schema.input?.[section] ?? {}, listed = (schema.input_order?.[section] ?? []).filter(n => n in def);
  return [...listed, ...Object.keys(def).filter(n => !listed.includes(n))].map((n): [string, Spec] => [n, def[n]]);
 });
}
/** Whether a control keyword after a seed-like INT is its control_after_generate companion (not the next widget's value). */
function isCompanion(name: string, spec: Spec, value: unknown, next: Spec | undefined, strict: boolean) {
 if (typeof value !== 'string' || !controls.has(value)) return false;
 const flag = options(spec).control_after_generate;
 if (flag !== undefined && flag !== null) return Boolean(flag);
 if (spec[0] !== 'INT') return false;
 const listed = comboOptions(next)?.includes(value) || dynamicKeys(next).includes(value);
 if (name === 'seed' || name === 'noise_seed') return strict || !listed;
 if (!name.toLowerCase().includes('seed')) return false;
 return !next || ['INT', 'FLOAT', 'BOOLEAN'].includes(next[0] as string) || ((comboOptions(next) || widgetKind(next)[1]) && !listed);
}
/** Pairs a schema's widget inputs with the positional `widgets_values` (dynamic combo sub-inputs follow their selector). */
function widgetPairs(schema: NodeSchema, values: unknown[]): [string, unknown][] {
 const ordered = orderedInputs(schema), nextWidget = (list: [string, Spec][], from: number) => list.slice(from).find(([, s]) => widgetKind(s)[0])?.[1];
 const walk = (strict: boolean) => {
  const pairs: [string, unknown][] = [];
  let index = 0, short = false;
  const consume = (name: string, spec: Spec, next: Spec | undefined, depth: number) => {
   const [widget, dynamic] = widgetKind(spec);
   if (!widget) return;
   if (index >= values.length) { short = true; return; }
   const value = values[index++];
   pairs.push([name, value]);
   if (dynamic && depth < 16) { const subs = dynamicSubs(name, spec, value); subs.forEach(([n, s], i) => consume(n, s, nextWidget(subs, i + 1) ?? next, depth + 1)); }
   else if (index < values.length && isCompanion(name, spec, values[index], next, strict)) index++;
  };
  ordered.forEach(([n, s], i) => consume(n, s, nextWidget(ordered, i + 1), 0));
  return {pairs, exact: !short && index === values.length};
 };
 const strict = walk(true);
 return strict.exact ? strict.pairs : walk(false).pairs;
}
const defaultOf = (spec: Spec): {value: unknown} | undefined => {
 const o = options(spec);
 if ('default' in o) return {value: o.default};
 const combo = comboOptions(spec);
 return combo?.length ? {value: combo[0]} : undefined;
};
/**
 * The frontend's `{a|b|c}` choice syntax for `dynamicPrompts` inputs (comments stripped, one option picked per group,
 * nested groups resolved, `\\{ \\} \\|` escapes). The server does not process it, so a saved template relies on it.
 */
export function dynamicPrompt(value: string, random: () => number = Math.random): string {
 const resolve = (text: string): string => {
  let out = '', i = 0;
  while (i < text.length) {
   const ch = text[i++];
   if (ch === '\\' && i < text.length) { out += ch + text[i++]; continue; }
   if (ch !== '{') { out += ch; continue; }
   const choices: string[] = [];
   let choice = '', depth = 0;
   while (i < text.length) {
    const c = text[i++];
    if (c === '\\' && i < text.length) { choice += c + text[i++]; continue; }
    if (c === '{') depth++;
    else if (c === '}') { if (!depth) break; depth--; }
    else if (c === '|' && !depth) { choices.push(choice); choice = ''; continue; }
    choice += c;
   }
   choices.push(choice);
   out += resolve(choices[Math.min(choices.length - 1, Math.floor(random() * choices.length))]);
  }
  return out.replace(/\\([{}|])/g, '$1');
 };
 return resolve(value.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, ''));
}
/** Lists stay values, never `[node, slot]` links (the executor unwraps `__value__`). */
const wrap = (value: unknown) => Array.isArray(value) ? {__value__: value} : value;

function readNode(raw: UiNode, id: string): Node | null {
 if (typeof raw.type !== 'string' || !raw.type) return null;
 const inputs = (Array.isArray(raw.inputs) ? raw.inputs as UiInput[] : []).filter(isObject).map(i => ({name: String(i.name ?? ''), link: i.link === null || i.link === undefined ? null : String(i.link), type: String(i.type ?? '*'), widget: Boolean(i.widget)}));
 const outputs = (Array.isArray(raw.outputs) ? raw.outputs : []).map(o => String(isObject(o) ? o.type ?? '*' : '*'));
 return {id, type: raw.type, mode: typeof raw.mode === 'number' ? raw.mode : 0, title: typeof raw.title === 'string' ? raw.title : undefined, inputs, outputs, widgets: raw.widgets_values, overrides: {}};
}
/** Links come as arrays `[id, origin, slot, target, slot, type]` (top level) or objects (subgraphs). */
function readLink(raw: unknown): {id: string; origin: number | string; slot: number; target: number | string; targetSlot: number} | null {
 if (Array.isArray(raw) && raw.length >= 5) return {id: String(raw[0]), origin: raw[1] as number, slot: Number(raw[2]) || 0, target: raw[3] as number, targetSlot: Number(raw[4]) || 0};
 if (isObject(raw) && raw.id !== undefined) return {id: String(raw.id), origin: raw.origin_id as number, slot: Number(raw.origin_slot) || 0, target: raw.target_id as number, targetSlot: Number(raw.target_slot) || 0};
 return null;
}
/**
 * Which subgraph inputs are widget-backed (the frontend's rule: the first boundary link that lands on a widget input,
 * or on a nested instance's widget-backed input). Only those own a positional slot in the instance's widgets_values.
 */
function promotedWidgets(def: SubgraphDef, defs: Map<string, SubgraphDef>, depth = 0): boolean[] {
 const nodes = new Map((Array.isArray(def.nodes) ? def.nodes as UiNode[] : []).filter(isObject).map(n => [String(n.id), n]));
 const links = new Map((Array.isArray(def.links) ? def.links : []).map(readLink).filter(l => l !== null).map(l => [l.id, l]));
 return (def.inputs ?? []).map(input => (input?.linkIds ?? []).some(id => {
  const link = links.get(String(id)), target = link ? nodes.get(String(link.target)) : undefined;
  const entry = target && Array.isArray(target.inputs) ? target.inputs[link!.targetSlot] as UiInput | undefined : undefined;
  if (!target || !isObject(entry)) return false;
  const nested = defs.get(String(target.type));
  if (nested) { if (depth >= 10) return false; const i = (nested.inputs ?? []).findIndex(x => x?.name === entry.name); return i >= 0 && promotedWidgets(nested, defs, depth + 1)[i]; }
  return Boolean(entry.widget);
 }));
}
/** The instance's own values for its widget-backed inputs: an outer override (nested instance) or its widgets_values slot. */
function hostValues(def: SubgraphDef, instance: Node, defs: Map<string, SubgraphDef>): Map<number, unknown> {
 const out = new Map<number, unknown>(), values = Array.isArray(instance.widgets) ? instance.widgets : [];
 let slot = 0;
 promotedWidgets(def, defs).forEach((widget, i) => {
  const name = String(def.inputs?.[i]?.name ?? '');
  if (name in instance.overrides) out.set(i, instance.overrides[name]);
  else if (widget && slot < values.length) out.set(i, values[slot]);
  if (widget) slot++;
 });
 return out;
}

function expand(graph: {nodes: Map<string, Node>; links: Map<string, Link>}, instance: Node, def: SubgraphDef, defs: Map<string, SubgraphDef>) {
 const p = instance.id, inner = (id: unknown) => `${p}:${id}`, key = (id: string) => `${p}#${id}`, host = hostValues(def, instance, defs);
 const innerLinks = (Array.isArray(def.links) ? def.links : []).map(readLink).filter(l => l !== null);
 const innerNodes = (Array.isArray(def.nodes) ? def.nodes as UiNode[] : []).filter(isObject).map(n => readNode(n, inner(n.id))).filter(n => n !== null);
 const byId = new Map(innerNodes.map(n => [n.id, n]));
 /** Where subgraph input i comes from outside: an outer link, or the instance's widget value. */
 const inputSource = (i: number): {link: Link} | {value: unknown} | null => {
  const name = def.inputs?.[i]?.name, outer = instance.inputs.find(x => x.name === name);
  const link = outer?.link ? graph.links.get(outer.link) : undefined;
  if (link) return {link};
  return host.has(i) ? {value: host.get(i)} : null;
 };
 const outputs = new Map<number, Link>();
 for (const l of innerLinks) {
  if (l.target === -20) {
   if (l.origin === -10) { const source = inputSource(l.slot); if (source && 'link' in source) outputs.set(l.targetSlot, source.link); }
   else outputs.set(l.targetSlot, {origin: inner(l.origin), slot: l.slot});
   continue;
  }
  if (l.origin === -10) {
   const source = inputSource(l.slot), target = byId.get(inner(l.target)), input = target?.inputs.find(x => x.link === l.id);
   if (source && 'link' in source) graph.links.set(key(l.id), source.link);
   else if (target && input) { input.link = null; if (source && (input.widget || defs.has(target.type))) target.overrides[input.name] = source.value; }
   continue;
  }
  graph.links.set(key(l.id), {origin: inner(l.origin), slot: l.slot});
 }
 for (const n of innerNodes) { for (const input of n.inputs) if (input.link !== null) input.link = graph.links.has(key(input.link)) ? key(input.link) : null; graph.nodes.set(n.id, n); }
 for (const [id, link] of graph.links) if (link.origin === p) { const to = outputs.get(link.slot); if (to) graph.links.set(id, to); else graph.links.delete(id); }
 graph.nodes.delete(p);
}

/** Converts a UI-format workflow; throws only for input that is not a workflow at all. */
export function uiToApi(ui: unknown, info: ObjectInfo, random: () => number = Math.random): ConversionReport {
 if (!isUiWorkflow(ui)) throw Error('Not a ComfyUI workflow (expected nodes and links)');
 const defs = new Map<string, SubgraphDef>();
 const definitions = (ui as {definitions?: {subgraphs?: unknown}}).definitions;
 for (const d of Array.isArray(definitions?.subgraphs) ? definitions.subgraphs : []) if (isObject(d) && typeof d.id === 'string') defs.set(d.id, d as unknown as SubgraphDef);
 const graph = {nodes: new Map<string, Node>(), links: new Map<string, Link>()};
 for (const raw of ui.nodes) { if (!isObject(raw)) continue; const node = readNode(raw, String(raw.id)); if (node) graph.nodes.set(node.id, node); }
 for (const raw of ui.links) { const l = readLink(raw); if (l) graph.links.set(l.id, {origin: String(l.origin), slot: l.slot}); }
 for (let round = 0; round < 10; round++) {
  const instances = [...graph.nodes.values()].filter(n => defs.has(n.type) && n.mode !== muted && n.mode !== bypassed);
  if (!instances.length) break;
  for (const n of instances) expand(graph, n, defs.get(n.type)!, defs);
 }
 const setters = new Map<string, string | null>();
 for (const n of graph.nodes.values()) if (n.type === 'SetNode' && Array.isArray(n.widgets)) setters.set(String(n.widgets[0]), n.inputs[0]?.link ?? null);

 /** Follows a link through UI-only and bypassed nodes to a real output, or a literal value. */
 const resolve = (linkId: string | null): {link: Link} | {value: unknown} | null => {
  let link = linkId === null ? undefined : graph.links.get(linkId);
  for (let depth = 0; link && depth < 100; depth++) {
   const node = graph.nodes.get(link.origin);
   if (!node || node.mode === muted) return null;
   if (node.type === 'PrimitiveNode') return Array.isArray(node.widgets) && node.widgets.length ? {value: node.widgets[0]} : null;
   let next: string | null | undefined;
   if (node.type === 'Reroute') next = node.inputs[0]?.link;
   else if (node.type === 'GetNode') next = Array.isArray(node.widgets) ? setters.get(String(node.widgets[0])) : null;
   else if (node.type === 'SetNode') next = node.inputs[0]?.link;
   else if (node.mode === bypassed || defs.has(node.type)) {
    const type = node.outputs[link.slot], fits = (t: string) => !type || type === '*' || t === '*' || t.split(',').includes(type) || type.split(',').includes(t);
    const linked = node.inputs.filter(i => i.link !== null && graph.links.has(i.link));
    const same = node.inputs[link.slot];
    next = (same?.link && graph.links.has(same.link) && fits(same.type) ? same : linked.find(i => i.type === type) ?? linked.find(i => fits(i.type)))?.link;
   } else return {link};
   link = next ? graph.links.get(next) : undefined;
  }
  return null;
 };

 const workflow: Workflow = {}, missingNodes = new Set<string>(), paidNodes = new Set<string>(), missingModels: ConversionReport['missingModels'] = [];
 for (const node of graph.nodes.values()) {
  if (node.mode === muted || node.mode === bypassed || uiOnly.has(node.type) || defs.has(node.type)) continue;
  const schema = info[node.type];
  if (!schema) { missingNodes.add(node.type); continue; }
  if (schema.api_node) paidNodes.add(schema.display_name ?? node.type);
  const inputs: Record<string, unknown> = {}, linked = new Set<string>();
  if (isObject(node.widgets)) { for (const [k, v] of Object.entries(node.widgets)) if (!['videopreview', 'preview'].includes(k)) inputs[k] = wrap(v); }
  else if (Array.isArray(node.widgets)) for (const [name, value] of widgetPairs(schema, node.widgets)) {
   const spec = schema.input?.required?.[name] ?? schema.input?.optional?.[name];
   inputs[name] = wrap(typeof value === 'string' && options(spec).dynamicPrompts ? dynamicPrompt(value, random) : value);
  }
  for (const [name, value] of Object.entries(node.overrides)) inputs[name] = wrap(value);
  for (const input of node.inputs) {
   if (input.link === null) continue;
   const source = resolve(input.link);
   if (!source) continue;
   inputs[input.name] = 'value' in source ? wrap(source.value) : [source.link.origin, source.link.slot];
   linked.add(input.name);
  }
  for (const [name, spec] of orderedInputs(schema)) {
   if (!(name in inputs)) { const d = defaultOf(spec); if (d) inputs[name] = wrap(d.value); else if (options(spec).socketless && !options(spec).forceInput && name in (schema.input?.required ?? {})) inputs[name] = null; }
   const allowed = comboOptions(spec), value = inputs[name];
   if (!allowed?.length || typeof value !== 'string' || linked.has(name) || allowed.includes(value)) continue;
   const match = allowed.find(o => typeof o === 'string' && o.toLowerCase() === value.toLowerCase());
   if (match !== undefined) inputs[name] = match;
   else if (modelFile.test(value)) missingModels.push({node: node.title ?? schema.display_name ?? node.type, input: name, value});
  }
  workflow[node.id] = {class_type: node.type, inputs, _meta: {title: node.title ?? schema.display_name ?? node.type}};
 }
 for (const node of Object.values(workflow)) for (const [name, value] of Object.entries(node.inputs)) if (Array.isArray(value) && value.length === 2 && typeof value[0] === 'string' && !(value[0] in workflow)) delete node.inputs[name];
 // Like the server, keep only what an output node needs: a stray loader (an unused LoadImage) must not count as an input.
 const outputs = Object.keys(workflow).filter(id => info[workflow[id].class_type]?.output_node);
 if (outputs.length) {
  const keep = new Set<string>(), stack = [...outputs];
  while (stack.length) { const id = stack.pop()!; if (keep.has(id) || !workflow[id]) continue; keep.add(id); for (const v of Object.values(workflow[id].inputs)) if (Array.isArray(v) && v.length === 2 && typeof v[0] === 'string') stack.push(v[0]); }
  for (const id of Object.keys(workflow)) if (!keep.has(id)) delete workflow[id];
 }
 return {workflow, missingNodes: [...missingNodes].sort(), paidNodes: [...paidNodes].sort(), missingModels};
}

/** An entry of the "From ComfyUI" list: a workflow saved in ComfyUI or an installed template. */
export type {LibraryEntry as LibraryItem} from './contracts';
/** Why a converted workflow cannot run from the editor as it is (empty: ready). */
export function libraryProblems(report: ConversionReport): string[] {
 const problems: string[] = [];
 if (report.paidNodes.length) problems.push(`Paid API nodes: ${report.paidNodes.join(', ')}`);
 if (report.missingNodes.length) problems.push(`Custom nodes not installed: ${report.missingNodes.join(', ')}`);
 const models = [...new Set(report.missingModels.map(m => m.value))];
 if (models.length) problems.push(`Missing ${models.length === 1 ? 'model' : 'models'}: ${models.join(', ')}`);
 const nodes = Object.values(report.workflow);
 if (!Object.keys(report.workflow).length || !analyzeWorkflow(report.workflow).outputs.length) problems.push('Saves no image, sound or video');
 if (nodes.filter(n => n.class_type === 'LoadImage').length > 1) problems.push('Needs more than one input image');
 if (nodes.some(n => /^Load(Audio|Video|3D|ImageMask|ImageOutput|Image\w*DataSet|Latent|TrainingDataset)/.test(n.class_type))) problems.push('Needs an input file the editor cannot provide');
 return problems;
}
