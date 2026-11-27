import { useMemo, useRef, useState, type DragEvent, type MouseEvent, type ReactNode } from 'react';
import { Bone, Box, Cable, Camera, ChevronDown, ChevronRight, CopyMinus, CopyPlus, Eye, EyeOff, Film, FolderTree, Grid2X2, Headphones, Image as ImageIcon, Lightbulb, ListFilter, Lock, PanelsTopLeft, Shapes, Sparkles, Table2, Type, Volume2, Waypoints, Workflow } from 'lucide-react';
import { hint, IconButton } from './chrome';
import { objectTypeKey, t } from './i18n';
import { moveObject, type DropTarget, type SceneObject } from './scene';
import { toggleSelection } from './selection';
import { objectAssetKind } from './assetLibrary';
import type { Asset } from './assets';
import { dropOne, startValueDrag } from './valueDrag';

const itemType = 'application/x-olivestudio-object';
export const objectIcons = {
  Container: Box, Sprite: ImageIcon, Text: Type, BitmapText: Waypoints,
  Graphics: Shapes, TilingSprite: Grid2X2, NineSliceSprite: PanelsTopLeft, AnimatedSprite: Film, Spine: Bone,
  MeshPlane: Workflow, MeshRope: Cable, Tilemap: Table2, Particles: Sparkles,
  AudioSource: Volume2, AudioListener: Headphones, Camera2D: Camera, Light2D: Lightbulb,
  UIWidget: PanelsTopLeft,
};

const objectTypes = Object.keys(objectIcons) as SceneObject['type'][];

function filterTree(nodes: SceneObject[], type: SceneObject['type']): SceneObject[] {
  return nodes.flatMap<SceneObject>(node => {
    if (node.type !== 'Container') return node.type === type ? [node] : [];
    const children = filterTree(node.children, type);
    return node.type === type || children.length ? [{ ...node, children }] : [];
  });
}

