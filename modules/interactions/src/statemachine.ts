import {z} from 'zod';
import {ActionSchema, ConditionSchema} from './schemas';

/**
 * Per-entity finite state machine. Exactly one state is current; on entering a state its actions run and a
 * `state.enter` event (source: the machine component, event: the state name) lets ordinary rules react. A transition
 * fires when its trigger matches an interaction event while its `from` state (or any state, `*`) is current and its
 * optional condition holds; the first matching transition in list order wins, once per event.
 */
export const stateMachineType = 'interactions.stateMachine';
const Name = z.string().trim().min(1).max(40);
export const StateSchema = z.object({id: z.string().min(1), name: Name, actions: z.array(ActionSchema).max(32)}).strict();
export const TransitionSchema = z.object({
 id: z.string().min(1), from: z.string().min(1), to: z.string().min(1),
 trigger: z.object({type: z.string().min(1), sourceId: z.string(), event: z.string()}).strict(), condition: ConditionSchema.optional(),
}).strict();
export const StateMachineSchema = z.object({states: z.array(StateSchema).min(1).max(64), initial: z.string().min(1), transitions: z.array(TransitionSchema).max(256)}).strict().superRefine((m, c) => {
 const ids = new Set(m.states.map(s => s.id));
 if (ids.size !== m.states.length || new Set(m.states.map(s => s.name)).size !== m.states.length) c.addIssue({code: 'custom', message: 'State names and IDs must be unique'});
 if (!ids.has(m.initial)) c.addIssue({code: 'custom', message: 'The initial state must exist'});
 for (const t of m.transitions) if (!(t.from === '*' || ids.has(t.from)) || !ids.has(t.to)) c.addIssue({code: 'custom', message: 'A transition uses a missing state'});
});
export type StateMachine = z.infer<typeof StateMachineSchema>;
export const defaultStateMachine = (): StateMachine => {
 const idle = crypto.randomUUID(), active = crypto.randomUUID();
 return {states: [{id: idle, name: 'idle', actions: []}, {id: active, name: 'active', actions: []}], initial: idle, transitions: []};
};
export interface MachineEvent {type: string; sourceId: string; event?: string}
/** The transition taken for an event, if any (pure; conditions are evaluated by the caller). */
export function nextTransition(machine: StateMachine, current: string, event: MachineEvent, condition: (t: z.infer<typeof TransitionSchema>) => boolean) {
 return machine.transitions.find(t => (t.from === '*' || t.from === current) && t.trigger.type === event.type && t.trigger.sourceId === event.sourceId && (!t.trigger.event || t.trigger.event === event.event) && condition(t));
}
