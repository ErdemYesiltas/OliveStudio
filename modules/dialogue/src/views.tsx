import {useEffect, useRef, useState} from 'react';
import type {GlobalStore, GlobalValue} from '@rewrite/interactions';
import {DialogueSession, dialogueProblems, newLine, type Choice, type Dialogue, type DialogueLibrary, type Line} from './index';
import {createDialogueBox} from './box';

type GlobalInfo = {id: string; name: string; type: string};
interface Bridge {
 text(key: string): string; report(error: unknown): void; useEditable(): boolean;
 /** The project's dialogue library and plain globals, re-read on every project change. */
 useProject(): {library: DialogueLibrary; globals: readonly GlobalInfo[]};
 edit(label: string, change: (library: DialogueLibrary) => void): void;
 /** A fresh store with the project's initial global values, for the Test area. */
 createGlobals(): GlobalStore | undefined;
}
const plain = (g: GlobalInfo) => g.type === 'number' || g.type === 'boolean' || g.type === 'text';
const parse = (type: string | undefined, raw: string): GlobalValue => type === 'number' ? (Number.isFinite(Number(raw)) ? Number(raw) : 0) : type === 'boolean' ? raw === 'true' : raw;
const show = (v: GlobalValue | undefined) => v === undefined ? '' : String(v);
const ops = ['==', '!=', '>', '>=', '<', '<='] as const;

/** Dialogue editor: dialogues on the left, their lines as cards (speaker, text, choices with conditions, links, global
 * assignment, event), problems, and a Test area that plays the dialogue in the real box. */
