export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export interface Transform2D {x:number;y:number;rotation:number;scaleX:number;scaleY:number;skewX?:number;skewY?:number;pivotX?:number;pivotY?:number}

export interface RuntimeSystem {
  id: string; after?: readonly string[]; before?: readonly string[];
  start?(context?:{paused:boolean}): void; fixedUpdate?(dtSeconds: number): void; update?(dtSeconds: number): void;
  pause?(): void; resume?(): void; dispose(): void;
  /** Objects added to the running world (spawned by scripts): pick up their bodies, tweens, scripts… */
  spawned?(ids: readonly string[]): void;
  /** Objects removed from the running world (destroyed): release what belongs to them. */
  removed?(ids: readonly string[]): void;
}
