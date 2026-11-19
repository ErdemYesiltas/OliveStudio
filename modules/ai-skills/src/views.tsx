import {useEffect, useRef, useState} from 'react';
import {builtInSkills, hiddenBuiltIns, listSkills, skillSlug, SkillSchema, type ScopedSkill, type Skill, type Skills} from './index';

interface Bridge {
 text(key: string): string; report(error: unknown): void; useEditable(): boolean;
 useSkills(): {project: Skills; machine: Skills};
 /** Project skills and instructions change as one undo step; this computer's are saved at once. */
 writeProject(label: string, next: Skills): void; writeMachine(next: Skills): void;
 /** LoRA files and workflow names ComfyUI / the Generate panel know (suggestions in the preset). */
 useLoras?(): string[]; useWorkflows?(): string[];
 /** The local AI (LM Studio) writes or revises a skill from a request; the result fills the editor, nothing is saved yet. */
 writeSkill?(request: string, current: Skill | undefined, lists: {loras: readonly string[]; workflows: readonly string[]}, onStatus: (s: WriterStatus) => void, signal: AbortSignal): Promise<Skill>;
}
/** Skill writer progress (same phases as the prompt writer). */
export interface WriterStatus {phase: 'connecting' | 'waiting' | 'thinking' | 'writing' | 'done' | 'failed' | 'cancelled'; chars?: number; seconds?: number; model?: string; message?: string}
type Scope = 'project' | 'machine';
/** The editor form: numbers stay strings until saved (empty = keep the Generate panel's value). */
type Draft = {from?: {scope: Scope; id: string}; scope: Scope; id: string; name: string; description: string; instructions: string; always: boolean;
 kind: '' | 'image' | 'audio'; prompt: string; negative: string; workflow: string; width: string; height: string; steps: string; cfg: string; loras: {name: string; strength: string}[]};
const toDraft = (skill: Skill, scope: Scope, from?: Draft['from']): Draft => {
 const g = skill.generate, n = (v: number | undefined) => v === undefined ? '' : String(v);
 return {from, scope, id: skill.id, name: skill.name, description: skill.description, instructions: skill.instructions, always: skill.always, kind: g?.kind ?? '', prompt: g?.prompt ?? '', negative: g?.negative ?? '', workflow: g?.workflow ?? '',
  width: n(g?.width), height: n(g?.height), steps: n(g?.steps), cfg: n(g?.cfg), loras: (g?.loras ?? []).map(l => ({name: l.name, strength: String(l.strength)}))};
};
function fromDraft(d: Draft): Skill {
 const n = (v: string) => v.trim() === '' ? undefined : Number(v), loras = d.loras.filter(l => l.name.trim()).map(l => ({name: l.name.trim(), strength: Number(l.strength)}));
 const generate = {...(d.kind ? {kind: d.kind} : {}), prompt: d.prompt, ...(d.negative.trim() ? {negative: d.negative} : {}), loras, ...(d.workflow ? {workflow: d.workflow} : {}),
  ...Object.fromEntries((['width', 'height', 'steps', 'cfg'] as const).flatMap(k => n(d[k]) === undefined ? [] : [[k, n(d[k])]]))};
 const hasPreset = Boolean(d.kind || d.prompt.trim() || d.negative.trim() || loras.length || d.workflow || ['width', 'height', 'steps', 'cfg'].some(k => d[k as 'width'].trim()));
 return SkillSchema.parse({id: d.id, name: d.name, description: d.description, instructions: d.instructions, always: d.always, ...(hasPreset ? {generate} : {})});
}

/** Instructions text area: edits locally, saved when it loses focus. */
function InstructionsField({label, help, value, disabled, save}: {label: string; help: string; value: string; disabled: boolean; save(next: string): void}) {
 const [draft, setDraft] = useState<string | null>(null);
 useEffect(() => { setDraft(null); }, [value]);
 return <label className="field skills-instructions"><span>{label}</span>
  <textarea aria-label={label} rows={4} value={draft ?? value} disabled={disabled} onChange={e => setDraft(e.target.value)} onBlur={() => { if (draft !== null && draft !== value) save(draft); }}/>
  <small>{help}</small>
 </label>;
}

/**
 * Skills panel: your and the project's instructions for the local AI, and skills (instructions plus an optional
 * ComfyUI preset) the assistant loads by name and the Generate panel applies.
 */
