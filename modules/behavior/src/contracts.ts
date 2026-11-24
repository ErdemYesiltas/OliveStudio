import {z} from 'zod';
import {BehaviourSchema, ScriptLibrarySchema, scriptsSection} from '@rewrite/scripts/contracts';
import type {Entity} from '@rewrite/scene';
import type {Project} from '@rewrite/project';
import type {ActionDefinition, InteractionCatalog, TriggerDefinition} from '@rewrite/interactions';

/**
 * Behavior: an object's states, events and transitions as a state machine defined in a script
 * (`export const machine = xstate.setup({...}).createMachine({...})`). The component stores only the script reference,
 * the pinned machine id/version and JSON parameters — never a running actor or snapshot. Positions, velocities and
 * physics stay in their systems; a behavior decides which state an object is in and what it does on entering it.
 */
export const behaviorType = 'behavior.machine';
/** Machine identity recorded when the behavior was attached: a script defining another id or version is refused. */
export const MachinePinSchema = z.object({id: z.string().trim().min(1).max(80), version: z.string().trim().max(40).optional()}).strict();
export const BehaviorSchema = z.object({...BehaviourSchema.shape, machine: MachinePinSchema.optional()}).strict();
export type Behavior = z.infer<typeof BehaviorSchema>;
export type MachinePin = z.infer<typeof MachinePinSchema>;

/** Domain checkpoints are explicit JSON payloads, not actor snapshots or world/physics saves. */
export const BehaviorCheckpointSchema=z.object({formatVersion:z.literal(1),machineId:z.string().min(1).max(80),dataVersion:z.number().int().min(1),data:z.json()}).strict().refine(v=>JSON.stringify(v).length<=32000,'Behavior checkpoint exceeds 32 KB');
export type BehaviorCheckpoint=z.infer<typeof BehaviorCheckpointSchema>;

/** What a running behavior looks like to the inspector, MCP and tests (context is a size-limited JSON preview). */
export interface ActorInfo {
 key: string; entityId: string; object: string; script: string;
 machine: {id: string; version: string | null} | null;
 status: 'idle' | 'active' | 'done' | 'stopped' | 'error';
 value: unknown; states: string[]; context: string; children: string[]; events: string[];
 history: {time: number; event: string; from: string[]; to: string[]}[];
 guards?:unknown;
 error: string | null;
}
/** A machine as a script defines it: identity, every state path and the event types it handles. */
export interface MachineInfo {id: string; version: string | null; states: string[]; initial: string[]; events: string[]; error?: string}

/**
 * Game events a behavior receives (XState event objects). Object events go only to that object's behavior; the others
 * reach every behavior in the scene. `tick` is sent each frame only when the script exports `tick = true`.
 */
export const behaviorEvents = [
 {type: 'click', scope: 'object', fields: ''},
 {type: 'collision', scope: 'object', fields: 'other, contact'},
 {type: 'collisionExit', scope: 'object', fields: 'other'},
 {type: 'arrive', scope: 'object', fields: ''},
 {type: 'timer', scope: 'object', fields: ''},
 {type: 'complete', scope: 'object', fields: ''},
 {type: 'marker', scope: 'object', fields: 'name'},
 {type: 'beat', scope: 'object', fields: 'beat'},
 {type: 'soundEnd', scope: 'object', fields: ''},
 {type: 'input.pressed', scope: 'scene', fields: 'action'},
 {type: 'input.released', scope: 'scene', fields: 'action'},
 {type: 'global', scope: 'scene', fields: 'name, value'},
 {type: 'message', scope: 'scene', fields: 'message, data'},
 {type: 'dialogue', scope: 'scene', fields: 'event, dialogue'},
 {type: 'tick', scope: 'object', fields: 'dt'},
] as const;

export const usesBehavior = (entities: readonly Entity[]) => entities.some(e => e.components.some(c => c.type === behaviorType));
export const projectUsesBehavior = (project: Pick<Project, 'scenes'>) => project.scenes.some(s => usesBehavior(s.entities));

/** A script that can define a machine: it mentions `machine` as an export (cheap check; the sandbox decides). */
export const definesMachine = (source: string) => /\bexport\s+(?:const|let|var)\s+machine\b|\bexport\s*\{[^}]*\bmachine\b/.test(source);

/** Static problems that block Play and export: missing scripts, compile errors, scripts without a machine export. */
export function behaviorProblems(project: Pick<Project, 'scenes' | 'extensions'>): string[] {
 const library = ScriptLibrarySchema.safeParse(project.extensions[scriptsSection] ?? {version: 1, items: []}), items = library.success ? library.data.items : [];
 return project.scenes.flatMap(s => s.entities.flatMap(e => e.components.filter(c => c.type === behaviorType).flatMap(c => {
  const parsed = BehaviorSchema.safeParse(c.data);
  if (!parsed.success) return [`${s.name} / ${e.name}: invalid Behavior (${parsed.error.issues[0]?.message ?? 'schema'})`];
  if (!parsed.data.scriptId) return [`${s.name} / ${e.name}: the Behavior has no machine script`];
  const script = items.find(i => i.id === parsed.data.scriptId);
  if (!script) return [`${s.name} / ${e.name}: missing behavior script`];
  if (script.error) return [`${s.name} / ${e.name}: ${script.error}`];
  if (!definesMachine(script.source)) return [`${s.name} / ${e.name}: script ${script.name} has no "export const machine"`];
  return [];
 })));
}

const behaviorRefs = (c: InteractionCatalog) => c.entities.filter(e => e.components.some(x => x.type === behaviorType)).map(e => ({id: e.id, name: e.name}));
/** Rules: "when <object>'s behavior enters <state path>" (the path is typed; machines live in scripts). */
export const behaviorTriggers: TriggerDefinition[] = [{type: 'behavior.state', titleKey: 'interaction.behaviorState', entityReference: true, references: behaviorRefs}];
/** What rules and timelines can ask of running behaviors (the session's provider implements it). */
export interface BehaviorControls {send(entityId: string, event: {type: string; [key: string]: unknown}): unknown; inspect(entityId?: string): ActorInfo[]}
/** Rules: send an event (the `to` text is the event type; `amount` rides along as `amount`). */
export const behaviorActions = (controls: () => BehaviorControls | undefined): ActionDefinition[] => [
 {type: 'behavior.send', titleKey: 'interaction.behaviorSend', entityReference: true, references: behaviorRefs, execute: a => {
  const c = controls(); if (!c) throw Error('Behaviors are not running in this scene');
  const type = typeof a.to === 'string' ? a.to.trim() : '';
  if (!type) throw Error('Send event: the event type is empty');
  c.send(a.targetId, {type, ...(a.amount !== undefined ? {amount: a.amount} : {})});
 }},
];
