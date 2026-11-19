import { readdir,readFile } from 'node:fs/promises';
import { join } from 'node:path';
const errors=[];
async function walk(path){for(const e of await readdir(path,{withFileTypes:true})){const file=join(path,e.name);if(e.isDirectory()){if(!['node_modules','out','dist'].includes(e.name))await walk(file);}else if(/\.(ts|tsx)$/.test(file)&&!file.endsWith('.test.ts')){
 const normalized=file.replaceAll('\\','/');const text=await readFile(file,'utf8');const imports=[...text.matchAll(/(?:from\s*|import\s*|import\s*\()(['"])([^'"]+)\1/g)].map(m=>m[2]);
 for(const name of imports){
  if(name.includes('@aperion')||name.includes('@pixi-editor/')||name.includes('/internal/'))errors.push(`${file}: forbidden legacy/internal import ${name}`);
  if(normalized.startsWith('packages/')&&(/@rewrite\/(scene|render-pixi|project|assets|assetpack|audio|audio-howler|tween|animation|physics|spine|interactions|player|html-export|build|runtime-export|prefabs|recovery)/.test(name)||(['pixi.js','gsap','howler','electron'].includes(name)||(!normalized.startsWith('packages/ui/')&&['react','react-dom','@rewrite/ui','@tanstack/react-virtual'].includes(name)))))errors.push(`${file}: kernel domain/platform dependency ${name}`);
  if(normalized.startsWith('modules/')&&(name==='electron'||(name.startsWith('node:')&&!normalized.endsWith('.node.ts'))||name.includes('/apps/')))errors.push(`${file}: module crosses platform/composition boundary ${name}`);
  if(name.startsWith('.')&&normalized.startsWith('packages/')&&name.includes('../../../'))errors.push(`${file}: relative cross-package import ${name}`);
 }
}}}
for(const path of ['packages','modules','apps'])await walk(path);
if(errors.length){console.error(errors.join('\n'));process.exitCode=1;}else console.log('PASS package boundaries: no legacy, domain in kernel, or native module imports');
