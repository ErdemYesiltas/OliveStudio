import { useEffect, useRef, useState } from 'react';
import { Layers3, RotateCcw, Search, Settings2, X } from 'lucide-react';
import { IconButton } from './chrome';
import { devices, orientations, type Device, type Orientation, type SettingField } from './config';
import { locale, t, type MessageKey } from './i18n';
import { configRegistry, type SceneConfig } from './scene';

export type PreviewProfile = { device: Device; orientation?: Orientation };

export const deviceLabels = { common: 'settingsCommon', desktop: 'settingsDesktop', mobile: 'settingsMobile', tablet: 'settingsTablet' } as const;
export const orientationLabels = { landscape: 'settingsLandscape', portrait: 'settingsPortrait' } as const;
type Modules = Record<string, Record<string, unknown> | undefined>;

function read(config: SceneConfig, profile: PreviewProfile, module: string, field: SettingField) {
  const { device, orientation } = profile;
  if (field.orientation && orientation) return config.profiles?.[device]?.[orientation]?.[module]?.[field.key];
  const base = device === 'common' ? config as unknown as Modules : config.profiles?.[device];
  return base?.[module]?.[field.key];
}

export function editSetting(config: SceneConfig, profile: PreviewProfile, module: string, field: SettingField, value: unknown): SceneConfig {
  if (read(config, profile, module, field) === value) return config;
  const next = structuredClone(config);
  const { device, orientation } = profile;
  const axis = field.orientation ? orientation : undefined;
  if (device === 'common' && !axis) {
    (next as unknown as Modules)[module]![field.key] = value;
    return next;
  }
  const profiles = next.profiles ??= {};
  const deviceLayer = (profiles[device] ??= {}) as Modules & Partial<Record<Orientation, Modules>>;
  const layer = axis ? (deviceLayer[axis] ??= {}) : deviceLayer;
  const values = (layer[module] ??= {});
  if (value !== undefined) values[field.key] = value;
  else {
    delete values[field.key];
    if (!Object.keys(values).length) delete layer[module];
    if (axis && !Object.keys(layer).length) delete deviceLayer[axis];
    if (!Object.keys(deviceLayer).length) delete profiles[device];
    if (!Object.keys(profiles).length) delete next.profiles;
  }
  return next;
}

