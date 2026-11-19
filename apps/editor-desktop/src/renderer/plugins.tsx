import * as React from 'react';
import {useEffect, useState} from 'react';
import {ManifestSchema, commands, components, createItems, menus, panels, settings, tools, type EditorModule} from '@rewrite/sdk';
import {sceneToken} from '@rewrite/scene';
import {projectToken} from '@rewrite/project';

type Plugin = Awaited<ReturnType<Window['platform']['plugins']['list']>>[number];
/** Problems while loading plugins, shown in Settings → Plugins. */
export const pluginProblems = new Map<string, string>();
/**
 * Loads the enabled user plugins as editor modules. A plugin's main module default-exports
 * `{manifest: {id: 'user.<folder>', version, apiVersion: 1, requires?}, activate(context)}` and finds the editor API
 * on `globalThis.OliveStudio` (React, the contribution slots, service tokens, notify). Contribution IDs start with the
 * module ID; a plugin that fails to load or activate is reported and skipped.
 */
export async function loadPlugins(notify: (message: string) => void): Promise<EditorModule[]> {
 const list = await window.platform.plugins.list().catch(() => [] as Plugin[]);
 Object.defineProperty(globalThis, 'OliveStudio', {configurable: true, value: Object.freeze({apiVersion: 1, React, slots: Object.freeze({panels, commands, menus, tools, createItems, components, settings}), tokens: Object.freeze({scene: sceneToken, project: projectToken}), notify})});
 const modules: EditorModule[] = [];
 pluginProblems.clear();
 for (const p of list) {
  if (!p.enabled || p.error) continue;
  try {
   const loaded = await import(/* @vite-ignore */ `olive-plugin://${p.id}/${p.main}`) as {default?: EditorModule};
   const module = loaded.default;
   if (!module || typeof module.activate !== 'function') throw Error('main must default-export {manifest, activate}');
   const manifest = ManifestSchema.parse(module.manifest);
   if (manifest.id !== `user.${p.id}`) throw Error(`manifest.id must be "user.${p.id}"`);
   modules.push({manifest: {...manifest, apiVersion: 1}, activate: c => module.activate(c)});
  } catch (error) { const message = error instanceof Error ? error.message : String(error); pluginProblems.set(p.id, message); notify(`Plugin ${p.name}: ${message}`); }
 }
 return modules;
}
/** Settings → Editor → Plugins: installed plugins, enable / disable (applies after restart), open the folder. */
export function PluginSettings({text: t, active}: {text(key: string): string; active(id: string): string | undefined}) {
 const [list, setList] = useState<Plugin[] | null>(null), [changed, setChanged] = useState(false);
 const refresh = () => { void window.platform.plugins.list().then(setList); };
 useEffect(refresh, []);
 return <div className="plugin-settings" data-testid="plugin-settings">
  <p className="panel-empty">{t('plugins.help')}</p>
  <div className="plugin-actions"><button onClick={() => { void window.platform.plugins.reveal(); }}>{t('plugins.reveal')}</button><button onClick={refresh}>{t('plugins.refresh')}</button></div>
  {changed && <p className="component-warning" role="status">{t('plugins.restart')}</p>}
  {list && !list.length && <p className="panel-empty">{t('plugins.none')}</p>}
  <ul className="plugin-list">{list?.map(p => <li key={p.id} data-plugin={p.id}>
   <label><input type="checkbox" aria-label={`${t('plugins.enable')} ${p.name}`} checked={p.enabled} disabled={Boolean(p.error)} onChange={e => { void window.platform.plugins.enable(p.id, e.target.checked).then(() => { setChanged(true); refresh(); }); }}/><strong>{p.name}</strong>{p.version && <small>{p.version}</small>}</label>
   {p.description && <p>{p.description}</p>}
   {(p.error ?? pluginProblems.get(p.id)) && <p className="component-warning">{p.error ?? pluginProblems.get(p.id)}</p>}
   {p.enabled && !p.error && <small data-state={active(`user.${p.id}`) ?? 'restart'}>{t(`plugins.state.${active(`user.${p.id}`) ?? 'restart'}`)}</small>}
  </li>)}</ul>
 </div>;
}
