interface Entry<T> {
 refs: number;
 promise: Promise<T>;
 value?: T;
}

/** Coordinates scopes that use Pixi's process-wide Assets cache.
 * Final release owns teardown; the next load waits for that teardown.
 */
export class SharedModelSources<T> {
 private entries = new Map<string, Entry<T>>();
 private closing = new Map<string, Promise<void>>();
 constructor(
  private read: (url: string) => Promise<T>,
  private release: (url: string, source: T) => Promise<void>,
 ) {}
 get stats() {
  return {
   resources: this.entries.size,
   refs: [...this.entries.values()].reduce((sum, entry) => sum + entry.refs, 0),
   pendingUnloads: this.closing.size,
  };
 }
 load(url: string): Promise<T> {
  let entry = this.entries.get(url);
  if (!entry) {
   const next: Entry<T> = { refs: 0, promise: Promise.resolve(null as T) };
   next.promise = (this.closing.get(url) ?? Promise.resolve())
    .then(() => this.read(url))
    .then(value => { next.value = value; return value; });
   entry = next;
   this.entries.set(url, entry);
  }
  entry.refs++;
  const owned = entry;
  return owned.promise.catch(error => {
   owned.refs--;
   if (!owned.refs && this.entries.get(url) === owned) this.entries.delete(url);
   throw error;
  });
 }
 async unload(url: string, source: T) {
  const entry = this.entries.get(url);
  if (!entry || entry.value !== source || entry.refs <= 0) throw Error('Model source ownership mismatch');
  entry.refs--;
  if (entry.refs) return;
  this.entries.delete(url);
  // Register closing before invoking the backend, including synchronous failures.
  const closed = Promise.resolve().then(() => this.release(url, source));
  this.closing.set(url, closed);
  const forget = () => { if (this.closing.get(url) === closed) this.closing.delete(url); };
  void closed.then(forget, forget);
  await closed;
 }
}
