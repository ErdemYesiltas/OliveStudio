import { flickerAt, hexColor, visibility, type Lighting, type Point } from '@rewrite/lighting';
import { colliderOutlines } from '@rewrite/physics';
import { AlphaFilter, CanvasSource, Container, Graphics, Matrix, Rectangle, Sprite, Texture } from 'pixi.js';
import type { SceneObject } from './scene';
import { objectModulations } from './objectEffects';
import { physicsEntities } from './scenePhysics';
import { selectionTree } from './selection';

export const defaultLighting: Lighting = { enabled: false, ambient: '#20243a' };
type LightNode = Extract<SceneObject, { type: 'Light2D' }>;
type Lookup = (id: string) => Container | undefined;
type Occluder = { id: string; points?: Point[] };
type LightVisual = { glow: Sprite; mask?: Graphics; signature?: string };
type PulsePreview = { id: string; amount: number; frequency: number; seconds: number; node: LightNode };

function makeGlow() {
  const canvas = document.createElement('canvas');
  const size = 128;
  canvas.width = canvas.height = size;
  const center = size / 2;
  const context = canvas.getContext('2d')!;
  const gradient = context.createRadialGradient(center, center, 0, center, center, center);
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    gradient.addColorStop(t, `rgba(255,255,255,${(1 - t) ** 2})`);
  }
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  return new Texture({ source: new CanvasSource({ resource: canvas }) });
}

function displayAlpha(display: Container) {
  let alpha = 1;
  for (let node: Container | null = display; node; node = node.parent) {
    if (!node.visible || !node.alpha) return 0;
    alpha *= node.alpha;
  }
  return alpha;
}

export function collectLighting(roots: readonly SceneObject[]) {
  const worldRoots = roots.filter(root => !root.screenSpace);
  const tree = selectionTree(worldRoots);
  const lights: LightNode[] = [];
  const occluders: Occluder[] = [];
  const nearestBody = (id: string) => {
    for (let item = tree.get(id); item; item = item.parent ? tree.get(item.parent) : undefined) {
      if (item.node.physics?.body) return item.node.physics.body.bodyType;
    }
    return 'static';
  };
  for (const { node } of tree.values()) {
    if (node.type === 'Light2D') lights.push(node);
    else if (node.shadowCaster === 'bounds') occluders.push({ id: node.id });
  }
  if (lights.some(node => node.light.shadows)) {
    const entities = physicsEntities(worldRoots, () => undefined).filter(entity => {
      const node = tree.get(entity.id)?.node;
      return !!node && !node.shadowCaster && nearestBody(entity.id) === 'static';
    });
    for (const outline of colliderOutlines(entities)) {
      if (!outline.sensor) occluders.push({ id: outline.entityId, points: outline.points });
    }
  }
  return { lights, occluders };
}

/** Ambient and additive radial lights composited once above the world and below screen-space objects. */
export class SceneLighting {
  readonly layer = new Container({ label: 'Lighting', eventMode: 'none', visible: false });
  private readonly area = new Rectangle();
  private readonly ambient = new Graphics();
  private readonly worldLights = new Container();
  private readonly visuals = new Map<string, LightVisual>();
  private texture?: Texture;
  private filter?: AlphaFilter;
  private lights: LightNode[] = [];
  private occluders: Occluder[] = [];
  private lookup?: Lookup;
  private settings = defaultLighting;
  private ambientKey = '';

  constructor() {
    this.layer.filterArea = this.area;
    this.layer.addChild(this.ambient, this.worldLights);
  }

  show(settings: Lighting | undefined, roots: readonly SceneObject[], lookup: Lookup) {
    this.settings = settings ?? defaultLighting;
    this.lookup = lookup;
    const { lights, occluders } = this.settings.enabled ? collectLighting(roots) : { lights: [], occluders: [] };
    this.lights = lights;
    this.occluders = occluders;
    const keep = new Set(lights.map(node => node.id));
    for (const [id, visual] of this.visuals) {
      if (keep.has(id)) continue;
      visual.glow.destroy();
      visual.mask?.destroy();
      this.visuals.delete(id);
    }
  }

