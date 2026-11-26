import { Bounds, Container, Filter, GlProgram, UniformGroup, defaultFilterVert, type Application } from 'pixi.js';
import { DropShadowFilter } from 'pixi-filters/drop-shadow';
import { OutlineFilter } from 'pixi-filters/outline';
import type { CameraCurveOptions, CameraDepthBlur } from './postFXSettings.js';
import { createDepthBlur } from './depthBlur.js';

export interface CameraDepthOptions {
  minScale: number;
  maxScale: number;
  distance: number;
  zIndex: number;
}

export type CameraTheaterCurvature = 'concave' | 'convex';
export type { CameraCurveOptions } from './postFXSettings.js';
export type CameraLayerEffects = { perspective?: CameraDepthOptions; curve?: CameraCurveOptions; blur?: CameraDepthBlur; blurs?: CameraDepthBlur[] };

export interface CameraTheaterOptions extends CameraDepthOptions {
  radius: number;
  /** Defaults to concave. */
  curvature?: CameraTheaterCurvature;
}

type DepthSettings = CameraDepthOptions & Partial<Pick<CameraTheaterOptions, 'radius' | 'curvature'>>;
type Layer = { root: Container; wrapper: Container; filters: Filter[]; depthIndex: number; visualIndex: number; warp?: UniformGroup };

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

export class CameraDepth {
  private readonly layers = new Map<Container, Layer>();
  private order: Container[] = [];
  private settings?: DepthSettings;
  private curve?: CameraCurveOptions;
  private blurs: readonly CameraDepthBlur[] = [];
  private depthCount = 0;
  private visualCount = 0;
  private width = 0;

  constructor(private readonly world: Container, private readonly app?: Application) {}

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
      let warp: UniformGroup | undefined;
      if ((visualIndex >= 0 && curve?.angle || depthIndex >= 0 && settings?.radius !== undefined) &&
          (this.app?.renderer?.name ?? 'webgl') === 'webgl') {
        warp = new UniformGroup({ uAngle: { value: 0, type: 'f32' }, uCurve: { value: 0, type: 'f32' } });
        filters.unshift(new Filter({
          glProgram: GlProgram.from({
            vertex: defaultFilterVert, fragment: warpFragment, name: 'olive-theater', preferredFragmentPrecision: 'highp',
          }),
          resources: { theaterUniforms: warp }, padding: 24,
        }));
      }
      if (visualIndex >= 0 && visualIndex < this.visualCount - 1) {
        const depth = 1 - visualIndex / (this.visualCount - 1);
        for (const blur of blurs) {
          const filter = createDepthBlur(blur.filter, blur.strength / 100 * depth);
          if (filter) filters.push(filter);
        }
      }
      wrapper.filters = filters.length ? filters : null;
      this.layers.set(root, { root, wrapper, filters, warp, depthIndex, visualIndex });
      wrapper.addChild(root);
      return { display: wrapper, z: depthIndex < 0 ? index : first + depthIndex * (settings?.zIndex ?? 1), index };
    });
    for (const { display } of painted.sort((a, b) => a.z - b.z || a.index - b.index)) {
      this.world.addChild(display);
    }
    this.update(width);
  }

  update(width = this.width) {
    this.width = width;
    if (!this.layers.size) return;
    const { minScale = 1, maxScale = 1, distance = 0, radius, curvature } = this.settings ?? {};
    const direction = curvature === 'convex' ? -1 : 1;
    const halfAngle = radius === undefined ? 0 : Math.atan2(width / 2, Math.max(1, radius));
    const legacyCurve = direction * (1 - Math.cos(halfAngle)) * 0.25;
    const curveAngle = (this.curve?.angle ?? 0) * Math.PI / 180;
    const curveDirection = this.curve?.direction === 'convex' ? -1 : 1;
    for (const { root, wrapper, warp, depthIndex, visualIndex } of this.layers.values()) {
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
      if (warp) {
        const usesCurve = visualIndex >= 0 && curveAngle > 0;
        const layerAngle = usesCurve ? curveAngle * (visualIndex + 1) / this.visualCount : 0;
        const curve = usesCurve ? curveDirection * Math.sin(layerAngle / 2) * 0.25 : legacyCurve;
        const shear = usesCurve ? 0 : bend;
        if (warp.uniforms.uAngle !== shear || warp.uniforms.uCurve !== curve) {
          warp.uniforms.uAngle = shear;
          warp.uniforms.uCurve = curve;
          warp.update();
        }
      }
    }
  }

  clear() {
    this.settings = undefined;
    this.curve = undefined;
    this.blurs = [];
    if (!this.layers.size) return;
    for (const { root, wrapper, filters } of this.layers.values()) {
      if (root.parent === wrapper) wrapper.removeChild(root);
      if (!root.destroyed && !this.world.destroyed) this.world.addChild(root);
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
