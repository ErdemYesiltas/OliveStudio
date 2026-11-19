import {z} from 'zod';

/**
 * ComfyUI integration, pure parts: loopback-only addresses, API-format workflows (analysis and input injection),
 * built-in templates, the request crossing IPC and the per-project generation history. No network or Electron here.
 */

/** Only this machine: ComfyUI and generated assets never leave it. */
export function assertLocal(url: string): URL {
 const u = new URL(url);
 if (!['http:', 'https:'].includes(u.protocol) || !['127.0.0.1', 'localhost', '[::1]', '::1'].includes(u.hostname)) throw Error('ComfyUI must run on this computer (127.0.0.1 / localhost)');
 if (u.username || u.password) throw Error('ComfyUI address must not contain credentials');
 return new URL(u.origin);
}
/** Comfy Desktop listens on 8000, the classic server and comfy-cli on 8188. */
export const defaultComfyUrls = ['http://127.0.0.1:8000', 'http://127.0.0.1:8188'] as const;

/** API-format workflow: node id → {class_type, inputs}; links are `[nodeId, outputIndex]`. */
const Link = z.tuple([z.string(), z.number().int().min(0)]);
export const WorkflowNodeSchema = z.object({class_type: z.string().min(1), inputs: z.record(z.string(), z.unknown()), _meta: z.object({title: z.string().optional()}).loose().optional()}).loose();
export const WorkflowSchema = z.record(z.string(), WorkflowNodeSchema).refine(w => Object.keys(w).length > 0 && Object.keys(w).length <= 500, 'A workflow has 1–500 nodes');
export type Workflow = z.infer<typeof WorkflowSchema>;
const isLink = (v: unknown): v is [string, number] => Link.safeParse(v).success;

/** A literal input the editor can write: on the node itself or on the Primitive node feeding it. */
export interface Target {id: string; key: string}
/** Where a workflow takes the editor's inputs (node ids / input targets), found by node types and wiring. */
/** `kind` is what the workflow saves: images, audio (any audio saver) or video (frames for animations). */
export interface WorkflowSlots {
 positive?: string; negative?: string; sampler?: string; latent?: string; checkpoint?: string; encoder?: string; image?: string; outputs: string[];
 /** Diffusion model loader (Flux, Wan…): its `unet_name` can be switched like a checkpoint. */
 unet?: string; kind: 'image' | 'audio' | 'video';
 /** Video workflows: frame count (latent length) and playback rate. */
 length?: Target; fps?: Target;
 /** Writable literals (followed through Primitive nodes and subgraph wiring). */
 prompt?: Target; negativePrompt?: Target; steps?: Target; cfg?: Target; width?: Target; height?: Target; batch?: Target; seconds?: Target; lyrics?: Target;
}
export const audioSavers = new Set(['SaveAudio', 'SaveAudioMP3', 'SaveAudioOpus', 'SaveAudioAdvanced', 'PreviewAudio']);
/** Video and animated outputs: the editor takes their frames (they are rewritten to SaveImage). */
export const videoSavers = new Set(['SaveVideo', 'SaveWEBM', 'SaveAnimatedWEBP', 'SaveAnimatedPNG']);
const samplers = new Set(['KSampler', 'KSamplerAdvanced', 'SamplerCustom', 'SamplerCustomAdvanced']);
const isTextEncoder = (type: string) => /TextEncode/.test(type);
const textKeys = ['text', 'prompt', 'tags', 'text_g', 'text_l', 'clip_l', 't5xxl'];
const textPrimitives = new Set(['PrimitiveString', 'PrimitiveStringMultiline']), numberPrimitives = new Set(['PrimitiveInt', 'PrimitiveFloat']);
const latentType = /^Empty.*Latent/;
/** Follows a link back through pass-through nodes (guiders, conditioning combiners) to a text encoder. */
function encoderFor(workflow: Workflow, link: unknown, key: 'positive' | 'negative', depth = 0): string | undefined {
 if (!isLink(link) || depth > 8) return undefined;
 const node = workflow[link[0]];
 if (!node) return undefined;
 if (isTextEncoder(node.class_type)) return link[0];
 for (const k of [key, 'conditioning', 'conditioning_1', 'conditioning_to', 'guider']) if (k in node.inputs) { const found = encoderFor(workflow, node.inputs[k], key, depth + 1); if (found) return found; }
 return undefined;
}
/**
 * The literal behind an input: the input itself, or the value of a Primitive node it is wired to (templates promote
 * sizes and prompts that way). For text, string-processing nodes in between (switches, replacements) are searched
 * breadth-first for the user's Primitive text.
 */
