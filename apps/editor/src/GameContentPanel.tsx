import { Database, Globe, MessageSquare, Trophy } from 'lucide-react';
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createAchievementsPanel } from '@rewrite/achievements/views';
import { createDialoguePanel } from '@rewrite/dialogue/views';
import { GlobalStore, type Globals, type Localization } from '@rewrite/interactions';
import { createLocalizationPanel } from '@rewrite/interactions/views';
import { IconButton, PanelHeader } from './chrome';
import { t, type MessageKey } from './i18n';
import type { GameContent } from './gameContent';
import type { Project } from './project';
import { GameDataPanel } from './GameDataPanel';
import type { GameData } from './gameData';

type Props = {
  content: GameContent;
  globals: Globals;
  editable: boolean;
  language: string;
  setLanguage(id: string): void;
  texts: readonly { componentId: string; object: string; text: string }[];
  makeKeys(ids: readonly string[]): void;
  change(mutate: (content: GameContent) => GameContent): void;
  report(error: unknown): void;
  resetPreview(): void;
  project: Project;
  saveData(value: GameData): void;
  tabRequest?: { tab: 'dialogues' | 'achievements' | 'data' };
};

const views = [
  { id: 'dialogues', label: 'contentDialogues', icon: MessageSquare },
  { id: 'localization', label: 'contentLocalization', icon: Globe },
  { id: 'achievements', label: 'contentAchievements', icon: Trophy },
  { id: 'data', label: 'gameData', icon: Database },
] as const;
const ContentContext = createContext<Props | null>(null);
const useContent = () => useContext(ContentContext)!;

export function GameContentPanel(props: Props) {
  const [active, setActive] = useState<typeof views[number]['id']>('dialogues');
  useEffect(() => { if (props.tabRequest) setActive(props.tabRequest.tab); }, [props.tabRequest]);
  const latest = useRef(props);
  const listeners = useRef(new Set<() => void>());
  const version = useRef(0);
  useLayoutEffect(() => {
    latest.current = props;
    version.current++;
    for (const listener of listeners.current) listener();
  }, [props]);
  const panels = useMemo(() => {
    const text = (key: string) => t(key as MessageKey);
    const bridge = { text, useEditable: () => useContent().editable, report: (error: unknown) => latest.current.report(error) };
    const write = (value: Localization) => latest.current.change(content => ({ ...content, localization: value }));
    return {
      dialogues: createDialoguePanel({
        ...bridge,
        useProject: () => { const { content, globals } = useContent(); return { library: content.dialogues, globals: globals.items }; },
        createGlobals: () => new GlobalStore(latest.current.globals),
        edit: (_, mutate) => latest.current.change(content => {
          const dialogues = structuredClone(content.dialogues);
          mutate(dialogues);
          return { ...content, dialogues };
        }),
      }),
      achievements: createAchievementsPanel({
        ...bridge,
        useProject: () => { const { content, globals } = useContent(); return { library: content.achievements, globals: globals.items }; },
        resetPreview: () => latest.current.resetPreview(),
        edit: (_, mutate) => latest.current.change(content => {
          const achievements = structuredClone(content.achievements);
          mutate(achievements);
          return { ...content, achievements };
        }),
      }),
      localization: createLocalizationPanel({
        ...bridge,
        read: () => latest.current.content.localization, write,
        subscribe(listener) { listeners.current.add(listener); return () => { listeners.current.delete(listener); }; },
        version: () => version.current,
        previewLanguage: () => latest.current.language, setPreviewLanguage: id => latest.current.setLanguage(id),
        useSceneTexts: () => latest.current.texts, localize: ids => latest.current.makeKeys(ids),
        importFiles: window.oliveFiles?.importTranslations,
        exportFiles: window.oliveFiles?.exportTranslations,
      }),
    };
  }, []);
  const Panel = active === 'data' ? undefined : panels[active];
  return <section className="panel" aria-label={t('gameContentPanel')}>
    <PanelHeader icon={MessageSquare} label={t('gameContentPanel')} description={t('gameContentPanelHint')}>
      <div className="panel-tools content-tabs">
        {views.map(({ id, label, icon }) => <IconButton key={id} icon={icon} label={t(label)}
          aria-pressed={active === id} onClick={() => setActive(id)} />)}
      </div>
    </PanelHeader>
    <div className="panel-body shared-tool-body">{Panel ? <ContentContext.Provider value={props}><Panel /></ContentContext.Provider> :
      <GameDataPanel project={props.project} editable={props.editable} save={props.saveData} />}</div>
  </section>;
}
