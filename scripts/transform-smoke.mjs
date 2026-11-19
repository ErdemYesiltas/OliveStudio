import {_electron as electron,expect} from '@playwright/test';
import {createRequire} from 'node:module';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdtemp,rm,writeFile,mkdir,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
const root=dirname(dirname(fileURLToPath(import.meta.url))),require=createRequire(join(root,'apps/editor-desktop/package.json'));
const temp=await mkdtemp(join(tmpdir(),'rewrite-transform-')),env={...process.env};delete env.ELECTRON_RUN_AS_NODE;let app,page;
const original={x:0,y:0,rotation:20,scaleX:1.2,scaleY:.8};
const component=(id,data)=>({id,type:'scene.transform2d',version:1,data});
const scene={formatVersion:1,id:'scene',name:'Transform test',entities:[
 {id:'parent',name:'Parent',parentId:null,active:true,components:[component('pt',{x:480,y:270,rotation:30,scaleX:2,scaleY:1.5})]},
 {id:'child',name:'Child',parentId:'parent',active:true,components:[component('ct',original),{id:'visual',type:'pixi.shape',version:1,data:{width:100,height:80,color:'#7caef5',rounded:0}}]},
]};
const fixture=join(temp,'fixture.pixieditor');await writeFile(fixture,JSON.stringify({formatVersion:1,name:'Transforms',entrySceneId:'scene',scenes:[scene],modules:{},providers:{render:'pixi'},extensions:{}}));
try{
 app=await electron.launch({executablePath:process.env.REWRITE_EXECUTABLE||require('electron'),args:[...(process.env.REWRITE_EXECUTABLE?[]:[join(root,'apps/editor-desktop/out/main/index.js')]),'--no-hub', `--user-data-dir=${join(temp,'user')}`],env});page=await app.firstWindow();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const canvas=page.getByTestId('pixi-canvas'),shell=page.getByTestId('editor-shell');await expect(canvas).toHaveAttribute('data-ready','true',{timeout:30000});
 const menu=async label=>app.evaluate(({Menu},text)=>{const group=Menu.getApplicationMenu().items.find(m=>m.submenu?.items.some(i=>i.label===text));group.submenu.items.find(i=>i.label===text).click();},label);
 await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},fixture);await menu('Open…');await expect(page.getByText('Transform test',{exact:true})).toBeVisible();await expect(shell).toHaveAttribute('aria-busy','false');
 await page.getByRole('button',{name:'Layers',exact:true}).click();await page.getByRole('button',{name:'Select Child',exact:true}).click();await page.keyboard.press('Escape');
 const handle=name=>page.getByRole('button',{name,exact:true}),center=async name=>{await handle(name).hover();const b=await handle(name).boundingBox();return{x:b.x+b.width/2,y:b.y+b.height/2};};
 const value=async()=>JSON.parse(await canvas.getAttribute('data-transforms')).child;
 const matches=async expected=>expect.poll(value).toMatchObject(expected);
 const clean=async()=>expect(page.getByLabel('Unsaved changes',{exact:true})).toHaveCount(0);
 const undo=async()=>{await menu('Undo');await matches(original);await clean();};
 const drag=async(name,point,modifier)=>{const from=await center(name);await page.mouse.move(from.x,from.y);await page.mouse.down();if(modifier)await page.keyboard.down(modifier);await page.mouse.move(point.x,point.y,{steps:12});await page.mouse.up();if(modifier)await page.keyboard.up(modifier);};
 const grid=page.getByRole('button',{name:'Show grid',exact:true}),snap=page.getByRole('button',{name:'Snap move to grid',exact:true}),spacing=page.getByRole('combobox',{name:'Grid spacing',exact:true}),gridState=async()=>JSON.parse(await canvas.getAttribute('data-grid'));
 await expect(grid).toHaveAttribute('aria-pressed','false');await expect(snap).toHaveAttribute('aria-pressed','false');await expect(spacing).toHaveValue('32');const sharp=require('sharp'),beforeGrid=await sharp(await canvas.locator('canvas').screenshot()).removeAlpha().raw().toBuffer();await grid.click();await expect.poll(async()=>(await gridState()).lines).toBeGreaterThan(0);expect((await gridState()).parentId).toBe('parent');const afterGrid=await sharp(await canvas.locator('canvas').screenshot()).removeAlpha().raw().toBuffer();let changed=0;for(let i=0;i<Math.min(beforeGrid.length,afterGrid.length);i+=3)if(beforeGrid[i]!==afterGrid[i]||beforeGrid[i+1]!==afterGrid[i+1]||beforeGrid[i+2]!==afterGrid[i+2])changed++;expect(changed).toBeGreaterThan(2000);await clean();
 await snap.click();await handle('Move freely').focus();await page.keyboard.press('ArrowRight');await matches({...original,x:32});await undo();await handle('Move freely').focus();await page.keyboard.press('Shift+ArrowRight');await matches({...original,x:320});await undo();await handle('Move freely').focus();await page.keyboard.press('ArrowUp');await matches({...original,y:-32});await undo();
 const snappedX=await center('Move on X');await drag('Move on X',{x:snappedX.x+Math.cos(Math.PI/6)*80,y:snappedX.y+Math.sin(Math.PI/6)*80});await expect.poll(async()=>(await value()).x).toBe(32);expect((await value()).y).toBe(original.y);await undo();
 const snappedFree=await center('Move freely');await drag('Move freely',{x:snappedFree.x+100,y:snappedFree.y+100});const snapped=await value();expect(Math.abs(snapped.x%32)).toBeLessThan(1e-8);expect(Math.abs(snapped.y%32)).toBeLessThan(1e-8);expect(snapped.x).not.toBe(0);await undo();
 const cancelled=await center('Move freely');await page.mouse.move(cancelled.x,cancelled.y);await page.mouse.down();await page.mouse.move(cancelled.x+80,cancelled.y+50,{steps:6});await page.keyboard.press('Escape');await page.mouse.up();await matches(original);await clean();
 await page.getByRole('button',{name:'Play',exact:true}).click();await expect(grid).toBeDisabled();await expect(snap).toBeDisabled();await expect(spacing).toBeDisabled();await expect.poll(async()=>(await gridState()).lines).toBe(0);await page.getByRole('button',{name:'Stop',exact:true}).click();await expect.poll(async()=>(await gridState()).lines).toBeGreaterThan(0);await spacing.selectOption('64');await expect.poll(async()=>JSON.parse(await page.evaluate(()=>localStorage.getItem('rewrite:settings')))).toMatchObject({'pixi.gridVisible':true,'pixi.gridSnap':true,'pixi.gridStep':'64'});await mkdir(join(root,'outputs'),{recursive:true});await page.screenshot({path:join(root,'outputs/editor-grid.png')});await grid.click();await snap.click();await clean();
 const pivot=await center('Move freely'),xAxis=await center('Move on X');
 await drag('Move on X',{x:xAxis.x+Math.cos(Math.PI/6)*80,y:xAxis.y+Math.sin(Math.PI/6)*80});
 await expect.poll(async()=>(await value()).x).toBeGreaterThan(10);expect((await value()).y).toBe(0);await undo();
 // A body drag must still work after an undo and a previous transform (no captured stale start).
 const body={x:pivot.x+20,y:pivot.y+20};await page.mouse.move(body.x,body.y);await page.mouse.down();await page.mouse.move(body.x+25,body.y+15,{steps:8});await page.mouse.up();await expect.poll(async()=>(await value()).x).toBeGreaterThan(1);await undo();
 await page.keyboard.press('r');await expect(canvas).toHaveAttribute('data-transform-tool','scale');
 const corner=await center('Scale bottom right');await drag('Scale bottom right',{x:pivot.x+(corner.x-pivot.x)*1.4,y:pivot.y+(corner.y-pivot.y)*1.4},'Shift');
 await expect.poll(async()=>(await value()).scaleX).toBeCloseTo(1.68,2);expect((await value()).scaleY).toBeCloseTo(1.12,2);await undo();
 await page.keyboard.press('e');await expect(canvas).toHaveAttribute('data-transform-tool','rotate');
 const turn=await center('Rotate entity'),r=Math.PI/6,d={x:turn.x-pivot.x,y:turn.y-pivot.y},local={x:(Math.cos(r)*d.x+Math.sin(r)*d.y)/2,y:(-Math.sin(r)*d.x+Math.cos(r)*d.y)/1.5},angle=22*Math.PI/180;
 const q={x:(Math.cos(angle)*local.x-Math.sin(angle)*local.y)*2,y:(Math.sin(angle)*local.x+Math.cos(angle)*local.y)*1.5};
 await drag('Rotate entity',{x:pivot.x+Math.cos(r)*q.x-Math.sin(r)*q.y,y:pivot.y+Math.sin(r)*q.x+Math.cos(r)*q.y},'Shift');await expect.poll(async()=>(await value()).rotation).toBeCloseTo(45,3);await undo();
 // Escape, pointercancel and focus loss all restore preview without creating history.
 for(const cancel of ['escape','pointercancel','blur']){
  const from=await center('Rotate entity');await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(from.x+35,from.y+25,{steps:6});await expect(canvas).toHaveAttribute('data-manipulating','true');
  if(cancel==='escape')await page.keyboard.press('Escape');else await page.evaluate(kind=>window.dispatchEvent(kind==='blur'?new Event('blur'):new PointerEvent('pointercancel',{pointerId:1})),cancel);
  await page.mouse.up();await matches(original);await clean();
 }
 // Focused handles are keyboard accessible; text inputs retain W/E/R as text.
 await handle('Rotate entity').focus();await page.keyboard.press('ArrowRight');await expect.poll(async()=>(await value()).rotation).toBeCloseTo(21,6);await undo();
 await page.getByRole('button',{name:'Properties',exact:true}).click();await page.getByRole('textbox',{name:'Object name',exact:true}).fill('wer');await expect(canvas).toHaveAttribute('data-transform-tool','rotate');await page.getByRole('textbox',{name:'Object name',exact:true}).fill('Child');await page.keyboard.press('Escape');
 // Camera changes update handles; Play removes interactive handles and Stop restores them.
 await page.keyboard.press('w');await expect(handle('Move freely')).toBeVisible();await canvas.hover();await page.keyboard.down('Meta');await page.mouse.wheel(0,-70);await page.keyboard.up('Meta');
 await expect.poll(async()=>Number(await canvas.getAttribute('data-zoom'))).toBeGreaterThan(1);
 const zoomHandle=await center('Move freely');await drag('Move freely',{x:zoomHandle.x+30,y:zoomHandle.y+20});await expect.poll(async()=>(await value()).x).toBeGreaterThan(1);await undo();
 await page.getByRole('button',{name:'Play',exact:true}).click();await expect(shell).toHaveAttribute('data-mode','playing');await expect(handle('Move freely')).toBeHidden();await page.getByRole('button',{name:'Stop',exact:true}).click();await expect(handle('Move freely')).toBeVisible();
 await handle('Move freely').focus();await page.keyboard.press('ArrowRight');await matches({...original,x:1});
 const saved=join(temp,'saved.pixieditor');await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},saved);await menu('Save As…');await clean();const persisted=JSON.parse(await readFile(saved,'utf8'));expect(persisted.scenes[0].entities[1].components[0].data).toEqual({...original,x:1});
 await mkdir(join(root,'outputs'),{recursive:true});await page.screenshot({path:join(root,'outputs/editor-transforms.png')});expect(errors).toEqual([]);await page.reload();await expect(page.getByRole('button',{name:'Continue without restoring',exact:true})).toBeVisible({timeout:30000});await page.getByRole('button',{name:'Continue without restoring',exact:true}).click();await expect(canvas).toHaveAttribute('data-ready','true',{timeout:30000});await expect(spacing).toHaveValue('64');await expect(grid).toHaveAttribute('aria-pressed','false');await expect(snap).toHaveAttribute('aria-pressed','false');expect(errors).toEqual([]);
 console.log('PASS native transforms: default-off parent-space grid pixels, bounded lines, pointer/keyboard snap and settings, grid Preview isolation, parent axes, rotated/nonuniform hierarchy, body drag, proportional scale, snapped rotation, one-step undo, cancellation, keyboard, zoom, Play isolation and saved transform');
}catch(error){if(page){await mkdir(join(root,'outputs'),{recursive:true});await page.screenshot({path:join(root,'outputs/transform-failure.png')}).catch(()=>{});}throw error;}
finally{if(app){await app.evaluate(({BrowserWindow})=>{for(const w of BrowserWindow.getAllWindows())w.destroy();}).catch(()=>{});await app.close().catch(()=>{});}await rm(temp,{recursive:true,force:true,maxRetries:3});}
