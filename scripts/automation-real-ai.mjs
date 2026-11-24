// Real local model, not a scripted provider: its only actions are MCP tool calls to an isolated running editor.
import {expect,chromium} from '@playwright/test';
import {createServer as createViteServer} from 'vite';
import {createServer} from 'node:http';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,resolve,extname,sep} from 'node:path';
import {launchMcpFixture,workspace} from './helpers/mcp-fixture.mjs';
const endpoint=process.env.OLIVE_AI_URL??'http://127.0.0.1:1234',model=process.env.OLIVE_AI_MODEL??'olive-mcp-acceptance';
const status=await fetch(`${endpoint}/v1/models`).then(r=>r.json());if(!status.data?.some(m=>m.id===model))throw Error(`Load a real local model with identifier ${model} before this test`);
const ssr=await createViteServer({root:workspace,configFile:false,server:{middlewareMode:true}}),f=await launchMcpFixture('real-ai');let browser,server;
const transcript=[],approvals=[],approvalFailures=[];const artifact=join(workspace,'outputs','automation-real-ai',process.env.REWRITE_EXECUTABLE?'packaged':'source');await mkdir(artifact,{recursive:true});
try{
 await f.grant();await f.approve(await f.call('project.new'));const file=join(f.temp,'AI acceptance.pixieditor');
 const {assistantCatalog,assistantToolName}=await ssr.ssrLoadModule('/apps/editor-desktop/src/renderer/assistant-catalog.ts');
 const catalog=(await f.rpc('tools/list')).result.tools,tools=assistantCatalog(catalog);
 expect(tools.length).toBeLessThanOrEqual(64);
 const messages=[{role:'system',content:'You are using a live Pixi game editor exclusively through MCP tools. Use the tools to perform the entire request, do not stop to ask whether to continue. Sound Lab is a procedural synthesizer, not generate_asset or a generative AI model. Direct tools provide common scene edits. Every installed module is reachable through automation__capabilities (query by feature), automation__describe_tool, and automation__execute with the returned context. Never invent IDs or component fields: read state/schema first. Long operations return job IDs: poll automation__job with waitMs=10000; the user approves critical actions in the editor. A pending approval is not completion. Stop Preview before edits or saving. Take a screenshot to check the scene before your final answer. Never claim an operation succeeded if its tool returned an error.'},
  {role:'user',content:`Use this empty project. Name the project "AI acceptance". Create a blue square named "AI Square" at x=320,y=200, width=80,height=80, colour=#2d7fff. Use Sound Lab's pickup preset (seed 7) to create a sound asset named "AI Coin" (no sound object needed). Save the project to ${file}. Export it as HTML into ${f.temp}. Wait for completion, inspect a screenshot, then report what you did. I will approve the save/export in the editor.`}];
 const {runAgent}=await ssr.ssrLoadModule('/modules/ai-lm/src/agent.ts');
 let rounds=0,approvalQueue=Promise.resolve();const images=[];
 const agent=await runAgent({messages,maxSteps:32,tools:{specs:tools,execute:async(alias,args)=>{
  const name=assistantToolName(catalog,alias);console.log(`  MCP ${name}`);const result=await f.raw(name,args);
  if(result.error||result.result.isError)throw Error(JSON.stringify(result.error??result.result.structuredContent?.error??result.result.content));
  const encoded=result.result.content.find(c=>c.type==='text'),image=result.result.content.find(c=>c.type==='image'),value=encoded?JSON.parse(encoded.text):result.result.structuredContent??{imageCaptured:Boolean(image)};
  if(value?.state==='awaiting_approval'){const pending=approvalQueue.then(()=>f.approve(value)).catch(error=>{approvalFailures.push(String(error));});approvalQueue=pending;approvals.push(pending);}
  if(image){images.push(image);await writeFile(join(artifact,'scene.png'),Buffer.from(image.data,'base64'));}return value;
 }},onStep:step=>transcript.push({tool:step.name,args:step.args,ok:step.ok,result:step.result,error:step.error}),chat:async(history,available)=>{
  console.log(`Real AI round ${++rounds}`);const outgoing=[...history];if(images.length)outgoing.push({role:'user',content:[{type:'text',text:'MCP visual observation; verify the original request.'},...images.splice(0).map(i=>({type:'image_url',image_url:{url:`data:${i.mimeType};base64,${i.data}`}}))]});
  const response=await fetch(`${endpoint}/v1/chat/completions`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model,messages:outgoing,tools:available,tool_choice:'auto',parallel_tool_calls:false,temperature:0,max_tokens:4096,reasoning_effort:'none'}),signal:AbortSignal.timeout(180000)});
  if(!response.ok)throw Error(`Model HTTP ${response.status}: ${(await response.text()).slice(0,1000)}`);const reply=await response.json(),message=reply.choices?.[0]?.message;if(!message)throw Error('No model message');transcript.push({round:rounds,reply:message.content??'',toolCalls:message.tool_calls??[]});return{content:message.content??'',toolCalls:message.tool_calls??[],finish:reply.choices[0].finish_reason??'stop'};
 }});
 await Promise.all(approvals);expect(agent.reply).not.toContain('too many steps');
 const state=await f.call('project.get_state');expect(state.name).toBe('AI acceptance');expect(state.dirty).toBe(false);
 const listing=await f.call('scene.list_objects',{query:'AI Square'});expect(listing.items).toHaveLength(1);const entity=await f.call('scene.get_object',{objectId:listing.items[0].id});expect(entity.components.find(c=>c.type==='scene.transform2d').data).toMatchObject({x:320,y:200});expect(entity.components.find(c=>c.type==='pixi.shape').data).toMatchObject({color:'#2d7fff',width:80,height:80});
 expect((await f.call('assets.list',{query:'AI Coin'})).items.some(a=>a.type==='audio.clip')).toBe(true);expect((await f.call('project.file_access')).project).toBe(file);expect(JSON.parse(await readFile(file,'utf8')).name).toBe('AI acceptance');
 const jobs=await f.call('automation.jobs'),build=jobs.find(j=>j.tool==='build.export'&&j.state==='complete');expect(build).toBeTruthy();const output=build.result.output;
 server=createServer(async(req,res)=>{try{const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname),path=resolve(output,'.'+(name.endsWith('/')?name+'index.html':name));if(!path.startsWith(output+sep))throw Error('Outside');res.setHeader('Content-Type',({'.js':'text/javascript','.html':'text/html','.json':'application/json','.webp':'image/webp'}[extname(path)])??'application/octet-stream');res.end(await readFile(path));}catch{res.writeHead(404).end();}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-swiftshader']});const game=await browser.newPage();await game.goto(`http://127.0.0.1:${server.address().port}/`);await game.getByRole('button',{name:'Start',exact:true}).click();await expect.poll(async()=>JSON.parse(await game.locator('#game').getAttribute('data-poses')??'{}')[entity.id]?.x).toBe(320);expect(f.errors).toEqual([]);
 const report={success:true,packaged:Boolean(process.env.REWRITE_EXECUTABLE),executable:process.env.REWRITE_EXECUTABLE??null,model,toolsExposed:tools.length,totalMcpTools:catalog.length,rounds:transcript.filter(t=>t.round).length,approvals:approvals.length,recoveredApprovalErrors:approvalFailures,reply:agent.reply,verified:['scene properties','Sound Lab asset','approved save','approved HTML export','independent Chrome execution','visual observation'],transcript};await writeFile(join(artifact,'report.json'),JSON.stringify(report,null,2));console.log(`PASS real AI MCP: ${model}, ${report.rounds} rounds, ${report.approvals} approvals, verified authoring/save/export and Chrome`);
} catch(error){await writeFile(join(artifact,'failure.json'),JSON.stringify({error:String(error),transcript},null,2));throw error;}
finally{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));await f.close();await ssr.close();}
