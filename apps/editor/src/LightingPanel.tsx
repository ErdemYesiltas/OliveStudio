import type { Lighting } from '@rewrite/lighting';
import { Eye, EyeOff, Lightbulb, Plus } from 'lucide-react';
import { IconButton, PanelHeader } from './chrome';
import { t } from './i18n';
import { defaultLighting } from './sceneLighting';

export function LightingPanel({ lighting, editable, preview, change, togglePreview, addLight }: {
  lighting?: Lighting; editable: boolean; preview: boolean;
  change: (value: Lighting) => void; togglePreview: () => void; addLight: () => void;
}) {
  const settings = lighting ?? defaultLighting;
  return <section className="panel" aria-label={t('lightingPanel')}>
    <PanelHeader icon={Lightbulb} label={t('lightingPanel')} description={t('lightingPanelHint')}>
      <IconButton icon={preview ? Eye : EyeOff} label={t('lightingEditorPreview')} description={t('lightingEditorPreviewHint')}
        aria-pressed={preview} disabled={!editable} onClick={togglePreview} />
      <IconButton icon={Plus} label={t('addObject', { type: t('typeLight2D') })}
        disabled={!editable} onClick={addLight} />
    </PanelHeader>
    <fieldset className="panel-body lighting-panel" disabled={!editable}>
      <label className="physics-field">
        <span>{t('lightingEnabled')}</span>
        <input type="checkbox" checked={settings.enabled} onChange={event => change({ ...settings, enabled: event.target.checked })} />
      </label>
      <label className="physics-field">
        <span>{t('lightingAmbient')}</span>
        <span className="inspector-color"><input type="color" value={settings.ambient}
          onChange={event => change({ ...settings, ambient: event.target.value })} />
          <code aria-hidden="true">{settings.ambient.toUpperCase()}</code></span>
      </label>
    </fieldset>
  </section>;
}
