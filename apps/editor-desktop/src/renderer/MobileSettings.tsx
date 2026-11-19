import {useSyncExternalStore} from 'react';
import {CommitInput} from '@rewrite/ui/drafts';
import {defaultMobileApp, mobileSection, parseMobileApp, type MobileApp} from '@rewrite/html-export/mobile';
import type {ProjectService} from '@rewrite/project';
import type {Json} from '@rewrite/sdk';

/** Settings → Mobile app (this project): the app ID and name the mobile project export uses. One undo step per change. */
export function createMobileSettings(bridge: {project: ProjectService; useEditable(): boolean; text(key: string): string; report(error: unknown): void}) {
 const t = bridge.text;
 return function MobileSettings() {
  useSyncExternalStore(bridge.project.document.subscribe, () => bridge.project.document.version);
  const editable = bridge.useEditable(), current = bridge.project.document.current, stored = current.extensions[mobileSection], app: MobileApp = stored ? parseMobileApp(stored).app : defaultMobileApp(current.name), problems = parseMobileApp(app).errors;
  const images = ((current.extensions['assets.registry'] as {items?: {id: string; name: string; type: string}[]} | undefined)?.items ?? []).filter(a => a.type === 'pixi.texture');
  const write = (patch: Partial<MobileApp>, remove: readonly (keyof MobileApp)[] = []) => { const next: Partial<MobileApp> = {...app, ...patch}; for (const key of remove) delete next[key]; const check = parseMobileApp(next); if (check.errors.length) { bridge.report(Error(check.errors.join('; '))); return; } try { bridge.project.document.transact('Change mobile app', p => { p.extensions[mobileSection] = check.app as unknown as Json; }); } catch (error) { bridge.report(error); } };
  return <div className="game-settings" data-testid="mobile-settings">
   <div className="game-setting"><label className="field"><span>{t('mobile.appId')}</span><small>{t('mobile.appIdHelp')}</small><CommitInput label={t('mobile.appId')} value={app.appId} disabled={!editable} commit={raw => write({appId: raw.trim()})}/></label></div>
   <div className="game-setting"><label className="field"><span>{t('mobile.appName')}</span><small>{t('mobile.appNameHelp')}</small><CommitInput label={t('mobile.appName')} value={app.appName} disabled={!editable} commit={raw => write({appName: raw.trim()})}/></label></div>
   <div className="game-setting"><label className="field"><span>{t('mobile.icon')}</span><small>{t('mobile.iconHelp')}</small><select aria-label={t('mobile.icon')} disabled={!editable} value={app.iconAssetId ?? ''} onChange={e => write(e.target.value ? {iconAssetId: e.target.value} : {}, e.target.value ? [] : ['iconAssetId'])}><option value="">{t('mobile.iconNone')}</option>{images.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}{app.iconAssetId && !images.some(a => a.id === app.iconAssetId) && <option value={app.iconAssetId}>{t('mobile.iconMissing')}</option>}</select></label></div>
   <div className="game-setting"><label className="field"><span>{t('mobile.splash')}</span><small>{t('mobile.splashHelp')}</small><input type="color" aria-label={t('mobile.splash')} disabled={!editable} value={app.splashColor ?? '#111318'} onChange={e => write({splashColor: e.target.value})}/></label></div>
   {problems.map(p => <p key={p} className="component-warning">{p}</p>)}
   <p className="panel-empty">{t('mobile.help')}</p>
  </div>;
 };
}
