import {z} from 'zod';
import type {ComponentDefinition, Json} from '@rewrite/sdk';

/**
 * Flexbox layout (`@pixi/layout`, Yoga). A `layout.container` entity arranges its direct child entities; children
 * may tune their slot with `layout.item`. Pure data and style mapping only — no Pixi imports — so export validation
 * and tests can use it.
 */
const Color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const Unit = z.number().min(0).max(1);
const Length = z.number().min(0).max(10000);
export const directions = ['row', 'column', 'row-reverse', 'column-reverse'] as const;
export const justifications = ['flex-start', 'center', 'flex-end', 'space-between', 'space-around', 'space-evenly'] as const;
export const alignments = ['flex-start', 'center', 'flex-end', 'stretch'] as const;
export const fits = ['none', 'contain', 'cover', 'fill', 'scale-down'] as const;
export const overflows = ['visible', 'hidden', 'scroll'] as const;
export const objectPositions = ['center', 'left top', 'center top', 'right top', 'left center', 'right center',
 'left bottom', 'center bottom', 'right bottom'] as const;

export const LayoutContainerSchema = z.object({
 width: Length, height: Length, anchorX: Unit, anchorY: Unit,
 direction: z.enum(directions), justify: z.enum(justifications), align: z.enum(alignments), wrap: z.boolean(),
 gap: z.number().min(0).max(2000), padding: z.number().min(0).max(2000),
 background: Color, backgroundAlpha: Unit, borderColor: Color, borderWidth: z.number().min(0).max(200), borderRadius: z.number().min(0).max(2000),
 clip: z.boolean(),
 overflow: z.enum(overflows).optional(),
}).strict();
export type LayoutContainerData = z.infer<typeof LayoutContainerSchema>;
export const LayoutItemSchema = z.object({
 grow: z.number().min(0).max(100), shrink: z.number().min(0).max(100), alignSelf: z.enum(['auto', ...alignments]),
 margin: z.number().min(-2000).max(2000), width: Length, height: Length, fit: z.enum(fits),
 /** `absolute` leaves the flow and sits at left/top inside the container's padding box. Older items are `flow`. */
 position: z.enum(['flow', 'absolute']).default('flow'), left: z.number().min(-10000).max(10000).default(0), top: z.number().min(-10000).max(10000).default(0),
 /** Width/height unit when they are set: pixels or percent of the container. */
 widthUnit: z.enum(['px', '%']).default('px'), heightUnit: z.enum(['px', '%']).default('px'),
 objectPosition: z.enum(objectPositions).optional(),
}).strict();
export type LayoutItemData = z.infer<typeof LayoutItemSchema>;

type Field = ComponentDefinition['fields'][number];
const n = (...keys: string[]): Field[] => keys.map(key => ({key, titleKey: `layout.${key}`, kind: 'number' as const}));
const options = (values: readonly string[]) => values.map(value => ({value, titleKey: `layout.option.${value}`}));
export const containerDefaults: LayoutContainerData = {width: 480, height: 160, anchorX: .5, anchorY: .5, direction: 'row', justify: 'center', align: 'center', wrap: false, gap: 16, padding: 16, background: '#2a3038', backgroundAlpha: .85, borderColor: '#ffffff', borderWidth: 0, borderRadius: 12, clip: false};
export const itemDefaults: LayoutItemData = {grow: 0, shrink: 1, alignSelf: 'auto', margin: 0, width: 0, height: 0, fit: 'none', position: 'flow', left: 0, top: 0, widthUnit: 'px', heightUnit: 'px'};
export const layoutContainerDefinition: ComponentDefinition = {
 type: 'layout.container', version: 1, titleKey: 'layout.container', defaults: () => ({...containerDefaults}), parse: v => LayoutContainerSchema.parse(v) as Json,
 fields: [
  {key: 'direction', titleKey: 'layout.direction', kind: 'enum', options: options(directions)},
  {key: 'justify', titleKey: 'layout.justify', kind: 'enum', options: options(justifications)},
  {key: 'align', titleKey: 'layout.align', kind: 'enum', options: options(alignments)},
  {key: 'wrap', titleKey: 'layout.wrap', kind: 'boolean'},
  ...n('gap', 'padding', 'width', 'height', 'anchorX', 'anchorY'),
  {key: 'background', titleKey: 'layout.background', kind: 'color'}, ...n('backgroundAlpha', 'borderRadius', 'borderWidth'),
  {key: 'borderColor', titleKey: 'layout.borderColor', kind: 'color', visible: v => Number((v as {borderWidth?: number} | null)?.borderWidth) > 0},
  {key: 'clip', titleKey: 'layout.clip', kind: 'boolean'},
 ],
};
export const layoutItemDefinition: ComponentDefinition = {
 type: 'layout.item', version: 1, titleKey: 'layout.item', defaults: () => ({...itemDefaults}), parse: v => LayoutItemSchema.parse(v) as Json,
 fields: [
  {key: 'position', titleKey: 'layout.position', kind: 'enum', options: options(['flow', 'absolute'])},
  ...n('left', 'top').map(f => ({...f, visible: (v: Json) => (v as {position?: string} | null)?.position === 'absolute'})),
  ...n('grow', 'shrink'), {key: 'alignSelf', titleKey: 'layout.alignSelf', kind: 'enum', options: options(['auto', ...alignments])}, ...n('margin', 'width'),
  {key: 'widthUnit', titleKey: 'layout.widthUnit', kind: 'enum', options: options(['px', '%']), visible: v => Number((v as {width?: number} | null)?.width) > 0},
  ...n('height'), {key: 'heightUnit', titleKey: 'layout.heightUnit', kind: 'enum', options: options(['px', '%']), visible: v => Number((v as {height?: number} | null)?.height) > 0},
  {key: 'fit', titleKey: 'layout.fit', kind: 'enum', options: options(fits)},
 ],
};

