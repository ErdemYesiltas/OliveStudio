import { _electron as electron,expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { dirname,join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp,rm,mkdir,readFile,cp,readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
const root=dirname(dirname(fileURLToPath(import.meta.url))),require=createRequire(join(root,'apps/editor-desktop/package.json')),sharp=require('sharp');
const temp=await mkdtemp(join(tmpdir(),'rewrite-assets-native-')),env={...process.env};delete env.ELECTRON_RUN_AS_NODE;let app,page;
try{
 const first=join(temp,'native-image.png'),second=join(temp,'replacement.jpg');
 await sharp({create:{width:144,height:80,channels:4,background:'#e59b47'}}).png().toFile(first);
 await sharp({create:{width:240,height:120,channels:3,background:'#4d9bd9'}}).jpeg({quality:100}).toFile(second);
 app=await electron.launch({executablePath:process.env.REWRITE_EXECUTABLE||require('electron'),args:[...(process.env.REWRITE_EXECUTABLE?[]:[join(root,'apps/editor-desktop/out/main/index.js')]),'--no-hub', `--user-data-dir=${join(temp,'user')}`],env});
 page=await app.firstWindow({timeout:30000});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await expect(page.getByTestId('pixi-canvas')).toHaveAttribute('data-ready','true',{timeout:30000});
 const menu=async(label)=>app.evaluate(({Menu},text)=>{const group=Menu.getApplicationMenu().items.find(m=>m.submenu?.items.some(i=>i.label===text));group.submenu.items.find(i=>i.label===text).click();},label);
 const choose=async(path)=>app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});dialog.showMessageBox=async()=>({response:1,checkboxChecked:false});},path);
 const library=async()=>{if(!await page.getByRole('button',{name:'Import image…',exact:true}).isVisible())await page.getByRole('button',{name:'Library',exact:true}).click();};
 const save=async(path)=>{await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},path);await menu('Save');await expect(page.getByLabel('Unsaved changes',{exact:true})).toHaveCount(0,{timeout:30000});return JSON.parse(await readFile(path,'utf8'));};
 const textures=()=>page.getByTestId('pixi-canvas');
 await choose(first);await library();await page.getByRole('button',{name:'Import image…',exact:true}).click();
 await expect(page.getByRole('button',{name:'Place native-image',exact:true})).toBeVisible({timeout:30000});
 await page.getByRole('button',{name:'Place native-image',exact:true}).click();await expect(textures()).toHaveAttribute('data-loaded-textures','1',{timeout:30000});await expect(textures()).toHaveAttribute('data-missing-assets','[]');
 const info=await page.evaluate(()=>window.platform.assets.info()),mainPid=await app.evaluate(()=>process.pid);expect(info.workerProcessId).toBeGreaterThan(0);expect(info.workerProcessId).not.toBe(mainPid);
 // The Library popover is wide enough to cover the canvas centre: close it before sampling the placed image.
 await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'Place native-image',exact:true})).toBeHidden();
 const screenshot=await textures().screenshot(),bounds=await textures().boundingBox(),ratio=(await sharp(screenshot).metadata()).width/bounds.width,pixel=await sharp(screenshot).extract({left:Math.floor((Math.floor(bounds.width/2)+20)*ratio),top:Math.floor((Math.floor(bounds.height/2)+10)*ratio),width:1,height:1}).removeAlpha().raw().toBuffer();
 for(const[i,value]of[229,155,71].entries())expect(Math.abs(pixel[i]-value)).toBeLessThanOrEqual(2);
 const file=join(temp,'project.pixieditor');let project=await save(file),record=project.extensions['assets.registry'].items[0];
 expect(record.metadata).toMatchObject({width:144,height:80,pipeline:expect.stringContaining('assetpack')});expect(await readdir(file+'.assets/sources')).toContain(`${record.id}-${record.revision}.png`);
 const source=record.id;await library();await page.getByRole('button',{name:'Rename native-image',exact:true}).click();const assetName=page.getByRole('textbox',{name:'Asset name',exact:true});await assetName.fill('Renamed image');await assetName.press('Enter');
 await choose(second);await page.getByRole('button',{name:'Reimport Renamed image',exact:true}).click();await expect(page.getByText('JPG ·',{exact:false})).toBeVisible({timeout:30000});await expect(textures()).toHaveAttribute('data-loaded-textures','1');
 project=await save(file);const replacement=project.extensions['assets.registry'].items[0];expect(replacement.id).toBe(source);expect(replacement.revision).not.toBe(record.revision);expect(project.scenes[0].entities.find(e=>e.components.some(c=>c.type==='pixi.sprite')).components.find(c=>c.type==='pixi.sprite').data).toMatchObject({width:144,height:80,assetId:source});
 await menu('Undo');await library();await expect(page.getByText('PNG ·',{exact:false})).toBeVisible();await expect(textures()).toHaveAttribute('data-loaded-textures','1');await menu('Redo');await expect(page.getByText('JPG ·',{exact:false})).toBeVisible();
 await page.getByRole('button',{name:'Properties',exact:true}).click();await expect(page.getByRole('button',{name:'Pin Properties',exact:true})).toBeVisible();await page.locator('details').filter({has:page.locator('summary',{hasText:'Sprite'})}).locator('summary').click();
 await expect(page.getByRole('spinbutton',{name:'width',exact:true})).toHaveValue('144');await page.getByRole('button',{name:'Use native size',exact:true}).click();await expect(page.getByRole('spinbutton',{name:'width',exact:true})).toHaveValue('240');await menu('Undo');await expect(page.getByRole('spinbutton',{name:'width',exact:true})).toHaveValue('144');
 await library();await page.getByRole('button',{name:'Pin Library',exact:true}).click();const card=page.getByRole('button',{name:'Place Renamed image',exact:true}),from=await card.boundingBox(),canvas=await textures().boundingBox();
 await page.mouse.move(from.x+from.width/2,from.y+from.height/2);await page.mouse.down();await page.mouse.move(from.x-20,from.y+20,{steps:4});await page.mouse.move(canvas.x+canvas.width*.3,canvas.y+canvas.height*.55,{steps:16});await page.mouse.up();
 project=await save(file);expect(project.scenes[0].entities.filter(e=>e.components.some(c=>c.type==='pixi.sprite'))).toHaveLength(2);
 const relocated=join(temp,'portable','scene.pixieditor');await mkdir(dirname(relocated),{recursive:true});await cp(file,relocated);await cp(file+'.assets/sources',relocated+'.assets/sources',{recursive:true});await rm(first);await rm(second);
 await menu('New project');await expect(page.getByText('Untitled scene',{exact:true})).toBeVisible();await expect(page.getByTestId('editor-shell')).toHaveAttribute('aria-busy','false');await choose(relocated);await menu('Open…');await expect(textures()).toHaveAttribute('data-loaded-textures','1',{timeout:30000});await expect(textures()).toHaveAttribute('data-missing-assets','[]');
 await library();const previousWorker=(await page.evaluate(()=>window.platform.assets.info())).workerProcessId;await page.getByRole('button',{name:'Rebuild asset cache'}).click();await expect.poll(async()=>(await page.evaluate(()=>window.platform.assets.info())).workerProcessId,{timeout:30000}).not.toBe(previousWorker);await expect(page.getByRole('button',{name:'Rebuild asset cache'})).toBeEnabled({timeout:30000});
 await expect(page.getByLabel('Unsaved changes',{exact:true})).toHaveCount(0);
 const forgedStatus=await page.evaluate(async()=>{const info=await window.platform.assets.info();return(await fetch(`pixi-editor-asset://${info.sessionId}/not-a-guid/not-a-hash/private.txt`)).status;});expect(forgedStatus).toBe(400);
 await mkdir(join(root,'outputs'),{recursive:true});await page.screenshot({path:join(root,'outputs/editor-assets.png')});
 // A missing source must not retain a texture from the previous native session.
 await rm(relocated+'.assets/sources',{recursive:true});await choose(relocated);await menu('Open…');await expect(page.getByRole('alert')).toContainText('sources');await page.getByRole('button',{name:'Dismiss message'}).click();
 await expect.poll(async()=>JSON.parse(await textures().getAttribute('data-missing-assets')).length).toBe(2);await expect(textures()).toHaveAttribute('data-loaded-textures','0');
 await page.getByRole('button',{name:'Play',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Textures');
 expect(errors).toEqual([]);
 console.log('PASS native assets: separate AssetPack worker, real GPU pixels, import/reimport/rename/undo, native size, dnd-kit canvas drop, source-only portable reopen, rebuild, URL boundary and missing-source session isolation');
}catch(error){if(page){await mkdir(join(root,'outputs'),{recursive:true});await page.screenshot({path:join(root,'outputs/assets-failure.png')}).catch(()=>{});console.error(await page.locator('body').innerText().catch(()=>''));}throw error;}
finally{if(app){await app.evaluate(({BrowserWindow})=>{for(const w of BrowserWindow.getAllWindows())w.destroy();}).catch(()=>{});await app.close().catch(()=>{});}await rm(temp,{recursive:true,force:true,maxRetries:3});}
