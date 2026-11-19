import {z} from 'zod';
import {GenerationSchema} from '@rewrite/ai-comfy/contracts';
import type {ChatDelta, ChatRequest, ChatResult, LmStatus} from '@rewrite/ai-lm/contracts';

/**
 * LocalHub: the Mac's local AI apps (LM Studio, ComfyUI…) behind one paired, certificate-pinned service. The client
 * (token, pin, network) lives in the main process; the renderer sees invite text going in and results coming out.
 * Pure parts only: what crosses IPC, the feature rule (permission and a model for it), job bookkeeping, audio encoding.
 */
export const hubApp = 'olive-studio';
/** What the editor asks for when pairing (the hub grants at most the Mac's defaults; MCP is granted on the Mac). */
export const hubCapabilities = ['chat', 'image.create', 'image.edit', 'audio.create', 'audio.edit', 'audio.speech', 'video.create', 'video.edit'] as const;
export type HubCapability = typeof hubCapabilities[number];
export type CreateCapability = Exclude<HubCapability, 'chat'>;

export interface HubModelInfo {id: string; capabilities: string[]; loaded?: boolean}
export interface HubIntegration {id: string; name: string; kind: string; state: 'running' | 'unreachable' | 'error'; capabilities: string[]; detail?: string}
/** A hub error code (`forbidden`, `provider_unavailable`…) or a connection problem (`unreachable`, `pin_mismatch`). */
export interface HubProblem {code: string; message: string; provider?: string}
export interface HubStatus {
 paired: boolean; online: boolean; hubName?: string; address?: string;
 /** Granted on the Mac right now (`GET /v2/session`); can change while paired. */
 scopes: string[]; models: HubModelInfo[]; integrations: HubIntegration[];
 /** MCP servers this device may use in chat (`mcp:<id>` permissions). */
 mcpServers: string[]; problem?: HubProblem;
}
export const unpaired = (): HubStatus => ({paired: false, online: false, scopes: [], models: [], integrations: [], mcpServers: []});
export type HubJobState = 'queued' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
export interface HubJobInfo {
 id: string; status: HubJobState; capability: string; model: string; output_file_ids: string[]; created_at: number;
 /** 0–1 over the whole workflow. */
 progress?: number; error?: string; queue_position?: number; current_node?: string; eta_seconds?: number; waiting_reason?: string; has_preview?: boolean;
}
export type HubEvent = {type: 'job'; job: HubJobInfo} | {type: 'session'; scopes: string[]} | {type: 'revoked'};
export interface HubOutput {bytes: Uint8Array; mime: string; filename: string}
/** A file this device keeps on the hub: an upload or a job's output (integration guide §5.6). */
export interface HubFileInfo {id: string; filename: string; bytes: number; mime: string; purpose: string; source: 'upload' | 'job'; jobId?: string; createdAt: number}
/** What the hub accepts as uploads (guide §5.6), by extension. */
export const uploadTypes: Record<string, string> = {png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', apng: 'image/apng', mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac', ogg: 'audio/ogg', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', json: 'application/json', txt: 'text/plain'};
export const uploadLimit = 100 * 1024 * 1024;
/** A safe hub file name with an accepted extension, and its MIME type; throws for other types. */
export function uploadName(name: string): {filename: string; mime: string} {
 const m = /^(.*?)\.([a-z0-9]{2,5})$/i.exec(name.trim()), ext = m?.[2].toLowerCase() ?? '';
 const mime = uploadTypes[ext];
 if (!mime) throw Error(`LocalHub does not accept .${ext || '?'} files (images, sounds, videos, JSON and text only)`);
 return {filename: `${(m![1].replace(/[^\w .()#-]/g, '').replace(/^[.\s]+/, '').trim() || 'file').slice(0, 100)}.${ext}`, mime};
}
export const formatBytes = (n: number) => n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(1)} KB` : n < 1024 ** 3 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${(n / 1024 ** 3).toFixed(2)} GB`;

