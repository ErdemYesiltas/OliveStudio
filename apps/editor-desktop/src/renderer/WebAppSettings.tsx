import {useSyncExternalStore} from 'react';
import {CommitInput} from '@rewrite/ui/drafts';
import {parseWebApp, webAppSection, type WebApp} from '@rewrite/html-export/webapp';
import type {ProjectService} from '@rewrite/project';
import type {Json} from '@rewrite/sdk';

/** Settings → Web app (this project): makes the HTML export installable and playable offline (manifest, icons, service worker). One undo step per change. */
export function createWebAppSettings(bridge: {project: ProjectService; useEditable(): boolean; text(key: string): string; report(error: unknown): void}) {
 const t = bridge.text;
 return function WebAppSettings() {
  useSyncExternalStore(bridge.project.document.subscribe, () => bridge.project.document.version);
  const editable = bridge.useEditable(), current = bridge.project.document.current, {app, errors} = parseWebApp(current.extensions[webAppSection], current.name);
  const write = (patch: Partial<WebApp>) => { const next = parseWebApp({...app, ...patch}, current.name); if (next.errors.length) { bridge.report(Error(next.errors.join('; '))); return; } try { bridge.project.document.transact('Change web app', p => { p.extensions[webAppSection] = next.app as unknown as Json; }); } catch (error) { bridge.report(error); } };
  return <div className="game-settings" data-testid="webapp-settings">
   <div className="game-setting"><label className="checkbox"><input type="checkbox" aria-label={t('webapp.enabled')} checked={app.enabled} disabled={!editable} onChange={e => write({enabled: e.target.checked})}/>{t('webapp.enabled')}</label><small>{t('webapp.enabledHelp')}</small></div>
   <div className="game-setting"><label className="field"><span>{t('webapp.name')}</span><CommitInput label={t('webapp.name')} value={app.name} disabled={!editable || !app.enabled} commit={raw => write({name: raw.trim()})}/></label></div>
   <div className="game-setting"><label className="field"><span>{t('webapp.shortName')}</span><small>{t('webapp.shortNameHelp')}</small><CommitInput label={t('webapp.shortName')} value={app.shortName} disabled={!editable || !app.enabled} commit={raw => write({shortName: raw.trim()})}/></label></div>
   <div className="game-setting"><label className="field"><span>{t('webapp.display')}</span><select aria-label={t('webapp.display')} disabled={!editable || !app.enabled} value={app.display} onChange={e => write({display: e.target.value as WebApp['display']})}><option value="fullscreen">{t('webapp.fullscreen')}</option><option value="standalone">{t('webapp.standalone')}</option></select></label></div>
   <div className="game-setting"><label className="field"><span>{t('webapp.theme')}</span><input type="color" aria-label={t('webapp.theme')} disabled={!editable || !app.enabled} value={app.themeColor} onChange={e => write({themeColor: e.target.value})}/></label></div>
   {app.enabled && errors.map(p => <p key={p} className="component-warning">{p}</p>)}
   <p className="panel-empty">{t('webapp.help')}</p>
  </div>;
 };
}