function literal(workflow: Workflow, id: string | undefined, key: string, text = false): Target | undefined {
 if (!id || !workflow[id] || !(key in workflow[id].inputs)) return undefined;
 const value = workflow[id].inputs[key];
 if (!isLink(value)) return {id, key};
 const queue = [value[0]], seen = new Set<string>();
 while (queue.length && seen.size < 40) {
  const next = queue.shift()!;
  if (seen.has(next) || !workflow[next]) continue;
  seen.add(next);
  const node = workflow[next];
  if ((text ? textPrimitives : numberPrimitives).has(node.class_type) && 'value' in node.inputs) {
   const inner = node.inputs.value;
   if (!isLink(inner)) return {id: next, key: 'value'};
   queue.push(inner[0]); continue;
  }
  if (!text) return undefined;
  for (const input of Object.values(node.inputs)) if (isLink(input)) queue.push(input[0]);
 }
 return undefined;
}
function sourceNode(workflow: Workflow, link: unknown) { return isLink(link) ? workflow[link[0]] && link[0] : undefined; }

export function analyzeWorkflow(input: unknown): WorkflowSlots {
 const workflow = WorkflowSchema.parse(input), ids = Object.keys(workflow), slots: WorkflowSlots = {outputs: [], kind: 'image'};
 slots.sampler = ids.find(id => samplers.has(workflow[id].class_type));
 const sampler = slots.sampler ? workflow[slots.sampler] : undefined;
 const guider = sampler ? sourceNode(workflow, sampler.inputs.guider) : undefined;
 const conditioning = guider ? workflow[guider].inputs : sampler?.inputs;
 if (conditioning) {
  slots.positive = encoderFor(workflow, conditioning.positive ?? conditioning.conditioning, 'positive');
  slots.negative = encoderFor(workflow, conditioning.negative, 'negative');
 }
 if (sampler) { const latent = sourceNode(workflow, sampler.inputs.latent_image); if (latent && latentType.test(workflow[latent].class_type)) slots.latent = latent; }
 // One encoder wired to both (ACE-Step): it is the prompt, never the negative.
 if (slots.negative && slots.negative === slots.positive) slots.negative = undefined;
 slots.positive ??= ids.find(id => isTextEncoder(workflow[id].class_type) && id !== slots.negative);
 slots.latent ??= ids.find(id => latentType.test(workflow[id].class_type));
 slots.checkpoint = ids.find(id => workflow[id].class_type === 'CheckpointLoaderSimple');
 slots.unet = ids.find(id => workflow[id].class_type === 'UNETLoader' && typeof workflow[id].inputs.unet_name === 'string');
 slots.image = ids.find(id => workflow[id].class_type === 'LoadImage');
 slots.encoder = ids.find(id => workflow[id].class_type === 'CLIPLoader' && workflow[id].inputs.type === 'stable_audio');
 slots.outputs = ids.filter(id => ['SaveImage', 'PreviewImage'].includes(workflow[id].class_type) || audioSavers.has(workflow[id].class_type) || videoSavers.has(workflow[id].class_type));
 if (slots.outputs.some(id => audioSavers.has(workflow[id].class_type))) slots.kind = 'audio';
 else if (slots.outputs.some(id => videoSavers.has(workflow[id].class_type))) slots.kind = 'video';
 const textKey = (id: string | undefined) => id ? textKeys.find(k => k in workflow[id].inputs) : undefined;
 slots.prompt = literal(workflow, slots.positive, textKey(slots.positive) ?? 'text', true);
 slots.negativePrompt = literal(workflow, slots.negative, textKey(slots.negative) ?? 'text', true);
 slots.lyrics = literal(workflow, slots.positive, 'lyrics', true);
 const scheduler = sampler ? sourceNode(workflow, sampler.inputs.sigmas) : undefined;
 slots.steps = literal(workflow, slots.sampler, 'steps') ?? literal(workflow, scheduler, 'steps');
 slots.cfg = literal(workflow, slots.sampler, 'cfg') ?? literal(workflow, guider, 'cfg');
 slots.width = literal(workflow, slots.latent, 'width'); slots.height = literal(workflow, slots.latent, 'height');
 slots.batch = literal(workflow, slots.latent, 'batch_size'); slots.seconds = literal(workflow, slots.latent, 'seconds');
 if (slots.kind === 'video') {
  const lengthNode = ids.find(id => 'length' in workflow[id].inputs && /Video|LTXV|Wan|Latent/.test(workflow[id].class_type));
  slots.length = literal(workflow, lengthNode, 'length');
  const fpsNode = ids.find(id => 'fps' in workflow[id].inputs && /CreateVideo|SaveAnimated|SaveWEBM/.test(workflow[id].class_type));
  slots.fps = literal(workflow, fpsNode, 'fps');
 }
 return slots;
}
/** A LoRA file and how strongly it changes the model (and its text encoder when the workflow has one). */
export const LoraSchema = z.object({name: z.string().min(1).max(400), strength: z.number().min(-4).max(4)}).strict();
export type Lora = z.infer<typeof LoraSchema>;
export const GenerateInputsSchema = z.object({
 prompt: z.string().trim().min(1).max(4000), negative: z.string().max(4000), seed: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
 steps: z.number().int().min(1).max(150), cfg: z.number().min(0).max(30), width: z.number().int().min(64).max(4096).multipleOf(8), height: z.number().int().min(64).max(4096).multipleOf(8),
 batch: z.number().int().min(1).max(4), denoise: z.number().min(0).max(1), model: z.string().max(400), image: z.string().max(400).optional(),
 /** Audio: clip length in seconds, text encoder file, ACE-Step lyrics. */
 seconds: z.number().min(1).max(300).default(10), encoder: z.string().max(400).default(''), lyrics: z.string().max(10000).default(''),
 /** Video workflows: frames to generate (written to the latent's length). */
 length: z.number().int().min(1).max(256).optional(),
 /** Diffusion model file for UNETLoader workflows (empty: as authored). */
 unet: z.string().max(400).default(''),
 /** LoRAs chained after the model loader, in order (image and video workflows). */
 loras: z.array(LoraSchema).max(8).default([]),
}).strict();
export type GenerateInputs = z.input<typeof GenerateInputsSchema>;
/**
 * Inserts LoRA loaders after the model loader: every consumer of the loader's MODEL (and CLIP, for a checkpoint)
 * output reads the end of the chain instead. A checkpoint gets `LoraLoader` (model + text encoder), a diffusion model
 * loader `LoraLoaderModelOnly`. Workflows without a model loader are returned unchanged.
 */
