// ComfyUI integration against a fake ComfyUI server: connection status and models, text-to-image into the Library
// (one undo step with generation history), placing a result, image-to-image from the selected sprite (upload +
// LoadImage) and applying it, cancelling (interrupt), importing an API workflow and a ComfyUI app save (converted),
// the "From ComfyUI" list (saved workflows and templates, ready vs. needs setup, converted on pick), offline state.
import {_electron as electron, expect} from '@playwright/test';
import {createServer} from 'node:http';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(join(root, 'apps/editor-desktop/package.json'));
const sharp = require('sharp');
const temp = await mkdtemp(join(tmpdir(), 'rewrite-comfy-'));
const env = {...process.env};
delete env.ELECTRON_RUN_AS_NODE;
let app, server;
const fake = {prompts: [], uploads: [], interrupts: 0, hold: false};
const png = color => sharp({create: {width: 64, height: 64, channels: 4, background: color}}).png().toBuffer();
const GREEN = await png('#3cc85a'), RED = await png('#dc3c3c'), BLUE = await png('#3c5adc'), CUTOUT = await sharp({create: {width: 48, height: 48, channels: 4, background: {r: 220, g: 60, b: 60, alpha: .5}}}).png().toBuffer(),
 SHEET = await sharp({create: {width: 128, height: 128, channels: 4, background: '#dc3c3c'}}).composite([{input: GREEN, left: 64, top: 0}, {input: BLUE, left: 0, top: 64}]).png().toBuffer(), TONE = await readFile(join(root, 'modules/audio/testdata/tone.mp3'));
// /object_info entries in the shapes ComfyUI reports, for converting app saves (UI format) to API format.
const objectInfo = {
 CheckpointLoaderSimple: {input: {required: {ckpt_name: [['fake-sd15.safetensors', 'stable_audio_3_medium.safetensors']]}}},
 CLIPTextEncode: {input: {required: {text: ['STRING', {multiline: true, dynamicPrompts: true}], clip: ['CLIP', {}]}}},
 EmptyLatentImage: {input: {required: {width: ['INT', {default: 512}], height: ['INT', {default: 512}], batch_size: ['INT', {default: 1}]}}},
 KSampler: {input: {required: {model: ['MODEL', {}], seed: ['INT', {control_after_generate: true}], steps: ['INT', {default: 20}], cfg: ['FLOAT', {default: 8}], sampler_name: [['euler', 'lcm']], scheduler: [['normal', 'simple']], positive: ['CONDITIONING', {}], negative: ['CONDITIONING', {}], latent_image: ['LATENT', {}], denoise: ['FLOAT', {default: 1}]}}, input_order: {required: ['model', 'seed', 'steps', 'cfg', 'sampler_name', 'scheduler', 'positive', 'negative', 'latent_image', 'denoise']}},
 VAEDecode: {input: {required: {samples: ['LATENT', {}], vae: ['VAE', {}]}}},
 SaveImage: {input: {required: {images: ['IMAGE', {}], filename_prefix: ['STRING', {default: 'ComfyUI'}]}}, output_node: true},
 FluxProNode: {input: {required: {prompt: ['STRING', {}]}}, output: ['IMAGE'], display_name: 'Flux Pro (API)', api_node: true},
};
/** A ComfyUI app save: SD 1.5 text to image, size from a Primitive node, a note, a muted extra saver. */
const appSave = (ckpt, extra = []) => ({nodes: [
 {id: 1, type: 'CheckpointLoaderSimple', widgets_values: [ckpt]},
 {id: 2, type: 'CLIPTextEncode', widgets_values: ['pixel art knight, {red|blue} armor'], inputs: [{name: 'clip', type: 'CLIP', link: 1}]},
 {id: 3, type: 'CLIPTextEncode', widgets_values: ['blurry'], inputs: [{name: 'clip', type: 'CLIP', link: 2}]},
 {id: 4, type: 'EmptyLatentImage', widgets_values: [512, 512, 1], inputs: [{name: 'width', type: 'INT', link: 3, widget: {name: 'width'}}]},
 {id: 5, type: 'PrimitiveNode', widgets_values: [768, 'fixed'], outputs: [{type: 'INT', links: [3]}]},
 {id: 6, type: 'KSampler', widgets_values: [7, 'randomize', 30, 5.5, 'euler', 'normal', 1], inputs: [{name: 'model', type: 'MODEL', link: 4}, {name: 'positive', type: 'CONDITIONING', link: 5}, {name: 'negative', type: 'CONDITIONING', link: 6}, {name: 'latent_image', type: 'LATENT', link: 7}]},
 {id: 7, type: 'VAEDecode', inputs: [{name: 'samples', type: 'LATENT', link: 8}, {name: 'vae', type: 'VAE', link: 9}]},
 {id: 8, type: 'SaveImage', widgets_values: ['knight'], inputs: [{name: 'images', type: 'IMAGE', link: 10}]},
 {id: 9, type: 'SaveImage', mode: 2, widgets_values: ['muted'], inputs: [{name: 'images', type: 'IMAGE', link: null}]},
 {id: 10, type: 'MarkdownNote', widgets_values: ['# Knight']},
 ...extra,
], links: [[1, 1, 1, 2, 0, 'CLIP'], [2, 1, 1, 3, 0, 'CLIP'], [3, 5, 0, 4, 0, 'INT'], [4, 1, 0, 6, 0, 'MODEL'], [5, 2, 0, 6, 1, 'CONDITIONING'], [6, 3, 0, 6, 2, 'CONDITIONING'], [7, 4, 0, 6, 3, 'LATENT'], [8, 6, 0, 7, 0, 'LATENT'], [9, 1, 2, 7, 1, 'VAE'], [10, 7, 0, 8, 0, 'IMAGE']]});
const library = {
 'workflows/pixel_knight.json': appSave('fake-sd15.safetensors'),
 'templates/image_flux_dev.json': appSave('flux1-dev.safetensors'),
 'templates/image_flux_pro_node.json': appSave('fake-sd15.safetensors', [{id: 11, type: 'FluxProNode', widgets_values: ['x']}]),
};

