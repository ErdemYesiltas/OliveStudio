import type { Application } from 'pixi.js';
import type { DirectorControl } from './DirectorControl.js';
import type { DirectorStep, DirectorVars } from './DirectorTypes.js';
import { Interpreter } from './interpreter/Interpreter.js';
import { DelayStrategy } from './strategies/DelayStrategy.js';
import type { IStepStrategy } from './strategies/IStepStrategy.js';
import { ParallelStrategy } from './strategies/ParallelStrategy.js';
import { SequenceStrategy } from './strategies/SequenceStrategy.js';
import { StepStrategyRegistry } from './strategies/StepStrategyRegistry.js';

export type { DirectorControl, DirectorStep, DirectorVars, IStepStrategy };

/** Mounts the Aperion composition interpreter with the strategies available in this host. */
export class AperionDirector {
  private readonly registry = new StepStrategyRegistry();
  private readonly interpreter: Interpreter;
  private active?: DirectorControl;

  constructor(app: Application) {
    this.registry.register(new SequenceStrategy());
    this.registry.register(new ParallelStrategy());
    this.registry.register(new DelayStrategy());
    this.interpreter = new Interpreter(app, this.registry);
  }

  registerStrategy(strategy: IStepStrategy) {
    this.registry.register(strategy);
  }

  run(step: DirectorStep, vars: DirectorVars = {}) {
    this.stop();
    const control = this.interpreter.interpret(step, vars);
    this.active = control;
    const release = () => { if (this.active === control) this.active = undefined; };
    void control.finished.then(release, release);
    return control;
  }

  stop() {
    this.active?.stop();
    this.active = undefined;
  }
}