export function applyLoras(input: Workflow, loras: readonly Lora[]): Workflow {
 const workflow = structuredClone(input);
 if (!loras.length) return workflow;
 const ids = Object.keys(workflow), checkpoint = ids.find(id => workflow[id].class_type === 'CheckpointLoaderSimple'), unet = ids.find(id => workflow[id].class_type === 'UNETLoader');
 const loader = checkpoint ?? unet;
 if (!loader) return workflow;
 let model: [string, number] = [loader, 0], clip: [string, number] | undefined = checkpoint ? [checkpoint, 1] : undefined;
 const added = new Set<string>();
 loras.forEach((lora, i) => {
  const id = `lora:${i}`;
  workflow[id] = clip
   ? {class_type: 'LoraLoader', inputs: {model, clip, lora_name: lora.name, strength_model: lora.strength, strength_clip: lora.strength}}
   : {class_type: 'LoraLoaderModelOnly', inputs: {model, lora_name: lora.name, strength_model: lora.strength}};
  added.add(id); model = [id, 0]; if (clip) clip = [id, 1];
 });
 for (const [id, node] of Object.entries(workflow)) {
  if (added.has(id)) continue;
  for (const [key, value] of Object.entries(node.inputs)) {
   if (!isLink(value) || value[0] !== loader) continue;
   if (value[1] === 0) node.inputs[key] = [...model];
   else if (checkpoint && value[1] === 1 && clip) node.inputs[key] = [...clip];
  }
 }
 return workflow;
}
/**
 * A skill's generation preset: a prompt template (`{prompt}` is what you typed; without it the template is appended),
 * negative prompt, LoRAs, size and sampler values, optionally a workflow by name. Unset values keep the panel's.
 */
