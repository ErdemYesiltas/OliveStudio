/**
 * Model Context Protocol, the part this editor serves: JSON-RPC 2.0 with `initialize`, `ping`, `tools/list` and
 * `tools/call` (no resources, prompts or sampling). Transport-free so it can be tested without a socket.
 */
export const protocolVersions = ['2025-06-18', '2025-03-26', '2024-11-05'] as const;
export interface McpTool {name: string; description: string; inputSchema: Record<string, unknown>; outputSchema?:Record<string,unknown>; annotations?:{readOnlyHint?:boolean;destructiveHint?:boolean;openWorldHint?:boolean}}
export type McpContent = {type: 'text'; text: string} | {type: 'image'; data: string; mimeType: string};
export interface McpResult {content:McpContent[];structuredContent?:Record<string,unknown>;isError?:boolean}
export interface McpHandlers {
 tools(): Promise<McpTool[]>;
 /** The tool's result as MCP content; a thrown error becomes `isError: true` content (the model can recover). */
 call(name: string, args: Record<string, unknown>): Promise<McpContent[] | McpResult>;
}
export interface ServerInfo {name: string; version: string; instructions: string}
type Id = string | number;
type Response = {jsonrpc: '2.0'; id: Id | null; result?: unknown; error?: {code: number; message: string}};
const error = (id: Id | null, code: number, message: string): Response => ({jsonrpc: '2.0', id, error: {code, message}});

/** Handles one JSON-RPC message; notifications (no `id`) return undefined. */
export async function handleMessage(message: unknown, handlers: McpHandlers, info: ServerInfo): Promise<Response | undefined> {
 if (!message || typeof message !== 'object' || Array.isArray(message)) return error(null, -32600, 'Invalid request');
 const m = message as {jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown};
 const id = typeof m.id === 'string' || typeof m.id === 'number' ? m.id : undefined;
 if (m.jsonrpc !== '2.0' || typeof m.method !== 'string') return id === undefined ? undefined : error(id, -32600, 'Invalid request');
 if (id === undefined) return undefined;
 const params = m.params && typeof m.params === 'object' && !Array.isArray(m.params) ? m.params as Record<string, unknown> : {};
 try {
  switch (m.method) {
   case 'initialize': {
    const asked = typeof params.protocolVersion === 'string' ? params.protocolVersion : '';
    return {jsonrpc: '2.0', id, result: {protocolVersion: (protocolVersions as readonly string[]).includes(asked) ? asked : protocolVersions[0], capabilities: {tools: {listChanged: false}}, serverInfo: {name: info.name, version: info.version}, instructions: info.instructions}};
   }
   case 'ping': return {jsonrpc: '2.0', id, result: {}};
   case 'tools/list': return {jsonrpc: '2.0', id, result: {tools: await handlers.tools()}};
   case 'tools/call': {
    if (typeof params.name !== 'string') return error(id, -32602, 'tools/call needs a tool name');
    if(params.arguments!==undefined&&(!params.arguments||typeof params.arguments!=='object'||Array.isArray(params.arguments)))return error(id,-32602,'Tool arguments must be an object');
    const args = params.arguments && typeof params.arguments === 'object' && !Array.isArray(params.arguments) ? params.arguments as Record<string, unknown> : {};
    if (!(await handlers.tools()).some(t => t.name === params.name)) return error(id, -32602, `Unknown tool: ${params.name}`);
    try { const result=await handlers.call(params.name,args);return {jsonrpc:'2.0',id,result:Array.isArray(result)?{content:result,isError:false}:{...result,isError:result.isError??false}}; }
    catch (e) { return {jsonrpc: '2.0', id, result: {content: [{type: 'text', text: e instanceof Error ? e.message : String(e)}], structuredContent:{error:{code:e&&typeof e==='object'&&'code'in e?String(e.code):'TOOL_FAILED',message:e instanceof Error?e.message:String(e)}}, isError: true}}; }
   }
   default: return error(id, -32601, `Method not found: ${m.method}`);
  }
 } catch (e) { return error(id, -32603, e instanceof Error ? e.message : String(e)); }
}
/** A POST body: one message or a batch; the reply is one response, an array, or nothing (only notifications). */
export async function handleBody(text: string, handlers: McpHandlers, info: ServerInfo): Promise<Response | Response[] | undefined> {
 let body: unknown;
 try { body = JSON.parse(text); } catch { return error(null, -32700, 'Parse error'); }
 if (!Array.isArray(body)) return handleMessage(body, handlers, info);
 if (!body.length) return error(null, -32600, 'Empty batch');
 if(body.length>50)return error(null,-32600,'Batch exceeds 50 messages');
 const out:Response[]=[];for(const message of body){const reply=await handleMessage(message,handlers,info);if(reply)out.push(reply);}
 return out.length ? out : undefined;
}
/** Only this machine may connect: a loopback Host (DNS rebinding) and, from browsers, a loopback Origin. */
export function allowedRequest(headers: {host?: string; origin?: string}, port: number) {
 const loopback = (host: string) => ['127.0.0.1', 'localhost', '[::1]'].includes(host);
 const host = (headers.host ?? '').toLowerCase(), [name, hostPort] = host.startsWith('[') ? [host.slice(0, host.indexOf(']') + 1), host.slice(host.indexOf(']') + 2)] : host.split(':');
 if (!loopback(name) || (hostPort && Number(hostPort) !== port)) return false;
 if (!headers.origin) return true;
 try { return loopback(new URL(headers.origin).hostname.replace(/^\[|\]$/g, '') === '::1' ? '[::1]' : new URL(headers.origin).hostname); } catch { return false; }
}
