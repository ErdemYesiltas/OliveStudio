import { useEffect, useState } from 'react';
import { decodeProblem, outputExtension, type CreateRequest, type HubJobInfo, type HubOutput, type HubStatus } from '@rewrite/ai-hub/contracts';
import { t } from './i18n';

const storageKey = 'olive.localhub.jobs.v1';

export function LocalHubTools({ hub, status, update, useForChat, setUseForChat, importFiles, report }: {
  hub: NonNullable<Window['oliveFiles']>['localHub'];
  status?: HubStatus;
  update: (status: HubStatus) => void;
  useForChat: boolean;
  setUseForChat: (enabled: boolean) => void;
  importFiles: (files: {name: string; data: string}[]) => void;
  report: (error: unknown) => void;
}) {
  const [invite, setInvite] = useState('');
  const [prompt, setPrompt] = useState('');
  const [kind, setKind] = useState<CreateRequest['capability']>('image.create');
  const [model, setModel] = useState('');
  const [working, setWorking] = useState(false);
  const [jobs, setJobs] = useState<HubJobInfo[]>(() => {
    try { const value = JSON.parse(localStorage.getItem(storageKey) ?? '[]'); return Array.isArray(value) ? value.slice(0, 25) : []; }
    catch { return []; }
  });
  const [outputs, setOutputs] = useState<HubOutput[]>([]);
  function record(job: HubJobInfo) {
    setJobs(current => {
      const next = [job, ...current.filter(item => item.id !== job.id)].slice(0, 25);
      try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* storage unavailable */ }
      return next;
    });
  }
  useEffect(() => hub.onEvent(event => {
    if (event.type === 'job') record(event.job);
    else void hub.status().then(update, () => {});
  }), [hub, update]);
  async function run(action: () => Promise<void>) {
    setWorking(true);
    try { await action(); }
    catch (error) { report(new Error(decodeProblem(error).message)); }
    finally { setWorking(false); }
  }
  return <fieldset className="local-hub-tools" disabled={working}>
    <div className="inline-row">
      <strong>{status?.hubName ?? 'LocalHub'}</strong>
      {status?.paired ? <>
        <span>{t(status.online ? 'hubAiOnline' : 'aiOffline')}</span>
        <button type="button" onClick={() => void run(async () => {
          update(await hub.status());
          for (const item of jobs) if (item.status === 'queued' || item.status === 'in_progress') {
            const job = await hub.job(item.id);
            if (job) record(job);
          }
        })}>{t('gitRefresh')}</button>
        <button type="button" onClick={() => void run(async () => {
          await hub.unpair(); setUseForChat(false); update(await hub.status());
        })}>{t('hubAiUnpair')}</button>
      </> : <form className="inline-row" onSubmit={event => {
        event.preventDefault();
        void run(async () => { update(await hub.pair(invite)); setInvite(''); });
      }}>
        <input type="password" aria-label={t('hubAiInvite')} value={invite} maxLength={1024} onChange={event => setInvite(event.target.value)} />
        <button type="submit" disabled={!invite.trim()}>{t('hubAiPair')}</button>
      </form>}
    </div>
    {status?.online && <>
      <label><input type="checkbox" checked={useForChat} disabled={!status.scopes.includes('chat')} onChange={event => setUseForChat(event.target.checked)} />
        {t('hubAiAssistant')}</label>
      <form className="world-portal-form" onSubmit={event => {
        event.preventDefault();
        void run(async () => {
          const result = await hub.create({ capability: kind, prompt, model: model || undefined });
          if (result.job) record(result.job);
          if (result.output) setOutputs([result.output]);
        });
      }}>
        <label>{t('hubAiKind')} <select value={kind} onChange={event => { setKind(event.target.value as typeof kind); setModel(''); }}>
          <option value="image.create">{t('imageAssets')}</option>
          <option value="audio.create">{t('audioAssets')}</option>
          <option value="audio.speech">{t('hubAiSpeech')}</option>
          <option value="video.create">{t('hubAiVideo')}</option>
        </select></label>
        <label>{t('aiModel')} <select value={model} onChange={event => setModel(event.target.value)}>
          <option value="">—</option>
          {status.models.filter(model => model.capabilities.includes(kind)).map(model => <option value={model.id} key={model.id}>{model.id}</option>)}
        </select></label>
        <textarea aria-label={t('aiPrompt')} value={prompt} maxLength={4000} onChange={event => setPrompt(event.target.value)} />
        <button type="submit" disabled={!prompt.trim() || !status.scopes.includes(kind)}>{t('aiGenerate')}</button>
      </form>
    </>}
    <ul className="ai-activity">{jobs.map(job => <li key={job.id}>
      {job.capability} · {t(`hubJob_${job.status}`)}
      {job.error && <small className="error">{job.error}</small>}
      {job.progress !== undefined && <progress value={job.progress} max={1} />}
      {(job.status === 'queued' || job.status === 'in_progress') && <button type="button" disabled={!status?.online}
        onClick={() => void run(async () => { await hub.cancelJob(job.id); const next = await hub.job(job.id); if (next) record(next); })}>{t('aiCancel')}</button>}
      {job.status === 'completed' && <button type="button" disabled={!status?.online}
        onClick={() => void run(async () => { setOutputs(await hub.outputs(job.id)); })}>{t('hubAiOutput')}</button>}
    </li>)}</ul>
    {outputs.map((output, index) => {
      const extension = outputExtension(output);
      const supported = ['png', 'jpg', 'jpeg', 'webp', 'mp3', 'wav'].includes(extension);
      return <div key={output.filename + index} className="inline-row">
        <span>{output.filename}</span>
        <button type="button" disabled={!supported || output.bytes.byteLength > 12 * 1024 * 1024} onClick={() => {
          try {
            let binary = '';
            const step = 8192;
            for (let offset = 0; offset < output.bytes.length; offset += step)
              binary += String.fromCharCode(...output.bytes.subarray(offset, offset + step));
            importFiles([{ name: `localhub-${index + 1}.${extension}`, data: btoa(binary) }]);
          } catch (error) { report(error); }
        }}>{t('aiImportOutput')}</button>
      </div>;
    })}
  </fieldset>;
}
