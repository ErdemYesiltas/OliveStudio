import { Activity, Bot, ImagePlus, Network, ScrollText } from 'lucide-react';
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { applyInputs, applyTemplate, textToImage, WorkflowSchema } from '@rewrite/ai-comfy/contracts';
import { defaultLmUrl, emptyReplyError, pickModel, type Message } from '@rewrite/ai-lm/contracts';
import { assistantGuidance, emptySkills, expandSkillMention, listSkills, SkillsSchema, skillDetails, type Skills } from '@rewrite/ai-skills';
import { createSkillsPanel } from '@rewrite/ai-skills/views';
import { lmStatusOf, type HubStatus } from '@rewrite/ai-hub/contracts';
import { LocalHubTools } from './LocalHubTools';
import { parseAssistantEdits, type AssistantEdit } from './assistantEdits';
import { assetMime } from './assets';
import { IconButton, PanelHeader } from './chrome';
import { t, type MessageKey } from './i18n';
import { validationMessage } from './scene';

type Kind = 'assistant' | 'generate';
type Job = { id: string; kind: Kind; time: number; status: 'running' | 'done' | 'failed' | 'cancelled';
  review?: 'approved' | 'discarded' };
type Generated = { name: string; data: string };
type Props = {
  editable: boolean; skills: Skills; saveSkills: (skills: Skills) => void;
  projectContext: () => string;
  revision: object;
  applyEdits: (edits: AssistantEdit[]) => void;
  importFiles: (files: Generated[]) => void;
};
type SkillsState = { editable: boolean; project: Skills; machine: Skills };

function readCache<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) ?? 'null') ?? fallback; } catch { return fallback; }
}
function cache(key: string, value: unknown) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ } }
const skillsContext = createContext<SkillsState | undefined>(undefined);
const jobsKey = 'olive.ai.activity.v1';
const machineKey = 'olive.ai.skills.v1';
const tabs = [
  { id: 'assistant', title: 'aiAssistant', icon: Bot }, { id: 'generate', title: 'aiCreate', icon: ImagePlus },
  { id: 'activity', title: 'aiActivity', icon: Activity }, { id: 'skills', title: 'aiSkills', icon: ScrollText },
  { id: 'hub', title: 'aiLocalHub', icon: Network },
] as const;

