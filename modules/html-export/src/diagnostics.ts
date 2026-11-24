/** Keep the original browser error visible, with enough attribution to investigate embedded-browser failures. */
export interface RuntimeErrorRecord {message:string;source:string;line:number;column:number;stack:string;time:number}
export function installRuntimeDiagnostics(target:Window,record:(errors:readonly RuntimeErrorRecord[])=>void){
 const errors:RuntimeErrorRecord[]=[];
 const add=(e:RuntimeErrorRecord)=>{errors.push(e);if(errors.length>10)errors.shift();record([...errors]);};
 const error=(e:ErrorEvent)=>add({message:String(e.message).slice(0,1000),source:String(e.filename??'').slice(0,1000),line:e.lineno??0,column:e.colno??0,stack:String(e.error?.stack??'').slice(0,4000),time:Date.now()});
 const rejection=(e:PromiseRejectionEvent)=>add({message:String(e.reason?.message??e.reason).slice(0,1000),source:'unhandledrejection',line:0,column:0,stack:String(e.reason?.stack??'').slice(0,4000),time:Date.now()});
 target.addEventListener('error',error);target.addEventListener('unhandledrejection',rejection);
 return()=>{target.removeEventListener('error',error);target.removeEventListener('unhandledrejection',rejection);};
}
if(typeof window!=='undefined')installRuntimeDiagnostics(window,errors=>{document.documentElement.dataset.runtimeErrors=JSON.stringify(errors);});
