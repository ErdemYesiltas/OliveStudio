import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react';
import { IconButton } from './chrome';
import { t } from './i18n';

export function SpineSkinLayers({ skins, base, layers, change }: {
  skins: string[]; base: string | null; layers: string[]; change: (layers: string[]) => void;
}) {
  const initial = base && skins.includes(base) ? base : skins.includes('default') ? 'default' : skins[0];
  const choices = skins.filter(name => name !== initial && !layers.includes(name));
  const move = (from: number, to: number) => {
    const next = [...layers];
    const [skin] = next.splice(from, 1);
    next.splice(to, 0, skin);
    change(next);
  };
  return <div className="spine-skin-layers">
    {!!layers.length && <ol aria-label={t('spineSkinLayers')}>
      {layers.map((name, index) => <li key={name}>
        <span title={name}>{name}</span>
        <IconButton icon={ArrowUp} label={t('spineMoveSkinEarlier', { name })} disabled={index === 0}
          onClick={() => move(index, index - 1)} />
        <IconButton icon={ArrowDown} label={t('spineMoveSkinLater', { name })} disabled={index === layers.length - 1}
          onClick={() => move(index, index + 1)} />
        <IconButton icon={Trash2} label={t('spineRemoveSkinLayer', { name })} onClick={() => change(layers.filter(item => item !== name))} />
      </li>)}
    </ol>}
    <select aria-label={t('spineAddSkinLayer')} value="" disabled={!choices.length} onChange={event => {
      const name = event.currentTarget.value;
      if (choices.includes(name)) change([...layers, name]);
    }}>
      <option value="">{t('spineAddSkinLayer')}</option>
      {choices.map(name => <option key={name}>{name}</option>)}
    </select>
  </div>;
}
