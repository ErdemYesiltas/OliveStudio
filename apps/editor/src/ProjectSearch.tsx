import { useEffect, useMemo, useRef, useState } from 'react';
import { Boxes, Code2, Database, FolderOpen, Layers3, Search, Shapes, X } from 'lucide-react';
import { type CatalogEntry, objectAsset } from './assetLibrary';
import { IconButton } from './chrome';
import { locale, objectTypeKey, t } from './i18n';
import type { Project } from './project';
import { selectionTree } from './selection';

const icons = { scene: Layers3, object: Shapes, asset: FolderOpen, script: Code2, prefab: Boxes, content: Database };
type SearchKind = keyof typeof icons;
type Result = { kind: SearchKind; id: string; name: string; details?: string; scene?: string; match?: string };

export function ProjectSearch({ project, assets, close, reveal }: {
  project: Project;
  assets: CatalogEntry[];
  close: () => void;
  reveal: (item: Result) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [query, change] = useState('');
  const [kind, setKind] = useState<SearchKind | 'all'>('all');
  useEffect(() => { dialog.current?.showModal(); }, []);
  const results: Result[] = useMemo(() => [
    ...project.scenes.flatMap(scene => {
      const sceneResult = { kind: 'scene' as const, name: scene.name, id: scene.id };
      const objects = [...selectionTree(scene.objects).values()].map(({ node }) => {
        const name = t(objectTypeKey[node.type]);
        const reference = objectAsset(node);
        const script = project.scripts.items.find(item => item.id === (node.behaviour?.scriptId ?? node.behavior?.scriptId))?.name;
        return { kind: 'object' as const, id: node.id, name: node.label, scene: scene.id,
          details: `${scene.name} · ${name}`, match: [reference, script, node.prefab?.source].filter(Boolean).join(' ') };
      });
      return [sceneResult, ...objects];
    }),
    ...assets.map(asset => ({ kind: 'asset' as const, id: asset.alias, name: asset.name, details: asset.kind,
      match: [asset.alias, ...(asset.tags ?? [])].join(' ') })),
    ...project.scripts.items.map(script => ({ kind: 'script' as const, id: script.id, name: script.name })),
    ...project.prefabs.map(prefab => ({ kind: 'prefab' as const, id: prefab.id, name: prefab.name })),
    ...(project.gameData?.tables ?? []).map(item => ({ kind: 'content' as const, id: 'data:' + item.id, name: item.name,
      match: item.fields.map(field => field.label + ' ' + field.key).join(' '), details: t('gameData') })),
    ...(project.content?.dialogues.items ?? []).map(item => ({ kind: 'content' as const, id: 'dialogues:' + item.id, name: item.name, details: t('contentDialogues') })),
    ...(project.content?.achievements.items ?? []).map(item => ({ kind: 'content' as const,
      id: 'achievements:' + item.id, name: item.name, details: t('contentAchievements') })),
  ], [project, assets]);
  const tokens = query.trim().toLocaleLowerCase(locale).split(/\s+/).filter(Boolean);
  const visible = results.filter(item => {
    if (kind !== 'all' && item.kind !== kind) return false;
    const text = [item.id, item.name, item.details, item.match, t(`searchKind_${item.kind}`)].join(' ').toLocaleLowerCase(locale);
    return tokens.every(token => text.includes(token));
  });
  const choose = (item: Result) => { close(); reveal(item); };
  return <dialog ref={dialog} className="project-search" aria-label={t('projectSearch')} onCancel={event => { event.preventDefault(); close(); }}>
    <header className="inline-row">
      <Search size={17} aria-hidden="true" />
      <input type="search" autoFocus aria-label={t('projectSearch')} placeholder={t('projectSearch')} value={query}
        onChange={event => change(event.target.value)} onKeyDown={event => {
          if (event.key === 'Enter' && visible.length) choose(visible[0]);
        }} />
      <select aria-label={t('searchKind')} value={kind} onChange={event => setKind(event.target.value as typeof kind)}>
        <option value="all">{t('searchKind_all')}</option>
        {(Object.keys(icons) as SearchKind[]).map(key => <option value={key} key={key}>{t(`searchKind_${key}`)}</option>)}
      </select>
      <IconButton icon={X} label={t('dismiss')} onClick={close} />
    </header>
    <ol>{visible.slice(0, 150).map(item => {
      const Icon = icons[item.kind];
      return <li key={item.kind + ':' + item.id}><button type="button" onClick={() => choose(item)}>
        <Icon size={15} aria-hidden="true" /><strong>{item.name}</strong><small>{item.details ?? t(`searchKind_${item.kind}`)}</small>
      </button></li>;
    })}</ol>
    {!visible.length && <p>{t('projectSearchEmpty')}</p>}
  </dialog>;
}
