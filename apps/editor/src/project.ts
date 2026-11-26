import { MultiplayerSettingsSchema } from '@rewrite/multiplayer/contracts';
import { SkillsSchema } from '@rewrite/ai-skills';
import { remapCinematics } from './cinematics';
import { PhysicsSettingsSchema } from '@rewrite/physics/contracts';
import { ScriptLibrarySchema, emptyLibrary } from '@rewrite/scripts/contracts';
import { z } from 'zod';
import { defaultInputMap, InputMapSchema } from '@rewrite/input';
import { defaultGlobals, GlobalsSchema } from '@rewrite/interactions';
import { t } from './i18n';
import { checkObjectIds, checkShared, createObject, normalizeShared, objectSchema, projectSharedFields, sceneContentFields, sceneSchema,
  type CameraObject, type Scene, type SceneObject } from './scene';
import { duplicateContent, orderedPrefabs, prefabOwner, prefabsSchema } from './prefabs';
import { changeSelection, selectionTree } from './selection';
import { gameSaveSchema } from './globals';
import { contentSchema } from './gameContent';
import { MixerSchema } from '@rewrite/audio/contracts';
import { ShaderLibrarySchema } from '@rewrite/render-pixi/shaders';
import { BrushesSchema, DataSchema, fingerprint, GraphsSchema, LabSchema, QualitySchema, TestsSchema, WorldSchema } from '@rewrite/production-tools/contracts';
import { particlePresetsSchema } from './particlePresets';
import { followSceneLink, sceneLinkSchema, type SceneLink, type ScenePlayback } from '@olivestudio/engine/scenes';
export { followSceneLink, popScene, sceneLinkModes, sceneTransitionKinds, type SceneLink, type ScenePlayback } from '@olivestudio/engine/scenes';

const sceneRecordSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(100),
  ...sceneContentFields,
  links: z.array(sceneLinkSchema).max(60).default([]),
}).refine(scene => new Set(scene.links.map(link => JSON.stringify([link.target, link.mode]))).size === scene.links.length,
  { path: ['links'] });
export type SceneRecord = z.output<typeof sceneRecordSchema>;
export const sceneLimit = 100;
export const buildQualitySchema = QualitySchema;
export const defaultBuildQuality = buildQualitySchema.parse({ version: 1 });
export type BuildQuality = z.output<typeof buildQualitySchema>;

const projectSchema = z.strictObject({
  version: z.literal(2),
  ...projectSharedFields,
  startup: z.string().min(1),
  inputMap: InputMapSchema.default(defaultInputMap),
  globals: GlobalsSchema.default(defaultGlobals),
  gameSave: gameSaveSchema.optional(),
  content: contentSchema.optional(),
  audioMix: MixerSchema.optional(),
  shaders: ShaderLibrarySchema.optional(),
  behaviorGraphs: GraphsSchema.optional(),
  buildQuality: buildQualitySchema.optional(),
  particlePresets: particlePresetsSchema.optional(),
  world: WorldSchema.optional(),
  gameplayLab: LabSchema.optional(),
  gameData: DataSchema.optional(),
  tests: TestsSchema.optional(),
  brushes: BrushesSchema.optional(),
  skills: SkillsSchema.optional(),
  scripts: ScriptLibrarySchema.default(emptyLibrary),
  physics: PhysicsSettingsSchema.optional(),
  multiplayer: MultiplayerSettingsSchema.optional(),
  prefabs: prefabsSchema,
  scenes: z.array(sceneRecordSchema).min(1).max(sceneLimit),
}).superRefine((project, ctx) => {
  checkShared(project, ctx);
  const numberGlobals = new Set(project.globals.items.filter(item => item.type === 'number').map(item => item.id));
  project.inputMap.actions.forEach((action, index) => {
    if (action.globalId && !numberGlobals.has(action.globalId)) ctx.addIssue({
      code: 'custom', path: ['inputMap', 'actions', index, 'globalId'], message: t('inputMissingGlobal'),
    });
  });
  const sceneIds = new Set(project.scenes.map(scene => scene.id));
  if (sceneIds.size !== project.scenes.length) ctx.addIssue({ code: 'custom', path: ['scenes'], message: t('duplicateId') });
  if (!sceneIds.has(project.startup)) ctx.addIssue({ code: 'custom', path: ['startup'], message: t('missingSceneReference') });
  const objectIds = new Set<string>();
  const prefabIds = new Set(project.prefabs.map(prefab => prefab.id));
  if (prefabIds.size !== project.prefabs.length || !orderedPrefabs(project.prefabs)) ctx.addIssue({
    code: 'custom', path: ['prefabs'], message: t('invalidPrefabDependencies'),
  });
  const checkLinks = (nodes: SceneObject[], path: (string | number)[]) => {
    for (const { node } of selectionTree(nodes).values()) {
      if (!node.prefab) continue;
      const members = selectionTree([node]);
      const mapped = Object.values(node.prefab.objects);
      if (!prefabIds.has(node.prefab.source) || new Set(mapped).size !== mapped.length || !mapped.includes(node.id) ||
          mapped.some(id => !members.has(id))) {
        ctx.addIssue({ code: 'custom', path, message: t('invalidPrefabLink') });
      }
    }
  };
  project.prefabs.forEach((prefab, i) => {
    checkObjectIds([prefab.root], ctx, ['prefabs', i, 'root']);
    checkLinks([prefab.root], ['prefabs', i, 'root']);
  });
  project.scenes.forEach((scene, index) => {
    checkObjectIds(scene.objects, ctx, ['scenes', index, 'objects'], objectIds);
    checkLinks(scene.objects, ['scenes', index, 'objects']);
    scene.links.forEach(({ target }, link) => {
      if (!sceneIds.has(target) || target === scene.id) ctx.addIssue({
        code: 'custom', path: ['scenes', index, 'links', link, 'target'], message: t('missingSceneReference'),
      });
    });
  });
}).transform(normalizeShared);

