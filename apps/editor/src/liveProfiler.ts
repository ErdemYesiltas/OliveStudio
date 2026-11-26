import { countDrawCalls, type ProfileRecorder } from '@rewrite/profiler';
import type { Application } from 'pixi.js';

export class LiveProfiler {
  private calls?: ReturnType<typeof countDrawCalls>;
  private systems: Record<string, number> = {};
  private previous = 0;
  private start = 0;
  private steps = 0;
  private readonly unsubscribe: () => void;
  private readonly hook: { prerender: () => void; postrender: () => void };

  constructor(private app: Application, private recorder: ProfileRecorder, private objects: () => number) {
    this.hook = {
      prerender: () => {
        if (!recorder.paused) this.start = performance.now();
      },
      postrender: () => {
        if (!this.start) return;
        const time = performance.now();
        const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
        if (this.previous) recorder.push({
          time, frameMs: time - this.previous, renderMs: time - this.start, systems: this.systems,
          drawCalls: this.calls?.take() ?? 0, objects: this.objects(), steps: this.steps,
          heapMb: memory && memory.usedJSHeapSize / 1048576,
        });
        else this.calls?.take();
        this.previous = time;
        this.start = 0;
        this.steps = 0;
        this.systems = {};
      },
    };
    app.renderer.runners.prerender.add(this.hook);
    app.renderer.runners.postrender.add(this.hook);
    const sync = () => {
      if (recorder.paused && this.calls) {
        this.calls.dispose();
        this.calls = undefined;
        this.reset();
      } else if (!recorder.paused && !this.calls) {
        this.calls = countDrawCalls('gl' in app.renderer ? app.renderer.gl : undefined);
      }
    };
    this.unsubscribe = recorder.subscribe(sync);
    sync();
  }

  measure<T>(id: string, operation: () => T): T {
    if (this.recorder.paused) return operation();
    const start = performance.now();
    try { return operation(); } finally { this.systems[id] = (this.systems[id] ?? 0) + performance.now() - start; }
  }

  physicsSteps(count: number) { if (!this.recorder.paused) this.steps += count; }

  reset() {
    this.calls?.take();
    this.previous = this.start = this.steps = 0;
    this.systems = {};
  }

  dispose() {
    this.unsubscribe();
    this.calls?.dispose();
    this.app.renderer.runners.prerender.remove(this.hook);
    this.app.renderer.runners.postrender.remove(this.hook);
  }
}
