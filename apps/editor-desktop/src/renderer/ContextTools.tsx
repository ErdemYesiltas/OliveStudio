import type {ComponentType} from 'react';
import type {Json} from '@rewrite/sdk';
import type {Entity} from '@rewrite/scene';
import {CommitInput, finiteNumber} from '@rewrite/ui/drafts';
import {ALargeSmall, AlignCenter, AlignLeft, AlignRight, Blend, Bold, Italic, MoveHorizontal, PaintBucket, Palette, PenLine, SquareRoundCorner, Type} from 'lucide-react';

type Icon = ComponentType<{size?: number}>;
/** A quick control: a colour, a number, an on/off toggle, a choice of icons, or the font. */
type Quick = {key: string; tip: string; icon?: Icon; kind: 'color' | 'number' | 'toggle' | 'choice' | 'font'; on?: string; off?: string; choices?: {value: string; icon: Icon; tip: string}[]; min?: number; max?: number; step?: number; visible?(data: Record<string, Json>): boolean};
const align: Quick = {key: 'align', tip: 'field.align', kind: 'choice', choices: [{value: 'left', icon: AlignLeft, tip: 'context.alignLeft'}, {value: 'center', icon: AlignCenter, tip: 'context.alignCenter'}, {value: 'right', icon: AlignRight, tip: 'context.alignRight'}]};
const opacity: Quick = {key: 'alpha', tip: 'context.opacity', icon: Blend, kind: 'number', min: 0, max: 1, step: 0.05};
/** What the floating toolbar offers for each visual component. */
export const QUICK: Record<string, Quick[]> = {
 'pixi.text': [
  {key: 'font', tip: 'context.font', icon: Type, kind: 'font'}, {key: 'fontSize', tip: 'context.fontSize', icon: ALargeSmall, kind: 'number', min: 6, max: 400, step: 1},
  {key: 'fontWeight', tip: 'context.bold', icon: Bold, kind: 'toggle', on: 'bold', off: 'normal'}, {key: 'fontStyle', tip: 'context.italic', icon: Italic, kind: 'toggle', on: 'italic', off: 'normal'},
  align, {key: 'color', tip: 'context.textColor', kind: 'color'}, {key: 'strokeColor', tip: 'context.stroke', kind: 'color'},
  {key: 'strokeWidth', tip: 'context.strokeWidth', icon: PenLine, kind: 'number', min: 0, max: 40, step: 1}, {key: 'letterSpacing', tip: 'context.letterSpacing', icon: MoveHorizontal, kind: 'number', min: -50, max: 200, step: 1},
 ],
 'pixi.bitmapText': [
  {key: 'font', tip: 'context.font', icon: Type, kind: 'font'}, {key: 'fontSize', tip: 'context.fontSize', icon: ALargeSmall, kind: 'number', min: 6, max: 400, step: 1},
  align, {key: 'color', tip: 'context.textColor', kind: 'color'}, {key: 'letterSpacing', tip: 'context.letterSpacing', icon: MoveHorizontal, kind: 'number', min: -50, max: 200, step: 1},
 ],
 'pixi.shape': [
  {key: 'color', tip: 'context.fill', icon: PaintBucket, kind: 'color'}, {key: 'strokeColor', tip: 'context.stroke', icon: PenLine, kind: 'color'},
  {key: 'strokeWidth', tip: 'context.strokeWidth', icon: PenLine, kind: 'number', min: 0, max: 200, step: 1},
  {key: 'rounded', tip: 'context.corner', icon: SquareRoundCorner, kind: 'number', min: 0, max: 100, step: 1, visible: d => d.kind === 'rect'},
  opacity,
 ],
 'pixi.sprite': [{key: 'tint', tip: 'context.tint', icon: Palette, kind: 'color'}, opacity],
};

/**
 * Style controls for the selected object's visual component in the floating toolbar: icons only, names as tooltips.
 * A change applies to every selected object with the same component (one undo step).
 */
export function ContextStyle({entity, selection, t, fonts, editable, set, parse}: {
 entity: Entity; selection: readonly Entity[]; t(key: string): string; fonts: readonly {id: string; name: string}[]; editable: boolean;
 /** `fromField`: the value comes from a committing field (the draft controller is already applying it). */
 set(type: string, key: string, value: Json, ids: readonly string[], fromField: boolean): void;
 /** Component data with defaults filled in (older saves lack newer fields). */
 parse(type: string, data: Json): Json;
}) {
 const component = entity.components.find(c => QUICK[c.type]);
 if (!component) return null;
 const data = parse(component.type, component.data) as Record<string, Json>, ids = selection.filter(e => e.components.some(c => c.type === component.type)).map(e => e.id);
 const apply = (key: string, value: Json, fromField = false) => set(component.type, key, value, ids.length ? ids : [entity.id], fromField);
 return <div role="group" aria-label={t('context.style')} className="context-style" data-component={component.type}>
  {QUICK[component.type].filter(q => q.key in data && (q.visible?.(data) ?? true)).map(q => {
   const tip = t(q.tip), value = data[q.key], Icon = q.icon;
   if (q.kind === 'color') return <span key={q.key} className="context-swatch" data-tip={tip}>{Icon && <Icon size={13}/>}<CommitInput live type="color" label={tip} value={String(value)} disabled={!editable} commit={raw => apply(q.key, raw, true)}/></span>;
   if (q.kind === 'number') return <span key={q.key} className="context-number" data-tip={tip}>{Icon && <Icon size={13}/>}<CommitInput live type="number" label={tip} min={q.min} max={q.max} step={q.step} value={Number(value)} disabled={!editable} commit={raw => apply(q.key, finiteNumber(raw), true)}/></span>;
   if (q.kind === 'toggle') { const pressed = value === q.on; return <button key={q.key} aria-label={tip} data-tip={tip} aria-pressed={pressed} disabled={!editable} onClick={() => apply(q.key, (pressed ? q.off : q.on) ?? '')}>{Icon && <Icon size={14}/>}</button>; }
   if (q.kind === 'choice') return <span key={q.key} role="radiogroup" aria-label={tip} className="context-choice">{q.choices!.map(c => <button key={c.value} role="radio" aria-label={t(c.tip)} data-tip={t(c.tip)} aria-checked={value === c.value} disabled={!editable} onClick={() => apply(q.key, c.value)}><c.icon size={14}/></button>)}</span>;
   return <span key={q.key} className="context-font" data-tip={tip}>{Icon && <Icon size={13}/>}<select aria-label={tip} value={String(value ?? '')} disabled={!editable} onChange={e => apply(q.key, e.target.value)}><option value="">{t('context.systemFont')}</option>{String(value ?? '') && !fonts.some(f => f.id === value) && <option value={String(value)}>{String(value).slice(0, 8)}…</option>}{fonts.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></span>;
  })}
 </div>;
}
