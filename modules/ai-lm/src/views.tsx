import {useEffect, useRef, useSyncExternalStore} from 'react';
import {runAgent, systemPrompt, type AgentStep, type AgentTools} from './agent';
import {emptyReplyError, pickModel, stripThinking, type ChatDelta, type LmPort, type LmStatus, type Message} from './contracts';
import type {DiffEntry} from './diff';

interface Bridge {
 port: LmPort; url(): string; model(): string; setModel(id: string): void; text(key: string): string; report(error: unknown): void; useEditable(): boolean;
 tools(): AgentTools;
 /** System prompt inputs; `pinned` are the skills picked for this chat (their instructions always apply). */
 context(pinned: readonly string[]): Parameters<typeof systemPrompt>[0];
 /** Skills the chat can pin (name, what they are for). */
 useSkillList?(): readonly {id: string; name: string; description: string}[];
 /** `/skill-name …`: the message with the skill's instructions, or the message unchanged. Throws for an unknown skill. */
 expand?(message: string): string;
 /** Whether reasoning models may think before answering (slower, sometimes better tool use). */
 thinking(): boolean;
 /** History marker before a turn, and squashing everything after it into one undo step. */
 beginTurn(): number; endTurn(marker: number, label: string): void;
 /** What the turn changed in the project (objects added, changed, removed), shown under the reply; null when nothing. */
 snapshot?(): unknown; changes?(before: unknown): string | null;
 /** The turn's changes field by field (review card), the document version after the turn, and undoing the turn while nothing else changed since. */
 diff?(before: unknown): DiffEntry[] | null; turnVersion?(): number; discard?(version: number): void;
}
type Entry = {id: string; kind: 'user' | 'assistant' | 'step' | 'error' | 'changes'; text: string; ok?: boolean; diff?: DiffEntry[]; version?: number; review?: 'open' | 'kept' | 'discarded'};
type State = {status: LmStatus | null; checking: boolean; job: string | null; streaming: string; thinking: number; entries: Entry[]; history: Message[]; draft: string; pinned: string[]};

const describeStep = (step: AgentStep) => {
 const a = step.args as Record<string, unknown>, label = [a.name, a.item, a.objectId, a.prompt, a.sceneId, a.component].find(v => typeof v === 'string' && v) as string | undefined;
 return `${step.name.replace(/_/g, ' ')}${label ? ` · ${label.length > 40 ? label.slice(0, 40) + '…' : label}` : ''}${step.ok ? '' : ` — ${step.error}`}`;
};

/**
 * Assistant panel: chat with a local LM Studio model that edits the project through editor tools. A turn's edits are
 * one undo step ("Assistant: …"). State lives outside the component so a turn continues while the panel is closed.
 */
