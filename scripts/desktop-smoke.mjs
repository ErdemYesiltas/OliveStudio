import { _electron as electron, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { join,dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp,rm,mkdir,readFile,writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
const root=dirname(dirname(fileURLToPath(import.meta.url))),require=createRequire(join(root,'apps/editor-desktop/package.json'));
const temp=await mkdtemp(join(tmpdir(),'pixi-rewrite-')),env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const empty=process.argv.includes('--empty');let app;
try{
 app=await electron.launch({executablePath:process.env.REWRITE_EXECUTABLE||require('electron'),args:[...(process.env.REWRITE_EXECUTABLE?[]:[join(root,`apps/editor-desktop/${empty?'out-empty':'out'}/main/index.js`)]),'--no-hub', `--user-data-dir=${join(temp,'user')}`],env});
 const page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error')console.error('Renderer:',m.text());});
 await expect(page.getByTestId('editor-shell')).toBeVisible({timeout:30000});
 expect(await page.evaluate(()=>({require:typeof globalThis.require,process:typeof globalThis.process}))).toEqual({require:'undefined',process:'undefined'});
 if(empty){await expect(page.getByText('The empty profile is running.',{exact:false})).toBeVisible();console.log('PASS empty native profile: no domain modules, sandbox and shell');}
 else{
  await expect(page.getByTestId('pixi-canvas')).toHaveAttribute('data-ready','true',{timeout:30000});await expect(page.getByTestId('pixi-canvas')).toHaveAttribute('data-renderer','1');
  await page.getByRole('button',{name:'Layers',exact:true}).click();await page.getByRole('button',{name:'Select Player',exact:true}).click();
  await page.keyboard.press('Escape');await page.getByRole('button',{name:'Properties',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'Object name',exact:true})).toHaveValue('Player');
  const x=page.getByRole('spinbutton',{name:'x',exact:true});await x.fill('450');await x.press('Enter');
  await expect(page.getByLabel('Unsaved changes',{exact:true})).toBeVisible();
  await expect.poll(async()=>{const values=JSON.parse(await page.getByTestId('pixi-canvas').getAttribute('data-transforms'));return Object.values(values).some(t=>t.x===450);}).toBe(true);
  await mkdir(join(root,'outputs'),{recursive:true});await page.screenshot({path:join(root,'outputs/editor-floating.png')});
  const nativeEdit=async name=>app.evaluate(({Menu},label)=>{const edit=Menu.getApplicationMenu().items.find(item=>item.label==='Edit');const item=edit.submenu.items.find(item=>item.label===label);item.click();},name);
  await nativeEdit('Undo');await expect(x).toHaveValue('420');await nativeEdit('Redo');await expect(x).toHaveValue('450');
  await page.getByRole('button',{name:'Pin Properties',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'Object name',exact:true})).toHaveValue('Player');await expect(x).toHaveValue('450');
  for(const theme of ['Light','Warm','Graphite']){
   await page.getByRole('button',{name:'Editor settings'}).click();await page.getByRole('menuitem',{name:theme,exact:true}).click();
   await expect(page.locator('html')).toHaveAttribute('data-theme',theme.toLowerCase());await page.screenshot({path:join(root,`outputs/editor-${theme.toLowerCase()}.png`)});
  }
  await page.getByRole('button',{name:'Editor settings'}).click();await page.getByRole('menuitem',{name:'System',exact:true}).click();
  await page.emulateMedia({colorScheme:'light'});await expect(page.locator('html')).toHaveAttribute('data-theme','light');await page.emulateMedia({colorScheme:'dark'});await expect(page.locator('html')).toHaveAttribute('data-theme','graphite');
  await page.getByRole('button',{name:'Editor settings'}).click();await page.getByRole('menuitem',{name:'Custom theme…',exact:true}).click();
  const custom={id:'test-theme',name:'Test theme',scheme:'dark',colors:{bg:'#232426',surface:'#292a2d',raised:'#34363a',text:'#e8e8e5',muted:'#a4a6ac',border:'#414348',accent:'#95b897',danger:'#f49a9a',viewport:'#1b1d20'}};
  await page.getByRole('textbox',{name:'Theme JSON'}).fill(JSON.stringify({...custom,script:'alert(1)'}));await page.getByRole('button',{name:'Apply theme',exact:true}).click();await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible();
  await page.getByRole('textbox',{name:'Theme JSON'}).fill(JSON.stringify(custom));await page.getByRole('button',{name:'Apply theme',exact:true}).click();await expect(page.locator('html')).toHaveAttribute('data-theme','test-theme');
  await page.getByRole('button',{name:'Editor settings'}).click();await page.getByRole('menuitem',{name:'Graphite',exact:true}).click();
  await page.getByRole('button',{name:'Play',exact:true}).click();await expect(page.getByTestId('editor-shell')).toHaveAttribute('data-mode','playing');
  await page.getByRole('button',{name:'Pause / Resume',exact:true}).click();await expect(page.getByTestId('editor-shell')).toHaveAttribute('data-mode','paused');
  const time=Number(await page.getByTestId('pixi-canvas').getAttribute('data-runtime-time'));await page.waitForTimeout(120);expect(Number(await page.getByTestId('pixi-canvas').getAttribute('data-runtime-time'))).toBe(time);
  await page.getByRole('button',{name:'Step',exact:true}).click();expect(Number(await page.getByTestId('pixi-canvas').getAttribute('data-runtime-time'))).toBeCloseTo(time+1/60,10);await page.getByRole('button',{name:'Stop',exact:true}).click();
  const saved=join(temp,'native.pixieditor');await app.evaluate(({dialog},path)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path});},saved);
  await page.getByRole('button',{name:'Project menu'}).click();await page.getByRole('menuitem',{name:'Save',exact:true}).click();
  await expect(page.getByLabel('Unsaved changes',{exact:true})).toHaveCount(0);
  const project=JSON.parse(await readFile(saved,'utf8'));expect(project.scenes[0].entities.find(e=>e.name==='Player').components.find(c=>c.type==='scene.transform2d').data.x).toBe(450);
  // Corrupt open must not replace current authoring state or establish a save target.
  const bad=join(temp,'bad.pixieditor');await writeFile(bad,JSON.stringify({formatVersion:99}));
  await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},bad);
  await page.getByRole('button',{name:'Project menu'}).click();await page.getByRole('menuitem',{name:'Open…',exact:true}).click();await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('textbox',{name:'Object name',exact:true})).toHaveValue('Player');
  await page.getByRole('button',{name:'Dismiss message'}).click();
  await mkdir(join(root,'outputs'),{recursive:true});await page.screenshot({path:join(root,'outputs/editor-foundation.png')});
  const opaque=structuredClone(project);opaque.modules['external.feature']='3.0.0';opaque.scenes[0].entities.find(e=>e.name==='Player').components.push({id:'unknown-id',type:'external.payload',version:7,data:{nested:[1,'keep',null]}});
  const opaquePath=join(temp,'opaque.pixieditor');await writeFile(opaquePath,JSON.stringify(opaque));
  await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},opaquePath);
  await page.getByRole('button',{name:'Project menu'}).click();await page.getByRole('menuitem',{name:'Open…',exact:true}).click();
  await page.getByRole('button',{name:'Layers',exact:true}).click();await page.getByRole('button',{name:'Select Player',exact:true}).click();await page.keyboard.press('Escape');
  const name=page.getByRole('textbox',{name:'Object name',exact:true});await name.fill('Preserved Player');await name.press('Enter');
  await page.getByRole('button',{name:'Project menu'}).click();await page.getByRole('menuitem',{name:'Save',exact:true}).click();await expect(page.getByLabel('Unsaved changes',{exact:true})).toHaveCount(0);
  const roundtrip=JSON.parse(await readFile(opaquePath,'utf8'));expect(roundtrip.modules['external.feature']).toBe('3.0.0');expect(roundtrip.scenes[0].entities.find(e=>e.name==='Preserved Player').components.at(-1)).toEqual(opaque.scenes[0].entities.find(e=>e.name==='Player').components.at(-1));
  await page.getByRole('button',{name:'Play',exact:true}).click();await expect(page.getByRole('alert')).toContainText('unsupported');await expect(page.getByTestId('editor-shell')).toHaveAttribute('data-mode','edit');await page.getByRole('button',{name:'Dismiss message'}).click();
  await page.getByRole('button',{name:'Editor settings'}).click();await page.getByRole('menuitem',{name:'Warm',exact:true}).click();
  await app.close();app=await electron.launch({executablePath:process.env.REWRITE_EXECUTABLE||require('electron'),args:[...(process.env.REWRITE_EXECUTABLE?[]:[join(root,'apps/editor-desktop/out/main/index.js')]),'--no-hub', `--user-data-dir=${join(temp,'user')}`],env});
  const restored=await app.firstWindow({timeout:30000});await expect(restored.getByRole('button',{name:'Continue without restoring',exact:true})).toBeVisible();await restored.getByRole('button',{name:'Continue without restoring',exact:true}).click();await expect(restored.locator('html')).toHaveAttribute('data-theme','warm');await expect(restored.locator('.dv-tab').filter({hasText:'Properties'})).toBeVisible();
  console.log('PASS native Undo/Redo, System color scheme and validated custom theme (script fields rejected)');
  console.log('PASS unknown component/module lock preservation, runtime diagnostic and native relaunch panel/theme persistence');
  console.log('PASS native editor: real Pixi GPU, component edits, dock pin state, three themes, Preview controls, sandbox, atomic native save and invalid-open preservation');
 }
 expect(errors).toEqual([]);
}catch(error){if(app)for(const [i,page]of app.windows().entries()){await mkdir(join(root,'outputs'),{recursive:true});await page.screenshot({path:join(root,`outputs/failure-${i}.png`)}).catch(()=>{});console.error(await page.locator('body').innerText().catch(()=>''));}throw error;}
finally{if(app){await app.evaluate(({BrowserWindow})=>{for(const w of BrowserWindow.getAllWindows())w.destroy();}).catch(()=>{});await app.close().catch(()=>{});}await rm(temp,{recursive:true,force:true,maxRetries:3});}
