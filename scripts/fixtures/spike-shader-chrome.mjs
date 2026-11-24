// The shader-compile spike in Chrome: a hidden second backend next to the visible one. Writes outputs/spike-shader/chrome.json.
// reads its timings. Writes outputs/spike-shader/chrome.json. See modules/scripts/src/spike/array-bridge.ts.
import {createServer} from 'vite';
import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
const root=resolve('.'),server=await createServer({configFile:false,root,logLevel:'error',optimizeDeps:{entries:['modules/render-pixi3d/src/spike/shader-compile.html']},server:{port:0,host:'127.0.0.1'}});await server.listen();
const port=server.httpServer.address().port,browser=await chromium.launch({channel:'chrome',args:['--enable-unsafe-webgpu']});
try{const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('requestfailed',r=>errors.push('failed '+r.url()));setTimeout(()=>console.log('still waiting',errors),60000).unref();
 await page.goto(`http://127.0.0.1:${port}/modules/render-pixi3d/src/spike/shader-compile.html`,{waitUntil:'commit'});
 const result=await page.waitForFunction(()=>window.__result,undefined,{timeout:120000}).then(h=>h.jsonValue());
 await mkdir(join(root,'outputs/spike-shader'),{recursive:true});await writeFile(join(root,'outputs/spike-shader/chrome.json'),JSON.stringify({...result,errors},null,1)+'\n');
 for(const r of result.results){const k=r.hidden?'hidden':'same',p=r[k];if(!p){console.log(JSON.stringify(r).slice(0,400));continue;}console.log(r.main,k,p.backend,'init',p.initMs,'ms');for(const s of ['good','bad','goodAfterBad'])console.log('  ',s,JSON.stringify({ms:p[s].ms,threw:p[s].threw,centre:p[s].centre,mentions:p[s].mentionsUserLine,genLine:p[s].generatedLine,userLine:p[s].userLine,err:(p[s].gpuErrors[0]??p[s].logged[0]??'').slice(0,90)}));}if(errors.length)console.log(errors);
}finally{await browser.close();await server.close();}