export function createAssistantPanel(bridge: Bridge) {
 let state: State = {status: null, checking: false, job: null, streaming: '', thinking: 0, entries: [], history: [], draft: '', pinned: []};
 const listeners = new Set<() => void>(), set = (patch: Partial<State>) => { state = {...state, ...patch}; for (const fn of listeners) fn(); };
 const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
 const add = (entry: Omit<Entry, 'id'>) => set({entries: [...state.entries, {...entry, id: crypto.randomUUID()}].slice(-200)});
 bridge.port.onDelta((d: ChatDelta) => { if (d.jobId !== state.job) return; if (d.content) set({streaming: stripThinking(state.streaming + d.content)}); if (d.reasoning) set({thinking: state.thinking + d.reasoning.length}); });
 const refresh = async () => { if (state.checking) return; set({checking: true}); try { set({status: await bridge.port.status(bridge.url())}); } catch (error) { set({status: {online: false, url: bridge.url(), models: [], error: String(error)}}); } finally { set({checking: false}); } };
 let abort: AbortController | null = null;
 const send = async (text: string) => {
  const message = text.trim();
  if (!message || state.job) return;
  const model = pickModel(state.status?.models ?? [], bridge.model());
  if (!model) throw Error(bridge.text('assistant.noModel'));
  const content = bridge.expand ? bridge.expand(message) : message;
  add({kind: 'user', text: message}); set({draft: ''});
  abort = new AbortController();
  // The system message is rebuilt every turn, so instruction and skill changes apply to an ongoing chat.
  const marker = bridge.beginTurn(), before = bridge.snapshot?.(), history: Message[] = [{role: 'system', content: systemPrompt(bridge.context(state.pinned))}, ...state.history.filter(m => m.role !== 'system'), {role: 'user', content}];
  try {
   const result = await runAgent({
    messages: history, tools: bridge.tools(), signal: abort.signal, maxSteps: 12,
    chat: async (messages, tools) => { const job = crypto.randomUUID(); set({job, streaming: '', thinking: 0}); const signal = abort!.signal; const cancel = () => { void bridge.port.cancel(job); }; signal.addEventListener('abort', cancel, {once: true}); try { return await bridge.port.chat(bridge.url(), job, {model, messages, tools, temperature: 0.2, ...(bridge.thinking() ? {} : {reasoning: 'none' as const})}); } finally { signal.removeEventListener('abort', cancel); } },
    onStep: step => add({kind: 'step', text: describeStep(step), ok: step.ok}),
   });
   set({history: result.messages.slice(-60)});
   add({kind: 'assistant', text: result.reply || bridge.text('assistant.done')});
  } catch (error) {
   add({kind: 'error', text: error instanceof Error ? error.message : String(error)});
  } finally {
   bridge.endTurn(marker, `Assistant: ${message.slice(0, 40)}`);
   const changed = before === undefined ? null : bridge.changes?.(before) ?? null, diff = before === undefined ? null : bridge.diff?.(before) ?? null;
   if (changed) add({kind: 'changes', text: changed, ...(diff?.length && bridge.discard ? {diff, version: bridge.turnVersion?.(), review: 'open' as const} : {})});
   abort = null; set({job: null, streaming: ''});
  }
 };
 const review = (id: string, next: 'kept' | 'discarded') => set({entries: state.entries.map(x => x.id === id ? {...x, review: next} : x)});
 /** The turn's changes field by field; Keep closes the review, Discard undoes the whole turn (one undo step). */
 function Review({entry}: {entry: Entry}) {
  const open = entry.review === 'open', t = bridge.text;
  return <details className="assistant-review" data-testid="assistant-review" data-review={entry.review} open={open}>
   <summary>{t('assistant.reviewTitle').replace('{n}', String(entry.diff!.length))}</summary>
   <ul>{entry.diff!.map((d, i) => <li key={i} data-change={d.kind} data-scope={d.scope}><strong>{d.kind === 'added' ? '+' : d.kind === 'removed' ? '−' : '~'} {d.scope === 'setting' ? t('assistant.setting') : d.scope === 'scene' ? t('assistant.scene') : ''}{d.name}</strong>{d.scene && <small> · {d.scene}</small>}
    {d.fields?.length ? <ul>{d.fields.slice(0, 12).map((f, j) => <li key={j}><code>{f.path}</code>{f.from !== undefined && <> <del>{f.from}</del></>}{f.from !== undefined && f.to !== undefined && ' → '}{f.to !== undefined && <ins>{f.to}</ins>}</li>)}{d.fields.length > 12 && <li>…{d.fields.length - 12}</li>}</ul> : null}</li>)}</ul>
   {open ? <div className="panel-actions"><button onClick={() => review(entry.id, 'kept')}>{t('assistant.keep')}</button><button onClick={() => run(() => { bridge.discard!(entry.version ?? -1); review(entry.id, 'discarded'); })}>{t('assistant.discard')}</button></div> : <p className="panel-empty">{t(entry.review === 'kept' ? 'assistant.kept' : 'assistant.discarded')}</p>}
  </details>;
 }
 const run = (work: () => Promise<void> | void) => { try { const r = work(); if (r) r.catch(bridge.report); } catch (error) { bridge.report(error); } };

 return function AssistantPanel() {
  const s = useSyncExternalStore(subscribe, () => state), t = bridge.text, editable = bridge.useEditable(), log = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!s.status) void refresh(); }, []);
  useEffect(() => { log.current?.scrollTo({top: log.current.scrollHeight}); }, [s.entries.length, s.streaming]);
  const models = (s.status?.models ?? []).filter(m => m.type !== 'embeddings'), model = pickModel(models, bridge.model()), busy = Boolean(s.job), skills = bridge.useSkillList?.() ?? [];
  return <div className="panel-body assistant-panel" data-testid="assistant-panel" data-online={s.status?.online ?? false} data-busy={busy}>
   <div className="generate-status" role="status">
    <span className={s.status?.online ? 'status-dot online' : 'status-dot'} aria-hidden="true"/>
    <span>{s.checking && !s.status ? t('assistant.checking') : s.status?.online ? `${t('assistant.connected')} · ${s.status.url}` : `${t('assistant.offline')} · ${s.status?.url ?? bridge.url()}`}</span>
    <button onClick={() => run(refresh)} disabled={s.checking}>{t('comfy.retry')}</button>
   </div>
   {!s.status?.online && s.status && <p className="panel-empty">{t('assistant.offlineHelp')}</p>}
   {s.status?.online && <label className="field"><span>{t('assistant.model')}</span><select aria-label={t('assistant.model')} value={model} disabled={busy} onChange={e => { bridge.setModel(e.target.value); set({}); }}>
    {models.map(m => <option key={m.id} value={m.id}>{`${m.id}${m.loaded ? ' ●' : ''}${m.tools ? '' : ` (${t('assistant.noTools')})`}`}</option>)}
   </select></label>}
   {skills.length > 0 && <div className="assistant-skills" data-testid="assistant-skills" role="group" aria-label={t('assistant.skills')}>
    {s.pinned.map(id => { const k = skills.find(x => x.id === id); return k ? <span key={id} className="assistant-skill" title={k.description} data-skill={k.name}>{k.name}<button aria-label={`${t('assistant.unpinSkill')} ${k.name}`} disabled={busy} onClick={() => set({pinned: state.pinned.filter(x => x !== id)})}>×</button></span> : null; })}
    <select aria-label={t('assistant.addSkill')} value="" disabled={busy || skills.every(k => s.pinned.includes(k.id))} onChange={e => { if (e.target.value) set({pinned: [...state.pinned, e.target.value]}); }}>
     <option value="">{s.pinned.length ? `+ ${t('assistant.skill')}` : t('assistant.addSkill')}</option>
     {skills.filter(k => !s.pinned.includes(k.id)).map(k => <option key={k.id} value={k.id} title={k.description}>{k.name}</option>)}
    </select>
   </div>}
   <div className="assistant-log" role="log" aria-label={t('assistant.conversation')} ref={log}>
    {!s.entries.length && <p className="panel-empty">{t('assistant.help')}</p>}
    {s.entries.map(e => <div key={e.id} className={`assistant-entry ${e.kind}${e.ok === false ? ' failed' : ''}`} data-kind={e.kind}>{e.kind === 'step' ? `${e.ok ? '✓' : '✗'} ${e.text}` : e.text}{e.diff && <Review entry={e}/>}</div>)}
    {busy && <div className="assistant-entry assistant streaming" aria-live="polite" data-testid="assistant-progress">{s.streaming || (s.thinking ? t('assistant.thinkingChars').replace('{chars}', String(s.thinking)) : t('assistant.waiting'))}</div>}
   </div>
   <textarea aria-label={t('assistant.message')} placeholder={t('assistant.placeholder')} rows={3} value={s.draft} disabled={!editable && !busy} onChange={e => set({draft: e.target.value})}
    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); run(() => send(state.draft)); } }}/>
   <div className="panel-actions">
    {busy ? <button onClick={() => abort?.abort()}>{t('assistant.stop')}</button> : <button className="primary" disabled={!editable || !s.status?.online || !s.draft.trim()} onClick={() => run(() => send(state.draft))}>{t('assistant.send')}</button>}
    <button disabled={busy || !s.entries.length} onClick={() => set({entries: [], history: []})}>{t('assistant.newChat')}</button>
   </div>
  </div>;
 };
}

