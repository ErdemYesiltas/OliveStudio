import { achievementActions, achievementTriggers, type AchievementControls } from '@rewrite/achievements';
import { behaviorActions, behaviorTriggers, type BehaviorControls } from '@rewrite/behavior/contracts';
import { dialogueActions, dialogueTriggers, type DialogueControls } from '@rewrite/dialogue';
import { inputTriggers } from '@rewrite/input';
import { builtinActions, builtinTriggers, cameraActions, languageActions, physicsActions, physicsTriggers,
  type ActionDefinition, type InteractionCatalog, type TriggerDefinition } from '@rewrite/interactions';
import type { Container } from 'pixi.js';
import { emptyContent, type GameContent } from './gameContent';
import { gameEntity } from './previewEntity';
import type { Project } from './project';
import type { SceneObject } from './scene';
import { selectionTree } from './selection';
import { physicsEntities } from './scenePhysics';
import { spineSignalNames } from './spineAssets';
import { t } from './i18n';

const spineReferences = (catalog: InteractionCatalog, clips: boolean) => catalog.entities.flatMap(entity => {
  const spine = entity.components.find(component => component.type === 'spine.renderer');
  if (!spine) return [];
  const asset = (spine.data as { assetId?: string | null }).assetId;
  const names = asset && (clips ? catalog.spineAnimations?.(asset) : catalog.spineEvents?.(asset));
  return [{ id: entity.id, name: entity.name, events: [
    { id: '', name: t(clips ? 'logicAnySpineAnimation' : 'logicAnySpineEvent') },
    ...(names || []).map(name => ({ id: name, name })),
  ] }];
});
const spineTriggers: TriggerDefinition[] = [
  { type: 'spine.event', titleKey: 'directorOnSpineEvent', entityReference: true, references: catalog => spineReferences(catalog, false) },
  { type: 'spine.complete', titleKey: 'directorOnSpineComplete', entityReference: true, references: catalog => spineReferences(catalog, true) },
];

export function logicEntities(objects: SceneObject[], display: (id: string) => Container | undefined = () => undefined) {
  return [...selectionTree(objects).values()].map(({ node, parent }) => gameEntity(node, parent, () => display(node.id)));
}

export function logicCatalog(project: Project, objects: SceneObject[]): InteractionCatalog {
  const physical = new Map(physicsEntities(objects, () => undefined).map(entity =>
    [entity.id, entity.components.filter(part => part.type !== 'scene.transform2d')]));
  return {
    entities: logicEntities(objects).map(entity => ({ ...entity, components: [...entity.components, ...(physical.get(entity.id) ?? [])] })),
    scenes: project.scenes, globals: project.globals.items,
    inputActions: project.inputMap.actions, languages: (project.content ?? emptyContent).localization.languages,
    spineEvents: alias => spineSignalNames(project.assets.find(asset => asset.alias === alias))?.events ?? [],
    spineAnimations: alias => spineSignalNames(project.assets.find(asset => asset.alias === alias))?.animations ?? [],
  };
}

export function logicTools(content: GameContent = emptyContent, controls?: {
  dialogue?: DialogueControls;
  achievements?: AchievementControls;
  behavior?: () => BehaviorControls | undefined;
  playSpine?: (id: string, clip: string, loop: boolean) => void;
}) {
  const playSpine: ActionDefinition = {
    type: 'spine.play', titleKey: 'logicPlaySpine', entityReference: true,
    references: catalog => spineReferences(catalog, true).filter(item => item.events.length > 1).map(item => ({
      ...item, events: [{ id: '', name: t('defaultAnimation') }, ...item.events.slice(1)],
    })),
    execute: action => {
      if (!controls?.playSpine) throw new Error(t('logicSpinePlaybackUnavailable'));
      controls.playSpine(action.targetId, typeof action.to === 'string' ? action.to : '', action.value);
    },
  };
  return {
    triggers: [...builtinTriggers.filter(trigger => trigger.type !== 'timer.done'), ...spineTriggers, ...inputTriggers, ...behaviorTriggers,
      ...dialogueTriggers(() => content.dialogues), ...achievementTriggers(() => content.achievements), ...physicsTriggers],
    actions: [...builtinActions.filter(action => !action.type.startsWith('timer.') && action.type !== 'entity.spawn' && action.type !== 'entity.destroy'),
      playSpine, ...cameraActions, ...languageActions, ...physicsActions, ...behaviorActions(controls?.behavior ?? (() => undefined)),
      ...dialogueActions(() => content.dialogues, () => controls?.dialogue),
      ...achievementActions(() => content.achievements, () => controls?.achievements)],
  };
}
