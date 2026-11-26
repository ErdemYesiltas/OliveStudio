import { Box, Boxes, CopyPlus, Pencil, Plus, RotateCcw, Save, Unlink } from 'lucide-react';
import { IconButton, PanelHeader } from './chrome';
import { t } from './i18n';
import { prefabLimit, type Prefab } from './prefabs';
import { valueSource } from './valueDrag';
import type { ReactNode } from 'react';

export function PrefabsPanel({ prefabs, active, choose, editable, canCapture, editing, linked, canPlace, capture, place, edit, variant, apply, revert, unpack, brushes }: {
  prefabs: readonly Prefab[]; active?: Prefab; choose: (id: string) => void; editable: boolean; canCapture: boolean;
  editing: boolean; linked?: Prefab; canPlace: boolean;
  capture: () => void; place: (prefab: Prefab) => void; edit: (prefab: Prefab) => void; variant: (prefab: Prefab) => void;
  apply: () => void; revert: () => void; unpack: () => void;
  brushes: ReactNode;
}) {
  return <section className="panel" aria-label={t('prefabs')}>
    <PanelHeader icon={Boxes} label={t('prefabs')} description={t('prefabsHint')}>
      <div className="panel-tools">
        <IconButton icon={Plus} label={t('capturePrefab')} disabled={!editable || !canCapture} onClick={capture} />
        <IconButton icon={Box} label={t('placePrefab')} disabled={!editable || !active || !canPlace} onClick={() => active && place(active)} />
        <IconButton icon={Pencil} label={t('editPrefab')} disabled={!editable || !active || editing} onClick={() => active && edit(active)} />
        <IconButton icon={CopyPlus} label={t('createPrefabVariant')} disabled={!editable || !active || editing || prefabs.length >= prefabLimit}
          onClick={() => active && variant(active)} />
      </div>
    </PanelHeader>
    <div className="panel-body scenes-body">
      {linked && <div className="prefab-instance">
        <span>{t('prefabLinkedSource', { name: linked.name })}</span>
        <div className="panel-tools">
          <IconButton icon={Save} label={t('applyPrefabOverrides')} disabled={!editable || editing} onClick={apply} />
          <IconButton icon={RotateCcw} label={t('revertPrefabOverrides')} disabled={!editable} onClick={revert} />
          <IconButton icon={Unlink} label={t('unpackPrefab')} disabled={!editable} onClick={unpack} />
        </div>
      </div>}
      <div className="scenes-list" role="group" aria-label={t('prefabLibrary')}>
        {prefabs.map(prefab => <button key={prefab.id} className="tree-object" type="button" aria-pressed={prefab.id === active?.id}
          aria-description={prefab.base ? t('prefabVariantOf', { name: prefabs.find(item => item.id === prefab.base)?.name ?? '' }) : undefined}
          onClick={() => choose(prefab.id)} {...(editable && !editing && valueSource('prefab', prefab.id))}>
          <Box size={14} aria-hidden="true" /><span>{prefab.name}</span>
        </button>)}
      </div>
      <details><summary>{t('brushes')}</summary>{brushes}</details>
    </div>
  </section>;
}
