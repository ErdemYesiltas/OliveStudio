import { GlobalStore, GlobalValueSchema, formatTemplate, hasTemplate, type Globals, type GlobalValue } from '@rewrite/interactions';
import { z } from 'zod';
import { sceneTransitionSchema } from '@olivestudio/engine/scenes';

export type GlobalValues = Readonly<Record<string, GlobalValue>>;
export const gameSaveSchema = z.strictObject({ key: z.uuid(), revision: z.number().int().min(1).max(9999) });
export type GameSave = z.output<typeof gameSaveSchema>;
export const createGameSave = (): GameSave => ({ key: crypto.randomUUID(), revision: 1 });
export const gameSlots = [1, 2, 3, 4, 5] as const;
export type GameSlot = typeof gameSlots[number];
const sceneFrame = z.object({ main: z.string().min(1), added: z.array(z.string().min(1)).max(99) });
const slotSchema = z.strictObject({
  version: z.literal(1), revision: gameSaveSchema.shape.revision,
  ...sceneFrame.shape, stack: z.array(sceneFrame.extend({ backTransition: sceneTransitionSchema.optional() })).optional(),
  values: z.record(z.string(), GlobalValueSchema),
});
type SlotContent = Pick<z.output<typeof slotSchema>, 'main' | 'added' | 'stack' | 'values'>;
type SlotRead = { status: 'empty' | 'invalid' | 'revision' | 'unavailable' } | { status: 'ok'; data: SlotContent };
type SlotStorage = Pick<Storage, 'getItem' | 'setItem'>;
function slotKey(config: GameSave, slot: GameSlot) { return `olive.game-save.${config.key}.${slot}`; }

export function writeGameSlot(storage: SlotStorage, config: GameSave, slot: GameSlot, content: SlotContent): boolean {
  try {
    const { main, added, stack, values } = content;
    const data = slotSchema.parse({ main, added, stack, values, version: 1, revision: config.revision });
    storage.setItem(slotKey(config, slot), JSON.stringify(data));
    return true;
  } catch { return false; }
}

export function readGameSlot(storage: SlotStorage, config: GameSave, slot: GameSlot): SlotRead {
  let raw: string | null;
  try { raw = storage.getItem(slotKey(config, slot)); }
  catch { return { status: 'unavailable' }; }
  if (raw === null) return { status: 'empty' };
  try {
    const result = slotSchema.safeParse(JSON.parse(raw));
    if (!result.success) return { status: 'invalid' };
    if (result.data.revision !== config.revision) return { status: 'revision' };
    return { status: 'ok', data: result.data };
  } catch { return { status: 'invalid' }; }
}

export function globalText(text: string, values: GlobalValues, localize?: (key: string, count?: number) => string | undefined) {
  return hasTemplate(text) ? formatTemplate(text, name => Object.hasOwn(values, name) ? values[name] : undefined, localize) : text;
}

export class PreviewGlobals {
  private store?: GlobalStore;
  private disconnect?: () => void;
  private changed?: () => void;
  private batching = false;

  get runtimeStore() { return this.store; }
  get active() { return !!this.store; }
  snapshot(): GlobalValues { return this.store?.snapshot() ?? {}; }
  values(): Record<string, GlobalValue> { return this.store?.values() ?? {}; }

  start(definition: Globals, notify: (values: GlobalValues) => void) {
    this.stop();
    const store = new GlobalStore(definition);
    this.store = store;
    const changed = () => notify(store.snapshot());
    this.changed = changed;
    const sub = store.changes$.subscribe(() => { if (!this.batching) changed(); });
    const stop = () => {
      if (this.store !== store) return;
      this.store = undefined;
      this.disconnect = undefined;
      this.changed = undefined;
      sub.unsubscribe();
      store.dispose();
      notify({});
    };
    this.disconnect = stop;
    changed();
    return stop;
  }

  set(id: string, value: GlobalValue) { this.store?.set(id, value); }

  restore(values: Record<string, unknown>) {
    if (!this.store) return;
    // A load is a complete checkpoint. Newly declared globals use their authored defaults.
    this.batching = true;
    try {
      this.store.restore(Object.fromEntries(this.store.list.map(item => [item.id, item.initial])), true);
      this.store.restore(values, true);
    } finally {
      this.batching = false;
    }
    this.changed?.();
  }

  stop() { this.disconnect?.(); }
}
