import {z} from 'zod';

/**
 * LM Studio (OpenAI-compatible) integration, pure parts: loopback-only address, chat messages with tool calls, the
 * request crossing IPC and the preload bridge. No network or Electron here.
 */
export function assertLocal(url: string): URL {
 const u = new URL(url);
 if (!['http:', 'https:'].includes(u.protocol) || !['127.0.0.1', 'localhost', '[::1]', '::1'].includes(u.hostname)) throw Error('LM Studio must run on this computer (127.0.0.1 / localhost)');
 if (u.username || u.password) throw Error('LM Studio address must not contain credentials');
 return new URL(u.origin);
}
export const defaultLmUrl = 'http://127.0.0.1:1234';

export const ToolCallSchema = z.object({id: z.string().min(1).max(200), type: z.literal('function'), function: z.object({name: z.string().min(1).max(100), arguments: z.string().max(200000)})}).strict();
export type ToolCall = z.infer<typeof ToolCallSchema>;
export const MessageSchema = z.discriminatedUnion('role', [
 z.object({role: z.literal('system'), content: z.string().max(100000)}).strict(),
 z.object({role: z.literal('user'), content: z.string().max(100000)}).strict(),
 z.object({role: z.literal('assistant'), content: z.string().max(100000).nullable(), tool_calls: z.array(ToolCallSchema).max(32).optional()}).strict(),
 z.object({role: z.literal('tool'), tool_call_id: z.string().min(1).max(200), content: z.string().max(200000)}).strict(),
]);
export type Message = z.infer<typeof MessageSchema>;
/** OpenAI function tool: JSON Schema parameters. */
export interface ToolSpec {type: 'function'; function: {name: string; description: string; parameters: Record<string, unknown>}}
export const ChatRequestSchema = z.object({
 model: z.string().min(1).max(400), messages: z.array(MessageSchema).min(1).max(400),
 tools: z.array(z.object({type: z.literal('function'), function: z.object({name: z.string(), description: z.string(), parameters: z.record(z.string(), z.unknown())}).strict()}).strict()).max(64).optional(),
 temperature: z.number().min(0).max(2).optional(), maxTokens: z.number().int().min(1).max(32768).optional(),
 /** `none` skips the model's thinking (much faster for short tasks); omitted = the model's default. */
 reasoning: z.enum(['none', 'low', 'medium', 'high']).optional(),
}).strict();
export type ChatRequest = z.infer<typeof ChatRequestSchema>;
export interface LmModel {id: string; loaded: boolean; tools: boolean; type: string; context?: number}
export interface LmStatus {online: boolean; url: string; models: LmModel[]; error?: string}
/** Streamed to the renderer: answer text, thinking text (separate `reasoning_content`), tool names. */
export interface ChatDelta {jobId: string; content?: string; reasoning?: string; tool?: string; done?: boolean}
export interface ChatResult {content: string; toolCalls: ToolCall[]; finish: string; reasoningChars?: number}
/** Why a reply had no answer text, in words a user can act on. */
export function emptyReplyError(result: ChatResult): Error {
 return Error(result.finish === 'length'
  ? `The model used its whole token budget${result.reasoningChars ? ' thinking' : ''} and returned no answer. Try again, or pick a model that thinks less.`
  : 'The model returned an empty answer. Try again or pick another model.');
}
/** The preload bridge (`window.platform.lm`). */
export interface LmPort {
 status(url: string): Promise<LmStatus>;
 chat(url: string, jobId: string, request: ChatRequest): Promise<ChatResult>;
 cancel(jobId: string): Promise<void>;
 onDelta(callback: (delta: ChatDelta) => void): () => void;
}
/** Reasoning models (Qwen, Gemma…) may put their thinking in the content; users see only the answer. */
export const stripThinking = (text: string) => text.replace(/<think>[\s\S]*?(<\/think>|$)/g, '').replace(/^\s+/, '');
/** First loaded model that supports tools, else any loaded model, else any LLM (LM Studio loads it on demand). */
export function pickModel(models: readonly LmModel[], preferred = ''): string {
 const llms = models.filter(m => m.type !== 'embeddings');
 if (preferred && llms.some(m => m.id === preferred)) return preferred;
 return (llms.find(m => m.loaded && m.tools) ?? llms.find(m => m.loaded) ?? llms.find(m => m.tools) ?? llms[0])?.id ?? '';
}
