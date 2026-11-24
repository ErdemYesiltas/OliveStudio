import type {ActorInfo} from './contracts';

/** What the running Preview offers the behavior inspector and automation (absent while editing). */
export interface BehaviorLiveController {
 /** Increases with every Preview start: requests naming another session are refused. */
 readonly session: number;
 checkpoint?(entityId:string,value?:unknown):unknown;
 inspect(entityId?: string): ActorInfo[];
 send(entityId: string, event: {type: string; [key: string]: unknown}): ActorInfo;
 paused(): boolean;
 time(): number;
}

/** Editor-only link between the Behavior panel, MCP tools and the Preview session's script sandbox. */
class BehaviorLive {
 controller: BehaviorLiveController | null = null;
 private version = 0;
 private listeners = new Set<() => void>();
 subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
 snapshot = () => this.version;
 attach(controller: BehaviorLiveController | null) { this.controller = controller; this.refresh(); }
 refresh() { this.version++; for (const fn of this.listeners) fn(); }
 /** The running controller, checked against an expected session when one is given. */
 require(session?: number) {
  const c = this.controller;
  if (!c) throw Error('Start Preview first: no behaviors are running');
  if (session !== undefined && session !== c.session) throw Error(`Preview session ${session} has ended (current session: ${c.session})`);
  return c;
 }
}
export const behaviorLive = new BehaviorLive();
