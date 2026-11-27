import { scriptConsole } from '@rewrite/scripts/console';
import type { DirectorControl } from '@olivestudio/engine/aperion-director';
import { clipList, compileClip, cueDirectorStep, type ClipData, type Cue } from './cinematics';
import { directorComposition } from './directorModel';
import { t } from './i18n';
import { sceneRecord, type Project } from './project';
import type { SceneView } from './runtime';
import { validationMessage } from './scene';
import { z } from 'zod';

const rigClipSchema = z.object({
  target: z.string().min(1),
  clip: z.string().min(1),
  speed: z.number().min(0.1).max(8).default(1),
  loop: z.boolean().default(false),
});

export function cinematicSession(runtime: SceneView, data: ClipData) {
  const director = runtime.app.director;
  const names: string[] = [];
  const runs = new Set<DirectorControl>();
  const clips = clipList(data, t('timelineMainClip'));
  let disposed = false;
  const report = (name: string, error: unknown) => scriptConsole.log('error', `${name}: ${validationMessage(error)}`);
  const errors = director.events.on('director:error', event => report(event.composition ?? 'Director', event.cause));
  director.registerStrategy({
    type: 'rigClip',
    run(step, context) {
      const { target, clip, speed, loop } = rigClipSchema.parse(step);
      const compiled = compileClip(clips, clip);
      if (!compiled) throw new Error(t('rigClipMissing', { id: clip }));
      return runtime.playRigClip(target, compiled, speed, loop, context);
    },
  });
  for (const definition of data.cinematics?.director ?? []) {
    try {
      const composition = directorComposition(definition);
      director.register(composition);
      names.push(composition.name);
    } catch (error) { report(definition.name, error); }
  }

  function track(control: DirectorControl, name: string) {
    runs.add(control);
    void control.finished.then(() => runs.delete(control), error => {
      runs.delete(control);
      if (!disposed) report(name, error);
    });
    return control;
  }

  function play(name: string) {
    const composition = director.get(name);
    if (!composition) return;
    return track(runtime.dispatchDirector(composition.root, composition.vars), name);
  }

  function start(id: string, fade = 0) {
    if (disposed) return;
    const clip = compileClip(clips, id);
    if (clip) runtime.playTimeline(clip, 0, () => {}, { cue: run, fade });
  }

  function run(cue: Cue) {
    if (disposed) return;
    try {
      switch (cue.kind) {
        case 'message': runtime.app.scripts.broadcast(cue.name, cue.message); break;
        case 'camera': runtime.shakeCamera(); return;
        case 'clip': if (cue.target) queueMicrotask(() => start(cue.target, cue.fade)); return;
        case 'director': play(cue.composition); return;
      }
      const step = cueDirectorStep(cue);
      if (step) track(runtime.dispatchDirector(step), cue.name);
    } catch (error) { report(cue.name, error); }
  }

  return {
    run, start, play,
    pause(paused: boolean) {
      const active = director.activeName && names.includes(director.activeName) ? director.active : undefined;
      if (paused) active?.pause();
      else active?.resume();
      for (const control of runs) { if (paused) control.pause(); else control.resume(); }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (director.activeName && names.includes(director.activeName)) director.stop();
      for (const control of runs) control.stop();
      for (const name of names) director.unregister(name);
      director.unregisterStrategy('rigClip');
      errors.unsubscribe();
      runtime.clearRigClips();
      runtime.stopTimeline();
      runtime.app.audio.director.reset();
      runtime.clearDirectorPreview();
    },
  };
}

export function playCinematic(runtime: SceneView, project: Project, scene: string) {
  const record = sceneRecord(project, scene);
  if (!record.cinematics?.autoplay && !record.cinematics?.director?.length) return;
  const session = cinematicSession(runtime, record);
  if (record.cinematics.autoplay) session.start(record.cinematics.autoplay);
  runtime.emitDirectorSignal('scene:ready', { sceneId: scene, name: record.name });
  return session.dispose;
}
