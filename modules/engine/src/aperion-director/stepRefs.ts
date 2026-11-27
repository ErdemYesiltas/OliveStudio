/**
 * Which fields of a director step name something else.
 *
 * A `DirectorStep` is an open bag (`type` plus strategy-specific payload), which is what makes the
 * step vocabulary extensible and what makes it **unreadable to anything but its own strategy**. A
 * composition could therefore name an animation, a sound or another composition that does not
 * exist, and nothing could tell: the strategy warns at run time and the composition "succeeds"
 * having played nothing. That is the failure the document format exists to remove, and it needs one
 * thing the format cannot infer — a list of which fields are references.
 *
 * This module is that list, and three properties are deliberate:
 *
 * - **It imports nothing.** The document checker runs in plain Node with no renderer
 *   (`@aperion-gaming/engine/format`), so anything it reaches must be importable there. Same reason
 *   `factory/drawShapes.ts` exists.
 * - **It is a table, not a switch.** A `switch (step.type)` goes stale by silently dropping a step
 *   type nobody updated it for; a table is missing a row, which reads as "this step's references
 *   are unchecked" rather than as "this step has none".
 * - **It is open.** A package that registers a step strategy registers its reference fields beside
 *   it, so the checker learns a vertical's vocabulary the same way the runtime does.
 *
 * **Structure is not described here.** The walker recurses through every nested object and array of
 * a step on its own, so `children` / `child` / `do` / `then` / `else` and anything a future
 * container step calls its branches are traversed without a row. Only leaf *references* need one.
 */

/** What a step field points at. The first six are document collections; the last two are not. */
export type StepRefKind =
  | 'animation'
  | 'sound'
  | 'composition'
  | 'camera'
  | 'action'
  /** A display-object label resolved against `app.stage` at run time — see {@link StepRefField}. */
  | 'nodeLabel'
  /** An `app.events` event type. Not a document entity; recorded so an editor can find usages. */
  | 'event';

/** One reference field of one step type. */
export interface StepRefField {
  /**
   * Dot path to the value inside the step — `'key'`, `'play.alias'`. One level of nesting is
   * enough for every step that exists, and the walker resolves it without a path evaluator.
   */
  path: string;
  kind: StepRefKind;
  /**
   * Sibling path holding the audio layer, for a `sound`. A sound is addressed as `(layer, alias)`,
   * so an alias alone cannot be resolved.
   */
  layerPath?: string;
  /** Audio layer to assume when {@link layerPath} is absent — `crossfade` is always BGM. */
  layer?: string;
  /** The value may be an array of references (an `animation` step fans across targets). */
  list?: boolean;
}

/**
 * The built-in step vocabulary.
 *
 * Read off the strategies rather than from memory: `AnimationStrategy` (`key`, `target`),
 * `CompositionStrategy` (`name`), `AudioStrategy` (one {@link AudioAction} variant per step),
 * `CameraStrategy` (`camera`), `EmitStrategy` and `WaitForStrategy` (`event`).
 *
 * Audio variants that name a **registry outside the document** — `profile`, `snapshot`, `restore`,
 * `stem` — are deliberately absent: they address `app.audio`'s own registries, which a document
 * does not describe, so listing them would report every correct use as unknown.
 */
const BUILTIN_STEP_REFS: Record<string, readonly StepRefField[]> = {
  animation: [
    { path: 'key', kind: 'animation' },
    { path: 'target', kind: 'nodeLabel', list: true },
  ],
  composition: [{ path: 'name', kind: 'composition' }],
  camera: [{ path: 'camera', kind: 'camera' }],
  emit: [{ path: 'event', kind: 'event' }],
  waitFor: [{ path: 'event', kind: 'event' }],
  audio: [
    { path: 'play.alias', kind: 'sound', layerPath: 'play.layer' },
    { path: 'playOnce.alias', kind: 'sound', layerPath: 'playOnce.layer' },
    { path: 'stop.alias', kind: 'sound', layerPath: 'stop.layer' },
    { path: 'fadeAlias.alias', kind: 'sound', layerPath: 'fadeAlias.layer' },
    { path: 'crossfade.alias', kind: 'sound', layer: 'bgm' },
  ],
};

const registered = new Map<string, readonly StepRefField[]>(Object.entries(BUILTIN_STEP_REFS));

/**
 * Declare the reference fields of a step type a package registered a strategy for.
 *
 * Call it beside `app.director.registerStrategy(...)`. Registering replaces, so a package may
 * correct a built-in row; registering an empty list is how a step type says it has no references,
 * which reads differently from having no row at all.
 */
export function registerStepRefFields(type: string, fields: readonly StepRefField[]): void {
  registered.set(type, fields);
}

/** The reference fields declared for a step type, or an empty list when none are. */
export function stepRefFields(type: string): readonly StepRefField[] {
  return registered.get(type) ?? [];
}

/** Every step type with a declared row, for diagnostics. */
export function stepRefTypes(): string[] {
  return [...registered.keys()];
}

/** Read a dot path (at most one level deep) off a step. */
export function readStepPath(step: Record<string, unknown>, path: string): unknown {
  const dot = path.indexOf('.');
  if (dot < 0) return step[path];
  const head = step[path.slice(0, dot)];
  if (!head || typeof head !== 'object') return undefined;
  return (head as Record<string, unknown>)[path.slice(dot + 1)];
}
