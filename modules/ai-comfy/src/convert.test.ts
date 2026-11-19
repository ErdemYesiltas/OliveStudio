import {expect, it} from 'vitest';
import {dynamicPrompt, isUiWorkflow, uiToApi, type ObjectInfo} from './convert';
import {analyzeWorkflow, applyInputs, workflowDefaults} from './contracts';

// Trimmed /object_info entries with the shapes real ComfyUI servers report.
const info: ObjectInfo = {
 CheckpointLoaderSimple: {input: {required: {ckpt_name: [['sd_xl_base_1.0.safetensors', 'other.ckpt']]}}},
 CLIPTextEncode: {input: {required: {text: ['STRING', {multiline: true, dynamicPrompts: true}], clip: ['CLIP', {}]}}},
 EmptyLatentImage: {input: {required: {width: ['INT', {default: 512}], height: ['INT', {default: 512}], batch_size: ['INT', {default: 1}]}}},
 KSampler: {input: {required: {model: ['MODEL', {}], seed: ['INT', {control_after_generate: true}], steps: ['INT', {default: 20}], cfg: ['FLOAT', {default: 8}], sampler_name: [['euler', 'lcm']], scheduler: [['normal', 'simple']], positive: ['CONDITIONING', {}], negative: ['CONDITIONING', {}], latent_image: ['LATENT', {}], denoise: ['FLOAT', {default: 1}]}}, input_order: {required: ['model', 'seed', 'steps', 'cfg', 'sampler_name', 'scheduler', 'positive', 'negative', 'latent_image', 'denoise']}},
 VAEDecode: {input: {required: {samples: ['LATENT', {}], vae: ['VAE', {}]}}},
 ImageScaleBy: {input: {required: {image: ['IMAGE', {}], upscale_method: [['nearest-exact', 'bilinear']], scale_by: ['FLOAT', {default: 1}]}}},
 SaveImage: {input: {required: {images: ['IMAGE', {}], filename_prefix: ['STRING', {default: 'ComfyUI'}]}}, output_node: true},
 SaveAudioAdvanced: {input: {required: {audio: ['AUDIO', {}], filename_prefix: ['STRING', {default: 'audio/ComfyUI'}], format: ['COMFY_DYNAMICCOMBO_V3', {options: [{key: 'flac', inputs: {required: {}}}, {key: 'mp3', inputs: {required: {quality: ['COMBO', {options: ['V0', '128k']}]}}}]}]}}},
 PrimitiveInt: {input: {required: {value: ['INT', {control_after_generate: 'fixed'}]}}},
 FluxProNode: {input: {required: {prompt: ['STRING', {}]}}, display_name: 'Flux Pro (API)', api_node: true},
};

