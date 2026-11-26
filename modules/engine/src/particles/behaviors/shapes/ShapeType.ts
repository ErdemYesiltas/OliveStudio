import type * as shapes from './index.js';

/**
 * Pairs one shape class with the config its constructor accepts, so the two can
 * never drift apart in a JSON document.
 */
type ExtractShapeConfig<T extends shapes.SpawnShapeClass> = {
  type: T['type'];
  config: T extends new (config: infer U) => shapes.SpawnShape ? U : never;
};

/** Union of every registered shape's `type` discriminator. */
export type ShapeType = (typeof shapes)[keyof typeof shapes]['type'];

/** Every shape's `{ type, config }` pair, keyed by its export name. */
export type ShapeConfigRecord = {
  [K in keyof typeof shapes]: ExtractShapeConfig<(typeof shapes)[K]>;
};

/**
 * Discriminated union of every shape config, so a `ShapeSpawnBehavior` block
 * type-checks its `config` against the `type` beside it.
 */
export type ShapeConfigs = ShapeConfigRecord[keyof ShapeConfigRecord];
