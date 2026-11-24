import {it,expect} from 'vitest';
import {build,transformWithEsbuild} from 'vite';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {hasModuleAwait} from '../../../scripts/module-evaluation.mjs';
const exec=promisify(execFile);
async function fixture(topAwait:boolean,reportFailure=false,startFailure=false){
 const root=await mkdtemp(join(tmpdir(),'olive-startup-'));
 try{
  const source=await readFile(new URL('./bootstrap.ts',import.meta.url),'utf8'),code=(await transformWithEsbuild(topAwait?source.replace('void boot();','await boot();'):source,'bootstrap.ts',{loader:'ts'})).code;
  const modules:Record<string,string>={
   'qa.entry':'import "qa.bootstrap"; export const fontHelper=globalThis.qaFontValue;',
   'qa.bootstrap':code,
   './diagnostics':'export {};',
   'virtual:runtime-profile':'export async function loadRuntimePlugins(){return []}',
   '@rewrite/player':`export class GamePlayer {constructor(h,b,report){this.report=report;}async init(){${reportFailure?'this.report("Preparation failed");':'const parser=await import("qa.parser");if(parser.read()!==42)throw Error("Parser helper unavailable");'}}async start(){${startFailure?'this.report("Start failed");':''}}dispose(){}}`,
   'qa.parser':'import {fontHelper} from "qa.entry";export const read=()=>fontHelper;'
  };
  let guarded=false;
  const result=await build({configFile:false,root,logLevel:'silent',plugins:[{name:'startup-cycle-fixture',resolveId:id=>Object.hasOwn(modules,id)?'\0'+id:undefined,load:id=>id.startsWith('\0')?modules[id.slice(1)]:undefined,generateBundle(_o,output){for(const file of Object.values(output))if(file.type==='chunk'&&file.isEntry)guarded=hasModuleAwait(this.parse(file.code));}}],build:{target:'es2022',write:false,minify:false,rollupOptions:{input:'qa.entry',preserveEntrySignatures:'strict',output:{format:'es',entryFileNames:'entry.mjs',chunkFileNames:'[name]-[hash].mjs'}}}});
  if(!('output' in result))throw Error('Expected a single build output');
  let backReference=false;for(const file of result.output){if(file.type==='chunk'){if(!file.isEntry&&file.imports.includes('entry.mjs'))backReference=true;await writeFile(join(root,file.fileName),file.code);}}
  if(!reportFailure)expect(backReference).toBe(true); // This is the real lazy parser -> entry dependency, not an artificial pending promise.
  const driver=`globalThis.qaFontValue=42;const elements=Object.fromEntries(['#status','#start','#game'].map(id=>[id,{dataset:{},disabled:true,addEventListener(type,listener){this[type]=listener;},setAttribute(){}}]));globalThis.document={querySelector:id=>elements[id]??null};globalThis.window={addEventListener(){}};globalThis.fetch=async()=>({ok:true,json:async()=>({runtimes:[]})});let entrySettled=false;import(${JSON.stringify(new URL('file://'+join(root,'entry.mjs')).href)}).then(()=>{entrySettled=true});const end=Date.now()+1000;while(Date.now()<end&&elements['#status'].textContent!=='Ready')await new Promise(r=>setTimeout(r,5));${startFailure?'await elements["#start"].click();':''}console.log(JSON.stringify({entrySettled,phase:elements['#game'].dataset.startupPhase,ready:elements['#status'].textContent==='Ready'}));`;
  const run=await exec(process.execPath,['--input-type=module','-e',driver],{timeout:5000});return{guarded,...JSON.parse(run.stdout.trim()) as {entrySettled:boolean;phase:string;ready:boolean}};
 }finally{await rm(root,{recursive:true,force:true});}
}
it('finishes the actual browser entry before a lazy Pixi parser imports its shared helper back',async()=>{expect(await fixture(false)).toEqual({guarded:false,entrySettled:true,phase:'ready',ready:true});});
it('reproduces the previous top-level-await deadlock and rejects that entry shape in the build guard',async()=>{expect(await fixture(true)).toEqual({guarded:true,entrySettled:false,phase:'initialize',ready:false});});

it('keeps a fatal preparation diagnostic visible when init returns after disposal',async()=>{expect(await fixture(false,true)).toEqual({guarded:false,entrySettled:true,phase:'failed',ready:false});});

it('keeps a fatal Start diagnostic visible when start returns after disposal',async()=>{expect(await fixture(false,false,true)).toEqual({guarded:false,entrySettled:true,phase:'failed',ready:false});});
