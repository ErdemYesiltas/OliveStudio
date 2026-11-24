// Behaviors (XState) end to end through MCP: machine script, attach with pin, Preview inspection and events, game-clock
// delays under Pause, Play/Stop without leftovers, then the HTML export running the same machine in separate Chrome.
import {chromium,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {extname,join,resolve,sep} from 'node:path';
import {launchMcpFixture} from './helpers/mcp-fixture.mjs';
const f=await launchMcpFixture('behavior');const {call,raw,approve,job,page}=f;let browser,server;
const failure=async(name,args)=>{const r=await raw(name,args);expect(r.result.isError,JSON.stringify(r)).toBe(true);return r.result.content[0].text;};
try{
 await f.grant();await approve(await call('project.new'));
 const api=await call('behavior.describe_api');expect(api.provider).toEqual({id:'xstate',version:'5.33.4'});expect(api.events.map(e=>e.type)).toContain('click');
 const guard=await call('add_object',{item:'pixi.rect',name:'Guard',x:100,y:200});
 const source=`const {setup} = xstate;
export const machine = setup({actions: {place: ({context}, x: number) => { context.self.x = x; }}}).createMachine({
  id: 'guard', version: '1',
  context: ({input}) => ({self: input.self}),
  initial: 'idle',
  states: {
    idle: {entry: {type: 'place', params: 100}, after: {500: 'patrol'}},
    patrol: {entry: {type: 'place', params: 400}, on: {click: 'alert'}},
    alert: {entry: {type: 'place', params: 700}, on: {reset: 'idle'}},
  },
});`;
 const {script}=await call('behavior.upsert_machine',{name:'Guard',source});
 expect(script.error).toBeUndefined();const machine=await call('behavior.describe_machine',{scriptId:script.id});expect(machine).toMatchObject({id:'guard',version:'1',states:['idle','patrol','alert'],initial:['idle'],events:['click','reset']});
 await call('behavior.attach',{entityId:guard.id,scriptId:script.id});
 const listed=await call('behavior.list');expect(listed.problems).toEqual([]);expect(listed.behaviors).toEqual([expect.objectContaining({entityId:guard.id,script:'Guard',machine:{id:'guard',version:'1'}})]);
 expect(await failure('behavior.inspect',{})).toMatch(/Start Preview first/);

 const play=async()=>expect.poll(async()=>{const r=await raw('preview.control',{action:'play'});if(r.result.isError&&!/still loading/.test(r.result.content[0].text))throw Error(r.result.content[0].text);return r.result.isError;},{timeout:30000}).toBe(false);
 await play();await call('preview.control',{action:'pause'});
 const first=await call('behavior.inspect',{});expect(first.paused).toBe(true);expect(first.actors[0]).toMatchObject({object:'Guard',status:'active',states:['idle'],machine:{id:'guard',version:'1'}});
 // Paused: real time passes, game time and the 500 ms delay do not.
 await page.waitForTimeout(900);const still=await call('behavior.inspect',{});expect(still.actors[0].states).toEqual(['idle']);expect(still.time).toBe(first.time);
 await call('preview.control',{action:'resume'});
 await expect.poll(async()=>(await call('behavior.inspect',{})).actors[0].states,{timeout:10000}).toEqual(['patrol']);
 const sent=await call('behavior.send_event',{entityId:guard.id,event:{type:'click'},session:first.session});expect(sent.actor.states).toEqual(['alert']);expect(sent.actor.history.at(-1)).toMatchObject({event:'click',from:['patrol'],to:['alert']});
 expect(await failure('behavior.send_event',{entityId:guard.id,event:{type:'fly'}})).toMatch(/does not handle fly/);
 expect(await failure('behavior.send_event',{entityId:guard.id,event:{type:'xstate.init'}})).toMatch(/xstate\./);
 await expect(page.getByTestId('behavior-panel')).toHaveCount(0);
 await call('editor.panel',{id:'studio.behavior',mode:'open'});await expect(page.getByTestId('behavior-panel')).toHaveAttribute('data-session',String(first.session));await expect(page.getByTestId('behavior-states').first()).toHaveText('alert');
 await call('preview.control',{action:'stop'});
 expect(await failure('behavior.inspect',{})).toMatch(/Start Preview first/);
 await expect(page.getByTestId('behavior-panel')).toContainText('Behaviors show here while Preview runs');
 // A new Preview starts a fresh actor; the old session is refused by number.
 await play();const again=await call('behavior.inspect',{});expect(again.session).toBeGreaterThan(first.session);expect(again.actors).toHaveLength(1);expect(again.actors[0].history.map(h=>h.event)).not.toContain('click');
 expect(await failure('behavior.send_event',{entityId:guard.id,event:{type:'click'},session:first.session})).toMatch(/has ended/);
 await call('preview.control',{action:'stop'});
 expect((await call('scene.list_objects')).items.find(o=>o.id===guard.id)).toBeTruthy();

 const handle=await call('build.export',{target:'html',path:f.temp});await page.getByRole('button',{name:'Approve',exact:true}).click();const output=(await job(handle)).output;
 const report=JSON.parse(await readFile(join(output,'runtime-report.json'),'utf8'));expect(report.runtimes).toEqual(expect.arrayContaining(['scripts','behavior']));
 server=createServer(async(req,res)=>{try{const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname),file=resolve(output,'.'+(name.endsWith('/')?name+'index.html':name));if(!file.startsWith(output+sep))throw Error('Outside export');res.setHeader('Content-Type',({'.js':'text/javascript','.html':'text/html','.json':'application/json','.webp':'image/webp','.wasm':'application/wasm'}[extname(file)])??'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404).end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-swiftshader']});
 const game=await browser.newPage(),gameErrors=[];game.on('pageerror',e=>gameErrors.push(e.message));game.on('console',m=>{if(m.type()==='error')gameErrors.push(m.text());});
 await game.goto(`http://127.0.0.1:${server.address().port}/`);await game.getByRole('button',{name:'Start',exact:true}).click();
 const x=async()=>JSON.parse(await game.locator('#game').getAttribute('data-poses')??'{}')[guard.id]?.x;
 await expect.poll(x,{timeout:30000}).toBe(400);
 const b=await game.locator('canvas').boundingBox(),scale=Math.min(b.width/960,b.height/540);
 await game.mouse.click(b.x+(b.width-960*scale)/2+400*scale,b.y+(b.height-540*scale)/2+200*scale);
 await expect.poll(x,{timeout:10000}).toBe(700);
 expect(gameErrors).toEqual([]);expect(f.errors).toEqual([]);
 console.log(`PASS behaviors: XState ${api.provider.version} machine via MCP (describe/attach/pin), Preview inspect/send with session guard, delays frozen while paused, Play/Stop without leftovers, live panel; HTML export (${report.runtimes.join(', ')}) runs the machine in Chrome (delay + click)`);
}finally{await browser?.close();server?.close();await f.close();}
