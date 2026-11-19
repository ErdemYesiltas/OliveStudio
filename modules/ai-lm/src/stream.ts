import type {ChatResult, ToolCall} from './contracts';

export type ChunkDelta = {content?: string; reasoning?: string; tool?: string};
interface Chunk {
 choices?: {delta?: {content?: string | null; reasoning_content?: string | null; reasoning?: string | null; tool_calls?: {index: number; id?: string; function?: {name?: string; arguments?: string}}[]}; finish_reason?: string | null}[];
 error?: {message?: string};
}

/**
 * Folds OpenAI `chat.completion.chunk` objects (LM Studio, LocalHub) into one result: answer text, thinking length,
 * tool calls merged from their fragments by index. `onDelta` sees each piece as it arrives.
 */
export function chunkReader(onDelta: (delta: ChunkDelta) => void, source = 'LM Studio') {
 let content = '', finish = 'stop', reasoningChars = 0;
 const calls: {id: string; name: string; args: string}[] = [];
 return {
  push(value: unknown) {
   const chunk = value as Chunk;
   if (chunk.error) throw Error(`${source}: ${chunk.error.message ?? 'error'}`);
   const choice = chunk.choices?.[0];
   if (!choice) return;
   if (choice.delta?.content) { content += choice.delta.content; onDelta({content: choice.delta.content}); }
   const thought = choice.delta?.reasoning_content ?? choice.delta?.reasoning;
   if (thought) { reasoningChars += thought.length; onDelta({reasoning: thought}); }
   for (const part of choice.delta?.tool_calls ?? []) {
    const call = calls[part.index] ??= {id: '', name: '', args: ''};
    if (part.id) call.id = part.id;
    if (part.function?.name) { call.name += part.function.name; onDelta({tool: call.name}); }
    if (part.function?.arguments) call.args += part.function.arguments;
   }
   if (choice.finish_reason) finish = choice.finish_reason;
  },
  result(): ChatResult {
   const toolCalls: ToolCall[] = calls.filter(c => c?.name).map((c, i) => ({id: c.id || `call_${i}_${Date.now()}`, type: 'function', function: {name: c.name, arguments: c.args || '{}'}}));
   return {content, toolCalls, finish: toolCalls.length ? 'tool_calls' : finish, reasoningChars};
  },
 };
}

/** The OpenAI body for a chat request (shared by LM Studio and LocalHub). */
export function chatBody(request: {model: string; messages: unknown[]; tools?: unknown[]; temperature?: number; maxTokens?: number; reasoning?: string}) {
 return {model: request.model, messages: request.messages, ...(request.tools?.length ? {tools: request.tools, tool_choice: 'auto'} : {}), temperature: request.temperature ?? 0.4, max_tokens: request.maxTokens ?? 8192, ...(request.reasoning ? {reasoning_effort: request.reasoning} : {})};
}
