import {execFileSync,spawnSync} from 'node:child_process';
import {access,cp,lstat,mkdir,mkdtemp,readFile,readdir,rename,rm,writeFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import {homedir,tmpdir} from 'node:os';
import {basename,dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
export const root=dirname(dirname(fileURLToPath(import.meta.url)));
export const appPath='/Applications/OliveStudio.app';
export const artifacts=join(root,'release');
const exists=async p=>{try{await lstat(p);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
export async function copyApp(source,target){await cp(source,target,{recursive:true,dereference:false,verbatimSymlinks:true});}
export function isEditorBundle(path){return /^OliveStudio(?: [A-Za-z0-9 -]+)?\.app$/.test(basename(path));}
/** Only generated build trees; never traverse projects, user profiles or the Electron dependency. */
export async function oldBundles(workspace=root){const found=[];const walk=async p=>{for(const e of await readdir(p,{withFileTypes:true})){if(e.isSymbolicLink())continue;const file=join(p,e.name);if(e.isDirectory()&&e.name.endsWith('.app')){if(isEditorBundle(file))found.push(file);continue;}if(e.isDirectory()&&!['node_modules','.git','profile','user','assets','game-assets'].includes(e.name))await walk(file);}};for(const e of await readdir(workspace,{withFileTypes:true}))if(e.isDirectory()&&(e.name==='release'||e.name.startsWith('release-')||e.name==='outputs'))await walk(join(workspace,e.name));return found;}
export async function packagedApps(stage){const candidates=[];for(const e of await readdir(stage,{withFileTypes:true})){if(!e.isDirectory())continue;const p=join(stage,e.name,'OliveStudio.app');if(await exists(p))candidates.push(p);}return candidates;}
export function runningApps(text,paths){
 return text.split('\n').filter(line=>{
  const command=line.trimStart().replace(/^\d+\s+/, '');
  return paths.some(p=>command.startsWith(`${p}/Contents/MacOS/`));
 });
}
function refuseRunning(paths){const list=execFileSync('ps',['-axo','pid=,command='],{encoding:'utf8'}),running=runningApps(list,paths);if(running.length)throw Error('An editor build is running. Save your work and quit OliveStudio before packaging. The existing app was left intact.');}
export async function trashBundles(paths){if(!paths.length)return null;const folder=join(homedir(),'.Trash',`OliveStudio-builds-${Date.now()}-${crypto.randomUUID().slice(0,8)}`);await mkdir(folder,{recursive:true});const manifest=[];for(const [i,source]of paths.entries()){if(!await exists(source))continue;const target=join(folder,`${i+1}-${basename(source)}`);if(process.platform==='darwin')spawnSync('/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister',['-u',source],{stdio:'ignore'});await rename(source,target);manifest.push({source,target});await writeFile(join(folder,'restore-map.json'),JSON.stringify(manifest,null,2)+'\n');}return folder;}
export async function cleanup(){const old=await oldBundles();refuseRunning(old);return trashBundles(old);}
const run=(cmd,args,cwd=root)=>{const r=spawnSync(cmd,args,{cwd,stdio:'inherit',env:process.env});if(r.status!==0)throw Error(`${cmd} failed (${r.status??r.error?.message})`);};

async function buildEditor(stage, mode) {
 const source=join(root,'apps/editor'), appDir=join(stage,'app');
 const release=mode==='release';
 await mkdir(appDir);
 run('pnpm',['--filter','@olivestudio/editor','build','--outDir',join(appDir,'renderer'),'--emptyOutDir']);
 run('pnpm',['--filter','@olivestudio/editor','build:native',join(appDir,'asset-import.cjs')]);
 await cp(join(source,'desktop.mjs'),join(appDir,'main.mjs'));
 await cp(join(source,'preload.cjs'),join(appDir,'preload.cjs'));
 await cp(join(source,'network-desktop.mjs'),join(appDir,'network-desktop.mjs'));
 await cp(join(source,'locales'),join(appDir,'locales'),{recursive:true});
 await mkdir(join(appDir,'examples'));
 await cp(join(root,'examples/object-gallery/object-gallery.json'),join(appDir,'examples/object-gallery.json'));
 const manifest=JSON.parse(await readFile(join(source,'package.json'),'utf8'));
 await writeFile(join(appDir,'package.json'),JSON.stringify({
  name:'olivestudio',productName:'OliveStudio',version:manifest.version,type:'module',main:'main.mjs',
  description:'OliveStudio 2D game editor',author:'OliveStudio',
 }));
 const {build,devDependencies}=manifest;
 const electron=execFileSync(process.execPath,['-p',"require('electron')"],{cwd:source,encoding:'utf8'}).trim();
 const builder=execFileSync(process.execPath,['-p',"require.resolve('electron-builder/cli.js')"],{cwd:source,encoding:'utf8'}).trim();
 const config=join(stage,'electron-builder.json');
 const entitlements=join(source,release?build.mac.entitlements:'build/entitlements.adhoc.plist');
 await writeFile(config,JSON.stringify({
  appId:build.appId,productName:build.productName,
  mac:{...build.mac,icon:join(source,build.mac.icon),entitlements,entitlementsInherit:entitlements,...(release?{}:{identity:'-',notarize:false})},
  dmg:build.dmg,copyright:build.copyright,forceCodeSigning:release,
  electronVersion:devDependencies.electron,
  electronDist:resolve(electron,'../../../..'),
  directories:{output:stage},
  files:['main.mjs','preload.cjs','asset-import.cjs','game-export.cjs','localhub.cjs','network-server/server.mjs','network-desktop.mjs','renderer/**/*','locales/**/*.{mjs,json}','examples/*.json','package.json'],
  extraResources:[{from:join(root,'third-party/SPINE-RUNTIMES-LICENSE.txt'),to:'licenses/SPINE-RUNTIMES-LICENSE.txt'}],
  npmRebuild:false,
 }));
 run(process.execPath,[builder,'--mac',...(release?['dmg','zip']:['--dir']),'--publish','never','--config',config],appDir);
}

async function packageApp(mode){
 if(process.platform!=='darwin')throw Error('macOS packaging requires macOS');
 if(!['local','release'].includes(mode))throw Error('Use --mode local or --mode release');
 await access(dirname(appPath),constants.W_OK);
 const old=await oldBundles();refuseRunning([appPath,...old]);
 const stage=await mkdtemp(join(tmpdir(),'olivestudio-package-')),incoming=join(dirname(appPath),`.OliveStudio-install-${crypto.randomUUID()}`);let published=false;
 try{
  await buildEditor(stage,mode);
  const dirs=await readdir(stage),candidates=await packagedApps(stage);if(candidates.length!==1)throw Error('Expected exactly one packaged OliveStudio app');
  const candidate=candidates[0];run('codesign',['--verify','--deep','--strict',candidate]);const id=execFileSync('plutil',['-extract','CFBundleIdentifier','raw','-o','-',join(candidate,'Contents/Info.plist')],{encoding:'utf8'}).trim();if(id!=='dev.olivestudio.app')throw Error('Unexpected bundle identity');
  await copyApp(candidate,incoming);run('codesign',['--verify','--deep','--strict',incoming]);refuseRunning([appPath,...old]);
  const previous=await exists(appPath)?await trashBundles([appPath]):null;
  try{await rename(incoming,appPath);published=true;}catch(error){if(previous){const entries=await readdir(previous);const saved=entries.find(e=>e.endsWith('.app'));if(saved)await rename(join(previous,saved),appPath);}throw error;}
  const retired=await cleanup();await mkdir(artifacts,{recursive:true});if(mode==='release'){for(const file of dirs.filter(f=>/\.(dmg|zip|blockmap|yml)$/.test(f)))await cp(join(stage,file),join(artifacts,file));}await writeFile(join(artifacts,'latest.json'),JSON.stringify({app:appPath,mode,builtAt:new Date().toISOString(),retired:retired??previous},null,2)+'\n');
  const register='/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';spawnSync(register,['-f',appPath],{stdio:'ignore'});
  console.log(`\nOnly current app: ${appPath}\nPrevious builds: macOS Trash (restore-map.json).`);
 }finally{await rm(stage,{recursive:true,force:true});if(!published)await rm(incoming,{recursive:true,force:true});}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const args=process.argv.slice(2);
  if(args[0]==='--cleanup'&&args.length===1){
   const folder=await cleanup();
   console.log(folder?`Moved old builds to ${folder}`:'No duplicate editor bundles');
  }else{
   if(args.length&&(args.length!==2||args[0]!=='--mode')){
    throw Error('Use --mode local|release or --cleanup.');
   }
   await packageApp(args[1]??'local');
  }
 }catch(e){console.error(String(e));process.exitCode=1;}
}
