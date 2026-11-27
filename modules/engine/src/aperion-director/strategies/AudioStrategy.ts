import { Observable } from 'rxjs';
import type { AudioAction } from '../AudioAction.js';
import type { IStepStrategy, StepContext } from './IStepStrategy.js';
import { logger } from '../host.js';

/**
 * Step shape for {@link AudioStrategy}. The `type` discriminator is `'audio'`;
 * the rest of the payload is a single {@link AudioAction} variant.
 *
 * Examples:
 * ```ts
 * { type: 'audio', play: { layer: 'sfx', alias: 'click' } }
 * { type: 'audio', fadeAlias: { layer: 'bgm', alias: 'loop', to: 0, ms: 600 } }
 * { type: 'audio', atNextBar: 2 }
 * { type: 'audio', custom: 'flash-screen' }
 * ```
 *
 * JSON-serializable throughout: every {@link AudioAction} variant carries primitives only. The
 * one that did not — a cross-domain `{ animation }` step holding a live `Container` — is gone;
 * play an animation with a sibling `{ type: 'animation' }` step instead, which addresses its
 * target by label and stays serializable.
 */
export type AudioStep = { type: 'audio' } & AudioAction;

/**
 * Director strategy that delegates to `AudioPlugin.composer.run(action)`.
 *
 * `AudioStrategy` does NOT honor `ctx.pause$` / `ctx.resume$` — audio
 * generally continues during gameplay pauses (background music in a pause
 * menu). Callers that need audio-aware pause should call `app.audio.muteAll()`
 * directly outside the composition.
 */
export class AudioStrategy implements IStepStrategy<AudioStep> {
    readonly type = 'audio';

    run(step: AudioStep, ctx: StepContext): Observable<void> {
        return new Observable<void>((sub) => {
            const audio = ctx.ports.audio;
            if (!audio) {
                logger.warn('[Director] AudioStrategy needs AudioPlugin — skipping');
                sub.next();
                sub.complete();
                return undefined;
            }

            // Strip the director-side `type: 'audio'` discriminator before handing the action off.
            const { type: _type, ...action } = step;
            const inner = audio(action).subscribe({
                next: () => sub.next(),
                error: (e: unknown) => sub.error(e),
                complete: () => sub.complete(),
            });

            return () => inner.unsubscribe();
        });
    }
}
