import { AudioLines, SlidersHorizontal, Waves } from 'lucide-react';
import { createContext, useContext, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Mixer } from '@rewrite/audio/contracts';
import { createSoundLab } from '@rewrite/audio/sfx-views';
import { createMixerPanel } from '@rewrite/audio/views';
import { IconButton, PanelHeader } from './chrome';
import { t, type MessageKey } from './i18n';
import type { SceneAudio } from './audio';

type Props = {
  mix: Mixer;
  editable: boolean;
  change(mix: Mixer): void;
  live(): ReturnType<SceneAudio['levels']> | null;
  add(bytes: Uint8Array, name: string, place: boolean): Promise<void>;
  report(error: unknown): void;
};
const AudioContext = createContext(false);

export function AudioStudioPanel(props: Props) {
  const [view, setView] = useState<'mix' | 'sfx'>('mix');
  const latest = useRef(props);
  const listeners = useRef(new Set<() => void>());
  const version = useRef(0);
  useLayoutEffect(() => {
    latest.current = props;
    version.current++;
    for (const listener of listeners.current) listener();
  }, [props]);
  const { Mix, Sound } = useMemo(() => {
    const text = (key: string) => t(key as MessageKey);
    const useEditable = () => useContext(AudioContext);
    return {
      Mix: createMixerPanel({
        useEditable, text, read: () => latest.current.mix, write: value => latest.current.change(value),
        subscribe(listener) { listeners.current.add(listener); return () => { listeners.current.delete(listener); }; },
        version: () => version.current, live: () => latest.current.live(),
      }),
      Sound: createSoundLab({ useEditable, text, report: error => latest.current.report(error),
        add: (bytes, name, place) => latest.current.add(bytes, name, place) }),
    };
  }, []);
  return <section className="panel" aria-label={t('audioStudio')}>
    <PanelHeader icon={AudioLines} label={t('audioStudio')} description={t('audioStudioHint')}>
      <div className="panel-tools content-tabs">
        <IconButton icon={SlidersHorizontal} label={t('audioMix')} aria-pressed={view === 'mix'} onClick={() => setView('mix')} />
        <IconButton icon={Waves} label={t('soundLab')} aria-pressed={view === 'sfx'} onClick={() => setView('sfx')} />
      </div>
    </PanelHeader>
    <div className="panel-body shared-tool-body"><AudioContext.Provider value={props.editable}>
      {view === 'mix' ? <Mix /> : <Sound />}
    </AudioContext.Provider></div>
  </section>;
}
