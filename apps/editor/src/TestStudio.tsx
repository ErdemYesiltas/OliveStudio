import { useRef, useState } from 'react';
import { Assertion, TestSchema, TestsSchema } from '@rewrite/production-tools/contracts';
import type { Asset } from './assets';
import { testFingerprint, type Project } from './project';
import { selectionTree } from './selection';
import { runSceneTest, type SceneTest, type TestReport } from './sceneTests';
import { validationMessage } from './scene';
import { t } from './i18n';

type Tests = NonNullable<Project['tests']>;

export function TestStudio({ project, sceneId, assets, editable, save }: {
  project: Project;
  sceneId: string;
  assets: Map<string, Asset>;
  editable: boolean;
  save: (tests: Tests) => void;
}) {
  const tests = project.tests ?? { version: 1 as const, items: [], proofs: [] };
  const [id, setId] = useState('');
  const [report, setReport] = useState<TestReport>();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const test = tests.items.find(item => item.id === id) ?? tests.items[0];
  const [capture, arm] = useState(false);
  const recording = useRef<{ started: number; held: Set<string> } | undefined>(undefined);
  const [frame, setFrame] = useState(0);
  const active = project.scenes.find(scene => scene.id === test?.sceneId);
  const objects = [...selectionTree(active?.objects ?? []).values()].map(({ node }) => node);
  function write(value: SceneTest) {
    if (!editable || running) return;
    try {
      const item = TestSchema.parse(value);
      const items = tests.items.find(test => test.id === item.id) ?
        tests.items.map(test => test.id === item.id ? item : test) : [...tests.items, item];
      save(TestsSchema.parse({ ...tests, items, proofs: tests.proofs.filter(proof => proof.testId !== item.id) }));
      setError('');
      setReport(undefined);
    } catch (error) { setError(validationMessage(error)); }
  }
  async function run(value: SceneTest) {
    setRunning(true); setReport(undefined); setError('');
    try {
      const result = await runSceneTest(project, assets, value);
      setReport(result);
      save({ ...tests, proofs: [...tests.proofs.filter(proof => proof.testId !== value.id),
        { testId: value.id, fingerprint: testFingerprint(project), at: Date.now(), passed: result.passed }] });
    } catch (error) { setError(validationMessage(error)); }
    finally { setRunning(false); }
  }
  function captureKey(code: string, down: boolean) {
    const state = recording.current;
    if (!test || !state || !/^[A-Za-z0-9]{1,24}$/.test(code) || state.held.has(code) === down) return;
    if (down) state.held.add(code);
    else state.held.delete(code);
    const at = Math.min(test.frames, frame + Math.floor((performance.now() - state.started) * 60 / 1000));
    write({ ...test, events: [...test.events, { frame: at, code, down }] });
  }
  function finishCapture() {
    const state = recording.current;
    recording.current = undefined;
    arm(false);
    if (!test || !state?.held.size) return;
    const at = Math.min(test.frames, frame + Math.floor((performance.now() - state.started) * 60 / 1000));
    write({ ...test, events: [...test.events, ...[...state.held].map(code => ({ frame: at, code, down: false }))] });
  }
  return <section className="test-studio" aria-label={t('testStudio')}>
    <div className="inline-row">
      <select aria-label={t('testScenario')} value={test?.id ?? ''} onChange={event => {
        setId(event.target.value); setReport(undefined); setFrame(0); arm(false);
      }}>
        {!test && <option value="">{t('testScenario')}</option>}
        {tests.items.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}
      </select>
      <button type="button" disabled={!editable || running || tests.items.length >= 100} onClick={() => {
        const id = crypto.randomUUID();
        write({ id, sceneId, name: t('testNewScenario'), frames: 60, seed: 1, events: [], assertions: [] });
        setId(id); setFrame(0);
      }}>{t('testNewScenario')}</button>
      <button type="button" disabled={!editable || running || !test?.assertions.length}
        onClick={() => { if (test) void run(test); }}>{t(running ? 'testRunning' : 'testRun')}</button>
    </div>
    {test && <fieldset className="test-studio-fields" key={test.id} disabled={!editable || running}>
      <div className="inline-row">
        <label>{t('testName')} <input defaultValue={test.name} maxLength={100} onBlur={event => {
          if (event.currentTarget.value.trim() !== test.name) write({ ...test, name: event.currentTarget.value });
        }} /></label>
        <label>{t('testFrames')} <input type="number" min={1} max={1800} defaultValue={test.frames} onBlur={event => {
          const next = event.currentTarget.valueAsNumber;
          if (event.currentTarget.validity.valid && Number.isFinite(next) && next !== test.frames) write({ ...test, frames: next });
        }} /></label>
        <label>{t('testSeed')} <input type="number" step={1} defaultValue={test.seed} onBlur={event => {
          const next = event.currentTarget.valueAsNumber;
          if (Number.isInteger(next) && test.seed !== next) write({ ...test, seed: next });
        }} /></label>
        <label>{t('testScene')} <select value={test.sceneId} onChange={event => write({ ...test, sceneId: event.target.value, assertions: [] })}>
          {project.scenes.map(scene => <option key={scene.id} value={scene.id}>{scene.name}</option>)}
        </select></label>
        <button type="button" onClick={() => {
          save({ version: 1, items: tests.items.filter(item => item.id !== test.id), proofs: tests.proofs.filter(proof => proof.testId !== test.id) });
          setId(''); setReport(undefined); arm(false);
        }}>{t('testDelete')}</button>
      </div>
      <details>
        <summary>{t('testInputs')}</summary>
        <div className="inline-row">
          <label>{t('testFrame')} <input type="number" min={0} max={test.frames} value={frame} onChange={event => {
            const value = event.currentTarget.valueAsNumber;
            if (event.currentTarget.validity.valid && Number.isInteger(value)) setFrame(value);
          }} /></label>
          <button type="button" aria-pressed={capture} onBlur={finishCapture} onClick={() => {
            if (capture) finishCapture();
            else { recording.current = { started: performance.now(), held: new Set() }; arm(true); }
          }}
            onKeyDown={event => {
              if (!capture || event.repeat || event.code === 'Tab') return;
              event.preventDefault();
              if (event.code === 'Escape') finishCapture();
              else captureKey(event.code, true);
            }}
            onKeyUp={event => {
              if (!capture || event.code === 'Escape' || event.code === 'Tab') return;
              event.preventDefault();
              captureKey(event.code, false);
            }}>{t(capture ? 'testCaptureListening' : 'testCaptureInput')}</button>
        </div>
        <ol>{test.events.map((input, index) => <li key={index}>
          {input.frame} · {input.code} · {t(input.down ? 'testKeyDown' : 'testKeyUp')}
          <button type="button" onClick={() => write({ ...test, events: test.events.filter((_, item) => item !== index) })}>{t('testDelete')}</button>
        </li>)}</ol>
      </details>
      <form className="inline-row" onSubmit={event => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        try {
          const assertion = Assertion.parse({ frame: Number(data.get('frame')), entityId: data.get('object'), field: data.get('field'),
            op: data.get('op'), expected: JSON.parse(String(data.get('expected'))) });
          write({ ...test, assertions: [...test.assertions, assertion] });
        } catch (error) { setError(validationMessage(error)); }
      }}>
        <label>{t('testFrame')} <input name="frame" type="number" min={0} max={test.frames} defaultValue={test.frames} required /></label>
        <label>{t('dataObject')} <select name="object" required>
          {objects.map(object => <option key={object.id} value={object.id}>{object.label}</option>)}
        </select></label>
        <label>{t('dataProperty')} <select name="field">{['x', 'y', 'rotation', 'active'].map(field => <option key={field}>{field}</option>)}</select></label>
        <label>{t('testCompare')} <select name="op">{['==', '!=', '>', '>=', '<', '<='].map(op => <option key={op}>{op}</option>)}</select></label>
        <label>{t('testExpected')} <input name="expected" required defaultValue="0" /></label>
        <button type="submit" disabled={!objects.length}>{t('testAddCheck')}</button>
      </form>
      <ol>{test.assertions.map((check, index) => <li key={index}>
        {check.frame} · {objects.find(item => item.id === check.entityId)?.label ?? '—'}.{check.field} {check.op} {String(check.expected)}
        <button type="button" onClick={() => write({ ...test, assertions: test.assertions.filter((_, item) => item !== index) })}>{t('testDelete')}</button>
      </li>)}</ol>
    </fieldset>}
    {report && <div role="status">
      <strong>{t(report.passed ? 'testPassed' : 'testFailed')}</strong>
      <ul>{report.checks.map((check, index) => <li key={index} className={check.passed ? undefined : 'error'}>
        {check.frame} · {check.field} · {String(check.actual)} / {String(check.expected)}
      </li>)}</ul>
      {report.errors.map((error, index) => <p key={index} className="error">{error}</p>)}
    </div>}
    {error && <p role="alert" className="error">{error}</p>}
  </section>;
}
