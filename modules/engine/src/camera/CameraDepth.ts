import { Bounds, Container, Filter, GlProgram, GpuProgram, UniformGroup, defaultFilterVert, type Application } from 'pixi.js';
import { DropShadowFilter } from 'pixi-filters/drop-shadow';
import { OutlineFilter } from 'pixi-filters/outline';
import type { CameraCurveOptions, CameraDepthBlur, CameraOpticalEffect } from './postFXSettings.js';
import { createDepthBlur } from './depthBlur.js';
import { CameraCurveFilter } from './curveFilter.js';
import { cameraEaseProgress } from './easing.js';
import { CameraTiltShiftFilter } from './tiltShift.js';
import { applyCameraShake, type CameraLayerShake } from '../runtime-camera.js';
import { createCameraFilter, type CameraFilterAnimation, type CameraTextureLookup } from './cameraFilters.js';
import { cameraFilterHasDepth, cameraFilterValue, isCameraFilter } from './filterSettings.js';

export interface CameraDepthOptions {
  minScale: number;
  maxScale: number;
  distance: number;
  zIndex: number;
}

export type CameraTheaterCurvature = 'concave' | 'convex';
export type { CameraCurveOptions } from './postFXSettings.js';
export type CameraLayerEffects = { perspective?: CameraDepthOptions; curve?: CameraCurveOptions; blur?: CameraDepthBlur;
  blurs?: CameraDepthBlur[]; optics?: CameraOpticalEffect[]; shakeLayers?: boolean; filters?: CameraFilterContext };
export type CameraFilterContext = {
  texture?: CameraTextureLookup;
  previews?: readonly { settings: CameraOpticalEffect; time: () => number; offset?: () => { x: number; y: number } }[];
};
type CameraOpticalFrame = { time: number; cameraOffset?: { x: number; y: number } };

export interface CameraTheaterOptions extends CameraDepthOptions {
  radius: number;
  /** Defaults to concave. */
  curvature?: CameraTheaterCurvature;
}

type DepthSettings = CameraDepthOptions & Partial<Pick<CameraTheaterOptions, 'radius' | 'curvature'>>;
type PreviewOffset = { x: number; y: number; offset: () => { x: number; y: number } };
type Layer = { root: Container; wrapper: Container; filters: Filter[]; depthIndex: number; visualIndex: number;
  warp?: UniformGroup; curveFilter?: CameraCurveFilter;
  opticalPose?: { scale: number; offset: number; rank: number; parallaxX: number; parallaxY: number; previewOffsets: PreviewOffset[] } };
type LayerShakeFrame = { shakes: readonly CameraLayerShake[]; time: number; zoom: number;
  previews?: readonly { shake: CameraLayerShake; time: number }[] };

const warpFragment = `
in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform vec4 uInputClamp;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform float uAngle;
uniform float uCurve;
void main() {
    vec2 span = max(uOutputFrame.zw * uInputSize.zw, vec2(0.0001));
    vec2 p = vTextureCoord / span - 0.5;
    vec2 uv = vec2(p.x * (1.0 + uCurve * p.y * p.y * 4.0),
                   p.y * (1.0 + uAngle * p.x) + uCurve * p.x * p.x) + 0.5;
    vec2 coord = uv * span;
    if (any(lessThan(coord, uInputClamp.xy)) || any(greaterThan(coord, uInputClamp.zw))) finalColor = vec4(0.0);
    else finalColor = texture(uTexture, coord);
}`;