export function AiStudio(props: Props) {
  const [tab, setTab] = useState<typeof tabs[number]['id']>('assistant');
  const [error, setError] = useState('');
  const [lmURL, setLmURL] = useState(() => readCache('olive.ai.lm.url', defaultLmUrl));
  const [comfyURL, setComfyURL] = useState(() => readCache('olive.ai.comfy.url', 'http://127.0.0.1:8188'));
  const [models, setModels] = useState<string[]>([]);
  const [checkpoints, setCheckpoints] = useState<string[]>([]);
  const [lmModel, setLmModel] = useState('');
  const [checkpoint, setCheckpoint] = useState('');
  const [conversation, setConversation] = useState<Message[]>([]);
  const [prompt, setPrompt] = useState('');
  const [imagePrompt, setImagePrompt] = useState('');
  const [workflow, setWorkflow] = useState('');
  const [includeContext, setIncludeContext] = useState(false);
  const [skillId, setSkillId] = useState('');
  const [files, setFiles] = useState<Generated[]>([]);
  const [proposal, setProposal] = useState<{ job: string; revision: object; edits: AssistantEdit[] }>();
  const [jobs, setJobs] = useState<Job[]>(() => {
    const saved = readCache<unknown>(jobsKey, []);
    return Array.isArray(saved) ? saved.filter(job => job && typeof job.id === 'string' && typeof job.time === 'number')
      .slice(0, 100).map(job => ({ ...job, status: job.status === 'running' ? 'cancelled' : job.status })) : [];
  });
  const [machine, setMachine] = useState(() => {
    const result = SkillsSchema.safeParse(readCache(machineKey, emptySkills()));
    return result.success ? result.data : emptySkills();
  });
  const running = jobs.find(job => job.status === 'running');
  const aborting = useRef(new Set<string>());
  const bridge = window.oliveFiles?.ai;
  const hub = window.oliveFiles?.localHub;
  const [hubStatus, setHub] = useState<HubStatus>();
  const [available, setAvailable] = useState(false);
  const [hubChat, setHubChat] = useState(false);
  const chatHubJob = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!hub) return;
    let mounted = true;
    void hub.available().then(async enabled => {
      if (!enabled || !mounted) return;
      setAvailable(true);
      const status = await hub.status();
      if (mounted) setHub(status);
    }).catch(() => {});
    return () => { mounted = false; };
  }, [hub]);
  const skills = listSkills(props.skills, machine);
  const current = useRef(props);
  useLayoutEffect(() => { current.current = props; }, [props]);
  const [SkillsPanel] = useState(() => createSkillsPanel({
    text: key => t(key as MessageKey),
    report: detail => setError(validationMessage(detail)),
    useEditable: () => useContext(skillsContext)!.editable,
    useSkills: () => useContext(skillsContext)!,
    writeProject: (_label, next) => current.current.saveSkills(SkillsSchema.parse(next)),
    writeMachine: next => { setMachine(next); cache(machineKey, next); },
  }));
  function record(job: Job) {
    setJobs(existing => {
      const updated = [job, ...existing.filter(item => item.id !== job.id)].slice(0, 100);
      cache(jobsKey, updated);
      return updated;
    });
  }
  async function run(kind: Kind, task: (id: string) => Promise<void>) {
    if (running || !bridge) return;
    setError('');
    const entry = { id: crypto.randomUUID(), kind, time: Date.now() };
    record({ ...entry, status: 'running' });
    try {
      await task(entry.id);
      record({ ...entry, status: aborting.current.has(entry.id) ? 'cancelled' : 'done' });
    } catch (error) {
      const cancelled = aborting.current.has(entry.id);
      record({ ...entry, status: cancelled ? 'cancelled' : 'failed' });
      if (!cancelled) setError(validationMessage(error));
    } finally { aborting.current.delete(entry.id); }
  }
  async function refresh(kind: Kind) {
    if (!bridge) return;
    setError('');
    try {
      if (kind === 'assistant') {
        const status = hubChat && hub ? lmStatusOf(await hub.status()) : await bridge.models('lm', lmURL);
        if (!status.online) throw new Error(status.error ?? t('aiOffline'));
        const available = status.models.filter(model => model.type === 'llm');
        setModels(available.map(model => model.id));
        setLmModel(pickModel(available, lmModel));
        cache('olive.ai.lm.url', lmURL);
      } else {
        const status = await bridge.models('comfy', comfyURL);
        if (!status.online) throw new Error(status.error ?? t('aiOffline'));
        setCheckpoints(status.checkpoints);
        setCheckpoint(status.checkpoints.includes(checkpoint) ? checkpoint : status.checkpoints[0] ?? '');
        cache('olive.ai.comfy.url', comfyURL);
      }
    } catch (detail) { setError(validationMessage(detail)); }
  }
  function ask(planEdits = false) {
    if (!bridge || !prompt.trim() || !lmModel) return;
    void run('assistant', async id => {
      const expanded = expandSkillMention(prompt, skills);
      const { instructions } = assistantGuidance(props.skills, machine, skillId ? [skillId] : []);
      const system = [t('aiSystem'), ...instructions, expanded.skill && skillDetails(expanded.skill),
        (includeContext || planEdits) && props.projectContext(), planEdits && t('aiEditDirective')]
        .filter(Boolean).join('\n\n').slice(0, 90000);
      const next: Message[] = [...conversation.slice(-20), { role: 'user', content: expanded.text }];
      setConversation(next);
      setPrompt('');
      const request = { model: lmModel, messages: [{ role: 'system' as const, content: system }, ...next], maxTokens: 4096 };
      if (hubChat && hub) chatHubJob.current = id;
      const result = await (hubChat && hub ? hub.chat(id, request) : bridge.run(id, 'lm', lmURL, request));
      if (aborting.current.has(id)) return;
      if (!result.content) throw emptyReplyError(result);
      if (planEdits) setProposal({ job: id, revision: props.revision, edits: parseAssistantEdits(result.content) });
      setConversation([...next, { role: 'assistant', content: result.content }]);
    });
  }
  function generate() {
    if (!bridge) return;
    void run('generate', async id => {
      const chosen = skills.find(skill => skill.id === skillId)?.generate;
      const graph = workflow.trim() ? WorkflowSchema.parse(JSON.parse(workflow)) : applyInputs(textToImage(), {
        prompt: applyTemplate(chosen?.prompt || '{prompt}', imagePrompt.trim()), negative: chosen?.negative ?? '',
        model: checkpoint, steps: chosen?.steps ?? 20, width: chosen?.width ?? 512, height: chosen?.height ?? 512,
        cfg: chosen?.cfg ?? 7, seed: crypto.getRandomValues(new Uint32Array(1))[0],
        batch: 1, denoise: 1, loras: chosen?.loras ?? [],
      });
      const output = await bridge.run(id, 'comfy', comfyURL, graph);
      if (!aborting.current.has(id)) setFiles(output);
    });
  }
  const service = (kind: Kind) => <div className="inline-row">
    <label>{t(kind === 'assistant' ? 'aiLmUrl' : 'aiComfyUrl')} <input type="url" value={kind === 'assistant' ? lmURL : comfyURL}
      disabled={!!running} onChange={event => {
        if (kind === 'assistant') { setLmURL(event.target.value); setModels([]); setLmModel(''); }
        else { setComfyURL(event.target.value); setCheckpoints([]); setCheckpoint(''); }
      }} /></label>
    <button type="button" disabled={!bridge || !!running} onClick={() => void refresh(kind)}>{t('aiConnect')}</button>
  </div>;
  return <section className="panel" aria-label={t('aiStudio')}>
    <PanelHeader icon={Bot} label={t('aiStudio')} description={t('aiStudioHint')}>
      <div className="panel-tools">{tabs.filter(tab => tab.id !== 'hub' || available).map(({ id, title, icon }) => <IconButton key={id} icon={icon} label={t(title)}
        aria-pressed={tab === id} onClick={() => setTab(id)} />)}</div>
      {running && <button type="button" onClick={() => {
        aborting.current.add(running.id);
        const cancel = chatHubJob.current === running.id ? hub?.cancel(running.id) : bridge?.cancel(running.id);
        void cancel?.catch(error => setError(validationMessage(error)));
      }}>{t('aiCancel')}</button>}
    </PanelHeader>
    <div className="panel-body shared-tool-body ai-studio">
      {error && <p role="alert" className="error">{error}</p>}
      {(tab === 'assistant' || tab === 'generate') && <>
        {tab === 'assistant' && hubChat ? <button type="button" disabled={!!running} onClick={() => void refresh(tab)}>{t('hubAiAssistant')}</button> : service(tab)}
        <label>{t('aiUseSkill')} <select value={skillId} onChange={event => setSkillId(event.target.value)}>
          <option value="">—</option>{skills.map(skill => <option value={skill.id} key={skill.id}>{skill.name}</option>)}
        </select></label>
      </>}
      {tab === 'assistant' && <>
        <label>{t('aiModel')} <select value={lmModel} onChange={event => setLmModel(event.target.value)}>
          {models.map(id => <option key={id}>{id}</option>)}
        </select></label>
        <label><input type="checkbox" checked={includeContext} onChange={event => setIncludeContext(event.target.checked)} />{t('aiProjectContext')}</label>
        {!!conversation.length && <div className="ai-transcript" aria-live="polite">{conversation.map((message, index) =>
          <div key={index}><strong>{t(message.role === 'user' ? 'aiYou' : 'aiAssistant')}</strong><p>{message.content}</p></div>)}</div>}
        <textarea aria-label={t('aiQuestion')} value={prompt} maxLength={16000} rows={4} onChange={event => setPrompt(event.target.value)} />
        <div className="inline-row">
          <button type="button" disabled={!!running || !lmModel || !prompt.trim()} onClick={() => ask()}>{t('aiSend')}</button>
          <button type="button" disabled={!!running || !lmModel || !prompt.trim() || !props.editable || !!proposal}
            onClick={() => ask(true)}>{t('aiPlanEdits')}</button>
          <button type="button" disabled={!!running || !conversation.length} onClick={() => setConversation([])}>{t('aiClearChat')}</button>
        </div>
        {proposal && <fieldset className="ai-proposal">
          <legend>{t('aiReviewEdits')}</legend>
          <pre>{JSON.stringify(proposal.edits, null, 2)}</pre>
          <div className="inline-row">
            <button type="button" disabled={!props.editable || props.revision !== proposal.revision} onClick={() => {
              try {
                props.applyEdits(proposal.edits);
                const job = jobs.find(item => item.id === proposal.job);
                if (job) record({ ...job, review: 'approved' });
                setProposal(undefined);
              } catch (error) { setError(validationMessage(error)); }
            }}>{t('aiApproveEdits')}</button>
            <button type="button" onClick={() => {
              const job = jobs.find(item => item.id === proposal.job);
              if (job) record({ ...job, review: 'discarded' });
              setProposal(undefined);
            }}>{t('aiDiscardEdits')}</button>
          </div>
          {props.revision !== proposal.revision && <small>{t('aiStaleProposal')}</small>}
        </fieldset>}
      </>}
      {tab === 'generate' && <>
        <label>{t('aiCheckpoint')} <select value={checkpoint} onChange={event => setCheckpoint(event.target.value)}>
          {checkpoints.map(name => <option key={name}>{name}</option>)}
        </select></label>
        <textarea aria-label={t('aiPrompt')} value={imagePrompt} maxLength={4000} rows={4} onChange={event => setImagePrompt(event.target.value)} />
        <details><summary>{t('aiWorkflow')}</summary>
          <textarea aria-label={t('aiWorkflow')} value={workflow} maxLength={600000} rows={6} onChange={event => setWorkflow(event.target.value)} />
        </details>
        <button type="button" disabled={!bridge || !!running || (!workflow.trim() && (!checkpoint || !imagePrompt.trim()))} onClick={generate}>{t('aiGenerate')}</button>
        <div className="inline-row">{files.map(file => {
          const mime = assetMime(file.name);
          const url = `data:${mime};base64,${file.data}`;
          return <div key={file.name}>
            {mime?.startsWith('image/') ? <img className="ai-output" alt={file.name} src={url} /> : <audio controls src={url} />}
            <button type="button" disabled={!props.editable} onClick={() => {
              try {
                props.importFiles([file]);
                setFiles(items => items.filter(item => item !== file));
              } catch (error) { setError(validationMessage(error)); }
            }}>{t('aiImportOutput')}</button>
          </div>;
        })}</div>
      </>}
      {tab === 'activity' && <ul className="ai-activity">
        {jobs.map(job => <li key={job.id}>{new Date(job.time).toLocaleString()} · {t(job.kind === 'assistant' ? 'aiAssistant' : 'aiCreate')} ·
          {' '}{t(`aiJob_${job.status}`)}{job.review ? ` · ${t(`aiReview_${job.review}`)}` : ''}</li>)}
        {!jobs.length && <li>{t('aiNoJobs')}</li>}
      </ul>}
      {tab === 'skills' && <skillsContext.Provider value={{ project: props.skills, machine, editable: props.editable }}><SkillsPanel /></skillsContext.Provider>}
      {tab === 'hub' && hub && <LocalHubTools hub={hub} status={hubStatus} update={setHub} importFiles={files => {
        if (!props.editable) throw new Error(t('aiImportUnavailable'));
        props.importFiles(files);
      }} report={error => setError(validationMessage(error))} useForChat={hubChat} setUseForChat={enabled => {
        setHubChat(enabled); setModels([]); setLmModel('');
      }} />}
    </div>
  </section>;
}
