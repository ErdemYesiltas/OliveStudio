import { ComfyClient } from '@rewrite/ai-comfy/client.node';
import { WorkflowSchema } from '@rewrite/ai-comfy/contracts';
import { LmClient } from '@rewrite/ai-lm/client.node';
import { ChatRequestSchema } from '@rewrite/ai-lm/contracts';

function endpoint(raw: unknown) {
  if (typeof raw !== 'string' || raw.length > 300) throw new Error('Invalid service URL');
  return raw;
}

export async function localModels(provider: 'lm' | 'comfy', url: unknown) {
  if (provider === 'lm') return new LmClient(endpoint(url)).status();
  const client = new ComfyClient(endpoint(url));
  const status = await client.status();
  return { ...status, checkpoints: status.online ? await client.checkpoints() : [] };
}

export async function localChat(url: unknown, request: unknown, signal: AbortSignal) {
  const chat = ChatRequestSchema.parse(request);
  return new LmClient(endpoint(url)).chat({ model: chat.model, messages: chat.messages, maxTokens: chat.maxTokens }, () => {}, signal);
}

export async function localGenerate(url: unknown, workflow: unknown, signal: AbortSignal) {
  const client = new ComfyClient(endpoint(url));
  const prompt = await client.queue(WorkflowSchema.parse(workflow));
  try {
    signal.throwIfAborted();
    const references = await client.wait(prompt, () => {}, signal);
    signal.throwIfAborted();
    const files = [];
    let total = 0;
    for (const output of references.slice(0, 24)) {
      signal.throwIfAborted();
      const extension = output.filename.toLowerCase().match(/\.(png|jpg|jpeg|webp|wav|mp3)$/)?.[0];
      if (!extension) continue;
      const bytes = await client.view(output);
      total += bytes.byteLength;
      if (total > 24 * 1024 * 1024 || bytes.byteLength > 12 * 1024 * 1024) throw new Error('Generated files exceed the import size limit');
      files.push({ name: `generated-${files.length + 1}${extension}`, data: Buffer.from(bytes).toString('base64') });
    }
    if (!files.length) throw new Error('ComfyUI returned no supported images or audio');
    return files;
  } finally {
    if (signal.aborted) await client.cancel(prompt).catch(() => {});
  }
}
