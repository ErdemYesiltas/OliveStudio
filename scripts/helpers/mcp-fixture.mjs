import {_electron as electron,expect} from '@playwright/test';
import {mkdtemp,realpath,mkdir,writeFile,rm} from 'node:fs/promises';
import {createServer} from 'node:net';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
export const workspace=dirname(dirname(dirname(fileURLToPath(import.meta.url))));
export async function freePort(){const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;}
export async function launchMcpFixture(prefix='specialists'){
 const temp=await realpath(await mkdtemp(join(tmpdir(),`olive-${prefix}-`))),profile=join(temp,'user'),port=await freePort(),token='fixture-'+crypto.randomUUID().replaceAll('-','');
 await mkdir(profile);await writeFile(join(profile,'mcp.json'),JSON.stringify({enabled:true,port,token}));
 const require=createRequire(join(workspace,'apps/editor-desktop/package.json')),env={...process.env,GIT_AUTHOR_NAME:'Automation fixture',GIT_AUTHOR_EMAIL:'fixture@example.invalid',GIT_COMMITTER_NAME:'Automation fixture',GIT_COMMITTER_EMAIL:'fixture@example.invalid'};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch({executablePath:process.env.REWRITE_EXECUTABLE||require('electron'),args:[...(process.env.REWRITE_EXECUTABLE?[]:[join(workspace,'apps/editor-desktop/out/main/index.js')]),'--no-hub',`--user-data-dir=${profile}`],env}),page=await app.firstWindow();
 page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(e.message));await expect(page.getByTestId('pixi-canvas')).toHaveAttribute('data-ready','true',{timeout:30000});
 let seq=0;const url=`http://127.0.0.1:${port}/mcp`;
 const rpc=async(method,params)=>{const res=await fetch(url,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++seq,method,params})});expect(res.status).toBe(200);return res.json();};
 const raw=(name,args={})=>rpc('tools/call',{name,arguments:args});
 const call=async(name,args={})=>{const r=await raw(name,args);expect(r.error,JSON.stringify(r)).toBeUndefined();expect(r.result.isError,JSON.stringify(r)).toBe(false);return JSON.parse(r.result.content[0].text);};
 const job=async handle=>{await expect.poll(async()=>{const j=await call('automation.job',{id:handle.id,waitMs:1000});if(j.state==='failed')throw Error(JSON.stringify(j.error));return j.state;},{timeout:90000}).toBe('complete');return(await call('automation.job',{id:handle.id})).result;};
 const approve=async handle=>{await expect(page.getByTestId('automation-approval')).toHaveAttribute('data-job-id',handle.id);await page.getByRole('button',{name:'Approve',exact:true}).click();return job(handle);};
 const grant=async(folder=temp)=>{await app.evaluate(({dialog,Menu},folder)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[folder]});dialog.showMessageBox=async()=>({response:1,checkboxChecked:false});Menu.getApplicationMenu().items.flatMap(m=>m.submenu?.items??[]).find(i=>i.label==='Settings…').click();},folder);const settings=page.getByTestId('settings-dialog');await settings.getByRole('navigation',{name:'Settings sections',exact:true}).getByRole('button',{name:'MCP server',exact:true}).click();await settings.getByRole('button',{name:'Allow folder',exact:true}).click();await page.keyboard.press('Escape');};
 return{app,page,temp,profile,errors,url,token,rpc,raw,call,job,approve,grant,async close(){await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});await rm(temp,{recursive:true,force:true,maxRetries:3});}};
}
