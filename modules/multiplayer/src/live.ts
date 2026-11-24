import type {NetStatus} from './contracts';

/** What a running Preview's multiplayer client offers the panel and automation. */
export interface MultiplayerLiveClient {sendEvent?(id:string,event:{type:string;[key:string]:unknown}):void;status(): NetStatus}

/** Editor-only link between the Multiplayer panel, MCP tools and the Preview session's client. */
class MultiplayerLive {
 client: MultiplayerLiveClient | null = null;
 private version = 0;
 private listeners = new Set<() => void>();
 subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
 snapshot = () => this.version;
 attach(client: MultiplayerLiveClient | null) { this.client = client; this.refresh(); }
 refresh() { this.version++; for (const fn of this.listeners) fn(); }
}
export const multiplayerLive = new MultiplayerLive();
