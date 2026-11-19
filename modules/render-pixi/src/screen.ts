import {z} from 'zod';
/**
 * Screen Space (HUD): a top-level object with this component is drawn on the game screen, above the world and
 * untouched by the camera; its position is in screen pixels. When the screen size differs from the authored stage
 * (device profiles), it keeps its distance to the chosen anchor (a corner, an edge's middle or the centre).
 */
export const screenSpaceType = 'pixi.screenSpace';
export const screenAnchors = ['top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right'] as const;
export const ScreenSpaceSchema = z.object({anchor: z.enum(screenAnchors).default('top-left')}).strict();
export type ScreenSpace = z.infer<typeof ScreenSpaceSchema>;
interface ScreenEntity {parentId: string | null; components: readonly {type: string; version: number; data: unknown}[]}
/** Only top-level objects can be on the screen layer (their children follow them). */
export function screenSpace(entity: ScreenEntity): ScreenSpace | undefined {
 if (entity.parentId) return undefined;
 const c = entity.components.find(x => x.type === screenSpaceType && x.version === 1), parsed = c ? ScreenSpaceSchema.safeParse(c.data) : undefined;
 return parsed?.success ? parsed.data : undefined;
}
/** How far a screen object moves when the screen is `current` instead of the authored stage size. */
export function screenOffset(anchor: ScreenSpace['anchor'], current: {width: number; height: number}, authored: {width: number; height: number}) {
 const ax = anchor.endsWith('left') ? 0 : anchor.endsWith('right') ? 1 : .5, ay = anchor.startsWith('top') ? 0 : anchor.startsWith('bottom') ? 1 : .5;
 return {x: (current.width - authored.width) * ax, y: (current.height - authored.height) * ay};
}