export const GeneratePresetSchema = z.object({
 kind: z.enum(['image', 'audio']).optional(), prompt: z.string().max(2000).default(''), negative: z.string().max(4000).optional(),
 loras: z.array(LoraSchema).max(8).default([]), workflow: z.string().max(120).optional(),
 width: z.number().int().min(64).max(4096).multipleOf(8).optional(), height: z.number().int().min(64).max(4096).multipleOf(8).optional(),
 steps: z.number().int().min(1).max(150).optional(), cfg: z.number().min(0).max(30).optional(),
}).strict();
export type GeneratePreset = z.infer<typeof GeneratePresetSchema>;
/** The prompt sent to ComfyUI for a template: `{prompt}` replaced, or the template appended after the prompt. */
export function applyTemplate(template: string, prompt: string) {
 const t = template.trim(), p = prompt.trim();
 if (!t) return p;
 if (t.includes('{prompt}')) return t.split('{prompt}').join(p).replace(/^[\s,]+|[\s,]+$/g, '');
 return p ? `${p}, ${t}` : t;
}
/** A skill as the Generate panel sees it: guidance for the prompt writer and an optional preset. */
export interface SkillChoice {id: string; name: string; instructions: string; preset?: GeneratePreset}
/** Copy of the workflow with the inputs written into the detected slots (unknown slots are left as authored). */
export function applyInputs(input: unknown, values: GenerateInputs): Workflow {
 const workflow = structuredClone(WorkflowSchema.parse(input)), slots = analyzeWorkflow(workflow);
 const write = (target: Target | undefined, value: unknown) => { if (target) workflow[target.id].inputs[target.key] = value; };
 const set = (id: string | undefined, key: string, value: unknown) => { if (id && workflow[id] && key in workflow[id].inputs && !isLink(workflow[id].inputs[key])) workflow[id].inputs[key] = value; };
 write(slots.prompt, values.prompt); write(slots.negativePrompt, values.negative);
 // SDXL encoders carry the prompt twice (text_g / text_l).
 if (slots.positive && slots.prompt?.id === slots.positive) for (const key of textKeys) set(slots.positive, key, values.prompt);
 if (slots.negative && slots.negativePrompt?.id === slots.negative) for (const key of textKeys) set(slots.negative, key, values.negative);
 write(slots.steps, values.steps); write(slots.cfg, values.cfg);
 if (slots.sampler) { set(slots.sampler, 'seed', values.seed); set(slots.sampler, 'noise_seed', values.seed); set(slots.sampler, 'denoise', values.denoise); }
 for (const id of Object.keys(workflow)) if (workflow[id].class_type === 'RandomNoise') set(id, 'noise_seed', values.seed);
 write(slots.width, values.width); write(slots.height, values.height); write(slots.batch, values.batch); write(slots.seconds, values.seconds ?? 10);
 if (slots.encoder && values.encoder) set(slots.encoder, 'clip_name', values.encoder);
 if (values.lyrics) write(slots.lyrics, values.lyrics);
 // The editor imports mp3/wav: every audio saver becomes SaveAudioMP3 (V0), keeping its audio input.
 // Video and animated savers become SaveImage: the editor takes every frame as a PNG (CreateVideo's images, or the
 // video's frames through GetVideoComponents).
 for (const id of slots.outputs) {
  const node = workflow[id];
  if (!videoSavers.has(node.class_type)) continue;
  let images = node.inputs.images;
  if (node.class_type === 'SaveVideo') {
   const video = node.inputs.video, source = isLink(video) ? workflow[video[0]] : undefined;
   if (source?.class_type === 'CreateVideo') images = source.inputs.images;
   else { workflow[`${id}:frames`] = {class_type: 'GetVideoComponents', inputs: {video}}; images = [`${id}:frames`, 0]; }
  }
  workflow[id] = {class_type: 'SaveImage', inputs: {images, filename_prefix: 'OliveStudio'}};
 }
 if (values.length !== undefined) write(slots.length, values.length);
 for (const id of slots.outputs) { const node = workflow[id]; if (audioSavers.has(node.class_type)) workflow[id] = {class_type: 'SaveAudioMP3', inputs: {audio: node.inputs.audio, filename_prefix: 'OliveStudio', quality: 'V0'}}; }
 if (slots.checkpoint && values.model) set(slots.checkpoint, 'ckpt_name', values.model);
 if (slots.unet && values.unet) set(slots.unet, 'unet_name', values.unet);
 if (slots.image && values.image) set(slots.image, 'image', values.image);
 for (const id of slots.outputs) if (workflow[id].class_type === 'SaveImage') workflow[id].inputs.filename_prefix = 'OliveStudio';
 return slots.kind !== 'audio' && values.loras?.length ? applyLoras(workflow, values.loras) : workflow;
}

