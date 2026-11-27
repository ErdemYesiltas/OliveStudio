import { useEffect, useState, type ReactNode } from 'react';
import { Copy, Plus, Trash2 } from 'lucide-react';
import { duplicateSpineSkin, makeSpineMeshIndependent, moveSpineSlot, putSpineAttachment, regionToSpineMesh, removeSpineAttachment, removeSpineSkin, removeSpineSlot,
  renameSpineAttachment, renameSpineSkin, renameSpineSlot, replaceSpineSection, setSpineAttachmentSequence, spineDeformKeys, spineMeshTargets, spineSkinAttachments,
  spineSlotHasTwoColorKeys,
  type SpineAttachment, type SpineDocument } from '@olivestudio/engine/spine-format';
import { hint, IconButton } from './chrome';
import { t } from './i18n';
import { validationMessage } from './scene';
import { SpineMeshFields } from './SpineMeshFields';
import { SpineNumber } from './SpineNumber';
import { SpineSequenceFields } from './SpineSequenceFields';
import { SpineColorFields } from './SpineColorFields';
import { createSpineShape, SpineShapeFields, spineShapes, type SpineShape } from './SpineShapeFields';
import type { spineAtlasInfo, SpineReferenceChange } from './spineAssets';
import type { Asset } from './assets';

const blends = ['normal', 'additive', 'multiply', 'screen'] as const;
const fields = ['x', 'y', 'rotation', 'width', 'height', 'scaleX', 'scaleY'] as const;
const types = ['region', 'mesh', 'linkedmesh', ...spineShapes] as const;
type AttachmentType = typeof types[number];

