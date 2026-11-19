import { expect, it } from 'vitest';
import { DocumentSession } from './index';
const parse = (input: unknown) => { const x = input as { n: number }; if (!Number.isFinite(x.n) || x.n < 0) throw Error('invalid'); return { n: x.n }; };
it('validates transactions atomically and returns to saved state on undo', () => {
 const doc = new DocumentSession({ n: 1 }, parse);
 expect(() => doc.transact('invalid', d => { d.n = -1; })).toThrow(); expect(doc.current.n).toBe(1); expect(doc.canUndo).toBe(false);
 doc.transact('move', d => { d.n = 2; }); expect(doc.dirty).toBe(true);
 doc.undo(); expect(doc.dirty).toBe(false); doc.redo(); expect(doc.current.n).toBe(2);
 doc.markSaved(); expect(doc.dirty).toBe(false); doc.undo(); expect(doc.dirty).toBe(true);
});
it('does not mark edits made during an asynchronous save clean', () => {
 const doc = new DocumentSession({ n: 1 }, parse), snapshot = doc.current;
 doc.transact('edit', d => { d.n = 2; }); doc.markSaved(snapshot); expect(doc.dirty).toBe(true);
});
it('clears redo only after a valid edit and preserves state when open fails', () => {
 const doc = new DocumentSession({ n: 1 }, parse); doc.transact('edit', d => { d.n = 2; }); doc.undo();
 expect(() => doc.replace({ n: -1 })).toThrow(); expect(doc.canRedo).toBe(true);
 doc.transact('other', d => { d.n = 3; }); expect(doc.canRedo).toBe(false);
});
it('groups validated commands into one history step and one publish',()=>{const doc=new DocumentSession({n:1},parse);let updates=0;doc.subscribe(()=>updates++);doc.batch('Edit form',()=>{doc.transact('First',d=>{d.n=2;});doc.transact('Second',d=>{d.n=3;});});expect(updates).toBe(1);expect(doc.current.n).toBe(3);doc.undo();expect(doc.current.n).toBe(1);expect(doc.canUndo).toBe(false);doc.redo();expect(doc.current.n).toBe(3);});
it('rolls a failed command group back without publishing or losing redo/saved state',()=>{const doc=new DocumentSession({n:1},parse);doc.transact('Before',d=>{d.n=2;});doc.undo();const before=doc.current,version=doc.version;let updates=0;doc.subscribe(()=>updates++);expect(()=>doc.batch('Invalid form',()=>{doc.transact('Valid',d=>{d.n=3;});doc.transact('Invalid',d=>{d.n=-1;});})).toThrow();expect(doc.current).toBe(before);expect(doc.version).toBe(version);expect(doc.dirty).toBe(false);expect(doc.canRedo).toBe(true);expect(updates).toBe(0);doc.redo();expect(doc.current.n).toBe(2);});
it('rejects lifecycle changes inside a batch and restores array patches in inverse order',()=>{const doc=new DocumentSession({items:['a']},v=>v as {items:string[]});const before=doc.current;expect(()=>doc.batch('Bad',()=>{doc.transact('Add',d=>{d.items.push('b');});doc.markSaved();})).toThrow('lifecycle');expect(doc.current).toBe(before);doc.batch('Append',()=>{doc.transact('One',d=>{d.items.push('b');});doc.transact('Two',d=>{d.items.splice(0,1);d.items.push('c');});});expect(doc.current.items).toEqual(['b','c']);doc.undo();expect(doc.current.items).toEqual(['a']);});

it('squash merges several committed changes into one undo step', async () => {
 const {DocumentSession} = await import('./index');
 const doc = new DocumentSession({items: [] as string[], name: 'a'}, v => v as {items: string[]; name: string});
 doc.transact('first', d => { d.name = 'b'; });
 const mark = doc.historyLength;
 doc.transact('add', d => { d.items.push('x'); });
 doc.transact('add', d => { d.items.push('y'); });
 doc.transact('rename', d => { d.name = 'c'; });
 doc.squash('Assistant: build', mark);
 expect(doc.historyLength).toBe(2);
 doc.undo();
 expect(doc.current).toEqual({items: [], name: 'b'});
 doc.redo();
 expect(doc.current).toEqual({items: ['x', 'y'], name: 'c'});
 doc.squash('noop', doc.historyLength);
 expect(doc.historyLength).toBe(2);
 expect(() => doc.squash('bad', 9)).toThrow('marker');
});