/** Built-in checkpoint workflows (SD 1.x/2.x/SDXL checkpoints); imported workflows cover everything else. */
export function textToImage(): Workflow {
 return {
  '1': {class_type: 'CheckpointLoaderSimple', inputs: {ckpt_name: ''}},
  '2': {class_type: 'CLIPTextEncode', inputs: {text: '', clip: ['1', 1]}},
  '3': {class_type: 'CLIPTextEncode', inputs: {text: '', clip: ['1', 1]}},
  '4': {class_type: 'EmptyLatentImage', inputs: {width: 512, height: 512, batch_size: 1}},
  '5': {class_type: 'KSampler', inputs: {model: ['1', 0], positive: ['2', 0], negative: ['3', 0], latent_image: ['4', 0], seed: 0, steps: 20, cfg: 7, sampler_name: 'euler', scheduler: 'normal', denoise: 1}},
  '6': {class_type: 'VAEDecode', inputs: {samples: ['5', 0], vae: ['1', 2]}},
  '7': {class_type: 'SaveImage', inputs: {images: ['6', 0], filename_prefix: 'OliveStudio'}},
 };
}
export function imageToImage(): Workflow {
 const w = textToImage();
 delete w['4'];
 w['8'] = {class_type: 'LoadImage', inputs: {image: ''}};
 w['9'] = {class_type: 'VAEEncode', inputs: {pixels: ['8', 0], vae: ['1', 2]}};
 w['5'].inputs.latent_image = ['9', 0]; w['5'].inputs.denoise = 0.6;
 return w;
}
/** Stable Audio 3 (medium: 8 steps, CFG 1, lcm; the base model wants ~50 steps, CFG 7) → MP3. */
export function textToAudio(): Workflow {
 return {
  '1': {class_type: 'CheckpointLoaderSimple', inputs: {ckpt_name: ''}},
  '2': {class_type: 'CLIPLoader', inputs: {clip_name: '', type: 'stable_audio', device: 'default'}},
  '3': {class_type: 'CLIPTextEncode', inputs: {text: '', clip: ['2', 0]}},
  '4': {class_type: 'CLIPTextEncode', inputs: {text: '', clip: ['2', 0]}},
  '5': {class_type: 'EmptyLatentAudio', inputs: {seconds: 10, batch_size: 1}},
  '6': {class_type: 'KSampler', inputs: {model: ['1', 0], positive: ['3', 0], negative: ['4', 0], latent_image: ['5', 0], seed: 0, steps: 8, cfg: 1, sampler_name: 'lcm', scheduler: 'simple', denoise: 1}},
  '7': {class_type: 'VAEDecodeAudio', inputs: {samples: ['6', 0], vae: ['1', 2]}},
  '8': {class_type: 'SaveAudioMP3', inputs: {audio: ['7', 0], filename_prefix: 'OliveStudio', quality: 'V0'}},
 };
}
/** Sampler defaults for a model file: distilled audio models are fast, base models need more steps. */
export function samplerDefaults(kind: 'image' | 'audio', model: string) { return kind === 'image' ? {steps: 20, cfg: 7} : /base/i.test(model) ? {steps: 50, cfg: 7} : {steps: 8, cfg: 1}; }
/** Best default model for a kind from the checkpoint list (audio models usually say so in the file name). */
export function preferredModel(kind: 'image' | 'audio', checkpoints: readonly string[]) { const audio = (m: string) => /audio|ace_?step|music/i.test(m), other = (m: string) => /3d|hunyuan_3d|trellis|refiner/i.test(m); return (kind === 'audio' ? checkpoints.find(audio) : checkpoints.find(m => !audio(m) && !other(m))) ?? checkpoints[0] ?? ''; }
export interface WorkflowChoice {id: string; name: string; workflow: Workflow; builtIn?: boolean}
export const builtInWorkflows = (): WorkflowChoice[] => [{id: 'builtin.txt2img', name: 'Text to image', workflow: textToImage(), builtIn: true}, {id: 'builtin.img2img', name: 'Image to image (selected sprite)', workflow: imageToImage(), builtIn: true}, {id: 'builtin.txt2audio', name: 'Text to audio (Stable Audio 3)', workflow: textToAudio(), builtIn: true}];
/** What the panel needs to show for a workflow. */
export function workflowNeeds(workflow: Workflow) { const s = analyzeWorkflow(workflow); return {kind: s.kind, prompt: Boolean(s.prompt), negative: Boolean(s.negativePrompt), size: Boolean(s.width && s.height), seconds: Boolean(s.seconds), batch: Boolean(s.batch), model: Boolean(s.checkpoint), unet: Boolean(s.unet), loras: s.kind !== 'audio' && Boolean(s.checkpoint || s.unet), encoder: Boolean(s.encoder), lyrics: Boolean(s.lyrics), image: Boolean(s.image), steps: Boolean(s.steps), cfg: Boolean(s.cfg), length: Boolean(s.length), output: s.outputs.length > 0}; }
/** The values a workflow was authored with, so an imported template starts as its author tuned it. */
export function workflowDefaults(workflow: Workflow): Partial<GenerateInputs> {
 const s = analyzeWorkflow(workflow), read = (t: Target | undefined) => t ? workflow[t.id].inputs[t.key] : undefined, out: Record<string, unknown> = {};
 const num = (key: string, t: Target | undefined) => { const v = read(t); if (typeof v === 'number' && Number.isFinite(v)) out[key] = v; };
 const str = (key: string, t: Target | undefined) => { const v = read(t); if (typeof v === 'string') out[key] = v; };
 num('steps', s.steps); num('cfg', s.cfg); num('width', s.width); num('height', s.height); num('batch', s.batch); num('seconds', s.seconds);
 str('prompt', s.prompt); str('negative', s.negativePrompt); str('lyrics', s.lyrics);
 if (s.checkpoint) str('model', {id: s.checkpoint, key: 'ckpt_name'});
 if (s.unet) str('unet', {id: s.unet, key: 'unet_name'});
 if (s.encoder) str('encoder', {id: s.encoder, key: 'clip_name'});
 return out as Partial<GenerateInputs>;
}

