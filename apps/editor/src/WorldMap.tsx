import { useState } from 'react';
import { PortalSchema, WorldSchema } from '@rewrite/production-tools/contracts';
import { type Project } from './project';
import { validationMessage } from './scene';
import { t } from './i18n';
import { emptyWorld, worldDiagnostics, type World } from './world';

export function WorldMap({ project, active, edit, select }: {
  project: Project; active: string; edit: (world: World) => void; select: (id: string) => void;
}) {
  const world = project.world ?? emptyWorld;
  const fallback = project.scenes.find(scene => scene.id !== active)?.id ?? '';
  const [target, setTarget] = useState(fallback);
  const destination = project.scenes.some(scene => scene.id === target && scene.id !== active) ? target : fallback;
  const [error, setError] = useState('');
  const rooms = project.scenes.map((scene, index) => {
    const custom = world.rooms.find(room => room.sceneId === scene.id);
    return { scene, x: index % 3 * 150, y: Math.floor(index / 3) * 85, ...custom };
  });
  const room = rooms.find(room => room.scene.id === active);
  const edges = project.scenes.flatMap(scene => scene.links.filter(link => link.mode !== 'remove')
    .map(link => ({ from: scene.id, to: link.target })));
  const portals = world.portals.map(portal => ({ from: portal.fromScene, to: portal.toScene }));
  const roots = (id: string) => project.scenes.find(scene => scene.id === id)?.objects.filter(node => node.type !== 'Camera2D' && !node.screenSpace) ?? [];
  const sourceObjects = roots(active), targetObjects = roots(destination);
  const info = worldDiagnostics(project);
  const write = (next: World) => {
    setError('');
    try { edit(WorldSchema.parse(next)); } catch (error) { setError(validationMessage(error)); }
  };
  const roomX = rooms.map(room => room.x), roomY = rooms.map(room => room.y);
  const minX = Math.min(0, ...roomX) - 10, minY = Math.min(0, ...roomY) - 10;
  return <section className="world-map">
    <svg role="img" aria-label={t('worldMap')}
      viewBox={`${minX} ${minY} ${Math.max(140, ...roomX.map(x => x + 140)) - minX} ${Math.max(75, ...roomY.map(y => y + 75)) - minY}`}>
      {[...edges, ...portals].map(({ from, to }, index) => {
        const a = rooms.find(room => room.scene.id === from), b = rooms.find(room => room.scene.id === to);
        return a && b && <line key={index} x1={a.x + 60} y1={a.y + 26} x2={b.x + 60} y2={b.y + 26}
          stroke="var(--muted)" strokeDasharray={index >= edges.length ? '5 4' : undefined} />;
      })}
      {rooms.map(({ scene, x, y }) => <g key={scene.id} role="button" aria-label={scene.name} tabIndex={0}
        onKeyDown={event => { if (event.key === 'Enter') select(scene.id); }} onClick={() => select(scene.id)}>
        <rect x={x} y={y} width="120" height="52" rx="5" fill="var(--panel)"
          stroke={scene.id === active ? 'var(--accent)' : 'var(--muted)'} />
        <text x={x + 8} y={y + 31}>{scene.name.length > 17 ? scene.name.slice(0, 16) + '…' : scene.name}</text>
      </g>)}
    </svg>
    {room && <div className="inline-row">
      {(['x', 'y'] as const).map(axis => <label key={axis}>{t(axis === 'x' ? 'worldMapX' : 'worldMapY')}
        <input type="number" min={-100000} max={100000} key={room[axis]} defaultValue={room[axis]} onBlur={event => {
          const { validity, valueAsNumber } = event.currentTarget;
          if (!validity.valid || !Number.isFinite(valueAsNumber) || valueAsNumber === room[axis]) return;
          const roomData = { sceneId: active, x: room.x, y: room.y, width: 960, height: 540, [axis]: valueAsNumber };
          write({ ...world, rooms: [...world.rooms.filter(room => room.sceneId !== active), roomData] });
        }} /></label>)}
    </div>}
    {info.unreachable.length > 0 && <small>{t('worldUnreachable', { names: info.unreachable.map(scene => scene.name).join(', ') })}</small>}
    {[...info.invalid, error].filter(Boolean).map((problem, index) => <small className="error" key={index}>{problem}</small>)}
    <form className="world-portal-form" key={active + destination} onSubmit={event => {
      event.preventDefault();
      setError('');
      const data = new FormData(event.currentTarget);
      try {
        const portal = PortalSchema.parse({
          id: crypto.randomUUID(), name: data.get('name'), fromScene: active, toScene: destination,
          fromEntity: data.get('marker'), fromActor: data.get('actor'), toSpawn: data.get('spawn'), toActor: data.get('targetActor'),
          mode: data.get('mode'), radius: Number(data.get('radius')), action: data.get('input'),
        });
        write({ ...world, portals: [...world.portals, portal] });
      } catch (error) { setError(validationMessage(error)); }
    }}>
      <strong>{t('worldAddPortal')}</strong>
      <label>{t('worldDestination')} <select value={destination} onChange={event => setTarget(event.target.value)}>
        {project.scenes.filter(scene => scene.id !== active).map(scene => <option key={scene.id} value={scene.id}>{scene.name}</option>)}
      </select></label>
      <label>{t('worldPortalName')} <input name="name" required maxLength={100} /></label>
      {([{ key: 'marker', label: 'worldMarker', objects: sourceObjects }, { key: 'actor', label: 'worldActor', objects: sourceObjects },
        { key: 'spawn', label: 'worldSpawn', objects: targetObjects }, { key: 'targetActor', label: 'worldTargetActor', objects: targetObjects }] as const)
        .map(({ key, label, objects }) => <label key={key}>{t(label)} <select name={key} required>
          {objects.map(node => <option key={node.id} value={node.id}>{node.label}</option>)}
        </select></label>)}
      <label>{t('worldActivation')} <select name="mode"><option value="click">{t('worldClick')}</option><option value="near">{t('worldNear')}</option></select></label>
      <label>{t('worldRadius')} <input name="radius" type="number" min={1} max={1000} defaultValue={48} required /></label>
      <label>{t('worldInput')} <select name="input"><option value="">—</option>
        {project.inputMap.actions.filter(action => action.kind === 'button').map(action => <option key={action.id}>{action.name}</option>)}
      </select></label>
      <button type="submit" disabled={!destination || !sourceObjects.length || !targetObjects.length}>{t('worldAddPortal')}</button>
    </form>
    {world.portals.filter(portal => portal.fromScene === active).map(portal => <div className="inline-row" key={portal.id}>
      <span>{portal.name} → {project.scenes.find(scene => scene.id === portal.toScene)?.name}</span>
      <button type="button" onClick={() => write({ ...world, portals: world.portals.filter(item => item.id !== portal.id) })}>{t('worldRemovePortal')}</button>
    </div>)}
  </section>;
}
