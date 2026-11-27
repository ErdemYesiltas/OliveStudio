import { Emitter, type BehaviorConfigs, type EmitterConfigV3 } from '@olivestudio/engine/particles';
import { ParticleContainer, Rectangle, type Texture } from 'pixi.js';
import { particleSettings, type ParticleObject } from './scene';

const settings = Object.keys(particleSettings.shape) as (keyof typeof particleSettings.shape)[];

function makeConfig(node: ParticleObject, texture: Texture): EmitterConfigV3 {
  const keyframes = <T,>(start: T, end: T) => ({ list: [{ time: 0, value: start }, { time: 1, value: end }] });
  const startScale = node.size / Math.max(texture.width, texture.height);
  const particlesPerWave = node.waveSize || (node.emission === 'burst' ? node.count : 1);
  const behaviors: BehaviorConfigs[] = [
    { type: 'textureSingle', config: { texture } },
    { type: 'rotation', config: {
      minStart: node.direction - node.spread / 2, maxStart: node.direction + node.spread / 2,
      minSpeed: node.rotationSpeed, maxSpeed: node.rotationSpeed, accel: 0,
    } },
    { type: 'moveAcceleration', config: {
      minStart: node.speed * (1 - node.speedVariance), maxStart: node.speed, accel: { x: 0, y: node.gravity }, rotate: false, maxSpeed: 0,
    } },
    { type: 'alpha', config: { alpha: keyframes(node.startAlpha, node.endAlpha) } },
    { type: 'scale', config: { scale: keyframes(startScale, startScale * node.endScale), minMult: 1 - node.sizeVariance } },
    { type: 'color', config: { color: keyframes(node.startColor, node.endColor) } },
  ];
  if (node.spawnShape === 'circle') {
    behaviors.push({ type: 'spawnShape', config: { type: 'circle', data: { x: 0, y: 0, radius: node.spawnRadius } } });
  } else if (node.spawnShape === 'rectangle') {
    behaviors.push({ type: 'spawnShape', config: { type: 'rect', data: {
      x: -node.spawnWidth / 2, y: -node.spawnHeight / 2, w: node.spawnWidth, h: node.spawnHeight,
    } } });
  }
  return {
    lifetime: { min: node.lifetime * (1 - node.lifetimeVariance), max: node.lifetime },
    maxParticles: node.count,
    particlesPerWave,
    frequency: Math.max(0.001, node.frequency || node.lifetime * particlesPerWave / node.count),
    spawnChance: node.spawnChance,
    pos: { x: 0, y: 0 },
    autoUpdate: false,
    emit: node.emission === 'continuous' && node.spawnChance > 0,
    behaviors,
  };
}

class SceneEmitter {
  readonly view: ParticleContainer;
  private readonly emitter: Emitter;
  private readonly config: EmitterConfigV3;
  private playing = false;

  constructor(private readonly settings: ParticleObject, private readonly texture: Texture) {
    const travel = settings.speed * settings.lifetime + Math.abs(settings.gravity) * settings.lifetime ** 2 / 2;
    const radius = travel + settings.size * Math.max(1, settings.endScale);
    const offsetX = settings.spawnShape === 'rectangle' ? settings.spawnWidth / 2 :
      settings.spawnShape === 'circle' ? settings.spawnRadius : 0;
    const offsetY = settings.spawnShape === 'rectangle' ? settings.spawnHeight / 2 : offsetX;
    this.view = new ParticleContainer({
      texture,
      boundsArea: new Rectangle(-radius - offsetX, -radius - offsetY, 2 * (radius + offsetX), 2 * (radius + offsetY)),
      dynamicProperties: { position: true, vertex: true, rotation: true, color: true, uvs: false },
    });
    this.config = makeConfig(settings, texture);
    this.emitter = new Emitter(this.view, this.config);
    this.setPlaying(settings.playing);
  }

  matches(node: ParticleObject, texture: Texture) {
    return texture === this.texture && settings.every(key => node[key] === this.settings[key]);
  }

  get active() { return this.playing && (this.emitter.emit || this.emitter.particleCount > 0); }

  setPlaying(playing: boolean) {
    if (playing && !this.playing && this.settings.emission === 'burst' && this.emitter.particleCount === 0) {
      this.emitter.emitNow();
    }
    this.playing = playing;
  }

  restart() {
    this.emitter.init(this.config);
    if (this.playing && this.settings.emission === 'burst') this.emitter.emitNow();
  }

  clearParticles() { this.emitter.cleanup(); }

  update(seconds: number) { this.emitter.update(seconds); }

  destroy() {
    this.emitter.destroy();
    this.view.destroy();
  }
}

export class SceneParticles {
  private readonly emitters = new Map<string, SceneEmitter>();

  project(node: ParticleObject, texture: Texture) {
    const previous = this.emitters.get(node.id);
    if (previous?.matches(node, texture)) {
      previous.setPlaying(node.playing);
      return previous.view;
    }
    previous?.destroy();
    const emitter = new SceneEmitter(node, texture);
    this.emitters.set(node.id, emitter);
    return emitter.view;
  }

  detach() {
    for (const emitter of this.emitters.values()) emitter.view.removeFromParent();
  }

  prune() {
    for (const [id, emitter] of this.emitters) {
      if (emitter.view.parent) continue;
      emitter.destroy();
      this.emitters.delete(id);
    }
  }

  active(visible: (display: ParticleContainer) => boolean, id: string) {
    const emitter = this.emitters.get(id);
    return !!emitter?.active && visible(emitter.view);
  }

  update(seconds: number, visible: (display: ParticleContainer) => boolean, onlyId?: string) {
    for (const [id, emitter] of this.emitters) {
      if ((!onlyId || id === onlyId) && emitter.active && visible(emitter.view)) emitter.update(seconds);
    }
  }

  restart(id: string) {
    this.emitters.get(id)?.restart();
  }

  clearParticles(id: string) {
    this.emitters.get(id)?.clearParticles();
  }

  destroy() {
    for (const emitter of this.emitters.values()) emitter.destroy();
    this.emitters.clear();
  }
}