export function Settings({ config, profile, onProfile, onChange, onClose, saveError }: {
  config: SceneConfig; profile: PreviewProfile; onProfile: (profile: PreviewProfile) => void;
  onChange: (module: string, field: SettingField, value: unknown) => void; onClose: () => void; saveError?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const results = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [selection, setSelection] = useState<{ module: string; category?: MessageKey }>();
  useEffect(() => {
    dialog.current?.showModal();
    search.current?.focus();
  }, []);
  const resolved = configRegistry.forPreview(config, profile.device, profile.orientation) as Modules;
  const modules = Object.entries(configRegistry.settings);
  const terms = query.trim().toLocaleLowerCase(locale).split(/\s+/).filter(Boolean);
  const groups = modules.flatMap(([module, settings]) => {
    if (selection && selection.module !== module) return [];
    const matching = settings.fields.filter(field => {
      if (selection?.category && field.category !== selection.category) return false;
      const words = [t(settings.label), t(field.label), field.key,
        field.category && t(field.category), field.description && t(field.description)].filter(Boolean);
      if (field.kind === 'select') words.push(...field.choices);
      const text = words.join(' ').toLocaleLowerCase(locale);
      return terms.every(term => text.includes(term));
    });
    const categories = [...new Set(matching.map(field => field.category))];
    return categories.map(category => ({
      module, category, label: settings.label, fields: matching.filter(field => field.category === category),
    }));
  });
  const navigate = (next?: typeof selection) => {
    setSelection(next);
    if (results.current) results.current.scrollTop = 0;
  };
  const filter = (next: string) => {
    setQuery(next);
    navigate();
  };

  return <dialog className="settings-dialog" ref={dialog} aria-labelledby="settings-title" onCancel={onClose}>
    <header className="settings-header">
      <h1 id="settings-title"><Settings2 size={18} aria-hidden="true" />{t('settingsTitle')}</h1>
      <IconButton icon={X} label={t('dismiss')} onClick={onClose} />
    </header>
    <div className="settings-search">
      <Search size={16} aria-hidden="true" />
      <input ref={search} type="search" aria-label={t('settingsSearch')} placeholder={t('settingsSearch')}
        value={query} onChange={event => filter(event.target.value)} />
      {query && <IconButton icon={X} label={t('settingsClearSearch')}
        onClick={() => { filter(''); search.current?.focus(); }} />}
    </div>
    <div className="settings-profile">
      <div role="group" className="settings-devices" aria-label={t('settingsDevice')}>
        {devices.map(device => <button key={device} type="button" aria-pressed={profile.device === device}
          onClick={() => onProfile({ ...profile, device })}>{t(deviceLabels[device])}</button>)}
      </div>
      <label className="settings-orientation">{t('settingsOrientation')}
        <select value={profile.orientation ?? ''} onChange={event => {
          const orientation = orientations.find(value => value === event.target.value);
          onProfile({ ...profile, orientation });
        }}>
          <option value="">{t('settingsDefaultOrientation')}</option>
          {orientations.map(orientation => <option key={orientation} value={orientation}>{t(orientationLabels[orientation])}</option>)}
        </select>
      </label>
    </div>
    <div className="settings-body">
      <nav className="settings-nav" aria-label={t('settingsCategories')}>
        <button type="button" className="settings-nav-item" aria-current={!selection ? 'true' : undefined}
          onClick={() => navigate()}><Layers3 size={14} aria-hidden="true" />{t('settingsAll')}</button>
        {modules.map(([module, settings]) => <div key={module} className="settings-nav-module">
          <button type="button" className="settings-nav-item"
            aria-current={selection?.module === module && !selection.category ? 'true' : undefined}
            onClick={() => navigate({ module })}><Settings2 size={14} aria-hidden="true" />{t(settings.label)}</button>
          {[...new Set(settings.fields.flatMap(field => field.category ? [field.category] : []))].map(category =>
            <button key={category} type="button" className="settings-nav-item settings-nav-category"
              aria-current={selection?.module === module && selection.category === category ? 'true' : undefined}
              onClick={() => navigate({ module, category })}>{t(category)}</button>)}
        </div>)}
      </nav>
      <div className="settings-results" ref={results}>
        {saveError && <p className="settings-note" role="alert"><strong>{t('settingsSaveError')}</strong> {saveError}</p>}
        <p className="settings-note">{t('settingsInheritance')}</p>
        {terms.length > 0 && <p className="settings-note" role="status">
          {groups.length ? t('settingsMatches', { count: groups.reduce((total, group) => total + group.fields.length, 0) }) :
            t('settingsNoMatches')}
        </p>}
        {groups.map(({ module, category, label, fields }) => <section className="settings-section" key={`${module}-${category}`}>
          <h2><span>{t(label)}</span>{category && <>{' / '}{t(category)}</>}</h2>
          {fields.map(field => {
            const id = `setting-${module}-${field.key}`;
            const raw = read(config, profile, module, field);
            const effective = resolved[module]?.[field.key];
            const canInherit = profile.device !== 'common' || (field.orientation && !!profile.orientation);
            const set = (value: unknown) => onChange(module, field, value);
            const inherited = raw === undefined;
            const description = field.description ? `${id}-description` : undefined;
            return <div className="setting-row" key={`${id}-${profile.device}-${profile.orientation}-${field.kind === 'number' ? String(raw) : ''}`}>
              <div className="setting-description">
                <label htmlFor={id}>{t(field.label)}</label>
                {field.description && <p id={`${id}-description`}>{t(field.description)}</p>}
              </div>
              <div className="setting-control">
                {field.kind === 'number' ? <input id={id} aria-describedby={description} type="number" min={field.min} max={field.max} step={field.step ?? 1}
                  defaultValue={raw as number | undefined} placeholder={inherited ? String(effective) : undefined}
                  onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } }}
                  onBlur={event => {
                    const input = event.currentTarget;
                    if (!input.value && canInherit) set(undefined);
                    else if (input.value && input.validity.valid && Number.isFinite(input.valueAsNumber)) set(input.valueAsNumber);
                    else input.value = raw === undefined ? '' : String(raw);
                  }} /> : field.kind === 'select' ? <select id={id} aria-describedby={description} value={raw as string ?? ''}
                  onChange={event => set(event.target.value || undefined)}>
                  {canInherit && <option value="">{t('settingsInherited', { value: String(effective) })}</option>}
                  {field.choices.map(choice => <option key={choice}>{choice}</option>)}
                </select> : field.kind === 'color' ? <input id={id} aria-describedby={description} type="color" value={(raw ?? effective) as string}
                  onChange={event => set(event.target.value)} /> :
                  <input id={id} aria-describedby={description} type="checkbox" checked={Boolean(raw ?? effective)} onChange={event => set(event.target.checked)} />}
                {canInherit && !inherited && <IconButton icon={RotateCcw} label={t('settingsResetField', { name: t(field.label) })}
                  onClick={() => set(undefined)} />}
              </div>
            </div>;
          })}
        </section>)}
      </div>
    </div>
  </dialog>;
}
