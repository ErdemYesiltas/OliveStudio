import {CommitInput,finiteNumber,useDraftController} from '@rewrite/ui/drafts';
import {Monitor,Tablet,Smartphone} from 'lucide-react';
import {useState} from 'react';
import {RenderSettingsSchema,presentationDevices,type PresentationDevice, type RenderSettings} from '@rewrite/render-pixi/contracts';

const STAGES: readonly [number, number, string][] = [[960, 540, '960×540 (16:9)'], [1280, 720, '1280×720 (HD)'], [1920, 1080, '1920×1080 (Full HD)'], [1080, 1920, '1080×1920 (portrait)'], [720, 1280, '720×1280 (portrait)'], [800, 600, '800×600 (4:3)'], [1024, 1024, '1024×1024 (square)'], [320, 180, '320×180 (pixel art)']];

/**
 * Settings → Game (this project): the stage (render size) and how PixiJS renders the exported game. Each change is one
 * undo step in the project; Preview mirrors background, pixel art and frame rate.
 */
export function createGameSettings(bridge: {
 useSettings(): {settings: RenderSettings; stage: {width: number; height: number}}; useEditable(): boolean;
 write(label: string, next: RenderSettings,fromField?:boolean): void; setStage(size: {width: number; height: number}): void; text(key: string): string; report(error: unknown): void;
}) {
 return function GameSettings() {
  const drafts=useDraftController();const changeContext=(work:()=>void)=>{try{drafts?.flush();work();}catch(error){bridge.report(error);}};
  const {settings, stage} = bridge.useSettings(), editable = bridge.useEditable(), t = bridge.text, [device,setDevice]=useState<PresentationDevice|'default'>('default'),[orientation,setOrientation]=useState<'portrait'|'landscape'>('landscape'),[size, setSize] = useState<{width?: string; height?: string}>({});
  const set = (label: string, patch: Partial<RenderSettings>,fromField=false) => { try { bridge.write(label, RenderSettingsSchema.parse({...settings, ...patch}),fromField);return true; } catch (error) { bridge.report(error);return false; } };
  const profile=device==='default'?undefined:settings.profiles?.[device]?.[orientation],profileValue=profile??{...stage,scaleMode:settings.scaleMode};
  const updateProfile=(value:typeof profile,fromField=false)=>{if(device==='default')return false;const profiles=structuredClone(settings.profiles??{}),group={...profiles[device]};if(value)group[orientation]=value;else delete group[orientation];if(Object.keys(group).length)profiles[device]=group;else delete profiles[device];return set('Change device presentation',{profiles},fromField);};
  const commitSize = () => { const width = Number(size.width ?? stage.width), height = Number(size.height ?? stage.height); setSize({}); if (width !== stage.width || height !== stage.height) { try { bridge.setStage({width, height}); } catch (error) { bridge.report(error); } } };
  const preset = STAGES.find(([w, h]) => w === stage.width && h === stage.height);
  const row = (label: string, control: React.ReactNode, help?: string) => <div className="game-setting"><label className="field"><span>{label}</span>{help && <small>{help}</small>}{control}</label></div>;
  return <div className="game-settings" data-testid="game-settings">
   <section className="presentation-profiles" data-testid="presentation-profiles"><div className="profile-heading"><Monitor size={18}/><strong>{t('responsive.device')}</strong></div><div className="profile-device-tabs" role="group" aria-label={t('responsive.device')}><button aria-pressed={device==='default'} onClick={()=>changeContext(()=>setDevice('default'))}>{t('responsive.default')}</button>{presentationDevices.map(d=>{const Icon=d==='desktop'?Monitor:d==='tablet'?Tablet:Smartphone;return <button key={d} aria-pressed={device===d} onClick={()=>changeContext(()=>setDevice(d))}><Icon size={15}/>{t(`responsive.${d}`)}</button>;})}</div><p className="setting-help">{t('responsive.help')}</p>
    {device!=='default'&&<><label className="field"><span>{t('responsive.orientation')}</span><select aria-label={t('responsive.orientation')} value={orientation} onChange={e=>changeContext(()=>setOrientation(e.target.value as typeof orientation))}><option value="landscape">{t('responsive.landscape')}</option><option value="portrait">{t('responsive.portrait')}</option></select></label><label className="field"><span>{t('responsive.override')}</span><input aria-label={t('responsive.override')} type="checkbox" disabled={!editable} checked={Boolean(profile)} onChange={e=>updateProfile(e.target.checked?profileValue:undefined)}/></label>
     {profile&&<div className="profile-values"><label className="field"><span>{t('game.width')}</span><CommitInput label={t('responsive.width')} type="number" min={64} max={4096} disabled={!editable} value={profile.width} commit={raw=>updateProfile({...profile,width:finiteNumber(raw)},true)}/></label><label className="field"><span>{t('game.height')}</span><CommitInput label={t('responsive.height')} type="number" min={64} max={4096} disabled={!editable} value={profile.height} commit={raw=>updateProfile({...profile,height:finiteNumber(raw)},true)}/></label><label className="field"><span>{t('game.scaleMode')}</span><select aria-label={t('responsive.fit')} disabled={!editable} value={profile.scaleMode} onChange={e=>updateProfile({...profile,scaleMode:e.target.value as typeof profile.scaleMode})}>{(['fit','fill','stretch','none'] as const).map(m=><option key={m} value={m}>{t(`game.scale.${m}`)}</option>)}</select></label></div>}
    </>}
   </section>
   <h4 className="game-defaults-heading">{t('responsive.base')}</h4>
   {row(t('game.stage'), <select aria-label={t('game.stage')} disabled={!editable} value={preset ? `${preset[0]}x${preset[1]}` : ''} onChange={e => { if (!e.target.value) return; const [w, h] = e.target.value.split('x').map(Number); try { bridge.setStage({width: w, height: h}); } catch (error) { bridge.report(error); } }}>{!preset && <option value="">{t('game.customStage')}</option>}{STAGES.map(([w, h, name]) => <option key={name} value={`${w}x${h}`}>{name}</option>)}</select>, t('game.stageHelp'))}
   <div className="game-setting game-size">
    <label className="field"><span>{t('game.width')}</span><input type="number" aria-label={t('game.width')} min={64} max={4096} disabled={!editable} value={size.width ?? stage.width} onChange={e => setSize({...size, width: e.target.value})} onBlur={commitSize} onKeyDown={e => { if (e.key === 'Enter') commitSize(); }}/></label>
    <label className="field"><span>{t('game.height')}</span><input type="number" aria-label={t('game.height')} min={64} max={4096} disabled={!editable} value={size.height ?? stage.height} onChange={e => setSize({...size, height: e.target.value})} onBlur={commitSize} onKeyDown={e => { if (e.key === 'Enter') commitSize(); }}/></label>
   </div>
   {row(t('game.background'), <input type="color" aria-label={t('game.background')} disabled={!editable} value={settings.background} onChange={e => set('Change game background', {background: e.target.value})}/>)}
   {row(t('game.scaleMode'), <select aria-label={t('game.scaleMode')} disabled={!editable} value={settings.scaleMode} onChange={e => set('Change game scaling', {scaleMode: e.target.value as RenderSettings['scaleMode']})}>{(['fit', 'fill', 'stretch', 'none'] as const).map(m => <option key={m} value={m}>{t(`game.scale.${m}`)}</option>)}</select>, t(`game.scale.${settings.scaleMode}.help`))}
   {row(t('game.resolution'), <select aria-label={t('game.resolution')} disabled={!editable} value={settings.resolution} onChange={e => set('Change game resolution', {resolution: Number(e.target.value)})}><option value={0}>{t('game.resolutionAuto')}</option>{[.5, .75, 1, 1.5, 2, 3].map(v => <option key={v} value={v}>{v}×</option>)}</select>, t('game.resolutionHelp'))}
   {settings.resolution === 0 && row(t('game.maxResolution'), <select aria-label={t('game.maxResolution')} disabled={!editable} value={settings.maxResolution} onChange={e => set('Change maximum resolution', {maxResolution: Number(e.target.value)})}>{[1, 1.5, 2, 3, 4].map(v => <option key={v} value={v}>{v}×</option>)}</select>)}
   {row(t('game.renderer'), <select aria-label={t('game.renderer')} disabled={!editable} value={settings.renderer} onChange={e => set('Change game renderer', {renderer: e.target.value as RenderSettings['renderer']})}><option value="webgl">WebGL</option><option value="webgpu">{t('game.webgpu')}</option></select>)}
   {row(t('game.antialias'), <input type="checkbox" aria-label={t('game.antialias')} disabled={!editable} checked={settings.antialias} onChange={e => set('Change antialiasing', {antialias: e.target.checked})}/>)}
   {row(t('game.debugOverlay'), <input type="checkbox" aria-label={t('game.debugOverlay')} disabled={!editable} checked={settings.debugOverlay} onChange={e => set('Change debug overlay', {debugOverlay: e.target.checked})}/>, t('game.debugOverlayHelp'))}
   {row(t('game.pixelArt'), <input type="checkbox" aria-label={t('game.pixelArt')} disabled={!editable} checked={settings.pixelArt} onChange={e => set('Change pixel art mode', {pixelArt: e.target.checked})}/>, t('game.pixelArtHelp'))}
   {row(t('game.maxFPS'), <select aria-label={t('game.maxFPS')} disabled={!editable} value={settings.maxFPS} onChange={e => set('Change maximum FPS', {maxFPS: Number(e.target.value)})}><option value={0}>{t('game.fpsDisplay')}</option>{[24, 30, 50, 60, 120, 144].map(v => <option key={v} value={v}>{v}</option>)}</select>)}
   {row(t('game.minFPS'), <select aria-label={t('game.minFPS')} disabled={!editable} value={settings.minFPS} onChange={e => set('Change minimum FPS', {minFPS: Number(e.target.value)})}>{[5, 10, 15, 20, 30].map(v => <option key={v} value={v}>{v}</option>)}</select>, t('game.minFPSHelp'))}
  </div>;
 };
}
