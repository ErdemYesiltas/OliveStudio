import type { Container } from 'pixi.js';
import { Observable } from 'rxjs';
import type { DirectorAnimationControl } from '../host.js';
import type { DirectorStep } from '../DirectorTypes.js';
import type { IStepStrategy, StepContext } from './IStepStrategy.js';
import { logger } from '../host.js';

/**
 * Step shape for {@link AnimationStrategy}: a registered animation `key` and the `target`
 * `Container` (or a string ref looked up by `Container.label` on `app.stage`).
 *
 * One animation per step. `chain` / `steps` / `custom` used to be alternatives here, routing into
 * the animation plugin's own sequencer — a second orchestrator with a strict subset of this one's
 * vocabulary. Sequences are compositions now: put several of these under a `sequence` or
 * `parallel`, where `race`, `timeout`, `if` and `forEach` are also available.
 *
 * JSON-friendliness: when `target` is a string ref the entire step is JSON serializable, provided
 * `overrides` is too. Make sure the target node has a unique `label` and is mounted somewhere
 * under `app.stage`.
 */
export interface AnimationStep extends DirectorStep {
    type: 'animation';
    /**
     * Animation target(s). A live `Container` (code-side path), a string label
     * resolved depth-first via `app.stage.getChildByLabel(..., true)` (JSON
     * path), or an array mixing both to fan the animation across multiple
     * targets in parallel. Unresolvable string refs are skipped with a warning;
     * if nothing resolves, the whole step is a no-op.
     */
    target: Container | string | Array<Container | string>;
    /** The registered animation to apply (e.g. `'spine:big-win-loop'`). */
    key?: string;
    /**
     * Call-site overrides merged into the registered definition before play.
     * Shallow-merged for `spine` / `animatedSprite`; the `gsap` vars sub-object
     * receives an additional shallow merge — see
     * {@link AnimationPlugin.apply} for the full rule.
     */
    overrides?: Record<string, unknown>;
}

/**
 * Director strategy that delegates to `AnimationPlugin`.
 *
 * Lifecycle:
 * 1. Resolve the target(s) and `apply` the registered `key`.
 * 2. Forward `ctx.pause$` and `ctx.resume$` to the animation control —
 *    this is the only built-in strategy that actually pauses, matching the
 *    "pause animation but keep audio playing" use case.
 * 3. Bridge the animation's `finished` Promise to the observable's
 *    `complete` so the surrounding sequence advances when the animation
 *    finishes naturally.
 * 4. On unsubscribe (a `skipToEnd`, a `next()`, or `control.stop()`), **finish** the
 *    animation rather than stopping it, so a skipped presentation lands on its final
 *    visual state.
 */

function resolveTarget(stage: Container, ref: string): Container | undefined {
    if (!ref.includes('/')) {
        const matches = stage.getChildrenByLabel(ref, true);
        if (matches.length > 1) {
            logger.warn(`[Director] resolveTarget: '${ref}' matched ${matches.length} nodes — returning first. Use a path (e.g. "layer:main/screen/${ref}") for an unambiguous reference.`);
        }
        return matches[0] ?? undefined;
    }
    let node: Container = stage;
    for (const label of ref.split('/')) {
        const found = node.getChildByLabel(label, false);
        if (!found) return undefined;
        node = found;
    }
    return node;
}

export class AnimationStrategy implements IStepStrategy<AnimationStep> {
    readonly type = 'animation';

    run(step: AnimationStep, ctx: StepContext): Observable<void> {
        return new Observable<void>((sub) => {
            const app = ctx.app;
            const animate = ctx.ports.animation;
            if (!animate) {
                logger.warn('[Director] AnimationStrategy needs AnimationPlugin — skipping');
                sub.next();
                sub.complete();
                return undefined;
            }

            // Resolve target(s). String refs resolve against app.stage —
            // slash-separated paths ("hud/balance/value") traverse level by
            // level, a plain label does a recursive search. Live Containers pass
            // through. An array fans the animation across every resolved target.
            const refs = Array.isArray(step.target) ? step.target : [step.target];
            const targets: Container[] = [];
            for (const ref of refs) {
                if (typeof ref === 'string') {
                    const resolved = ctx.ports.resolveAnimationTarget?.(ref) ?? resolveTarget(app.stage, ref);
                    if (!resolved) {
                        logger.warn(`[Director] could not resolve target '${ref}' on app.stage — skipping`);
                        continue;
                    }
                    targets.push(resolved);
                } else if (ref) {
                    targets.push(ref);
                }
            }
            if (targets.length === 0) {
                logger.warn('[Director] AnimationStep has no resolvable target — skipping');
                sub.next();
                sub.complete();
                return undefined;
            }

            let ctrl: DirectorAnimationControl;
            try {
                if (step.key) {
                    ctrl = animate(step.key, targets, step.overrides);
                } else {
                    logger.warn('[Director] AnimationStep requires `key` — skipping');
                    sub.next();
                    sub.complete();
                    return undefined;
                }
            } catch (err) {
                sub.error(err);
                return undefined;
            }

            const pauseSub = ctx.pause$.subscribe(() => ctrl.pause());
            const resumeSub = ctx.resume$.subscribe(() => ctrl.resume());

            ctrl.finished.then(
                () => { sub.next(); sub.complete(); },
                (err) => { sub.error(err); },
            );

            return () => {
                pauseSub.unsubscribe();
                resumeSub.unsubscribe();
                // `finish`, not `stop` — the repo's rule is "unsubscribe = skip, not freeze": a
                // skipped presentation has to land on its final visual state, and completion-keyed
                // work still has to run. `stop` froze the tween wherever it happened to be, so a
                // `skipToEnd` on a composition left half-scaled symbols and half-faded panels on
                // screen. Drivers that cannot seek fall back to `stop` inside `finish` anyway.
                //
                // Safe on the natural-completion path too: RxJS runs this teardown when `complete`
                // closes the subscriber, and `finish` is a no-op once the control has terminated.
                ctrl.finish();
            };
        });
    }
}
