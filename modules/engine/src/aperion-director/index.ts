/**
 * Public surface of the director module — the Pixi {@link DirectorPlugin},
 * the {@link CompositionRegistry} and {@link TriggerRegistry} primitives,
 * the {@link Interpreter} that walks composition trees, the
 * {@link DirectorControl} handle, the user-facing
 * {@link Composition} / {@link DirectorStep} types, the
 * {@link DirectorEvent} union, and every built-in step strategy.
 *
 * Strategy-system naming follows `factory/strategies` —
 * `IStepStrategy`, `StepStrategyRegistry`, `registerDefaultStepStrategies` —
 * so there are no collisions with the top-level engine barrel.
 */

export { DirectorPlugin, type DirectorOptions } from './DirectorPlugin.js';
export { DirectorService, DirectorService as AperionDirector } from './DirectorService.js';
export { DirectorEventBus, type DirectorPorts, type DirectorAnimationControl } from './host.js';
export type { AudioAction } from './AudioAction.js';
export { tickerDelay$, tickerInterval$, tickerFrames$ } from './tickerDelay.js';
export { CompositionRegistry } from './CompositionRegistry.js';
export type { DirectorControl } from './DirectorControl.js';
export type {
    Composition,
    DirectorStep,
    DirectorVars,
    TriggerSpec,
    TriggerContext,
    DirectorEventPayload,
} from './DirectorTypes.js';
export type {
    DirectorEvent,
    DirectorRunEvent,
    DirectorAdvanceEvent,
    DirectorCompleteEvent,
    DirectorStoppedEvent,
    DirectorErrorEvent,
} from './DirectorEvents.js';

export { Interpreter } from './interpreter/Interpreter.js';
export { TriggerRegistry, type TriggerOptions } from './triggers/TriggerRegistry.js';

// Strategy system — names already disambiguated by the `Step` prefix.
export * from './strategies/index.js';

// Expression DSL — used by `if` step and trigger `whenExpr`.
export {
    parseExpression,
    compileExpression,
    clearExpressionCache,
    ExpressionParseError,
} from '../expression/index.js';
export type { LookupFn, ExpressionEvaluator, IdentifierPrefix } from '../expression/index.js';
export * from './stepRefs.js';
export * from './moduleStrategies.js';
