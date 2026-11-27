/**
 * Public surface of the director's strategy system — the
 * {@link IStepStrategy} contract, the {@link StepStrategyRegistry} lookup
 * structure, every built-in step strategy, and
 * {@link registerDefaultStepStrategies} (called once by `DirectorPlugin.init`).
 *
 * Naming mirrors `factory/strategies` — `I<DomainObject>Strategy`,
 * `<DomainObject>StrategyRegistry`, `registerDefault<DomainObject>Strategies`.
 * Here the domain object is `Step`.
 */
export type { IStepStrategy, StepContext } from './IStepStrategy.js';
export { StepStrategyRegistry } from './StepStrategyRegistry.js';

// Container strategies
export { SequenceStrategy, type SequenceStep } from './SequenceStrategy.js';
export { ParallelStrategy, type ParallelStep } from './ParallelStrategy.js';
export { DelayStrategy, type DelayStep } from './DelayStrategy.js';
export { RepeatStrategy, type RepeatStep } from './RepeatStrategy.js';

// Control flow
export { IfStrategy, type IfStep } from './IfStrategy.js';
export { SwitchStrategy, type SwitchStep } from './SwitchStrategy.js';
export { RaceStrategy, type RaceStep } from './RaceStrategy.js';
export { TryStrategy, type TryStep } from './TryStrategy.js';
export { TimeoutStrategy, type TimeoutStep } from './TimeoutStrategy.js';

// Synchronization + events
export { WaitForStrategy, type WaitForStep } from './WaitForStrategy.js';
export { EmitStrategy, type EmitStep } from './EmitStrategy.js';

// State manipulation
export { AssignStrategy, type AssignStep } from './AssignStrategy.js';
export { ForEachStrategy, type ForEachStep } from './ForEachStrategy.js';

// Convenience / composition
export { LogStrategy, type LogStep } from './LogStrategy.js';
export { CompositionStrategy, type CompositionStep } from './CompositionStrategy.js';

// Cross-domain dispatchers
export { AnimationStrategy, type AnimationStep } from './AnimationStrategy.js';
export { AudioStrategy, type AudioStep } from './AudioStrategy.js';

import { SequenceStrategy } from './SequenceStrategy.js';
import { ParallelStrategy } from './ParallelStrategy.js';
import { DelayStrategy } from './DelayStrategy.js';
import { RepeatStrategy } from './RepeatStrategy.js';
import { IfStrategy } from './IfStrategy.js';
import { SwitchStrategy } from './SwitchStrategy.js';
import { RaceStrategy } from './RaceStrategy.js';
import { TryStrategy } from './TryStrategy.js';
import { TimeoutStrategy } from './TimeoutStrategy.js';
import { WaitForStrategy } from './WaitForStrategy.js';
import { EmitStrategy } from './EmitStrategy.js';
import { AssignStrategy } from './AssignStrategy.js';
import { ForEachStrategy } from './ForEachStrategy.js';
import { LogStrategy } from './LogStrategy.js';
import { CompositionStrategy } from './CompositionStrategy.js';
import { AnimationStrategy } from './AnimationStrategy.js';
import { AudioStrategy } from './AudioStrategy.js';
import { type StepStrategyRegistry } from './StepStrategyRegistry.js';

/**
 * Register every built-in step strategy on `registry`. Called once by
 * `DirectorPlugin.init()`. Consumers can register additional strategies (or
 * override built-ins) via `app.director.registerStrategy(...)`.
 */
export function registerDefaultStepStrategies(registry: StepStrategyRegistry): void {
    // Containers
    registry.register(new SequenceStrategy());
    registry.register(new ParallelStrategy());
    registry.register(new DelayStrategy());
    registry.register(new RepeatStrategy());

    // Control flow
    registry.register(new IfStrategy());
    registry.register(new SwitchStrategy());
    registry.register(new RaceStrategy());
    registry.register(new TryStrategy());
    registry.register(new TimeoutStrategy());

    // Sync + events
    registry.register(new WaitForStrategy());
    registry.register(new EmitStrategy());

    // State
    registry.register(new AssignStrategy());
    registry.register(new ForEachStrategy());

    // Convenience
    registry.register(new LogStrategy());
    registry.register(new CompositionStrategy());

    // Cross-domain
    registry.register(new AnimationStrategy());
    registry.register(new AudioStrategy());
}