/** Crosses IPC: a fully resolved workflow plus what to name and remember. */
export const GenerateRequestSchema = z.object({
 workflow: WorkflowSchema, name: z.string().trim().min(1).max(60),
 /** PNG bytes uploaded as the LoadImage input (img2img). */
 image: z.instanceof(Uint8Array).refine(b => b.byteLength <= 32 * 1024 * 1024, 'Input image too large').optional(),
 /** Return the saved images as PNG bytes (animation frames) instead of importing them. */
 frames: z.boolean().optional(),
}).strict();
export type GenerateRequest = z.infer<typeof GenerateRequestSchema>;
export interface ComfyStatus {online: boolean; url: string; version?: string; device?: string; vramFreeMB?: number; error?: string}
/** What the server offers: checkpoints and text encoders (CLIPLoader). */
export interface ComfyModels {checkpoints: string[]; encoders: string[];
 /** Diffusion models known to UNETLoader. */
 unets?: string[];
 /** LoRA files known to `LoraLoader`. */
 loras?: string[];
 /** Background removal models (BiRefNet…) for transparent animation frames. */
 removers?: string[]}
export interface ComfyProgress {jobId: string; phase: 'queued' | 'running' | 'saving' | 'done' | 'failed' | 'cancelled'; value: number; max: number; node?: string; message?: string}

/** Project history: how each generated asset was made (reproducible with the same model and seed). */
export const generationsSection = 'ai-comfy.generations';
export const GenerationSchema = z.object({assetId: z.string().min(1), workflow: z.string().max(200), prompt: z.string().max(4000), negative: z.string().max(4000), seed: z.number().int().min(0), steps: z.number().int(), cfg: z.number(), width: z.number().int(), height: z.number().int(), model: z.string().max(400), createdAt: z.string(), kind: z.enum(['image', 'audio', 'animation']).default('image'), seconds: z.number().optional(), lyrics: z.string().max(10000).optional(),
 /** Animations: frame count, playback rate and how they were made. */
 frames: z.number().int().optional(), fps: z.number().optional(), method: z.enum(['sheet', 'edit', 'video']).optional(),
 /** LoRAs and the skill (prompt template, presets) used. */
 loras: z.array(LoraSchema).max(8).optional(), skill: z.string().max(80).optional(),
 /** What it was made as in the Generate panel (sprite, background, sfx…). */
 purpose: z.string().max(40).optional()}).strict();
export const GenerationsSchema = z.object({version: z.literal(1), items: z.array(GenerationSchema).max(10000)}).strict();
export type Generation = z.infer<typeof GenerationSchema>;
/** Short file-safe asset name from a prompt. */
export const nameFromPrompt = (prompt: string, seed: number) => `${prompt.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'generated'}-${seed}`;
/** An entry of the "From ComfyUI" list (see `LibraryItem` in convert.ts). */
export interface LibraryEntry {source: 'user' | 'template'; ref: string; title: string; group: string; description?: string}
/** The preload bridge (`window.platform.comfy`). */
export interface ComfyPort {
 status(url: string): Promise<{status: ComfyStatus} & ComfyModels>;
 generate(url: string, jobId: string, request: GenerateRequest): Promise<{records: unknown[]; kind?: 'image' | 'audio' | 'video'; cancelled?: boolean; frames?: Uint8Array[]}>;
 /** Background jobs: queue a workflow and return its prompt ID (an empty LoadImage takes the uploaded image). */
 submit(url: string, request: GenerateRequest): Promise<{promptId: string}>;
 jobs(url: string, promptIds: string[]): Promise<Record<string, JobStatus>>;
 /** A finished job's outputs: imported into the Library, or animation frames as PNG bytes. */
 jobResult(url: string, request: {promptId: string; name: string; kind: 'image' | 'audio' | 'animation'; frames?: boolean}): Promise<{records?: unknown[]; frames?: Uint8Array[]}>;
 jobCancel(url: string, promptId: string): Promise<void>;
 /** Transparent PNGs of the frames (background removal model on the server). */
 removeBackground(url: string, jobId: string, frames: Uint8Array[]): Promise<{frames: Uint8Array[]; cancelled?: boolean}>;
 /** Imports a packed sprite sheet (PNG bytes) into the Library; returns the asset records. */
 importSheet(bytes: Uint8Array, name: string): Promise<unknown[]>;
 cancel(jobId: string): Promise<void>;
 /** Opens an API-format file, or a ComfyUI app save converted through the running server. */
 openWorkflow(url: string): Promise<{name: string; workflow: Workflow} | null>;
 /** Saved workflows and installed templates on the server; `libraryCheck` maps `source:ref` to why each cannot run (empty: ready). */
 library(url: string): Promise<LibraryEntry[]>;
 libraryCheck(url: string, items: Pick<LibraryEntry, 'source' | 'ref'>[]): Promise<Record<string, string[]>>;
 libraryGet(url: string, item: Pick<LibraryEntry, 'source' | 'ref'>): Promise<{workflow: Workflow}>;
 onProgress(callback: (progress: ComfyProgress) => void): () => void;
}

