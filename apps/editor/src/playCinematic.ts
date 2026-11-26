import { parseGlobal } from '@rewrite/interactions';
import { scriptConsole } from '@rewrite/scripts/console';
import { clipList, compileClip, type Cue } from './cinematics';
import { t } from './i18n';
import { sceneRecord, type Project } from './project';
import type { SceneView } from './runtime';
import { validationMessage } from './scene';

export function playCinematic(runtime: SceneView, project: Project, scene: string, replace: (id: string) => void) {
  const record = sceneRecord(project, scene);
  const autoplay = record.cinematics?.autoplay;
  if (!autoplay) return;
  const clips = clipList(record, t('timelineMainClip'));
  let disposed = false;
  const start = (id: string, fade = 0) => {
    if (disposed) return;
    const clip = compileClip(clips, id);
    if (clip) runtime.playTimeline(clip, 0, () => {}, { cue: run, fade });
  };
  function run(cue: Cue) {
    if (disposed) return;
    try {
      switch (cue.kind) {
        case 'message': runtime.app.scripts.broadcast(cue.name, cue.message); break;
        case 'camera': runtime.shakeCamera(); break;
        case 'clip': if (cue.target) queueMicrotask(() => start(cue.target, cue.fade)); break;
        case 'audio': if (cue.target) runtime.app.audio.sources[cue.action](cue.target); break;
        case 'visibility': runtime.setCueVisibility(cue.target, cue.visible); break;
        case 'scene': if (project.scenes.some(scene => scene.id === cue.target)) replace(cue.target); break;
        case 'global': {
          const global = project.globals.items.find(item => item.id === cue.target);
          if (global) runtime.app.globals.set(global.id, parseGlobal(global.type, cue.value));
          break;
        }
      }
    } catch (error) { scriptConsole.log('error', `${cue.name}: ${validationMessage(error)}`); }
  }
  start(autoplay);
  return () => { disposed = true; };
}
