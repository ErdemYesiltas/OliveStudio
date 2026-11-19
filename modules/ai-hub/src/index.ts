import {settings, type EditorModule} from '@rewrite/sdk';
export * from './contracts';

/** LocalHub: which connection the AI panel uses and the hub's chat model (pairing lives in the AI panel). */
export const hubModule: EditorModule = {
 manifest: {id: 'ai-hub', version: '1.0.0', apiVersion: 1},
 activate(c) {
  c.contribute(settings, 'ai-hub.connection', {titleKey: 'setting.aiConnection', descriptionKey: 'setting.aiConnectionHelp', kind: 'enum', default: 'auto', order: 0,
   options: [{value: 'auto', titleKey: 'setting.aiConnection.auto'}, {value: 'localhub', titleKey: 'setting.aiConnection.localhub'}, {value: 'direct', titleKey: 'setting.aiConnection.direct'}]});
  c.contribute(settings, 'ai-hub.model', {titleKey: 'setting.hubModel', descriptionKey: 'setting.hubModelHelp', kind: 'string', default: '', order: 1});
 },
};
