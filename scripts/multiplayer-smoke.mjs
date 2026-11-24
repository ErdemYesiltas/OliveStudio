// Multiplayer (Colyseus) end to end: MCP setup, the editor's local server and Preview client (server-authoritative
// movement, drop + reconnect to the same seat), then the HTML export and the separately exported Node server running
// outside the editor with two independent Chrome clients that see each other move.
import {chromium,expect} from '@playwright/test';
import {fork} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {extname,join,resolve,sep} from 'node:path';
import {freePort,launchMcpFixture} from './helpers/mcp-fixture.mjs';
const f=await launchMcpFixture('multiplayer');const {call,raw,approve,job,page}=f;let browser,web,game;
try{
 await f.grant();await approve(await call('project.new'));
 const hero=await call('add_object',{item:'pixi.rect',name:'Hero',x:120,y:200});
 const setup=await call('multiplayer.setup',{entityId:hero.id});expect(setup.template).toBe(hero.id);expect(setup.problems).toEqual([]);
 const settings=await call('multiplayer.get_settings');expect(settings.rules).toMatchObject({room:'game',speed:220,spawn:{x:120,y:200},bounds:{width:960,height:540}});
 expect((await raw('multiplayer.set_settings',{endpoint:'ws://user:secret@evil.example'})).result.isError).toBe(true);

 // Preview joins the editor's local server (started on demand) and moves only through server-validated inputs.
 await expect.poll(async()=>{const r=await raw('preview.control',{action:'play'});if(r.result.isError&&!/still loading/.test(r.result.content[0].text))throw Error(r.result.content[0].text);return r.result.isError;},{timeout:30000}).toBe(false);
 await expect.poll(async()=>{const s=await call('multiplayer.client_status');if(s.status==='error')throw Error('Preview client: '+JSON.stringify(s)+' server: '+JSON.stringify(await call('multiplayer.server_status')));return s.status;},{timeout:20000}).toBe('connected');const joined=await call('multiplayer.client_status');
 expect(joined.players).toEqual([expect.objectContaining({local:true,name:'Editor',x:120,y:200})]);
 const server=await call('multiplayer.server_status');expect(server.running).toBe(true);expect(server.endpoint).toMatch(/^ws:\/\/127\.0\.0\.1:\d+$/);
 await call('preview.input',{code:'ArrowRight',down:true});await page.waitForTimeout(500);await call('preview.input',{code:'ArrowRight',down:false});
 await expect.poll(async()=>(await call('multiplayer.server_status')).rooms[0].players[0].x,{timeout:5000}).toBeGreaterThan(160);
 // Prediction converges on the server's position once every input is acknowledged.
 await expect.poll(async()=>{const server=(await call('multiplayer.server_status')).rooms[0].players[0].x,client=await call('multiplayer.client_status');return client.pending===0?Math.abs(client.players[0].x-server):99;},{timeout:5000}).toBeLessThan(1);
 await call('editor.panel',{id:'studio.multiplayer',mode:'open'});await expect(page.getByTestId('multiplayer-server')).toHaveAttribute('data-running','true');await expect(page.getByTestId('multiplayer-client')).toHaveAttribute('data-status','connected');
 // Dropped without consent: the seat stays and the Preview client reconnects to it.
 await call('multiplayer.simulate',{latencyMs:80,dropSessionId:joined.sessionId});
 await expect.poll(async()=>{const s=await call('multiplayer.client_status');return `${s.status}:${s.sessionId}`;},{timeout:15000}).toBe(`connected:${joined.sessionId}`);
 expect((await call('multiplayer.server_status')).latencyMs).toBe(80);
 await call('preview.control',{action:'stop'});
 await expect.poll(async()=>(await call('multiplayer.server_status')).rooms.reduce((n,r)=>n+r.players.length,0),{timeout:10000}).toBe(0);
 expect((await raw('multiplayer.client_status')).result.isError).toBe(true);
 expect((await call('multiplayer.server',{action:'stop'})).running).toBe(false);

 // The exported server runs outside the editor; the exported HTML game connects to it.
 const port=await freePort();await call('multiplayer.set_settings',{endpoint:`ws://127.0.0.1:${port}`,reconnectSeconds:10});
 const html=(await job(await (async()=>{const h=await call('build.export',{target:'html',path:f.temp});await page.getByRole('button',{name:'Approve',exact:true}).click();return h;})())).output;
 const out=(await job(await (async()=>{const h=await call('build.export',{target:'server',path:f.temp});await page.getByRole('button',{name:'Approve',exact:true}).click();return h;})())).output;
 const report=JSON.parse(await readFile(join(html,'runtime-report.json'),'utf8'));expect(report.runtimes).toEqual(expect.arrayContaining(['input','multiplayer']));
 const project=JSON.parse(await readFile(join(html,'project.json'),'utf8'));expect(JSON.stringify(project)).not.toMatch(/secret|token|password/i);
 expect(JSON.parse(await readFile(join(out,'rules.json'),'utf8'))).toMatchObject({room:'game',speed:220,reconnectSeconds:10});
 game=fork(join(out,'server.mjs'),['--port',String(port),'--host','127.0.0.1'],{cwd:out,stdio:['ignore','pipe','pipe','ipc'],env:{...process.env,ELECTRON_RUN_AS_NODE:'1'}});
 await new Promise((ok,fail)=>{const t=setTimeout(()=>fail(Error('exported server did not start')),15000);game.on('message',m=>{if(m.type==='ready'){clearTimeout(t);ok();}});game.on('exit',c=>fail(Error('exported server exited '+c)));});
 const control=(type,extra={})=>new Promise((ok,fail)=>{const id=Math.random();const on=m=>{if(m.id!==id)return;game.off('message',on);if(m.ok)ok(m.value);else fail(Error(m.error));};game.on('message',on);game.send({id,type,...extra});});
 web=createServer(async(req,res)=>{try{const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname),file=resolve(html,'.'+(name.endsWith('/')?name+'index.html':name));if(!file.startsWith(html+sep))throw Error('Outside export');res.setHeader('Content-Type',({'.js':'text/javascript','.html':'text/html','.json':'application/json','.webp':'image/webp','.wasm':'application/wasm'}[extname(file)])??'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404).end();}});
 await new Promise(r=>web.listen(0,'127.0.0.1',r));browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-swiftshader']});
 const open=async name=>{const context=await browser.newContext(),p=await context.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto(`http://127.0.0.1:${web.address().port}/?name=${name}`);await p.getByRole('button',{name:'Start',exact:true}).click();return{p,errors,net:async()=>JSON.parse(await p.locator('#game').getAttribute('data-multiplayer')??'{"players":[]}')};};
 const ada=await open('Ada'),bo=await open('Bo');
 await expect.poll(async()=>[(await ada.net()).players.length,(await bo.net()).players.length,(await ada.net()).status],{timeout:20000}).toEqual([2,2,'connected']).catch(async e=>{throw Error(`${e.message}\nAda: ${JSON.stringify(await ada.net())} ${ada.errors}\nBo: ${JSON.stringify(await bo.net())} ${bo.errors}`);});
 const adaId=(await ada.net()).sessionId,start=(await bo.net()).players.find(p=>p.sessionId===adaId).x;
 await ada.p.locator('canvas').click();await ada.p.keyboard.down('ArrowRight');await ada.p.waitForTimeout(600);await ada.p.keyboard.up('ArrowRight');
 await expect.poll(async()=>(await bo.net()).players.find(p=>p.sessionId===adaId).x,{timeout:5000}).toBeGreaterThan(start+60);
 await expect.poll(async()=>{const authoritative=(await control('status')).rooms[0].players.find(p=>p.sessionId===adaId).x;return Math.abs((await bo.net()).players.find(p=>p.sessionId===adaId).x-authoritative);},{timeout:5000}).toBeLessThan(1);
 // Exported server drops Ada; her client rejoins the same seat while Bo keeps seeing her.
 await control('drop',{sessionId:adaId});
 await expect.poll(async()=>{const s=await ada.net();return `${s.status}:${s.sessionId}`;},{timeout:15000}).toBe(`connected:${adaId}`);
 expect((await bo.net()).players.map(p=>p.sessionId)).toContain(adaId);
 // Closing the tab is a drop, not a leave: Bo sees Ada disconnected for the reconnect window, then her seat goes.
 await ada.p.context().close();
 await expect.poll(async()=>(await bo.net()).players.find(p=>p.sessionId===adaId)?.connected,{timeout:5000}).toBe(false);
 await expect.poll(async()=>(await bo.net()).players.length,{timeout:20000}).toBe(1);
 expect(ada.errors).toEqual([]);expect(bo.errors).toEqual([]);expect(f.errors).toEqual([]);
 console.log(`PASS multiplayer: MCP setup, local server + Preview client (authoritative movement, drop/reconnect, latency), HTML export (${report.runtimes.join(', ')}) + exported Node server outside the editor with two Chrome clients (movement seen remotely, drop/reconnect, leave)`);
}finally{await browser?.close();web?.close();game?.kill();await f.close();}
