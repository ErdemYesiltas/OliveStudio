import {emptyReplyError, stripThinking, type ChatResult, type Message, type ToolSpec} from './contracts';

/** What one tool call did, for the chat log. */
export interface AgentStep {name: string; args: unknown; ok: boolean; result?: unknown; error?: string}
export interface AgentTools {specs: ToolSpec[]; execute(name: string, args: Record<string, unknown>): Promise<unknown> | unknown}

/** Editor assistant instructions. Kept short: small local models follow short, concrete rules best. */
export function systemPrompt(context: {stage: {width: number; height: number}; project: string; instructions?: readonly string[]; skills?: readonly {name: string; description: string}[]}) {
 const extra: string[] = [];
 if (context.instructions?.length) extra.push('', 'Instructions:', ...context.instructions);
 if (context.skills?.length) extra.push('', 'Skills (call use_skill with the name before work a skill covers, then follow it):', ...context.skills.map(k => `- ${k.name}: ${k.description}`));
 return [
  'You are the assistant inside OliveStudio, a 2D game editor (PixiJS). You change the open project only through the provided tools.',
  `Project: "${context.project}". Stage: ${context.stage.width}×${context.stage.height} px; x grows right, y grows down, (0,0) is the top-left corner, the centre is (${context.stage.width / 2}, ${context.stage.height / 2}). Object positions are their centres.`,
  'Rules:',
  '- Call get_editor_state first when you need IDs, names or what exists. Never invent IDs; use the ones tools return.',
  '- To add things use add_object with an item from get_editor_state.createItems (e.g. pixi.circle, pixi.rect, pixi.text, pixi.sprite, layout.row). Set colours, text and sizes with the fields argument or set_fields; call describe_component to learn a component’s fields.',
  '- Colours are #rrggbb. Sizes are pixels. Keep objects inside the stage unless asked otherwise.',
  '- Do the whole request, then reply with one or two short sentences in the user’s language saying what you did. Do not show tool syntax or JSON to the user.',
  '- If something is impossible or ambiguous, ask one short question instead of guessing destructive changes.',
  ...extra,
 ].join('\n');
}

/**
 * Runs one assistant turn: chat, execute tool calls, feed results back, until the model answers without tools or the
 * step limit is reached. Tool errors are returned to the model (so it can fix its call) and to the log.
 */
export async function runAgent(options: {
 chat(messages: Message[], tools: ToolSpec[]): Promise<ChatResult>; tools: AgentTools; messages: Message[];
 maxSteps?: number; onStep?(step: AgentStep): void; signal?: AbortSignal;
}): Promise<{messages: Message[]; reply: string; steps: AgentStep[]}> {
 const messages = [...options.messages], steps: AgentStep[] = [], max = options.maxSteps ?? 12;
 for (let round = 0; round < max; round++) {
  if (options.signal?.aborted) throw Error('Assistant cancelled');
  const result = await options.chat(messages, options.tools.specs);
  if (!result.toolCalls.length) {
   const reply = stripThinking(result.content).trim();
   if (!reply) throw emptyReplyError(result);
   messages.push({role: 'assistant', content: reply});
   return {messages, reply, steps};
  }
  messages.push({role: 'assistant', content: result.content ? stripThinking(result.content) : null, tool_calls: result.toolCalls});
  for (const call of result.toolCalls) {
   if (options.signal?.aborted) throw Error('Assistant cancelled');
   let args: Record<string, unknown> = {}, step: AgentStep;
   try {
    const parsed = JSON.parse(call.function.arguments || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Error('Arguments must be a JSON object');
    args = parsed as Record<string, unknown>;
    if (!options.tools.specs.some(s => s.function.name === call.function.name)) throw Error(`Unknown tool ${call.function.name}`);
    step = {name: call.function.name, args, ok: true, result: await options.tools.execute(call.function.name, args)};
   } catch (error) { step = {name: call.function.name, args, ok: false, error: error instanceof Error ? error.message : String(error)}; }
   steps.push(step); options.onStep?.(step);
   const content = JSON.stringify(step.ok ? {ok: true, result: step.result ?? null} : {ok: false, error: step.error});
   messages.push({role: 'tool', tool_call_id: call.id, content: content.length > 12000 ? content.slice(0, 12000) + '…(truncated)' : content});
  }
 }
 const reply = 'I stopped after too many steps. Tell me what is still missing.';
 messages.push({role: 'assistant', content: reply});
 return {messages, reply, steps};
}

/** Prompt writer for the Generate panel: turns a short idea into a model-ready prompt (no chatter). */
export function promptWriterMessages(idea: string, kind: 'image' | 'audio' | 'video', guidance = ''): Message[] {
 const brief = kind === 'audio'
  ? 'Rewrite the idea as one prompt for a text-to-audio model (Stable Audio): name the sound or music, instruments or sources, mood, tempo/BPM for music, recording character, and length feel. Comma-separated descriptive phrases. No lyrics.'
  : kind === 'video'
  ? 'Rewrite the idea as one prompt for a video model (Wan, LTX-Video) for a short 2D game animation: subject, the motion in a few words, static camera, plain background, style. Comma-separated descriptive phrases.'
  : 'Rewrite the idea as one prompt for a text-to-image model (Stable Diffusion/SDXL/Flux) for a 2D game asset: subject, style, palette, lighting, composition, background (plain or transparent-looking for sprites). Comma-separated descriptive phrases.';
 return [
  {role: 'system', content: `${brief} Write in English. Reply with the prompt only: no quotes, no preamble, under 80 words.${guidance.trim() ? `\n\nFollow these instructions (style, project, skill):\n${guidance.trim()}` : ''}`},
  {role: 'user', content: idea},
 ];
}
