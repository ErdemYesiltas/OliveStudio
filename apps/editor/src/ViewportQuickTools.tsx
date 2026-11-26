import { AlignCenter, AlignLeft, AlignRight, Bold, Contrast, Paintbrush, Palette, Scaling, Shapes, TextCursorInput, Type } from 'lucide-react';
import { hint, IconButton } from './chrome';
import { Numeric, RequiredText } from './Inspector';
import { t } from './i18n';
import type { SceneObject } from './scene';

const alignments = { left: AlignLeft, center: AlignCenter, right: AlignRight } as const;
type TextObject = Extract<SceneObject, { type: 'Text' | 'BitmapText' }>;

export function ViewportQuickTools({ node, update }: {
  node?: SceneObject; update: (change: (node: SceneObject) => SceneObject) => void;
}) {
  if (!node || node.type === 'Container') return null;
  const styling = (patch: Partial<TextObject['style']>) => update(item =>
    'text' in item ? { ...item, style: { ...item.style, ...patch } } : item);
  return <div role="group" aria-label={t('viewportQuickTools')} className="viewport-quick-tools">
    {'text' in node ? <>
      <label className="quick-control quick-content" {...hint(t('quickText'), t('quickTextHint'))}>
        <TextCursorInput size={15} aria-hidden="true" />
        <textarea key={`${node.id}:${node.text}`} rows={1} defaultValue={node.text} aria-label={t('quickText')} onBlur={event => {
          const text = event.currentTarget.value;
          if (text !== node.text) update(item => 'text' in item ? { ...item, text } : item);
        }} onKeyDown={event => {
          if (event.key === 'Escape') {
            event.currentTarget.value = node.text;
            event.currentTarget.blur();
          } else if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }} />
      </label>
      <label className="quick-control quick-font" {...hint(t('quickFont'), t('fontHint'))}>
        <Type size={15} aria-hidden="true" />
        <RequiredText label={t('quickFont')} value={node.style.fontFamily} commit={fontFamily => styling({ fontFamily })} />
      </label>
      <label className="quick-control quick-number" {...hint(t('quickFontSize'), t('fontSizeHint'))}>
        <Scaling size={15} aria-hidden="true" />
        <Numeric label={t('quickFontSize')} value={node.style.fontSize} min={0.01} commit={fontSize => styling({ fontSize })} />
      </label>
      <IconButton icon={Bold} label={t('quickBold')} aria-pressed={node.style.fontWeight === 'bold'}
        onClick={() => styling({ fontWeight: node.style.fontWeight === 'bold' ? 'normal' : 'bold' })} />
      <div className="quick-align" role="group" aria-label={t('quickAlignment')}>
        {(Object.keys(alignments) as (keyof typeof alignments)[]).map(align => <IconButton key={align} icon={alignments[align]}
          label={t(`quickAlign_${align}`)} aria-pressed={node.style.align === align} onClick={() => styling({ align })} />)}
      </div>
      <label className="quick-control quick-color" {...hint(t('quickFill'), t('fillHint'))}>
        <Paintbrush size={15} aria-hidden="true" /><input type="color" value={node.style.fill} aria-label={t('quickFill')}
          onChange={event => styling({ fill: event.target.value })} />
      </label>
    </> : <>
      {node.type === 'Graphics' ? <>
        <label className="quick-control" {...hint(t('quickShape'), t('shapeHint'))}>
          <Shapes size={15} aria-hidden="true" />
          <select value={node.shape} aria-label={t('quickShape')} onChange={event => {
            const shape = event.target.value === 'ellipse' ? 'ellipse' : 'rectangle';
            update(item => item.type === 'Graphics' ? { ...item, shape } : item);
          }}><option value="rectangle">{t('rectangle')}</option><option value="ellipse">{t('ellipse')}</option></select>
        </label>
        <label className="quick-control quick-color" {...hint(t('quickFill'), t('fillHint'))}>
          <Paintbrush size={15} aria-hidden="true" /><input type="color" value={node.fill} aria-label={t('quickFill')} onChange={event => {
            const fill = event.target.value;
            update(item => item.type === 'Graphics' ? { ...item, fill } : item);
          }} />
        </label>
      </> : <label className="quick-control quick-color" {...hint(t('quickTint'), t('tintHint'))}>
        <Palette size={15} aria-hidden="true" /><input type="color" value={node.tint} aria-label={t('quickTint')} onChange={event => {
          const tint = event.target.value;
          update(item => ({ ...item, tint }));
        }} />
      </label>}
      <label className="quick-control quick-number" {...hint(t('quickOpacity'), t('opacityHint'))}>
        <Contrast size={15} aria-hidden="true" />
        <Numeric label={t('quickOpacity')} value={node.alpha} min={0} max={1} commit={alpha => update(item => ({ ...item, alpha }))} />
      </label>
    </>}
  </div>;
}
