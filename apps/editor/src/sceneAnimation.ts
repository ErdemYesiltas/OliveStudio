import { AnimatedSprite, type Container, type Ticker } from 'pixi.js';
import type { AnimationSource } from './animationAssets';
import type { SceneObject } from './scene';

export type AnimationObject = Extract<SceneObject, { type: 'Spine' | 'AnimatedSprite' }>;

export function isAnimationObject(node: SceneObject): node is AnimationObject {
  return node.type === 'Spine' || node.type === 'AnimatedSprite';
}

export class SceneAnimation {
  readonly display: Container;
  private readonly updateFrame: (ticker: Ticker) => void;
  private readonly setPlayback: (node: AnimationObject) => void;
  private finished = false;
  private playing = false;
  private model: AnimationObject;

  constructor(readonly source: AnimationSource, node: AnimationObject) {
    this.model = node;
    if (source.kind === 'spine' && node.type === 'Spine') {
      const spine = source.createSpine();
      const skin = source.skeleton.skins.find(item => item.name === node.skin) ??
        source.skeleton.defaultSkin ?? source.skeleton.skins[0];
      if (skin) spine.skeleton.setSkin(skin);
      spine.skeleton.setToSetupPose();
      const clip = source.skeleton.animations.find(item => item.name === node.animation) ?? source.skeleton.animations[0];
      this.display = spine;
      this.setPlayback = model => {
        const track = spine.state.getCurrent(0);
        if (track) track.loop = model.loop;
        if (clip && (!track || (this.finished && model.playing && !this.playing))) {
          spine.state.setAnimation(0, clip.name, model.loop);
          this.finished = false;
        }
      };
      this.updateFrame = ticker => spine.update(ticker.deltaMS / 1000 * this.model.speed);
      spine.state.addListener({ complete: track => { if (!track.loop) this.finished = true; } });
      if (!clip) this.finished = true;
      this.sync(node);
      spine.update(0);
    } else if (source.kind === 'sheet' && node.type === 'AnimatedSprite') {
      const sprite = new AnimatedSprite({
        textures: (node.animation && source.clips.get(node.animation)) || source.clips.values().next().value || source.frames,
        autoUpdate: false,
      });
      this.display = sprite;
      this.setPlayback = model => {
        sprite.loop = model.loop;
        sprite.animationSpeed = model.speed / 60;
        if (model.type === 'AnimatedSprite') sprite.anchor.copyFrom(model.anchor);
        if (model.playing && !this.playing) {
          if (this.finished) sprite.gotoAndPlay(0);
          else sprite.play();
          this.finished = false;
        } else if (!model.playing) sprite.stop();
      };
      this.updateFrame = ticker => sprite.update(ticker);
      sprite.onComplete = () => { this.finished = true; };
      this.sync(node);
    } else {
      throw new Error('Animation source does not match the scene object type');
    }
  }

  matches(source: AnimationSource, node: AnimationObject) {
    const current = this.model;
    return source === this.source && current.type === node.type && current.animation === node.animation &&
      (current.type !== 'Spine' || (node.type === 'Spine' && current.skin === node.skin));
  }

  get active() { return this.playing && !this.finished; }

  sync(node: AnimationObject) {
    this.setPlayback(node);
    this.model = node;
    this.playing = node.playing;
  }

  tick(ticker: Ticker) {
    if (this.active) this.updateFrame(ticker);
  }
}