/** Live progress of the prompt writer, for the Generate panel's info line. */
export interface WriterStatus {phase: 'connecting' | 'waiting' | 'thinking' | 'writing' | 'done' | 'failed' | 'cancelled'; chars?: number; seconds?: number; model?: string; message?: string}
/**
 * Prompt writer used by the Generate panel: one short non-tool completion with thinking turned off (reasoning models
 * otherwise spend the whole budget thinking: Gemma 4 took 20 s and returned nothing with 400 tokens, 1.8 s without
 * thinking). Reports each phase; an empty answer is an error, never silence.
 */
export async function writePrompt(port: LmPort, url: string, preferred: string, messages: Message[], onStatus: (s: WriterStatus) => void = () => {}, signal?: AbortSignal): Promise<string> {
 const started = Date.now();
 onStatus({phase: 'connecting'});
 const status = await port.status(url);
 if (!status.online) throw Error('LM Studio is not running on this computer. Start its server (Developer → Start server) and try again.');
 const model = pickModel(status.models, preferred);
 if (!model) throw Error('LM Studio has no language model');
 if (signal?.aborted) throw Error('Cancelled');
 const job = crypto.randomUUID();
 let thinking = 0, writing = 0;
 onStatus({phase: 'waiting', model});
 const stop = port.onDelta(d => {
  if (d.jobId !== job) return;
  if (d.reasoning) { thinking += d.reasoning.length; if (!writing) onStatus({phase: 'thinking', chars: thinking, model}); }
  if (d.content) { writing += d.content.length; onStatus({phase: 'writing', chars: writing, model}); }
 });
 const cancel = () => { void port.cancel(job); };
 signal?.addEventListener('abort', cancel, {once: true});
 try {
  const result = await port.chat(url, job, {model, messages, temperature: 0.7, maxTokens: 1500, reasoning: 'none'});
  const text = stripThinking(result.content).replace(/^["'\s]+|["'\s]+$/g, '').replace(/^prompt:\s*/i, '').trim();
  if (!text) throw emptyReplyError(result);
  onStatus({phase: 'done', model, seconds: Math.round((Date.now() - started) / 100) / 10});
  return text;
 } catch (error) {
  if (signal?.aborted) throw Error('Cancelled');
  throw error;
 } finally { stop(); signal?.removeEventListener('abort', cancel); }
}
