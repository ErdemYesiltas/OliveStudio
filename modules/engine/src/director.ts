/** A composition evaluated synchronously against a clock and events supplied by the host. */
export type DirectorStep<Event> =
 | {type: 'sequence' | 'parallel' | 'race'; children: readonly DirectorStep<Event>[]}
 | {type: 'delay'; seconds: number}
 | {type: 'waitFor'; matches(event: Event): boolean; next?(event: Event): DirectorStep<Event> | void}
 | {type: 'timeout'; seconds: number; child: DirectorStep<Event>; onComplete?: DirectorStep<Event>; onTimeout?: DirectorStep<Event>}
 | {type: 'defer'; run(): DirectorStep<Event> | void};

type Scope = {root: Scope; parent?: Scope; active: boolean; children: Set<Scope>; cleanup?: () => void; valid(): boolean};
type Wait<Event> = {scope: Scope; due?: number; matches?(event: Event): boolean; resume(event?: Event): void};

/** Runs scene-owned flows without timers, promises or a dependency on editor modules. */
export class Director<Event = unknown> {
 private readonly roots = new Set<Scope>();
 private readonly waiting = new Set<Wait<Event>>();

 constructor(private readonly time: () => number, private readonly limit = 256) {}

 play(step: DirectorStep<Event>, valid = () => true): () => void {
  if (this.roots.size >= this.limit) throw Error('Too many active Director flows');
  const scope: Scope = {get root() { return this; }, active: true, children: new Set(), valid};
  this.roots.add(scope);
  this.run(scope, () => this.execute(step, scope, () => this.close(scope)));
  return () => this.close(scope);
 }

 advance(): void {
  for (const scope of this.roots) this.check(scope);
  const now = this.time();
  const due = [...this.waiting].filter(wait => wait.due !== undefined && wait.due <= now + 1e-9);
  due.sort((a, b) => a.due! - b.due!);
  for (const wait of due) this.run(wait.scope, () => wait.resume());
 }

 listens(matches: (predicate: (event: Event) => boolean) => boolean): boolean {
  return [...this.waiting].some(wait => wait.matches && this.check(wait.scope) && matches(wait.matches));
 }

 dispatch(event: Event): void {
  for (const wait of [...this.waiting]) {
   this.run(wait.scope, () => { if (wait.matches?.(event)) wait.resume(event); });
  }
 }

 clear(): void {
  for (const scope of this.roots) this.close(scope);
 }

 private check(scope: Scope): boolean {
  if (!scope.active) return false;
  if (scope.root.valid()) return true;
  this.close(scope.root);
  return false;
 }

 private run(scope: Scope, fn: () => void): void {
  try {
   if (this.check(scope)) fn();
  } catch (error) {
   this.close(scope.root);
   throw error;
  }
 }

 private child(parent: Scope): Scope {
  const scope = {root: parent.root, parent, active: true, children: new Set<Scope>(), valid: parent.valid};
  parent.children.add(scope);
  return scope;
 }

 private close(scope: Scope): void {
  scope.active = false;
  for (const child of scope.children) this.close(child);
  scope.cleanup?.();
  if (scope.parent) scope.parent.children.delete(scope);
  else this.roots.delete(scope);
 }

 private suspend(scope: Scope, wait: Omit<Wait<Event>, 'scope'>): void {
  if (this.waiting.size >= this.limit) throw Error('Too many waiting Director steps');
  const job = {...wait, scope, resume: (event?: Event) => {
   this.waiting.delete(job);
   scope.cleanup = undefined;
   wait.resume(event);
  }};
  this.waiting.add(job);
  scope.cleanup = () => this.waiting.delete(job);
 }

 private execute(step: DirectorStep<Event> | void, scope: Scope, done: () => void): void {
  if (!scope.active) return;
  if (!step) { done(); return; }
  switch (step.type) {
   case 'defer':
    this.execute(step.run(), scope, done);
    return;
   case 'delay':
    if (step.seconds > 0) this.suspend(scope, {due: this.time() + step.seconds, resume: done});
    else done();
    return;
   case 'waitFor':
    this.suspend(scope, {matches: step.matches, resume: event => this.execute(step.next?.(event as Event), scope, done)});
    return;
   case 'sequence': {
    let index = 0;
    const next = () => this.execute(step.children[index++], scope, index > step.children.length ? done : next);
    next();
    return;
   }
   case 'parallel':
   case 'race':
    this.group(step.children, scope, step.type === 'race', done);
    return;
   case 'timeout': {
    let expired = false;
    // Register the deadline first so it wins ties in game time.
    const deadline: DirectorStep<Event> = {type: 'sequence', children: [
     {type: 'delay', seconds: step.seconds}, {type: 'defer', run: () => { expired = true; }},
    ]};
    this.group([deadline, step.child], scope, true, () => this.execute(expired ? step.onTimeout : step.onComplete, scope, done));
   }
  }
 }

 private group(steps: readonly DirectorStep<Event>[], parent: Scope, race: boolean, done: () => void): void {
  if (!steps.length) { done(); return; }
  const group = this.child(parent);
  let remaining = steps.length;
  for (const step of steps) {
   if (!group.active) break;
   const branch = this.child(group);
   this.execute(step, branch, () => {
    this.close(branch);
    if (--remaining === 0 || race) {
     this.close(group);
     done();
    }
   });
  }
 }
}
