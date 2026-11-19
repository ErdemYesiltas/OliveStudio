import {afterEach, expect, it} from 'vitest';
import {createServer, type Server} from 'node:http';
import {analyzeWorkflow, applyInputs, assertLocal, imageToImage, nameFromPrompt, textToImage, workflowNeeds, type GenerateInputs} from './contracts';
import {ComfyClient} from './client.node';

const inputs: GenerateInputs = {prompt: 'a red slime', negative: 'blurry', seed: 42, steps: 12, cfg: 6.5, width: 768, height: 512, batch: 2, denoise: 0.5, model: 'model.safetensors'};

it('only accepts this computer as the ComfyUI address', () => {
 expect(assertLocal('http://127.0.0.1:8188/x').origin).toBe('http://127.0.0.1:8188');
 expect(assertLocal('http://localhost:8000').origin).toBe('http://localhost:8000');
 expect(() => assertLocal('http://192.168.1.4:8188')).toThrow('this computer');
 expect(() => assertLocal('http://user:pw@127.0.0.1:8188')).toThrow('credentials');
 expect(() => assertLocal('file:///etc/passwd')).toThrow();
});

it('finds slots by wiring and writes inputs into them', () => {
 expect(analyzeWorkflow(textToImage())).toMatchObject({sampler: '5', positive: '2', negative: '3', latent: '4', checkpoint: '1', image: undefined, outputs: ['7'], kind: 'image'});
 const w = applyInputs(textToImage(), inputs);
 expect(w['2'].inputs.text).toBe('a red slime'); expect(w['3'].inputs.text).toBe('blurry');
 expect(w['5'].inputs).toMatchObject({seed: 42, steps: 12, cfg: 6.5, denoise: 0.5});
 expect(w['4'].inputs).toMatchObject({width: 768, height: 512, batch_size: 2});
 expect(w['1'].inputs.ckpt_name).toBe('model.safetensors');
 expect(textToImage()['2'].inputs.text).toBe('');
 expect(workflowNeeds(imageToImage())).toMatchObject({image: true, size: false, model: true});
 // Flux-style: negative missing, seed on RandomNoise, prompt reached through a guider.
 const flux = {'1': {class_type: 'CLIPTextEncode', inputs: {text: 'x', clip: ['9', 0]}}, '2': {class_type: 'FluxGuidance', inputs: {conditioning: ['1', 0], guidance: 3.5}}, '3': {class_type: 'RandomNoise', inputs: {noise_seed: 1}}, '4': {class_type: 'EmptySD3LatentImage', inputs: {width: 1024, height: 1024, batch_size: 1}}, '5': {class_type: 'SaveImage', inputs: {images: ['8', 0], filename_prefix: 'a'}}};
 const f = applyInputs(flux, inputs);
 expect(f['1'].inputs.text).toBe('a red slime'); expect(f['3'].inputs.noise_seed).toBe(42); expect(f['4'].inputs.width).toBe(768); expect(f['5'].inputs.filename_prefix).toBe('OliveStudio');
 expect(nameFromPrompt('A Red  Slime, pixel art!', 7)).toBe('a-red-slime-pixel-art-7');
});

