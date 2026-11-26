import { Download, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Asset } from './assets';
import { IconButton } from './chrome';
import { assessBuildBudget, assessExport, builtInExportTargets, initialExportOptions } from './exportReport';
import { t } from './i18n';
import { defaultBuildQuality, serializeProject, type BuildQuality, type Project } from './project';
import { validationMessage } from './scene';

export function ExportDialog({ project, title, assets, close, saveQuality }: {
  project: Project; title: string; assets: ReadonlyMap<string, Asset>; close: () => void; saveQuality: (value: BuildQuality) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [options, setOptions] = useState(() => initialExportOptions(title));
  const [targets, setTargets] = useState(builtInExportTargets);
  const layout = targets.find(target => target.id === options.format)?.layout;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [output, setOutput] = useState<string>();
  const [metricsBytes, setMetricsBytes] = useState<{ bytes: number; textureBytes?: number }>();
  const quality = project.buildQuality ?? defaultBuildQuality;
  const { metrics } = useMemo(() => assessBuildBudget(project, assets, metricsBytes?.bytes, metricsBytes?.textureBytes), [project, assets, metricsBytes]);
  const issues = useMemo(() => assessExport(project, options, assets, layout), [project, options, assets, layout]);
  const blocked = issues.some(issue => issue.level === 'error');
  useEffect(() => {
    dialog.current?.showModal();
    let live = true;
    void window.oliveFiles?.exportTargets().then(items => { if (live) setTargets(items); }).catch(error => { if (live) setError(validationMessage(error)); });
    return () => { live = false; };
  }, []);
  async function submit() {
    if (!window.oliveFiles || blocked || busy) return;
    setBusy(true);
    setError('');
    setOutput(undefined);
    setMetricsBytes(undefined);
    try {
      const saved = await window.oliveFiles.exportGame(serializeProject(project), options);
      if (saved) { setOutput(saved.path); setMetricsBytes(saved); }
    } catch (error) {
      setError(validationMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return <dialog ref={dialog} className="export-dialog" aria-label={t('exportWindow')} onCancel={event => {
    event.preventDefault();
    if (!busy) close();
  }}>
    <header className="export-header">
      <h2>{t('exportWindow')}</h2>
      <IconButton icon={X} label={t('dismiss')} disabled={busy} onClick={close} />
    </header>
    <form onSubmit={event => { event.preventDefault(); void submit(); }}>
      <fieldset disabled={busy}>
        <label>{t('exportTitle')} <input autoFocus maxLength={80} value={options.title} onChange={event =>
          setOptions({ ...options, title: event.target.value })} /></label>
        <label>{t('exportFormat')} <select value={options.format} onChange={event => {
          if (targets.some(target => target.id === event.target.value)) setOptions({ ...options, format: event.target.value });
        }}>
          {targets.map(target => <option key={target.id} value={target.id}>{target.label}</option>)}
        </select></label>
        {layout === 'capacitor' && <label>{t('exportAppId')} <input maxLength={140} value={options.appId}
          onChange={event => setOptions({ ...options, appId: event.target.value })} /></label>}
      </fieldset>
      <details className="export-quality">
        <summary>{t('buildQuality')}</summary>
        <fieldset disabled={busy}>
          {([{ key: 'maxEntities', label: 'buildBudgetObjects', measured: metrics.entities },
            { key: 'audioMB', label: 'buildBudgetAudio', measured: metrics.audio },
            { key: 'textureMB', label: 'buildBudgetTextures', measured: metrics.textures },
            { key: 'buildMB', label: 'buildBudgetOutput', measured: metrics.output }] as const).map(({ key, label, measured }) =>
            <label key={key}>{t(label)}
              <input type="number" min={key === 'maxEntities' ? 1 : 0.01} step={key === 'maxEntities' ? 1 : 'any'} defaultValue={quality[key]}
                key={quality[key]} onBlur={event => {
                  const field = event.currentTarget;
                  const value = field.valueAsNumber;
                  if (field.validity.valid && Number.isFinite(value) && value !== quality[key]) saveQuality({ ...quality, [key]: value });
                  else field.value = String(quality[key]);
                }} />
              <output>{measured?.toLocaleString(undefined, { maximumFractionDigits: 2 }) ?? '—'}</output>
            </label>)}
          <label>{t('buildBudgetEnforce')} <input type="checkbox" checked={quality.enforce}
            onChange={event => saveQuality({ ...quality, enforce: event.target.checked })} /></label>
          {(project.tests?.items ?? []).map(test => <label key={test.id}>{t('requireTest', { name: test.name })}
            <input type="checkbox" checked={quality.requiredTests.includes(test.id)} onChange={event => {
              const requiredTests = event.target.checked ? [...quality.requiredTests, test.id] : quality.requiredTests.filter(id => id !== test.id);
              saveQuality({ ...quality, requiredTests });
            }} />
          </label>)}
        </fieldset>
      </details>
      <section className="export-issues" aria-label={t('exportCompatibility')}>
        <h3>{t('exportCompatibility')}</h3>
        {issues.length ? <ul>{issues.map((issue, index) => <li key={index} data-level={issue.level}>
          <strong>{t(`exportLevel_${issue.level}`)} · {issue.scope}</strong><span>{issue.message}</span>
        </li>)}</ul> : <p>{t('exportNoIssues')}</p>}
      </section>
      {error && <p className="export-error" role="alert">{error}</p>}
      {output && <p className="export-output" role="status">{t('exportSaved', { path: output })}</p>}
      <footer><button type="submit" disabled={blocked || busy || !window.oliveFiles}><Download size={15} aria-hidden="true" />
        {t(busy ? 'exportWriting' : 'exportSubmit')}</button></footer>
    </form>
  </dialog>;
}
