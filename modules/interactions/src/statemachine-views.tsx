import type {SceneService, Entity} from '@rewrite/scene';
import {StateMachineSchema, type StateMachine} from './statemachine';
import type {InteractionCatalog, TriggerDefinition, ActionDefinition} from './index';
import {ActionValueEditor, ConditionEditor, newCondition} from './views';

/** Read-only diagram: states on a circle, arrows for transitions, the current state (during play) highlighted. */
function Diagram({machine, current}: {machine: StateMachine; current?: string}) {
 const n = machine.states.length, r = n > 1 ? 70 : 0, w = 280, h = 190, at = (i: number) => ({x: w / 2 + Math.cos(-Math.PI / 2 + i * 2 * Math.PI / n) * r * 1.4, y: h / 2 + Math.sin(-Math.PI / 2 + i * 2 * Math.PI / n) * r});
 const index = new Map(machine.states.map((s, i) => [s.id, i]));
 return <svg className="state-diagram" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="State diagram" data-current={current ?? ''}>
  <defs><marker id="state-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="currentColor"/></marker></defs>
  {machine.transitions.map(t => {
   const b = at(index.get(t.to) ?? 0), from = t.from === '*' ? null : at(index.get(t.from) ?? 0);
   if (!from) return <line key={t.id} x1={b.x} y1={b.y - 34} x2={b.x} y2={b.y - 16} stroke="currentColor" strokeDasharray="3 3" markerEnd="url(#state-arrow)"/>;
   const dx = b.x - from.x, dy = b.y - from.y, len = Math.hypot(dx, dy) || 1, ox = -dy / len * 6, oy = dx / len * 6;
   return <line key={t.id} x1={from.x + dx / len * 34 + ox} y1={from.y + dy / len * 16 + oy} x2={b.x - dx / len * 34 + ox} y2={b.y - dy / len * 16 + oy} stroke="currentColor" opacity={.7} markerEnd="url(#state-arrow)"/>;
  })}
  {machine.states.map((s, i) => { const p = at(i), active = s.id === current, initial = s.id === machine.initial; return <g key={s.id} data-state={s.name} className={active ? 'state-active' : undefined}>
   <rect x={p.x - 32} y={p.y - 14} width={64} height={28} rx={8} fill={active ? 'var(--accent)' : 'var(--raised)'} stroke={initial ? 'var(--accent)' : 'var(--border)'} strokeWidth={initial ? 2 : 1}/>
   <text x={p.x} y={p.y + 4} textAnchor="middle" fontSize={11} fill={active ? 'var(--bg)' : 'var(--text)'}>{s.name.length > 9 ? s.name.slice(0, 8) + '…' : s.name}</text>
  </g>; })}
 </svg>;
}

/**
 * State machine inspector: diagram, states (name, initial, enter actions) and transitions (from → to on a trigger,
 * optional condition on a global). Every change is one undo step.
 */
