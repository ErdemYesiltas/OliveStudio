import {applyInputs, applyTemplate, nameFromPrompt, preferredModel, samplerDefaults, textToAudio, textToImage, type ComfyPort, type GeneratePreset, type Generation} from './contracts';

/**
 * One-call generation with the built-in templates (used by the assistant): picks the model, encoder and sampler
 * defaults like the Generate panel and returns the imported records plus the history entry to store.
 */
export async function quickGenerate(port: ComfyPort, url: string, request: {kind: 'image' | 'audio'; prompt: string; seconds?: number; width?: number; height?: number; preset?: GeneratePreset; skill?: string}) {
 const {status, checkpoints, encoders} = await port.status(url);
 if (!status.online) throw Error('ComfyUI is not running on this computer');
 const model = preferredModel(request.kind, checkpoints);
 if (!model) throw Error('ComfyUI has no checkpoint models');
 const encoder = encoders.find(e => /t5gemma|t5/i.test(e)) ?? encoders[0] ?? '';
 if (request.kind === 'audio' && !encoder) throw Error('ComfyUI has no text encoder for audio');
 const snap = (v: number | undefined, d: number) => Math.min(2048, Math.max(64, Math.round((v ?? d) / 8) * 8));
 const p = request.preset, seed = Math.floor(Math.random() * 2 ** 32), width = snap(request.width ?? p?.width, request.kind === 'image' && /xl/i.test(model) ? 1024 : 512), height = snap(request.height ?? p?.height, width);
 if (p?.kind && p.kind !== request.kind) throw Error(`The skill "${request.skill ?? 'chosen'}" makes ${p.kind === 'audio' ? 'sounds' : 'images'}, not ${request.kind === 'audio' ? 'sounds' : 'images'}`);
 const loras = request.kind === 'image' ? p?.loras ?? [] : [], prompt = applyTemplate(p?.prompt ?? '', request.prompt);
 const inputs = {prompt, negative: p?.negative ?? (request.kind === 'audio' ? '' : 'blurry, low quality, watermark, text'), seed, ...samplerDefaults(request.kind, model), ...(p?.steps ? {steps: p.steps} : {}), ...(p?.cfg !== undefined ? {cfg: p.cfg} : {}), width, height, batch: 1, denoise: 1, model, seconds: Math.min(60, Math.max(1, request.seconds ?? 5)), encoder, lyrics: '', loras};
 const workflow = applyInputs(request.kind === 'audio' ? textToAudio() : textToImage(), inputs);
 const result = await port.generate(url, crypto.randomUUID(), {workflow, name: nameFromPrompt(request.prompt, seed)});
 const info: Omit<Generation, 'assetId'> = {...(loras.length ? {loras} : {}), ...(request.skill ? {skill: request.skill} : {}), workflow: request.kind === 'audio' ? 'Text to audio (Stable Audio 3)' : 'Text to image', prompt, negative: inputs.negative, seed, steps: inputs.steps, cfg: inputs.cfg, width: request.kind === 'image' ? width : 0, height: request.kind === 'image' ? height : 0, model, createdAt: new Date().toISOString(), kind: request.kind, ...(request.kind === 'audio' ? {seconds: inputs.seconds} : {})};
 return {records: result.records, info};
}
