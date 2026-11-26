import { InputSession, type InputMap } from '@rewrite/input';
import type { Application } from 'pixi.js';

export type InputValues = Readonly<Record<string, boolean | number>>;
type InputEdge = { id: string; action: string; pressed: boolean };

export function connectedGamepad() {
  try {
    return Array.from(navigator.getGamepads?.() ?? []).find(pad => pad?.connected);
  } catch { return undefined; }
}

/** Mounts the shared action resolver for the lifetime of one game preview. */
export class PreviewInput {
  private disconnect?: () => void;
  private session?: InputSession;
  private readonly edges = new Set<(event: InputEdge) => void>();
  private values: InputValues = {};

  constructor(private readonly app: Application) {}

  get active() { return !!this.session; }
  snapshot() { return this.values; }
  key(code: string, down: boolean) { this.session?.key(code, down); }
  subscribe(listener: (event: InputEdge) => void) {
    this.edges.add(listener);
    return () => { this.edges.delete(listener); };
  }

  attach(map: InputMap, target: HTMLElement, publish: (values: InputValues) => void, setGlobal: (id: string, value: number) => void, replay = false) {
    this.stop();
    if (!map.actions.length) return () => {};
    const names = new Map(map.actions.map(action => [action.id, action.name]));
    let windowFocused = true;
    const session = new InputSession(map, {
      setGlobal,
      emit: event => {
        if (event.type !== 'input.pressed' && event.type !== 'input.released') return;
        const action = names.get(event.sourceId);
        if (action) for (const listener of this.edges) listener({ id: event.sourceId, action, pressed: event.type === 'input.pressed' });
      },
    }, () => !replay && windowFocused && document.visibilityState !== 'hidden' ? [connectedGamepad() ?? null] : []);
    this.session = session;
    const loseWindowFocus = () => { windowFocused = false; };
    const restoreWindowFocus = () => { windowFocused = true; };
    window.addEventListener('blur', loseWindowFocus);
    window.addEventListener('focus', restoreWindowFocus);
    const detach = session.attach(target, () => target === document.activeElement);
    const release = () => session.releaseAll();
    const contextMenu = (event: Event) => event.preventDefault();
    const hasRightMouse = map.actions.some(action => action.bindings.some(binding => binding.type === 'mouse' && binding.button === 2));
    target.addEventListener('blur', release);
    target.addEventListener('pointercancel', release);
    if (hasRightMouse) target.addEventListener('contextmenu', contextMenu);
    const update = () => {
      session.update();
      const next = session.snapshot();
      if (Object.entries(next).some(([name, value]) => this.values[name] !== value)) {
        this.values = next;
        publish(next);
      }
    };
    update();
    this.app.ticker.add(update);
    const stop = () => {
      if (this.session !== session) return;
      this.session = undefined;
      this.disconnect = undefined;
      this.app.ticker.remove(update);
      window.removeEventListener('blur', loseWindowFocus);
      window.removeEventListener('focus', restoreWindowFocus);
      target.removeEventListener('blur', release);
      target.removeEventListener('pointercancel', release);
      target.removeEventListener('contextmenu', contextMenu);
      detach();
      this.values = {};
      publish(this.values);
    };
    this.disconnect = stop;
    return stop;
  }

  stop() {
    this.disconnect?.();
  }
}
