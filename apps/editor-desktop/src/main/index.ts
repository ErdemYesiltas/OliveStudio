import {isAbsolute} from 'node:path';
import {cpSync,existsSync,mkdirSync} from 'node:fs';
import {RecoveryStore} from '@rewrite/recovery/node';
import {NativeRecovery} from './native-recovery';
import { app, BrowserWindow, dialog, ipcMain, Menu, protocol } from 'electron';
import { join, basename, dirname } from 'node:path';
import { readFile, open, rename, unlink, stat, writeFile, mkdir, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {createNativeBuild} from '@native-build-profile';
import type {NativeBuildService} from '@rewrite/build/node';
import type {Json} from '@rewrite/sdk';
import { createNativeAssets } from '@native-profile';
import type { NativeAssets } from './native-assets.types';
import { registerComfy } from './native-comfy';
import { registerLm } from './native-lm';
import { registerLocalHub } from './native-localhub';
import { registerGit } from './native-git';
import { registerPlugins } from './native-plugins';
import { registerMcp } from './native-mcp';
import { registerHub } from './native-hub';
protocol.registerSchemesAsPrivileged([{scheme:'pixi-editor-asset',privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true,stream:true}},{scheme:'olive-plugin',privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true}}]);
let assets:NativeAssets|null=null;let builds:NativeBuildService|null=null;
const here = dirname(fileURLToPath(import.meta.url));
let window: BrowserWindow | null = null, path: string | null = null, dirty = false, allowClose = false, closing = false;
app.setName('OliveStudio');
// Renamed from "Pixi Editor Next": preferences, recent projects, recovery and MCP settings move over once (caches and locks stay behind).
if(!app.commandLine.hasSwitch('user-data-dir')){const next=app.getPath('userData'),legacy=join(app.getPath('appData'),'Pixi Editor Next');if(existsSync(legacy)&&!existsSync(join(next,'Local Storage'))){try{cpSync(legacy,next,{recursive:true,force:false,errorOnExist:false,filter:source=>!/^(Singleton.*|.*Cache|GPUCache|Dawn.*|Graphite.*|blob_storage|.*-journal|.*\.lock|LOCK)$/.test(basename(source))});}catch(error){console.warn('Could not move settings from Pixi Editor Next',error);}}}
const profile=app.commandLine.getSwitchValue('user-data-dir');if(profile){mkdirSync(profile,{recursive:true});app.setPath('userData',profile);}
const primary=app.requestSingleInstanceLock();if(!primary)app.quit();
app.on('second-instance',()=>{window?.show();window?.focus();});
let recovery:NativeRecovery|null=null;let orderlyClose=false;
async function confirmDiscard(): Promise<boolean> {
 if (!dirty || !window) return true;
 const result = await dialog.showMessageBox(window, { type: 'question', message: 'Discard unsaved changes?', detail: 'Your last saved project will be kept.', buttons: ['Cancel','Discard'], defaultId: 0, cancelId: 0 });
 return result.response === 1;
}
if(primary)app.whenReady().then(async () => {
 assets=await createNativeAssets(join(app.getPath('temp'),'pixi-editor-rewrite-assets'),join(here,'asset-worker.js'));
 builds=createNativeBuild(join(here,'../player'),()=>assets);
 protocol.handle('pixi-editor-asset',request=>assets?assets.read(request.url):new Response('Assets not installed',{status:404}));
 let busy=false;
 const store=new RecoveryStore(join(app.getPath('userData'),'recovery'));await store.init();
 recovery=new NativeRecovery(store,{assets:()=>assets,path:()=>path,setPath:value=>{path=value;},dirty:()=>dirty,resetDirty:()=>{dirty=false;},confirm:confirmDiscard,busy:()=>busy});
 const task=async<T>(work:()=>Promise<T>):Promise<T>=>{if(busy)throw Error('A file operation is already running');busy=true;try{await recovery?.wait();return await work();}finally{busy=false;}};
 window = new BrowserWindow({ width: 1440, height: 950, minWidth: 960, minHeight: 640, title: 'OliveStudio', backgroundColor: '#232426', titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 20 }, webPreferences: { preload: join(here, '../preload/index.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false } });
 const sender = (event: Electron.IpcMainInvokeEvent) => { if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw Error('Invalid sender'); };
 ipcMain.handle('host:accept-open', (event, candidate: unknown) => task(async () => {
  sender(event); if (typeof candidate !== 'string') throw Error('Invalid path');
  if (candidate !== lastOpened) throw Error('Unselected path'); const sessionId=await assets?.acceptOpen(candidate);path = candidate; dirty = false;const warnings:string[]=[];await hub.touch(candidate,lastOpenedText??'').catch(()=>{});try{await recovery?.opened(candidate,lastOpenedText!);}catch(error){warnings.push('Project opened, but recovery bookkeeping failed: '+String(error));}lastOpened=null;lastOpenedText=null;return {sessionId,warnings};
 }));
 let lastOpened: string | null = null,lastOpenedText:string|null=null;
 const stageProject=async(candidate:string)=>{const text=await readFile(candidate,'utf8');if(Buffer.byteLength(text)>10*1024*1024)throw Error('Project exceeds 10 MB');const warnings=await assets?.stageOpen(candidate,JSON.parse(text))??[];lastOpened=candidate;lastOpenedText=text;return {text,path:candidate,warnings};};
 const hub=registerHub({window:()=>window,sender,task,confirmDiscard,stage:stageProject,current:()=>path,examplesDir:app.isPackaged?join(process.resourcesPath,'examples'):join(here,'../../../../examples'),showAtStartup:!app.commandLine.hasSwitch('no-hub')});
 ipcMain.handle('recovery:bootstrap',(event,nonce:unknown)=>task(async()=>{sender(event);return recovery!.bootstrap(nonce);}));
 ipcMain.handle('recovery:list',event=>{sender(event);return store.list();});
 ipcMain.handle('recovery:checkpoint',(event,text:unknown,scope:unknown)=>{sender(event);return recovery!.checkpoint(text,scope);});
 ipcMain.handle('recovery:prepare',(event,id:unknown)=>task(async()=>{sender(event);return recovery!.prepare(id);}));
 ipcMain.handle('recovery:accept',(event,ticket:unknown)=>task(async()=>{sender(event);return recovery!.accept(ticket);}));
 ipcMain.handle('recovery:reject',(event,ticket:unknown)=>task(async()=>{sender(event);return recovery!.reject(ticket);}));
 ipcMain.handle('recovery:remove',(event,id:unknown)=>task(async()=>{sender(event);if(typeof id!=='string')throw Error('Invalid recovery ID');await store.remove(id);}));
 ipcMain.handle('recovery:recent',event=>task(async()=>{sender(event);if(!await confirmDiscard())return null;const recent=await store.recentPath();return recent?stageProject(recent):null;}));
 ipcMain.handle('host:open', event => task(async () => {
  sender(event); if (!await confirmDiscard()) return null;
  const result = await dialog.showOpenDialog(window!, { properties: ['openFile'], filters: [{ name: 'Pixi Editor project', extensions: ['pixieditor'] }] });
  if (result.canceled) return null;
  return stageProject(result.filePaths[0]);
 }));
 ipcMain.handle('host:save', (event, request: unknown) => task(async () => {
  sender(event);
  if (!request || typeof request !== 'object' || !('text' in request) || typeof request.text !== 'string' || Buffer.byteLength(request.text) > 10 * 1024 * 1024) throw Error('Invalid project');
  const project=JSON.parse(request.text);
  let target = path;
  if (!target || ('saveAs' in request && request.saveAs === true)) {
   const result = await dialog.showSaveDialog(window!, { defaultPath: target ?? 'Untitled.pixieditor', filters: [{ name: 'Pixi Editor project', extensions: ['pixieditor'] }] });
   if (result.canceled || !result.filePath) return null; target = result.filePath;
  }
  const warnings=await assets?.persist(target,project)??[];
  const temporary = join(dirname(target), `.${basename(target)}.${randomUUID()}.tmp`);
  try {
   const file = await open(temporary, 'wx', 0o600);
   try { await file.writeFile(request.text, 'utf8'); await file.sync(); } finally { await file.close(); }
   await rename(temporary,target); path = target;await hub.touch(target,request.text).catch(()=>{});try{await recovery?.saved(target,request.text);}catch(error){warnings.push('Project saved, but recovery cleanup failed: '+String(error));}return { path: target,warnings };
  } finally { await unlink(temporary).catch(() => {}); }
 }));
 ipcMain.handle('host:dirty', (event, value: unknown) => { sender(event); if (typeof value !== 'boolean') throw Error('Invalid dirty state'); dirty = value; });
 ipcMain.handle('host:discard', event => task(async () => { sender(event); if (!await confirmDiscard()) return null; const sessionId=await assets?.reset();path = null; dirty = false;const warnings:string[]=[];try{await recovery?.discarded();}catch(error){warnings.push('New project created, but recovery cleanup failed: '+String(error));}return {sessionId,warnings}; }));
 /** i18next resource files (one JSON per language) for the Localization panel. */
 ipcMain.handle('strings:import',event=>task(async()=>{sender(event);const result=await dialog.showOpenDialog(window!,{title:'Import i18next JSON',properties:['openFile','multiSelections'],filters:[{name:'i18next JSON',extensions:['json']}]});if(result.canceled)return[];return Promise.all(result.filePaths.slice(0,64).map(async file=>{if((await stat(file)).size>5*1024*1024)throw Error(`${basename(file)} is larger than 5 MB`);return{name:basename(file),folder:basename(dirname(file)),text:await readFile(file,'utf8')};}));}));
 ipcMain.handle('strings:export',(event,files:unknown)=>task(async()=>{sender(event);if(!Array.isArray(files)||!files.length||files.length>64||!files.every(f=>f&&typeof f==='object'&&typeof f.name==='string'&&/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?\.json$/.test(f.name)&&typeof f.text==='string'&&Buffer.byteLength(f.text)<=5*1024*1024))throw Error('Invalid i18next files');const result=await dialog.showOpenDialog(window!,{title:'Export i18next JSON',properties:['openDirectory','createDirectory']});if(result.canceled||!result.filePaths[0])return null;const dir=result.filePaths[0];for(const f of files as {name:string;text:string}[])await writeFile(join(dir,f.name),f.text,'utf8');return dir;}));
 ipcMain.handle('build:status',event=>{sender(event);return builds?.state??{phase:'idle',message:''};});
 ipcMain.handle('build:cancel',event=>{sender(event);builds?.cancel();});
 ipcMain.handle('build:zip',event=>task(async()=>{sender(event);if(!builds)throw Error('Builds are unavailable');return builds.zip();}));
 ipcMain.handle('build:start',(event,text:unknown,targetId:unknown)=>task(async()=>{sender(event);if(!builds||typeof text!=='string'||Buffer.byteLength(text)>10*1024*1024||typeof targetId!=='string')throw Error('Invalid export request');const project=JSON.parse(text)as Json;builds.state={phase:'preflight',message:'Choose output folder…'};const result=await dialog.showOpenDialog(window!,{title:'Choose export parent folder',properties:['openDirectory','createDirectory']});if(result.canceled)return null;return builds.run(result.filePaths[0],project,targetId);}));
 registerComfy({window:()=>window,sender,assets:()=>assets,task,temp:join(app.getPath('temp'),'pixi-editor-rewrite-comfy')});
 registerLm({window:()=>window,sender});
 registerLocalHub({window:()=>window,sender,memory:app.commandLine.hasSwitch('localhub-memory')});
 registerGit({sender,task,current:()=>path,confirmDiscard,stage:stageProject});
 registerPlugins({sender});
 const mcp=registerMcp({window:()=>window,sender,configPath:join(app.getPath('userData'),'mcp.json'),version:app.getVersion(),stdioScript:join(here,'mcp-stdio.js')});app.on('will-quit',()=>{void mcp.dispose();});
 ipcMain.handle('assets:info',event=>{sender(event);return assets?.info()??{sessionId:'',workerProcessId:null};});
 ipcMain.handle('assets:cancel',event=>{sender(event);assets?.cancel();});
 ipcMain.handle('assets:import',(event,id:unknown,replace:unknown)=>task(async()=>{sender(event);if(typeof id!=='string'||!assets)throw Error('Assets unavailable');const importer=assets.importer(id);if(!importer)throw Error('Unknown importer');const result=await dialog.showOpenDialog(window!,{properties:replace?['openFile']:['openFile','multiSelections'],filters:[{name:'Assets',extensions:[...importer.extensions]}]});if(result.canceled)return null;return assets.import(result.filePaths,id,replace); }));
 ipcMain.handle('assets:import-any',event=>task(async()=>{sender(event);if(!assets)throw Error('Assets unavailable');const list=assets.importers(),result=await dialog.showOpenDialog(window!,{title:'Add files to the Library',properties:['openFile','multiSelections'],filters:[{name:'Supported files',extensions:[...new Set(list.flatMap(i=>[...i.extensions]))]}]});if(result.canceled)return null;
  const groups=new Map<string,string[]>(),skipped:string[]=[];for(const path of result.filePaths){const ext=path.split('.').pop()?.toLowerCase()??'',importer=list.find(i=>i.extensions.includes(ext));if(importer)groups.set(importer.id,[...groups.get(importer.id)??[],path]);else skipped.push(basename(path));}
  if(!groups.size)throw Error(`No importer for ${skipped.join(', ')}`);const records=[];for(const [id,paths] of groups)records.push(...await assets.import(paths,id));return records;}));
 ipcMain.handle('assets:drop',(event,paths:unknown)=>task(async()=>{sender(event);if(!assets||!Array.isArray(paths)||!paths.length||paths.length>64||paths.some(path=>typeof path!=='string'||!path||!isAbsolute(path)))throw Error('Drop files from Finder or Explorer');
  const list=assets.importers(),groups=new Map<string,string[]>();for(const path of [...new Set(paths as string[])]){const importer=list.find(i=>i.extensions.includes(path.split('.').pop()?.toLowerCase()??''));if(!importer)throw Error(`Unsupported file: ${basename(path)}`);groups.set(importer.id,[...groups.get(importer.id)??[],path]);}const records=[];for(const[id,files]of groups)records.push(...await assets.import(files,id));return records;
 }));
 /** Files made in the editor (Sound Lab WAVs): written to a temporary folder and imported by their extension's importer. */
 ipcMain.handle('assets:import-bytes',(event,bytes:unknown,name:unknown,extension:unknown)=>task(async()=>{sender(event);
  if(!assets||!(bytes instanceof Uint8Array)||!bytes.byteLength||bytes.byteLength>32*1024*1024||typeof name!=='string'||!/^[\w .()#-]{1,80}$/.test(name)||typeof extension!=='string')throw Error('Invalid file to import');
  const importer=assets.importers().find(i=>i.extensions.includes(extension.toLowerCase()));if(!importer)throw Error(`No importer for .${extension}`);
  const folder=join(app.getPath('temp'),`pixi-editor-bytes-${randomUUID()}`);await mkdir(folder,{recursive:true});const file=join(folder,`${name}.${extension.toLowerCase()}`);
  try{await writeFile(file,bytes);return await assets.import([file],importer.id);}finally{await rm(folder,{recursive:true,force:true}).catch(()=>{});}
 }));
 ipcMain.handle('assets:inspect',(event,text:unknown,scope:unknown)=>task(async()=>{sender(event);if(typeof text!=='string'||Buffer.byteLength(text)>10*1024*1024||!assets||scope!==assets.info().sessionId)throw Error('Invalid inspection request');return assets.inspect(JSON.parse(text));}));
 ipcMain.handle('assets:rebuild',(event,text:unknown)=>task(async()=>{sender(event);if(typeof text!=='string'||Buffer.byteLength(text)>10*1024*1024||!assets)throw Error('Invalid rebuild request');return assets.rebuild(JSON.parse(text));}));
 window.on('close', event => {
  if (allowClose || !dirty) {orderlyClose=true;return;} event.preventDefault(); if (closing) return; closing = true;
  void confirmDiscard().then(ok => { closing = false; if (ok) { allowClose = true; window?.close(); } });
 });
 window.webContents.on('render-process-gone',()=>{recovery?.crash();dirty=false;});
 window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
 window.webContents.on('will-navigate', event => event.preventDefault());
 const action = (name: string) => () => window?.webContents.send('host:action',name);
 // Route keyboard Save through the same command as the native menu, exactly once.
 window.webContents.on('before-input-event',(event,input)=>{const modifier=process.platform==='darwin'?input.meta:input.control;if(input.type==='keyDown'&&modifier&&!input.alt&&input.key.toLowerCase()==='s'){event.preventDefault();if(!input.isAutoRepeat)action(input.shift?'saveAs':'save')();}});
 Menu.setApplicationMenu(Menu.buildFromTemplate([
  { label: 'OliveStudio', submenu: [{ role: 'about' }, { type: 'separator' }, { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: action('settings') }, { type: 'separator' }, { role: 'quit' }] },
  { label: 'File', submenu: [{ label: 'Hub…', accelerator: 'CmdOrCtrl+Shift+H', click: action('hub') },{ type: 'separator' },{ label: 'New project', accelerator: 'CmdOrCtrl+N', click: action('new') },{ label: 'Open…', accelerator: 'CmdOrCtrl+O', click: action('open') },{ label: 'Save', accelerator: 'CmdOrCtrl+S', click: action('save') },{ label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: action('saveAs') }] },
  { label: 'Edit', submenu: [{ label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: action('undo') },{ label: 'Redo', accelerator: 'CmdOrCtrl+Shift+Z', click: action('redo') },{ type: 'separator' },{ role: 'cut' },{ role: 'copy' },{ role: 'paste' },{ label: 'Duplicate', accelerator: 'CmdOrCtrl+D', click: action('duplicate') },{ label: 'Flip Horizontally', accelerator: 'Alt+Shift+H', click: action('flipH') },{ label: 'Flip Vertically', accelerator: 'Alt+Shift+V', click: action('flipV') },{ type: 'separator' },{ label: 'Group', accelerator: 'CmdOrCtrl+G', click: action('group') },{ label: 'Ungroup', accelerator: 'CmdOrCtrl+Shift+G', click: action('ungroup') },{ label: 'Select All', accelerator: 'CmdOrCtrl+A', click: action('selectAll') }] },
  { label: 'View', submenu: [{ role: 'togglefullscreen' },{ role: 'toggleDevTools' }] },
 ]));
 if (process.env.ELECTRON_RENDERER_URL) void window.loadURL(process.env.ELECTRON_RENDERER_URL);
 else void window.loadFile(join(here,'../renderer/index.html'));
});
app.on('window-all-closed', () => app.quit());

let cleaned=false;
app.on('will-quit',event=>{if(cleaned||!assets)return;builds?.cancel();event.preventDefault();void (async()=>{try{await builds?.dispose();await recovery?.close(orderlyClose);}finally{await assets!.dispose();}})().finally(()=>{cleaned=true;app.quit();});});
