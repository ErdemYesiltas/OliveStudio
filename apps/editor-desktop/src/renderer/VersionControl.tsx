import {useCallback, useEffect, useState} from 'react';
import {projectDiff, diffSummary} from '@rewrite/ai-lm/diff';

type Status = Awaited<ReturnType<Window['platform']['git']['status']>>;
type Commit = Awaited<ReturnType<Window['platform']['git']['log']>>[number];
type Staged = {text: string; path: string; warnings: string[]} | null;

/**
 * Version control (git) for the project's folder: start it, see what changed, commit with a message, browse the
 * project's history, compare a version with the editor's project (objects added, removed, changed per scene) and go
 * back to it.
 */
export function createVersionControl(bridge: {text(key: string): string; report(error: unknown): void; useDirty(): boolean; save(): Promise<void>; current(): unknown; open(result: Staged): Promise<void>}) {
 const t = bridge.text;
 return function VersionControl() {
  const dirty = bridge.useDirty(), [status, setStatus] = useState<Status | null>(null), [log, setLog] = useState<Commit[]>([]), [message, setMessage] = useState(''), [busy, setBusy] = useState(false), [compare, setCompare] = useState<{commit: Commit; lines: string[]} | null>(null);
  const refresh = useCallback(async () => { try { const s = await window.platform.git.status(); setStatus(s); setLog(s.repo ? await window.platform.git.log() : []); } catch (error) { bridge.report(error); } }, []);
  useEffect(() => { void refresh(); }, [refresh, dirty]);
  const act = (work: () => Promise<unknown>) => async () => { setBusy(true); try { await work(); } catch (error) { bridge.report(error); } finally { setBusy(false); await refresh(); } };
  const commit = act(async () => { if (dirty) await bridge.save(); await window.platform.git.commit(message); setMessage(''); });
  const diff = (c: Commit) => act(async () => { const text = await window.platform.git.show(c.hash); const lines = diffSummary(projectDiff(JSON.parse(text), bridge.current() as never)); setCompare({commit: c, lines}); })();
  const restore = (c: Commit) => act(async () => { const result = await window.platform.git.restore(c.hash); if (result) await bridge.open(result); setCompare(null); })();
  if (!status) return <div className="panel-body version-control" data-testid="version-control"><p className="panel-empty">…</p></div>;
  return <div className="panel-body version-control" data-testid="version-control" data-repo={Boolean(status.repo)}>
   {!status.available ? <p className="component-warning">{t('git.missing')}</p>
    : !status.saved ? <p className="panel-empty">{t('git.saveFirst')}</p>
    : !status.repo ? <div className="vc-start"><p className="panel-empty">{t('git.notRepo').replace('{folder}', status.folder ?? '')}</p><button disabled={busy} onClick={act(() => window.platform.git.init())}>{t('git.init')}</button></div>
    : <>
     <div className="vc-head"><strong>{status.branch}</strong>{status.head && <code>{status.head}</code>}<button disabled={busy} onClick={() => void refresh()}>{t('git.refresh')}</button></div>
     <section aria-label={t('git.changes')}>
      <h4>{t('git.changes')} <small>{(status.changes ?? []).length}</small></h4>
      {dirty && <p className="component-warning">{t('git.unsaved')}</p>}
      <ul className="vc-changes" data-testid="vc-changes">{(status.changes ?? []).map(c => <li key={c.file}><span className="vc-status" data-status={c.status}>{c.status}</span>{c.file}</li>)}</ul>
      {!dirty && !(status.changes ?? []).length && <p className="panel-empty">{t('git.clean')}</p>}
      <div className="vc-commit"><input aria-label={t('git.message')} placeholder={t('git.message')} value={message} maxLength={2000} onChange={e => setMessage(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && message.trim()) void commit(); }}/><button disabled={busy || !message.trim() || (!dirty && !(status.changes ?? []).length)} onClick={() => void commit()}>{dirty ? t('git.saveCommit') : t('git.commit')}</button></div>
     </section>
     <section aria-label={t('git.history')}>
      <h4>{t('git.history')}</h4>
      <ol className="vc-log" data-testid="vc-log">{log.map(c => <li key={c.hash} data-commit={c.short}>
       <div><strong>{c.subject}</strong><small>{`${c.short} · ${c.author} · ${new Date(c.date).toLocaleString()}`}</small></div>
       <button disabled={busy} onClick={() => diff(c)}>{t('git.compare')}</button>
       <button disabled={busy} onClick={() => restore(c)}>{t('git.restore')}</button>
      </li>)}</ol>
      {!log.length && <p className="panel-empty">{t('git.noHistory')}</p>}
     </section>
     {compare && <section className="vc-compare" aria-label={t('git.compareTitle')} data-testid="vc-compare"><h4>{t('git.compareTitle').replace('{commit}', compare.commit.short)}</h4>{compare.lines.length ? <ul>{compare.lines.map((l, i) => <li key={i}>{l}</li>)}</ul> : <p className="panel-empty">{t('git.same')}</p>}</section>}
    </>}
  </div>;
 };
}
