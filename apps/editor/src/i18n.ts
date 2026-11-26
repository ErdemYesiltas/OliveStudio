import { localize } from '../locales/catalog.mjs';

export type { MessageKey } from '../locales/catalog.mjs';

export const { locale, t } = localize(globalThis.navigator?.languages ?? []);

export const objectTypeKey = {
  Container: 'typeContainer',
  Sprite: 'typeSprite',
  Text: 'typeText',
  BitmapText: 'typeBitmapText',
  Graphics: 'typeGraphics',
  TilingSprite: 'typeTilingSprite',
  NineSliceSprite: 'typeNineSliceSprite',
  AnimatedSprite: 'typeAnimatedSprite',
  Spine: 'typeSpine',
  MeshPlane: 'typeMeshPlane',
  MeshRope: 'typeMeshRope',
  Tilemap: 'typeTilemap',
  Particles: 'typeParticles',
  AudioSource: 'typeAudioSource',
  AudioListener: 'typeAudioListener',
  Camera2D: 'typeCamera2D',
  Light2D: 'typeLight2D',
  UIWidget: 'typeUIWidget',
} as const;
