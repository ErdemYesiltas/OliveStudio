import { createContext, useContext, useEffect, useState, type ComponentProps, type HTMLAttributes, type ReactNode } from 'react';
import { Maximize2, Minus, Minimize2, X, type LucideIcon } from 'lucide-react';

export function hint(label: string, description?: string) {
  return { 'data-tip': label, 'data-tip-description': description };
}

export function IconButton({ icon: Icon, label, description, className = '', ...button }: {
  icon: LucideIcon;
  label: string;
  description?: string;
} & Omit<ComponentProps<'button'>, 'children'>) {
  // A wrapper keeps tooltips available when a button is disabled.
  return <span className="tool-anchor" {...hint(label, description)}>
    <button type="button" className={`tool ${className}`} aria-label={label} aria-description={description} {...button}>
      <Icon size={16} aria-hidden="true" />
    </button>
  </span>;
}

export const DockChrome = createContext<{
  maximize: () => void;
  minimize: () => void;
  maximized: boolean;
  maximizeLabel: string;
  minimizeLabel: string;
  close: () => void;
  closeLabel: string;
  titleDrag: Pick<HTMLAttributes<HTMLElement>, 'onDragStart' | 'onDragEnd' | 'onDragOver' | 'onDrop'>;
} | null>(null);

export function PanelHeader({ icon: Icon, label, description, children }: {
  icon: LucideIcon; label: string; description: string; children?: ReactNode;
}) {
  const dock = useContext(DockChrome);
  return <div className="panel-header" data-maximized={dock?.maximized || undefined} onDragOver={dock?.titleDrag.onDragOver} onDrop={dock?.titleDrag.onDrop}>
    <h2 tabIndex={0} draggable={!!dock && !dock.maximized} onDragStart={dock?.titleDrag.onDragStart} onDragEnd={dock?.titleDrag.onDragEnd} aria-description={description} {...hint(label, description)}>
      <Icon size={16} aria-hidden="true" /><span className="sr-only">{label}</span>
    </h2>
    <div className="dock-header-tools">{children}</div>
    {dock && <div className="dock-window-controls">
      <IconButton icon={dock.maximized ? Minimize2 : Minus} label={dock.minimizeLabel} onClick={dock.minimize} />
      {!dock.maximized && <IconButton icon={Maximize2} label={dock.maximizeLabel} onClick={dock.maximize} />}
      <IconButton icon={X} className="dock-close" label={dock.closeLabel} onClick={dock.close} />
    </div>}
  </div>;
}

type Tip = { label: string; description?: string; x: number; y: number; above: boolean };

export function Tooltips() {
  const [tip, setTip] = useState<Tip | null>(null);

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let current: HTMLElement | null = null;
    function clear() {
      clearTimeout(timeout);
      current = null;
      setTip(null);
    }
    function show(event: Event) {
      const anchor = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-tip]') : null;
      if (anchor === current) return;
      clear();
      if (!anchor?.dataset.tip) return;
      current = anchor;
      timeout = setTimeout(() => {
        const rect = anchor.getBoundingClientRect();
        const above = rect.bottom + 96 > window.innerHeight;
        const x = Math.max(8, Math.min(rect.left, window.innerWidth - 242));
        setTip({ label: anchor.dataset.tip!, description: anchor.dataset.tipDescription,
          x, y: above ? rect.top - 5 : rect.bottom + 5, above });
      }, event.type === 'focusin' ? 150 : 440);
    }
    function leave(event: PointerEvent | FocusEvent) {
      if (current && (!(event.relatedTarget instanceof Node) || !current.contains(event.relatedTarget))) clear();
    }
    function key(event: KeyboardEvent) {
      if (event.key === 'Escape') clear();
    }
    document.addEventListener('pointerover', show);
    document.addEventListener('pointerout', leave);
    document.addEventListener('focusin', show);
    document.addEventListener('focusout', leave);
    document.addEventListener('pointerdown', clear);
    document.addEventListener('keydown', key);
    window.addEventListener('resize', clear);
    window.addEventListener('scroll', clear, true);
    return () => {
      clearTimeout(timeout);
      document.removeEventListener('pointerover', show);
      document.removeEventListener('pointerout', leave);
      document.removeEventListener('focusin', show);
      document.removeEventListener('focusout', leave);
      document.removeEventListener('pointerdown', clear);
      document.removeEventListener('keydown', key);
      window.removeEventListener('resize', clear);
      window.removeEventListener('scroll', clear, true);
    };
  }, []);

  return tip && <div aria-hidden="true" className="tooltip" data-above={tip.above} style={{ left: tip.x, top: tip.y }}>
    <strong>{tip.label}</strong>{tip.description && <span>{tip.description}</span>}
  </div>;
}
