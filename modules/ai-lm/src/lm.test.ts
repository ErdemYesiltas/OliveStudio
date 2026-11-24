import {afterEach, expect, it} from 'vitest';
import {createServer, type Server} from 'node:http';
import {assertLocal, pickModel, stripThinking, type ChatResult, type Message} from './contracts';
import {LmClient} from './client.node';
import {runAgent, promptWriterMessages, systemPrompt} from './agent';

let server: Server | undefined;
afterEach(() => new Promise<void>(r => server ? server.close(() => r()) : r()));
const listen = async (handler: Parameters<typeof createServer>[1]) => { server = createServer(handler); await new Promise<void>(r => server!.listen(0, '127.0.0.1', () => r())); return `http://127.0.0.1:${(server.address() as {port: number}).port}`; };

it('pure helpers: loopback only, thinking stripped, model choice prefers loaded tool models', () => {
 expect(() => assertLocal('http://10.0.0.2:1234')).toThrow('this computer');
 expect(stripThinking('<think>plan…</think>\n\nDone.')).toBe('Done.');
 expect(stripThinking('<think>still thinking')).toBe('');
 const models = [{id: 'embed', type: 'embeddings', loaded: true, tools: false}, {id: 'big', type: 'llm', loaded: false, tools: true}, {id: 'small', type: 'llm', loaded: true, tools: false}, {id: 'qwen', type: 'llm', loaded: true, tools: true}];
 expect(pickModel(models)).toBe('qwen'); expect(pickModel(models, 'big')).toBe('big'); expect(pickModel(models.slice(0, 3))).toBe('small'); expect(pickModel([])).toBe('');
 expect(systemPrompt({stage: {width: 960, height: 540}, project: 'P'})).toContain('(480, 270)');
 expect(promptWriterMessages('coin sound', 'audio')[0].content).toContain('text-to-audio');
});

it('client: LM Studio model list with loaded state and tool use, OpenAI fallback, offline', async () => {
 let native = true;
 const url = await listen((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.url === '/api/v0/models' && native) return res.end(JSON.stringify({data: [{id: 'qwen', type: 'llm', state: 'loaded', capabilities: ['tool_use'], max_context_length: 32768}, {id: 'nomic', type: 'embeddings', state: 'not-loaded'}]}));
  if (req.url === '/v1/models') return res.end(JSON.stringify({data: [{id: 'gemma'}, {id: 'text-embedding-x'}]}));
  res.statusCode = 404; res.end('{}');
 });
 expect(await new LmClient(url).status()).toMatchObject({online: true, models: [{id: 'qwen', loaded: true, tools: true, context: 32768}, {id: 'nomic', type: 'embeddings', loaded: false}]});
 native = false;
 expect((await new LmClient(url).status()).models.map(m => [m.id, m.type])).toEqual([['gemma', 'llm'], ['text-embedding-x', 'embeddings']]);
 expect(await new LmClient('http://127.0.0.1:1').status()).toMatchObject({online: false});
});

it('client: streams content and merges tool-call fragments by index', async () => {
 let body: {tools?: unknown; stream?: boolean} = {};
 const url = await listen((req, res) => {
  let raw = ''; req.on('data', c => { raw += c; }); req.on('end', () => {
   body = JSON.parse(raw);
   res.writeHead(200, {'Content-Type': 'text/event-stream'});
   const send = (v: unknown) => res.write(`data: ${JSON.stringify(v)}\n\n`);
   send({choices: [{delta: {content: '<think>x</think>Adding '}}]});
   send({choices: [{delta: {tool_calls: [{index: 0, id: 'c1', function: {name: 'add_', arguments: '{"item":'}}]}}]});
   send({choices: [{delta: {tool_calls: [{index: 0, function: {name: 'object', arguments: '"pixi.circle"}'}}, {index: 1, id: 'c2', function: {name: 'get_editor_state', arguments: ''}}]}}]});
   send({choices: [{delta: {}, finish_reason: 'tool_calls'}]});
   res.end('data: [DONE]\n\n');
  });
 });
 const deltas: unknown[] = [];
 const result = await new LmClient(url).chat({model: 'qwen', messages: [{role: 'user', content: 'hi'}], tools: [{type: 'function', function: {name: 'add_object', description: 'd', parameters: {}}}]}, d => deltas.push(d), new AbortController().signal);
 expect(body).toMatchObject({stream: true, tools: [{type: 'function'}]});
 expect(result.content).toBe('<think>x</think>Adding ');
 expect(result.toolCalls).toEqual([{id: 'c1', type: 'function', function: {name: 'add_object', arguments: '{"item":"pixi.circle"}'}}, {id: 'c2', type: 'function', function: {name: 'get_editor_state', arguments: '{}'}}]);
 expect(result.finish).toBe('tool_calls');
 expect(deltas).toContainEqual({content: 'Adding '.replace('Adding ', '<think>x</think>Adding ')});
});

