import { applyPatches, enablePatches, freeze, produceWithPatches, type Draft, type Patch } from 'immer';
enablePatches();
interface Change { label: string; forward: Patch[]; inverse: Patch[] }
/** Serializable authoring state only. Runtime and UI selection never enter history. */
export class DocumentSession<T extends object> {
  private value: T;
  private past: Change[] = [];
  private future: Change[] = [];
  private saved: string | null;
  private group:{forward:Patch[];inverse:Patch[]}|null=null;
  private listeners = new Set<() => void>();
  version = 0;
  constructor(input: unknown, private parse: (value: unknown) => T) {
    this.value = freeze(parse(structuredClone(input)), true) as T;
    this.saved = JSON.stringify(this.value);
  }
  get current(): T { return this.value; }
  get dirty(): boolean { return JSON.stringify(this.value) !== this.saved; }
  get canUndo(): boolean { return this.past.length > 0; }
  get canRedo(): boolean { return this.future.length > 0; }
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(): void { this.version++; for (const listener of this.listeners) listener(); }
  transact(label: string, edit: (draft: Draft<T>) => void): void {
    const [next, forward, inverse] = produceWithPatches(this.value, edit);
    if (!forward.length) return;
    this.parse(next); // Full validation BEFORE changing any state/history.
    this.value = next as T;
    if(this.group){this.group.forward.push(...forward);this.group.inverse.unshift(...inverse);return;}
    this.past.push({ label, forward, inverse }); this.future = []; this.publish();
  }
  /** Synchronous commands keep normal validation, but publish/history commit only once. */
  batch(label:string,work:()=>void):void{
    if(this.group)throw Error('Nested document batches are not supported');
    const before=this.value,group={forward:[] as Patch[],inverse:[] as Patch[]};this.group=group;
    try{work();}catch(error){this.value=before;this.group=null;throw error;}
    this.group=null;if(!group.forward.length)return;
    this.past.push({label,forward:group.forward,inverse:group.inverse});this.future=[];this.publish();
  }
 /** Number of undo steps (a marker for `squash`). */
  get historyLength():number{return this.past.length;}
  /**
   * Merges every change committed after `from` into one undo step (e.g. an assistant turn spread over several
   * asynchronous edits). Patches stay in order; the inverse runs newest-first.
   */
  squash(label:string|undefined,from:number):void{
    this.outsideBatch();
    if(from<0||from>this.past.length)throw Error('Invalid history marker');
    const changes=this.past.splice(from);if(!changes.length)return;
    this.past.push({label:label??changes.at(-1)!.label,forward:changes.flatMap(c=>c.forward),inverse:[...changes].reverse().flatMap(c=>c.inverse)});this.publish();
  }
  /** Reverts every change committed after `from` and forgets it (no redo): a live edit that was cancelled. */
  rollback(from:number):void{
    this.outsideBatch();
    if(from<0||from>this.past.length)throw Error('Invalid history marker');
    const changes=this.past.slice(from);if(!changes.length)return;
    const next=applyPatches(this.value,[...changes].reverse().flatMap(c=>c.inverse));this.parse(next);
    this.past.splice(from);this.value=next;this.publish();
  }
  private outsideBatch(){if(this.group)throw Error('Document lifecycle operations cannot run inside an edit batch');}
  undo(): void {
    this.outsideBatch();
    const change = this.past.at(-1); if (!change) return;
    const next = applyPatches(this.value, change.inverse); this.parse(next);
    this.past.pop(); this.future.push(change); this.value = next; this.publish();
  }
  redo(): void {
    this.outsideBatch();
    const change = this.future.at(-1); if (!change) return;
    const next = applyPatches(this.value, change.forward); this.parse(next);
    this.future.pop(); this.past.push(change); this.value = next; this.publish();
  }
  markSaved(snapshot: T = this.value): void { this.outsideBatch();this.saved = JSON.stringify(snapshot); this.publish(); }
  replace(input: unknown, unsaved = false): void {
    this.outsideBatch();
    const next = freeze(this.parse(structuredClone(input)), true) as T;
    this.value = next; this.saved = unsaved ? null : JSON.stringify(next); this.past = []; this.future = []; this.publish();
  }
}
export type { DocumentPort } from './port';
