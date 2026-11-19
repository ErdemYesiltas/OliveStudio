import {createContext,useContext,useEffect,useId,useLayoutEffect,useRef,type InputHTMLAttributes,type ReactNode} from 'react';
import {useForm} from 'react-hook-form';
import {Subject,animationFrameScheduler,auditTime} from 'rxjs';
import {DraftController,isRelativeNumber,numberFrom,type DraftEntry} from './drafts-core';
export {DraftController,finiteNumber,numberFrom,isRelativeNumber,type DraftHistory} from './drafts-core';
const DraftContext=createContext<{controller:DraftController;scope:string}|null>(null);
export function DraftProvider({controller,scope,children}:{controller:DraftController;scope:string;children:ReactNode}){return <DraftContext.Provider value={{controller,scope}}>{children}</DraftContext.Provider>;}
export const useDraftController=()=>useContext(DraftContext)?.controller;
/**
 * A field that commits on Enter/blur (Escape discards). `live`: valid values are also applied while typing, dragging a
 * colour or stepping a number (at most once per frame), and the whole edit becomes one undo step when it commits.
 * `type="number"`: a spin button that also takes arithmetic (`480/2`) and changes of the value it had when the edit
 * began (`+10`, `*2`, `-=5`); ↑/↓ step by `step` (1), Shift ×10, Alt ×0.1. With no single value (mixed), a change
 * reaches `commit` as typed so the caller can apply it per object.
 */
