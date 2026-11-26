import { gsap } from 'gsap';
import type { Ticker } from 'pixi.js';

const active = new WeakMap<object, Set<() => void>>();

export function cancelClockTweens(owner: object) {
  for (const stop of active.get(owner) ?? []) stop();
}

export function tweenOnClock(ticker: Ticker | undefined, target: object, vars: gsap.TweenVars, owner?: object) {
  let finish!: () => void;
  const done = new Promise<void>(resolve => { finish = resolve; });
  const duration = Math.max(0, Number(vars.duration ?? 0));
  const clock = duration > 0 ? ticker : undefined;
  let stops = owner && active.get(owner);
  if (owner && !stops) { stops = new Set(); active.set(owner, stops); }
  let elapsed = 0;
  let finished = false;
  const tick = (frame: Ticker) => {
    elapsed += frame.deltaMS / 1000;
    tween.totalTime(Math.min(duration, elapsed), false);
  };
  const settle = () => {
    if (finished) return;
    finished = true;
    clock?.remove(tick);
    stops?.delete(kill);
    finish();
  };
  const kill = () => { tween.kill(); settle(); };
  const tween = gsap.to(target, {
    ...vars, duration, paused: !!clock,
    onComplete: () => { settle(); vars.onComplete?.(); },
  });
  if (!finished) {
    stops?.add(kill);
    clock?.add(tick);
  }
  return { kill, done };
}