// Pixi uses the WGSL binding names to bind resources in the WebGL program too.
const warpGpu = `
struct FilterUniforms {
  uInputSize: vec4<f32>,
  uInputPixel: vec4<f32>,
  uInputClamp: vec4<f32>,
  uOutputFrame: vec4<f32>,
  uGlobalFrame: vec4<f32>,
  uOutputTexture: vec4<f32>,
};
struct CurveUniforms { uAngle: f32, uCurve: f32 };
struct VertexOut { @builtin(position) position: vec4<f32>, @location(0) uv: vec2<f32> };
@group(0) @binding(0) var<uniform> frame: FilterUniforms;
@group(0) @binding(1) var uTexture: texture_2d<f32>;
@group(0) @binding(2) var imageSampler: sampler;
@group(1) @binding(0) var<uniform> theaterUniforms: CurveUniforms;

@vertex fn vertexMain(@location(0) aPosition: vec2<f32>) -> VertexOut {
  let p = aPosition * frame.uOutputFrame.zw + frame.uOutputFrame.xy;
  let out = frame.uOutputTexture;
  return VertexOut(vec4<f32>(p.x * 2.0 / out.x - 1.0, p.y * 2.0 * out.z / out.y - out.z, 0.0, 1.0),
    aPosition * frame.uOutputFrame.zw * frame.uInputSize.zw);
}

@fragment fn fragmentMain(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let span = max(frame.uOutputFrame.zw * frame.uInputSize.zw, vec2<f32>(0.0001));
  let p = uv / span - vec2<f32>(0.5);
  let bend = theaterUniforms.uCurve;
  let coord = (vec2<f32>(p.x * (1.0 + bend * p.y * p.y * 4.0),
    p.y * (1.0 + theaterUniforms.uAngle * p.x) + bend * p.x * p.x) + vec2<f32>(0.5)) * span;
  let color = textureSample(uTexture, imageSampler, coord);
  return select(color, vec4<f32>(0.0),
    any(coord < frame.uInputClamp.xy) || any(coord > frame.uInputClamp.zw));
}`;

function theaterWarp() {
  const warp = new UniformGroup({
    uAngle: { value: 0, type: 'f32' }, uCurve: { value: 0, type: 'f32' },
  });
  const filter = new Filter({
    glProgram: GlProgram.from({ vertex: defaultFilterVert, fragment: warpFragment, name: 'olive-theater', preferredFragmentPrecision: 'highp' }),
    gpuProgram: GpuProgram.from({
      vertex: { source: warpGpu, entryPoint: 'vertexMain' },
      fragment: { source: warpGpu, entryPoint: 'fragmentMain' },
    }),
    resources: { theaterUniforms: warp }, padding: 24,
  });
  return { filter, warp };
}

export class CameraDepth {
  private readonly layers = new Map<Container, Layer>();
  private worldFilters: Filter[] = [];
  private animations: CameraFilterAnimation[] = [];
  private order: Container[] = [];
  private settings?: DepthSettings;
  private curve?: CameraCurveOptions;
  private blurs: readonly CameraDepthBlur[] = [];
  private depthCount = 0;
  private visualCount = 0;
  private width = 0;

  constructor(private readonly world: Container, private readonly app?: Application,
    private readonly curveViewport: () => { width: number; height: number } | undefined = () => app?.screen) {}

  layerFor(root: Container | undefined) {
    return root && (this.layers.get(root)?.wrapper ?? root);
  }

  positionSpace(display: Container) {
    for (let node: Container | null = display; node && node !== this.world; node = node.parent) {
      const layer = this.layers.get(node);
      if (layer) return layer.wrapper;
    }
    return this.world;
  }

  worldBounds() {
    if (!this.layers.size) return this.world.getLocalBounds();
    const bounds = new Bounds();
    const wrapped = new Map([...this.layers.values()].map(({ wrapper, root }) => [wrapper, root]));
    for (const display of this.world.children) {
      const root = wrapped.get(display) ?? display;
      if (!root.visible || !root.measurable) continue;
      root.updateLocalTransform();
      bounds.addBounds(root.getLocalBounds(), root.localTransform);
    }
    return bounds;
  }

