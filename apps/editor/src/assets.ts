import { z } from 'zod';
import { spineRelativePath } from '@olivestudio/engine/spine-paths';
import { t } from './i18n';

export function assetMime(filename: string): string | undefined {
  switch (filename.split('.').at(-1)?.toLowerCase()) {
    case 'png': return 'image/png';
    case 'jpg':
    case 'jpeg': return 'image/jpeg';
    case 'webp': return 'image/webp';
    case 'wav': return 'audio/wav';
    case 'mp3': return 'audio/mpeg';
    case 'ogg': return 'audio/ogg';
  }
}

const relativePath = z.string().min(1).refine(path =>
  !path.includes('\\') && path.split('/').every(part => part && part !== '.' && part !== '..'),
);
const manifestSchema = z.object({
  bundles: z.array(z.object({
    name: z.string().min(1),
    assets: z.array(z.object({
      alias: z.tuple([relativePath]),
      src: z.tuple([relativePath]),
    })),
  })),
});

const companionName = relativePath.refine(name => spineRelativePath(name) === name);
const assetData = z.base64().min(4).max(32 * 1024 * 1024);
const spineAudioFiles = z.array(z.strictObject({
  path: z.string().refine(path => spineRelativePath(path) === path && assetMime(path)?.startsWith('audio/')),
  data: assetData,
})).min(1).max(128);
const mediaSchema = z.strictObject({
  kind: z.enum(['spine', 'sheet']),
  files: z.array(z.strictObject({ name: companionName, data: assetData })).min(1).max(128),
  audio: spineAudioFiles.optional(),
}).refine(media => !media.audio || media.kind === 'spine' &&
  new Set(media.audio.map(file => file.path)).size === media.audio.length);
export type EmbeddedMedia = z.output<typeof mediaSchema>;
export function spineEmbeddedAudio(media: EmbeddedMedia | undefined, path: string) {
  if (!media?.audio) return;
  return media.audio.find(file => file.path === spineRelativePath(path));
}
export function spineEmbeddedAudioUrl(media: EmbeddedMedia | undefined, path: string) {
  const file = spineEmbeddedAudio(media, path);
  return file && `data:${assetMime(file.path)};base64,${file.data}`;
}
export type Asset = {
  alias: string; path: string; url: string; kind: 'image' | 'audio' | 'spine' | 'sheet';
  name?: string; bytes?: number; media?: EmbeddedMedia;
};
export type AssetBundle = { name: string; assets: Asset[] };
export const encodeAssetPath = (path: string) => path.split('/').map(encodeURIComponent).join('/');
const byteLength = (data: string) => data.length * 0.75 - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0);
export const spineAudioBytes = (media: EmbeddedMedia | undefined) =>
  media?.audio?.reduce((total, file) => total + byteLength(file.data), 0) ?? 0;
const mediaBytes = (media: EmbeddedMedia | undefined) =>
  (media?.files.reduce((total, file) => total + byteLength(file.data), 0) ?? 0) + spineAudioBytes(media);

export const importedAssetsSchema = z.array(z.strictObject({
  alias: relativePath.refine(path => /^project\/[\da-f-]{36}\/[^/]+$/i.test(path)),
  data: assetData,
  media: mediaSchema.optional(),
})).superRefine((assets, ctx) => {
  const aliases = new Set<string>();
  let bytes = 0;
  assets.forEach(({ alias, data, media }, index) => {
    if (aliases.has(alias)) ctx.addIssue({ code: 'custom', path: [index, 'alias'], message: t('duplicateAlias', { alias }) });
    aliases.add(alias);
    const names = new Set(media?.files.map(file => file.name));
    if (media ? !/\.json$/i.test(alias) && !(media.kind === 'spine' && /\.skel$/i.test(alias)) || names.size !== media.files.length ||
      media.files.some(file => file.name === alias.split('/').at(-1) ||
        (file.name.includes('/') && (media.kind !== 'spine' || !assetMime(file.name)?.startsWith('image/'))) ||
        (!assetMime(file.name)?.startsWith('image/') && !(media.kind === 'spine' && file.name.endsWith('.atlas')))) :
      !assetMime(alias)) {
      ctx.addIssue({ code: 'custom', path: [index], message: t('unsupportedAsset', { path: alias }) });
    }
    bytes += byteLength(data) + mediaBytes(media);
  });
  if (bytes > 64 * 1024 * 1024) ctx.addIssue({ code: 'custom', message: t('assetLimit') });
});

export function projectBundle(imports: z.output<typeof importedAssetsSchema>): AssetBundle {
  return {
    name: t('projectAssets'),
    assets: imports.map(({ alias, data, media }) => {
      const mime = media ? /\.skel$/i.test(alias) ? 'application/octet-stream' : 'application/json' : assetMime(alias)!;
      return { alias, path: alias, url: `data:${mime};base64,${data}`, media,
        bytes: byteLength(data) + mediaBytes(media),
        kind: media?.kind ?? (mime.startsWith('image/') ? 'image' : 'audio') };
    }),
  };
}

export function readManifest(raw: unknown, base: string): AssetBundle[] {
  const manifest = manifestSchema.parse(raw);
  const aliases = new Set<string>();
  const names = new Set<string>();
  return manifest.bundles.map(bundle => {
    if (names.has(bundle.name)) throw new Error(t('duplicateBundle', { name: bundle.name }));
    names.add(bundle.name);
    return {
      name: bundle.name,
      assets: bundle.assets.map(({ alias: [alias], src: [path] }) => {
        if (aliases.has(alias)) throw new Error(t('duplicateAlias', { alias }));
        aliases.add(alias);
        const mime = assetMime(path);
        if (!mime) throw new Error(t('unsupportedAsset', { path }));
        return { alias, path, url: base + encodeAssetPath(path), kind: mime.startsWith('image/') ? 'image' : 'audio' };
      }),
    };
  });
}
