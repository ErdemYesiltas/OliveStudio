import {expect, it} from 'vitest';
import {allowedRequest, handleBody, type McpHandlers} from './mcp-protocol';

const calls: string[] = [];
const handlers: McpHandlers = {
 tools: async () => [{name: 'add_object', description: 'Add', inputSchema: {type: 'object'}}],
 call: async (name, args) => { calls.push(`${name}:${JSON.stringify(args)}`); if (args.fail) throw Error('Object not found'); return [{type: 'text', text: '{"ok":true}'}]; },
};
const info = {name: 'olivestudio', version: '0.1.0', instructions: 'Edit games'};
const rpc = (body: unknown) => handleBody(JSON.stringify(body), handlers, info);

it('initializes with a supported protocol version and lists and calls tools', async () => {
 expect(await rpc({jsonrpc: '2.0', id: 1, method: 'initialize', params: {protocolVersion: '2025-03-26', capabilities: {}, clientInfo: {name: 'x', version: '1'}}})).toEqual({jsonrpc: '2.0', id: 1, result: {protocolVersion: '2025-03-26', capabilities: {tools: {listChanged: false}}, serverInfo: {name: 'olivestudio', version: '0.1.0'}, instructions: 'Edit games'}});
 expect((await rpc({jsonrpc: '2.0', id: 2, method: 'initialize', params: {protocolVersion: '1999-01-01'}}) as {result: {protocolVersion: string}}).result.protocolVersion).toBe('2025-06-18');
 expect(await rpc({jsonrpc: '2.0', method: 'notifications/initialized'})).toBeUndefined();
 expect(await rpc({jsonrpc: '2.0', id: 3, method: 'tools/list'})).toEqual({jsonrpc: '2.0', id: 3, result: {tools: [{name: 'add_object', description: 'Add', inputSchema: {type: 'object'}}]}});
 expect(await rpc({jsonrpc: '2.0', id: 4, method: 'tools/call', params: {name: 'add_object', arguments: {item: 'shape'}}})).toEqual({jsonrpc: '2.0', id: 4, result: {content: [{type: 'text', text: '{"ok":true}'}], isError: false}});
 expect(calls).toEqual(['add_object:{"item":"shape"}']);
});

it('reports tool failures as content the model can read, and protocol errors as JSON-RPC errors', async () => {
 expect(await rpc({jsonrpc: '2.0', id: 5, method: 'tools/call', params: {name: 'add_object', arguments: {fail: true}}})).toMatchObject({jsonrpc: '2.0', id: 5, result: {content: [{type: 'text', text: 'Object not found'}], isError: true}});
 expect(await rpc({jsonrpc: '2.0', id: 6, method: 'tools/call', params: {name: 'rm_rf'}})).toMatchObject({id: 6, error: {code: -32602}});
 expect(await rpc({jsonrpc: '2.0', id: 7, method: 'resources/list'})).toMatchObject({id: 7, error: {code: -32601}});
 expect(await handleBody('{nope', handlers, info)).toMatchObject({id: null, error: {code: -32700}});
 expect(await rpc([{jsonrpc: '2.0', id: 8, method: 'ping'}, {jsonrpc: '2.0', method: 'notifications/cancelled'}])).toEqual([{jsonrpc: '2.0', id: 8, result: {}}]);
 expect(await rpc({id: 9, method: 'ping'})).toMatchObject({id: 9, error: {code: -32600}});
});

it('accepts only loopback hosts on its port and loopback browser origins', () => {
 expect(allowedRequest({host: '127.0.0.1:47821'}, 47821)).toBe(true);
 expect(allowedRequest({host: 'localhost:47821', origin: 'http://localhost:6274'}, 47821)).toBe(true);
 expect(allowedRequest({host: '[::1]:47821'}, 47821)).toBe(true);
 expect(allowedRequest({host: 'evil.example:47821'}, 47821)).toBe(false);
 expect(allowedRequest({host: '127.0.0.1:9999'}, 47821)).toBe(false);
 expect(allowedRequest({host: '127.0.0.1:47821', origin: 'https://evil.example'}, 47821)).toBe(false);
});

it('runs a legacy message batch in order and rejects oversized batches without truncation',async()=>{
 let active=0,max=0,count=0;
 const serial:McpHandlers={tools:handlers.tools,call:async()=>{count++;max=Math.max(max,++active);await new Promise(resolve=>setTimeout(resolve,1));active--;return [{type:'text',text:'ok'}];}};
 const message=(id:number)=>({jsonrpc:'2.0',id,method:'tools/call',params:{name:'add_object'}});
 await handleBody(JSON.stringify([message(1),message(2)]),serial,info);expect(max).toBe(1);expect(count).toBe(2);
 expect(await handleBody(JSON.stringify(Array.from({length:51},(_,i)=>message(i))),serial,info)).toMatchObject({error:{code:-32600}});expect(count).toBe(2);
});
it('preserves structured tool outputs and annotations, and refuses non-object arguments',async()=>{
 const structured:McpHandlers={tools:async()=>[{name:'read',description:'Read',inputSchema:{type:'object'},annotations:{readOnlyHint:true}}],call:async()=>({content:[{type:'text',text:'{"value":1}'}],structuredContent:{value:1}})};
 expect(await handleBody(JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'read',arguments:[]}}),structured,info)).toMatchObject({error:{code:-32602}});
 expect(await handleBody(JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'read',arguments:{}}}),structured,info)).toMatchObject({result:{structuredContent:{value:1},isError:false}});
 expect(await handleBody(JSON.stringify({jsonrpc:'2.0',id:3,method:'tools/list'}),structured,info)).toMatchObject({result:{tools:[{annotations:{readOnlyHint:true}}]}});
});
