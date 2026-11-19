import {z} from 'zod';
import type {RuntimeSystem} from '@rewrite/sdk';
import {ConditionSchema, conditionHolds, type ActionDefinition, type GlobalStore, type InteractionEvent, type TriggerDefinition} from '@rewrite/interactions';

/**
 * Achievements and leaderboards. Defined in the project (`achievements`); progress lives on the player's device
 * (browser storage in exported games, memory in Preview) behind an `AchievementStore`, so an online service (the Hub)
 * can replace it later. An achievement unlocks from a rule, a script, or by itself when its condition on a global
 * holds; leaderboards keep the best ten scores.
 */
export const achievementsSection = 'achievements';
const Id = z.string().min(1).max(64);
export const AchievementSchema = z.object({id: Id, name: z.string().trim().min(1).max(80), description: z.string().max(300), hidden: z.boolean(), condition: ConditionSchema.optional()}).strict();
export const LeaderboardSchema = z.object({id: Id, name: z.string().trim().min(1).max(80), order: z.enum(['high', 'low']), globalId: z.string().max(64)}).strict();
export const AchievementsSchema = z.object({version: z.literal(1), items: z.array(AchievementSchema).max(200), boards: z.array(LeaderboardSchema).max(50)}).strict()
 .refine(v => new Set([...v.items, ...v.boards].map(i => i.id)).size === v.items.length + v.boards.length, {message: 'IDs must be unique'});
export type Achievement = z.infer<typeof AchievementSchema>;
export type Leaderboard = z.infer<typeof LeaderboardSchema>;
export type Achievements = z.infer<typeof AchievementsSchema>;
export const emptyAchievements = (): Achievements => ({version: 1, items: [], boards: []});
export const readAchievements = (value: unknown): Achievements => { const p = AchievementsSchema.safeParse(value ?? emptyAchievements()); return p.success ? p.data : emptyAchievements(); };
export interface Score {name: string; score: number; at: number}
export interface Progress {unlocked: Record<string, number>; boards: Record<string, Score[]>}
const ProgressSchema = z.object({unlocked: z.record(z.string(), z.number()), boards: z.record(z.string(), z.array(z.object({name: z.string().max(40), score: z.number().finite(), at: z.number()}).strict()).max(10))}).strict();
/** Where progress is kept. Exported games: localStorage; Preview: memory; later: an online service. */
export interface AchievementStore {read(): Progress | null; write(progress: Progress): void}
export const storageStore = (key: string, storage: Pick<Storage, 'getItem' | 'setItem'> | undefined): AchievementStore => ({
 read: () => { try { const raw = storage?.getItem(key); const p = raw ? ProgressSchema.safeParse(JSON.parse(raw)) : null; return p?.success ? p.data : null; } catch { return null; } },
 write: progress => { try { storage?.setItem(key, JSON.stringify(progress)); } catch { /* storage full or blocked: progress stays for this session */ } },
});
export const memoryStore = (): AchievementStore & {clear(): void} => { let saved: Progress | null = null; return {read: () => saved && structuredClone(saved), write: p => { saved = structuredClone(p); }, clear: () => { saved = null; }}; };
export interface AchievementControls {unlock(idOrName: string): boolean; unlocked(idOrName: string): boolean; submit(boardIdOrName: string, score: number, name?: string): number; top(boardIdOrName: string): Score[]; list(): {id: string; name: string; unlocked: boolean}[]}
export interface AchievementHost {library(): Achievements; store: AchievementStore; globals(): GlobalStore | undefined; emit(event: InteractionEvent): void; silent(): boolean; unlocked?(achievement: Achievement): void}
export class AchievementSession implements AchievementControls {
 readonly system: RuntimeSystem;
 private host: AchievementHost;
 private progress: Progress;
 constructor(host: AchievementHost) {
  this.host = host; this.progress = host.store.read() ?? {unlocked: {}, boards: {}};
  this.system = {id: 'achievements', update: () => this.check(), dispose() {}};
 }
 private item(key: string) { const items = this.host.library().items; return items.find(a => a.id === key) ?? items.find(a => a.name === key); }
 private board(key: string) { const boards = this.host.library().boards; return boards.find(b => b.id === key) ?? boards.find(b => b.name === key); }
 /** Unlocks once; returns false when it already was. */
 unlock(key: string) {
  const a = this.item(key); if (!a) throw Error(`Unknown achievement: ${key}`);
  if (this.progress.unlocked[a.id]) return false;
  this.progress.unlocked[a.id] = Date.now(); this.host.store.write(this.progress);
  this.host.unlocked?.(a); this.host.emit({type: 'achievement.unlocked', sourceId: a.id, silent: this.host.silent()});
  return true;
 }
 unlocked(key: string) { const a = this.item(key); return Boolean(a && this.progress.unlocked[a.id]); }
 list() { return this.host.library().items.map(a => ({id: a.id, name: a.name, unlocked: Boolean(this.progress.unlocked[a.id])})); }
 /** Records a score; returns its rank (1-based) or 0 when it did not make the top ten. */
 submit(key: string, score: number, name = 'Player') {
  const b = this.board(key); if (!b) throw Error(`Unknown leaderboard: ${key}`);
  if (!Number.isFinite(score)) throw TypeError('Expected a finite score');
  const entry = {name: name.trim().slice(0, 40) || 'Player', score, at: Date.now()};
  const list = [...this.progress.boards[b.id] ?? [], entry].sort((x, y) => (b.order === 'high' ? y.score - x.score : x.score - y.score) || x.at - y.at).slice(0, 10);
  this.progress.boards[b.id] = list; this.host.store.write(this.progress);
  return list.indexOf(entry) + 1;
 }
 top(key: string) { const b = this.board(key); if (!b) throw Error(`Unknown leaderboard: ${key}`); return (this.progress.boards[b.id] ?? []).map(s => ({...s})); }
 /** Unlocks achievements whose condition now holds (every frame; cheap). */
 check() {
  const g = this.host.globals(); if (!g) return;
  for (const a of this.host.library().items) if (a.condition && !this.progress.unlocked[a.id]) { try { if (conditionHolds(a.condition, g)) this.unlock(a.id); } catch { /* a removed global */ } }
 }
}
const items = (lib: () => Achievements) => () => lib().items.map(a => ({id: a.id, name: a.name}));
export const achievementTriggers = (lib: () => Achievements): TriggerDefinition[] => [{type: 'achievement.unlocked', titleKey: 'interaction.achievementUnlocked', projectReference: true, references: items(lib)}];
export const achievementActions = (lib: () => Achievements, controls: () => AchievementControls | undefined): ActionDefinition[] => {
 const live = () => { const c = controls(); if (!c) throw Error('Achievements are not running'); return c; };
 return [
  {type: 'achievement.unlock', titleKey: 'interaction.achievementUnlock', projectReference: true, references: items(lib), execute: a => { live().unlock(a.targetId); }},
  {type: 'leaderboard.submit', titleKey: 'interaction.leaderboardSubmit', projectReference: true, references: () => lib().boards.map(b => ({id: b.id, name: b.name})), execute: (a, c) => { const b = lib().boards.find(x => x.id === a.targetId); const v = b?.globalId ? c.globals?.get(b.globalId) : undefined; if (typeof v !== 'number') throw Error('The leaderboard needs a number global for its score'); live().submit(a.targetId, v); }},
 ];
};
