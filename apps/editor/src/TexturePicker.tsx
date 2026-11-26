import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Image, Search, X } from 'lucide-react';
import { filename } from './assetLibrary';
import type { Asset } from './assets';
import { IconButton } from './chrome';
import { locale, t } from './i18n';
import { dropOne } from './valueDrag';

const displayName = (asset: Asset) => asset.name ?? filename(asset.alias);

export function TexturePicker({ id, value, assets, choose }: {
  id: string; value: string | null; assets: Map<string, Asset>; choose: (alias: string | null) => void;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const active = value ? assets.get(value) : undefined;
  const image = active?.kind === 'image' ? active : undefined;
  useEffect(() => {
    if (!open) return;
    dialog.current?.showModal();
    search.current?.focus();
  }, [open]);

  function close() {
    dialog.current?.close();
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  }

  function select(alias: string | null) {
    if (alias !== value) choose(alias);
    close();
  }

  const text = query.trim().toLocaleLowerCase(locale);
  const thumbnails = !open ? [] : [...assets.values()]
    .filter(asset => asset.kind === 'image' && `${displayName(asset)} ${asset.alias}`.toLocaleLowerCase(locale).includes(text))
    .sort((a, b) => displayName(a).localeCompare(displayName(b), locale) || a.alias.localeCompare(b.alias, locale));

  return <>
    <button id={id} ref={trigger} className="texture-trigger" type="button" value={value ?? ''} title={value ?? undefined}
      aria-haspopup="dialog" aria-expanded={open} onClick={() => { setQuery(''); setOpen(true); }}
      {...dropOne('asset', alias => alias !== value && assets.get(alias)?.kind === 'image', choose)}>
      <span className="texture-swatch">{image ? <img src={image.url} alt="" /> : <Image size={14} aria-hidden="true" />}</span>
      <span className="texture-name">{image ? displayName(image) : value ?
        t('missingTextureOption', { alias: filename(value) }) : t('textureNone')}</span>
      <ChevronDown size={12} aria-hidden="true" />
    </button>
    {open && <dialog className="texture-dialog" ref={dialog} aria-labelledby={`${id}-title`} onCancel={event => {
      event.preventDefault();
      close();
    }}>
      <header className="texture-header">
        <h2 id={`${id}-title`}>{t('chooseTexture')}</h2>
        <IconButton icon={X} label={t('dismiss')} onClick={close} />
      </header>
      <label className="texture-search"><Search size={15} aria-hidden="true" />
        <input ref={search} type="search" aria-label={t('textureSearch')} placeholder={t('textureSearch')}
          value={query} onChange={event => setQuery(event.target.value)} />
      </label>
      <div className="texture-results">
        {!thumbnails.length && <p role="status">{t(text ? 'textureNoMatches' : 'textureEmpty')}</p>}
        <div className="texture-grid">
          {thumbnails.map(asset => <button key={asset.alias} type="button" className="texture-card"
            title={asset.alias} aria-pressed={asset.alias === value} onClick={() => select(asset.alias)}>
            <span className="texture-swatch"><img src={asset.url} alt="" loading="lazy" decoding="async" /></span>
            <span>{displayName(asset)}</span>
          </button>)}
        </div>
      </div>
      <footer className="texture-footer">
        <button type="button" disabled={!value} onClick={() => select(null)}>{t('textureClear')}</button>
      </footer>
    </dialog>}
  </>;
}
