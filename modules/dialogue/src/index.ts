import {z} from 'zod';
import {ConditionSchema, GlobalValueSchema, conditionHolds, formatTemplate, type ActionDefinition, type GlobalStore, type InteractionEvent, type TriggerDefinition} from '@rewrite/interactions';

/**
 * Branching dialogue. Dialogues live in the project (`dialogue.library`); each is a list of lines (speaker, text with
 * `{global}` templates) that either continue to another line or offer choices (shown only while their condition
 * holds). Entering a line can set a global and fire a named event. Rules start dialogues and react to their events and
 * end; scripts drive them through `game.dialogue` and hear them in `onDialogue(self, event, dialogue)`.
 */
export const dialogueSection = 'dialogue.library';
const Id = z.string().min(1).max(64);
export const ChoiceSchema = z.object({id: Id, text: z.string().max(400), next: z.string().max(64), condition: ConditionSchema.optional()}).strict();
export const LineSchema = z.object({
 id: Id, speaker: z.string().max(60), text: z.string().max(2000),
 /** Line to continue to when there are no choices ('' ends the dialogue). */
 next: z.string().max(64),
 choices: z.array(ChoiceSchema).max(8),
 /** Assign a global when the line is shown. */
 set: z.object({globalId: Id, value: GlobalValueSchema}).strict().optional(),
 /** Event name fired when the line is shown (rules: Dialogue event; scripts: onDialogue). */
 event: z.string().max(40).regex(/^[\w .-]*$/),
}).strict();
export const DialogueSchema = z.object({id: Id, name: z.string().trim().min(1).max(80), start: z.string().max(64), lines: z.array(LineSchema).max(500)}).strict()
 .refine(d => new Set(d.lines.map(l => l.id)).size === d.lines.length, {message: 'Line IDs must be unique'});
export const DialogueLibrarySchema = z.object({version: z.literal(1), items: z.array(DialogueSchema).max(200)}).strict()
 .refine(v => new Set(v.items.map(i => i.id)).size === v.items.length, {message: 'Dialogue IDs must be unique'});
export type Choice = z.infer<typeof ChoiceSchema>;
export type Line = z.infer<typeof LineSchema>;
export type Dialogue = z.infer<typeof DialogueSchema>;
export type DialogueLibrary = z.infer<typeof DialogueLibrarySchema>;
export const emptyDialogueLibrary = (): DialogueLibrary => ({version: 1, items: []});
export const readLibrary = (value: unknown): DialogueLibrary => { const p = DialogueLibrarySchema.safeParse(value ?? emptyDialogueLibrary()); return p.success ? p.data : emptyDialogueLibrary(); };
export const newLine = (id: string, text = ''): Line => ({id, speaker: '', text, next: '', choices: [], event: ''});

/** Problems an author should fix: missing start, links to missing lines, lines nobody reaches. */
export function dialogueProblems(d: Dialogue): string[] {
 const ids = new Set(d.lines.map(l => l.id)), out: string[] = [];
 if (!d.lines.length) return ['The dialogue has no lines'];
 if (!ids.has(d.start)) out.push('Choose the first line');
 for (const [i, l] of d.lines.entries()) {
  if (l.next && !ids.has(l.next)) out.push(`Line ${i + 1}: “then” points to a missing line`);
  for (const c of l.choices) if (c.next && !ids.has(c.next)) out.push(`Line ${i + 1}: a choice points to a missing line`);
 }
 const seen = new Set<string>(), queue = ids.has(d.start) ? [d.start] : [];
 while (queue.length) { const id = queue.pop()!; if (seen.has(id)) continue; seen.add(id); const l = d.lines.find(x => x.id === id)!; for (const n of [l.next, ...l.choices.map(c => c.next)]) if (n && ids.has(n)) queue.push(n); }
 for (const [i, l] of d.lines.entries()) if (!seen.has(l.id)) out.push(`Line ${i + 1} is never reached`);
 return out;
}
export const dialogueEvents = (d: Dialogue) => [...new Set(d.lines.map(l => l.event).filter(Boolean))];

