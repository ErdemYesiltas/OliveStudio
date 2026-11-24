/** Owns startup cancellation independently of unrelated file/build busy operations. */
export class PreviewPreparation {
 private current?:AbortController;
 constructor(private changed:(preparing:boolean)=>void){}
 begin(){if(this.current)throw Error('Preview is already preparing');const token=new AbortController();this.current=token;this.changed(true);return token;}
 owns(token:AbortController){return this.current===token&&!token.signal.aborted;}
 cancel(){const token=this.current;if(!token)return;this.current=undefined;token.abort();this.changed(false);}
 finish(token:AbortController){if(this.current!==token)return;this.current=undefined;this.changed(false);}
 async wait<T>(token:AbortController,work:Promise<T>):Promise<T>{
  const signal=token.signal;signal.throwIfAborted();let abort!:()=>void;
  const cancelled=new Promise<never>((_resolve,reject)=>{abort=()=>reject(signal.reason);signal.addEventListener('abort',abort,{once:true});});
  try{const result=await Promise.race([work,cancelled]);signal.throwIfAborted();return result;}finally{signal.removeEventListener('abort',abort);}
 }
}
export function playbackDisabled(icon:string,state:{busy:boolean;previewPreparing:boolean;mode:'edit'|'playing'|'paused'}){
 if(icon==='stop'&&state.previewPreparing)return false;
 return state.busy||(icon==='play'?state.mode!=='edit':icon==='step'?state.mode!=='paused':state.mode==='edit');
}