/** A saved SDXL-style graph: a subgraph for the sampler with promoted seed/steps, plus every UI-only construct. */
const ui = {
 nodes: [
  {id: 1, type: 'CheckpointLoaderSimple', widgets_values: ['SD_XL_BASE_1.0.safetensors'], outputs: [{type: 'MODEL'}, {type: 'CLIP'}, {type: 'VAE'}]},
  {id: 2, type: 'CLIPTextEncode', widgets_values: ['a {red|blue} slime // note'], inputs: [{name: 'clip', type: 'CLIP', link: 1}]},
  {id: 3, type: 'CLIPTextEncode', widgets_values: ['blurry'], inputs: [{name: 'clip', type: 'CLIP', link: 2}]},
  {id: 4, type: 'EmptyLatentImage', widgets_values: [512, 512, 1], inputs: [{name: 'width', type: 'INT', link: 3, widget: {name: 'width'}}]},
  {id: 5, type: 'PrimitiveNode', widgets_values: [768, 'fixed'], outputs: [{type: 'INT', links: [3]}]},
  {id: 6, type: 'sub-sampler', widgets_values: [42, 12], inputs: [{name: 'model', type: 'MODEL', link: 4}, {name: 'positive', type: 'CONDITIONING', link: 5}, {name: 'negative', type: 'CONDITIONING', link: 6}, {name: 'latent', type: 'LATENT', link: 7}, {name: 'seed', type: 'INT', link: null, widget: {name: 'seed'}}, {name: 'steps', type: 'INT', link: null, widget: {name: 'steps'}}], outputs: [{type: 'LATENT', links: [8]}]},
  {id: 7, type: 'Reroute', inputs: [{name: '', type: '*', link: 8}], outputs: [{type: 'LATENT', links: [9]}]},
  {id: 8, type: 'VAEDecode', inputs: [{name: 'samples', type: 'LATENT', link: 9}, {name: 'vae', type: 'VAE', link: 10}], outputs: [{type: 'IMAGE', links: [11]}]},
  {id: 9, type: 'ImageScaleBy', mode: 4, widgets_values: ['bilinear', 2], inputs: [{name: 'image', type: 'IMAGE', link: 11}], outputs: [{type: 'IMAGE', links: [12]}]},
  {id: 10, type: 'SaveImage', widgets_values: ['out'], inputs: [{name: 'images', type: 'IMAGE', link: 12}]},
  {id: 11, type: 'SaveImage', mode: 2, widgets_values: ['muted'], inputs: [{name: 'images', type: 'IMAGE', link: null}]},
  {id: 12, type: 'MarkdownNote', widgets_values: ['# read me']},
 ],
 links: [[1, 1, 1, 2, 0, 'CLIP'], [2, 1, 1, 3, 0, 'CLIP'], [3, 5, 0, 4, 0, 'INT'], [4, 1, 0, 6, 0, 'MODEL'], [5, 2, 0, 6, 1, 'CONDITIONING'], [6, 3, 0, 6, 2, 'CONDITIONING'], [7, 4, 0, 6, 3, 'LATENT'], [8, 6, 0, 7, 0, 'LATENT'], [9, 7, 0, 8, 0, 'LATENT'], [10, 1, 2, 8, 1, 'VAE'], [11, 8, 0, 9, 0, 'IMAGE'], [12, 9, 0, 10, 0, 'IMAGE']],
 definitions: {subgraphs: [{
  id: 'sub-sampler',
  inputs: [{name: 'model', type: 'MODEL', linkIds: [101]}, {name: 'positive', type: 'CONDITIONING', linkIds: [102]}, {name: 'negative', type: 'CONDITIONING', linkIds: [103]}, {name: 'latent', type: 'LATENT', linkIds: [104]}, {name: 'seed', type: 'INT', linkIds: [105]}, {name: 'steps', type: 'INT', linkIds: [106]}],
  outputs: [{name: 'LATENT', type: 'LATENT', linkIds: [107]}],
  nodes: [
   {id: 1, type: 'KSampler', widgets_values: [7, 'randomize', 20, 6.5, 'euler', 'normal', 1], inputs: [{name: 'model', type: 'MODEL', link: 101}, {name: 'positive', type: 'CONDITIONING', link: 102}, {name: 'negative', type: 'CONDITIONING', link: 103}, {name: 'latent_image', type: 'LATENT', link: 104}, {name: 'seed', type: 'INT', link: 105, widget: {name: 'seed'}}, {name: 'steps', type: 'INT', link: 106, widget: {name: 'steps'}}], outputs: [{type: 'LATENT'}]},
  ],
  links: [
   {id: 101, origin_id: -10, origin_slot: 0, target_id: 1, target_slot: 0}, {id: 102, origin_id: -10, origin_slot: 1, target_id: 1, target_slot: 1},
   {id: 103, origin_id: -10, origin_slot: 2, target_id: 1, target_slot: 2}, {id: 104, origin_id: -10, origin_slot: 3, target_id: 1, target_slot: 3},
   {id: 105, origin_id: -10, origin_slot: 4, target_id: 1, target_slot: 4}, {id: 106, origin_id: -10, origin_slot: 5, target_id: 1, target_slot: 5},
   {id: 107, origin_id: 1, origin_slot: 0, target_id: -20, target_slot: 0},
  ],
 }]},
};

it('converts a UI save: subgraph with promoted widgets, primitives, reroutes, bypass, mute, notes, dynamic prompts', () => {
 expect(isUiWorkflow(ui)).toBe(true); expect(isUiWorkflow({'1': {class_type: 'X', inputs: {}}})).toBe(false);
 const {workflow, missingNodes, paidNodes, missingModels} = uiToApi(ui, info, () => 0.9);
 expect(Object.keys(workflow).sort()).toEqual(['1', '10', '2', '3', '4', '6:1', '8']);
 expect(workflow['1'].inputs).toEqual({ckpt_name: 'sd_xl_base_1.0.safetensors'});
 expect(workflow['2'].inputs).toEqual({text: 'a blue slime ', clip: ['1', 1]});
 expect(workflow['4'].inputs).toEqual({width: 768, height: 512, batch_size: 1});
 expect(workflow['6:1']).toMatchObject({class_type: 'KSampler', inputs: {seed: 42, steps: 12, cfg: 6.5, sampler_name: 'euler', scheduler: 'normal', denoise: 1, model: ['1', 0], positive: ['2', 0], negative: ['3', 0], latent_image: ['4', 0]}});
 expect(workflow['8'].inputs).toEqual({samples: ['6:1', 0], vae: ['1', 2]});
 expect(workflow['10'].inputs).toEqual({filename_prefix: 'out', images: ['8', 0]});
 expect([missingNodes, paidNodes, missingModels]).toEqual([[], [], []]);
 // The converted graph drives the panel like a hand-made API workflow.
 expect(workflowDefaults(workflow)).toMatchObject({prompt: 'a blue slime ', negative: 'blurry', steps: 12, cfg: 6.5, width: 768, height: 512, model: 'sd_xl_base_1.0.safetensors'});
 const applied = applyInputs(workflow, {prompt: 'green cube', negative: '', seed: 5, steps: 30, cfg: 4, width: 640, height: 384, batch: 2, denoise: 1, model: 'other.ckpt'});
 expect(applied['6:1'].inputs).toMatchObject({seed: 5, steps: 30, cfg: 4});
 expect(applied['2'].inputs.text).toBe('green cube'); expect(applied['4'].inputs).toMatchObject({width: 640, height: 384, batch_size: 2});
 expect(applied['10'].inputs.filename_prefix).toBe('OliveStudio');
});

