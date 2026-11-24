/** Serializes last-release/unload against a new load; callers release exactly once. */
export class SharedResource<T>{
 private ready?:Promise<T>;private closing:Promise<void>=Promise.resolve();private references=0;
 constructor(private load:()=>Promise<T>,private unload:(value:T)=>Promise<void>){}
 async acquire(){this.references++;const ready=this.ready??(this.ready=this.closing.then(this.load));let value:T;
  try{value=await ready;}catch(error){this.references--;if(this.ready===ready)this.ready=undefined;throw error;}
  let released=false;return{value,release:async()=>{if(released)return;released=true;if(--this.references!==0)return;if(this.ready===ready)this.ready=undefined;const close=ready.then(this.unload);this.closing=close.catch(()=>{});await close;}};
 }
 get refs(){return this.references;}
}
