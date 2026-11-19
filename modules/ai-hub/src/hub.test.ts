import {describe, expect, it} from 'vitest';
import {chunkReader} from '@rewrite/ai-lm/stream';
import {applySnapshot, availability, CreateRequestSchema, decodeProblem, encodeProblem, encodeWav, explainProblem, formatBytes, lmStatusOf, manualInvite, outputExtension, outputKind, unpaired, uploadName, useHubFor, type HubStatus, type LocalJob} from './contracts';

const status = (patch: Partial<HubStatus> = {}): HubStatus => ({paired: true, online: true, scopes: ['chat', 'image.create'], models: [{id: 'lmstudio/qwen/qwen3-8b', capabilities: ['chat'], loaded: false}, {id: 'comfyui/sdxl', capabilities: ['image.create']}], integrations: [], mcpServers: [], ...patch});

describe('LocalHub feature rule', () => {
 it('offers a feature only with the permission and a model for it', () => {
  expect(availability(null, 'chat')).toBe('unpaired');
  expect(availability(status({online: false}), 'chat')).toBe('offline');
  expect(availability(status(), 'chat')).toBe('ready');
  expect(availability(status(), 'image.create')).toBe('ready');
  expect(availability(status(), 'image.edit')).toBe('scope');
  expect(availability(status({scopes: ['chat', 'image.create', 'video.create']}), 'video.create')).toBe('model');
 });
 it('maps chat models to the assistant status and explains a missing chat permission', () => {
  expect(lmStatusOf(status())).toMatchObject({online: true, models: [{id: 'lmstudio/qwen/qwen3-8b', loaded: false, tools: true, type: 'llm'}]});
  const denied = lmStatusOf(status({scopes: ['image.create']}));
  expect(denied.online).toBe(false);
  expect(denied.error).toMatch(/Devices/);
 });
 it('uses the hub when chosen, or automatically once paired', () => {
  expect(useHubFor('localhub', null)).toBe(true);
  expect(useHubFor('direct', {paired: true})).toBe(false);
  expect(useHubFor('auto', {paired: true})).toBe(true);
  expect(useHubFor('auto', unpaired())).toBe(false);
 });
});

describe('LocalHub problems', () => {
 it('keeps the code across IPC and explains it', () => {
  const crossed = Error(`Error invoking remote method 'localhub:create': Error: ${encodeProblem({code: 'forbidden', message: 'Device may not use image.edit'})}`);
  const problem = decodeProblem(crossed);
  expect(problem).toEqual({code: 'forbidden', message: 'Device may not use image.edit'});
  expect(explainProblem(problem)).toMatch(/LocalHub › Devices.*Device may not use image\.edit/);
  expect(decodeProblem(Error("Error invoking remote method 'x': Error: Assistant cancelled"))).toEqual({code: 'error', message: 'Assistant cancelled'});
  expect(explainProblem({code: 'something_new', message: 'As the hub said'})).toBe('As the hub said');
 });
});

describe('LocalHub requests', () => {
 it('builds an invite from the values under the QR', () => {
  const invite = new URL(manualInvite('192.168.1.20:8790', 'AB:CD ' + 'ef'.repeat(31), ' 123456 '));
  expect(invite.protocol).toBe('localhub:');
  expect(Object.fromEntries(invite.searchParams)).toEqual({v: '2', u: 'https://192.168.1.20:8790', fp: 'abcd' + 'ef'.repeat(31), c: '123456'});
 });
 it('validates generation requests', () => {
  expect(CreateRequestSchema.parse({capability: 'image.create', prompt: ' fox ', width: 512, height: 512}).prompt).toBe('fox');
  expect(() => CreateRequestSchema.parse({capability: 'image.create', prompt: 'fox', width: 500})).toThrow();
  expect(() => CreateRequestSchema.parse({capability: 'image.edit', prompt: 'hat'})).toThrow(/sprite/);
  expect(() => CreateRequestSchema.parse({capability: 'audio.edit', prompt: 'echo'})).toThrow(/sound/);
  expect(() => CreateRequestSchema.parse({capability: 'video.edit', prompt: 'faster', videoId: '../x'})).toThrow();
  expect(() => CreateRequestSchema.parse({capability: 'image.create', prompt: 'x', workflow: {}})).toThrow();
 });
 it('accepts only the hub upload types, with safe names', () => {
  expect(uploadName('Hero sprite.PNG')).toEqual({filename: 'Hero sprite.png', mime: 'image/png'});
  expect(uploadName('../../evil/<x>.wav')).toEqual({filename: 'evilx.wav', mime: 'audio/wav'});
  expect(() => uploadName('tool.exe')).toThrow(/does not accept \.exe/);
  expect(() => uploadName('noextension')).toThrow();
  expect(formatBytes(25_600)).toBe('25.0 KB');
 });
 it('names output files by type', () => {
  expect(outputExtension({mime: 'audio/flac', filename: 'speech'})).toBe('flac');
  expect(outputExtension({mime: 'application/octet-stream', filename: 'clip.WEBM'})).toBe('webm');
  expect(outputKind({mime: 'image/png; charset=binary', filename: ''})).toBe('image');
  expect(outputKind({mime: 'video/mp4', filename: ''})).toBe('video');
  expect(outputKind({mime: 'model/gltf-binary', filename: 'chair.glb'})).toBe('other');
 });
});

