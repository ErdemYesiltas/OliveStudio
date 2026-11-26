import { ImageSource, Spritesheet, Texture, type SpritesheetData } from 'pixi.js';
import { AtlasAttachmentLoader, SkeletonJson, TextureAtlas, type SkeletonData } from '@esotericsoftware/spine-core';
// Importing the Spine runtime registers its render pipes before the scene renderer is created.
import { Spine, SpineTexture } from '@esotericsoftware/spine-pixi-v8';
import { assetMime, type Asset } from './assets';
import { t } from './i18n';

export type AnimationSource = (
  { kind: 'spine'; skeleton: SkeletonData; createSpine: () => Spine } |
  { kind: 'sheet'; clips: Map<string, Texture[]>; frames: Texture[] }
) & { dispose: () => void };

export async function loadAnimation(asset: Pick<Asset, 'url' | 'media'>): Promise<AnimationSource> {
  const media = asset.media;
  if (!media) throw new Error(t('previewUnavailable'));
  const textures: { texture: Texture; bitmap: ImageBitmap }[] = [];
  let release = () => {};
  const dispose = () => {
    release();
    for (const { texture, bitmap } of textures) { texture.destroy(true); bitmap.close(); }
  };
  const files = new Map(media.files.map(file => [file.name, file.data]));
  function fileUrl(name: string, mime: string) {
    const data = files.get(name);
    if (!data) throw new Error(t('missingAnimationFile', { name }));
    return `data:${mime};base64,${data}`;
  }
  async function texture(name: string) {
    const resource = await createImageBitmap(await (await fetch(fileUrl(name, assetMime(name) ?? 'image/png'))).blob());
    const result = new Texture({ source: new ImageSource({ resource }) });
    textures.push({ texture: result, bitmap: resource });
    return result;
  }
  try {
    const json = await (await fetch(asset.url)).json();
    if (media.kind === 'spine') {
      const atlasName = media.files.find(file => file.name.endsWith('.atlas'))?.name;
      if (!atlasName) throw new Error(t('previewUnavailable'));
      const atlas = new TextureAtlas(await (await fetch(fileUrl(atlasName, 'text/plain'))).text());
      release = () => atlas.dispose();
      for (const page of atlas.pages) page.setTexture(SpineTexture.from((await texture(page.name)).source));
      const skeleton = new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(json);
      return { kind: 'spine', skeleton, createSpine: () => new Spine({ skeletonData: skeleton, autoUpdate: false }), dispose };
    }
    if (typeof json.meta?.image !== 'string') throw new Error(t('previewUnavailable'));
    const sheet = new Spritesheet(await texture(json.meta.image), json as SpritesheetData);
    release = () => sheet.destroy(false);
    await sheet.parse();
    const clips = new Map(Object.entries(sheet.animations).filter(([, frames]) => frames.length));
    const frames = Object.values(sheet.textures);
    if (!frames.length) throw new Error(t('previewUnavailable'));
    return { kind: 'sheet', clips, frames, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}