let server: Server | undefined;
afterEach(() => new Promise<void>(r => server ? server.close(() => r()) : r()));
it('client: status, checkpoints, queue → history polling → images; errors surface; cancel interrupts', async () => {
 const calls: string[] = []; let polls = 0, fail = false;
 server = createServer((req, res) => {
  calls.push(`${req.method} ${req.url}`);
  const json = (v: unknown, code = 200) => { res.writeHead(code, {'Content-Type': 'application/json'}); res.end(JSON.stringify(v)); };
  let body = ''; req.on('data', c => { body += c; }); req.on('end', () => {
   if (req.url === '/system_stats') return json({system: {comfyui_version: '0.3.99'}, devices: [{name: 'mps', vram_free: 8 * 1048576 * 1024}]});
   if (req.url === '/object_info/CheckpointLoaderSimple') return json({CheckpointLoaderSimple: {input: {required: {ckpt_name: [['a.safetensors', 'b.ckpt']]}}}});
   if (req.url === '/prompt') { const p = JSON.parse(body); return p.prompt['2'].inputs.text === 'bad' ? json({error: {message: 'Prompt outputs failed validation'}, node_errors: {'1': {errors: [{message: 'Value not in list', details: 'ckpt_name: x'}]}}}, 400) : json({prompt_id: 'p1'}); }
   if (req.url === '/history/p1') { polls++; if (polls < 3) return json({}); return json(fail ? {p1: {status: {status_str: 'error', completed: false, messages: [['execution_error', {exception_message: 'CUDA out of memory'}]]}}} : {p1: {status: {status_str: 'success', completed: true}, outputs: {'7': {images: [{filename: 'x_00001_.png', subfolder: '', type: 'output'}, {filename: 'tmp.png', subfolder: '', type: 'temp'}]}}}}); }
   if (req.url?.startsWith('/view?')) { res.writeHead(200, {'Content-Type': 'image/png'}); return res.end(Buffer.from([137, 80, 78, 71])); }
   if (req.url === '/queue' || req.url === '/interrupt') return json({});
   json({}, 404);
  });
 });
 await new Promise<void>(r => server!.listen(0, '127.0.0.1', () => r()));
 const client = new ComfyClient(`http://127.0.0.1:${(server.address() as {port: number}).port}`);
 expect(await client.status()).toMatchObject({online: true, version: '0.3.99', device: 'mps', vramFreeMB: 8192});
 expect(await client.checkpoints()).toEqual(['a.safetensors', 'b.ckpt']);
 await expect(client.queue(applyInputs(textToImage(), {...inputs, prompt: 'bad'}))).rejects.toThrow('Value not in list ckpt_name: x');
 const id = await client.queue(applyInputs(textToImage(), inputs)), seen: number[] = [];
 const images = await client.wait(id, p => seen.push(p.value), new AbortController().signal);
 expect(images).toEqual([{filename: 'x_00001_.png', subfolder: '', type: 'output', node: '7'}]);
 expect([...await client.view(images[0])]).toEqual([137, 80, 78, 71]);
 polls = 0; fail = true;
 await expect(client.wait('p1', () => {}, new AbortController().signal)).rejects.toThrow('CUDA out of memory');
 const abort = new AbortController(); polls = -1000; setTimeout(() => abort.abort(), 50);
 await expect(client.wait('p1', () => {}, abort.signal)).rejects.toThrow('cancelled');
 await client.cancel('p1');
 expect(calls).toEqual(expect.arrayContaining(['POST /queue', 'POST /interrupt']));
 await expect(new ComfyClient('http://127.0.0.1:1').status()).resolves.toMatchObject({online: false});
});

