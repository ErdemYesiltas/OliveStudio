import {z} from 'zod';

/**
 * Netcode shared by server and clients: the server applies validated inputs with {@link step} on a fixed tick; the
 * local client applies the same step at once (prediction) and re-applies unacknowledged inputs on each server state
 * (reconciliation); remote players are drawn between buffered server states (interpolation). Pure functions, no
 * timers or transport, so both sides and tests run the exact same rules.
 */
export interface Vec {x: number; y: number}
export interface MoveRules {speed: number; bounds: {width: number; height: number}}
/** One frame of movement input: axes in [-1, 1] and the frame's seconds; `seq` increases by one per input. */
export const MoveInputSchema = z.object({seq: z.number().int().min(1).max(2 ** 31), x: z.number().finite().min(-1).max(1), y: z.number().finite().min(-1).max(1), dt: z.number().finite().min(0).max(0.25)}).strict();
export type MoveInput = z.infer<typeof MoveInputSchema>;
/** The largest time one input may move (a stalled client cannot teleport by sending a huge dt). */
export const MAX_STEP = 0.1;

export function step(p: Vec, input: Pick<MoveInput, 'x' | 'y' | 'dt'>, rules: MoveRules): Vec {
 let {x, y} = input; const length = Math.hypot(x, y);
 if (length > 1) { x /= length; y /= length; }
 const dt = Math.min(MAX_STEP, Math.max(0, input.dt));
 return {x: Math.min(rules.bounds.width, Math.max(0, p.x + x * rules.speed * dt)), y: Math.min(rules.bounds.height, Math.max(0, p.y + y * rules.speed * dt))};
}

/**
 * Server-side time budget per player: inputs may not add up to more movement time than real time has passed (plus a
 * small allowance for jitter). Excess dt is cut, so a client sending inputs faster than it runs gains no speed.
 */
export class InputBudget {
 private budget: number;
 constructor(private readonly slack = 0.25) { this.budget = slack; }
 /** Real seconds passed on the server. */
 grant(seconds: number) { this.budget = Math.min(this.slack + 1, this.budget + Math.max(0, seconds)); }
 /** The part of `dt` this input may use. */
 take(dt: number) { const used = Math.max(0, Math.min(dt, MAX_STEP, this.budget)); this.budget -= used; return used; }
}

/** Local player: applies inputs immediately and replays the unacknowledged ones on top of each server state. */
export class Predictor {
 private pending: MoveInput[] = [];
 private seq = 0;
 position: Vec;
 constructor(start: Vec, private rules: MoveRules, private limit = 120) { this.position = {...start}; }
 get unacknowledged() { return this.pending.length; }
 /** The next input for this frame, already applied locally. */
 next(x: number, y: number, dt: number): MoveInput {
  const input = MoveInputSchema.parse({seq: ++this.seq, x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, y)), dt: Math.min(0.25, Math.max(0, dt))});
  this.position = step(this.position, input, this.rules);
  this.pending.push(input); if (this.pending.length > this.limit) this.pending.shift();
  return input;
 }
 /** A server state for this player: start there and replay what the server has not processed yet. */
 reconcile(server: Vec & {lastSeq: number}) {
  this.pending = this.pending.filter(i => i.seq > server.lastSeq);
  let p: Vec = {x: server.x, y: server.y};
  for (const input of this.pending) p = step(p, input, this.rules);
  this.position = p;
 }
 /** After a reconnect the server starts counting again from the seat's last acknowledged input. */
 resume(lastSeq: number) { this.seq = Math.max(this.seq, lastSeq); this.pending = []; }
}

/** Remote player: buffered server states drawn `delay` seconds in the past, linearly between the two around then. */
export class Interpolator {
 private states: (Vec & {t: number})[] = [];
 push(t: number, p: Vec) { const last = this.states.at(-1); if (last && t <= last.t) { last.x = p.x; last.y = p.y; return; } this.states.push({t, x: p.x, y: p.y}); if (this.states.length > 32) this.states.shift(); }
 sample(t: number): Vec | null {
  const s = this.states; if (!s.length) return null;
  if (t <= s[0].t) return {x: s[0].x, y: s[0].y};
  for (let i = s.length - 1; i > 0; i--) if (s[i - 1].t <= t) { const a = s[i - 1], b = s[i]; if (t >= b.t) return {x: b.x, y: b.y}; const k = (t - a.t) / (b.t - a.t); return {x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k}; }
  return {x: s.at(-1)!.x, y: s.at(-1)!.y};
 }
}

/** Display names: printable, trimmed, at most 24 characters; empty becomes "Player". */
export const playerName = (value: unknown) => { const v = typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 24) : ''; return v || 'Player'; };
