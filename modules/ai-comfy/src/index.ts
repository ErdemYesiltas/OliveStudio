import {z} from 'zod';
import {settings, type EditorModule, type Json} from '@rewrite/sdk';
import {projectSections} from '@rewrite/project';
import {GenerationsSchema, generationsSection} from './contracts';
export * from './contracts';

/** ComfyUI: address setting and the project's generation history (how each generated asset was made). */
export const comfyModule: EditorModule = {
 manifest: {id: 'ai-comfy', version: '1.0.0', apiVersion: 1, requires: {project: '^1', assets: '^1'}},
 activate(c) {
  c.contribute(settings, 'ai-comfy.url', {titleKey: 'setting.comfyUrl', descriptionKey: 'setting.comfyUrlHelp', kind: 'string', default: 'auto'});
  c.contribute(projectSections, 'ai-comfy.generations', {key: generationsSection, get dataSchema(){return z.toJSONSchema(GenerationsSchema,{unrepresentable:'any'});},parse: v => GenerationsSchema.parse(v) as Json});
 },
};