/** Animation mode: how frames are made. */
export type AnimationMethod = 'sheet' | 'edit' | 'video';
/** Grid for `frames` cells (columns default to a near-square layout). */
export function gridFor(frames: number, columns?: number) {
 const n = Math.max(1, Math.round(frames)), c = Math.max(1, Math.min(n, Math.round(columns ?? Math.ceil(Math.sqrt(n)))));
 return {columns: c, rows: Math.ceil(n / c)};
}
/** Cell rectangles of a sheet image (left to right, top to bottom), first `frames` cells. */
export function sliceGrid(width: number, height: number, columns: number, rows: number, frames: number) {
 const w = Math.floor(width / columns), h = Math.floor(height / rows);
 return Array.from({length: Math.min(frames, columns * rows)}, (_, i) => ({x: (i % columns) * w, y: Math.floor(i / columns) * h, width: w, height: h}));
}
/** One image with every frame: the model is asked for an evenly spaced grid. */
export function sheetPrompt(prompt: string, motion: string, frames: number, columns: number, rows: number) {
 return `${prompt.trim()}, sprite sheet of ${frames} animation frames${motion.trim() ? ` of a ${motion.trim()}` : ''}, arranged in a ${columns}x${rows} grid of equal cells, the same character in every cell, same size and position in each cell, evenly spaced, consistent style, plain flat background, no text, no borders`;
}
/** Frame-by-frame editing: each frame is the previous one changed a little. */
export function editPrompt(prompt: string, motion: string, frame: number, frames: number) {
 return `Keep the same character, style, colours, size and position. Show the next pose of ${motion.trim() || 'the animation'}: frame ${frame + 1} of ${frames}, a small change from the current image. ${prompt.trim()}`.trim();
}
/** Transparent frames: background removal model → mask → inverted alpha, one chain per uploaded image. */
export function backgroundRemovalWorkflow(model: string, images: readonly string[]): Workflow {
 const w: Workflow = {model: {class_type: 'LoadBackgroundRemovalModel', inputs: {bg_removal_name: model}}};
 images.forEach((image, i) => {
  const n = String(i).padStart(3, '0');
  w[`load${n}`] = {class_type: 'LoadImage', inputs: {image}};
  w[`mask${n}`] = {class_type: 'RemoveBackground', inputs: {image: [`load${n}`, 0], bg_removal_model: ['model', 0]}};
  w[`alpha${n}`] = {class_type: 'InvertMask', inputs: {mask: [`mask${n}`, 0]}};
  w[`join${n}`] = {class_type: 'JoinImageWithAlpha', inputs: {image: [`load${n}`, 0], alpha: [`alpha${n}`, 0]}};
  w[`save${n}`] = {class_type: 'SaveImage', inputs: {images: [`join${n}`, 0], filename_prefix: 'OliveStudio-cutout'}};
 });
 return w;
}

/** fp8 weights (Float8_e4m3fn) do not run on Apple Silicon GPUs (MPS) in PyTorch. */
export const isFp8 = (file: string) => /fp8|float8|e4m3|e5m2/i.test(file);
/** Turns known ComfyUI failures into what to do about them. */
export function explainFailure(message: string) {
 if (/Float8_e4m3fn|Float8_e5m2/i.test(message) && /MPS/i.test(message)) return `${message} — fp8 model files do not run on Apple Silicon GPUs: choose a bf16/fp16 model (Diffusion model) instead.`;
 return message;
}

/** Background jobs ------------------------------------------------------------------------------------------------ */
const isLinkValue = (v: unknown): v is [string, number] => Array.isArray(v) && v.length === 2 && typeof v[0] === 'string' && typeof v[1] === 'number';
/** A copy of a workflow with every node ID (and every link to it) prefixed, so several can live in one graph. */
export function prefixWorkflow(input: Workflow, prefix: string): Workflow {
 const out: Workflow = {};
 for (const [id, node] of Object.entries(input)) out[prefix + id] = {...structuredClone(node), inputs: Object.fromEntries(Object.entries(node.inputs).map(([k, v]) => [k, isLinkValue(v) ? [prefix + v[0], v[1]] : structuredClone(v)]))};
 return out;
}
const savers = (w: Workflow) => Object.keys(w).filter(id => w[id].class_type === 'SaveImage').sort((a, b) => a.localeCompare(b, 'en', {numeric: true}));
/**
 * Frame-by-frame editing as one graph (so it finishes without the editor): frame 0 is the start (a text-to-image
 * workflow, or an uploaded image: a LoadImage with an empty name the main process fills), and each edit workflow's
 * image input is wired to the previous frame. One SaveImage per frame, ordered by its `fNNN:` prefix.
 */
