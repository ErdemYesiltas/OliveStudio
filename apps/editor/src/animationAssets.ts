import { ImageSource, Spritesheet, Texture, type SpritesheetData } from 'pixi.js';
import { loadSpineSource, SpineVersionError } from '@olivestudio/engine/spine';
import type { AnimationSource } from '@olivestudio/engine/scene-animation';
import { assetMime, type Asset } from './assets';
import { t } from './i18n';

export type { AnimationSource } from '@olivestudio/engine/scene-animation';

export async function loadAnimation(asset: Pick<Asset, 'path' | 'url' | 'media'>): Promise<AnimationSource> {
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
  async function bitmap(name: string, options?: ImageBitmapOptions) {
    return createImageBitmap(await (await fetch(fileUrl(name, assetMime(name) ?? 'image/png'))).blob(), options);
  }
  async function texture(name: string) {
    const resource = await bitmap(name);
    const result = new Texture({ source: new ImageSource({ resource }) });
    textures.push({ texture: result, bitmap: resource });
    return result;
  }
  try {
    const response = await fetch(asset.url);
    if (!response.ok) throw new Error(t('previewUnavailable'));
    if (media.kind === 'spine') {
      const atlasName = media.files.find(file => file.name.endsWith('.atlas'))?.name;
      if (!atlasName) throw new Error(t('previewUnavailable'));
      const atlas = await (await fetch(fileUrl(atlasName, 'text/plain'))).text();
      const pages = { atlas, loadPage: bitmap };
      return /\.skel$/i.test(asset.path) ?
        await loadSpineSource({ format: 'binary', data: new Uint8Array(await response.arrayBuffer()), ...pages }) :
        await loadSpineSource({ format: 'json', data: await response.json(), ...pages });
    }
    const json = await response.json();
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
    if (error instanceof SpineVersionError) throw new Error(t('spineVersionError', { version: error.version }));
    throw error;
  }
}