export function SpineAttachmentFields({ document, atlas, disabled, change, report, onSkinSelection, imageAssets, addTexture, removeTexture, replaceTexture }: {
  document: SpineDocument; atlas: ReturnType<typeof spineAtlasInfo>; disabled: boolean;
  change: (document: SpineDocument, reference?: SpineReferenceChange) => void; report: (error: string) => void;
  onSkinSelection: (skin: string | undefined) => void;
  imageAssets: readonly Asset[]; addTexture: (image: Asset) => Promise<string | undefined>;
  removeTexture: (page: string) => void;
  replaceTexture: (page: string, image: Asset, premultiplied: boolean) => void;
}) {
  const { pages, regions } = atlas;
  const [pageName, selectPage] = useState('');
  const [replacementPma, setReplacementPma] = useState(false);
  const page = pages.includes(pageName) ? pageName : pages[0];
  const [slotName, selectSlot] = useState('');
  const [skinName, selectSkin] = useState('');
  const [attachmentName, selectAttachment] = useState('');
  const [newSlot, setNewSlot] = useState('');
  const [newSkin, setNewSkin] = useState('');
  const [newAttachment, setNewAttachment] = useState('');
  const [path, selectPath] = useState('');
  const [newType, selectNewType] = useState<AttachmentType>('region');
  const [parentId, selectParent] = useState(0);
  const slots = document.slots ?? [];
  const skins = document.skins ?? [];
  const slot = slots.find(item => item.name === slotName) ?? slots[0];
  const skin = skins.find(item => item.name === skinName) ?? skins[0];
  const darkTint = typeof slot?.dark === 'string' && !!slot.dark;
  const darkTintRequired = !!slot && darkTint && spineSlotHasTwoColorKeys(document, slot.name);
  useEffect(() => { onSkinSelection(skin?.name); }, [skin?.name, onSkinSelection]);
  const region = regions.find(item => item.name === path) ?? regions[0];
  const apply = (update: () => SpineDocument, reference?: SpineReferenceChange) => {
    try { change(update(), reference); report(''); return true; }
    catch (error) { report(validationMessage(error)); return false; }
  };
  let entries: Record<string, SpineAttachment> = {};
  let fallback: Record<string, SpineAttachment> = {};
  let parents: ReturnType<typeof spineMeshTargets> = [];
  let error = '';
  try {
    if (slot && skin) {
      entries = spineSkinAttachments(document, skin.name)[slot.name] ?? {};
      if (skin.name !== 'default') fallback = spineSkinAttachments(document, 'default')[slot.name] ?? {};
      if (newType === 'linkedmesh') parents = spineMeshTargets(document).filter(item => item.slot === slot.name && !item.attachment.parent);
    }
  } catch (failure) { error = validationMessage(failure); }
  const configured = { ...fallback, ...entries };
  const name = Object.hasOwn(entries, attachmentName) ? attachmentName : Object.keys(entries)[0];
  const attachment = name ? entries[name] : undefined;
  const isRegion = attachment && (attachment.type === undefined || attachment.type === 'region');
  const isTextured = attachment && (isRegion || attachment.type === 'mesh' || attachment.type === 'linkedmesh');
  const currentPath = String(attachment?.path ?? attachment?.name ?? name ?? '');
  const currentRegion = regions.find(region => region.name === currentPath);
  const shape = spineShapes.find(type => type === attachment?.type);
  let deformKeyed = false;
  if (shape && slot && skin && name) {
    try { deformKeyed = Object.keys(document.animations ?? {}).some(animation =>
      spineDeformKeys(document, animation, { skin: skin.name, slot: slot.name, name }).length); }
    catch { deformKeyed = true; }
  }
  const parent = parents[parentId] ?? parents[0];
  const textureType = newType === 'region' || newType === 'mesh' || newType === 'linkedmesh';
  const modifySlot = (update: (item: NonNullable<typeof slot>) => NonNullable<typeof slot>) =>
    apply(() => replaceSpineSection(document, 'slots', slots.map(item => item === slot ? update(item) : item)));
  const updateAttachment = (value: SpineAttachment) => {
    if (slot && skin && name) apply(() => putSpineAttachment(document, skin.name, slot.name, name, value));
  };

  return <>
    {!!imageAssets.length && <label>{t('spineAddAtlasTexture')}<select value="" disabled={disabled} onChange={event => {
      const image = imageAssets.find(asset => asset.alias === event.currentTarget.value);
      if (image) void addTexture(image).then(name => {
        if (!name) return;
        selectPath(name);
        if (!textureType) selectNewType('region');
      });
    }}>
      <option value="" disabled>{t('spineChooseAtlasTexture')}</option>
      {imageAssets.map(image => <option key={image.alias} value={image.alias}>{image.name ?? image.path}</option>)}
    </select></label>}
    {page && <div className="spine-event-key-field">
      <label>{t('spineAtlasPage')}<select value={page} disabled={disabled} onChange={event => {
        selectPage(event.currentTarget.value);
        setReplacementPma(false);
      }}>
        {pages.map(name => <option key={name}>{name}</option>)}
      </select></label>
      <IconButton icon={Trash2} label={t('spineRemoveAtlasPage')} disabled={disabled}
        description={t('spineRemoveAtlasPageHint')}
        onClick={() => removeTexture(page)} />
    </div>}
    {page && !!imageAssets.length && <>
      <label>{t('spineReplacementPma')}<input type="checkbox" checked={replacementPma} disabled={disabled}
        onChange={event => setReplacementPma(event.currentTarget.checked)} /></label>
      <label>{t('spineReplaceAtlasPage')}<select value="" disabled={disabled} onChange={event => {
        const image = imageAssets.find(asset => asset.alias === event.currentTarget.value);
        if (image) replaceTexture(page, image, replacementPma);
      }}>
        <option value="" disabled>{t('spineChooseAtlasPageReplacement')}</option>
        {imageAssets.map(image => <option key={image.alias} value={image.alias}>{image.name ?? image.path}</option>)}
      </select></label>
    </>}
    <label>{t('spineSlot')}<select value={slot?.name ?? ''} disabled={disabled || !slots.length}
      onChange={event => selectSlot(event.currentTarget.value)}>
      {!slot && <option value="">—</option>}{slots.map(item => <option key={item.name}>{item.name}</option>)}
    </select></label>
    <AddName label={t('spineAddSlot')} value={newSlot} change={setNewSlot}
      disabled={disabled || slots.some(item => item.name === newSlot.trim())} add={name => {
        if (apply(() => replaceSpineSection(document, 'slots', [...slots, { name, bone: document.bones[0].name }]))) {
          selectSlot(name); setNewSlot('');
        }
      }} />
    {slot && <>
      <label>{t('spineRenameSlot')}<input key={slot.name} defaultValue={slot.name} maxLength={120} disabled={disabled}
        onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}
        onBlur={event => {
          const name = event.currentTarget.value.trim();
          if (name === slot.name) { event.currentTarget.value = name; return; }
          if (apply(() => renameSpineSlot(document, slot.name, name))) selectSlot(name);
          else event.currentTarget.value = slot.name;
        }} /></label>
      <label>{t('spineSlotDrawOrder')}<select value={slots.indexOf(slot)} disabled={disabled || slots.length < 2}
        onChange={event => apply(() => moveSpineSlot(document, slot.name, Number(event.currentTarget.value)))}>
        {slots.map((item, index) => <option key={item.name} value={index}>{index + 1}</option>)}
      </select></label>
      <label>{t('rigBone')}<select value={slot.bone} disabled={disabled}
        onChange={event => modifySlot(item => ({ ...item, bone: event.currentTarget.value }))}>
        {document.bones.map(bone => <option key={bone.name}>{bone.name}</option>)}
      </select></label>
      <label>{t('spineSlotBlend')}<select value={String(slot.blend ?? 'normal')} disabled={disabled}
        onChange={event => modifySlot(item => ({ ...item, blend: event.currentTarget.value }))}>
        {blends.map(blend => <option key={blend} value={blend}>{t(`spineBlend_${blend}`)}</option>)}
      </select></label>
      <fieldset className="spine-key" disabled={disabled}>
        <legend>{t('spineSlotTint')}</legend>
        <SpineColorFields label={t('spineTimeline_light')} alpha value={String(slot.color ?? 'ffffffff')}
          change={color => modifySlot(item => ({ ...item, color }))} />
        <label {...(darkTintRequired && hint(t('spineSlotDarkTint'), t('spineSlotDarkTintRequired')))}>
          {t('spineSlotDarkTint')}<input type="checkbox" checked={darkTint} disabled={darkTintRequired}
            onChange={event => {
              const enabled = event.currentTarget.checked;
              modifySlot(({ dark: _previous, ...item }) => enabled ? { ...item, dark: '000000' } : item);
            }} />
        </label>
        {darkTint && <SpineColorFields label={t('spineTimeline_dark')} value={String(slot.dark)}
          change={dark => modifySlot(item => ({ ...item, dark }))} />}
      </fieldset>
      <IconButton icon={Trash2} label={t('spineRemoveSlot')} description={t('spineRemoveSlotHint')} disabled={disabled}
        onClick={() => {
          if (apply(() => removeSpineSlot(document, slot.name))) {
            selectSlot(slots[slots.indexOf(slot) + 1]?.name ?? slots[slots.indexOf(slot) - 1]?.name ?? '');
            selectAttachment('');
          }
        }} />
    </>}
    <label>{t('assetSkin')}<select value={skin?.name ?? ''} disabled={disabled || !skins.length}
      onChange={event => selectSkin(event.currentTarget.value)}>
      {!skin && <option value="">—</option>}{skins.map(item => <option key={item.name}>{item.name}</option>)}
    </select></label>
    <AddName label={t('spineAddSkin')} value={newSkin} change={setNewSkin}
      actions={skin && <IconButton icon={Copy} type="button" label={t('spineDuplicateSkin')}
        disabled={disabled || !newSkin.trim() || newSkin.trim() === 'default' || skins.some(item => item.name === newSkin.trim())}
        onClick={() => {
          const name = newSkin.trim();
          if (apply(() => duplicateSpineSkin(document, skin.name, name))) {
            selectSkin(name); setNewSkin('');
          }
        }} />}
      disabled={disabled || skins.some(item => item.name === newSkin.trim())} add={name => {
        if (apply(() => replaceSpineSection(document, 'skins', [...skins, { name, attachments: {} }]))) {
          selectSkin(name); setNewSkin('');
        }
      }} />
    {skin && skin.name !== 'default' && <RenameValue label={t('spineRenameSkin')} value={skin.name} disabled={disabled} rename={name => {
      if (!apply(() => renameSpineSkin(document, skin.name, name), { kind: 'skin', from: skin.name, to: name })) return false;
      selectSkin(name);
      return true;
    }} />}
    {skin && skin.name !== 'default' && <IconButton icon={Trash2} label={t('spineRemoveSkin')} description={t('spineRemoveSkinHint')}
      disabled={disabled} onClick={() => {
        if (apply(() => removeSpineSkin(document, skin.name), { kind: 'skin', from: skin.name, to: null })) {
          selectSkin(skins.find(item => item.name === 'default')?.name ?? skins.find(item => item !== skin)?.name ?? '');
          selectAttachment('');
        }
      }} />}
    {error && <small role="alert" className="error">{error}</small>}
    {!error && slot && skin && <>
      <label>{t('spineSetupAttachment')}<select value={slot.attachment ?? ''} disabled={disabled} onChange={event => {
        const value = event.currentTarget.value;
        modifySlot(({ attachment: _previous, ...item }) => value ? { ...item, attachment: value } : item);
      }}>
        <option value="">—</option>
        {slot.attachment && !Object.hasOwn(configured, slot.attachment) && <option>{slot.attachment}</option>}
        {Object.keys(configured).map(key => <option key={key}>{key}</option>)}
      </select></label>
      <label>{t('spineAttachment')}<select value={name ?? ''} disabled={disabled || !name}
        onChange={event => selectAttachment(event.currentTarget.value)}>
        {!name && <option value="">—</option>}{Object.keys(entries).map(key => <option key={key}>{key}</option>)}
      </select></label>
      {name && <RenameValue label={t('spineRenameAttachment')} value={name} disabled={disabled} rename={value => {
        if (!apply(() => renameSpineAttachment(document, slot.name, name, value))) return false;
        selectAttachment(value);
        return true;
      }} />}
      {name && <IconButton icon={Trash2} label={t('spineRemoveAttachment')} description={t('spineRemoveAttachmentHint')} disabled={disabled}
        onClick={() => { if (apply(() => removeSpineAttachment(document, skin.name, slot.name, name))) selectAttachment(''); }} />}
      <label>{t('spineAttachmentType')}<select value={newType} disabled={disabled}
        onChange={event => selectNewType(event.currentTarget.value as AttachmentType)}>
        {types.map(type => <option key={type} value={type}>{t(`spineAttachmentType_${type}`)}</option>)}
      </select></label>
      {textureType && <label>{t('spineAtlasRegion')}<select value={region?.name ?? ''} disabled={disabled || !region}
        onChange={event => selectPath(event.currentTarget.value)}>
        {!region && <option value="">—</option>}{regions.map(item => <option key={item.name}>{item.name}</option>)}
      </select></label>}
      {newType === 'linkedmesh' && <label>{t('spineLinkedParent')}<select value={parent ? parents.indexOf(parent) : -1} disabled={disabled || !parent}
        onChange={event => selectParent(Number(event.currentTarget.value))}>
        {!parent && <option value={-1}>—</option>}
        {parents.map((item, index) => <option key={`${item.skin}/${item.name}`} value={index}>{item.skin} / {item.name}</option>)}
      </select></label>}
      <AddName label={t(newType === 'region' ? 'spineAddAttachment' : 'spineAddTypedAttachment')} value={newAttachment} change={setNewAttachment}
        disabled={disabled || (textureType && !region) || (newType === 'linkedmesh' && !parent) || Object.hasOwn(entries, newAttachment.trim())} add={name => {
          if (apply(() => {
            const create = () => {
              if (!textureType) return createSpineShape(newType as SpineShape);
              if (!region) throw new Error(t('spineAtlasRegion'));
              const initial = { type: 'region', path: region.name, width: region.width, height: region.height };
              if (newType === 'region') return initial;
              if (newType === 'mesh') return regionToSpineMesh(initial, region.trim);
              if (!parent) throw new Error(t('spineLinkedParent'));
              return { ...initial, type: 'linkedmesh', parent: parent.name, skin: parent.skin, timelines: true };
            };
            const next = putSpineAttachment(document, skin.name, slot.name, name, create());
            return slot.attachment ? next : replaceSpineSection(next, 'slots', slots.map(item => item === slot
              ? { ...item, attachment: name } : item));
          })) { selectAttachment(name); setNewAttachment(''); }
        }} />
      {isTextured && !attachment.sequence && <label>{t('spineCurrentAtlasRegion')}
        <select value={currentPath} disabled={disabled || !regions.length}
          onChange={event => updateAttachment({ ...attachment, path: event.currentTarget.value })}>
          {!currentRegion && <option value={currentPath} disabled>{currentPath}</option>}
          {[...new Set(regions.map(region => region.name))].map(path => <option key={path}>{path}</option>)}
        </select>
      </label>}
      {isRegion && fields.map(field => <SpineNumber key={field} label={t(`spineAttachment_${field}`)}
        value={Number(attachment[field] ?? (field.startsWith('scale') ? 1 : 0))} disabled={disabled}
        min={field === 'width' || field === 'height' ? 0.01 : undefined}
        change={value => updateAttachment({ ...attachment, [field]: value })} />)}
      {isRegion && !attachment.sequence && currentRegion && <button className="bundle-command" type="button"
        disabled={disabled || (attachment.width === currentRegion.width && attachment.height === currentRegion.height)}
        onClick={() => updateAttachment({ ...attachment, width: currentRegion.width, height: currentRegion.height })}>
        {t('spineFitAtlasRegion')}
      </button>}
      {isRegion && !attachment.sequence && <button className="bundle-command" type="button" disabled={disabled} onClick={() => {
        apply(() => putSpineAttachment(document, skin.name, slot.name, name!,
          regionToSpineMesh(attachment, currentRegion?.trim)));
      }}>{t('spineConvertMesh')}</button>}
      {typeof attachment?.parent === 'string' && <>
        <label>{t('spineLinkedParent')}<output>{String(attachment.skin || 'default')} / {attachment.parent}</output></label>
        <label>{t('spineLinkedTimeline')}<input type="checkbox" disabled={disabled} checked={attachment.timelines !== false}
          onChange={event => updateAttachment({ ...attachment, timelines: event.currentTarget.checked })} /></label>
        <button type="button" className="bundle-command" disabled={disabled}
          onClick={() => apply(() => makeSpineMeshIndependent(document, { skin: skin.name, slot: slot.name, name: name! }))}>
          {t('spineMakeMeshIndependent')}
        </button>
      </>}
      {isTextured && <>
        <SpineColorFields label={t('spineAttachmentTint')} alpha alphaLabel={t('spineAttachmentAlpha')}
          value={String(attachment.color ?? 'ffffffff')} disabled={disabled}
          change={color => updateAttachment({ ...attachment, color })} />
        <SpineSequenceFields key={`${skin.name}/${slot.name}/${name}`} attachment={attachment} name={name!}
          disabled={disabled} report={report} change={(prefix, sequence) => apply(() => setSpineAttachmentSequence(
            document, { skin: skin.name, slot: slot.name, name: name! }, prefix, sequence, new Set(regions.map(region => region.name)),
          ))} />
      </>}
      {attachment && shape && <SpineShapeFields key={`${skin.name}/${slot.name}/${name}`} attachment={attachment} type={shape}
        slots={slots.filter(item => item !== slot).map(item => item.name)} disabled={disabled} deformKeyed={deformKeyed} change={updateAttachment} />}
      {attachment?.type === 'mesh' && !attachment.parent && <SpineMeshFields key={`${skin.name}/${slot.name}/${name}`}
        attachment={attachment} document={document} slotBone={slot.bone} meshTarget={{ skin: skin.name, slot: slot.name, name: name! }}
        disabled={disabled} change={updateAttachment} changeDocument={change} report={report} />}
    </>}
  </>;
}

export function RenameValue({ label, value, disabled, rename }: { label: string; value: string; disabled: boolean; rename: (value: string) => boolean }) {
  return <label>{label}<input key={value} defaultValue={value} maxLength={120} disabled={disabled}
    onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}
    onBlur={event => {
      const next = event.currentTarget.value.trim();
      event.currentTarget.value = next === value || rename(next) ? next : value;
    }} /></label>;
}

function AddName({ value, change, label, disabled, add, actions }: {
  value: string; change: (value: string) => void; label: string; disabled: boolean; add: (value: string) => void; actions?: ReactNode;
}) {
  return <form className="spine-studio-add" onSubmit={event => {
    event.preventDefault();
    if (!disabled && value.trim()) add(value.trim());
  }}>
    <input aria-label={label} placeholder={label} value={value} maxLength={120} onChange={event => change(event.currentTarget.value)} />
    <IconButton icon={Plus} type="submit" label={label} disabled={disabled || !value.trim()} />
    {actions}
  </form>;
}
