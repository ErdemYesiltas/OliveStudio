import { type Asset } from './assets';
import { scriptConsole } from '@rewrite/scripts/console';
import { TestSchema } from '@rewrite/production-tools/contracts';
import { defaultPhysicsSettings } from '@rewrite/physics/contracts';
import { cameraInScene, readScene, sceneRecord, type Project } from './project';
import { SceneView } from './runtime';
import { playCinematic } from './playCinematic';
import { t } from './i18n';
import type { z } from 'zod';

export type SceneTest = z.output<typeof TestSchema>;
export type TestReport = { passed: boolean; checks: { frame: number; field: string; expected: unknown; actual: unknown; passed: boolean }[]; errors: string[] };

export async function runSceneTest(project: Project, assets: Map<string, Asset>, input: SceneTest): Promise<TestReport> {
  const test = TestSchema.parse(input);
  const scene = project.scenes.find(item => item.id === test.sceneId);
  if (!scene) throw new Error(t('testMissingScene'));
  const logLength = scriptConsole.lines();
  const surface = document.createElement('div');
  const current = readScene(project, scene.id);
  const missing = new Set<string>();
  const runtime = await SceneView.create(current, { sourceFor: () => undefined, publishAudio: () => {}, publishSource: () => {} },
    aliases => aliases.forEach(alias => missing.add(alias)));
  let stopScripts: (() => void) | undefined;
  let stopTimeline: (() => void) | undefined;
  let stopInput: (() => void) | undefined;
  let stopGlobals: (() => void) | undefined;
  let stopPhysics: (() => void) | undefined;
  let active = scene.id;
  let requestedScene = '';
  const checks: TestReport['checks'] = [];
  const errors: string[] = [];
  const changeScene = (id: string, mode: string) => {
    if (mode !== 'replace') { errors.push(t('testSceneMode')); return; }
    requestedScene = id;
  };
  async function show(id: string) {
    stopScripts?.();
    stopTimeline?.();
    stopPhysics?.();
    if (!project.scenes.some(scene => scene.id === id)) { errors.push(t('testMissingScene')); return; }
    active = id;
    const record = sceneRecord(project, id);
    runtime.show(record.objects, assets, { id, cameraId: cameraInScene(record.objects)?.id }, project.globals, record.lighting);
    stopPhysics = runtime.attachPhysics(record.objects, project.physics ?? defaultPhysicsSettings, result => {
      for (const issue of result?.errors ?? []) if (!errors.includes(issue)) errors.push(issue);
    });
    stopScripts = runtime.attachScripts({
      library: project.scripts, scene: record, scenes: project.scenes, objects: record.objects,
      inputMap: project.inputMap, globals: project.globals, content: project.content, production: project,
      changeScene, debug: false, seed: test.seed,
    }, project.content, surface);
    await runtime.app.scripts.ready;
    stopTimeline = playCinematic(runtime, project, id, target => changeScene(target, 'replace'));
  }
  try {
    runtime.app.pause();
    runtime.app.ticker.remove(runtime.app.render, runtime.app);
    stopGlobals = runtime.attachGlobals(project.globals, () => {});
    stopInput = runtime.attachInput(project.inputMap, surface, () => {}, true);
    await show(active);
    for (let frame = 0; frame <= test.frames; frame++) {
      if (requestedScene) {
        const id = requestedScene;
        requestedScene = '';
        await show(id);
      }
      if (frame > 0) runtime.app.step();
      for (const assertion of test.assertions.filter(item => item.frame === frame)) {
        const field = assertion.field as 'x' | 'y' | 'rotation' | 'active';
        const actual = runtime.inspectObject(assertion.entityId)?.[field];
        const expected = assertion.expected;
        const distance = typeof actual === 'number' && typeof expected === 'number' ? actual - expected : undefined;
        const equal = distance === undefined ? actual === expected : Math.abs(distance) <= assertion.tolerance;
        const passed = actual !== undefined && (assertion.op === '==' ? equal : assertion.op === '!=' ? !equal :
          distance !== undefined && (assertion.op === '>' ? distance > 0 : assertion.op === '>=' ? distance >= 0 :
            assertion.op === '<' ? distance < 0 : distance <= 0));
        checks.push({ frame, field, actual, expected, passed });
      }
      for (const event of test.events.filter(event => event.frame === frame)) runtime.app.input.key(event.code, event.down);
      if (frame % 120 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
  } finally {
    stopTimeline?.(); stopScripts?.(); stopPhysics?.(); stopInput?.(); stopGlobals?.(); runtime.destroy();
  }
  const previous = new Set(logLength);
  if (missing.size) errors.push(t('testMissingTextures', { names: [...missing].join(', ') }));
  for (const line of scriptConsole.lines()) if (line.level === 'error' && !previous.has(line) && !errors.includes(line.message)) errors.push(line.message);
  return { passed: checks.length > 0 && checks.every(check => check.passed) && !errors.length, checks, errors };
}
