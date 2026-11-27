import type { Container } from 'pixi.js';
import type { Observable } from 'rxjs';
import type { AudioAction } from './AudioAction.js';

export const logger = console;

export class DirectorEventBus<T extends { type: string }> {
  private depth = 0;
  private readonly listeners = new Map<string, Set<(event: T) => void>>();

  on<K extends T['type']>(type: K, callback: (event: Extract<T, { type: K }> extends never ? T : Extract<T, { type: K }>) => void) {
    const listener = callback as (event: T) => void;
    const listeners = this.listeners.get(type) ?? new Set();
    this.listeners.set(type, listeners);
    listeners.add(listener);
    return { unsubscribe: () => {
      listeners.delete(listener);
      if (!listeners.size && this.listeners.get(type) === listeners) this.listeners.delete(type);
    } };
  }

  emit(event: T) {
    if (this.depth >= 32) throw new Error('[Director] event recursion exceeds 32 synchronous emissions');
    this.depth++;
    try {
      for (const listener of [...this.listeners.get(event.type) ?? []]) listener(event);
    } finally {
      this.depth--;
    }
  }

  clear() { this.listeners.clear(); }
}

export interface DirectorAnimationControl {
  finished: PromiseLike<unknown>;
  pause(): void;
  resume(): void;
  finish(): void;
}

export interface DirectorPorts {
  audio?: (action: AudioAction) => Observable<void>;
  resolveAnimationTarget?: (ref: string) => Container | undefined;
  animation?: (key: string, targets: Container[], overrides?: Record<string, unknown>) => DirectorAnimationControl;
}