describe('LocalHub jobs and audio', () => {
 const job: LocalJob = {id: 'job-1', project: 'scene', name: 'fox', capability: 'image.create', purpose: 'image.sprite', kind: 'image', createdAt: 0, state: 'queued', info: {workflow: 'w', prompt: 'p', negative: '', seed: 1, steps: 0, cfg: 0, width: 0, height: 0, model: '', createdAt: '', kind: 'image'}};
 it('folds hub snapshots into the editor record', () => {
  const queued = applySnapshot(job, {id: 'job-1', status: 'queued', capability: 'image.create', model: 'comfyui/sdxl', output_file_ids: [], created_at: 0, queue_position: 2});
  expect(queued).toMatchObject({state: 'queued', detail: '2 ahead'});
  const running = applySnapshot(queued, {id: 'job-1', status: 'in_progress', capability: 'image.create', model: 'm', output_file_ids: [], created_at: 0, progress: 0.4, current_node: 'KSampler 12/30', eta_seconds: 30, has_preview: true});
  expect(running).toMatchObject({state: 'in_progress', progress: 0.4, detail: 'KSampler 12/30', eta: 30, preview: true});
  const failed = applySnapshot(running, {id: 'job-1', status: 'failed', capability: 'image.create', model: 'm', output_file_ids: [], created_at: 0, error: 'Out of memory'});
  expect(failed).toMatchObject({state: 'failed', error: 'Out of memory'});
  expect(failed.eta).toBeUndefined();
  expect(applySnapshot({...job, state: 'imported'}, {id: 'job-1', status: 'completed', capability: 'x', model: 'm', output_file_ids: [], created_at: 0}).state).toBe('imported');
 });
 it('encodes stereo 16-bit WAV', () => {
  const wav = encodeWav([new Float32Array([0, 1, -1]), new Float32Array([0.5, 0, 0])], 22050), view = new DataView(wav.buffer);
  expect(String.fromCharCode(...wav.slice(0, 4))).toBe('RIFF');
  expect(view.getUint16(22, true)).toBe(2);
  expect(view.getUint32(24, true)).toBe(22050);
  expect(view.getUint32(40, true)).toBe(12);
  expect(view.getInt16(44 + 4, true)).toBe(0x7fff);
  expect(view.getInt16(44 + 8, true)).toBe(-0x8000);
 });
});

describe('chat chunks', () => {
 it('merges streamed tool-call fragments and thinking (LM Studio and LocalHub share it)', () => {
  const seen: unknown[] = [], reader = chunkReader(d => seen.push(d), 'LocalHub');
  reader.push({choices: [{delta: {reasoning_content: 'hmm'}}]});
  reader.push({choices: [{delta: {tool_calls: [{index: 0, id: 'c1', function: {name: 'add_', arguments: '{"a"'}}]}}]});
  reader.push({choices: [{delta: {tool_calls: [{index: 0, function: {name: 'object', arguments: ':1}'}}]}, finish_reason: 'tool_calls'}]});
  expect(reader.result()).toEqual({content: '', finish: 'tool_calls', reasoningChars: 3, toolCalls: [{id: 'c1', type: 'function', function: {name: 'add_object', arguments: '{"a":1}'}}]});
  expect(seen).toContainEqual({tool: 'add_object'});
  expect(() => reader.push({error: {message: 'LM Studio is not running on this Mac'}})).toThrow(/LocalHub: LM Studio/);
 });
});