export function createDialoguePanel(bridge: Bridge) {
 const t = bridge.text;
 function Field({label, value, commit, multiline, disabled}: {label: string; value: string; commit(v: string): void; multiline?: boolean; disabled: boolean}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const done = () => { if (draft !== value) commit(draft); };
  return multiline
   ? <textarea aria-label={label} placeholder={label} value={draft} disabled={disabled} rows={2} onChange={e => setDraft(e.target.value)} onBlur={done}/>
   : <input aria-label={label} placeholder={label} value={draft} disabled={disabled} onChange={e => setDraft(e.target.value)} onBlur={done} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}/>;
 }
 function Target({label, value, lines, self, set, disabled}: {label: string; value: string; lines: readonly Line[]; self: string; set(v: string): void; disabled: boolean}) {
  return <select aria-label={label} value={value} disabled={disabled} onChange={e => set(e.target.value)}>
   <option value="">{t('dialogue.end')}</option>
   {lines.map((l, i) => <option key={l.id} value={l.id} disabled={l.id === self}>{`${t('dialogue.line')} ${i + 1}${l.text ? ` · ${l.text.slice(0, 28)}` : ''}`}</option>)}
  </select>;
 }
 function GlobalValueInput({label, global, value, set, disabled}: {label: string; global?: GlobalInfo; value: GlobalValue | undefined; set(v: GlobalValue): void; disabled: boolean}) {
  if (global?.type === 'boolean') return <select aria-label={label} value={show(value) || 'false'} disabled={disabled} onChange={e => set(e.target.value === 'true')}><option value="true">true</option><option value="false">false</option></select>;
  return <Field label={label} value={show(value)} disabled={disabled || !global} commit={v => set(parse(global?.type, v))}/>;
 }
 function Test({dialogue}: {dialogue: Dialogue}) {
  const area = useRef<HTMLDivElement>(null), [running, setRunning] = useState(false), [log, setLog] = useState<string[]>([]);
  useEffect(() => {
   if (!running || !area.current) return;
   const globals = bridge.createGlobals(), lib = {version: 1 as const, items: [dialogue]};
   const session = new DialogueSession({library: () => lib, globals: () => globals, silent: () => false, emit: e => setLog(l => [...l.slice(-5), e.type === 'dialogue.end' ? t('dialogue.ended') : `${t('dialogue.eventFired')}: ${e.event}`])});
   const box = createDialogueBox(area.current, session, {speed: 80}), off = session.subscribe(v => { if (!v) setRunning(false); });
   try { session.start(dialogue.id); } catch (e) { bridge.report(e); setRunning(false); }
   return () => { off(); box.dispose(); session.dispose(); globals?.dispose(); };
  }, [running]);
  return <div className="dialogue-test">
   <div className="dialogue-test-head"><button onClick={() => { setLog([]); setRunning(r => !r); }} disabled={!dialogue.lines.length}>{running ? t('dialogue.stopTest') : t('dialogue.test')}</button>{log.map((l, i) => <small key={i}>{l}</small>)}</div>
   <div ref={area} className="dialogue-test-area" data-testid="dialogue-test" data-running={running}/>
  </div>;
 }
 return function DialoguePanel() {
  const editable = bridge.useEditable(), {library, globals} = bridge.useProject(), [selected, setSelected] = useState('');
  const dialogue = library.items.find(d => d.id === selected) ?? library.items[0], usable = globals.filter(plain), byId = new Map(usable.map(g => [g.id, g]));
  const change = (label: string, fn: (d: Dialogue) => void) => { if (!dialogue) return; const id = dialogue.id; bridge.edit(label, lib => { const d = lib.items.find(x => x.id === id); if (d) fn(d); }); };
  const line = (id: string, label: string, fn: (l: Line) => void) => change(label, d => { const l = d.lines.find(x => x.id === id); if (l) fn(l); });
  const choice = (lineId: string, choiceId: string, label: string, fn: (c: Choice) => void) => line(lineId, label, l => { const c = l.choices.find(x => x.id === choiceId); if (c) fn(c); });
  const create = () => { const id = crypto.randomUUID(), first = crypto.randomUUID(); bridge.edit(t('dialogue.new'), lib => { let name = t('dialogue.untitled'), n = 2; while (lib.items.some(d => d.name === name)) name = `${t('dialogue.untitled')} ${n++}`; lib.items.push({id, name, start: first, lines: [newLine(first)]}); }); setSelected(id); };
  const problems = dialogue ? dialogueProblems(dialogue) : [];
  return <div className="panel-body dialogue-panel" data-testid="dialogue-panel">
   <div className="dialogue-side">
    <div role="listbox" aria-label={t('dialogue.library')} className="dialogue-list">
     {library.items.map(d => <button key={d.id} role="option" aria-selected={d.id === dialogue?.id} onClick={() => setSelected(d.id)}>{d.name}{dialogueProblems(d).length ? <span className="shader-bad" aria-label={t('dialogue.hasProblems')}>●</span> : null}</button>)}
     {!library.items.length && <p className="panel-empty">{t('dialogue.empty')}</p>}
    </div>
    <button disabled={!editable} onClick={create}>{t('dialogue.new')}</button>
   </div>
   {dialogue ? <div className="dialogue-main">
    <div className="dialogue-head">
     <Field label={t('dialogue.name')} value={dialogue.name} disabled={!editable} commit={v => { const name = v.trim(); if (name) change(t('dialogue.rename'), d => { d.name = name; }); }}/>
     <label className="field"><span>{t('dialogue.start')}</span><Target label={t('dialogue.start')} value={dialogue.start} lines={dialogue.lines} self="" disabled={!editable} set={v => change(t('dialogue.edit'), d => { d.start = v; })}/></label>
     <button disabled={!editable} onClick={() => { bridge.edit(t('dialogue.delete'), lib => { lib.items = lib.items.filter(d => d.id !== dialogue.id); }); setSelected(''); }}>{t('dialogue.delete')}</button>
    </div>
    {problems.length > 0 && <ul className="dialogue-problems" data-testid="dialogue-problems">{problems.map(p => <li key={p}>{p}</li>)}</ul>}
    <div className="dialogue-lines">
     {dialogue.lines.map((l, i) => <section key={l.id} className="dialogue-line" data-line={i + 1} aria-label={`${t('dialogue.line')} ${i + 1}`}>
      <header><strong>{`${t('dialogue.line')} ${i + 1}`}</strong>{dialogue.start === l.id && <span className="dialogue-badge">{t('dialogue.first')}</span>}
       <button disabled={!editable || dialogue.lines.length < 2} aria-label={`${t('dialogue.deleteLine')} ${i + 1}`} onClick={() => change(t('dialogue.deleteLine'), d => { d.lines = d.lines.filter(x => x.id !== l.id); for (const x of d.lines) { if (x.next === l.id) x.next = ''; for (const c of x.choices) if (c.next === l.id) c.next = ''; } if (d.start === l.id) d.start = d.lines[0]?.id ?? ''; })}>✕</button></header>
      <Field label={t('dialogue.speaker')} value={l.speaker} disabled={!editable} commit={v => line(l.id, t('dialogue.edit'), x => { x.speaker = v; })}/>
      <Field label={t('dialogue.text')} value={l.text} multiline disabled={!editable} commit={v => line(l.id, t('dialogue.edit'), x => { x.text = v; })}/>
      {l.choices.map((c, ci) => <div key={c.id} className="dialogue-choice">
       <Field label={`${t('dialogue.choice')} ${ci + 1}`} value={c.text} disabled={!editable} commit={v => choice(l.id, c.id, t('dialogue.edit'), x => { x.text = v; })}/>
       <Target label={`${t('dialogue.choiceGoes')} ${ci + 1}`} value={c.next} lines={dialogue.lines} self={l.id} disabled={!editable} set={v => choice(l.id, c.id, t('dialogue.edit'), x => { x.next = v; })}/>
       <select aria-label={`${t('dialogue.when')} ${ci + 1}`} value={c.condition?.globalId ?? ''} disabled={!editable} onChange={e => choice(l.id, c.id, t('dialogue.edit'), x => { const g = byId.get(e.target.value); x.condition = g ? {globalId: g.id, op: '==', value: g.type === 'number' ? 0 : g.type === 'boolean' ? true : ''} : undefined; })}>
        <option value="">{t('dialogue.always')}</option>{usable.map(g => <option key={g.id} value={g.id}>{`${t('dialogue.if')} ${g.name}`}</option>)}
       </select>
       {c.condition && <><select aria-label={`${t('dialogue.operator')} ${ci + 1}`} value={c.condition.op} disabled={!editable} onChange={e => choice(l.id, c.id, t('dialogue.edit'), x => { if (x.condition) x.condition.op = e.target.value as typeof ops[number]; })}>{ops.map(o => <option key={o} value={o}>{o}</option>)}</select>
        <GlobalValueInput label={`${t('dialogue.value')} ${ci + 1}`} global={byId.get(c.condition.globalId)} value={c.condition.value} disabled={!editable} set={v => choice(l.id, c.id, t('dialogue.edit'), x => { if (x.condition) x.condition.value = v; })}/></>}
       <button aria-label={`${t('dialogue.removeChoice')} ${ci + 1}`} disabled={!editable} onClick={() => line(l.id, t('dialogue.edit'), x => { x.choices = x.choices.filter(y => y.id !== c.id); })}>✕</button>
      </div>)}
      <div className="dialogue-row">
       {!l.choices.length && <label className="field"><span>{t('dialogue.then')}</span><Target label={`${t('dialogue.then')} ${i + 1}`} value={l.next} lines={dialogue.lines} self={l.id} disabled={!editable} set={v => line(l.id, t('dialogue.edit'), x => { x.next = v; })}/></label>}
       <button disabled={!editable || l.choices.length >= 8} onClick={() => line(l.id, t('dialogue.addChoice'), x => { x.choices.push({id: crypto.randomUUID(), text: '', next: ''}); })}>{t('dialogue.addChoice')}</button>
      </div>
      <div className="dialogue-row">
       <select aria-label={`${t('dialogue.setGlobal')} ${i + 1}`} value={l.set?.globalId ?? ''} disabled={!editable} onChange={e => line(l.id, t('dialogue.edit'), x => { const g = byId.get(e.target.value); x.set = g ? {globalId: g.id, value: g.type === 'number' ? 0 : g.type === 'boolean' ? true : ''} : undefined; })}>
        <option value="">{t('dialogue.noSet')}</option>{usable.map(g => <option key={g.id} value={g.id}>{`${t('dialogue.set')} ${g.name}`}</option>)}
       </select>
       {l.set && <GlobalValueInput label={`${t('dialogue.setValue')} ${i + 1}`} global={byId.get(l.set.globalId)} value={l.set.value} disabled={!editable} set={v => line(l.id, t('dialogue.edit'), x => { if (x.set) x.set.value = v; })}/>}
       <Field label={`${t('dialogue.event')} ${i + 1}`} value={l.event} disabled={!editable} commit={v => line(l.id, t('dialogue.edit'), x => { x.event = v.replace(/[^\w .-]/g, '').slice(0, 40); })}/>
      </div>
     </section>)}
     <button disabled={!editable} onClick={() => change(t('dialogue.addLine'), d => { const id = crypto.randomUUID(), last = d.lines[d.lines.length - 1]; if (last && !last.next && !last.choices.length) last.next = id; d.lines.push(newLine(id)); })}>{t('dialogue.addLine')}</button>
    </div>
    <Test dialogue={dialogue}/>
   </div> : <p className="panel-empty">{t('dialogue.pick')}</p>}
  </div>;
 };
}
