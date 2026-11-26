export class SceneEvents<Event extends { type: string }> {
  private readonly listeners = new Map<string, Set<(event: Event) => void>>();

  on<Type extends Event['type']>(type: Type, listener: (event: Extract<Event, { type: Type }>) => void) {
    const group = this.listeners.get(type) ?? new Set();
    this.listeners.set(type, group);
    const callback = (event: Event) => listener(event as Extract<Event, { type: Type }>);
    group.add(callback);
    return { unsubscribe: () => { group.delete(callback); } };
  }

  emit(event: Event) {
    for (const listener of this.listeners.get(event.type) ?? []) listener(event);
  }

  clear() { this.listeners.clear(); }
}