export interface DialogueView {dialogueId: string; dialogue: string; lineId: string; speaker: string; text: string; choices: {index: number; text: string}[]}
export interface DialogueHost {
 library(): DialogueLibrary;
 globals(): GlobalStore | undefined;
 emit(event: InteractionEvent): void;
 silent(): boolean;
 /** Localize a text (string keys) before templates; defaults to the text itself. */
 localize?(key: string, count?: number): string | undefined;
}
/** One open dialogue at a time; `changes` tells the box to redraw. */
export class DialogueSession {
 private host: DialogueHost;
 private open: {dialogue: Dialogue; line: Line; choices: Choice[]} | null = null;
 private listeners = new Set<(view: DialogueView | null) => void>();
 constructor(host: DialogueHost) { this.host = host; }
 /** The line on screen, or null. */
 view(): DialogueView | null {
  const o = this.open; if (!o) return null;
  return {dialogueId: o.dialogue.id, dialogue: o.dialogue.name, lineId: o.line.id, speaker: this.format(o.line.speaker), text: this.format(o.line.text), choices: o.choices.map((c, index) => ({index, text: this.format(c.text)}))};
 }
 subscribe(listener: (view: DialogueView | null) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
 private format(text: string) { const g = this.host.globals(); return formatTemplate(text, name => g?.byName(name), this.host.localize); }
 private find(idOrName: string) { const items = this.host.library().items; return items.find(d => d.id === idOrName) ?? items.find(d => d.name === idOrName); }
 /** Opens a dialogue (by ID or name) at its first line; an open one is replaced without its end event. */
 start(idOrName: string) {
  const d = this.find(idOrName); if (!d) throw Error(`Unknown dialogue: ${idOrName}`);
  const first = d.lines.find(l => l.id === d.start) ?? d.lines[0]; if (!first) throw Error(`Dialogue ${d.name} has no lines`);
  this.open = null; this.enter(d, first);
 }
 /** Continues a line without choices (to its next line, or the end). */
 advance() { const o = this.open; if (!o || o.choices.length) return; this.go(o.dialogue, o.line.next); }
 choose(index: number) { const o = this.open, c = o?.choices[index]; if (!o || !c) return; this.go(o.dialogue, c.next); }
 /** Closes the dialogue (fires its end). */
 stop() { const o = this.open; if (o) this.end(o.dialogue); }
 dispose() { this.open = null; this.listeners.clear(); }
 private go(d: Dialogue, next: string) { const line = next ? d.lines.find(l => l.id === next) : undefined; if (line) this.enter(d, line); else this.end(d); }
 private enter(d: Dialogue, line: Line) {
  const g = this.host.globals();
  if (line.set && g) { try { g.set(line.set.globalId, line.set.value, this.host.silent()); } catch { /* a removed or retyped global: skip the assignment */ } }
  const choices = line.choices.filter(c => !c.condition || (g ? conditionHolds(c.condition, g) : false));
  this.open = {dialogue: d, line, choices};
  this.publish();
  if (line.event) this.host.emit({type: 'dialogue.event', sourceId: d.id, event: line.event, silent: this.host.silent()});
 }
 private end(d: Dialogue) { this.open = null; this.publish(); this.host.emit({type: 'dialogue.end', sourceId: d.id, silent: this.host.silent()}); }
 private publish() { const v = this.view(); for (const l of [...this.listeners]) l(v); }
}

/** What scripts can do with dialogues. */
export interface DialogueControls {start(idOrName: string): void; advance(): void; choose(index: number): void; stop(): void; view(): DialogueView | null}
const refs = (library: () => DialogueLibrary) => () => library().items.map(d => ({id: d.id, name: d.name}));
export const dialogueTriggers = (library: () => DialogueLibrary): TriggerDefinition[] => [
 {type: 'dialogue.end', titleKey: 'interaction.dialogueEnd', projectReference: true, references: refs(library)},
 {type: 'dialogue.event', titleKey: 'interaction.dialogueEvent', projectReference: true, references: () => library().items.map(d => ({id: d.id, name: d.name, events: dialogueEvents(d).map(e => ({id: e, name: e}))}))},
];
export const dialogueActions = (library: () => DialogueLibrary, controls: () => DialogueControls | undefined): ActionDefinition[] => {
 const live = () => { const c = controls(); if (!c) throw Error('Dialogues are not running'); return c; };
 return [
  {type: 'dialogue.start', titleKey: 'interaction.dialogueStart', projectReference: true, references: refs(library), execute: a => live().start(a.targetId)},
  {type: 'dialogue.stop', titleKey: 'interaction.dialogueStop', projectReference: true, references: () => [{id: 'dialogue', name: 'Open dialogue'}], execute: () => live().stop()},
 ];
};