export type Project = Omit<z.output<typeof projectSchema>, 'version'> & { version: 1 | 2 };

export function testFingerprint(project: Project) {
  const { tests, buildQuality: _quality, ...source } = project;
  return fingerprint({ ...source, tests: tests?.items ?? [] });
}

export function cameraInScene(objects: SceneObject[]): CameraObject | undefined {
  for (const object of objects) {
    if (object.type === 'Camera2D') return object;
    if (object.type === 'Container') {
      const camera = cameraInScene(object.children);
      if (camera) return camera;
    }
  }
}

export function newSceneCamera(size: { width: number; height: number }, id?: string): CameraObject {
  const node = createObject('Camera2D');
  return { ...node, id: id ?? node.id, visible: false, position: { x: size.width / 2, y: size.height / 2 },
    camera: { ...node.camera, viewportRelative: true } };
}

function asContainer(node: SceneObject): SceneObject {
  if (node.type !== 'Camera2D') return node;
  const { camera: _camera, ...props } = node;
  return objectSchema.parse({ ...props, type: 'Container', children: [] });
}

function withSceneCameras(project: Project): Project {
  const ids = new Set(project.scenes.flatMap(scene => [...selectionTree(scene.objects).keys()]));
  const prefabs = project.prefabs.map(prefab => {
    const tree = selectionTree([prefab.root]);
    const cameras = new Set([...tree.values()].filter(({ node }) => node.type === 'Camera2D').map(({ node }) => node.id));
    return cameras.size ? { ...prefab, root: changeSelection([prefab.root], cameras, asContainer)[0] } : prefab;
  });
  const scenes = project.scenes.map(scene => {
    const tree = selectionTree(scene.objects);
    const cameras = [...tree.values()].flatMap(({ node }) => node.type === 'Camera2D' ? [node] : []);
    const visible = (node: CameraObject) => {
      for (let id: string | null = node.id; id;) {
        const entry = tree.get(id);
        if (!entry || !entry.node.visible || !entry.node.alpha) return false;
        id = entry.parent;
      }
      return true;
    };
    const candidates = cameras.filter(camera => !prefabOwner(scene.objects, camera.id));
    const primary = candidates.filter(visible).sort((a, b) => (b.camera.priority ?? 0) - (a.camera.priority ?? 0))[0] ?? candidates[0];
    const others = new Set(cameras.filter(camera => camera !== primary).map(camera => camera.id));
    const objects = others.size ? changeSelection(scene.objects, others, asContainer) : scene.objects;
    if (primary) return objects === scene.objects ? scene : { ...scene, objects };
    const base = `scene-camera-${scene.id}`;
    let id = base;
    for (let suffix = 2; ids.has(id); suffix++) id = `${base}-${suffix}`;
    ids.add(id);
    return { ...scene, objects: [...objects, newSceneCamera(project.config.renderer, id)] };
  });
  return { ...project, scenes, prefabs };
}

export function projectFromScene(scene: Scene, name = t('firstScene')): Project {
  return withSceneCameras({
    version: 1, config: scene.config, assets: scene.assets, assetLibrary: scene.assetLibrary,
    startup: 'scene-1', prefabs: [], inputMap: defaultInputMap, globals: defaultGlobals, scripts: emptyLibrary(),
    scenes: [{ id: 'scene-1', name: name.slice(0, 100), objects: scene.objects, timeline: scene.timeline, cinematics: scene.cinematics, lighting: scene.lighting, links: [] }],
  });
}