it('audio workflows: Stable Audio template, ACE-Step tags/lyrics, savers become MP3, model and sampler defaults', async () => {
 const {textToAudio, preferredModel, samplerDefaults} = await import('./contracts');
 const slots = analyzeWorkflow(textToAudio());
 expect(slots).toMatchObject({kind: 'audio', positive: '3', negative: '4', latent: '5', encoder: '2', checkpoint: '1', outputs: ['8']});
 expect(workflowNeeds(textToAudio())).toMatchObject({kind: 'audio', seconds: true, size: false, encoder: true, batch: true, lyrics: false});
 const w = applyInputs(textToAudio(), {...inputs, seconds: 6.5, encoder: 't5gemma_b_b_ul2.safetensors', model: 'stable_audio_3_medium.safetensors'});
 expect(w['5'].inputs).toMatchObject({seconds: 6.5, batch_size: 2}); expect(w['2'].inputs.clip_name).toBe('t5gemma_b_b_ul2.safetensors');
 expect(w['8']).toEqual({class_type: 'SaveAudioMP3', inputs: {audio: ['7', 0], filename_prefix: 'OliveStudio', quality: 'V0'}});
 const ace = {'1': {class_type: 'TextEncodeAceStepAudio', inputs: {tags: 'x', lyrics: 'y', lyrics_strength: 1, clip: ['9', 1]}}, '2': {class_type: 'EmptyAceStepLatentAudio', inputs: {seconds: 120, batch_size: 1}}, '3': {class_type: 'KSampler', inputs: {positive: ['1', 0], negative: ['1', 0], latent_image: ['2', 0], seed: 1, steps: 50, cfg: 5, denoise: 1}}, '4': {class_type: 'SaveAudio', inputs: {audio: ['5', 0], filename_prefix: 'audio/x'}}};
 expect(workflowNeeds(ace)).toMatchObject({kind: 'audio', lyrics: true, seconds: true});
 const a = applyInputs(ace, {...inputs, prompt: 'lofi, piano', lyrics: '[verse] hello', seconds: 30});
 expect(a['1'].inputs).toMatchObject({tags: 'lofi, piano', lyrics: '[verse] hello'}); expect(a['2'].inputs.seconds).toBe(30); expect(a['4'].class_type).toBe('SaveAudioMP3');
 const list = ['hunyuan_3d_v2.1.safetensors', 'sd_xl_base_1.0.safetensors', 'sd_xl_refiner_1.0.safetensors', 'stable_audio_3_medium.safetensors'];
 expect([preferredModel('image', list), preferredModel('audio', list)]).toEqual(['sd_xl_base_1.0.safetensors', 'stable_audio_3_medium.safetensors']);
 expect([samplerDefaults('audio', 'stable_audio_3_medium.safetensors'), samplerDefaults('audio', 'stable_audio_3_medium_base.safetensors')]).toEqual([{steps: 8, cfg: 1}, {steps: 50, cfg: 7}]);
});

it('client returns audio outputs alongside images', async () => {
 server = createServer((req, res) => { res.writeHead(200, {'Content-Type': 'application/json'}); res.end(JSON.stringify(req.url === '/history/a1' ? {a1: {status: {status_str: 'success', completed: true}, outputs: {'8': {audio: [{filename: 'OliveStudio_00001_.mp3', subfolder: 'audio', type: 'output'}]}}}} : {})); });
 await new Promise<void>(r => server!.listen(0, '127.0.0.1', () => r()));
 const client = new ComfyClient(`http://127.0.0.1:${(server.address() as {port: number}).port}`);
 expect(await client.wait('a1', () => {}, new AbortController().signal)).toEqual([expect.objectContaining({filename: 'OliveStudio_00001_.mp3', subfolder: 'audio', type: 'output'})]);
});

