import type * as behaviors from './index.js';

/**
 * Pairs one behavior class with the config its constructor accepts, so a JSON
 * block cannot name one behavior and configure another.
 */
type ExtractBehaviorConfig<T extends behaviors.IEmitterBehaviorClass> = {
  type: T['type'];
  config: T extends new (
    config: infer U,
  ) => behaviors.IEmitterBehavior
    ? U
    : never;
};

/** Reads the `type` discriminator off a behavior class, or `never` when it has none. */
type GetBehaviorType<T> = T extends { type: infer U } ? U : never;

/** Union of every registered behavior's `type` discriminator. */
export type BehaviorType = GetBehaviorType<
  (typeof behaviors)[keyof typeof behaviors]
>;

/**
 * Every behavior's `{ type, config }` pair, keyed by its export name. Exports
 * that are not behavior classes resolve to `never` and drop out of the union.
 */
export type BehaviorConfigRecord = {
  [K in keyof typeof behaviors]: (typeof behaviors)[K] extends behaviors.IEmitterBehaviorClass
    ? ExtractBehaviorConfig<(typeof behaviors)[K]>
    : never;
};

/**
 * Discriminated union of every behavior config — the type an
 * `EmitterConfig.behaviors` entry is checked against.
 *
 * @example
 * ```ts
 * const speedStatic: BehaviorConfigs = {
 *   type: 'moveSpeedStatic',
 *   config: { min: 100, max: 200 },
 * };
 * ```
 */
export type BehaviorConfigs = BehaviorConfigRecord[keyof BehaviorConfigRecord];
