import type { DragEvent, HTMLAttributes } from 'react';

type Kind = 'asset' | 'object' | 'script' | 'prefab' | 'scene' | 'global';
const mime = (kind: Kind) => `application/x-olive-value-${kind}`;
let active: { kind: Kind; ids: readonly string[] } | undefined;
let highlighted: HTMLElement | undefined;

function finishDrag() {
  active = undefined;
  delete document.documentElement.dataset.valueDrag;
  highlighted?.removeAttribute('data-value-drop');
  highlighted = undefined;
}

export function startValueDrag(event: DragEvent, kind: Kind, ids: readonly string[], effect: 'copy' | 'copyMove' = 'copy') {
  event.dataTransfer.effectAllowed = effect;
  event.dataTransfer.setData(mime(kind), JSON.stringify(ids));
  active = { kind, ids };
  document.documentElement.dataset.valueDrag = kind;
  window.addEventListener('dragend', finishDrag, { once: true, capture: true });
}

export function valueSource(kind: Kind, id: string): Pick<HTMLAttributes<HTMLElement>, 'draggable' | 'onDragStart'> {
  return { draggable: true, onDragStart: event => startValueDrag(event, kind, [id]) };
}

export function valueDrop<T>(
  kind: Kind, resolve: (ids: readonly string[], event: DragEvent) => T | undefined, apply: (value: T) => void,
): Pick<HTMLAttributes<HTMLElement>, 'onDragOver' | 'onDragLeave' | 'onDrop'> {
  return {
    onDragOver: event => {
      const target = event.currentTarget;
      if (active?.kind !== kind || !event.dataTransfer.types.includes(mime(kind)) ||
        target.closest('fieldset:disabled, :disabled') || resolve(active.ids, event) === undefined) {
        target.removeAttribute('data-value-drop');
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = 'copy';
      if (highlighted !== target) highlighted?.removeAttribute('data-value-drop');
      highlighted = target;
      target.setAttribute('data-value-drop', '');
    },
    onDragLeave: event => {
      if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) {
        event.currentTarget.removeAttribute('data-value-drop');
      }
    },
    onDrop: event => {
      event.currentTarget.removeAttribute('data-value-drop');
      const payload = event.dataTransfer.getData(mime(kind));
      if (!payload || event.currentTarget.closest('fieldset:disabled, :disabled')) return;
      let ids: unknown;
      try { ids = JSON.parse(payload); } catch { return; }
      if (!Array.isArray(ids) || !ids.every((id): id is string => typeof id === 'string')) return;
      const value = resolve(ids, event);
      if (value === undefined) return;
      event.preventDefault();
      event.stopPropagation();
      apply(value);
    },
  };
}

export function dropOne(kind: Kind, accepts: (id: string) => boolean, apply: (id: string) => void) {
  return valueDrop(kind, ids => ids.length === 1 && accepts(ids[0]) ? ids[0] : undefined, apply);
}