export function Hierarchy({ nodes, selected, select, locked, closed, toggle, groups, setGroupsExpanded, editable, onMove, assets, assignAsset, setVisible }: {
  nodes: SceneObject[]; selected: readonly string[]; select: (ids: string[]) => void; locked: ReadonlySet<string>;
  closed: ReadonlySet<string>; toggle: (id: string) => void; editable: boolean;
  groups: readonly string[]; setGroupsExpanded: (expanded: boolean) => void;
  onMove: (id: string, destination: DropTarget) => void;
  assets: ReadonlyMap<string, Asset>; assignAsset: (id: string, alias: string) => void;
  setVisible: (id: string, visible: boolean) => void;
}) {
  const [dragged, setDragged] = useState<string | null>(null);
  const [target, setTarget] = useState<DropTarget | null>(null);
  const [type, setType] = useState<SceneObject['type'] | ''>('');
  const [filterClosed, setFilterClosed] = useState<string[]>([]);
  const anchor = useRef<string | null>(null);
  const displayed = useMemo(() => type ? filterTree(nodes, type) : nodes, [nodes, type]);
  const collapsed = type ? new Set(filterClosed) : closed;
  const expandableIds = type ? collectGroups(displayed) : groups;
  const hasExpandedGroups = expandableIds.some(id => !collapsed.has(id));

  function visibleIds(items: SceneObject[]): string[] {
    return items.flatMap(node => [node.id, ...(node.type === 'Container' && !collapsed.has(node.id) ? visibleIds(node.children) : [])]);
  }

  function pick(id: string, event: MouseEvent) {
    const additive = event.metaKey || event.ctrlKey;
    if (event.shiftKey && selected.length) {
      const ids = visibleIds(displayed);
      const start = anchor.current && selected.includes(anchor.current) ? anchor.current : selected.at(-1)!;
      const from = ids.indexOf(start), to = ids.indexOf(id);
      if (from >= 0 && to >= 0) {
        const range = ids.slice(Math.min(from, to), Math.max(from, to) + 1).filter(item => item !== id);
        select([...new Set([...(additive ? selected.filter(item => item !== id) : []), ...range]), id]);
        anchor.current = start;
        return;
      }
    }
    anchor.current = id;
    select(additive ? toggleSelection(selected, id) : [id]);
  }

  function clear() {
    setDragged(null);
    setTarget(null);
  }

  function over(event: DragEvent<HTMLElement>, id: string | null, container: boolean) {
    if (!dragged || !editable || !event.dataTransfer.types.includes(itemType)) return;
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const offset = (event.clientY - bounds.top) / bounds.height;
    const placement = id === null || (container && offset > 0.24 && offset < 0.76)
      ? 'inside' : offset < 0.5 ? 'before' : 'after';
    const next = { id, placement } as const;
    const allowed = !(id && placement === 'inside' && locked.has(id)) && moveObject(nodes, dragged, next) !== nodes;
    event.dataTransfer.dropEffect = allowed ? 'move' : 'none';
    setTarget(allowed ? next : null);
  }

  function drop(event: DragEvent<HTMLElement>, id: string | null) {
    const source = event.dataTransfer.getData(itemType);
    if (!source) return;
    event.preventDefault();
    if (editable && source === dragged && target && target.id === id) onMove(source, target);
    clear();
  }

  function leave(event: DragEvent<HTMLElement>, id: string | null) {
    if (target?.id === id && (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget))) {
      setTarget(null);
    }
  }

  const selectedIds = new Set(selected);
  function tree(items: SceneObject[], parentVisible = true): ReactNode {
    return <ul className="object-list">
      {items.map(node => {
        const rig = node.type === 'Container' ? node.rig : undefined;
        const Icon = rig?.kind === 'bone' ? Bone : rig ? Workflow : objectIcons[node.type];
        const expandable = node.type === 'Container' && Boolean(node.children.length);
        const expanded = !collapsed.has(node.id);
        const visible = parentVisible && node.visible;
        const visibilityLabel = t(node.visible ? 'hierarchyHideObject' : 'hierarchyShowObject', { name: node.label });
        const expandLabel = t(expanded ? 'collapseGroup' : 'expandGroup', { name: node.label });
        const kind = objectAssetKind(node);
        const assetDrop = dropOne('asset', alias => {
          const asset = assets.get(alias);
          return editable && !locked.has(node.id) && !!asset &&
            (rig ? asset.kind === 'image' || asset.kind === 'sheet' : asset.kind === kind);
        },
          alias => assignAsset(node.id, alias));
        return <li key={node.id}>
          <div className="tree-row" data-object-type={node.type} data-visible={visible}
            data-selected={selectedIds.has(node.id)} data-drop={target?.id === node.id ? target.placement : undefined}
            data-dragging={dragged === node.id} draggable={editable && !locked.has(node.id)}
            onDragStart={event => {
              event.dataTransfer.setData(itemType, node.id);
              startValueDrag(event, 'object', selectedIds.has(node.id) ? selected : [node.id], 'copyMove');
              setDragged(node.id);
            }}
            onDragEnd={clear} onDragOver={event => { assetDrop.onDragOver?.(event); over(event, node.id, node.type === 'Container'); }}
            onDragLeave={event => { assetDrop.onDragLeave?.(event); leave(event, node.id); }}
            onDrop={event => { assetDrop.onDrop?.(event); drop(event, node.id); }}>
            {expandable ? <button className="tree-toggle" aria-label={expandLabel} {...hint(expandLabel)}
              aria-expanded={expanded} onClick={() => type
                ? setFilterClosed(current => toggleSelection(current, node.id)) : toggle(node.id)}>
              {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            </button> : <span className="tree-spacer" />}
            <button className="tree-object" aria-pressed={selectedIds.has(node.id)} onClick={event => pick(node.id, event)}
              aria-description={locked.has(node.id) ? t('objectLocked') : undefined}
              {...hint(node.label, t(rig ? rig.kind === 'bone' ? 'rigBone' : 'rigSkeleton' : objectTypeKey[node.type]))}>
              <Icon size={15} aria-hidden="true" /><span>{node.label}</span>
              {locked.has(node.id) && <Lock className="tree-lock" size={12} aria-hidden="true" />}
            </button>
            <IconButton icon={node.visible ? Eye : EyeOff} className="tree-visibility" label={visibilityLabel}
              data-hidden={!node.visible}
              description={!parentVisible ? t('hierarchyHiddenByParent') : undefined}
              disabled={!editable || locked.has(node.id)} onClick={() => setVisible(node.id, !node.visible)} />
          </div>
          {node.type === 'Container' && expandable && expanded && tree(node.children, visible)}
        </li>;
      })}
    </ul>;
  }

  return <div className="panel-body">
    <div className="hierarchy-root" data-drop={target?.id === null ? target.placement : undefined}
      onDragOver={event => over(event, null, true)} onDragLeave={event => leave(event, null)} onDrop={event => drop(event, null)}>
      <button className="tree-object" aria-pressed={!selected.length} aria-label={t('sceneRoot')}
        aria-description={t('sceneRootHint')} {...hint(t('sceneRoot'), t('sceneRootHint'))} onClick={() => { anchor.current = null; select([]); }}>
        <FolderTree size={16} aria-hidden="true" />
      </button>
      <label className="hierarchy-filter" {...hint(t('hierarchyTypeFilter'))}>
        <ListFilter size={14} aria-hidden="true" />
        <select aria-label={t('hierarchyTypeFilter')} value={type} onChange={event => {
          const value = objectTypes.find(type => type === event.target.value);
          setType(value ?? '');
          setFilterClosed([]);
        }}>
          <option value="">{t('hierarchyAllTypes')}</option>
          {objectTypes.map(type => <option key={type} value={type}>{t(objectTypeKey[type])}</option>)}
        </select>
      </label>
      <IconButton icon={hasExpandedGroups ? CopyMinus : CopyPlus}
        label={t(hasExpandedGroups ? 'hierarchyCollapseAll' : 'hierarchyExpandAll')}
        disabled={!expandableIds.length} onClick={() => type
          ? setFilterClosed(hasExpandedGroups ? [...expandableIds] : []) : setGroupsExpanded(!hasExpandedGroups)} />
    </div>
    {displayed.length ? tree(displayed) : <p className="empty">{t(type ? 'hierarchyNoMatchingObjects' : 'emptyScene')}</p>}
  </div>;
}

function collectGroups(nodes: SceneObject[]): string[] {
  return nodes.flatMap(node => node.type === 'Container' && node.children.length
    ? [node.id, ...collectGroups(node.children)] : []);
}