export function chainEdits(start: Workflow | 'upload', edits: readonly Workflow[]): Workflow {
 const graph: Workflow = {};
 let previous: [string, number];
 if (start === 'upload') {
  graph['f000:load'] = {class_type: 'LoadImage', inputs: {image: ''}};
  graph['f000:save'] = {class_type: 'SaveImage', inputs: {images: ['f000:load', 0], filename_prefix: 'OliveStudio'}};
  previous = ['f000:load', 0];
 } else {
  const first = prefixWorkflow(start, 'f000:'), keep = savers(first)[0];
  if (!keep) throw Error('The first-frame workflow saves no image');
  for (const id of Object.keys(first)) if (id !== keep && ['SaveImage', 'PreviewImage'].includes(first[id].class_type)) delete first[id];
  Object.assign(graph, first);
  previous = first[keep].inputs.images as [string, number];
 }
 edits.forEach((edit, i) => {
  const prefix = `f${String(i + 1).padStart(3, '0')}:`, slots = analyzeWorkflow(edit);
  if (!slots.image) throw Error('The edit workflow has no input image');
  const step = prefixWorkflow(edit, prefix), load = prefix + slots.image;
  for (const node of Object.values(step)) for (const [k, v] of Object.entries(node.inputs)) if (isLinkValue(v) && v[0] === load) node.inputs[k] = [...previous];
  delete step[load];
  const keep = savers(step)[0];
  if (!keep) throw Error('The edit workflow saves no image');
  for (const id of Object.keys(step)) if (id !== keep && ['SaveImage', 'PreviewImage'].includes(step[id].class_type)) delete step[id];
  Object.assign(graph, step);
  previous = step[keep].inputs.images as [string, number];
 });
 return graph;
}
/** Every SaveImage gets a transparent background (removal model → inverted mask → alpha) in the same graph. */
export function withCutouts(input: Workflow, model: string): Workflow {
 const w = structuredClone(input);
 w['cutout:model'] = {class_type: 'LoadBackgroundRemovalModel', inputs: {bg_removal_name: model}};
 for (const id of savers(input)) {
  const images = w[id].inputs.images;
  w[`${id}:mask`] = {class_type: 'RemoveBackground', inputs: {image: images, bg_removal_model: ['cutout:model', 0]}};
  w[`${id}:alpha`] = {class_type: 'InvertMask', inputs: {mask: [`${id}:mask`, 0]}};
  w[`${id}:join`] = {class_type: 'JoinImageWithAlpha', inputs: {image: images, alpha: [`${id}:alpha`, 0]}};
  w[id].inputs.images = [`${id}:join`, 0];
 }
 return w;
}
/** Where a queued job is on the server. */
export type JobStatus = {state: 'queued'; ahead: number} | {state: 'running'} | {state: 'done'; outputs: number} | {state: 'failed'; error: string} | {state: 'lost'};
/** A ComfyUI job the editor follows (machine-local, per project): it survives closing the editor. */
export const JobSchema = z.object({
 id: z.string().min(1), promptId: z.string().min(1), url: z.string().max(200), project: z.string().max(200), createdAt: z.string(), name: z.string().max(120),
 kind: z.enum(['image', 'audio', 'animation']),
 state: z.enum(['queued', 'running', 'done', 'imported', 'failed', 'cancelled', 'lost']), ahead: z.number().int().optional(), error: z.string().max(2000).optional(),
 info: z.record(z.string(), z.unknown()),
 /** Animations: how to cut and play the frames. */
 animation: z.object({method: z.enum(['sheet', 'edit', 'video']), frames: z.number().int(), columns: z.number().int(), fps: z.number(), loop: z.boolean()}).strict().optional(),
 assets: z.array(z.string()).optional(),
 /** Imported animations: the packed sheet's layout (to place it again). */
 layout: z.object({columns: z.number().int(), rows: z.number().int(), frames: z.number().int(), fps: z.number(), loop: z.boolean(), width: z.number(), height: z.number()}).strict().optional(),
}).strict();
export type Job = z.infer<typeof JobSchema>;
/** One graph where a text-to-image workflow makes the input picture of another (image-to-video without the editor). */
export function feedImage(start: Workflow, target: Workflow): Workflow {
 const first = prefixWorkflow(start, 's:'), keep = savers(first)[0], slot = analyzeWorkflow(target).image;
 if (!keep) throw Error('The first-frame workflow saves no image');
 if (!slot) throw Error('The workflow has no input image');
 const image = first[keep].inputs.images as [string, number];
 for (const id of Object.keys(first)) if (['SaveImage', 'PreviewImage'].includes(first[id].class_type)) delete first[id];
 const rest = prefixWorkflow(target, 't:'), load = `t:${slot}`;
 for (const node of Object.values(rest)) for (const [k, v] of Object.entries(node.inputs)) if (isLinkValue(v) && v[0] === load) node.inputs[k] = [...image];
 delete rest[load];
 return {...first, ...rest};
}
