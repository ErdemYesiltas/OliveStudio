import { _electron as electron,expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { dirname,join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
const root=dirname(dirname(fileURLToPath(import.meta.url))),require=createRequire(join(root,'apps/editor-desktop/package.json'));
const temp=await mkdtemp(join(tmpdir(),'rewrite-compat-')),env={...process.env};delete env.ELECTRON_RUN_AS_NODE;let app;
try{
 app=await electron.launch({executablePath:require('electron'),args:[join(root,'apps/editor-desktop/out-experiments/main/index.js'),'--no-hub', `--user-data-dir=${temp}`],env});await app.firstWindow({timeout:30000});
 const created=app.waitForEvent('window');await app.evaluate(async({BrowserWindow},path)=>{const w=new BrowserWindow({width:900,height:700,webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true}});await w.loadFile(path);},join(root,'apps/editor-desktop/out-experiments/renderer/compatibility.html'));
 const page=await created;await page.getByRole('button',{name:'Run compatibility checks'}).click();
 await expect.poll(()=>page.locator('#result').getAttribute('data-status'),{timeout:30000}).not.toBe('running');
 const state=await page.locator('#result').getAttribute('data-status');console.log(await page.locator('#result').innerText());expect(state).toBe('passed');
 console.log('PASS compatibility: real Pixi GPU, controlled GSAP/Motion seek and independent real Howler sources');
}finally{await app?.close();await rm(temp,{recursive:true,force:true,maxRetries:3});}
