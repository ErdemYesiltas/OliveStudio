export interface PreparedDraft {apply():void;accept():void}
export interface DraftEntry {scope:string;pending():boolean;isFocused?():boolean;prepare():PreparedDraft;reject(error:unknown):void;focus():void;discard():void}
/** Undo history markers: live edits are merged into one step when the field commits, or rolled back when it is discarded. */
export interface DraftHistory {length():number;squash(from:number):void;rollback(from:number):void}
type LiveSession={marker:number;expected:number};
/** One editor instance; synchronous validation/commands only, with a caller-owned transaction. */
export class DraftController {
 private entries=new Set<DraftEntry>();private listeners=new Set<()=>void>();private working=false;private revision=0;private sessions=new Map<DraftEntry,LiveSession>();
 constructor(private options:{scope():string;batch(work:()=>void):void;history?:DraftHistory}){}
 get version(){return this.revision;}
 get pending(){return [...this.entries].some(entry=>entry.scope===this.options.scope()&&entry.pending());}
 subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
 changed=()=>{this.revision++;for(const listener of this.listeners)listener();};
 register(entry:DraftEntry){this.entries.add(entry);this.changed();return()=>{this.endLive(entry,true);this.entries.delete(entry);this.changed();};}
 /**
  * Applies a field's value while it is being edited, so the canvas follows along. The first live change opens a session;
  * committing the field merges the session into one undo step, discarding it rolls the document back. Errors are
  * swallowed (the commit reports them). Returns whether the value was applied.
  */
 live(entry:DraftEntry,work:()=>void):boolean{
  const history=this.options.history;
  if(!history||this.working||!this.entries.has(entry)||entry.scope!==this.options.scope())return false;
  let session=this.sessions.get(entry);
  if(session&&history.length()!==session.expected){this.sessions.delete(entry);session=undefined;}
  const marker=session?.marker??history.length();
  this.working=true;
  try{this.options.batch(work);}catch{return false;}finally{this.working=false;}
  if(session||history.length()!==marker)this.sessions.set(entry,{marker,expected:history.length()});
  return true;
 }
 isLive(entry:DraftEntry){return this.sessions.has(entry);}
 /** Rolls back a field's live edits and resets it to its committed value. */
 revert(entry:DraftEntry){this.endLive(entry,false);entry.discard();this.changed();}
 /** Ends a session: kept (one undo step) or rolled back, unless other edits came in between (then it stays as it is). */
 private endLive(entry:DraftEntry,keep:boolean){
  const session=this.sessions.get(entry),history=this.options.history;
  if(!session||!history)return;
  this.sessions.delete(entry);
  if(history.length()!==session.expected)return;
  try{if(keep)history.squash(session.marker);else history.rollback(session.marker);}catch{/* history was replaced */}
 }
 /** The live session among `entries` that the history still ends with (others are closed and left as they are). */
 private takeLive(entries:readonly DraftEntry[]){
  const history=this.options.history;let found:LiveSession|undefined;
  for(const entry of entries){const session=this.sessions.get(entry);if(!session)continue;this.sessions.delete(entry);if(history&&history.length()===session.expected)found=session;}
  return found;
 }
 flush(){this.commit([...this.entries].filter(entry=>entry.scope===this.options.scope()&&entry.pending()));}
 commitOne(entry:DraftEntry):boolean{try{this.commit(this.entries.has(entry)?[entry]:[]);return true;}catch{return false;}}
 private commit(entries:DraftEntry[]){if(!entries.length)return;if(this.working)throw Error('An edit is already being applied');this.working=true;let active=entries[0];const prepared:PreparedDraft[]=[],session=this.takeLive(entries),history=this.options.history;
  try{for(const entry of entries){active=entry;if(entry.scope!==this.options.scope())throw Error('Editor context changed');if(entry.pending()){const draft=entry.prepare();prepared.push({apply(){active=entry;draft.apply();},accept:()=>draft.accept()});}}
   this.options.batch(()=>{for(const draft of prepared)draft.apply();});
   if(session&&history)history.squash(session.marker);
   for(const draft of prepared)draft.accept();
  }catch(error){if(session&&history)try{history.rollback(session.marker);}catch{/* history was replaced */}active.reject(error);active.focus();throw error;}finally{this.working=false;this.changed();}
 }
 discardFocused(){const entry=[...this.entries].find(entry=>entry.scope===this.options.scope()&&(entry.pending()||this.sessions.has(entry))&&entry.isFocused?.());if(!entry)return false;this.revert(entry);return true;}
 discard(){for(const entry of this.entries)if(entry.scope===this.options.scope()){this.endLive(entry,false);entry.discard();}this.changed();}
}
/** A number field's text: a number or arithmetic (+ − × ÷, parentheses; × ÷ and a decimal comma accepted). */
function evaluate(raw:string):number{
 const text=raw.replace(/×/g,'*').replace(/÷/g,'/').replace(/−/g,'-').replace(/(\d),(\d)/g,'$1.$2');let i=0;
 const skip=()=>{while(text[i]===' ')i++;};
 const atom=():number=>{skip();if(text[i]==='('){i++;const v=sum();skip();if(text[i]!==')')throw Error('Missing )');i++;return v;}if(text[i]==='-'){i++;return -atom();}if(text[i]==='+'){i++;return atom();}const m=/^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(text.slice(i));if(!m)throw Error('Enter a finite number');i+=m[0].length;return Number(m[0]);};
 const product=():number=>{let v=atom();for(;;){skip();const op=text[i];if(op!=='*'&&op!=='/')return v;i++;const r=atom();v=op==='*'?v*r:v/r;}};
 const sum=():number=>{let v=product();for(;;){skip();const op=text[i];if(op!=='+'&&op!=='-')return v;i++;const r=product();v=op==='+'?v+r:v-r;}};
 const value=sum();skip();if(i<text.length||!Number.isFinite(value))throw Error('Enter a finite number');return value;
}
const RELATIVE=/^\s*(\+=|-=|\*=|\/=|×=|÷=|\+|\*|\/|×|÷)\s*(.+)$/;
/** `+10`, `*2`, `/4`, `-=5` (and × ÷): changes the current value; a plain `-5` is still minus five. */
export const isRelativeNumber=(raw:string)=>RELATIVE.test(raw);
/** A number field's value: a number, arithmetic (`480/2`), or a change of `current` when it starts with an operator. */
export function numberFrom(raw:string,current?:number):number{
 if(!raw.trim())throw Error('Enter a finite number');
 const m=RELATIVE.exec(raw);if(!m)return evaluate(raw);
 if(current===undefined||!Number.isFinite(current))throw Error('This field has no single value to change');
 const by=evaluate(m[2]),op=m[1][0],value=op==='+'?current+by:op==='-'?current-by:op==='*'||op==='×'?current*by:current/by;
 if(!Number.isFinite(value))throw Error('Enter a finite number');return value;
}
export function finiteNumber(raw:string):number{return numberFrom(raw);}