try {
 // Fake ComfyUI: no websocket; a job runs for 300 ms (it stays in /queue meanwhile), then its outputs are in /history.
 // "slow" never finishes (until interrupted), "later" waits while fake.hold is set.
 server = createServer((req, res) => {
  const json = (v, code = 200) => { res.writeHead(code, {'Content-Type': 'application/json'}); res.end(JSON.stringify(v)); };
  const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => {
   const body = Buffer.concat(chunks), url = new URL(req.url, 'http://x');
   if (url.pathname === '/object_info') return json(objectInfo);
   if (url.pathname === '/api/userdata' && url.searchParams.get('dir') === 'workflows') return json([{path: 'pixel_knight.json', size: 1, modified: 1}]);
   if (url.pathname.startsWith('/api/userdata/')) { const w = library[decodeURIComponent(url.pathname.slice(14))]; return w ? json(w) : json({error: 'no file'}, 404); }
   if (url.pathname === '/templates/index.json') return json([
    {moduleName: 'default', title: 'Image', type: 'image', templates: [{name: 'image_flux_dev', title: 'Flux Dev', description: 'Flux text to image'}, {name: 'image_flux_pro_node', title: 'Flux Pro node'}, {name: 'api_openai_image', title: 'OpenAI Image (API)', openSource: false}]},
    {moduleName: 'default', title: 'Video', type: 'video', templates: [{name: 'video_wan', title: 'Wan video'}]},
   ]);
   if (url.pathname.startsWith('/templates/')) { const w = library[decodeURIComponent(url.pathname.slice(1))]; return w ? json(w) : json({error: 'no template'}, 404); }
   if (url.pathname === '/system_stats') return json({system: {comfyui_version: '0.3.99'}, devices: [{name: 'mps', vram_free: 4294967296}]});
   if (url.pathname === '/object_info/CheckpointLoaderSimple') return json({CheckpointLoaderSimple: {input: {required: {ckpt_name: [['fake-sd15.safetensors', 'stable_audio_3_medium.safetensors']]}}}});
   if (url.pathname === '/object_info/LoadBackgroundRemovalModel') return json({LoadBackgroundRemovalModel: {input: {required: {bg_removal_name: ['COMBO', {options: ['birefnet.safetensors']}]}}}});
   if (url.pathname === '/object_info/LoraLoader') return json({LoraLoader: {input: {required: {lora_name: [['outline.safetensors', 'pixel-style.safetensors']]}}}});
   if (url.pathname === '/object_info/CLIPLoader') return json({CLIPLoader: {input: {required: {clip_name: [['qwen3.5_2b_bf16.safetensors', 't5gemma_b_b_ul2.safetensors']]}}}});
   if (url.pathname === '/upload/image') { fake.uploads.push(body.length); return json({name: 'uploaded-input.png', subfolder: '', type: 'input'}); }
   if (url.pathname === '/prompt') { const p = JSON.parse(body); const id = `p${fake.prompts.length + 1}`; fake.prompts.push({id, prompt: p.prompt, at: Date.now(), interrupted: false}); return json({prompt_id: id}); }
   const texts = job => Object.values(job.prompt).map(n => n.inputs.text).filter(v => typeof v === 'string').join(' ');
   const finished = job => !job.interrupted && Date.now() - job.at > 300 && !texts(job).includes('slow') && !(fake.hold && texts(job).includes('later'));
   if (url.pathname === '/queue' && req.method === 'GET') return json({queue_running: fake.prompts.filter(j => !j.interrupted && !finished(j)).map((j, i) => [i, j.id, j.prompt]), queue_pending: []});
   if (url.pathname.startsWith('/history/')) {
    const id = url.pathname.slice(9), job = fake.prompts.find(p => p.id === id);
    if (!job) return json({});
    if (job.interrupted) return json({[id]: {status: {status_str: 'error', completed: false, messages: [['execution_interrupted', {}]]}, outputs: {}}});
    if (!finished(job)) return json({});
    const nodes = Object.entries(job.prompt), text = texts(job), wan = nodes.find(([, n]) => n.class_type === 'WanImageToVideo');
    const audio = nodes.find(([, n]) => n.class_type === 'SaveAudioMP3');
    if (audio) return json({[id]: {status: {status_str: 'success', completed: true}, outputs: {[audio[0]]: {audio: [{filename: `tone_${id}.mp3`, subfolder: 'audio', type: 'output'}]}}}});
    const kind = nodes.some(([, n]) => n.class_type === 'RemoveBackground') ? 'cut' : text.includes('sprite sheet') ? 'sheet' : wan ? 'video' : nodes.some(([, n]) => n.class_type === 'LoadImage') ? 'red' : 'green';
    return json({[id]: {status: {status_str: 'success', completed: true}, outputs: Object.fromEntries(nodes.filter(([, n]) => n.class_type === 'SaveImage').map(([key]) => [key, {images: Array.from({length: wan ? wan[1].inputs.length : 1}, (_, i) => ({filename: `${kind}_${id}_${key.replace(/\W/g, '_')}_${i}.png`, subfolder: '', type: 'output'}))}]))}});
   }
   if (url.pathname === '/view') { const name = url.searchParams.get('filename'); if (name.startsWith('cut_')) { res.writeHead(200, {'Content-Type': 'image/png'}); return res.end(CUTOUT); } if (name.startsWith('sheet_')) { res.writeHead(200, {'Content-Type': 'image/png'}); return res.end(SHEET); } if (name.startsWith('video_')) { res.writeHead(200, {'Content-Type': 'image/png'}); return res.end(BLUE); } if (name.startsWith('tone')) { res.writeHead(200, {'Content-Type': 'audio/mpeg'}); return res.end(TONE); } res.writeHead(200, {'Content-Type': 'image/png'}); return res.end(name.startsWith('red') ? RED : GREEN); }
   if (url.pathname === '/interrupt') { fake.interrupts++; const target = body.length ? JSON.parse(body).prompt_id : undefined; for (const j of fake.prompts) if (!target || j.id === target) j.interrupted = true; return json({}); }
   if (url.pathname === '/queue') return json({});
   json({error: 'not found'}, 404);
  });
 });
 await new Promise(r => server.listen(0, '127.0.0.1', r));
 const comfyUrl = `http://127.0.0.1:${server.address().port}`;
 const apiWorkflow = join(temp, 'my-flux.json'), uiWorkflow = join(temp, 'ui.json'), emptyUi = join(temp, 'empty-ui.json'), file = join(temp, 'comfy.pixieditor');
 await writeFile(apiWorkflow, JSON.stringify({'1': {class_type: 'CLIPTextEncode', inputs: {text: 'x', clip: ['9', 0]}}, '2': {class_type: 'RandomNoise', inputs: {noise_seed: 1}}, '3': {class_type: 'EmptySD3LatentImage', inputs: {width: 1024, height: 1024, batch_size: 1}}, '7': {class_type: 'SaveImage', inputs: {images: ['8', 0], filename_prefix: 'a'}}}));
 await writeFile(uiWorkflow, JSON.stringify(appSave('fake-sd15.safetensors'))); await writeFile(emptyUi, JSON.stringify({nodes: [], links: []}));

 app = await electron.launch({executablePath: process.env.REWRITE_EXECUTABLE || require('electron'), args: [...(process.env.REWRITE_EXECUTABLE ? [] : [join(root, 'apps/editor-desktop/out/main/index.js')]), '--no-hub', `--user-data-dir=${join(temp, 'user')}`], env});
 let page = await app.firstWindow();
 page.setDefaultTimeout(15000);
 const errors = [];
 page.on('pageerror', e => errors.push(e.message));
 await expect(page.getByTestId('pixi-canvas')).toHaveAttribute('data-ready', 'true', {timeout: 30000});
 const menu = label => app.evaluate(({Menu}, text) => Menu.getApplicationMenu().items.flatMap(m => m.submenu?.items ?? []).find(i => i.label === text).click(), label);
 const choose = path => app.evaluate(({dialog}, target) => {
  dialog.showOpenDialog = async () => ({canceled: false, filePaths: [target]});
  dialog.showSaveDialog = async () => ({canceled: false, filePath: target});
  dialog.showMessageBox = async () => ({response: 1, checkboxChecked: false});
 }, path);
 const setAddress = async value => {
  await menu('Settings…');
  const field = page.getByTestId('settings-dialog').getByRole('textbox', {name: 'ComfyUI address', exact: true});
  await field.fill(value); await field.press('Enter');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('settings-dialog')).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Editor settings', exact: true})).toBeFocused();
 };
 await setAddress(comfyUrl);

 // Connection and models; Image → Sprite (the default) lands in the Library with its history in one undo step.
 await page.keyboard.press('Alt+KeyA');
 let panel = page.getByTestId('generate-panel');
 const spriteHint = text => `${text}, single game sprite, centered, full view, plain flat background`;
 await expect(panel).toHaveAttribute('data-online', 'true');
 await expect(panel.getByRole('status')).toContainText(`Connected · ${comfyUrl} · v0.3.99`);
 await expect(panel.getByRole('tab', {name: 'Image', exact: true})).toHaveAttribute('aria-selected', 'true');
 await expect(panel.getByRole('radio', {name: 'Sprite', exact: true})).toHaveAttribute('aria-checked', 'true');
 await expect(panel.getByRole('combobox', {name: 'Model', exact: true})).toHaveValue('fake-sd15.safetensors');
 await expect(panel.getByRole('combobox', {name: 'Size', exact: true}).locator('option:checked')).toHaveText('1:1 · 512×512');
 await expect(panel.getByRole('checkbox', {name: 'Remove background', exact: true})).toBeChecked();
 await panel.getByRole('textbox', {name: 'Prompt', exact: true}).fill('a green slime');
 await panel.getByRole('button', {name: 'Generate', exact: true}).click();
 await expect(panel.getByRole('listitem')).toHaveCount(1, {timeout: 30000});
 const first = fake.prompts[0].prompt;
 expect(first['2'].inputs.text).toBe(spriteHint('a green slime'));
 expect(Object.values(first).filter(n => n.class_type === 'RemoveBackground')).toHaveLength(1);
 expect(first['1'].inputs.ckpt_name).toBe('fake-sd15.safetensors');
 expect(first['4'].inputs).toMatchObject({width: 512, height: 512, batch_size: 1});
 const seed = first['5'].inputs.seed;
 await page.keyboard.press('Escape');
 await choose(file); await menu('Save');
 await expect.poll(() => readFile(file, 'utf8').then(() => true, () => false)).toBe(true);
 let saved = JSON.parse(await readFile(file, 'utf8'));
 const asset = saved.extensions['assets.registry'].items.find(a => a.name === `a-green-slime-${seed}`);
 expect(asset).toBeTruthy();
 expect(saved.extensions['ai-comfy.generations'].items).toEqual([expect.objectContaining({assetId: asset.id, prompt: spriteHint('a green slime'), seed, model: 'fake-sd15.safetensors', workflow: 'Text to image', purpose: 'sprite'})]);
 await menu('Undo');
 await page.getByRole('button', {name: 'Library', exact: true}).click();
 await expect(page.getByTestId('asset-list').getByText(asset.name, {exact: true})).toHaveCount(0);
 await page.keyboard.press('Escape');
 await menu('Redo');
 // Generated assets wait in Library → Generated; one click in the Generate panel sends them to the Library.
 expect(saved.extensions['assets.library'].items[asset.id]).toEqual({folderId: null, tags: ['generated', 'image', 'sprite'], inbox: true});
 await page.keyboard.press('Alt+KeyA');
 await panel.getByRole('button', {name: `Send to Library ${asset.name}`, exact: true}).click();
 await expect(panel.getByTestId('in-library')).toBeVisible();
 await page.keyboard.press('Escape');
 await choose(file); await menu('Save'); await expect(page.getByLabel('Unsaved changes', {exact: true})).toHaveCount(0);
 saved = JSON.parse(await readFile(file, 'utf8'));
 expect(saved.extensions['assets.library'].items[asset.id]).toEqual({folderId: null, tags: ['generated', 'image', 'sprite']});
 // Other kinds change the options: Background offers wide sizes and no background removal.
 await page.keyboard.press('Alt+KeyA');
 await panel.getByRole('radio', {name: 'Background', exact: true}).click();
 await expect(panel.getByRole('combobox', {name: 'Size', exact: true}).locator('option:checked')).toHaveText('16:9 · 688×384');
 await expect(panel.getByRole('checkbox', {name: 'Remove background', exact: true})).toHaveCount(0);
 await expect(panel.getByTestId('purpose-template')).toContainText('game background');
 await mkdir(join(root, 'outputs'), {recursive: true});
 await panel.screenshot({path: join(root, 'outputs/comfy-generate-panel.png')});
 await panel.getByRole('combobox', {name: 'Size', exact: true}).selectOption({label: '9:16 · 384×688'});
 await panel.getByRole('combobox', {name: 'Size', exact: true}).selectOption({label: 'Custom…'});
 await expect(panel.getByRole('combobox', {name: 'Width', exact: true})).toHaveValue('384');
 await panel.getByRole('radio', {name: 'Sprite', exact: true}).click();
 await expect(panel.getByRole('combobox', {name: 'Width', exact: true})).toHaveCount(0);
 await page.keyboard.press('Escape');
 console.log('PASS ComfyUI status, models and Image → Sprite into the Library (hints, background removal, one undo step, history saved); Background changes sizes and options; it waits in Generated until Send to Library');

 // Place the result, then image-to-image from that sprite and apply the new image to it.
 await page.keyboard.press('Alt+KeyA');
 await panel.getByRole('button', {name: `Place ${asset.name}`, exact: true}).click();
 await panel.getByRole('radio', {name: 'Edit selected', exact: true}).click();
 await expect(panel.getByRole('combobox', {name: 'Workflow', exact: true}).locator('option:checked')).toHaveText('Image to image (selected sprite)');
 await expect(panel.getByRole('slider', {name: 'Change amount', exact: true})).toHaveValue('0.6');
 await expect(panel.getByTestId('generate-input-image')).toContainText(asset.name);
 await panel.getByRole('textbox', {name: 'Prompt', exact: true}).fill('make it red');
 await panel.getByRole('button', {name: 'Generate', exact: true}).click();
 await expect(panel.getByRole('listitem')).toHaveCount(2, {timeout: 30000});
 const second = fake.prompts[1].prompt;
 expect(fake.uploads.length).toBe(1); expect(fake.uploads[0]).toBeGreaterThan(60);
 expect(second['8'].inputs.image).toBe('uploaded-input.png');
 expect(second['5'].inputs.denoise).toBe(0.6);
 const redName = await panel.getByRole('listitem').first().locator('small').innerText();
 await panel.getByRole('button', {name: `Use on selected sprite ${redName}`, exact: true}).click();
 await page.keyboard.press('Escape');
 saved = JSON.parse(await (async () => { await choose(file); await menu('Save'); await expect(page.getByLabel('Unsaved changes', {exact: true})).toHaveCount(0); return readFile(file, 'utf8'); })());
 const red = saved.extensions['assets.registry'].items.find(a => a.name === redName), placed = saved.scenes[0].entities.find(e => e.components.some(c => c.type === 'pixi.sprite'));
 expect(placed.components.find(c => c.type === 'pixi.sprite').data.assetId).toBe(red.id);
 console.log('PASS place a generated image; image-to-image uploads the selected sprite and the result can replace its texture');

 // Text to audio (Stable Audio 3): audio model, text encoder and duration; the MP3 lands in the Library as a clip.
 await page.keyboard.press('Alt+KeyA');
 await panel.getByRole('tab', {name: 'Audio', exact: true}).click();
 await expect(panel.getByRole('radio', {name: 'Sound effect', exact: true})).toHaveAttribute('aria-checked', 'true');
 await expect(panel.getByRole('combobox', {name: 'Workflow', exact: true}).locator('option:checked')).toHaveText('Text to audio (Stable Audio 3)');
 await expect(panel.getByRole('spinbutton', {name: 'Duration (s)', exact: true})).toHaveValue('2');
 await panel.getByRole('radio', {name: 'Music', exact: true}).click();
 await expect(panel.getByRole('spinbutton', {name: 'Duration (s)', exact: true})).toHaveValue('30');
 await panel.getByRole('radio', {name: 'Song', exact: true}).click();
 await expect(panel.getByTestId('animation-workflow-hint')).toContainText('ACE-Step');
 await expect(panel.getByRole('button', {name: 'Generate', exact: true})).toBeDisabled();
 await panel.getByRole('radio', {name: 'Sound effect', exact: true}).click();
 await expect(panel.getByRole('combobox', {name: 'Model', exact: true})).toHaveValue('stable_audio_3_medium.safetensors');
 await expect(panel.getByRole('combobox', {name: 'Text encoder', exact: true})).toHaveValue('t5gemma_b_b_ul2.safetensors');
 await expect(panel.getByRole('combobox', {name: 'Width', exact: true})).toHaveCount(0);
 await panel.getByRole('spinbutton', {name: 'Duration (s)', exact: true}).fill('6');
 await panel.getByRole('textbox', {name: 'Prompt', exact: true}).fill('coin pickup chime');
 await panel.getByRole('button', {name: 'Generate', exact: true}).click();
 await expect(panel.locator('[data-kind="audio"]')).toHaveCount(1, {timeout: 30000});
 const sound = fake.prompts.at(-1).prompt;
 expect(sound['8'].class_type).toBe('SaveAudioMP3'); expect(sound['5'].inputs.seconds).toBe(6); expect(sound['6'].inputs).toMatchObject({steps: 8, cfg: 1, sampler_name: 'lcm'});
 expect(sound['2'].inputs.clip_name).toBe('t5gemma_b_b_ul2.safetensors'); expect(sound['1'].inputs.ckpt_name).toBe('stable_audio_3_medium.safetensors');
 const soundName = await panel.locator('[data-kind="audio"] small').first().innerText();
 await panel.getByRole('button', {name: `Place ${soundName}`, exact: true}).click();
 await page.keyboard.press('Escape');
 saved = JSON.parse(await (async () => { await choose(file); await menu('Save'); await expect(page.getByLabel('Unsaved changes', {exact: true})).toHaveCount(0); return readFile(file, 'utf8'); })());
 const clip = saved.extensions['assets.registry'].items.find(a => a.name === soundName);
 expect(clip.type).toBe('audio.clip');
 expect(saved.scenes[0].entities.some(e => e.components.some(c => c.type === 'audio.source' && c.data.assetId === clip.id))).toBe(true);
 expect(saved.extensions['ai-comfy.generations'].items.at(-1)).toMatchObject({kind: 'audio', seconds: 6, prompt: 'coin pickup chime, short game sound effect, clean, no music', assetId: clip.id, purpose: 'sfx'});
 console.log('PASS Audio → Sound effect: Stable Audio model, text encoder and duration (Music and Song change the duration and workflow needs); the MP3 is imported as a clip and placed as a Sound');

 // Cancel a job that never finishes.
 await page.keyboard.press('Alt+KeyA');
 await panel.getByRole('tab', {name: 'Image', exact: true}).click();
 await expect(panel.getByRole('radio', {name: 'Edit selected', exact: true})).toHaveAttribute('aria-checked', 'true');
 await panel.getByRole('radio', {name: 'Sprite', exact: true}).click();
 await expect(panel.getByRole('combobox', {name: 'Workflow', exact: true}).locator('option:checked')).toHaveText('Text to image');
 await panel.getByRole('textbox', {name: 'Prompt', exact: true}).fill('slow');
 await panel.getByRole('button', {name: 'Generate', exact: true}).click();
 await expect(panel.getByTestId('jobs-summary')).toContainText('1 running');
 await panel.getByTestId('jobs-summary').getByRole('button', {name: 'Jobs', exact: true}).click();
 const jobsPanel = page.getByTestId('jobs-panel'), slowJob = jobsPanel.locator('[data-job]').first();
 await expect(slowJob).toHaveAttribute('data-state', 'running');
 await slowJob.getByRole('button', {name: /^Cancel /}).click();
 await expect(slowJob).toHaveAttribute('data-state', 'cancelled');
 expect(fake.interrupts).toBeGreaterThan(0);
 await expect(jobsPanel.locator('[data-job][data-state="imported"]')).toHaveCount(3);
 await page.keyboard.press('Escape');
 console.log('PASS generations are ComfyUI jobs (Jobs panel ⌥Q): finished ones are imported, a running one can be cancelled (interrupt)');

 // Workflow import: a ComfyUI app save is converted (an empty one is refused), API format is detected and used.
 await page.keyboard.press('Alt+KeyA');
 await choose(emptyUi);
 await panel.getByRole('button', {name: 'Import workflow…', exact: true}).click();
 await expect(page.getByRole('alert')).toContainText('Saves no image, sound or video');
 await page.getByRole('button', {name: 'Dismiss message', exact: true}).click();
 if (!await panel.isVisible()) await page.keyboard.press('Alt+KeyA');
 await choose(apiWorkflow);
 await panel.getByRole('button', {name: 'Import workflow…', exact: true}).click();
 await expect(panel.getByRole('combobox', {name: 'Workflow', exact: true})).toHaveValue(/^user\./);
 await expect(panel.getByRole('combobox', {name: 'Model', exact: true})).toHaveCount(0);
 await panel.getByRole('textbox', {name: 'Prompt', exact: true}).fill('flux cat');
 await panel.getByRole('button', {name: 'Generate', exact: true}).click();
 await expect.poll(() => fake.prompts.length, {timeout: 30000}).toBeGreaterThan(4);
 await expect(page.getByTestId('jobs-summary')).toHaveCount(0, {timeout: 30000});
 const third = fake.prompts.at(-1).prompt;
 expect(third['1'].inputs.text).toBe(spriteHint('flux cat')); expect(third['3'].inputs.width).toBe(1024); expect(typeof third['2'].inputs.noise_seed).toBe('number');
 await choose(uiWorkflow);
 await panel.getByRole('button', {name: 'Import workflow…', exact: true}).click();
 await expect(panel.getByRole('combobox', {name: 'Workflow', exact: true})).toHaveValue(/^user\./);
 await expect(panel.getByRole('combobox', {name: 'Workflow', exact: true}).locator('option:checked')).toHaveText('ui');
 await expect(panel.locator('input[aria-label="Steps"]')).toHaveValue('30');
 await expect(panel.getByRole('combobox', {name: 'Width', exact: true})).toHaveValue('768');
 console.log('PASS API-format workflows and ComfyUI app saves (converted through the server) import with detected slots; empty saves are refused');

 // From ComfyUI: saved workflows and templates are listed and checked; a ready one is converted and used as authored.
 await panel.getByRole('button', {name: 'From ComfyUI…', exact: true}).click();
 const browser = panel.getByTestId('comfy-library');
 await expect(browser).toHaveAttribute('data-loading', 'false');
 await expect(browser.getByRole('status')).toHaveText('1 ready on this computer · 3 need setup');
 await expect(browser.locator('[data-ready="true"]')).toHaveCount(1);
 await expect(browser.getByText('OpenAI Image (API)')).toHaveCount(0);
 await browser.getByText('Need setup in ComfyUI (3)').click();
 await expect(browser.locator('[data-ref="video_wan"]')).toContainText('404');
 await expect(browser.locator('[data-ref="image_flux_dev"]')).toContainText('Missing model: flux1-dev.safetensors');
 await expect(browser.locator('[data-ref="image_flux_pro_node"]')).toContainText('Paid API nodes: Flux Pro (API)');
 await expect(browser.locator('[data-ref="image_flux_dev"]').getByRole('button')).toBeDisabled();
 await browser.getByRole('searchbox', {name: 'Search workflows and templates', exact: true}).fill('knight');
 await expect(browser.locator('[data-ready]')).toHaveCount(1);
 await browser.getByRole('button', {name: 'pixel knight', exact: true}).click();
 await expect(browser).toHaveCount(0);
 await expect(panel.getByRole('combobox', {name: 'Workflow', exact: true})).toHaveValue('comfy.user:pixel_knight.json');
 await expect(panel.getByRole('combobox', {name: 'Model', exact: true})).toHaveValue('fake-sd15.safetensors');
 await expect(panel.getByRole('textbox', {name: 'Negative prompt', exact: true})).toHaveValue('blurry');
 await panel.getByRole('textbox', {name: 'Prompt', exact: true}).fill('knight with a shield');
 await panel.getByRole('button', {name: 'Generate', exact: true}).click();
 await expect(page.getByTestId('jobs-summary')).toHaveCount(0, {timeout: 30000});
 const knight = Object.values(fake.prompts.at(-1).prompt);
 expect(knight.find(n => n.class_type === 'KSampler').inputs).toMatchObject({steps: 30, cfg: 5.5, sampler_name: 'euler', positive: [expect.any(String), 0]});
 expect(knight.find(n => n.class_type === 'EmptyLatentImage').inputs).toMatchObject({width: 768, height: 512});
 expect(knight.filter(n => n.class_type === 'CLIPTextEncode').map(n => n.inputs.text)).toEqual([spriteHint('knight with a shield'), 'blurry']);
 expect(knight.filter(n => n.class_type === 'SaveImage')).toHaveLength(1);
 console.log('PASS From ComfyUI lists saved workflows and image/audio templates, marks what needs setup (models, paid nodes) and runs a converted one as authored');

 // Animation mode (each animation is one ComfyUI job): sprite sheet (sliced, a frame left out, packed and placed),
 // frame-by-frame edits chained in one graph with background removal, and a video workflow whose frames
 // (latent length = frame count) become the animation.
 await page.keyboard.press('Escape');
 await page.keyboard.press('Alt+KeyA');
 await panel.getByRole('radio', {name: 'Sprite sheet', exact: true}).click();
 await panel.getByRole('combobox', {name: 'Workflow', exact: true}).selectOption({label: 'Text to image'});
 await panel.getByRole('checkbox', {name: 'Remove background', exact: true}).uncheck();
 await panel.getByRole('textbox', {name: 'Prompt', exact: true}).fill('red gem');
 await panel.getByRole('textbox', {name: 'Motion', exact: true}).fill('spin');
 await panel.getByRole('spinbutton', {name: 'Frames', exact: true}).fill('4');
 await panel.getByRole('spinbutton', {name: 'Columns', exact: true}).fill('2');
 await panel.getByRole('spinbutton', {name: 'FPS', exact: true}).fill('6');
 await panel.getByRole('button', {name: 'Generate frames', exact: true}).click();
 expect(Object.values(fake.prompts.at(-1).prompt).find(n => n.class_type === 'CLIPTextEncode').inputs.text).toContain('sprite sheet of 4 animation frames of a spin, arranged in a 2x2 grid');
 await expect(panel.getByTestId('jobs-summary')).toContainText('1 ready', {timeout: 30000});
 await page.keyboard.press('Alt+KeyQ');
 const jobs = page.getByTestId('jobs-panel'), sheetJob = jobs.locator('[data-job][data-kind="animation"]').first();
 await expect(sheetJob).toHaveAttribute('data-state', 'done');
 await expect(sheetJob).toContainText('Ready: review the frames');
 await sheetJob.getByRole('button', {name: /^Review frames /}).click();
 const strip = panel.getByRole('list', {name: 'Frames', exact: true});
 await expect(strip.getByRole('listitem')).toHaveCount(4, {timeout: 30000});
 await expect(panel.getByTestId('frame-preview')).toBeVisible();
 await strip.getByRole('checkbox', {name: 'Use frame 4', exact: true}).uncheck();
 await panel.getByRole('button', {name: 'Create animation', exact: true}).click();
 await expect(panel.locator('[data-kind="animation"]')).toHaveCount(1, {timeout: 30000});
 await page.keyboard.press('Escape');
 saved = JSON.parse(await (async () => { await choose(file); await menu('Save'); await expect(page.getByLabel('Unsaved changes', {exact: true})).toHaveCount(0); return readFile(file, 'utf8'); })());
 const sheetGen = saved.extensions['ai-comfy.generations'].items.at(-1), flip = saved.scenes[0].entities.flatMap(e => e.components).filter(c => c.type === 'pixi.flipbook').at(-1);
 expect(sheetGen).toMatchObject({kind: 'animation', frames: 3, fps: 6, method: 'sheet', width: 64, height: 64});
 expect(flip.data).toMatchObject({assetId: sheetGen.assetId, columns: 2, rows: 2, frames: 3, fps: 6, loop: true, autoplay: true, width: 64, height: 64});
 expect(saved.extensions['assets.registry'].items.find(a => a.id === sheetGen.assetId).metadata).toMatchObject({width: 128, height: 128});
 console.log('PASS Animation (sprite sheet) as a job: reviewed from the Jobs panel, a frame left out, packed into a sheet and placed as an Animated sprite');

 await page.keyboard.press('Alt+KeyA');
 await panel.getByRole('radio', {name: 'Frame by frame', exact: true}).click();
 await expect(panel.getByRole('combobox', {name: 'Workflow', exact: true}).locator('option:checked')).toHaveText('Image to image (selected sprite)');
 await panel.getByRole('spinbutton', {name: 'Frames', exact: true}).fill('3');
 await panel.getByRole('checkbox', {name: 'Remove background', exact: true}).check();
 const before = fake.prompts.length;
 await panel.getByRole('button', {name: 'Generate frames', exact: true}).click();
 await expect.poll(() => fake.prompts.length).toBe(before + 1);
 const chain = fake.prompts.at(-1).prompt;
 // One SaveImage per frame; each frame's image input is the previous frame's picture (before its cut-out).
 const frameSavers = Object.keys(chain).filter(id => chain[id].class_type === 'SaveImage').sort();
 expect(frameSavers.map(id => id.slice(0, 5))).toEqual(['f000:', 'f001:', 'f002:']);
 expect(chain['f001:9'].inputs.pixels).toEqual(chain[`${frameSavers[0]}:mask`].inputs.image);
 expect(chain['f002:9'].inputs.pixels).toEqual(chain[`${frameSavers[1]}:mask`].inputs.image);
 expect(Object.values(chain).filter(n => n.class_type === 'JoinImageWithAlpha')).toHaveLength(3);
 expect(Object.values(chain).find(n => n.class_type === 'CLIPTextEncode' && n.inputs.text.includes('frame 3 of 3'))).toBeTruthy();
 await page.keyboard.press('Alt+KeyQ');
 const editJob = jobs.locator('[data-job][data-kind="animation"]').first();
 await expect(editJob).toHaveAttribute('data-state', 'done', {timeout: 30000});
 await editJob.getByRole('button', {name: /^Create animation /}).click();
 await expect(editJob).toHaveAttribute('data-state', 'imported', {timeout: 30000});
 await expect(editJob.getByRole('button', {name: /^Place /})).toBeVisible();
 await page.keyboard.press('Escape');
 console.log('PASS Animation (frame by frame) as one graph: first frame from text-to-image, each frame wired to the previous one, BiRefNet cut-outs; created straight from the Jobs panel');

 const videoWorkflow = join(temp, 'wan-i2v.json');
 await writeFile(videoWorkflow, JSON.stringify({'1': {class_type: 'CLIPTextEncode', inputs: {text: 'a cat', clip: ['9', 0]}}, '2': {class_type: 'LoadImage', inputs: {image: 'x.png'}}, '3': {class_type: 'WanImageToVideo', inputs: {positive: ['1', 0], width: 480, height: 480, length: 33, batch_size: 1, start_image: ['2', 0]}}, '4': {class_type: 'KSampler', inputs: {seed: 1, steps: 20, cfg: 5, sampler_name: 'euler', scheduler: 'normal', denoise: 1, positive: ['3', 0], negative: ['1', 0], latent_image: ['3', 2], model: ['9', 0]}}, '5': {class_type: 'VAEDecode', inputs: {samples: ['4', 0], vae: ['9', 2]}}, '6': {class_type: 'CreateVideo', inputs: {images: ['5', 0], fps: 16}}, '7': {class_type: 'SaveVideo', inputs: {video: ['6', 0], filename_prefix: 'video/wan', format: 'auto', codec: 'auto'}}}));
 await page.keyboard.press('Alt+KeyA');
 await panel.getByRole('tab', {name: 'Video', exact: true}).click();
 await expect(panel.getByRole('radio', {name: 'Animated sprite', exact: true})).toHaveAttribute('aria-checked', 'true');
 await expect(panel.getByRole('combobox', {name: 'Workflow', exact: true})).toHaveCount(0);
 await expect(panel.getByTestId('animation-workflow-hint')).toContainText('video workflow');
 await choose(videoWorkflow);
 await panel.getByRole('button', {name: 'Import workflow…', exact: true}).click();
 await expect(panel.getByRole('combobox', {name: 'Workflow', exact: true}).locator('option:checked')).toHaveText('wan-i2v');
 await expect(panel.getByTestId('animation-workflow-hint')).toHaveCount(0);
 await panel.getByRole('spinbutton', {name: 'Frames', exact: true}).fill('5');
 await panel.getByRole('checkbox', {name: 'Remove background', exact: true}).uncheck();
 await panel.getByRole('button', {name: 'Generate frames', exact: true}).click();
 await expect.poll(() => fake.prompts.length).toBe(before + 2);
 const video = fake.prompts.at(-1).prompt;
 expect(video['t:3'].inputs.length).toBe(5);
 expect(video['t:3'].inputs.start_image[0]).toMatch(/^s:/);
 expect(Object.values(video).filter(n => n.class_type === 'SaveVideo')).toHaveLength(0);
 expect(Object.values(video).filter(n => n.class_type === 'SaveImage')).toHaveLength(1);
 await page.keyboard.press('Alt+KeyQ');
 const videoJob = jobs.locator('[data-job][data-kind="animation"]').first();
 await expect(videoJob).toHaveAttribute('data-state', 'done', {timeout: 30000});
 await videoJob.getByRole('button', {name: /^Review frames /}).click();
 await expect(strip.getByRole('listitem')).toHaveCount(5, {timeout: 30000});
 await panel.getByRole('button', {name: 'Create animation', exact: true}).click();
 await expect(panel.locator('[data-kind="animation"]')).toHaveCount(3, {timeout: 30000});
 await panel.getByRole('radio', {name: 'Animate selected', exact: true}).click();
 await expect(panel.getByRole('combobox', {name: 'Workflow', exact: true}).locator('option:checked')).toHaveText('wan-i2v');
 await expect(panel.getByRole('checkbox', {name: 'Start from the selected sprite', exact: true})).toHaveCount(0);
 await panel.getByRole('tab', {name: 'Image', exact: true}).click();
 await expect(panel.getByRole('radio', {name: 'Frame by frame', exact: true})).toHaveAttribute('aria-checked', 'true');
 await panel.getByRole('radio', {name: 'Sprite', exact: true}).click();
 await page.keyboard.press('Escape');
 console.log('PASS Animation (video): the first frame and the image-to-video run in one graph (frames = latent length); SaveVideo → SaveImage frames become an animation');

 // LoRAs and a project skill with a generation preset (prompt template, LoRA, size).
 await page.keyboard.press('Alt+KeyK');
 const skillsPanel = page.getByTestId('skills-panel');
 await skillsPanel.getByRole('button', {name: 'New skill', exact: true}).click();
 const skillEditor = skillsPanel.getByTestId('skill-editor');
 await skillEditor.getByRole('textbox', {name: 'Name', exact: true}).fill('Slime sprite');
 await skillEditor.getByRole('textbox', {name: 'Description', exact: true}).fill('Slime characters in our style');
 await skillEditor.getByRole('textbox', {name: 'Instructions', exact: true}).fill('Round body, two eyes, glossy.');
 await skillEditor.locator('summary').click();
 await skillEditor.getByRole('combobox', {name: 'For', exact: true}).selectOption('image');
 await skillEditor.getByRole('textbox', {name: 'Prompt template', exact: true}).fill('pixel art of {prompt}, glossy slime');
 await skillEditor.getByRole('button', {name: 'Add LoRA…', exact: true}).click();
 await skillEditor.getByLabel('LoRA 1', {exact: true}).fill('pixel-style.safetensors');
 await skillEditor.getByLabel('Strength 1', {exact: true}).fill('0.6');
 await skillEditor.getByRole('spinbutton', {name: 'Width', exact: true}).fill('640');
 await skillEditor.getByRole('button', {name: 'Save skill', exact: true}).click();
 await expect(skillsPanel.locator('[data-skill="Slime sprite"]')).toContainText('Image preset');
 await page.keyboard.press('Escape');
 await page.keyboard.press('Alt+KeyA');
 await panel.getByRole('combobox', {name: 'Workflow', exact: true}).selectOption({label: 'Text to image'});
 await panel.getByRole('combobox', {name: 'Skill', exact: true}).selectOption({label: 'Slime sprite'});
 await expect(panel.getByRole('combobox', {name: 'Width', exact: true})).toHaveValue('640');
 await expect(panel.getByTestId('generate-loras').locator('[data-lora="pixel-style.safetensors"]')).toBeVisible();
 await expect(panel.getByTestId('skill-template')).toContainText('pixel art of {prompt}, glossy slime');
 await panel.getByRole('combobox', {name: 'Add LoRA…', exact: true}).selectOption('outline.safetensors');
 await panel.getByRole('spinbutton', {name: 'Strength outline.safetensors', exact: true}).fill('0.4');
 await panel.getByRole('textbox', {name: 'Prompt', exact: true}).fill('green slime');
 const beforeLora = fake.prompts.length;
 await panel.getByRole('button', {name: 'Generate', exact: true}).click();
 await expect.poll(() => fake.prompts.length).toBe(beforeLora + 1);
 const loraGraph = fake.prompts.at(-1).prompt;
 await panel.getByRole('combobox', {name: 'Skill', exact: true}).selectOption({label: 'None'});
 expect(loraGraph['lora:0']).toEqual({class_type: 'LoraLoader', inputs: {model: ['1', 0], clip: ['1', 1], lora_name: 'pixel-style.safetensors', strength_model: 0.6, strength_clip: 0.6}});
 expect(loraGraph['lora:1'].inputs).toMatchObject({model: ['lora:0', 0], clip: ['lora:0', 1], lora_name: 'outline.safetensors', strength_model: 0.4});
 expect(loraGraph['5'].inputs.model).toEqual(['lora:1', 0]); expect(loraGraph['2'].inputs.clip).toEqual(['lora:1', 1]);
 expect(loraGraph['2'].inputs.text).toBe('pixel art of green slime, glossy slime'); expect(loraGraph['4'].inputs.width).toBe(640);
 await page.keyboard.press('Alt+KeyQ');
 await expect(page.getByTestId('jobs-panel').locator('[data-job]').filter({hasText: /^green-slime/}).first()).toHaveAttribute('data-state', 'imported', {timeout: 30000});
 await page.keyboard.press('Escape');
 saved = JSON.parse(await (async () => { await choose(file); await menu('Save'); await expect(page.getByLabel('Unsaved changes', {exact: true})).toHaveCount(0); return readFile(file, 'utf8'); })());
 expect(saved.extensions['ai-comfy.generations'].items.at(-1)).toMatchObject({prompt: 'pixel art of green slime, glossy slime', skill: 'Slime sprite', loras: [{name: 'pixel-style.safetensors', strength: 0.6}, {name: 'outline.safetensors', strength: 0.4}]});
 expect(saved.extensions['ai.skills'].items[0]).toMatchObject({name: 'Slime sprite', generate: {kind: 'image', prompt: 'pixel art of {prompt}, glossy slime', loras: [{name: 'pixel-style.safetensors', strength: 0.6}], width: 640}});
 console.log('PASS LoRAs chain after the model loader (strengths, order); a project skill preset fills the panel and wraps the prompt; history records LoRAs and skill');

 // Jobs outlive the editor: queue one, close the editor, reopen the project, and it is imported when it finishes.
 await page.keyboard.press('Alt+KeyA');
 await panel.getByRole('combobox', {name: 'Workflow', exact: true}).selectOption({label: 'Text to image'});
 await panel.getByRole('textbox', {name: 'Prompt', exact: true}).fill('later dragon');
 fake.hold = true;
 await panel.getByRole('button', {name: 'Generate', exact: true}).click();
 await expect(panel.getByTestId('jobs-summary')).toContainText('1 running');
 await page.keyboard.press('Escape');
 await choose(file); await menu('Save'); await expect(page.getByLabel('Unsaved changes', {exact: true})).toHaveCount(0);
 await app.evaluate(({BrowserWindow}) => { for (const w of BrowserWindow.getAllWindows()) w.destroy(); }).catch(() => {});
 await app.close().catch(() => {});
 app = await electron.launch({executablePath: process.env.REWRITE_EXECUTABLE || require('electron'), args: [...(process.env.REWRITE_EXECUTABLE ? [] : [join(root, 'apps/editor-desktop/out/main/index.js')]), '--no-hub', `--user-data-dir=${join(temp, 'user')}`], env});
 page = await app.firstWindow();
 page.setDefaultTimeout(15000);
 page.on('pageerror', e => errors.push(e.message));
 await expect(page.getByTestId('pixi-canvas')).toHaveAttribute('data-ready', 'true', {timeout: 30000});
 panel = page.getByTestId('generate-panel');
 await page.getByRole('dialog', {name: 'Welcome back'}).getByRole('button', {name: /^Reopen last project/}).click();
 await expect(page.getByRole('dialog', {name: 'Welcome back'})).toHaveCount(0);
 await page.keyboard.press('Alt+KeyQ');
 const later = page.getByTestId('jobs-panel').locator('[data-job]').filter({hasText: 'later-dragon'});
 await expect(later).toHaveAttribute('data-state', 'running', {timeout: 30000});
 fake.hold = false;
 await expect(later).toHaveAttribute('data-state', 'imported', {timeout: 30000});
 await page.keyboard.press('Escape');
 saved = JSON.parse(await (async () => { await choose(file); await menu('Save'); await expect(page.getByLabel('Unsaved changes', {exact: true})).toHaveCount(0); return readFile(file, 'utf8'); })());
 expect(saved.extensions['ai-comfy.generations'].items.at(-1)).toMatchObject({prompt: spriteHint('later dragon'), kind: 'image'});
 console.log('PASS jobs outlive the editor: queued, editor closed and reopened, the finished job is imported into the project');

 // Offline: an address with nothing listening.
 await page.keyboard.press('Escape');
 await setAddress('http://127.0.0.1:9');
 await page.keyboard.press('Alt+KeyA');
 await panel.getByRole('button', {name: 'Retry', exact: true}).click();
 await expect(panel).toHaveAttribute('data-online', 'false');
 await expect(panel.getByRole('button', {name: 'Generate', exact: true})).toBeDisabled();
 await setAddress('http://192.168.1.50:8188').catch(() => {});
 expect(errors).toEqual([]);
 await mkdir(join(root, 'outputs'), {recursive: true});
 await page.screenshot({path: join(root, 'outputs/editor-comfy.png')});
 console.log('PASS offline ComfyUI is reported and blocks Generate');
} catch (error) {
 await mkdir(join(root, 'outputs'), {recursive: true});
 const page = app ? await app.firstWindow().catch(() => null) : null;
 await page?.screenshot({path: join(root, 'outputs/comfy-failure.png')}).catch(() => {});
 throw error;
} finally {
 if (server) await new Promise(r => server.close(r));
 if (app) {
  await app.evaluate(({BrowserWindow}) => { for (const w of BrowserWindow.getAllWindows()) w.destroy(); }).catch(() => {});
  await app.close().catch(() => {});
 }
 await rm(temp, {recursive: true, force: true, maxRetries: 3});
}