  update(world: Container, screen: { width: number; height: number }, seconds: number, preview: boolean, tests: readonly PulsePreview[] = []) {
    const normal = this.settings.enabled && preview;
    this.layer.visible = normal || tests.length > 0;
    if (!this.layer.visible || !this.lookup) return;
    const lookup = this.lookup;
    if (!this.filter) {
      this.filter = new AlphaFilter({ alpha: 1 });
      this.filter.blendMode = 'multiply';
      this.layer.filters = [this.filter];
    }
    const { width, height } = screen;
    const ambientKey = `${width},${height},${this.settings.ambient}`;
    if (ambientKey !== this.ambientKey) {
      this.area.width = width;
      this.area.height = height;
      this.ambient.clear().rect(0, 0, width, height).fill(hexColor(this.settings.ambient));
      this.ambientKey = ambientKey;
    }

    const matrix = world.getGlobalTransform(new Matrix());
    this.worldLights.setFromMatrix(matrix);
    const inverse = matrix.clone().invert();
    let polygons: Point[][] | undefined;
    let geometryKey = '';
    const lights = normal ? this.lights : [...new Map(tests.map(test => [test.id, test.node])).values()];
    if (!normal) for (const visual of this.visuals.values()) visual.glow.visible = false;
    for (const [index, node] of lights.entries()) {
      const display = lookup(node.id);
      const pulses = tests.filter(test => test.id === node.id);
      const alpha = display ? displayAlpha(display) || (pulses.length ? 1 : 0) : 0;
      const config = node.light;
      let visual = this.visuals.get(node.id);
      if (!display || !alpha || !config.intensity) {
        if (visual) visual.glow.visible = false;
        continue;
      }
      if (!visual) {
        const glow = new Sprite(this.texture ??= makeGlow());
        glow.anchor.set(0.5);
        glow.blendMode = 'add';
        this.worldLights.addChild(glow);
        visual = { glow };
        this.visuals.set(node.id, visual);
      }
      const point = inverse.apply(display.getGlobalTransform(new Matrix()).apply(display.pivot));
      visual.glow.visible = true;
      visual.glow.position.set(point.x, point.y);
      visual.glow.width = visual.glow.height = config.radius * 2;
      visual.glow.tint = hexColor(config.color);
      const modulation = (pulses.length ? pulses : objectModulations(display, 'lightPulse').map(pulse => ({ ...pulse, seconds })))
        .reduce((value, pulse) => value * (1 - pulse.amount * (1 - Math.cos(pulse.seconds * pulse.frequency * Math.PI * 2)) / 2), 1);
      visual.glow.alpha = alpha * config.intensity * flickerAt(config.flicker, seconds, index * 1.7) * modulation;
      if (config.shadows) {
        if (!polygons) {
          polygons = this.polygons(lookup, inverse);
          geometryKey = polygons.map(points => points.map(({ x, y }) => `${x.toFixed(3)},${y.toFixed(3)}`).join(':')).join('|');
        }
        const signature = `${point.x.toFixed(3)},${point.y.toFixed(3)},${config.radius}|${geometryKey}`;
        if (signature !== visual.signature || !visual.mask) {
          if (!visual.mask) {
            visual.mask = this.worldLights.addChild(new Graphics());
            visual.glow.mask = visual.mask;
          }
          visual.mask.clear().poly(visibility(point, config.radius, polygons).flatMap(pt => [pt.x, pt.y])).fill(0xffffff);
          visual.signature = signature;
        }
      } else if (visual.mask) {
        visual.glow.mask = null;
        visual.mask.destroy();
        visual.mask = undefined;
        visual.signature = undefined;
      }
    }
  }

  private polygons(lookup: Lookup, stageToWorld: Matrix) {
    return this.occluders.flatMap(({ id, points }) => {
      const display = lookup(id);
      if (!display || !displayAlpha(display)) return [];
      const transform = display.getGlobalTransform(new Matrix());
      if (!points) {
        const box = display.getLocalBounds();
        if (!box.isValid || !box.width || !box.height) return [];
        points = [
          { x: box.minX, y: box.minY }, { x: box.maxX, y: box.minY },
          { x: box.maxX, y: box.maxY }, { x: box.minX, y: box.maxY },
        ];
      }
      return [points.map(point => stageToWorld.apply(transform.apply(point)))];
    });
  }

  destroy() {
    if (!this.layer.destroyed) this.layer.destroy({ children: true });
    this.texture?.destroy(true);
    this.filter?.destroy();
    this.visuals.clear();
  }
}