  applyOptics(effects: readonly CameraOpticalEffect[], roots?: readonly Container[], shakeLayers = false,
    context: CameraFilterContext = {}) {
    this.clear();
    const perLayer = (effect: CameraOpticalEffect) => effect.type === 'parallax' ||
      (effect.useDepth && (!isCameraFilter(effect) || cameraFilterHasDepth(effect.type)));
    const previews = new Map(context.previews?.map(preview => [preview.settings, preview]));
    const configured = [...effects, ...previews.keys()];
    const group = configured.filter(effect => !perLayer(effect));
    this.worldFilters = group.flatMap(effect => this.opticalFilters(effect, 1, 1, 1, context.texture, previews.get(effect)?.time));
    if (this.worldFilters.length) this.world.filters = [...this.world.filters ?? [], ...this.worldFilters];

    const layered = configured.filter(effect => perLayer(effect) &&
      (effect.type === 'curve' ? effect.scale || effect.distance || effect.angle :
        effect.type === 'depth' ? effect.scale || effect.distance || (effect.filter !== 'none' && effect.strength) : true));
    if (!layered.length && !shakeLayers) return;
    const eligible = roots ? new Set(roots) : undefined;
    const ordered = this.world.children.filter(root => !eligible || eligible.has(root))
      .sort((a, b) => a.zIndex - b.zIndex);
    this.order = [...this.world.children];
    for (const [index, root] of ordered.entries()) {
      const rank = ordered.length <= 1 ? 0.5 : index / (ordered.length - 1);
      const opticalPose = { scale: 1, offset: 0, rank, parallaxX: 0, parallaxY: 0, previewOffsets: [] as PreviewOffset[] };
      const filters: Filter[] = [];
      for (const effect of layered) {
        const amount = Math.max(0, Math.min(1, cameraEaseProgress(effect.distribution ?? 'none', rank)));
        if (effect.type === 'curve') {
          if (ordered.length > 1) {
            opticalPose.scale *= 1 - (1 - amount) * effect.scale / 200;
            opticalPose.offset += (2 * amount - 1) * effect.distance;
          }
        } else if (effect.type === 'depth') {
          opticalPose.scale *= 1 + (0.75 * amount - 0.5) * effect.scale / 100;
          opticalPose.offset += (2 * amount - 1) * effect.distance;
        } else if (effect.type === 'parallax') {
          const weight = effect.useDepth ? 1 - amount : 1;
          const x = Number(cameraFilterValue(effect, 'amountX')) * weight;
          const y = Number(cameraFilterValue(effect, 'amountY')) * weight;
          const offset = previews.get(effect)?.offset;
          if (offset) opticalPose.previewOffsets.push({ x, y, offset });
          else {
            opticalPose.parallaxX += x;
            opticalPose.parallaxY += y;
          }
          continue;
        }
        const curve = ordered.length <= 1 ? 1 : 0.25 + 0.75 * amount;
        filters.push(...this.opticalFilters(effect, curve, 1 - amount, amount, context.texture, previews.get(effect)?.time));
      }
      const wrapper = new Container({ label: 'Camera layer' });
      wrapper.zIndex = root.zIndex;
      wrapper.filters = filters.length ? filters : null;
      const slot = this.world.getChildIndex(root);
      wrapper.addChild(root);
      this.world.addChildAt(wrapper, slot);
      this.layers.set(root, { root, wrapper, filters, depthIndex: -1, visualIndex: -1, opticalPose });
    }
    this.update();
  }

  private opticalFilters(effect: CameraOpticalEffect, bend: number, background: number, foreground: number,
    texture?: CameraTextureLookup, previewTime?: () => number): Filter[] {
    if (this.app?.renderer?.name === 'canvas') return [];
    switch (effect.type) {
      case 'curve': {
        if (!effect.angle) return [];
        const sign = effect.direction === 'convex' ? 1 : -1;
        return [new CameraCurveFilter(this.curveViewport, sign * effect.angle * bend)];
      }
      case 'depth': {
        const filter = createDepthBlur(effect.filter, effect.strength / 100 * background);
        return filter ? [filter] : [];
      }
      case 'tiltShift': return effect.blur && background ? [new CameraTiltShiftFilter({ ...effect, blur: effect.blur * background })] : [];
      default: {
        const weight = effect.type === 'fog' || effect.type === 'heatHaze' ? background : foreground;
        const { filters, animate } = createCameraFilter(effect, weight, texture);
        if (animate) this.animations.push(time => animate(previewTime?.() ?? time));
        return filters;
      }
    }
  }