const Bytes = z.instanceof(Uint8Array).refine(b => b.byteLength > 0 && b.byteLength <= 32 * 1024 * 1024, 'Input file is empty or larger than 32 MB');
const Side = z.number().int().min(64).max(4096).multipleOf(8);
/** One generation request crossing IPC; the main process turns it into the hub's OpenAI-style call. */
export const CreateRequestSchema = z.object({
 capability: z.enum(['image.create', 'image.edit', 'audio.create', 'audio.edit', 'audio.speech', 'video.create', 'video.edit']),
 prompt: z.string().trim().min(1).max(4000),
 /** `<integration>/<model or workflow>`; omitted = the default chosen on the Mac. */
 model: z.string().max(400).optional(),
 width: Side.optional(), height: Side.optional(),
 negative: z.string().max(4000).optional(), seed: z.number().int().min(0).max(2 ** 32 - 1).optional(), steps: z.number().int().min(1).max(200).optional(),
 seconds: z.number().min(0.5).max(600).optional(), strength: z.number().min(0).max(1).optional(), voice: z.string().max(80).optional(),
 /** PNG of the selected sprite (image edit, image-to-video); audio bytes of the selected sound (audio edit). */
 image: Bytes.optional(), audio: Bytes.optional(),
 /** The finished hub video to remix (video.edit). */
 videoId: z.string().regex(/^[\w.-]{1,200}$/).optional(),
}).strict().superRefine((r, ctx) => {
 if (r.capability === 'image.edit' && !r.image) ctx.addIssue({code: 'custom', message: 'Select a sprite to change first'});
 if (r.capability === 'audio.edit' && !r.audio) ctx.addIssue({code: 'custom', message: 'Select an object with a sound first'});
 if (r.capability === 'video.edit' && !r.videoId) ctx.addIssue({code: 'custom', message: 'Pick a finished video to remix'});
});
export type CreateRequest = z.input<typeof CreateRequestSchema>;

/** The preload bridge (`window.platform.localhub`). */
export interface HubPort {
 status(): Promise<HubStatus>;
 /** Invite text from the Mac's Pair a Device window (`localhub://pair?…`). */
 pair(invite: string): Promise<HubStatus>;
 unpair(): Promise<void>;
 chat(jobId: string, request: ChatRequest, mcpServers?: readonly string[]): Promise<ChatResult>;
 cancel(jobId: string): Promise<void>;
 onDelta(callback: (delta: ChatDelta) => void): () => void;
 /** Starts a job (images, sounds, videos); speech comes back at once as an output. */
 create(request: CreateRequest): Promise<{job?: HubJobInfo; output?: HubOutput}>;
 job(id: string): Promise<HubJobInfo | null>;
 cancelJob(id: string): Promise<void>;
 preview(id: string): Promise<Uint8Array | null>;
 outputs(id: string): Promise<HubOutput[]>;
 onEvent(callback: (event: HubEvent) => void): () => void;
 /** This device's files on the hub, newest first. */
 files(): Promise<HubFileInfo[]>;
 fileContent(id: string): Promise<HubOutput>;
 uploadFile(bytes: Uint8Array, name: string): Promise<HubFileInfo>;
 deleteFile(id: string): Promise<void>;
}

/** Which connection the AI panel uses: LocalHub, this Mac's ComfyUI/LM Studio directly, or LocalHub once paired. */
export type Connection = 'auto' | 'localhub' | 'direct';
export const useHubFor = (setting: unknown, status: Pick<HubStatus, 'paired'> | null) => setting === 'localhub' || (setting !== 'direct' && Boolean(status?.paired));

/**
 * The integration guide's rule: offer a feature when the device has the permission and the Mac has a model or workflow
 * for it. `scope`: ask the Mac's owner (LocalHub › Devices); `model`: no workflow on the Mac for this yet.
 */
export function availability(status: HubStatus | null, capability: HubCapability): 'ready' | 'unpaired' | 'offline' | 'scope' | 'model' {
 if (!status?.paired) return 'unpaired';
 if (!status.online) return 'offline';
 if (!status.scopes.includes(capability)) return 'scope';
 return status.models.some(m => m.capabilities.includes(capability)) ? 'ready' : 'model';
}
export const modelsFor = (status: HubStatus | null, capability: HubCapability) => (status?.models ?? []).filter(m => m.capabilities.includes(capability));
/** The hub as an LM Studio status for the assistant and prompt writer (chat models only). */
export function lmStatusOf(status: HubStatus): LmStatus {
 return {online: status.online && status.scopes.includes('chat'), url: status.hubName ?? status.address ?? 'LocalHub', models: modelsFor(status, 'chat').map(m => ({id: m.id, loaded: m.loaded ?? true, tools: true, type: 'llm'})),
  ...(status.problem ? {error: status.problem.message} : !status.scopes.includes('chat') && status.online ? {error: 'This device may not chat: allow “chat” for it in LocalHub › Devices on the Mac'} : {})};
}

