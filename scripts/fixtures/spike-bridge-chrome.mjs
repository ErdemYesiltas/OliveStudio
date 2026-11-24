// The bridge spike in Chrome (the browser exported games and the editor run in): serves the spike page with Vite and
// reads its timings. Writes outputs/spike-bridge/chrome.json. See modules/scripts/src/spike/array-bridge.ts.
import {createServer} from 'vite';
import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
const root=resolve('.'),server=await createServer({configFile:false,root,logLevel:'error',optimizeDeps:{noDiscovery:true,include:[]},server:{port:0,host:'127.0.0.1'}});await server.listen();
const port=server.httpServer.address().port,browser=await chromium.launch({channel:'chrome'});
try{const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('requestfailed',r=>errors.push('failed '+r.url()));setTimeout(()=>console.log('still waiting',errors),60000).unref();
 await page.goto(`http://127.0.0.1:${port}/modules/scripts/src/spike/bridge.html`,{waitUntil:'commit'});
 const result=await page.waitForFunction(()=>window.__result,undefined,{timeout:120000}).then(h=>h.jsonValue());
 await mkdir(join(root,'outputs/spike-bridge'),{recursive:true});await writeFile(join(root,'outputs/spike-bridge/chrome.json'),JSON.stringify({...result,errors},null,1)+'\n');
 for(const r of result.results)console.log(r.count,r.method.padEnd(8),r.medianMs,r.p95Ms,r.checksum);if(errors.length)console.log(errors);
}finally{await browser.close();await server.close();}