  apply(settings: DepthSettings | undefined, roots: readonly Container[] | undefined, width: number,
    { curve, blurs = [], visualRoots }: { curve?: CameraCurveOptions; blurs?: readonly CameraDepthBlur[]; visualRoots?: readonly Container[] } = {}) {
    if (settings && (![settings.minScale, settings.maxScale, settings.distance, settings.zIndex].every(Number.isFinite) ||
      settings.minScale <= 0 || settings.maxScale < settings.minScale || settings.distance < 0 ||
      (settings.radius !== undefined && (!Number.isFinite(settings.radius) || settings.radius <= 0)))) {
      throw new RangeError('Invalid camera depth settings');
    }
    const unwrapped = this.order.length ? this.order : this.world.children;
    const depthLayers = new Set(settings ? roots ?? (this.settings ?
      [...this.layers.values()].filter(layer => layer.depthIndex >= 0).map(layer => layer.root) : unwrapped) : []);
    const visualLayers = new Set(curve?.angle || blurs.some(blur => blur.strength && blur.filter !== 'none') ? visualRoots ?? unwrapped : []);
    const onlyVisual = [...visualLayers].filter(root => !depthLayers.has(root)).length;
    if (this.layers.size && (this.settings?.radius === undefined) === (settings?.radius === undefined) &&
        this.settings?.zIndex === settings?.zIndex && depthLayers.size + onlyVisual === this.layers.size &&
        !!this.curve?.angle === !!curve?.angle && this.blurs.length === blurs.length &&
        this.blurs.every((blur, index) => blur.filter === blurs[index].filter && blur.strength === blurs[index].strength) &&
        [...this.layers.values()].every(({ root, depthIndex, visualIndex }) =>
          !root.destroyed && depthLayers.has(root) === (depthIndex >= 0) && visualLayers.has(root) === (visualIndex >= 0))) {
      this.settings = settings;
      this.curve = curve;
      this.update(width);
      return;
    }
    this.clear();
    if (!depthLayers.size && !visualLayers.size) return;
    this.settings = settings;
    this.curve = curve;
    this.blurs = blurs;
    this.width = width;
    this.order = [...this.world.children];
    const first = this.order.findIndex(root => depthLayers.has(root));
    this.depthCount = this.order.filter(root => depthLayers.has(root)).length;
    this.visualCount = this.order.filter(root => visualLayers.has(root)).length;
    let nextDepth = 0;
    let nextVisual = 0;
    const painted = this.order.map((root, index) => {
      const depthIndex = depthLayers.has(root) ? nextDepth++ : -1;
      const visualIndex = visualLayers.has(root) ? nextVisual++ : -1;
      if (depthIndex < 0 && visualIndex < 0) return { display: root, z: index, index };
      const wrapper = new Container({ label: 'Camera layer' });
      const filters: Filter[] = depthIndex < 0 ? [] : [
        new OutlineFilter({ color: '#314049', thickness: 0.65, quality: 0.2 }),
        new DropShadowFilter({ color: '#000000', alpha: 0.22, offset: { x: 2, y: 5 }, blur: 3 }),
      ];
      const curveFilter = visualIndex >= 0 && curve?.angle && this.app?.renderer?.name !== 'canvas' ?
        new CameraCurveFilter(this.curveViewport, 0) : undefined;
      if (curveFilter) filters.unshift(curveFilter);
      let warp: UniformGroup | undefined;
      if (!curveFilter && depthIndex >= 0 && settings?.radius !== undefined &&
          (this.app?.renderer?.name ?? 'webgl') === 'webgl') {
        const created = theaterWarp();
        warp = created.warp;
        filters.unshift(created.filter);
      }
      if (visualIndex >= 0 && visualIndex < this.visualCount - 1) {
        const depth = 1 - visualIndex / (this.visualCount - 1);
        for (const blur of blurs) {
          const filter = createDepthBlur(blur.filter, blur.strength / 100 * depth);
          if (filter) filters.push(filter);
        }
      }
      wrapper.filters = filters.length ? filters : null;
      this.layers.set(root, { root, wrapper, filters, warp, curveFilter, depthIndex, visualIndex });
      wrapper.addChild(root);
      return { display: wrapper, z: depthIndex < 0 ? index : first + depthIndex * (settings?.zIndex ?? 1), index };
    });
    for (const { display } of painted.sort((a, b) => a.z - b.z || a.index - b.index)) {
      this.world.addChild(display);
    }
    this.update(width);
  }