/** What a hub error means for the user, by code (integration guide §6); the hub's own sentence is kept as detail. */
const hints: Record<string, string> = {
 unauthorized: 'This editor is no longer paired with LocalHub. Pair again from the AI panel.',
 forbidden: 'LocalHub refused: allow this on the Mac in LocalHub › Devices.',
 provider_unavailable: 'The app behind it is not running on the Mac.',
 provider_timeout: 'The Mac took too long; the job was stopped.',
 insufficient_memory: 'The Mac did not free enough memory in time.',
 model_not_found: 'That model or workflow is gone from the Mac; refresh the list.',
 capability_unavailable: 'The Mac has no workflow for this yet (or no default chosen).',
 too_many_jobs: 'Two jobs are already running for this editor; wait for one to finish.',
 job_failed: 'The workflow failed on the Mac.',
 quota_exceeded: 'This editor’s file space on the hub is full.',
 payload_too_large: 'The file is too large for LocalHub.',
 unsupported_media_type: 'LocalHub does not accept that file type.',
 unreachable: 'LocalHub cannot be reached: is the Mac awake and LocalHub running?',
 pin_mismatch: 'LocalHub’s certificate changed. Nothing was sent. Pair again only if you trust this hub.',
 wrong_code: 'Wrong pairing code: open a new Pair a Device window on the Mac.',
 pairing_closed: 'The pairing window closed or expired: open a new one on the Mac.',
 too_many_attempts: 'Too many wrong codes: open a new pairing window on the Mac.',
 invalid_invite: 'That is not a LocalHub invite. Copy it from LocalHub › Pair a Device.',
};
export function explainProblem(problem: HubProblem): string {
 const hint = hints[problem.code];
 if (!hint) return problem.message;
 const detail = problem.message && !hint.includes(problem.message) ? ` (${problem.message}${problem.provider ? ` · ${problem.provider}` : ''})` : '';
 return hint + detail;
}
/** Errors cross IPC as plain messages: `[code] message` keeps the code for the renderer. */
export const encodeProblem = (problem: HubProblem) => `[${problem.code}] ${problem.message}`;
export function decodeProblem(error: unknown): HubProblem {
 const text = error instanceof Error ? error.message : String(error);
 const m = /\[([a-z_]+)\] ([\s\S]*)$/.exec(text);
 return m ? {code: m[1], message: m[2]} : {code: 'error', message: text.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')};
}

/** Builds an invite from the values shown under the Mac's QR (address, fingerprint, code) for manual entry. */
export function manualInvite(address: string, fingerprint: string, code: string): string {
 const url = new URL(/^https:\/\//.test(address.trim()) ? address.trim() : `https://${address.trim()}`);
 const params = new URLSearchParams({v: '2', u: url.origin, fp: fingerprint.replace(/[:\s]/g, '').toLowerCase(), c: code.trim()});
 return `localhub://pair?${params}`;
}

/** File extension for an output, from its MIME type or name. */
export function outputExtension(output: Pick<HubOutput, 'mime' | 'filename'>): string {
 const byMime: Record<string, string> = {'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav', 'audio/flac': 'flac', 'audio/x-flac': 'flac', 'audio/ogg': 'ogg', 'audio/opus': 'ogg', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov', 'model/gltf-binary': 'glb'};
 const mime = output.mime.split(';')[0].trim().toLowerCase();
 return byMime[mime] ?? (/\.([a-z0-9]{2,5})$/i.exec(output.filename)?.[1].toLowerCase() ?? 'bin');
}
export const outputKind = (output: Pick<HubOutput, 'mime' | 'filename'>): 'image' | 'audio' | 'video' | 'other' => {
 const e = outputExtension(output);
 return ['png', 'jpg', 'webp', 'gif'].includes(e) ? 'image' : ['mp3', 'wav', 'flac', 'ogg'].includes(e) ? 'audio' : ['mp4', 'webm', 'mov'].includes(e) ? 'video' : 'other';
};

/** 16-bit PCM WAV from decoded channels (the Library imports WAV and MP3; hubs often answer FLAC or Ogg). */
export function encodeWav(channels: readonly Float32Array[], sampleRate: number): Uint8Array<ArrayBuffer> {
 const count = Math.max(1, Math.min(2, channels.length)), frames = channels[0]?.length ?? 0, bytes = frames * count * 2;
 const out = new DataView(new ArrayBuffer(44 + bytes)), text = (at: number, s: string) => { for (let i = 0; i < s.length; i++) out.setUint8(at + i, s.charCodeAt(i)); };
 text(0, 'RIFF'); out.setUint32(4, 36 + bytes, true); text(8, 'WAVE'); text(12, 'fmt '); out.setUint32(16, 16, true); out.setUint16(20, 1, true);
 out.setUint16(22, count, true); out.setUint32(24, sampleRate, true); out.setUint32(28, sampleRate * count * 2, true); out.setUint16(32, count * 2, true); out.setUint16(34, 16, true);
 text(36, 'data'); out.setUint32(40, bytes, true);
 let at = 44;
 for (let i = 0; i < frames; i++) for (let c = 0; c < count; c++) { const v = Math.max(-1, Math.min(1, channels[c][i])); out.setInt16(at, v < 0 ? v * 0x8000 : v * 0x7fff, true); at += 2; }
 return new Uint8Array(out.buffer);
}

/** The editor's record of a hub job (this machine, per project): what to do with its outputs when it finishes. */
export const LocalJobSchema = z.object({
 id: z.string().min(1).max(200), project: z.string().max(200), name: z.string().min(1).max(80), capability: z.string().max(40), purpose: z.string().max(40),
 kind: z.enum(['image', 'audio', 'animation']), createdAt: z.number(),
 state: z.enum(['queued', 'in_progress', 'completed', 'failed', 'cancelled', 'imported', 'lost']),
 progress: z.number().optional(), detail: z.string().max(400).optional(), error: z.string().max(2000).optional(), eta: z.number().optional(), preview: z.boolean().optional(),
 /** Remove the plain background of image results (sprites, icons, frames). */
 cutout: z.boolean().optional(),
 /** Animations: how the frames come back (one sheet image, or a video) and how they play. */
 animation: z.object({method: z.enum(['sheet', 'video']), frames: z.number().int().min(2).max(64), columns: z.number().int().min(1).max(16), fps: z.number().min(1).max(60), loop: z.boolean()}).strict().optional(),
 /** Animations made from a video in the hub's Files (frames come from that file, not a job's outputs). */
 file: z.string().regex(/^[\w.-]{1,200}$/).optional(),
 /** Finished video jobs keep their hub ID so they can be remixed. */
 video: z.boolean().optional(),
 /** Imported assets and, for animations, how the packed sheet plays. */
 assets: z.array(z.string().min(1)).max(16).optional(),
 layout: z.object({columns: z.number().int(), rows: z.number().int(), frames: z.number().int(), fps: z.number(), loop: z.boolean(), width: z.number(), height: z.number()}).strict().optional(),
 info: GenerationSchema.omit({assetId: true}),
}).strict();
export type LocalJob = z.infer<typeof LocalJobSchema>;
export const isActive = (job: Pick<LocalJob, 'state'>) => job.state === 'queued' || job.state === 'in_progress';
/** Folds a hub job snapshot into the editor's record (finished jobs the editor already imported stay imported). */
export function applySnapshot(local: LocalJob, hub: HubJobInfo): LocalJob {
 if (local.state === 'imported') return local;
 const detail = hub.status === 'queued' ? (hub.waiting_reason ?? (hub.queue_position ? `${hub.queue_position} ahead` : undefined)) : hub.status === 'in_progress' ? (hub.waiting_reason ?? hub.current_node) : undefined;
 const next: LocalJob = {...local, state: hub.status, progress: hub.progress, preview: hub.has_preview, eta: hub.eta_seconds};
 if (detail) next.detail = detail.slice(0, 400); else delete next.detail;
 if (hub.status === 'failed' && hub.error) next.error = hub.error.slice(0, 2000);
 if (hub.status !== 'in_progress' && hub.status !== 'queued') { delete next.eta; delete next.preview; }
 return next;
}
export const formatEta = (seconds: number | undefined) => seconds === undefined ? '' : seconds < 60 ? `~${Math.max(1, Math.round(seconds))} s` : `~${Math.round(seconds / 60)} min`;
