import type { Asset, EmbeddedMedia } from './assets';
import { t } from './i18n';

export async function sliceAsset(asset: Asset, options: { cellWidth: number; cellHeight: number; clip: string }) {
  const { cellWidth, cellHeight, clip } = options;
  if (![cellWidth, cellHeight].every(value => Number.isInteger(value) && value > 0 && value <= 8192) ||
      !/^[A-Za-z0-9_-]{1,50}$/.test(clip)) throw new Error(t('sliceInvalid'));
  const response = await fetch(asset.url);
  if (!response.ok) throw new Error(t('previewUnavailable'));
  const bitmap = await createImageBitmap(await response.blob());
  try {
    const { width, height } = bitmap;
    const columns = Math.floor(width / cellWidth), rows = Math.floor(height / cellHeight);
    if (width * height > 16777216 || columns * rows < 1 || columns * rows > 1024) throw new Error(t('sliceInvalid'));
    const image = document.createElement('canvas');
    image.width = width;
    image.height = height;
    const context = image.getContext('2d');
    if (!context) throw new Error(t('previewUnavailable'));
    context.drawImage(bitmap, 0, 0);
    const png = image.toDataURL('image/png').split(',')[1];
    const frameNames = Array.from({ length: columns * rows }, (_, index) => `frame-${index + 1}`);
    const frames = Object.fromEntries(frameNames.map((key, index) => [key, {
      frame: { x: index % columns * cellWidth, y: Math.floor(index / columns) * cellHeight, w: cellWidth, h: cellHeight },
      rotated: false, trimmed: false, sourceSize: { w: cellWidth, h: cellHeight },
    }]));
    const file = 'atlas.png';
    const data = btoa(JSON.stringify({ frames, animations: { [clip]: frameNames },
      meta: { image: file, size: { w: width, h: height }, scale: '1' } }));
    const media: EmbeddedMedia = { kind: 'sheet', files: [{ name: file, data: png }] };
    return { data, media };
  } finally { bitmap.close(); }
}
