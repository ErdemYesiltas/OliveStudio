import type { Application } from 'pixi.js';
import type { AppScreen, AppScreenCtor } from './types.js';

/** Options for {@link presentScene}. */
export interface PresentSceneOptions {
  /**
   * **Two halves, two moments** (2026-10-05): the call resolves on the scene's `onDone`, and the
   * scene is closed on a second callback, `onClose`, which the scene raises when it may go — the
   * hand-over and a later cover, for a screen that stays up under a transition while the round has
   * already moved on. Off (default): `onDone` both resolves and closes.
   */
  closeOnClose?: boolean;
}

/**
 * Pushes a scene onto a layer and resolves when it reports `onDone` — or when `signal` aborts —
 * then closes **that scene**.
 *
 * The awaitable half of a full-screen presentation, as a function. It used to be a view class
 * (`SceneView`), which meant a free-spin intro could only run if someone had also authored a
 * placement entry binding that view to the feature; forget the placement and the FSM awaited a
 * presentation that silently never happened. A feature calls this directly instead:
 *
 * ```ts
 * protected present(cmd: SlotCommand, signal?: AbortSignal): Promise<void> {
 *   if (cmd.type !== 'SHOW_FREESPIN_INTRO') return Promise.resolve();
 *   return presentScene(this._app, 'overlay', FreeSpinIntroScene, { remaining: cmd.remaining }, signal);
 * }
 * ```
 *
 * **It closes its own screen, never the layer's top** (2026-10-05, the fix of QA B-1 / B-8 moved
 * here from slot-stage's mode ceremonies, which had forked this function to get it). It used to
 * `pop(layer)`: a screen still up past its hand-over had the next one pushed over it, and the old
 * screen's close took the new one, whose awaiting command then waited for good. The screen is the
 * one the push resolved to; one closed before it finished mounting (an abort) goes as it mounts.
 *
 * **Always resolves, never rejects** — on `onDone`, on an abort, on a push that rejects or throws
 * (an unregistered layer), and when the screen is destroyed by anything else. An orchestrator
 * awaiting a presentation hangs forever on a promise that never settles, and a cosmetic failure must
 * not stall a round with the board already decided. No `app.scene` resolves immediately with
 * nothing pushed. The abort listener is removed once it has settled.
 *
 * The close is fire-and-forget, so this resolves as the exit transition starts rather than after it
 * — what the FSM wants: the next command should not wait on an outro fading out.
 */
export function presentScene(
  app: Application,
  layer: string,
  scene: AppScreenCtor,
  input?: Record<string, unknown>,
  signal?: AbortSignal,
  options: PresentSceneOptions = {},
): Promise<void> {
  const manager = app.scene;
  if (!manager) return Promise.resolve();
  return new Promise<void>((resolve) => {
    let settled = false;
    let closed = false;
    let mounted: AppScreen | undefined;
    const settle = (): void => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', abort);
      resolve();
    };
    const close = (): void => {
      if (closed) return;
      closed = true;
      if (mounted) void manager.close(mounted);
    };
    function abort(): void {
      settle();
      close();
    }
    const onDone = (): void => {
      settle();
      if (!options.closeOnClose) close();
    };
    signal?.addEventListener('abort', abort, { once: true });
    let pushed: Promise<AppScreen>;
    try {
      pushed = manager.push(layer, scene, { ...input, onDone, ...(options.closeOnClose ? { onClose: close } : {}) });
    } catch {
      settle();
      return;
    }
    pushed.then(
      (screen) => {
        mounted = screen;
        screen.once('destroyed', settle);
        // Closed while it was still mounting (an abort, or an `onDone` raised from `prepare`).
        if (closed) void manager.close(screen);
      },
      () => settle(),
    );
  });
}
