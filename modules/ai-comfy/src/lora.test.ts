import {expect, it} from 'vitest';
import {applyInputs, applyLoras, applyTemplate, textToAudio, textToImage, workflowNeeds, type Workflow} from './contracts';

const inputs = {prompt: 'slime', negative: '', seed: 1, steps: 10, cfg: 5, width: 512, height: 512, batch: 1, denoise: 1, model: 'sd15.safetensors'};

it('chains LoRA loaders after a checkpoint: model and text encoder consumers read the end of the chain', () => {
 const w = applyInputs(textToImage(), {...inputs, loras: [{name: 'pixel.safetensors', strength: 0.8}, {name: 'outline.safetensors', strength: 0.5}]});
 expect(w['lora:0']).toEqual({class_type: 'LoraLoader', inputs: {model: ['1', 0], clip: ['1', 1], lora_name: 'pixel.safetensors', strength_model: 0.8, strength_clip: 0.8}});
 expect(w['lora:1'].inputs).toMatchObject({model: ['lora:0', 0], clip: ['lora:0', 1], lora_name: 'outline.safetensors'});
 expect(w['5'].inputs.model).toEqual(['lora:1', 0]);
 expect(w['2'].inputs.clip).toEqual(['lora:1', 1]); expect(w['3'].inputs.clip).toEqual(['lora:1', 1]);
 expect(w['6'].inputs.vae).toEqual(['1', 2]);
});
it('uses model-only LoRA loaders for diffusion model workflows and leaves audio and loader-less graphs alone', () => {
 const flux: Workflow = {u: {class_type: 'UNETLoader', inputs: {unet_name: 'klein.safetensors'}}, s: {class_type: 'KSampler', inputs: {model: ['u', 0], seed: 0}}};
 const w = applyLoras(flux, [{name: 'style.safetensors', strength: 1}]);
 expect(w['lora:0']).toEqual({class_type: 'LoraLoaderModelOnly', inputs: {model: ['u', 0], lora_name: 'style.safetensors', strength_model: 1}});
 expect(w.s.inputs.model).toEqual(['lora:0', 0]);
 expect(Object.keys(applyInputs(textToAudio(), {...inputs, loras: [{name: 'x', strength: 1}]})).some(id => id.startsWith('lora:'))).toBe(false);
 expect(applyLoras({a: {class_type: 'LoadImage', inputs: {image: 'x'}}}, [{name: 'x', strength: 1}])).toEqual({a: {class_type: 'LoadImage', inputs: {image: 'x'}}});
 expect(workflowNeeds(textToImage()).loras).toBe(true); expect(workflowNeeds(textToAudio()).loras).toBe(false);
});
it('fills a prompt template, or appends it', () => {
 expect(applyTemplate('pixel art of {prompt}, limited palette', 'a red slime')).toBe('pixel art of a red slime, limited palette');
 expect(applyTemplate('flat icon', 'coin')).toBe('coin, flat icon');
 expect(applyTemplate('', ' coin ')).toBe('coin');
 expect(applyTemplate('{prompt}, chiptune', '')).toBe('chiptune');
});
