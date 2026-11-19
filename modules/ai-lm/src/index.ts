import {settings, type EditorModule} from '@rewrite/sdk';
import {defaultLmUrl} from './contracts';
export * from './contracts';
export * from './diff';

/** LM Studio: address and model settings (the assistant and prompt writer live in the studio composition). */
export const lmModule: EditorModule = {
 manifest: {id: 'ai-lm', version: '1.0.0', apiVersion: 1},
 activate(c) {
  c.contribute(settings, 'ai-lm.url', {titleKey: 'setting.lmUrl', descriptionKey: 'setting.lmUrlHelp', kind: 'string', default: defaultLmUrl, order: 1});
  c.contribute(settings, 'ai-lm.thinking', {titleKey: 'setting.lmThinking', descriptionKey: 'setting.lmThinkingHelp', kind: 'boolean', default: false, order: 3});
  c.contribute(settings, 'ai-lm.model', {titleKey: 'setting.lmModel', descriptionKey: 'setting.lmModelHelp', kind: 'string', default: '', order: 2});
 },
};
