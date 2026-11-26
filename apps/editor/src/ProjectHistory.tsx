import { useEffect, useState } from 'react';
import { fingerprint } from '@rewrite/production-tools/contracts';
import { parseProject, type Project } from './project';
import { configSchema, validationMessage } from './scene';
import { selectionTree } from './selection';
import { locale, t } from './i18n';

function summarize(before: Project, after: Project) {
  const entities = (project: Project) => new Map(project.scenes.flatMap(scene => [...selectionTree(scene.objects).values()].map(({ node, parent }) => {
    const fields = node.type === 'Container' ? { ...node, children: node.children.map(child => child.id) } : node;
    return [node.id, { scene: scene.name, label: node.label, hash: fingerprint({ scene: scene.id, parent, fields }) }];
  })));
  const old = entities(before), current = entities(after);
  const rows = [...new Set([...old.keys(), ...current.keys()])].flatMap(id => {
    const a = old.get(id), b = current.get(id);
    if (a?.hash === b?.hash) return [];
    const item = b ?? a!;
    return [{ id, label: item.label, scene: item.scene, kind: !a ? 'reviewAdded' : !b ? 'reviewRemoved' : 'reviewChanged' } as const];
  });
  return {
    rows,
    assets: fingerprint({ files: before.assets, library: before.assetLibrary }) !== fingerprint({ files: after.assets, library: after.assetLibrary }),
    prefabs: fingerprint(before.prefabs) !== fingerprint(after.prefabs),
    config: fingerprint(before.config) !== fingerprint(after.config),
  };
}

export function ProjectHistoryPanel({ project, token, dirty, open, bridge }: {
  project: Project;
  token?: string;
  dirty: boolean;
  open: (file: OpenedScene) => void;
  bridge: NonNullable<Window['oliveFiles']>;
}) {
  const [history, setHistory] = useState<ProjectHistory>();
  const [baseline, setBaseline] = useState<Project>();
  const [source, setSource] = useState('');
  const [copies, setCopies] = useState<RecoveryCopy[]>([]);
  const [message, setMessage] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  async function update() {
    if (token) setHistory(await bridge.history(token, 'status'));
    setCopies(await bridge.recovery.list());
  }
  async function task(operate: () => Promise<unknown>) {
    setError(''); setWorking(true);
    try { await operate(); }
    catch (error) { setError(validationMessage(error)); }
    finally { setWorking(false); }
  }
  useEffect(() => { void task(update); }, [token]);
  const change = baseline ? summarize(baseline, project) : undefined;
  const revision = () => source.startsWith('git:') && token ? bridge.history(token, 'show', source.slice(4)) :
    source.startsWith('copy:') ? bridge.recovery.open(source.slice(5)) : Promise.resolve(null);
  return <section className="project-history">
    <fieldset disabled={working}>
      <legend>{t('versionControl')}</legend>
      {!token ? <p>{t('gitSaveFirst')}</p> : history && !history.repo ?
        <button type="button" onClick={() => void task(async () => { await bridge.history(token, 'init'); await update(); })}>{t('gitInit')}</button> :
        history && <>
          <p>{history.branch || 'HEAD'}</p>
          {history.changed && <pre>{history.changed}</pre>}
          <form className="inline-row" onSubmit={event => {
            event.preventDefault();
            void task(async () => { await bridge.history(token, 'commit', message); setMessage(''); await update(); });
          }}>
            <input aria-label={t('gitMessage')} value={message} maxLength={2000} onChange={event => setMessage(event.target.value)} />
            <button type="submit" disabled={dirty || !history.changed || !message.trim()}>{t('gitCommit')}</button>
          </form>
          <button type="button" onClick={() => void task(update)}>{t('gitRefresh')}</button>
        </>}
    </fieldset>
    <fieldset disabled={working}>
      <legend>{t('visualReview')}</legend>
      <div className="inline-row">
        <select aria-label={t('reviewBaseline')} value={source} onChange={event => { setSource(event.target.value); setBaseline(undefined); }}>
          <option value="">{t('reviewBaseline')}</option>
          {!!history?.commits.length && <optgroup label={t('versionControl')}>
            {history.commits.map(commit => <option value={'git:' + commit.hash} key={commit.hash}>{commit.hash.slice(0, 7)} · {commit.summary}</option>)}
          </optgroup>}
          {!!copies.length && <optgroup label={t('hubRecovery')}>
            {copies.map(copy => <option value={'copy:' + copy.id} key={copy.id}>
              {copy.name} · {new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(copy.at)}
            </option>)}
          </optgroup>}
        </select>
        <button type="button" disabled={!source} onClick={() => void task(async () => {
          const file = await revision();
          if (!file) return;
          const raw = JSON.parse(file.text);
          setBaseline(parseProject(file.configText ? { ...raw, config: configSchema.parse(JSON.parse(file.configText)) } : raw));
        })}>{t('reviewCompare')}</button>
        <button type="button" disabled={!source} onClick={() => void task(async () => {
          const file = await revision();
          if (file) open(file);
        })}>{t('reviewOpenCopy')}</button>
      </div>
      {change && <div role="status">
        {!change.rows.length && !change.assets && !change.prefabs && !change.config && <p>{t('reviewNone')}</p>}
        {change.assets && <p>{t('reviewAssets')}</p>}
        {change.prefabs && <p>{t('reviewPrefabs')}</p>}
        {change.config && <p>{t('reviewConfig')}</p>}
        <ul>{change.rows.map(item => <li key={item.id}>{t(item.kind)} · {item.scene} / {item.label}</li>)}</ul>
      </div>}
    </fieldset>
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}