export function CommitInput({value,commit,label,onCommitted,onError,live=false,...attributes}:{value:string|number;commit(raw:string):void|boolean;label:string;onCommitted?():void;onError?(error:unknown):void;live?:boolean}&Omit<InputHTMLAttributes<HTMLInputElement>,'value'|'defaultValue'|'onChange'|'onBlur'|'onKeyDown'|'onError'>){
 const context=useContext(DraftContext),input=useRef<HTMLInputElement|null>(null),base=useRef(String(value)),composing=useRef(false),errorId=useId();
 const {register,reset,getValues,setError,clearErrors,formState:{errors}}=useForm<{value:string}>({defaultValues:{value:String(value)}});
 const latest=useRef({commit,onCommitted,onError,disabled:attributes.disabled,value});latest.current={commit,onCommitted,onError,disabled:attributes.disabled,value};
 const raw=()=>input.current?.value??getValues('value');
 const numeric=attributes.type==='number',{type:_type,step,min,max,...rest}=attributes;
 /**
  * Arithmetic becomes its result (the field then shows the number), and a relative entry the result against the value
  * the edit started from; with no single value (mixed) a relative entry stays as typed for the caller.
  */
 /** The value this field shows is one number (a mixed selection shows none). */
 const known=()=>base.current.trim()!==''&&Number.isFinite(Number(base.current));
 const resolve=(text:string)=>{if(!numeric)return text;try{if(isRelativeNumber(text))return known()?String(numberFrom(text,Number(base.current))):text;return String(numberFrom(text));}catch{return text;}};
 const entry=useRef<DraftEntry|null>(null);
 if(!entry.current)entry.current={scope:'',isFocused:()=>input.current===document.activeElement,pending:()=>composing.current||raw()!==base.current,prepare:()=>{if(composing.current)throw Error('Finish composing this value before saving');const text=resolve(raw());return{apply(){if(latest.current.disabled)throw Error('This field is not editable');if(latest.current.commit(text)===false)throw Error('Value could not be applied');},accept(){/* A relative change on a mixed selection leaves it mixed: show no number, not the typed change. */const shown=numeric&&!known()&&isRelativeNumber(text)?'':text;base.current=shown;reset({value:shown});if(input.current)input.current.value=shown;clearErrors();latest.current.onCommitted?.();}};},reject(error){setError('value',{message:error instanceof Error?error.message:String(error)});latest.current.onError?.(error);},focus(){requestAnimationFrame(()=>{if(input.current?.isConnected)input.current.focus();});},discard(){const text=base.current;reset({value:text});if(input.current)input.current.value=text;clearErrors();composing.current=false;}};
 const edits=useRef(new Subject<string>());
 useLayoutEffect(()=>{const handle=entry.current!;handle.discard();handle.scope=context?.scope??'';return context?.controller.register(handle);},[context?.controller,context?.scope]);
 useLayoutEffect(()=>{if(context?.controller.isLive(entry.current!))return;base.current=String(value);entry.current!.discard();context?.controller.changed();},[value]);
 useEffect(()=>{
  if(!live||!context)return;
  const controller=context.controller;
  const sub=edits.current.pipe(auditTime(0,animationFrameScheduler)).subscribe(text=>{
   if(composing.current||raw()!==text||latest.current.disabled)return;
   // A change of each object's own value (mixed selection) is not repeatable: it applies once, on commit.
   if(numeric&&!known()&&isRelativeNumber(text))return;
   controller.live(entry.current!,()=>{if(latest.current.commit(resolve(text))===false)throw Error('Value could not be applied');});
  });
  return()=>sub.unsubscribe();
 },[live,context?.controller]);
 const apply=()=>{const handle=entry.current!;if(!handle.pending()){if(context?.controller.isLive(handle))context.controller.revert(handle);latest.current.onCommitted?.();return;}if(context)context.controller.commitOne(handle);else try{const prepared=handle.prepare();prepared.apply();prepared.accept();}catch(error){handle.reject(error);}};
 const registered=register('value');
 const stepBy=(direction:1|-1,shift:boolean,alt:boolean)=>{const node=input.current;if(!node)return;let current:number;try{current=numberFrom(raw(),Number(base.current));}catch{current=Number(base.current);}if(!Number.isFinite(current))current=0;
  const unit=typeof step==='number'||(typeof step==='string'&&Number.isFinite(Number(step)))?Number(step):1,by=(unit||1)*(shift?10:alt?.1:1);let next=Math.round((current+direction*by)*1e6)/1e6;
  if(min!==undefined&&Number.isFinite(Number(min)))next=Math.max(Number(min),next);if(max!==undefined&&Number.isFinite(Number(max)))next=Math.min(Number(max),next);
  node.value=String(next);void registered.onChange({target:node,type:'change'});clearErrors();context?.controller.changed();if(live)edits.current.next(node.value);};
 return <><input {...(numeric?rest:attributes)} {...(numeric?{type:'text',inputMode:'decimal' as const,role:'spinbutton',autoComplete:'off',spellCheck:false,'aria-valuenow':Number.isFinite(Number(value))&&String(value).trim()?Number(value):undefined,...(min!==undefined?{'aria-valuemin':Number(min)}:{}),...(max!==undefined?{'aria-valuemax':Number(max)}:{})}:{})} {...registered} aria-label={label} aria-invalid={Boolean(errors.value)} aria-errormessage={errors.value?errorId:undefined} ref={node=>{input.current=node;registered.ref(node);}} onChange={e=>{void registered.onChange(e);clearErrors();context?.controller.changed();if(live)edits.current.next(e.target.value);}} onBlur={apply} onCompositionStart={()=>{composing.current=true;context?.controller.changed();}} onCompositionEnd={()=>{composing.current=false;context?.controller.changed();}} onKeyDown={e=>{if(composing.current||e.nativeEvent.isComposing)return;if(numeric&&(e.key==='ArrowUp'||e.key==='ArrowDown')){e.preventDefault();stepBy(e.key==='ArrowUp'?1:-1,e.shiftKey,e.altKey);return;}if(e.key==='Enter'){e.preventDefault();apply();}if(e.key==='Escape'&&(entry.current!.pending()||errors.value||context?.controller.isLive(entry.current!))){e.preventDefault();e.stopPropagation();if(context)context.controller.revert(entry.current!);else entry.current!.discard();}}}/>{errors.value&&<small role="alert" id={errorId} className="component-warning">{errors.value.message}</small>}</>;
}
