import {useEffect, useState} from 'react';
import type {GlobalValue} from '@rewrite/interactions';
import type {Achievements} from './index';

type GlobalInfo = {id: string; name: string; type: string};
const ops = ['==', '!=', '>', '>=', '<', '<='] as const;
/** Achievements panel: achievements (name, description, hidden, unlock-by-itself condition) and leaderboards. */
export function createAchievementsPanel(bridge: {text(key: string): string; useEditable(): boolean; useProject(): {library: Achievements; globals: readonly GlobalInfo[]}; edit(label: string, change: (lib: Achievements) => void): void; resetPreview(): void}) {
 const t = bridge.text;
 function Text({label, value, commit, disabled}: {label: string; value: string; commit(v: string): void; disabled: boolean}) {
  const [draft, setDraft] = useState(value); useEffect(() => setDraft(value), [value]);
  return <input aria-label={label} placeholder={label} value={draft} disabled={disabled} onChange={e => setDraft(e.target.value)} onBlur={() => { if (draft !== value) commit(draft); }} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}/>;
 }
 return function AchievementsPanel() {
  const editable = bridge.useEditable(), {library, globals} = bridge.useProject(), numbers = globals.filter(g => g.type === 'number' || g.type === 'boolean' || g.type === 'text'), byId = new Map(numbers.map(g => [g.id, g]));
  const item = (id: string, label: string, fn: (a: Achievements['items'][number]) => void) => bridge.edit(label, l => { const a = l.items.find(x => x.id === id); if (a) fn(a); });
  const board = (id: string, label: string, fn: (b: Achievements['boards'][number]) => void) => bridge.edit(label, l => { const b = l.boards.find(x => x.id === id); if (b) fn(b); });
  const unique = (base: string, names: string[]) => { let n = base, i = 2; while (names.includes(n)) n = `${base} ${i++}`; return n; };
  const value = (type: string | undefined, raw: string): GlobalValue => type === 'number' ? Number(raw) || 0 : type === 'boolean' ? raw === 'true' : raw;
  return <div className="panel-body achievements-panel" data-testid="achievements-panel">
   <section aria-label={t('achievements.title')}>
    <header className="ach-head"><h4>{t('achievements.title')}</h4><button disabled={!editable} onClick={() => bridge.edit(t('achievements.add'), l => { l.items.push({id: crypto.randomUUID(), name: unique(t('achievements.new'), l.items.map(a => a.name)), description: '', hidden: false}); })}>{t('achievements.add')}</button><button onClick={bridge.resetPreview}>{t('achievements.reset')}</button></header>
    {!library.items.length && <p className="panel-empty">{t('achievements.empty')}</p>}
    {library.items.map((a, i) => <div key={a.id} className="ach-row" data-achievement={a.name}>
     <Text label={`${t('achievements.name')} ${i + 1}`} value={a.name} disabled={!editable} commit={v => { if (v.trim()) item(a.id, t('achievements.edit'), x => { x.name = v.trim(); }); }}/>
     <Text label={`${t('achievements.description')} ${i + 1}`} value={a.description} disabled={!editable} commit={v => item(a.id, t('achievements.edit'), x => { x.description = v.slice(0, 300); })}/>
     <label className="ach-check"><input type="checkbox" aria-label={`${t('achievements.hidden')} ${i + 1}`} checked={a.hidden} disabled={!editable} onChange={e => item(a.id, t('achievements.edit'), x => { x.hidden = e.target.checked; })}/>{t('achievements.hidden')}</label>
     <select aria-label={`${t('achievements.auto')} ${i + 1}`} value={a.condition?.globalId ?? ''} disabled={!editable} onChange={e => item(a.id, t('achievements.edit'), x => { const g = byId.get(e.target.value); x.condition = g ? {globalId: g.id, op: g.type === 'number' ? '>=' : '==', value: g.type === 'number' ? 1 : g.type === 'boolean' ? true : ''} : undefined; })}>
      <option value="">{t('achievements.manual')}</option>{numbers.map(g => <option key={g.id} value={g.id}>{`${t('achievements.when')} ${g.name}`}</option>)}
     </select>
     {a.condition && <><select aria-label={`${t('achievements.operator')} ${i + 1}`} value={a.condition.op} disabled={!editable} onChange={e => item(a.id, t('achievements.edit'), x => { if (x.condition) x.condition.op = e.target.value as typeof ops[number]; })}>{ops.map(o => <option key={o}>{o}</option>)}</select>
      <Text label={`${t('achievements.value')} ${i + 1}`} value={String(a.condition.value)} disabled={!editable} commit={v => item(a.id, t('achievements.edit'), x => { if (x.condition) x.condition.value = value(byId.get(x.condition.globalId)?.type, v); })}/></>}
     <button aria-label={`${t('achievements.delete')} ${i + 1}`} disabled={!editable} onClick={() => bridge.edit(t('achievements.delete'), l => { l.items = l.items.filter(x => x.id !== a.id); })}>✕</button>
    </div>)}
   </section>
   <section aria-label={t('leaderboards.title')}>
    <header className="ach-head"><h4>{t('leaderboards.title')}</h4><button disabled={!editable} onClick={() => bridge.edit(t('leaderboards.add'), l => { l.boards.push({id: crypto.randomUUID(), name: unique(t('leaderboards.new'), l.boards.map(b => b.name)), order: 'high', globalId: numbers.find(g => g.type === 'number')?.id ?? ''}); })}>{t('leaderboards.add')}</button></header>
    {library.boards.map((b, i) => <div key={b.id} className="ach-row" data-board={b.name}>
     <Text label={`${t('leaderboards.name')} ${i + 1}`} value={b.name} disabled={!editable} commit={v => { if (v.trim()) board(b.id, t('leaderboards.edit'), x => { x.name = v.trim(); }); }}/>
     <select aria-label={`${t('leaderboards.order')} ${i + 1}`} value={b.order} disabled={!editable} onChange={e => board(b.id, t('leaderboards.edit'), x => { x.order = e.target.value as 'high' | 'low'; })}><option value="high">{t('leaderboards.high')}</option><option value="low">{t('leaderboards.low')}</option></select>
     <select aria-label={`${t('leaderboards.score')} ${i + 1}`} value={b.globalId} disabled={!editable} onChange={e => board(b.id, t('leaderboards.edit'), x => { x.globalId = e.target.value; })}><option value="">{t('leaderboards.scriptsOnly')}</option>{numbers.filter(g => g.type === 'number').map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select>
     <button aria-label={`${t('leaderboards.delete')} ${i + 1}`} disabled={!editable} onClick={() => bridge.edit(t('leaderboards.delete'), l => { l.boards = l.boards.filter(x => x.id !== b.id); })}>✕</button>
    </div>)}
   </section>
   <p className="panel-empty">{t('achievements.help')}</p>
  </div>;
 };
}
