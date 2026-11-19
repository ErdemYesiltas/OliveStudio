import {assertLocal, ChatRequestSchema, type ChatRequest, type ChatResult, type LmModel, type LmStatus} from './contracts';
import {chatBody, chunkReader} from './stream';

/**
 * LM Studio client for the Electron main process (Node 22 fetch). Loopback only. Models come from LM Studio's REST API
 * (`/api/v0/models`: loaded state and `tool_use` capability) with the OpenAI `/v1/models` list as a fallback; chats
 * stream from `/v1/chat/completions` (SSE), merging tool-call fragments by index.
 */
export class LmClient {
 readonly base: URL;
 constructor(url: string) { this.base = assertLocal(url); }
 async status(): Promise<LmStatus> {
  try {
   const native = await fetch(new URL('/api/v0/models', this.base), {signal: AbortSignal.timeout(3000)});
   if (native.ok) {
    const body = await native.json() as {data?: {id: string; type?: string; state?: string; capabilities?: string[]; max_context_length?: number}[]};
    return {online: true, url: this.base.origin, models: (body.data ?? []).map((m): LmModel => ({id: m.id, type: m.type ?? 'llm', loaded: m.state === 'loaded', tools: (m.capabilities ?? []).includes('tool_use'), context: m.max_context_length}))};
   }
   const open = await fetch(new URL('/v1/models', this.base), {signal: AbortSignal.timeout(3000)});
   if (!open.ok) throw Error(`LM Studio ${open.status}`);
   const body = await open.json() as {data?: {id: string}[]};
   return {online: true, url: this.base.origin, models: (body.data ?? []).map(m => ({id: m.id, type: /embed/i.test(m.id) ? 'embeddings' : 'llm', loaded: true, tools: true}))};
  } catch (error) { return {online: false, url: this.base.origin, models: [], error: String(error instanceof Error ? error.message : error)}; }
 }
 async chat(input: ChatRequest, onDelta: (d: {content?: string; reasoning?: string; tool?: string}) => void, signal: AbortSignal): Promise<ChatResult> {
  const request = ChatRequestSchema.parse(input);
  const response = await fetch(new URL('/v1/chat/completions', this.base), {
   method: 'POST', headers: {'Content-Type': 'application/json'}, signal: AbortSignal.any([signal, AbortSignal.timeout(10 * 60 * 1000)]),
   body: JSON.stringify({...chatBody(request), stream: true}),
  });
  if (!response.ok || !response.body) { const text = await response.text().catch(() => ''); let message = text.slice(0, 400); try { message = JSON.parse(text).error?.message ?? JSON.parse(text).error ?? message; } catch { /* plain text */ } throw Error(`LM Studio ${response.status}: ${message}`); }
  let buffer = '';
  const reader = chunkReader(onDelta), decoder = new TextDecoder(), body = response.body.getReader();
  const handle = (line: string) => {
   if (!line.startsWith('data:')) return;
   const data = line.slice(5).trim();
   if (data && data !== '[DONE]') reader.push(JSON.parse(data));
  };
  for (;;) {
   const {value, done} = await body.read();
   if (done) break;
   buffer += decoder.decode(value, {stream: true});
   const lines = buffer.split(/\r?\n/); buffer = lines.pop() ?? '';
   for (const line of lines) handle(line);
  }
  if (buffer) handle(buffer);
  return reader.result();
 }
}
