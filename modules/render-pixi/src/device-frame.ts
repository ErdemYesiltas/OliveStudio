import {resolvePresentation, type RenderSettings} from './contracts';

/** Screen sizes (CSS pixels) to preview the stage on; portrait and landscape of the common classes. */
export const devicePreviews = [
 {id: 'phone-portrait', label: 'Phone · portrait', width: 393, height: 852},
 {id: 'phone-landscape', label: 'Phone · landscape', width: 852, height: 393},
 {id: 'tablet-portrait', label: 'Tablet · portrait', width: 820, height: 1180},
 {id: 'tablet-landscape', label: 'Tablet · landscape', width: 1180, height: 820},
 {id: 'desktop', label: 'Desktop · 1920 × 1080', width: 1920, height: 1080},
 {id: 'ultrawide', label: 'Ultrawide · 21:9', width: 2560, height: 1080},
] as const;

/**
 * What a screen of this size shows of the stage, in stage pixels: the game's scale mode (and the device profile that
 * Settings → Game may set for it) decides. Larger than the stage = letterbox bars; smaller = cropped edges.
 */
export function deviceFrame(settings: RenderSettings, stage: {width: number; height: number}, screen: {width: number; height: number}) {
 const p = resolvePresentation(settings, stage, screen), s = p.stage, mode = p.settings.scaleMode;
 const k = mode === 'fit' ? Math.min(screen.width / s.width, screen.height / s.height) : mode === 'fill' ? Math.max(screen.width / s.width, screen.height / s.height) : 1;
 const width = mode === 'stretch' ? s.width : screen.width / k, height = mode === 'stretch' ? s.height : screen.height / k;
 return {x: (stage.width - width) / 2, y: (stage.height - height) / 2, width, height, scaleMode: mode, profile: p.overridden ? s : null};
}
