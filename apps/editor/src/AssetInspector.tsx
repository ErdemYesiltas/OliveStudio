import { useState } from 'react';
import { AudioLines, Bone, Download, Link2, Play, Plus, RefreshCw, Square } from 'lucide-react';
import type { AssetLibrary, CatalogEntry } from './assetLibrary';
import { type AudioStatus } from './audio';
import { AnimatedAssetPreview, type AnimationPreviewSelection } from './AnimatedAssetPreview';
import { IconButton } from './chrome';
import { t } from './i18n';

function ImagePreview({ asset }: { asset: CatalogEntry }) {
  const [dimensions, setDimensions] = useState<{ width: number; height: number }>();
  const [failed, setFailed] = useState(false);
  return <>
    <div className="asset-preview-media">
      {failed ? <span>{t('previewUnavailable')}</span> : <img alt="" src={asset.url} onError={() => setFailed(true)} onLoad={event => {
        const { naturalWidth, naturalHeight } = event.currentTarget;
        setDimensions({ width: naturalWidth, height: naturalHeight });
      }} />}
    </div>
    {dimensions && <small>{t('imageDimensions', dimensions)}</small>}
  </>;
}

type SpineExportFormat = 'runtime' | 'project' | 'binary';

export function AssetInspector({ assets, audio, editable, canAssign, onAssignAudio, library, onAssign, onAdd, onBundle, onPlay, onStop, onTags, onReplace, onOpenSpine, onCreateSpine, onExportSpine, onConvertSpine, slice }: {
  assets: CatalogEntry[]; audio: AudioStatus; editable: boolean; canAssign: boolean; library: AssetLibrary;
  onAssign: (alias: string) => void; onAdd: (asset: CatalogEntry, selection?: AnimationPreviewSelection) => void;
  onBundle: (aliases: string[], id: string | null) => void;
  onAssignAudio?: (alias: string) => void;
  onPlay: (alias: string) => void; onStop: () => void;
  onTags: (aliases: string[], values: string[]) => void;
  onReplace?: (item: CatalogEntry) => void;
  onOpenSpine?: (asset: CatalogEntry) => void;
  onCreateSpine?: (images: CatalogEntry[]) => void;
  onExportSpine?: (alias: string, format: SpineExportFormat) => Promise<string | null>;
  onConvertSpine?: (item: CatalogEntry) => void;
  slice: (asset: CatalogEntry, options: { cellWidth: number; cellHeight: number; clip: string }) => Promise<void>;
}) {
  const project = assets.filter(asset => asset.writable);
  const membership = new Set(project.map(asset => asset.bundleId ?? ''));
  const item = assets.length === 1 ? assets[0] : undefined;
  const playing = item && (audio.state === 'loading' || audio.state === 'playing') && audio.alias === item.alias;
  const [tagError, setTagError] = useState('');
  const [slicing, setSlicing] = useState(false);
  const [sliceError, setSliceError] = useState('');
  const [spineExport, setSpineExport] = useState<{ alias: string; path?: string; error?: string }>();
  const [exportingSpine, setExportingSpine] = useState(false);
  function exportSpine(alias: string, format: SpineExportFormat) {
    if (!onExportSpine || exportingSpine) return;
    setExportingSpine(true);
    setSpineExport(undefined);
    void onExportSpine(alias, format).then(path => { if (path) setSpineExport({ alias, path }); })
      .catch(error => setSpineExport({ alias, error: error instanceof Error ? error.message : String(error) }))
      .finally(() => setExportingSpine(false));
  }
  return <section className="asset-inspection" aria-label={t('assetPreview')}>
    {item ? <>
      <div className="asset-inspection-title">
        <strong>{item.name}</strong>
        <small>{t(item.kind === 'image' ? 'assetTexture' : item.kind === 'audio' ? 'assetAudio' :
          item.kind === 'spine' ? 'assetSpine' : 'assetSheet')}</small>
        {item.writable && onReplace && <IconButton icon={RefreshCw} label={t('replaceAssetFile')} description={t('replaceAssetHint')}
          disabled={!editable} onClick={() => onReplace(item)} />}
        {item.writable && item.kind === 'spine' && /\.json$/i.test(item.path) && onOpenSpine &&
          <IconButton icon={Bone} label={t('spineStudio')} description={t('spineStudioHint')} disabled={!editable}
            onClick={() => onOpenSpine(item)} />}
        {item.writable && item.kind === 'spine' && onExportSpine &&
          <IconButton icon={Download} label={t('spineExportFiles')} disabled={exportingSpine} onClick={() => exportSpine(item.alias, 'runtime')} />}
        {item.writable && item.kind === 'spine' && onExportSpine &&
          <button type="button" className="bundle-command" disabled={exportingSpine}
            title={t('spineExportProjectHint')}
            onClick={() => exportSpine(item.alias, 'project')}>{t('spineExportProject')}</button>}
        {item.writable && item.kind === 'spine' && /\.json$/i.test(item.path) && onExportSpine &&
          <button type="button" className="bundle-command" disabled={exportingSpine}
            onClick={() => exportSpine(item.alias, 'binary')}>{t('spineExportBinary')}</button>}
        {item.writable && item.kind === 'spine' && /\.skel$/i.test(item.path) && onConvertSpine &&
          <IconButton icon={Bone} label={t('spineConvertBinary')} description={t('spineConvertBinaryHint')}
            disabled={!editable || exportingSpine} onClick={() => onConvertSpine(item)} />}
      </div>
      {spineExport?.alias === item.alias && (spineExport.error
        ? <small className="error" role="alert">{spineExport.error}</small>
        : <small role="status">{t('spineExportedFiles', { path: spineExport.path ?? '' })}</small>)}
      {item.kind === 'image' ? <>
        <ImagePreview key={item.alias} asset={item} />
        <IconButton icon={Link2} label={t('assignSelectedTexture')} description={t('assignTextureHint')}
          disabled={!canAssign} onClick={() => onAssign(item.alias)} />
        <details>
          <summary>{t('sliceAsset')}</summary>
          <form className="asset-slice-form" key={item.alias} onSubmit={event => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            setSlicing(true);
            setSliceError('');
            void slice(item, { cellWidth: Number(data.get('width')), cellHeight: Number(data.get('height')),
              clip: String(data.get('clip')) })
              .catch(error => setSliceError(error instanceof Error ? error.message : String(error))).finally(() => setSlicing(false));
          }}>
            <label>{t('sliceWidth')} <input name="width" type="number" min={1} max={8192} required defaultValue={32} disabled={!editable} /></label>
            <label>{t('sliceHeight')} <input name="height" type="number" min={1} max={8192} required defaultValue={32} disabled={!editable} /></label>
            <label>{t('sliceClip')} <input name="clip" required pattern="[A-Za-z0-9_\-]+" maxLength={50} defaultValue="default" disabled={!editable} /></label>
            <button type="submit" disabled={!editable || slicing}>{t('sliceCreate')}</button>
            {sliceError && <small role="alert" className="error">{sliceError}</small>}
          </form>
        </details>
      </> : item.kind === 'audio' ? <>
        <div className="asset-audio-controls">
          <AudioLines size={20} aria-hidden="true" />
          <button type="button" className="bundle-command" disabled={playing} onClick={() => onPlay(item.alias)}>
            <Play size={15} aria-hidden="true" />{t('playSelectedAudio')}
          </button>
          <button type="button" className="bundle-command" disabled={!playing} onClick={onStop}>
            <Square size={15} aria-hidden="true" />{t('stopSelectedAudio')}
          </button>
        </div>
        {audio.state === 'error' && audio.alias === item.alias && <small className="error">{audio.message}</small>}
        <div className="panel-tools">
          <IconButton icon={Plus} label={t('addAssetToScene')} description={t('audioAddToSceneHint')}
            disabled={!editable} onClick={() => onAdd(item)} />
          <IconButton icon={Link2} label={t('audioAssignToSource')} description={t('audioAssignToSourceHint')}
            disabled={!editable || !onAssignAudio} onClick={() => onAssignAudio?.(item.alias)} />
        </div>
      </> : <AnimatedAssetPreview key={item.alias} asset={item} scrub={item.kind === 'spine'}
        addDisabled={!editable} onAddToScene={selection => onAdd(item, selection)} />}
      <dl className="asset-metadata">
        <dt>{t('assetAlias')}</dt><dd>{item.alias}</dd>
        {item.bytes !== undefined && <><dt>{t('assetSize')}</dt><dd>{t('assetSizeBytes', { count: item.bytes.toLocaleString() })}</dd></>}
      </dl>
    </> : <div className="asset-multi-summary">
      <strong>{t('assetsSelected', { count: assets.length })}</strong>
      {project.length < assets.length && <small>{t('builtInSelectionReadOnly')}</small>}
    </div>}
    {!!assets.length && assets.every(asset => asset.kind === 'image') && onCreateSpine &&
      <button type="button" className="bundle-command" disabled={!editable} onClick={() => onCreateSpine(assets)}>
        <Bone size={15} aria-hidden="true" />{t('spineCreateRig')}
      </button>}
    {project.length > 0 && <label className="asset-bundle-picker">{t('assetBundle')}
      <select aria-label={t('assetBundle')} value={membership.size === 1 ? [...membership][0] : 'mixed'}
        disabled={!editable} onChange={event => onBundle(project.map(asset => asset.alias), event.target.value || null)}>
        {membership.size > 1 && <option disabled value="mixed">{t('bundleMixed')}</option>}
        <option value="">{t('bundleDefault')}</option>
        {(library.bundles ?? []).map(bundle => <option key={bundle.id} value={bundle.id}>{bundle.name}</option>)}
      </select>
    </label>}
    {!!project.length && <label className="asset-bundle-picker">{t('assetTags')}
      <input key={JSON.stringify(project.map(item => [item.alias, item.tags]))} disabled={!editable} maxLength={1024}
        defaultValue={item?.tags?.join(', ') ?? ''} placeholder={t('assetTagsHint')} onChange={() => setTagError('')}
        onBlur={event => {
          const value = event.currentTarget.value;
          if (value === (item?.tags?.join(', ') ?? '')) return;
          try { onTags(project.map(asset => asset.alias), value.split(',').map(tag => tag.trim()).filter(Boolean)); }
          catch { setTagError(t('assetTagsInvalid')); }
        }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
      {tagError && <small className="error" role="alert">{tagError}</small>}
    </label>}
  </section>;
}
