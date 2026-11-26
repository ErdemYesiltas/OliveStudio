import {
  bodyTypes, defaultRigidBody, jointKinds, layersCollide, parsePoints, physicsLayerCount, setLayerPair,
  type JointData, type PhysicsSettings, type RigidBodyData,
} from '@rewrite/physics/contracts';
import { Box, Eye, FastForward, Link2, Pause, Play, Plus, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { IconButton, PanelHeader } from './chrome';
import { t, type MessageKey } from './i18n';
import { Numeric } from './Inspector';
import { colliderKinds, emptyPhysics, newCollider, newJoint, type Collider, type ObjectPhysics } from './physicsModel';
import type { PhysicsStatus } from './scenePhysics';
import { dropOne } from './valueDrag';

type FitBounds = { width: number; height: number; offsetX: number; offsetY: number };
type NumericKey<T> = { [K in keyof T]: T[K] extends number ? K : never }[keyof T] & string;
type NumberSpec<T> = readonly [NumericKey<T>, number, number, step?: number, slider?: boolean];

function text(key: string) { return t(`physics_${key}` as MessageKey); }

function Row({ label, children }: { label: string; children: ReactNode }) {
  return <label className="physics-field"><span>{label}</span>{children}</label>;
}

function NumberFields<T>({ value, specs, change }: { value: T; specs: readonly NumberSpec<T>[]; change: (patch: Partial<T>) => void }) {
  return specs.map(([key, min, max, step, slider]) => {
    const label = text(key);
    const commit = (number: number) => change({ [key]: number } as Partial<T>);
    return <Row key={key} label={label}>
      <span className={slider ? 'inspector-range physics-range' : 'physics-number'}>
        {slider && <input type="range" aria-label={t('physics_sliderFor', { name: label })} min={min} max={max}
          step={step ?? 0.01} value={Number(value[key])} onChange={event => commit(Number(event.target.value))} />}
        <Numeric label={label} value={Number(value[key])} min={min} max={max} step={step} commit={commit} />
      </span>
    </Row>;
  });
}

const bodyNumbers = [
  ['mass', 0, 100000], ['density', 0.000001, 1, 0.000001],
  ['friction', 0, 1, 0.01, true], ['frictionStatic', 0, 10, 0.01, true],
  ['restitution', 0, 1, 0.01, true], ['airFriction', 0, 1, 0.01, true],
  ['gravityScale', -10, 10], ['velocityX', -10000, 10000], ['velocityY', -10000, 10000],
  ['angularVelocity', -3600, 3600], ['group', -1000, 1000, 1],
] as const satisfies readonly NumberSpec<RigidBodyData>[];
const jointNumbers = [
  ['anchorX', -10000, 10000], ['anchorY', -10000, 10000], ['targetAnchorX', -1e6, 1e6], ['targetAnchorY', -1e6, 1e6],
  ['length', 0, 100000], ['stiffness', 0, 1, 0.01, true], ['damping', 0, 1, 0.01, true],
] as const satisfies readonly NumberSpec<JointData>[];
const worldNumbers = [
  ['gravityX', -10000, 10000], ['gravityY', -10000, 10000], ['timeScale', 0, 4, 0.01, true],
  ['positionIterations', 1, 30, 1], ['velocityIterations', 1, 30, 1],
] as const satisfies readonly NumberSpec<PhysicsSettings>[];

export function ObjectPhysicsFields({ value, change, layers, targets, fit }: {
  value?: ObjectPhysics; change: (next: ObjectPhysics | undefined) => void; layers: readonly string[];
  targets: readonly { id: string; label: string }[]; fit: () => FitBounds | undefined;
}) {
  const state = value ?? emptyPhysics();
  const { body, colliders, joints } = state;
  const write = (patch: Partial<ObjectPhysics>) => {
    const next = { ...state, ...patch };
    change(next.body || next.colliders.length || next.joints.length ? next : undefined);
  };
  const updateBody = (patch: Partial<RigidBodyData>) => { if (body) write({ body: { ...body, ...patch } }); };
  return <div className="physics-fields">
    <Row label={text('bodyType')}>
      <select aria-label={text('bodyType')} value={body?.bodyType ?? ''} onChange={event => {
        const type = bodyTypes.find(item => item === event.target.value);
        write({ body: type ? { ...(body ?? defaultRigidBody), bodyType: type } : undefined });
      }}>
        <option value="">{text('noBody')}</option>
        {bodyTypes.map(type => <option key={type} value={type}>{text(type)}</option>)}
      </select>
    </Row>
    {body && <div className="physics-component">
      {body.bodyType === 'dynamic' && <NumberFields value={body} specs={bodyNumbers} change={updateBody} />}
      {body.bodyType !== 'dynamic' && <NumberFields value={body} specs={bodyNumbers.filter(([key]) =>
        key === 'friction' || key === 'frictionStatic' || key === 'restitution' || key === 'group')} change={updateBody} />}
      {body.bodyType === 'dynamic' && (['lockRotation', 'draggable', 'bullet'] as const).map(key =>
        <Row key={key} label={text(key)}><input type="checkbox" checked={body[key]}
          onChange={event => updateBody({ [key]: event.target.checked })} /></Row>)}
      <Row label={text('layer')}><select aria-label={text('layer')} value={body.layer}
        onChange={event => updateBody({ layer: Number(event.target.value) })}>
        {layers.map((layer, index) => <option key={index} value={index}>{layer}</option>)}
        {body.layer >= layers.length && <option value={body.layer}>{t('physics_unnamedLayer', { index: body.layer + 1 })}</option>}
      </select></Row>
      <fieldset className="physics-mask"><legend>{text('mask')}</legend>
        {layers.map((layer, index) => <label key={index}><input type="checkbox" checked={!!(body.mask & 2 ** index)}
          onChange={event => updateBody({ mask: event.target.checked ? body.mask | 2 ** index : body.mask & ~(2 ** index) })} />{layer}</label>)}
      </fieldset>
    </div>}
    <Row label={text('addCollider')}>
      <select aria-label={text('addCollider')} value="" disabled={colliders.length >= 16} onChange={event => {
        const kind = colliderKinds.find(item => item === event.target.value);
        if (kind) write({ colliders: [...colliders, newCollider(kind)] });
      }}>
        <option value="">{text('chooseCollider')}</option>
        {colliderKinds.map(kind => <option key={kind} value={kind}>{text(kind)}</option>)}
      </select>
    </Row>
    {colliders.map((item, index) => <ColliderFields key={item.id} item={item} index={index} fit={fit}
      change={next => write({ colliders: colliders.map(current => current.id === item.id ? next : current) })}
      remove={() => write({ colliders: colliders.filter(current => current.id !== item.id) })} />)}
    <div className="physics-component-heading"><span>{text('joints')}</span>
      <IconButton icon={Plus} label={text('addJoint')} disabled={joints.length >= 16}
        onClick={() => write({ joints: [...joints, newJoint()] })} />
    </div>
    {joints.map((joint, index) => {
      const data = joint.data;
      const patch = (fields: Partial<JointData>) => write({
        joints: joints.map(current => current.id === joint.id ? { ...current, data: { ...data, ...fields } } : current),
      });
      return <section key={joint.id} className="physics-component" aria-label={t('physics_jointIndex', { index: index + 1 })}>
        <div className="physics-component-heading"><span><Link2 size={13} aria-hidden="true" />{t('physics_jointIndex', { index: index + 1 })}</span>
          <IconButton icon={Trash2} label={text('removeJoint')} onClick={() => write({ joints: joints.filter(item => item.id !== joint.id) })} />
        </div>
        <Row label={text('jointKind')}><select aria-label={text('jointKind')} value={data.kind}
          onChange={event => patch({ kind: jointKinds.find(item => item === event.target.value) ?? data.kind })}>
          {jointKinds.map(kind => <option key={kind} value={kind}>{text(kind)}</option>)}
        </select></Row>
        <Row label={text('target')}><select aria-label={text('target')} value={data.target} onChange={event => patch({ target: event.target.value })}
          {...dropOne('object', id => id !== data.target && targets.some(item => item.id === id), target => patch({ target }))}>
          <option value="">{text('worldAnchor')}</option>
          {targets.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
          {data.target && !targets.some(item => item.id === data.target) && <option value={data.target}>{text('missingTarget')}</option>}
        </select></Row>
        <NumberFields value={data} specs={jointNumbers} change={patch} />
        <Row label={text('collideConnected')}><input type="checkbox" checked={data.collideConnected}
          onChange={event => patch({ collideConnected: event.target.checked })} /></Row>
      </section>;
    })}
  </div>;
}

function ColliderFields({ item, index, fit, change, remove }: {
  item: Collider; index: number; fit: () => FitBounds | undefined; change: (next: Collider) => void; remove: () => void;
}) {
  const { data } = item;
  const [invalidPolygon, setInvalidPolygon] = useState(false);
  const label = t('physics_colliderIndex', { name: text(item.kind), index: index + 1 });
  const patch = (fields: Partial<Collider['data']>) => change({ ...item, data: { ...data, ...fields } } as Collider);
  function fitVisual() {
    const bounds = fit();
    if (!bounds) return;
    const { width, height, offsetX, offsetY } = bounds;
    const offset = { offsetX: Math.min(10000, Math.max(-10000, offsetX)), offsetY: Math.min(10000, Math.max(-10000, offsetY)) };
    if (item.kind === 'circle') patch({ ...offset, radius: Math.min(5000, Math.max(width, height) / 2) });
    if (item.kind === 'box' || item.kind === 'capsule') patch({ ...offset, width: Math.min(10000, width), height: Math.min(10000, height) });
  }
  return <section className="physics-component" aria-label={label}>
    <div className="physics-component-heading"><span>{label}</span>
      {item.kind !== 'polygon' && <IconButton icon={Box} label={text('fitVisual')} onClick={fitVisual} />}
      <IconButton icon={Trash2} label={text('removeCollider')} onClick={remove} />
    </div>
    <NumberFields value={data} specs={ [['offsetX', -10000, 10000], ['offsetY', -10000, 10000]] } change={patch} />
    {'width' in data && <NumberFields value={data} specs={ [['width', 0.1, 10000], ['height', 0.1, 10000]] } change={patch} />}
    {'radius' in data && <NumberFields value={data} specs={ [['radius', 0.1, 5000]] } change={patch} />}
    {'chamfer' in data && <NumberFields value={data} specs={ [['chamfer', 0, 5000]] } change={patch} />}
    {'points' in data && <Row label={text('points')}><textarea aria-label={text('points')} key={data.points}
      defaultValue={data.points} maxLength={2000} rows={3} onChange={() => setInvalidPolygon(false)} onBlur={event => {
        const input = event.currentTarget;
        try { parsePoints(input.value); if (input.value !== data.points) patch({ points: input.value }); }
        catch { input.value = data.points; setInvalidPolygon(true); }
      }} /></Row>}
    {invalidPolygon && <p className="physics-errors" role="alert">{text('invalidPolygon')}</p>}
    <Row label={text('sensor')}><input type="checkbox" checked={data.sensor}
      onChange={event => patch({ sensor: event.target.checked })} /></Row>
  </section>;
}

export function PhysicsPanel({ settings, editable, debug, toggleDebug, status, layerInUse, change, pause, step }: {
  settings: PhysicsSettings; editable: boolean; debug: boolean; status?: PhysicsStatus;
  layerInUse: boolean; toggleDebug: () => void; pause: (paused: boolean) => void; step: () => void;
  change: (next: PhysicsSettings) => void;
}) {
  const set = (patch: Partial<PhysicsSettings>) => change({ ...settings, ...patch });
  const { layers } = settings;
  return <section className="panel" aria-label={t('physicsPanel')}>
    <PanelHeader icon={Box} label={t('physicsPanel')} description={t('physicsPanelHint')}>
      <IconButton icon={Eye} label={text('showColliders')} aria-pressed={debug} onClick={toggleDebug} />
      <IconButton icon={status?.paused ? Play : Pause} label={text(status?.paused ? 'resume' : 'pause')}
        disabled={!status || !!status.errors.length} onClick={() => pause(!status?.paused)} />
      <IconButton icon={FastForward} label={text('step')} disabled={!status?.paused} onClick={step} />
    </PanelHeader>
    <div className="panel-body physics-panel-body">
      {status && <section aria-label={text('diagnostics')}>
        <output>{t('physics_status', { bodies: status.bodies, steps: status.steps })}</output>
        {!!status.errors.length && <ul className="physics-errors" role="alert">{status.errors.map((error, i) => <li key={i}>{error}</li>)}</ul>}
        {!!status.contacts.length && <ol aria-label={text('contacts')} className="physics-contacts">
          {status.contacts.map((contact, i) => <li key={i}>{t(contact.phase === 'enter' ? 'physics_contactEnter' : 'physics_contactExit',
            { a: contact.a, b: contact.b })}{contact.sensor ? ` · ${text('sensor')}` : ''}</li>)}
        </ol>}
      </section>}
      <fieldset className="physics-fields" disabled={!editable}>
        <NumberFields value={settings} specs={worldNumbers} change={set} />
        {(['sleeping', 'walls'] as const).map(key => <Row key={key} label={text(key)}>
          <input type="checkbox" checked={settings[key]} onChange={event => set({ [key]: event.target.checked })} />
        </Row>)}
        <div className="physics-component-heading"><span>{text('layers')}</span>
          <IconButton icon={Plus} label={text('addLayer')} disabled={layers.length >= physicsLayerCount}
            onClick={() => set({ layers: [...layers, t('physics_unnamedLayer', { index: layers.length + 1 })] })} />
          <IconButton icon={Trash2} label={text('removeLayer')} disabled={layers.length <= 1 || layerInUse}
            onClick={() => set({ layers: layers.slice(0, -1), collisions: settings.collisions?.slice(0, -1).map(row => row | 2 ** (layers.length - 1)) })} />
        </div>
        {layers.map((layer, index) => <Row key={index} label={t('physics_unnamedLayer', { index: index + 1 })}>
          <input type="text" defaultValue={layer} key={layer} maxLength={30} onBlur={event => {
            const name = event.currentTarget.value.trim();
            if (name && name !== layer) set({ layers: layers.map((item, i) => i === index ? name : item) });
            else event.currentTarget.value = layer;
          }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
        </Row>)}
        <table className="physics-matrix">
          <caption>{text('matrix')}</caption>
          <thead><tr><td />{layers.map((layer, index) => <th scope="col" key={index}>{layer}</th>)}</tr></thead>
          <tbody>{layers.map((layer, a) => <tr key={a}><th scope="row">{layer}</th>{layers.map((other, b) =>
            <td key={b}>{b <= a && <input type="checkbox" aria-label={t('physics_layerPair', { a: layer, b: other })}
              checked={layersCollide(settings, a, b)} onChange={event => set({ collisions: setLayerPair(settings, layers.length, a, b, event.target.checked) })} />}</td>)}</tr>)}</tbody>
        </table>
      </fieldset>
    </div>
  </section>;
}