  update(width = this.width, shakeFrame?: LayerShakeFrame, frame?: CameraOpticalFrame) {
    this.width = width;
    if (frame) for (const animate of this.animations) animate(frame.time);
    if (!this.layers.size) return;
    const { minScale = 1, maxScale = 1, distance = 0, radius, curvature } = this.settings ?? {};
    const direction = curvature === 'convex' ? -1 : 1;
    const halfAngle = radius === undefined ? 0 : Math.atan2(width / 2, Math.max(1, radius));
    const legacyCurve = direction * (1 - Math.cos(halfAngle)) * 0.25;
    const curveAngle = (this.curve?.angle ?? 0) * (this.curve?.direction === 'convex' ? 1 : -1);
    for (const { root, wrapper, warp, curveFilter, depthIndex, visualIndex, opticalPose } of this.layers.values()) {
      if (opticalPose) {
        let pose = { x: root.x + opticalPose.offset * 0.35, y: root.y - opticalPose.offset * 0.15,
          rotation: 0, zoom: shakeFrame?.zoom ?? 1 };
        if (shakeFrame) {
          const apply = (shake: CameraLayerShake, time: number) => {
            const weight = Math.max(0, Math.min(1, cameraEaseProgress(shake.distribution, opticalPose.rank)));
            pose = applyCameraShake(pose, { ...shake, amplitude: shake.amplitude * weight, rotation: (shake.rotation ?? 0) * weight }, time);
          };
          for (const shake of shakeFrame.shakes) apply(shake, shakeFrame.time);
          for (const { shake, time } of shakeFrame.previews ?? []) apply(shake, time);
        }
        wrapper.pivot.copyFrom(root.position);
        let x = pose.x + (frame?.cameraOffset?.x ?? 0) * opticalPose.parallaxX;
        let y = pose.y + (frame?.cameraOffset?.y ?? 0) * opticalPose.parallaxY;
        for (const preview of opticalPose.previewOffsets) {
          const offset = preview.offset();
          x += offset.x * preview.x;
          y += offset.y * preview.y;
        }
        wrapper.position.set(x, y);
        wrapper.scale.set(opticalPose.scale);
        wrapper.angle = pose.rotation;
        continue;
      }
      const depth = this.depthCount <= 1 ? 0.5 : depthIndex / (this.depthCount - 1);
      const signed = depth * 2 - 1;
      const angle = direction * signed * halfAngle;
      const scale = depthIndex < 0 ? 1 : minScale + (maxScale - minScale) * depth;
      const offset = depthIndex < 0 ? 0 : signed * distance;
      wrapper.pivot.copyFrom(root.position);
      wrapper.position.set(root.x + offset * 0.35, root.y - offset * 0.15);
      wrapper.scale.set(scale * Math.cos(angle), scale);
      const bend = Math.sin(angle) * 0.22;
      wrapper.skew.y = bend;
      curveFilter?.setAngle(curveAngle * (visualIndex + 1) / this.visualCount);
      if (warp && (warp.uniforms.uAngle !== bend || warp.uniforms.uCurve !== legacyCurve)) {
        warp.uniforms.uAngle = bend;
        warp.uniforms.uCurve = legacyCurve;
        warp.update();
      }
    }
  }

  clear() {
    this.animations = [];
    if (this.worldFilters.length) {
      const remaining = this.world.filters?.filter(filter => !this.worldFilters.includes(filter));
      if (!this.world.destroyed) this.world.filters = remaining?.length ? remaining : null;
      for (const filter of this.worldFilters) filter.destroy();
      this.worldFilters = [];
    }
    this.settings = undefined;
    this.curve = undefined;
    this.blurs = [];
    if (!this.layers.size) return;
    for (const { root, wrapper, filters } of this.layers.values()) {
      if (root.parent === wrapper) {
        wrapper.removeChild(root);
        if (!root.destroyed && !this.world.destroyed) this.world.addChild(root);
      }
      if (!wrapper.destroyed) {
        wrapper.filters = null;
        wrapper.destroy();
      }
      for (const filter of filters) filter.destroy();
    }
    // Children introduced by gameplay after applying depth keep their relative order.
    for (const [index, display] of this.order.filter(display => !this.world.destroyed && display.parent === this.world).entries()) {
      this.world.setChildIndex(display, index);
    }
    this.order = [];
    this.layers.clear();
  }
}
