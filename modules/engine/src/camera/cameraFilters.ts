import type { Filter, PointData, Texture } from 'pixi.js';
import { AdjustmentFilter } from 'pixi-filters/adjustment';
import { AdvancedBloomFilter } from 'pixi-filters/advanced-bloom';
import { BulgePinchFilter } from 'pixi-filters/bulge-pinch';
import { ColorGradientFilter } from 'pixi-filters/color-gradient';
import { ColorMapFilter } from 'pixi-filters/color-map';
import { ColorOverlayFilter } from 'pixi-filters/color-overlay';
import { CRTFilter } from 'pixi-filters/crt';
import { DropShadowFilter } from 'pixi-filters/drop-shadow';
import { GlitchFilter } from 'pixi-filters/glitch';
import { GlowFilter } from 'pixi-filters/glow';
import { OldFilmFilter } from 'pixi-filters/old-film';
import { OutlineFilter } from 'pixi-filters/outline';
import { RadialBlurFilter } from 'pixi-filters/radial-blur';
import { ReflectionFilter } from 'pixi-filters/reflection';
import { RGBSplitFilter } from 'pixi-filters/rgb-split';
import { ShockwaveFilter } from 'pixi-filters/shockwave';
import { TwistFilter } from 'pixi-filters/twist';
import { ZoomBlurFilter } from 'pixi-filters/zoom-blur';
import { cameraFilterValue, type CameraFilterData } from './filterSettings.js';

export type CameraTextureLookup = (alias: string) => Texture | undefined;
export type CameraFilterAnimation = (seconds: number, previewTime?: number) => void;
export type CameraFilterResult = { filters: Filter[]; animate?: CameraFilterAnimation };

function relativeCenter<T extends Filter & { center: PointData }>(filter: T, x: number, y: number) {
  const apply = filter.apply.bind(filter);
  filter.apply = (manager, input, output, clear) => {
    filter.center = { x: input.frame.width * x, y: input.frame.height * y };
    apply(manager, input, output, clear);
  };
  return filter;
}

export function createCameraFilter(effect: CameraFilterData, weight: number, texture?: CameraTextureLookup): CameraFilterResult {
  const n = (key: string) => Number(cameraFilterValue(effect, key));
  const s = (key: string) => String(cameraFilterValue(effect, key));
  const scale = (key: string) => n(key) * weight;
  const blend = (key: string) => 1 + (n(key) - 1) * weight;
  const center = () => ({ x: n('centerX'), y: n('centerY') });
  const single = (filter: Filter, animate?: CameraFilterAnimation) => ({ filters: [filter], animate });
  if (weight <= 0) return { filters: [] };
  switch (effect.type) {
    case 'colorGrade': return single(new AdjustmentFilter({
      brightness: blend('brightness'), contrast: blend('contrast'), saturation: blend('saturation'), gamma: blend('gamma'),
    }));
    case 'fog': return { filters: [
      new AdjustmentFilter({ contrast: blend('contrast'), saturation: blend('saturation') }),
      new ColorOverlayFilter({ color: s('color'), alpha: scale('opacity') }),
    ] };
    case 'bloom': return single(new AdvancedBloomFilter({ threshold: n('threshold'), bloomScale: scale('intensity'), blur: n('blur'), quality: 3 }));
    case 'glow': return single(new GlowFilter({ color: s('color'), distance: n('radius'), outerStrength: scale('intensity') }));
    case 'dropShadow': return single(new DropShadowFilter({ color: s('color'), alpha: scale('opacity'),
      offset: { x: n('offsetX'), y: n('offsetY') }, blur: n('blur') }));
    case 'outline': return single(new OutlineFilter({ color: s('color'), thickness: scale('thickness'), alpha: n('opacity') }));
    case 'distortion': {
      const filter = new TwistFilter({ radius: n('radius'), angle: scale('angle') });
      const apply = filter.apply.bind(filter);
      filter.apply = (manager, input, output, clear) => {
        filter.offset = { x: input.frame.width / 2, y: input.frame.height / 2 };
        apply(manager, input, output, clear);
      };
      return single(filter);
    }
    case 'lut': {
      const map = texture?.(s('texture'));
      return map && map.height >= 2 && map.width === map.height ** 2
        ? single(new ColorMapFilter({ colorMap: map, mix: scale('opacity') })) : { filters: [] };
    }
    case 'gradient': return single(new ColorGradientFilter({ type: ColorGradientFilter.LINEAR, angle: n('angle'),
      stops: [{ offset: 0, color: s('color'), alpha: 1 }, { offset: 1, color: s('endColor'), alpha: 1 }],
      alpha: scale('opacity') }));
    case 'crt': {
      const filter = new CRTFilter({ curvature: n('curvature'), lineWidth: n('thickness'), lineContrast: n('contrast'),
        noise: n('noise'), vignetting: 0.3, vignettingAlpha: n('vignette'), vignettingBlur: 0.4 });
      return single(filter, seconds => { filter.time = seconds; });
    }
    case 'oldFilm': return single(new OldFilmFilter({ sepia: n('sepia'), noise: n('noise'), scratch: n('scratch'),
      vignetting: 0.3, vignettingAlpha: n('vignette'), vignettingBlur: 0.4, seed: 0.65 }));
    case 'rgbSplit': return single(new RGBSplitFilter({ red: { x: scale('offsetX'), y: scale('offsetY') },
      green: { x: 0, y: 0 }, blue: { x: -scale('offsetX'), y: -scale('offsetY') } }));
    case 'glitch': {
      const filter = new GlitchFilter({ slices: Math.round(n('slices')), offset: scale('amplitude'), direction: n('angle') });
      const speed = n('speed');
      let last = -1;
      return single(filter, seconds => {
        const frame = Math.floor(seconds * speed);
        if (frame === last) return;
        last = frame;
        filter.seed = ((frame * 73 + 17) % 101) / 101;
        filter.refresh();
      });
    }
    case 'vignette': return single(new CRTFilter({ curvature: 0, lineWidth: 1, lineContrast: 0, noise: 0,
      vignetting: n('radius'), vignettingAlpha: n('opacity'), vignettingBlur: n('softness') }));
    case 'zoomBlur': return single(relativeCenter(new ZoomBlurFilter({ strength: scale('strength'), innerRadius: n('innerRadius') }),
      n('centerX'), n('centerY')));
    case 'radialBlur': return single(relativeCenter(new RadialBlurFilter({ angle: scale('angle'), radius: n('radius'), kernelSize: 11 }),
      n('centerX'), n('centerY')));
    case 'shockwave': {
      const filter = relativeCenter(new ShockwaveFilter({ speed: n('speed'), amplitude: n('amplitude'),
        wavelength: n('wavelength'), brightness: 1.1 }), n('centerX'), n('centerY'));
      const duration = n('duration');
      return single(filter, seconds => {
        filter.enabled = seconds < duration;
        filter.time = seconds;
      });
    }
    case 'bulgePinch': return single(new BulgePinchFilter({ center: center(), strength: scale('strength'), radius: n('radius') }));
    case 'heatHaze':
    case 'reflection': {
      const haze = effect.type === 'heatHaze';
      const filter = new ReflectionFilter({ mirror: !haze, boundary: haze ? 0 : n('boundary'),
        amplitude: [scale('amplitude') * 0.35, scale('amplitude')],
        waveLength: [n('wavelength'), n('wavelength') * 1.4],
        alpha: haze ? [1, 1] : [scale('opacity'), 0] });
      return single(filter, seconds => { filter.time = seconds * n('speed'); });
    }
    case 'parallax': return { filters: [] };
  }
}
