import { AtlasAttachmentLoader, BinaryInput, SkeletonBinary, SkeletonJson, Skin, TextureAtlas,
  type Skeleton, type SkeletonData } from '@esotericsoftware/spine-core';
// The Spine Pixi adapter registers its render pipes on import.
import { Spine, SpineTexture } from '@esotericsoftware/spine-pixi-v8';
import { ImageSource } from 'pixi.js';
import { assertSpineDrawOrders, resolveSpineEventAudioDefaults, supportsSpineVersion } from './spine-format.js';

export { Spine };

export type SpineSource = {
  kind: 'spine';
  skeleton: SkeletonData;
  createSpine: () => Spine;
  dispose: () => void;
};

export class SpineVersionError extends Error {
  constructor(readonly version: string) {
    super(`Spine 4.2 data is required. Received version ${version}.`);
    this.name = 'SpineVersionError';
  }
}

export type SpineSourceInput = ({ format: 'json'; data: unknown } | { format: 'binary'; data: Uint8Array }) & {
  atlas: string;
  loadPage(name: string, options?: ImageBitmapOptions): Promise<ImageBitmap>;
};

function inputVersion(input: SpineSourceInput): unknown {
  if (input.format === 'json') return (input.data as { skeleton?: { spine?: unknown } } | null)?.skeleton?.spine;
  try {
    const { data } = input;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    return new BinaryInput(data, [], 8, view).readString();
  } catch { return undefined; }
}

/** Takes ownership of the images returned by loadPage. Destroy Spine instances before disposing their shared source. */
export async function loadSpineSource(input: SpineSourceInput): Promise<SpineSource> {
  const version = inputVersion(input);
  if (!supportsSpineVersion(version)) throw new SpineVersionError(String(version ?? '—'));
  if (input.format === 'json') assertSpineDrawOrders(input.data);
  const atlas = new TextureAtlas(input.atlas);
  const pages: { bitmap: ImageBitmap; source?: ImageSource }[] = [];
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    try { atlas.dispose(); } finally {
      for (const { bitmap, source } of pages) { source?.destroy(); bitmap.close(); }
    }
  };
  try {
    for (const page of atlas.pages) {
      const bitmap = await input.loadPage(page.name, page.pma ? { premultiplyAlpha: 'none' } : undefined);
      const loaded: typeof pages[number] = { bitmap };
      pages.push(loaded);
      loaded.source = new ImageSource({ resource: bitmap,
        alphaMode: page.pma ? 'premultiplied-alpha' : 'premultiply-alpha-on-upload' });
      page.setTexture(SpineTexture.from(loaded.source));
    }
    const loader = new AtlasAttachmentLoader(atlas);
    const skeleton = input.format === 'binary' ? new SkeletonBinary(loader).readSkeletonData(input.data) :
      new SkeletonJson(loader).readSkeletonData(resolveSpineEventAudioDefaults(input.data));
    return { kind: 'spine', skeleton, createSpine: () => {
      if (disposed) throw new Error('Spine source is disposed');
      return new Spine({ skeletonData: skeleton, autoUpdate: false });
    }, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}

export function applySpineSkins(skeleton: Skeleton, base: string | null, layers: readonly string[] = []) {
  const { data } = skeleton;
  const initial = (base ? data.findSkin(base) : null) ?? data.defaultSkin ?? data.skins[0] ?? null;
  const overlays = [...new Set(layers)].flatMap(name => {
    const skin = data.findSkin(name);
    return skin && skin !== initial ? [skin] : [];
  });
  if (!overlays.length) skeleton.setSkin(initial);
  else {
    const combined = new Skin('Combined skin');
    if (initial) combined.addSkin(initial);
    for (const skin of overlays) combined.addSkin(skin);
    skeleton.setSkin(combined);
  }
  skeleton.setSlotsToSetupPose();
}
