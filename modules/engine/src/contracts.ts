import { z } from 'zod';
import {textFitModes} from './text-fit.js';
export {textFitModes} from './text-fit.js';
export const TextureMetadataSchema=z.object({width:z.number().int().min(1).max(8192),height:z.number().int().min(1).max(8192),processedBytes:z.number().int().positive(),pipeline:z.string().min(1)}).strict();
export const SpriteSchema=z.object({assetId:z.uuid().or(z.literal('')),width:z.number().positive().max(10000),height:z.number().positive().max(10000),anchorX:z.number().min(0).max(1),anchorY:z.number().min(0).max(1),alpha:z.number().min(0).max(1),tint:z.string().regex(/^#[a-f0-9]{6}$/i)}).strict();

export const shapeKinds=['rect','ellipse','triangle','polygon','star','line'] as const;
/** Vector shape. Older documents have no `kind` and stay rounded rectangles; `line` runs corner to corner with `strokeWidth`. */
export const ShapeSchema = z.object({alpha:z.number().min(0).max(1).default(1), kind:z.enum(shapeKinds).default('rect'), width: z.number().positive().max(10000), height: z.number().positive().max(10000), color: z.string().regex(/^#[0-9a-fA-F]{6}$/), rounded: z.number().min(0).max(100), sides:z.number().int().min(3).max(64).default(5), innerRadius:z.number().min(0.05).max(0.95).default(0.5), strokeColor:z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#ffffff'), strokeWidth:z.number().min(0).max(200).default(0) }).strict();
export type Shape = z.infer<typeof ShapeSchema>;
/** Line wrapping: off by default (older documents keep one line per `\n`); `lineHeight` 0 = the font's own. */
const wrapping={fitMode:z.enum(textFitModes).default('none'),fitWidth:z.number().min(16).max(10000).default(400),wordWrap:z.boolean().default(false),wrapWidth:z.number().min(16).max(10000).default(400),lineHeight:z.number().min(0).max(1000).default(0)};
const wrapStyle=(p:{wordWrap:boolean;wrapWidth:number;lineHeight:number})=>({...(p.wordWrap?{wordWrap:true,wordWrapWidth:p.wrapWidth,breakWords:true}:{}),...(p.lineHeight>0?{lineHeight:p.lineHeight}:{})});
/** `font` is an optional imported font asset; empty uses the system font. */
export const TextSchema = z.object({alpha:z.number().min(0).max(1).default(1), text: z.string().max(10000), fontSize: z.number().min(6).max(400), color: z.string().regex(/^#[0-9a-fA-F]{6}$/), font: z.uuid().or(z.literal('')).default(''),
 fontWeight:z.enum(['normal','bold']).default('normal'), fontStyle:z.enum(['normal','italic']).default('normal'), align:z.enum(['left','center','right']).default('center'),
 letterSpacing:z.number().min(-50).max(200).default(0), strokeColor:z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#000000'), strokeWidth:z.number().min(0).max(40).default(0), ...wrapping }).strict();
export type TextData = z.infer<typeof TextSchema>;
/** PixiJS text style of a Text component (editor, Preview and exported games draw the same). */
/** Right-to-left scripts: Hebrew, Arabic, Syriac, Thaana, NKo, Samaritan, Mandaic and their presentation forms. */
const RTL_TEXT = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
/**
 * Text as the canvas should draw it: a paragraph with right-to-left letters is wrapped in a first-strong isolate
 * (U+2068 … U+2069), so its base direction follows its first strong letter like HTML dir="auto" — punctuation and
 * numbers land on the right side and mixed runs keep their order. Other texts are returned unchanged.
 */
export const bidiText = (text: string) => RTL_TEXT.test(text) ? text.split('\n').map(line => line && RTL_TEXT.test(line) ? `\u2068${line}\u2069` : line).join('\n') : text;
/** Left/right alignment mirrors in a right-to-left language. */
export const mirrorAlign = <T extends string>(align: T, rtl: boolean): T => (rtl ? align === 'left' ? 'right' : align === 'right' ? 'left' : align : align) as T;
export const textStyle = (p: TextData, fontFamily: string | string[], rtl = false) => ({fontFamily, fontSize: p.fontSize, fill: p.color, fontWeight: p.fontWeight, fontStyle: p.fontStyle, align: mirrorAlign(p.align, rtl), letterSpacing: p.letterSpacing, ...(p.strokeWidth > 0 ? {stroke: {color: p.strokeColor, width: p.strokeWidth, join: 'round' as const}} : {}), ...wrapStyle(p)});
/** Glyphs rasterised once into a dynamic bitmap font: cheap to change every frame (scores, timers). */
export const BitmapTextSchema = z.object({alpha:z.number().min(0).max(1), text: z.string().max(10000), fontSize: z.number().min(6).max(400), color: z.string().regex(/^#[0-9a-fA-F]{6}$/), font: z.uuid().or(z.literal('')), letterSpacing:z.number().min(-50).max(200), align:z.enum(['left','center','right']), ...wrapping }).strict();
/** PixiJS style of a Bitmap Text component (editor, Preview and exported games). */
export const bitmapTextStyle = (p: z.infer<typeof BitmapTextSchema>, fontFamily: string | string[]) => ({fontFamily, fontSize: p.fontSize, fill: p.color, letterSpacing: p.letterSpacing, align: p.align, ...wrapStyle(p)});
export const fontImporter={id:'pixi.fonts',assetType:'font.face',titleKey:'font.import',extensions:['ttf','otf','woff','woff2']}as const;
export const fontFormats=['ttf','otf','woff','woff2']as const;
export const FontMetadataSchema=z.object({format:z.enum(fontFormats),processedBytes:z.number().int().positive(),pipeline:z.string().min(1)}).strict();
/** A stable, asset-scoped CSS family so two fonts with the same internal name never collide. */
export const fontFamily=(assetId:string)=>`pixi-font-${assetId}`;
export const fontFile=(format:typeof fontFormats[number])=>`font.${format}`;

/**
 * Game rendering (PixiJS) for the project: what the exported game initialises its renderer with, and what Preview
 * mirrors (background, pixel art, frame rate). Stored in the project (`pixi.render`); absent = these defaults.
 */
export const renderSettingsSection = 'pixi.render';
export const PresentationProfileSchema=z.object({width:z.number().int().min(64).max(4096),height:z.number().int().min(64).max(4096),scaleMode:z.enum(['fit','fill','stretch','none'])}).strict();
const DeviceProfileSchema=z.object({portrait:PresentationProfileSchema.optional(),landscape:PresentationProfileSchema.optional()}).strict();
export const presentationDevices=['desktop','tablet','mobile'] as const;
export type PresentationDevice=typeof presentationDevices[number];
export const RenderSettingsSchema = z.object({
 version: z.literal(1),
 profiles:z.object({desktop:DeviceProfileSchema.optional(),tablet:DeviceProfileSchema.optional(),mobile:DeviceProfileSchema.optional()}).strict().optional(),
 /** Clear colour of the game (and the letterbox around it). */
 background: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#20272d'),
 /** Render resolution: 0 = the device's pixel ratio (capped by maxResolution), otherwise a fixed ratio. */
 resolution: z.number().min(0).max(4).default(0),
 maxResolution: z.number().min(.5).max(4).default(2),
 antialias: z.boolean().default(true),
 renderer: z.enum(['webgl', 'webgpu']).default('webgl'),
 /** How the stage fits the window: letterbox, crop to fill, stretch, or 1:1 pixels. */
 scaleMode: z.enum(['fit', 'fill', 'stretch', 'none']).default('fit'),
 /** Nearest-neighbour texture filtering and whole-pixel positions. */
 pixelArt: z.boolean().default(false),
 /** Ticker limits: 0 = the display's refresh rate; the minimum caps a long frame's step. */
 maxFPS: z.number().int().min(0).max(240).default(0),
 minFPS: z.number().int().min(1).max(60).default(10),
 /** Exported games: F3 shows the debug overlay (frame rate, objects, globals…). Preview always has it. */
 debugOverlay: z.boolean().default(false),
}).strict();
export type RenderSettings = z.infer<typeof RenderSettingsSchema>;
export const defaultRenderSettings = (): RenderSettings => RenderSettingsSchema.parse({version: 1});
/** The renderer resolution for a device pixel ratio. */
export const renderResolution = (settings: RenderSettings, devicePixelRatio: number) => settings.resolution > 0 ? settings.resolution : Math.max(.5, Math.min(settings.maxResolution, devicePixelRatio || 1));

/** Short-edge breakpoints describe the game viewport, rather than unreliable user-agent device names. */
export function resolvePresentation(settings:RenderSettings,stage:{width:number;height:number},viewport:{width:number;height:number}){
 const device:PresentationDevice=Math.min(viewport.width,viewport.height)<600?'mobile':Math.min(viewport.width,viewport.height)<900?'tablet':'desktop',orientation=viewport.height>viewport.width?'portrait' as const:'landscape' as const,override=settings.profiles?.[device]?.[orientation];
 return{device,orientation,overridden:Boolean(override),stage:override?{width:override.width,height:override.height}:stage,settings:override?{...settings,scaleMode:override.scaleMode}:settings};
}

export const pixiTweenChannels=['pixi.shape','pixi.text','pixi.bitmapText','pixi.sprite'].map(componentType=>({
 componentType,version:1,property:'alpha',titleKey:'field.alpha',min:0,max:1,defaultValue:1,
}));
