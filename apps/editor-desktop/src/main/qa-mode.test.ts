import {expect,it,vi} from 'vitest';
import {mkdtemp,mkdir,readFile,writeFile,rm,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const handlers=new Map<string,(event:unknown,...args:unknown[])=>unknown>();
vi.mock('electron',()=>({ipcMain:{handle:(channel:string,fn:(event:unknown,...args:unknown[])=>unknown)=>handlers.set(channel,fn),removeHandler:(channel:string)=>handlers.delete(channel),on(){},removeListener(){}}}));
const {registerMcp,readQaMode,McpConfigSchema}=await import('./native-mcp');
const {AutomationFileScope}=await import('./automation-files');
const flush=()=>new Promise(r=>setTimeout(r,20));
it('reads configs from before QA mode as off, and treats a broken file as off',async()=>{
 expect(McpConfigSchema.parse({enabled:true,port:47821,token:'a'.repeat(32)})).toMatchObject({qaMode:false,folders:[]});
 const dir=await mkdtemp(join(tmpdir(),'qa-'));try{expect(readQaMode(join(dir,'missing.json'))).toBe(false);await writeFile(join(dir,'bad.json'),'{');expect(readQaMode(join(dir,'bad.json'))).toBe(false);}finally{await rm(dir,{recursive:true,force:true});}
});
it('remembers granted folders only in QA mode and grants them again after a restart',async()=>{
 const dir=await realpath(await mkdtemp(join(tmpdir(),'qa-'))),configPath=join(dir,'mcp.json'),kept=join(dir,'kept'),gone=join(dir,'gone');await mkdir(kept);
 try{const changes:boolean[]=[],scope=new AutomationFileScope(()=>null);await scope.grant(kept);
  const make=(s:InstanceType<typeof AutomationFileScope>)=>registerMcp({window:()=>null,sender(){},configPath,version:'test',stdioScript:'x',scope:s,onQaMode:on=>changes.push(on)});
  let mcp=make(scope);await flush();expect(JSON.parse(await readFile(configPath,'utf8'))).toMatchObject({qaMode:false,folders:[]});
  await mcp.remember();expect(JSON.parse(await readFile(configPath,'utf8')).folders).toEqual([]);
  const status=await handlers.get('mcp:configure')!({}, {qaMode:true}) as {qaMode:boolean;folders:string[]};expect(status).toMatchObject({qaMode:true,folders:[kept]});expect(changes).toEqual([true]);
  // A folder removed from disk is dropped when the grants come back.
  await writeFile(configPath,JSON.stringify({...JSON.parse(await readFile(configPath,'utf8')),folders:[kept,gone]}));
  await mcp.dispose();const restarted=new AutomationFileScope(()=>null);mcp=make(restarted);await flush();
  expect(restarted.roots).toEqual([kept]);expect(JSON.parse(await readFile(configPath,'utf8')).folders).toEqual([kept]);expect(readQaMode(configPath)).toBe(true);
  await handlers.get('mcp:configure')!({}, {qaMode:false});expect(JSON.parse(await readFile(configPath,'utf8'))).toMatchObject({qaMode:false,folders:[]});expect(changes).toEqual([true,false]);
  await mcp.dispose();
 }finally{await rm(dir,{recursive:true,force:true});}
});
