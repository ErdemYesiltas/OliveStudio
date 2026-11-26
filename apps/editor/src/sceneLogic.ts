import { achievementActions, achievementTriggers, type AchievementControls } from '@rewrite/achievements';
import { behaviorActions, behaviorTriggers, type BehaviorControls } from '@rewrite/behavior/contracts';
import { dialogueActions, dialogueTriggers, type DialogueControls } from '@rewrite/dialogue';
import { inputTriggers } from '@rewrite/input';
import { builtinActions, builtinTriggers, cameraActions, languageActions, physicsActions, physicsTriggers,
  type InteractionCatalog } from '@rewrite/interactions';
import type { Container } from 'pixi.js';
import { emptyContent, type GameContent } from './gameContent';
import { gameEntity } from './previewEntity';
import type { Project } from './project';
import type { SceneObject } from './scene';
import { selectionTree } from './selection';
import { physicsEntities } from './scenePhysics';

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
  };
}

export function logicTools(content: GameContent = emptyContent, controls?: {
  dialogue?: DialogueControls;
  achievements?: AchievementControls;
  behavior?: () => BehaviorControls | undefined;
}) {
  return {
    triggers: [...builtinTriggers.filter(trigger => trigger.type !== 'timer.done'), ...inputTriggers, ...behaviorTriggers,
      ...dialogueTriggers(() => content.dialogues), ...achievementTriggers(() => content.achievements), ...physicsTriggers],
    actions: [...builtinActions.filter(action => !action.type.startsWith('timer.') && action.type !== 'entity.spawn' && action.type !== 'entity.destroy'),
      ...cameraActions, ...languageActions, ...physicsActions, ...behaviorActions(controls?.behavior ?? (() => undefined)),
      ...dialogueActions(() => content.dialogues, () => controls?.dialogue),
      ...achievementActions(() => content.achievements, () => controls?.achievements)],
  };
}
