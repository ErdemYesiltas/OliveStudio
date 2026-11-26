import { Camera, ChevronDown, Crosshair, Eye, House, Play, type LucideIcon } from 'lucide-react';
import { useId, useRef, type ReactNode } from 'react';
import { IconButton } from './chrome';
import { t } from './i18n';
import type { EditView } from './runtime';

function IconDropdown({ icon, label, disabled, align = 'end', children }: {
  icon: LucideIcon; label: string; disabled?: boolean; align?: 'start' | 'end';
  children: (close: () => void) => ReactNode;
}) {
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLSpanElement>(null);
  const close = () => panel.current?.hidePopover();
  return <>
    <span ref={trigger} className="viewport-menu-anchor">
      <IconButton icon={icon} label={label} disabled={disabled} popoverTarget={id}
        onClick={() => {
          const rect = trigger.current?.getBoundingClientRect();
          const popup = panel.current;
          if (!rect || !popup) return;
          popup.style.top = `${rect.bottom + 4}px`;
          popup.style.left = align === 'start' ? `${Math.min(rect.left, window.innerWidth - 75)}px` : 'auto';
          popup.style.right = align === 'end' ? `${Math.max(8, window.innerWidth - rect.right)}px` : 'auto';
          popup.style.maxHeight = `${Math.max(64, window.innerHeight - rect.bottom - 12)}px`;
        }} />
    </span>
    <div id={id} ref={panel} className="viewport-menu" popover="auto" role="group" aria-label={label}>{children(close)}</div>
  </>;
}

export function PlayMenu({ disabled, play }: {
  disabled: boolean; play: (from: 'startup' | 'active') => void;
}) {
  return <div className="viewport-play-menu">
    <IconButton icon={Play} label={t('viewportPlay')} description={t('viewportPlayStartup')} disabled={disabled} onClick={() => play('startup')} />
    <IconDropdown icon={ChevronDown} label={t('viewportPlayOptions')} align="start" disabled={disabled}>
      {close => <div className="viewport-menu-options">
        <IconButton icon={House} label={t('viewportPlayStartup')} title={t('viewportPlayStartup')} onClick={() => { close(); play('startup'); }} />
        <IconButton icon={Crosshair} label={t('viewportPlayActive')} title={t('viewportPlayActive')} onClick={() => { close(); play('active'); }} />
      </div>}
    </IconDropdown>
  </div>;
}

export function EditViewMenu({ value, onChange }: { value: EditView; onChange: (value: EditView) => void }) {
  return <IconDropdown icon={value === 'camera' ? Camera : Eye} label={t('viewportView')}>
    {close => <div className="viewport-menu-options">
      <IconButton icon={Eye} label={t('viewportViewNormal')} title={t('viewportViewNormal')}
        aria-pressed={value === 'normal'} onClick={() => { onChange('normal'); close(); }} />
      <IconButton icon={Camera} label={t('viewportViewCamera')} title={t('viewportViewCamera')}
        aria-pressed={value === 'camera'} onClick={() => { onChange('camera'); close(); }} />
    </div>}
  </IconDropdown>;
}