it('agent: executes tool calls, returns errors to the model, stops at the step limit', async () => {
 const replies: ChatResult[] = [
  {content: '', finish: 'tool_calls', toolCalls: [{id: 'a', type: 'function', function: {name: 'add', arguments: '{"n":1}'}}, {id: 'b', type: 'function', function: {name: 'boom', arguments: '{}'}}, {id: 'c', type: 'function', function: {name: 'add', arguments: '{bad json'}}]},
  {content: '<think>ok</think>Added one.', finish: 'stop', toolCalls: []},
 ];
 const seen: Message[][] = [];
 const tools = {specs: ['add', 'boom'].map(name => ({type: 'function' as const, function: {name, description: name, parameters: {}}})), execute: (name: string, args: Record<string, unknown>) => { if (name === 'boom') throw Error('nope'); return {added: args.n}; }};
 const result = await runAgent({messages: [{role: 'user', content: 'go'}], tools, chat: async messages => { seen.push(structuredClone(messages)); return replies.shift()!; }});
 expect(result.reply).toBe('Added one.');
 expect(result.steps.map(s => [s.name, s.ok])).toEqual([['add', true], ['boom', false], ['add', false]]);
 const toolMessages = seen[1].filter(m => m.role === 'tool').map(m => JSON.parse((m as {content: string}).content));
 expect(toolMessages).toEqual([{ok: true, result: {added: 1}}, {ok: false, error: 'nope'}, expect.objectContaining({ok: false})]);
 const loop = await runAgent({messages: [{role: 'user', content: 'go'}], tools, maxSteps: 2, chat: async () => ({content: '', finish: 'tool_calls', toolCalls: [{id: 'x', type: 'function', function: {name: 'add', arguments: '{}'}}]})});
 expect(loop.reply).toContain('too many steps'); expect(loop.steps).toHaveLength(2);
});

it('reasoning models: thinking arrives as reasoning_content, reasoning_effort is sent, empty answers are errors', async () => {
 let body: Record<string, unknown> = {};
 const url = await listen((req, res) => {
  let raw = ''; req.on('data', c => { raw += c; }); req.on('end', () => {
   body = JSON.parse(raw);
   res.writeHead(200, {'Content-Type': 'text/event-stream'});
   const send = (v: unknown) => res.write(`data: ${JSON.stringify(v)}\n\n`);
   send({choices: [{delta: {role: 'assistant', reasoning_content: 'Input is Turkish…'}}]});
   if (body.reasoning_effort !== 'none') { send({choices: [{delta: {}, finish_reason: 'length'}]}); return res.end('data: [DONE]\n\n'); }
   send({choices: [{delta: {content: 'rusty red car, pixel art'}}]}); send({choices: [{delta: {}, finish_reason: 'stop'}]}); res.end('data: [DONE]\n\n');
  });
 });
 const client = new LmClient(url), deltas: unknown[] = [];
 const spent = await client.chat({model: 'gemma', messages: [{role: 'user', content: 'x'}], maxTokens: 400}, d => deltas.push(d), new AbortController().signal);
 expect(spent).toMatchObject({content: '', finish: 'length', reasoningChars: 17});
 expect(deltas).toEqual([{reasoning: 'Input is Turkish…'}]);
 const {emptyReplyError} = await import('./contracts');
 expect(emptyReplyError(spent).message).toContain('token budget thinking');
 await expect(runAgent({messages: [{role: 'user', content: 'x'}], tools: {specs: [], execute: () => null}, chat: async () => spent})).rejects.toThrow('token budget');
 const fast = await client.chat({model: 'gemma', messages: [{role: 'user', content: 'x'}], reasoning: 'none'}, () => {}, new AbortController().signal);
 expect(body).toMatchObject({reasoning_effort: 'none', max_tokens: 8192}); expect(fast.content).toBe('rusty red car, pixel art');
});