export function createStateMachineInspector(bridge: {scene: SceneService; catalog(): InteractionCatalog; triggers(): readonly TriggerDefinition[]; actions(): readonly ActionDefinition[]; useEditable(): boolean; text(key: string): string; report(e: unknown): void; useCurrent(componentId: string): string | undefined}) {
 return function StateMachineInspector({component}: {component: Entity['components'][number]}) {
  const editable = bridge.useEditable(), m = StateMachineSchema.parse(component.data), catalog = bridge.catalog(), triggers = bridge.triggers(), actions = bridge.actions(), t = bridge.text;
  const edit = (fn: (next: StateMachine) => void) => { try { bridge.scene.document.transact('Edit state machine', d => { const c = d.entities.flatMap(e => e.components).find(c => c.id === component.id)!; const next = StateMachineSchema.parse(c.data); fn(next); c.data = StateMachineSchema.parse(next) as never; }); } catch (e) { bridge.report(e); } };
  const options = (items: readonly {id: string; name: string}[], value: string) => <>{!items.some(i => i.id === value) && <option value={value}>{value ? t('interaction.missing') : t('interaction.choose')}</option>}{items.map(i => <option value={i.id} key={i.id}>{i.name}</option>)}</>;
  const states = m.states.map(s => ({id: s.id, name: s.name})), currentName = bridge.useCurrent(component.id), current = m.states.find(s => s.name === currentName)?.id;
  return <div className="state-machine" data-testid="state-machine" data-current={currentName ?? ''}>
   <Diagram machine={m} current={current}/>
   <fieldset><legend>{t('state.states')}</legend>
    {m.states.map((s, i) => <div key={s.id} className="state-row" data-state={s.name}>
     <div className="inline-row">
      <input aria-label={`${t('state.name')} ${i + 1}`} key={s.name} defaultValue={s.name} disabled={!editable} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} onBlur={e => { const name = e.currentTarget.value.trim(); if (name !== s.name) edit(next => { next.states[i].name = name; }); }}/>
      <label className="checkbox" title={t('state.initial')}><input type="radio" name={`initial-${component.id}`} aria-label={`${t('state.initial')} ${s.name}`} checked={m.initial === s.id} disabled={!editable} onChange={() => edit(next => { next.initial = s.id; })}/></label>
      <button aria-label={`${t('state.remove')} ${s.name}`} disabled={!editable || m.states.length < 2} onClick={() => edit(next => { next.states.splice(i, 1); next.transitions = next.transitions.filter(x => x.from !== s.id && x.to !== s.id); if (next.initial === s.id) next.initial = next.states[0].id; })}>×</button>
     </div>
     {s.actions.map((a, j) => { const def = actions.find(d => d.type === a.type); return <div className="inline-row" key={a.id}>
      <select aria-label={`${t('state.enterAction')} ${s.name} ${j + 1}`} disabled={!editable} value={a.type} onChange={e => edit(next => { const d = actions.find(x => x.type === e.target.value)!, x = next.states[i].actions[j]; Object.assign(x, {type: d.type, targetId: d.references(catalog)[0]?.id ?? ''}); delete x.to; delete x.amount; delete x.x; delete x.y; })}>{actions.map(d => <option key={d.type} value={d.type}>{t(d.titleKey)}</option>)}</select>
      <select aria-label={`${t('interaction.target')} ${s.name} ${j + 1}`} disabled={!editable} value={a.targetId} onChange={e => edit(next => { const x = next.states[i].actions[j], g = catalog.globals?.find(v => v.id === e.target.value); x.targetId = e.target.value; if (x.to !== undefined && g && typeof x.to !== g.type) delete x.to; })}>{options(def?.references(catalog) ?? [], a.targetId)}</select>
      <ActionValueEditor action={a} globals={catalog.globals ?? []} entities={catalog.entities} label={`${s.name} ${j + 1}`} disabled={!editable} t={t} edit={fn => edit(next => fn(next.states[i].actions[j]))}/>
      <button aria-label={`${t('interaction.removeAction')} ${s.name} ${j + 1}`} disabled={!editable} onClick={() => edit(next => { next.states[i].actions.splice(j, 1); })}>×</button>
     </div>; })}
     <button disabled={!editable || !actions.length} onClick={() => edit(next => { const d = actions[0]; next.states[i].actions.push({id: crypto.randomUUID(), type: d.type, targetId: d.references(catalog)[0]?.id ?? '', value: true}); })}>{t('state.addEnterAction')}</button>
    </div>)}
    <button disabled={!editable || m.states.length >= 64} onClick={() => edit(next => { const names = new Set(next.states.map(s => s.name)); let k = next.states.length + 1; while (names.has(`state${k}`)) k++; next.states.push({id: crypto.randomUUID(), name: `state${k}`, actions: []}); })}>{t('state.add')}</button>
   </fieldset>
   <fieldset><legend>{t('state.transitions')}</legend>
    {m.transitions.map((x, i) => { const trigger = triggers.find(d => d.type === x.trigger.type), refs = trigger?.references(catalog) ?? [], events = refs.find(r => r.id === x.trigger.sourceId)?.events; return <div key={x.id} className="state-transition" data-transition={i + 1}>
     <div className="inline-row">
      <select aria-label={`${t('state.from')} ${i + 1}`} disabled={!editable} value={x.from} onChange={e => edit(next => { next.transitions[i].from = e.target.value; })}><option value="*">{t('state.any')}</option>{states.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
      <span aria-hidden="true">→</span>
      <select aria-label={`${t('state.to')} ${i + 1}`} disabled={!editable} value={x.to} onChange={e => edit(next => { next.transitions[i].to = e.target.value; })}>{states.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
      <button aria-label={`${t('state.removeTransition')} ${i + 1}`} disabled={!editable} onClick={() => edit(next => { next.transitions.splice(i, 1); })}>×</button>
     </div>
     <label className="field"><span>{t('interaction.trigger')}</span><select aria-label={`${t('state.trigger')} ${i + 1}`} disabled={!editable} value={x.trigger.type} onChange={e => edit(next => { const d = triggers.find(z => z.type === e.target.value)!, ref = d.references(catalog)[0]; next.transitions[i].trigger = {type: d.type, sourceId: ref?.id ?? '', event: ref?.events?.[0]?.id ?? ''}; })}>{triggers.map(d => <option key={d.type} value={d.type}>{t(d.titleKey)}</option>)}</select></label>
     <label className="field"><span>{t('interaction.source')}</span><select aria-label={`${t('state.triggerSource')} ${i + 1}`} disabled={!editable} value={x.trigger.sourceId} onChange={e => edit(next => { next.transitions[i].trigger.sourceId = e.target.value; next.transitions[i].trigger.event = refs.find(r => r.id === e.target.value)?.events?.[0]?.id ?? ''; })}>{options(refs, x.trigger.sourceId)}</select></label>
     {events && <label className="field"><span>{t('interaction.event')}</span><select aria-label={`${t('state.triggerEvent')} ${i + 1}`} disabled={!editable} value={x.trigger.event} onChange={e => edit(next => { next.transitions[i].trigger.event = e.target.value; })}>{options(events, x.trigger.event)}</select></label>}
     <label className="field"><span>{t('interaction.condition')}</span><input type="checkbox" aria-label={`${t('state.condition')} ${i + 1}`} checked={Boolean(x.condition)} disabled={!editable || (!x.condition && !catalog.globals?.length)} onChange={e => edit(next => { if (e.target.checked) next.transitions[i].condition = newCondition(catalog.globals![0]); else delete next.transitions[i].condition; })}/></label>
     {x.condition && <ConditionEditor condition={x.condition} globals={catalog.globals ?? []} label={`transition ${i + 1}`} disabled={!editable} missing={t('interaction.missing')} edit={fn => edit(next => fn(next.transitions[i].condition!))}/>}
    </div>; })}
    <button disabled={!editable || !triggers.length} onClick={() => edit(next => { const d = triggers[0], ref = d.references(catalog)[0]; next.transitions.push({id: crypto.randomUUID(), from: next.states[0].id, to: next.states[Math.min(1, next.states.length - 1)].id, trigger: {type: d.type, sourceId: ref?.id ?? '', event: ref?.events?.[0]?.id ?? ''}}); })}>{t('state.addTransition')}</button>
   </fieldset>
  </div>;
 };
}
