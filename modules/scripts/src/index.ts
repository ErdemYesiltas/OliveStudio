import {components, createItems, type EditorModule, type Json} from '@rewrite/sdk';
import {projectSections, type Project, type SceneReference} from '@rewrite/project';
import {BehaviourSchema, ScriptLibrarySchema, behaviourType, scriptsSection} from './contracts';
export * from './contracts';

/**
 * Scene changes written in scripts (`game.changeScene('Level 2')` with a literal name), per scene that runs the script
 * (an object's behaviour or the scene script): they show in the Scenes flow and keep that scene from being deleted.
 */
export function scriptSceneReferences(project: Project): SceneReference[] {
 const parsed = ScriptLibrarySchema.safeParse(project.extensions[scriptsSection] ?? {version: 1, items: []});
 if (!parsed.success) return [];
 const byName = new Map(project.scenes.map(s => [s.name, s.id])), targets = new Map(parsed.data.items.map(item => [item.id, [...item.source.matchAll(/(?:changeScene|addScene|removeScene)\(\s*(['"\`])([^'"\`]+)\1\s*\)/g)].map(m => byName.get(m[2])).filter((id): id is string => Boolean(id))]));
 return project.scenes.flatMap(scene => {
  const uses = [...scene.entities.flatMap(e => e.components.filter(c => c.type === behaviourType).map(c => ({where: e.name, id: String((c.data as {scriptId?: string}).scriptId ?? '')}))), ...(parsed.data.scenes?.[scene.id]?.scriptId ? [{where: 'scene script', id: parsed.data.scenes[scene.id].scriptId}] : [])];
  return uses.flatMap(use => (targets.get(use.id) ?? []).map(targetSceneId => ({sceneId: scene.id, targetSceneId, label: `${scene.name} / ${use.where} · script ${parsed.data.items.find(i => i.id === use.id)?.name ?? ''}`})));
 });
}

/** Behaviour scripts: the project's script library and the Script component that attaches one to an object. */
export const scriptsModule: EditorModule = {
 manifest: {id: 'scripts', version: '1.0.0', apiVersion: 1, requires: {project: '^1', scene: '^1', interactions: '^1'}, entries: {runtime: '@rewrite/scripts/session'}},
 activate(c) {
  c.contribute(projectSections, 'scripts.library', {key: scriptsSection, parse: v => ScriptLibrarySchema.parse(v) as Json, sceneReferences: project => scriptSceneReferences(project)});
  c.contribute(components, behaviourType, {type: behaviourType, version: 1, titleKey: 'component.script', fields: [], defaults: () => ({scriptId: '', params: {}, refs: {}}), parse: v => BehaviourSchema.parse(v),
   // Object parameters follow copies: a duplicated group keeps pointing inside itself.
   remapReferences: (value, ids) => { const v = BehaviourSchema.parse(value); v.refs = Object.fromEntries(Object.entries(v.refs).map(([k, id]) => [k, ids.entities.get(id) ?? id])); return v; }});
  c.contribute(createItems, 'scripts.object', {titleKey: 'create.scripted', category: 'logic', icon: 'script', name: 'Scripted object', components: [{type: 'pixi.shape', data: {kind: 'rect', width: 80, height: 80, color: '#7c5cff'}}, {type: behaviourType}]});
 },
};
