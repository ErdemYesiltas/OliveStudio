import { AchievementsSchema, emptyAchievements, type AchievementStore } from '@rewrite/achievements';
import { createSceneAchievements } from '@rewrite/achievements/toast';
import { DialogueLibrarySchema, emptyDialogueLibrary } from '@rewrite/dialogue';
import { createSceneDialogue } from '@rewrite/dialogue/box';
import { LocalizationSchema, defaultLocalization, type InteractionEvent, type LanguageStore, type GlobalStore } from '@rewrite/interactions';
import { z } from 'zod';

export const contentSchema = z.strictObject({
  dialogues: DialogueLibrarySchema.default(emptyDialogueLibrary),
  achievements: AchievementsSchema.default(emptyAchievements),
  localization: LocalizationSchema.default(defaultLocalization),
});
export type GameContent = z.output<typeof contentSchema>;
export const emptyContent = contentSchema.parse({});

export function startGameContent(content: GameContent, ports: {
  store: AchievementStore;
  globals: () => GlobalStore | undefined;
  language: () => LanguageStore | undefined;
  emit: (event: InteractionEvent) => void;
  silent: () => boolean;
  overlay: HTMLElement;
  achievementTitle: () => string;
}) {
  const dialogue = createSceneDialogue({
    library: () => content.dialogues, globals: ports.globals, emit: ports.emit, silent: ports.silent,
    localize: (key, count) => ports.language()?.text(key, {
      ...ports.globals()?.snapshot(), ...(count === undefined ? {} : { count }),
    }),
  }, ports.overlay);
  const achievements = createSceneAchievements({
    library: () => content.achievements, store: ports.store, globals: ports.globals, emit: ports.emit, silent: ports.silent,
  }, ports.overlay, ports.achievementTitle);
  dialogue.system.start?.();
  achievements.system.start?.();
  return {
    dialogue: Object.assign(dialogue.session, { name: (id: string) => content.dialogues.items.find(item => item.id === id)?.name }),
    achievements: achievements.session,
    tick: () => achievements.session.check(),
    dispose: () => { dialogue.system.dispose(); achievements.system.dispose(); },
  };
}
