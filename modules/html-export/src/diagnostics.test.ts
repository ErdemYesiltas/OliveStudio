import {expect,it} from 'vitest';
import {installRuntimeDiagnostics,type RuntimeErrorRecord} from './diagnostics';
it('records attributed errors without hiding them and removes listeners on cleanup',()=>{
 const target=new EventTarget(),entries:RuntimeErrorRecord[][]=[];
 const off=installRuntimeDiagnostics(target as unknown as Window,e=>entries.push([...e]));
 const e=new Event('error');Object.assign(e,{message:'observe target is not a Node',filename:'accessibility.js',lineno:42,colno:7,error:new Error('observe')});
 target.dispatchEvent(e);expect(e.defaultPrevented).toBe(false);expect(entries[0][0]).toMatchObject({source:'accessibility.js',line:42,column:7,stack:expect.stringContaining('observe')});
 off();target.dispatchEvent(e);expect(entries).toHaveLength(1);
});