it('reports custom nodes the server lacks, paid API nodes and model files that are not installed', () => {
 const report = uiToApi({nodes: [
  {id: 1, type: 'CheckpointLoaderSimple', widgets_values: ['flux-dev.safetensors']},
  {id: 2, type: 'FluxProNode', widgets_values: ['x']},
  {id: 3, type: 'WAS_Image_Blend', widgets_values: [0.5]},
  {id: 4, type: 'Note', widgets_values: ['ignored']},
 ], links: []}, info);
 expect(report.missingNodes).toEqual(['WAS_Image_Blend']);
 expect(report.paidNodes).toEqual(['Flux Pro (API)']);
 expect(report.missingModels).toEqual([{node: 'CheckpointLoaderSimple', input: 'ckpt_name', value: 'flux-dev.safetensors'}]);
 expect(() => uiToApi({nodes: 1}, info)).toThrow('Not a ComfyUI workflow');
});

it('dynamic combos take their sub-inputs from the following widget values; primitives feed promoted sizes', () => {
 const {workflow} = uiToApi({nodes: [
  {id: 1, type: 'SaveAudioAdvanced', widgets_values: ['audio/x', 'mp3', '128k'], inputs: [{name: 'audio', type: 'AUDIO', link: null}]},
  {id: 2, type: 'PrimitiveInt', widgets_values: [1024, 'fixed'], outputs: [{type: 'INT', links: [1]}]},
  {id: 3, type: 'EmptyLatentImage', widgets_values: [512, 512, 1], inputs: [{name: 'width', type: 'INT', link: 1, widget: {name: 'width'}}]},
 ], links: [[1, 2, 0, 3, 0, 'INT']]}, info);
 expect(workflow['1'].inputs).toEqual({filename_prefix: 'audio/x', format: 'mp3', 'format.quality': '128k'});
 expect(workflow['2'].inputs).toEqual({value: 1024});
 expect(workflow['3'].inputs.width).toEqual(['2', 0]);
 const slots = analyzeWorkflow(workflow);
 expect(slots.width).toEqual({id: '2', key: 'value'});
 expect(applyInputs(workflow, {prompt: 'p', negative: '', seed: 1, steps: 1, cfg: 1, width: 640, height: 640, batch: 1, denoise: 1, model: ''})['2'].inputs.value).toBe(640);
});

it('dynamic prompt syntax matches the ComfyUI frontend', () => {
 expect(dynamicPrompt('a {cat|dog} /* hidden */ in {a {big|small} box|space}', () => 0)).toBe('a cat  in a big box');
 expect(dynamicPrompt('literal \\{x\\|y\\} http://example.com', () => 0)).toBe('literal {x|y} http:');
});

it('drops nodes no output needs (an unused LoadImage is not an input)', () => {
 const outInfo: ObjectInfo = {...info, LoadImage: {input: {required: {image: [['a.png', 'b.png'], {image_upload: true}]}}}, ImageScaleBy: info.ImageScaleBy};
 const {workflow} = uiToApi({nodes: [
  {id: 1, type: 'LoadImage', widgets_values: ['a.png', 'image']},
  {id: 2, type: 'LoadImage', widgets_values: ['b.png', 'image']},
  {id: 3, type: 'SaveImage', widgets_values: ['out'], inputs: [{name: 'images', type: 'IMAGE', link: 1}]},
 ], links: [[1, 1, 0, 3, 0, 'IMAGE']]}, outInfo);
 expect(Object.keys(workflow).sort()).toEqual(['1', '3']);
 expect(analyzeWorkflow(workflow).image).toBe('1');
});