it('prompt writer reports each phase and never fails silently', async () => {
 const {writePrompt} = await import('./views');
 const listeners = new Set<(d: {jobId: string; content?: string; reasoning?: string}) => void>();
 let reply = {content: 'rusty red car, side view', finish: 'stop', toolCalls: [], reasoningChars: 0}, sent: Record<string, unknown> = {};
 const port = {
  status: async () => ({online: true, url: 'x', models: [{id: 'gemma', type: 'vlm', loaded: true, tools: true}]}),
  chat: async (_u: string, jobId: string, request: Record<string, unknown>) => { sent = request; for (const fn of listeners) { fn({jobId, reasoning: 'hm'}); fn({jobId, content: 'rusty'}); } return reply; },
  cancel: async () => {}, onDelta: (fn: (d: {jobId: string}) => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
 };
 const phases: string[] = [];
 expect(await writePrompt(port as never, 'x', '', [{role: 'user', content: 'araba'}], s => phases.push(s.phase))).toBe('rusty red car, side view');
 expect(phases).toEqual(['connecting', 'waiting', 'thinking', 'writing', 'done']);
 expect(sent).toMatchObject({model: 'gemma', reasoning: 'none', maxTokens: 1500});
 expect(listeners.size).toBe(0);
 reply = {content: '', finish: 'length', toolCalls: [], reasoningChars: 900};
 await expect(writePrompt(port as never, 'x', '', [{role: 'user', content: 'araba'}])).rejects.toThrow('token budget thinking');
 await expect(writePrompt({...port, status: async () => ({online: false, url: 'x', models: []})} as never, 'x', '', [])).rejects.toThrow('not running');
});

import {batches, parseTranslation, translationMessages} from './translate';
it('translation prompts ask for JSON with every plural category and keep placeholders', () => {
 const job = {from: {id: 'en', name: 'English'}, to: {id: 'ru', name: 'Russian'}, items: Array.from({length: 25}, (_, i) => ({key: `k${i}`, text: `Text ${i}`})), plurals: [{base: 'coins', forms: {one: '{{count}} coin', other: '{{count}} coins'}, note: 'HUD'}], categories: ['one', 'few', 'many', 'other']};
 const parts = batches(job);
 expect(parts.map(b => b.items.length + b.plurals.length)).toEqual([20, 6]);
 const m = translationMessages(job, parts[1], 'Glossary: Coin → Монета');
 expect(m[0].content).toContain('<key>_one, <key>_few, <key>_many, <key>_other'); expect(m[0].content).toContain('Glossary: Coin → Монета');
 expect(m[1].content).toContain('"coins_many"'); expect(m[1].content).toContain('"note": "HUD"');
 expect(parseTranslation('<think>x</think>```json\n{"k1":"Текст","k2":3,"other":"x"}\n```', ['k1', 'k2'])).toEqual({k1: 'Текст'});
 expect(() => parseTranslation('sorry', ['k1'])).toThrow('JSON object');
});

it('does not finish on an async acknowledgement: reports authoritative job failure and lets the model repair the task',async()=>{
 let round=0,polls=0;
 const result=await runAgent({messages:[{role:'user',content:'Finish the job'}],tools:{specs:['start','fix','automation__job'].map(name=>({type:'function',function:{name,description:name,parameters:{type:'object'}}})),execute:(name)=>{if(name==='start')return{id:'job',state:'running'};if(name==='automation__job'){polls++;return{id:'job',state:'failed',error:{message:'Provider unavailable'}};}return{ok:true};}},chat:async messages=>{
  round++;if(round===1)return{content:'',toolCalls:[{id:'a',type:'function',function:{name:'start',arguments:'{}'}}],finish:'tool_calls'};
  if(round===2)return{content:'Done prematurely',toolCalls:[],finish:'stop'};
  if(round===3){expect(messages.at(-1)?.content).toContain('Provider unavailable');return{content:'',toolCalls:[{id:'b',type:'function',function:{name:'fix',arguments:'{}'}}],finish:'tool_calls'};}
  return{content:'Repaired and finished',toolCalls:[],finish:'stop'};
 }});expect(result.reply).toBe('Repaired and finished');expect(polls).toBe(1);expect(result.steps.map(s=>s.name)).toEqual(['start','fix']);
});
