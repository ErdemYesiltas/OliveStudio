import { BindingSchema, InputMapSchema, type Binding, type InputAction, type InputMap } from '@rewrite/input';
import { Gamepad2, Hand, Keyboard, Plus, X } from 'lucide-react';
import { useEffect, useEffectEvent, useState } from 'react';
import type { Global } from '@rewrite/interactions';
import { IconButton, PanelHeader } from './chrome';
import { Numeric } from './Inspector';
import { connectedGamepad, type InputValues } from './input';
import { t } from './i18n';

type Capture = { id: string; kind: InputAction['kind']; negative?: string };
const indices = Array.from({ length: 8 }, (_, index) => index);

function labelBinding(binding: Binding) {
  switch (binding.type) {
    case 'key': return binding.code;
    case 'keyAxis': return `${binding.negative} / ${binding.positive}`;
    case 'mouse': return t('inputMouseButton', { index: binding.button + 1 });
    case 'touch': return t('inputTouch');
    case 'gamepadButton': return t('inputGamepadButton', { index: binding.index });
    case 'gamepadAxis': return t(binding.invert ? 'inputGamepadInverted' : 'inputGamepadAxis', { index: binding.index });
  }
}

export function InputPanel({ map, running, values, editable, visible, change, globals }: {
  map: InputMap; running: boolean; values: InputValues; editable: boolean;
  visible: boolean; change: (value: InputMap) => void;
  globals: readonly Global[];
}) {
  const [capture, setCapture] = useState<Capture>();
  const [error, setError] = useState('');

  function write(next: InputMap) {
    const result = InputMapSchema.safeParse(next);
    if (!result.success) {
      setError(t('inputInvalidActions'));
      return false;
    }
    setError('');
    change(result.data);
    return true;
  }

  function patch(id: string, update: (action: InputAction) => InputAction) {
    return write({ ...map, actions: map.actions.map(action => action.id === id ? update(action) : action) });
  }

  function bind(id: string, binding: Binding) {
    const action = map.actions.find(action => action.id === id);
    if (!action || action.bindings.length >= 16 || action.bindings.some(item => JSON.stringify(item) === JSON.stringify(binding))) return;
    patch(id, item => ({ ...item, bindings: [...item.bindings, binding] }));
  }

  const finishCapture = useEffectEvent((id: string, binding: Binding) => {
    if (editable && visible) bind(id, binding);
    setCapture(undefined);
  });

  useEffect(() => {
    if (!editable || !visible) setCapture(undefined);
  }, [editable, visible]);

  useEffect(() => {
    if (!capture || !editable || !visible) return;
    const { id, kind, negative } = capture;
    const key = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape') { setCapture(undefined); return; }
      if (event.repeat || !BindingSchema.safeParse({ type: 'key', code: event.code }).success) return;
      if (kind === 'button') finishCapture(id, { type: 'key', code: event.code });
      else if (!negative) setCapture({ ...capture, negative: event.code });
      else if (negative !== event.code) finishCapture(id, { type: 'keyAxis', negative, positive: event.code });
    };
    window.addEventListener('keydown', key, true);
    let frame = 0;
    if (kind === 'button') {
      let held = connectedGamepad()?.buttons.map(button => button.pressed) ?? [];
      const poll = () => {
        const next = connectedGamepad()?.buttons.map(button => button.pressed) ?? [];
        const index = next.findIndex((pressed, i) => i < 32 && pressed && !held[i]);
        if (index >= 0) {
          finishCapture(id, { type: 'gamepadButton', index });
          return;
        }
        held = next;
        frame = requestAnimationFrame(poll);
      };
      frame = requestAnimationFrame(poll);
    }
    return () => {
      window.removeEventListener('keydown', key, true);
      cancelAnimationFrame(frame);
    };
  }, [capture, editable, visible]);

  function add() {
    if (map.actions.length >= 64) return;
    const names = new Set(map.actions.map(action => action.name));
    let index = 1;
    while (names.has(`action_${index}`)) index++;
    write({ ...map, actions: [...map.actions, { id: crypto.randomUUID(), name: `action_${index}`, kind: 'button', bindings: [] }] });
  }

  return <section className="panel" aria-label={t('inputMap')}>
    <PanelHeader icon={Gamepad2} label={t('inputMap')} description={t('inputMapHint')}>
      <div className="panel-tools"><IconButton icon={Plus} label={t('inputAddAction')}
        disabled={!editable || map.actions.length >= 64} onClick={add} /></div>
    </PanelHeader>
    <div className="panel-body scenes-body input-panel">
      <label className="input-settings">{t('inputDeadzone')}
        <Numeric value={map.deadzone} min={0} max={0.9} disabled={!editable} commit={deadzone => write({ ...map, deadzone })} />
      </label>
      {error && <p className="error" role="alert">{error}</p>}
      {map.actions.map((action, index) => {
        const value = values[action.name] ?? (action.kind === 'button' ? false : 0);
        const full = action.bindings.length >= 16;
        return <div key={action.id} className="input-action" aria-label={action.name}>
          <div className="input-action-header">
            <input key={action.name} defaultValue={action.name} disabled={!editable}
              aria-label={t('inputActionName', { index: index + 1 })} onBlur={event => {
                const name = event.currentTarget.value.trim();
                if (name !== action.name && !patch(action.id, item => ({ ...item, name }))) event.currentTarget.value = action.name;
              }} onKeyDown={event => {
                if (event.key === 'Enter') event.currentTarget.blur();
                if (event.key === 'Escape') { event.currentTarget.value = action.name; event.currentTarget.blur(); }
              }} />
            <select value={action.kind} aria-label={t('inputActionType', { name: action.name })} disabled={!editable}
              onChange={event => {
                const kind = event.target.value === 'axis' ? 'axis' : 'button';
                setCapture(undefined);
                patch(action.id, item => ({ id: item.id, name: item.name, kind, bindings: [] }));
              }}>
              <option value="button">{t('inputButton')}</option><option value="axis">{t('inputAxis')}</option>
            </select>
            <IconButton icon={X} label={t('inputRemoveAction', { name: action.name })} disabled={!editable} onClick={() => {
              if (capture?.id === action.id) setCapture(undefined);
              write({ ...map, actions: map.actions.filter(item => item.id !== action.id) });
            }} />
          </div>
          {running && <output className="input-value" aria-label={t('inputLiveValue', { name: action.name })}>
            {typeof value === 'boolean' ? t(value ? 'inputPressed' : 'inputReleased') : value}
          </output>}
          {action.bindings.length > 0 && <ul className="input-bindings">{action.bindings.map((binding, i) =>
            <li key={`${i}:${labelBinding(binding)}`}><span>{labelBinding(binding)}</span>
              <IconButton icon={X} label={t('inputRemoveBinding', { binding: labelBinding(binding) })} disabled={!editable}
                onClick={() => patch(action.id, item => ({ ...item, bindings: item.bindings.filter((_, j) => j !== i) }))} />
            </li>)}</ul>}
          {capture?.id === action.id ? <div className="input-capture" role="status"
            onContextMenu={event => event.preventDefault()} onPointerDown={event => {
              if (!editable || capture.kind !== 'button' || event.button < 0 || event.button > 4) return;
              event.preventDefault();
              bind(action.id, event.pointerType === 'touch' ? { type: 'touch' } : { type: 'mouse', button: event.button });
              setCapture(undefined);
            }}>
            {t(capture.kind === 'button' ? 'inputListeningButton' : capture.negative ? 'inputListeningPositive' : 'inputListeningNegative')}
          </div> : <div className="input-binding-tools">
            <IconButton icon={Keyboard} label={t(action.kind === 'button' ? 'inputListenButton' : 'inputListenAxis', { name: action.name })}
              disabled={!editable || full} onClick={() => setCapture({ id: action.id, kind: action.kind })} />
            {action.kind === 'button' ? <IconButton icon={Hand} label={t('inputBindTouch', { name: action.name })}
              disabled={!editable || full || action.bindings.some(item => item.type === 'touch')}
              onClick={() => bind(action.id, { type: 'touch' })} /> :
              <select aria-label={t('inputGamepadForAction', { name: action.name })} value="" disabled={!editable || full}
                onChange={event => {
                  const [index, invert] = event.target.value.split(':');
                  if (index) bind(action.id, { type: 'gamepadAxis', index: Number(index), invert: invert === 'yes' });
                }}>
                <option value="">{t('inputBindGamepadAxis')}</option>
                {indices.flatMap(index => [
                  <option key={index} value={`${index}:no`}>{t('inputGamepadAxis', { index })}</option>,
                  <option key={`${index}:inverted`} value={`${index}:yes`}>{t('inputGamepadInverted', { index })}</option>,
                ])}
              </select>}
          </div>}
          {action.kind === 'axis' && <label className="input-settings">{t('inputWriteGlobal')}
            <select value={action.globalId ?? ''} aria-label={t('inputWriteGlobalFor', { name: action.name })} disabled={!editable}
              onChange={event => {
                const globalId = event.target.value;
                patch(action.id, item => {
                  const { globalId: _old, ...base } = item;
                  return globalId ? { ...base, globalId } : base;
                });
              }}>
              <option value="">{t('inputNoGlobal')}</option>
              {globals.filter(item => item.type === 'number').map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>}
        </div>;
      })}
    </div>
  </section>;
}