export function parseProject(value: unknown, name?: string): Project {
  return value && typeof value === 'object' && 'version' in value && value.version === 2 ?
    withSceneCameras(projectSchema.parse(value)) : projectFromScene(sceneSchema.parse(value), name);
}

export function sceneRecord(project: Project, id: string) {
  return project.scenes.find(scene => scene.id === id) ?? project.scenes.find(scene => scene.id === project.startup)!;
}

export function readScene(project: Project, id: string): Scene {
  const { objects, timeline, cinematics, lighting } = sceneRecord(project, id);
  return { version: 1, config: project.config, assets: project.assets, assetLibrary: project.assetLibrary, objects, timeline, cinematics, lighting };
}

export function writeScene(project: Project, id: string, scene: Scene): Project {
  const current = sceneRecord(project, id);
  if (current.objects !== scene.objects && cameraInScene(scene.objects)?.id !== cameraInScene(current.objects)?.id) return project;
  const scenes = current.objects === scene.objects && current.timeline === scene.timeline && current.cinematics === scene.cinematics && current.lighting === scene.lighting ? project.scenes :
    project.scenes.map(record => record === current ? { ...record, objects: scene.objects, timeline: scene.timeline, cinematics: scene.cinematics, lighting: scene.lighting } : record);
  return { ...project, config: scene.config, assets: scene.assets, assetLibrary: scene.assetLibrary, scenes };
}

export function serializeProject(project: Project) {
  const { config, assetLibrary, assets, version } = project;
  const common = {
    version, config, ...(assets.length ? { assets } : {}),
    ...(assetLibrary.folders.length || assetLibrary.entries.length || assetLibrary.bundles?.length ? { assetLibrary } : {}),
  };
  if (version === 1) {
    const { objects, timeline, cinematics, lighting } = sceneRecord(project, project.startup);
    return JSON.stringify({ ...common, objects, ...(timeline.length ? { timeline } : {}), ...(cinematics ? { cinematics } : {}), ...(lighting ? { lighting } : {}) }, null, 2) + '\n';
  }
  return JSON.stringify({ ...common, startup: project.startup, scenes: project.scenes,
    ...(project.content ? { content: project.content } : {}),
    ...(project.audioMix ? { audioMix: project.audioMix } : {}),
    ...(project.shaders ? { shaders: project.shaders } : {}),
    ...(project.behaviorGraphs ? { behaviorGraphs: project.behaviorGraphs } : {}),
    ...(project.buildQuality ? { buildQuality: project.buildQuality } : {}),
    ...(project.particlePresets ? { particlePresets: project.particlePresets } : {}),
    ...(project.world ? { world: project.world } : {}),
    ...(project.gameplayLab ? { gameplayLab: project.gameplayLab } : {}),
    ...(project.gameData ? { gameData: project.gameData } : {}),
    ...(project.tests ? { tests: project.tests } : {}),
    ...(project.brushes ? { brushes: project.brushes } : {}),
    ...(project.skills ? { skills: project.skills } : {}),
    ...(project.globals.items.length ? { globals: project.globals } : {}),
    ...(project.physics ? { physics: project.physics } : {}),
    ...(project.multiplayer ? { multiplayer: project.multiplayer } : {}),
    ...(project.scripts.items.length ? { scripts: project.scripts } : {}),
    ...(project.gameSave ? { gameSave: project.gameSave } : {}),
    ...(project.inputMap.actions.length || project.inputMap.deadzone !== defaultInputMap.deadzone ? { inputMap: project.inputMap } : {}),
    ...(project.prefabs.length ? { prefabs: project.prefabs } : {}) }, null, 2) + '\n';
}

export function duplicateScene(source: SceneRecord): SceneRecord {
  const id = crypto.randomUUID();
  const { objects, timeline, ids } = duplicateContent(source, new Map([[source.id, id]]));
  return {
    ...source, id, name: t('duplicateSceneName', { name: source.name.slice(0, 85) }), objects,
    timeline, cinematics: remapCinematics(source.cinematics, ids),
  };
}

export function canDeleteScene(project: Project, id: string) {
  return project.scenes.length > 1 && project.scenes.some(scene => scene.id === id) &&
    !project.scenes.some(scene => scene.id !== id && scene.links.some(link => link.target === id));
}

export function followProjectSceneLink(project: Project, playback: ScenePlayback, link: SceneLink): ScenePlayback {
  if (!project.scenes.some(scene => scene.id === link.target)) return playback;
  const authored = sceneRecord(project, playback.main).links.find(item => item.target === link.target && item.mode === link.mode);
  return followSceneLink(playback, { ...authored, ...link });
}