const hex = (color: string, alpha: number) => color + Math.round(alpha * 255).toString(16).padStart(2, '0');
/** `@pixi/layout` style of a container's inner root. Width/height 0 size to the content. */
export function containerStyle(p: LayoutContainerData, rtl = false) {
 return {
  width: p.width || 'auto', height: p.height || 'auto', flexDirection: rtl && p.direction === 'row' ? 'row-reverse' as const : rtl && p.direction === 'row-reverse' ? 'row' as const : p.direction, justifyContent: p.justify, alignItems: p.align,
  flexWrap: p.wrap ? 'wrap' : 'nowrap', alignContent: p.align === 'stretch' ? 'stretch' : p.align, gap: p.gap, padding: p.padding,
  backgroundColor: p.backgroundAlpha > 0 ? hex(p.background, p.backgroundAlpha) : undefined, borderRadius: p.borderRadius,
  borderWidth: p.borderWidth, borderColor: p.borderWidth > 0 ? p.borderColor : undefined, overflow: p.overflow ?? (p.clip ? 'hidden' : 'visible'),
  // A nested container's root must keep its own size inside the parent item's box.
  flexShrink: 0,
 } as const;
}
/**
 * Style of a child entity's node: a leaf whose box is its measured content size unless the item overrides it.
 * Transforms do not affect the box (as in CSS); the entity's own x/y is ignored while it is laid out.
 */
export function itemStyle(p: LayoutItemData, content: {width: number; height: number}) {
 return {
  isLeaf: true, objectFit: p.fit, objectPosition: p.objectPosition ?? 'center',
  width: p.width ? (p.widthUnit === '%' ? `${p.width}%` : p.width) : Math.max(1, Math.round(content.width * 100) / 100),
  height: p.height ? (p.heightUnit === '%' ? `${p.height}%` : p.height) : Math.max(1, Math.round(content.height * 100) / 100),
  flexGrow: p.grow, flexShrink: p.shrink, alignSelf: p.alignSelf, margin: p.margin,
  ...(p.position === 'absolute' ? {position: 'absolute', left: p.left, top: p.top} : {}),
 } as const;
}
/** Minimal entity shape shared by the editor scene, runtime worlds and the player. */
export interface LayoutEntity {id: string; parentId: string | null; components: readonly {type: string; version: number; data: Json}[]}
/** IDs whose position comes from a layout parent (the move tool, nudging and align skip them). */
export function layoutManaged(entities: readonly LayoutEntity[]): Set<string> {
 const boxes = new Set(entities.filter(e => e.components.some(c => c.type === 'layout.container' && c.version === 1)).map(e => e.id));
 return new Set(entities.filter(e => e.parentId && boxes.has(e.parentId)).map(e => e.id));
}