it('animation: video savers become SaveImage frames, the latent length is the frame count; grids, prompts and cut-outs', async () => {
 const {backgroundRemovalWorkflow, editPrompt, gridFor, sheetPrompt, sliceGrid} = await import('./contracts');
 const wan = {
  '1': {class_type: 'CLIPTextEncode', inputs: {text: 'a cat', clip: ['9', 0]}}, '2': {class_type: 'LoadImage', inputs: {image: 'x.png'}},
  '3': {class_type: 'WanImageToVideo', inputs: {positive: ['1', 0], width: 480, height: 480, length: 33, batch_size: 1, start_image: ['2', 0]}},
  '4': {class_type: 'KSampler', inputs: {seed: 1, steps: 20, cfg: 5, positive: ['3', 0], latent_image: ['3', 2]}},
  '5': {class_type: 'VAEDecode', inputs: {samples: ['4', 0]}}, '6': {class_type: 'CreateVideo', inputs: {images: ['5', 0], fps: 16}},
  '7': {class_type: 'SaveVideo', inputs: {video: ['6', 0], filename_prefix: 'v', format: 'auto', codec: 'auto'}},
 };
 expect(analyzeWorkflow(wan)).toMatchObject({kind: 'video', outputs: ['7'], image: '2', length: {id: '3', key: 'length'}, fps: {id: '6', key: 'fps'}});
 expect(workflowNeeds(wan)).toMatchObject({kind: 'video', length: true, image: true});
 const w = applyInputs(wan, {...inputs, length: 12});
 expect(w['7']).toEqual({class_type: 'SaveImage', inputs: {images: ['5', 0], filename_prefix: 'OliveStudio'}});
 expect(w['3'].inputs.length).toBe(12);
 const direct = applyInputs({...wan, '7': {class_type: 'SaveVideo', inputs: {video: ['8', 0], filename_prefix: 'v'}}, '8': {class_type: 'LTXVDecodeVideo', inputs: {}}}, inputs);
 expect(direct['7:frames']).toEqual({class_type: 'GetVideoComponents', inputs: {video: ['8', 0]}});
 expect(direct['7'].inputs.images).toEqual(['7:frames', 0]);
 const webp = applyInputs({...wan, '7': {class_type: 'SaveAnimatedWEBP', inputs: {images: ['5', 0], filename_prefix: 'a', fps: 8}}}, inputs);
 expect(webp['7']).toEqual({class_type: 'SaveImage', inputs: {images: ['5', 0], filename_prefix: 'OliveStudio'}});
 expect(gridFor(8)).toEqual({columns: 3, rows: 3}); expect(gridFor(8, 4)).toEqual({columns: 4, rows: 2}); expect(gridFor(5, 9)).toEqual({columns: 5, rows: 1});
 expect(sliceGrid(1024, 512, 4, 2, 6)).toEqual([0, 1, 2, 3, 4, 5].map(i => ({x: (i % 4) * 256, y: Math.floor(i / 4) * 256, width: 256, height: 256})));
 expect(sheetPrompt('a knight', 'walk cycle', 8, 4, 2)).toContain('sprite sheet of 8 animation frames of a walk cycle, arranged in a 4x2 grid');
 expect(editPrompt('a knight', 'walk cycle', 2, 8)).toContain('frame 3 of 8');
 const cut = backgroundRemovalWorkflow('birefnet.safetensors', ['a.png', 'b.png']);
 expect(Object.values(cut).filter(n => n.class_type === 'SaveImage')).toHaveLength(2);
 expect(cut.join001).toEqual({class_type: 'JoinImageWithAlpha', inputs: {image: ['load001', 0], alpha: ['alpha001', 0]}});
 expect(cut.alpha001).toEqual({class_type: 'InvertMask', inputs: {mask: ['mask001', 0]}});
});

it('background jobs: frame-by-frame edits chain into one graph (upload or text-to-image start), cut-outs join every frame', async () => {
 const {chainEdits, prefixWorkflow, withCutouts} = await import('./contracts');
 expect(prefixWorkflow(textToImage(), 'p:')['p:5'].inputs.model).toEqual(['p:1', 0]);
 const edit = applyInputs(imageToImage(), inputs), graph = chainEdits('upload', [edit, edit]);
 expect(graph['f000:load']).toEqual({class_type: 'LoadImage', inputs: {image: ''}});
 expect(graph['f001:8']).toBeUndefined();
 expect(graph['f001:9'].inputs.pixels).toEqual(['f000:load', 0]);
 expect(graph['f002:9'].inputs.pixels).toEqual(['f001:6', 0]);
 expect(Object.keys(graph).filter(id => graph[id].class_type === 'SaveImage').sort()).toEqual(['f000:save', 'f001:7', 'f002:7']);
 const fromText = chainEdits(applyInputs(textToImage(), inputs), [edit]);
 expect(fromText['f001:9'].inputs.pixels).toEqual(['f000:6', 0]);
 expect(Object.values(fromText).filter(n => n.class_type === 'LoadImage')).toHaveLength(0);
 const cut = withCutouts(graph, 'birefnet.safetensors');
 expect(cut['f001:7'].inputs.images).toEqual(['f001:7:join', 0]);
 expect(cut['f001:7:mask']).toEqual({class_type: 'RemoveBackground', inputs: {image: ['f001:6', 0], bg_removal_model: ['cutout:model', 0]}});
 expect(() => chainEdits('upload', [applyInputs(textToImage(), inputs)])).toThrow('no input image');
});
