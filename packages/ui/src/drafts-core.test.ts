import {it,expect,vi} from 'vitest';
import {DraftController,finiteNumber,type DraftEntry} from './drafts-core';
import {DocumentSession} from '../../documents/src/index';
function setup(){let scope='project:scene';const doc=new DocumentSession({a:1,b:2},v=>{const value=v as {a:number;b:number};if(value.a<0||value.b<0)throw Error('Negative value');return value;});const controller=new DraftController({scope:()=>scope,batch:work=>doc.batch('Drafts',work)});const field=(key:'a'|'b',raw:string)=>{let pending=true;const accept=vi.fn(()=>{pending=false;}),reject=vi.fn(),focus=vi.fn(),entry:DraftEntry={scope,pending:()=>pending,prepare:()=>{const value=finiteNumber(raw);return{apply:()=>doc.transact('Field',d=>{d[key]=value;}),accept};},reject,focus,discard:()=>{pending=false;}};const off=controller.register(entry);return{entry,off,accept,reject,focus};};return{doc,controller,field,setScope:(v:string)=>{scope=v;}};}
it('flushes pending fields through one atomic caller transaction and accepts only after success',()=>{const s=setup(),a=s.field('a','5'),b=s.field('b','7');expect(s.controller.pending).toBe(true);s.controller.flush();expect(s.doc.current).toEqual({a:5,b:7});expect(a.accept).toHaveBeenCalledOnce();expect(b.accept).toHaveBeenCalledOnce();expect(s.controller.pending).toBe(false);s.doc.undo();expect(s.doc.current).toEqual({a:1,b:2});expect(s.doc.canUndo).toBe(false);});
it('does not partially commit when a later model/schema validation fails',()=>{const s=setup(),a=s.field('a','9'),b=s.field('b','-1'),before=s.doc.current;expect(()=>s.controller.flush()).toThrow('Negative');expect(s.doc.current).toBe(before);expect(s.doc.canUndo).toBe(false);expect(a.accept).not.toHaveBeenCalled();expect(b.reject).toHaveBeenCalledOnce();expect(b.focus).toHaveBeenCalledOnce();expect(s.controller.pending).toBe(true);});
it('prepares every field before any apply and reports the failing field',()=>{const s=setup(),a=s.field('a','9'),b=s.field('b','');expect(()=>s.controller.flush()).toThrow('finite');expect(s.doc.dirty).toBe(false);expect(a.accept).not.toHaveBeenCalled();expect(b.focus).toHaveBeenCalledOnce();});
it('ignores unmounted/stale-scope fields instead of applying them to a replaced context',()=>{const s=setup(),a=s.field('a','9');a.off();s.controller.flush();expect(s.doc.dirty).toBe(false);s.field('a','8');s.setScope('new-project:same-ids');expect(s.controller.pending).toBe(false);s.controller.flush();expect(s.doc.current.a).toBe(1);});
it('keeps blur errors local, supports discard and notifies pending-state subscribers',()=>{const s=setup(),notify=vi.fn(),off=s.controller.subscribe(notify),a=s.field('a','oops');expect(s.controller.commitOne(a.entry)).toBe(false);expect(a.reject).toHaveBeenCalled();expect(s.doc.dirty).toBe(false);s.controller.discard();expect(s.controller.pending).toBe(false);expect(notify).toHaveBeenCalled();off();});
it('validates finite numbers without treating empty or infinite values as zero',()=>{expect(finiteNumber('0')).toBe(0);expect(finiteNumber('1.25')).toBe(1.25);for(const raw of ['',' ','Infinity','1e999','invalid'])expect(()=>finiteNumber(raw)).toThrow('finite');});
it('discards only the focused current-scope draft without changing committed history',()=>{const s=setup(),a=s.field('a','9'),b=s.field('b','8');a.entry.isFocused=()=>false;b.entry.isFocused=()=>true;expect(s.controller.discardFocused()).toBe(true);expect(b.entry.pending()).toBe(false);expect(a.entry.pending()).toBe(true);expect(s.doc.current).toEqual({a:1,b:2});expect(s.doc.canUndo).toBe(false);expect(s.controller.discardFocused()).toBe(false);s.setScope('replacement');a.entry.isFocused=()=>true;expect(s.controller.discardFocused()).toBe(false);});
function liveSetup(){const doc=new DocumentSession({a:1,b:2},v=>{const value=v as {a:number;b:number};if(value.a<0)throw Error('Negative value');return value;});const controller=new DraftController({scope:()=>'s',batch:work=>doc.batch('Drafts',work),history:{length:()=>doc.historyLength,squash:from=>doc.squash(undefined,from),rollback:from=>doc.rollback(from)}});let raw='1',base='1';const entry:DraftEntry={scope:'s',pending:()=>raw!==base,prepare:()=>{const value=finiteNumber(raw);return{apply:()=>doc.transact('Field',d=>{d.a=value;}),accept:()=>{base=raw;}};},reject:vi.fn(),focus:vi.fn(),discard:()=>{raw=base;}};controller.register(entry);const type=(next:string)=>{raw=next;return controller.live(entry,()=>{const value=finiteNumber(next);doc.transact('Field',d=>{d.a=value;});});};return{doc,controller,entry,type};}
it('applies live values as they are typed and commits the whole edit as one undo step',()=>{const s=liveSetup();s.type('2');s.type('3');expect(s.doc.current.a).toBe(3);expect(s.controller.isLive(s.entry)).toBe(true);s.type('');expect(s.doc.current.a).toBe(3);s.type('4');expect(s.controller.commitOne(s.entry)).toBe(true);expect(s.doc.current.a).toBe(4);expect(s.doc.historyLength).toBe(1);expect(s.controller.isLive(s.entry)).toBe(false);s.doc.undo();expect(s.doc.current.a).toBe(1);});
it('rolls back live values on discard without leaving undo or redo steps',()=>{const s=liveSetup();s.type('5');s.type('-2');expect(s.doc.current.a).toBe(5);s.controller.revert(s.entry);expect(s.doc.current.a).toBe(1);expect(s.doc.canUndo).toBe(false);expect(s.doc.canRedo).toBe(false);expect(s.entry.pending()).toBe(false);});
it('leaves live steps alone when other edits came in between',()=>{const s=liveSetup();s.type('5');s.doc.transact('Other',d=>{d.b=9;});s.type('6');expect(s.controller.commitOne(s.entry)).toBe(true);expect(s.doc.current).toEqual({a:6,b:9});expect(s.doc.historyLength).toBe(3);});
it('rolls live values back when the commit fails',()=>{const s=liveSetup();s.type('7');s.type('-1');expect(s.doc.current.a).toBe(7);expect(s.controller.commitOne(s.entry)).toBe(false);expect(s.doc.current.a).toBe(1);expect(s.doc.canUndo).toBe(false);});

it('reads number fields: numbers, arithmetic, decimal commas and relative changes', async () => {
 const {finiteNumber, numberFrom, isRelativeNumber} = await import('./drafts-core');
 expect(finiteNumber('480/2')).toBe(240);
 expect(finiteNumber('(3 + 4) × 2')).toBe(14);
 expect(finiteNumber('1,5')).toBe(1.5);
 expect(finiteNumber('-5')).toBe(-5);
 expect(finiteNumber('2e3')).toBe(2000);
 expect(() => finiteNumber('')).toThrow('Enter a finite number');
 expect(() => finiteNumber('abc')).toThrow();
 expect(() => finiteNumber('1/0')).toThrow();
 expect(numberFrom('+10', 5)).toBe(15);
 expect(numberFrom('-=3', 5)).toBe(2);
 expect(numberFrom('*2', 5)).toBe(10);
 expect(numberFrom('÷4', 10)).toBe(2.5);
 expect(numberFrom('*(1+1)', 3)).toBe(6);
 expect(isRelativeNumber('-5')).toBe(false); expect(isRelativeNumber('+5')).toBe(true); expect(isRelativeNumber('×2')).toBe(true);
 expect(() => numberFrom('+10')).toThrow('This field has no single value to change');
});