export function createSkillsPanel(bridge: Bridge) {
 return function SkillsPanel() {
  const t = bridge.text, editable = bridge.useEditable(), {project, machine} = bridge.useSkills(), loras = bridge.useLoras?.() ?? [], workflows = bridge.useWorkflows?.() ?? [];
  const [draft, setDraft] = useState<Draft | null>(null), [error, setError] = useState(''), [request, setRequest] = useState(''), [writer, setWriter] = useState<WriterStatus | null>(null), abort = useRef<AbortController | null>(null);
  const writing = Boolean(abort.current) && writer !== null && !['done', 'failed', 'cancelled'].includes(writer.phase);
  const hidden = hiddenBuiltIns(project, machine), overrides = (k: ScopedSkill) => k.scope !== 'builtin' && builtInSkills.some(b => b.name.toLowerCase() === k.name.toLowerCase());
  const writerText = (w: WriterStatus) => w.phase === 'failed' ? w.message ?? t('comfy.writer.failed') : t(`comfy.writer.${w.phase}`).replace('{model}', w.model ?? '').replace('{chars}', String(w.chars ?? 0)).replace('{seconds}', String(w.seconds ?? 0));
  /** Asks the local AI for a skill (or a revision of the open draft) and puts it in the editor. */
  const write = async () => {
   if (!bridge.writeSkill || !draft) return;
   const controller = abort.current = new AbortController();
   setWriter({phase: 'connecting'}); setError('');
   try {
    let current: Skill | undefined;
    try { current = draft.name.trim() || draft.instructions.trim() ? fromDraft({...draft, name: draft.name.trim() || 'Draft'}) : undefined; } catch { current = undefined; }
    const skill = await bridge.writeSkill(request, current, {loras, workflows}, setWriter, controller.signal);
    setDraft(d => d && {...toDraft({...skill, id: d.id}, d.scope, d.from)});
   } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    setWriter(message === 'Cancelled' ? {phase: 'cancelled'} : {phase: 'failed', message});
   } finally { abort.current = null; }
  };
  const all = listSkills(project, machine), sets = {project, machine};
  const store = (scope: Scope, label: string, next: Skills) => scope === 'project' ? bridge.writeProject(label, next) : bridge.writeMachine(next);
  const fail = (e: unknown) => { const message = e instanceof Error ? e.message : String(e); setError(message); bridge.report(e); };
  const save = () => {
   if (!draft) return;
   try {
    const skill = fromDraft(draft), target = sets[draft.scope];
    if (target.items.some(k => k.name.trim().toLowerCase() === skill.name.toLowerCase() && !(draft.from?.scope === draft.scope && draft.from.id === k.id))) throw Error(t('skills.nameTaken'));
    if (draft.from && draft.from.scope !== draft.scope) { const old = sets[draft.from.scope]; store(draft.from.scope, `Move skill ${skill.name}`, {...old, items: old.items.filter(k => k.id !== draft.from!.id)}); }
    const fresh = sets[draft.scope], exists = fresh.items.some(k => k.id === skill.id);
    store(draft.scope, `${exists ? 'Edit' : 'Add'} skill ${skill.name}`, {...fresh, items: exists ? fresh.items.map(k => k.id === skill.id ? skill : k) : [...fresh.items, skill]});
    setDraft(null); setError('');
   } catch (e) { fail(e); }
  };
  /** Project and computer skills are removed; a built-in one is hidden in the project (Show hidden brings it back). */
  const remove = (skill: ScopedSkill) => {
   try {
    if (skill.scope === 'builtin') bridge.writeProject(`Delete skill ${skill.name}`, {...project, hidden: [...new Set([...(project.hidden ?? []), skill.id])]});
    else { const set = sets[skill.scope]; store(skill.scope, `Delete skill ${skill.name}`, {...set, items: set.items.filter(k => k.id !== skill.id)}); }
   } catch (e) { fail(e); }
  };
  const restoreHidden = () => { try { if (project.hidden?.length) bridge.writeProject('Show hidden built-in skills', {...project, hidden: []}); if (machine.hidden?.length) bridge.writeMachine({...machine, hidden: []}); } catch (e) { fail(e); } };
  const blank = () => toDraft({id: crypto.randomUUID(), name: '', description: '', instructions: '', always: false}, 'project');
  const edit = (d: Partial<Draft>) => setDraft(draft && {...draft, ...d});
  const field = (key: 'name' | 'description' | 'prompt' | 'negative', label: string, placeholder?: string) => <label className="field"><span>{label}</span><input aria-label={label} placeholder={placeholder} value={draft![key]} onChange={e => edit({[key]: e.target.value})}/></label>;
  const number = (key: 'width' | 'height' | 'steps' | 'cfg', label: string, step: number) => <label className="field"><span>{label}</span><input type="number" aria-label={label} step={step} placeholder={t('skills.keep')} value={draft![key]} onChange={e => edit({[key]: e.target.value})}/></label>;
  const scopeName = (scope: ScopedSkill['scope']) => t(`skills.scope.${scope}`);

  return <div className="panel-body skills-panel" data-testid="skills-panel">
   <InstructionsField label={t('skills.projectInstructions')} help={t('skills.projectInstructionsHelp')} value={project.instructions} disabled={!editable} save={next => { try { bridge.writeProject('Edit project instructions', {...project, instructions: next}); } catch (e) { fail(e); } }}/>
   <InstructionsField label={t('skills.myInstructions')} help={t('skills.myInstructionsHelp')} value={machine.instructions} disabled={false} save={next => { try { bridge.writeMachine({...machine, instructions: next}); } catch (e) { fail(e); } }}/>
   {!draft && <div className="panel-actions"><button className="primary" disabled={!editable} onClick={() => { setWriter(null); setDraft(blank()); }}>{t('skills.new')}</button>{bridge.writeSkill && <button disabled={!editable} onClick={() => { setWriter(null); setRequest(''); setDraft(blank()); }} title={t('skills.aiHint')}>{`✨ ${t('skills.newWithAi')}`}</button>}</div>}
   {error && <p role="alert" className="component-warning">{error}</p>}
   {draft && <form className="skill-editor" aria-label={t('skills.editor')} data-testid="skill-editor" onSubmit={e => { e.preventDefault(); save(); }}>
    {bridge.writeSkill && <div className="skill-writer" data-testid="skill-writer">
     <label className="field"><span>{t('skills.aiRequest')}</span><textarea aria-label={t('skills.aiRequest')} rows={2} placeholder={t('skills.aiRequestHint')} value={request} disabled={writing} onChange={e => setRequest(e.target.value)}/></label>
     <div className="panel-actions">{writing
      ? <button type="button" onClick={() => abort.current?.abort()}>{t('comfy.cancelWriting')}</button>
      : <button type="button" disabled={!request.trim() && !draft.name.trim() && !draft.instructions.trim()} onClick={() => { void write(); }}>{`✨ ${draft.name.trim() || draft.instructions.trim() ? t('skills.reviseWithAi') : t('skills.writeWithAi')}`}</button>}</div>
     {writer && <p className={`prompt-writer-status ${writer.phase}`} role="status" aria-live="polite" data-testid="skill-writer-status" data-phase={writer.phase}>{writing && <span className="spinner" aria-hidden="true"/>}{writerText(writer)}</p>}
    </div>}
    {field('name', t('skills.name'))}
    {field('description', t('skills.description'), t('skills.descriptionHint'))}
    <div className="inline-row">
     <label className="field"><span>{t('skills.savedIn')}</span><select aria-label={t('skills.savedIn')} value={draft.scope} onChange={e => edit({scope: e.target.value as Scope})}><option value="project">{scopeName('project')}</option><option value="machine">{scopeName('machine')}</option></select></label>
     <label className="checkbox"><input type="checkbox" aria-label={t('skills.always')} checked={draft.always} onChange={e => edit({always: e.target.checked})}/>{t('skills.always')}</label>
    </div>
    <label className="field"><span>{t('skills.instructions')}</span><textarea aria-label={t('skills.instructions')} rows={6} placeholder={t('skills.instructionsHint')} value={draft.instructions} onChange={e => edit({instructions: e.target.value})}/></label>
    <details className="skill-preset" open={Boolean(draft.prompt || draft.loras.length || draft.kind)}><summary>{t('skills.preset')}</summary>
     <p className="panel-empty">{t('skills.presetHelp')}</p>
     <label className="field"><span>{t('skills.kind')}</span><select aria-label={t('skills.kind')} value={draft.kind} onChange={e => edit({kind: e.target.value as Draft['kind']})}><option value="">{t('skills.kind.any')}</option><option value="image">{t('comfy.kind.image')}</option><option value="audio">{t('comfy.kind.audio')}</option></select></label>
     {field('prompt', t('skills.template'), t('skills.templateHint'))}
     {field('negative', t('comfy.negative'), t('skills.keep'))}
     <label className="field"><span>{t('comfy.workflow')}</span><select aria-label={t('comfy.workflow')} value={draft.workflow} onChange={e => edit({workflow: e.target.value})}><option value="">{t('skills.keep')}</option>{[...new Set([draft.workflow, ...workflows].filter(Boolean))].map(w => <option key={w} value={w}>{w}</option>)}</select></label>
     <div className="inline-row">{number('width', t('comfy.width'), 8)}{number('height', t('comfy.height'), 8)}</div>
     <div className="inline-row">{number('steps', t('comfy.steps'), 1)}{number('cfg', t('comfy.cfg'), 0.5)}</div>
     <fieldset className="generate-loras"><legend>{t('comfy.loras')}</legend>
      <datalist id="skill-loras">{loras.map(l => <option key={l} value={l}/>)}</datalist>
      {draft.loras.map((l, i) => <div className="lora-row" key={i}>
       <input aria-label={`${t('skills.loraName')} ${i + 1}`} list="skill-loras" value={l.name} onChange={e => edit({loras: draft.loras.map((x, j) => j === i ? {...x, name: e.target.value} : x)})}/>
       <input type="number" aria-label={`${t('comfy.loraStrength')} ${i + 1}`} min={-4} max={4} step={0.05} value={l.strength} onChange={e => edit({loras: draft.loras.map((x, j) => j === i ? {...x, strength: e.target.value} : x)})}/>
       <button type="button" aria-label={`${t('comfy.removeLora')} ${i + 1}`} onClick={() => edit({loras: draft.loras.filter((_, j) => j !== i)})}>×</button>
      </div>)}
      <button type="button" disabled={draft.loras.length >= 8} onClick={() => edit({loras: [...draft.loras, {name: loras[0] ?? '', strength: '1'}]})}>{t('comfy.addLora')}</button>
     </fieldset>
    </details>
    <div className="panel-actions"><button type="submit" className="primary" disabled={!draft.name.trim() || (draft.scope === 'project' && !editable)}>{t('skills.save')}</button><button type="button" onClick={() => { setDraft(null); setError(''); }}>{t('skills.cancel')}</button></div>
   </form>}
   <div className="skills-list" role="list" aria-label={t('skills.list')}>
    {all.map(k => <div role="listitem" key={`${k.scope}:${k.id}`} className="skill-item" data-skill={k.name} data-scope={k.scope}>
     <div className="skill-head"><strong>{k.name}</strong><code>/{skillSlug(k.name)}</code></div>
     <small>{[scopeName(k.scope), overrides(k) ? t('skills.editedBuiltIn') : '', k.always ? t('skills.always') : '', k.generate ? t(k.generate.kind === 'audio' ? 'skills.soundPreset' : 'skills.imagePreset') : ''].filter(Boolean).join(' · ')}</small>
     {k.description && <p>{k.description}</p>}
     <div className="panel-actions">
      <button disabled={k.scope !== 'machine' && !editable} aria-label={`${t('skills.edit')} ${k.name}`} title={k.scope === 'builtin' ? t('skills.editBuiltInHint') : undefined} onClick={() => { setError(''); setWriter(null); setRequest(''); setDraft(k.scope === 'builtin' ? toDraft({...k, id: crypto.randomUUID()}, 'project') : toDraft(k, k.scope, {scope: k.scope, id: k.id})); }}>{t('skills.edit')}</button>
      <button disabled={!editable} aria-label={`${t('skills.copy')} ${k.name}`} onClick={() => { setError(''); setDraft({...toDraft(k, k.scope === 'machine' ? 'machine' : 'project'), id: crypto.randomUUID(), name: k.scope === 'builtin' && !all.some(x => x.scope !== 'builtin' && x.name === k.name) ? k.name : `${k.name} 2`}); }}>{t('skills.copy')}</button>
      <button disabled={k.scope !== 'machine' && !editable} aria-label={`${t('skills.delete')} ${k.name}`} title={k.scope === 'builtin' ? t('skills.deleteBuiltInHint') : overrides(k) ? t('skills.deleteOverrideHint') : undefined} onClick={() => remove(k)}>{t('skills.delete')}</button>
     </div>
    </div>)}
   </div>
   {hidden.size > 0 && <div className="panel-actions"><button disabled={!editable} onClick={restoreHidden}>{t('skills.showHidden').replace('{n}', String(hidden.size))}</button></div>}
   <p className="panel-empty">{t('skills.help').replace('{count}', String(builtInSkills.length))}</p>
  </div>;
 };
}
