/**
 * Export-time texture atlases. Textures used only by plain sprites are packed into pages (shelf packing, tallest
 * first) so an exported game downloads and binds fewer images. Each image is extruded by one pixel so bilinear
 * sampling of a scaled sprite never reaches its neighbour. Textures used by tiling sprites, meshes, sprite sheets,
 * Spine or particles keep their own files (their UV maths assumes a whole texture).
 */
export interface AtlasInput {id: string; width: number; height: number}
export interface AtlasFrame {page: number; x: number; y: number; width: number; height: number}
export interface AtlasLayout {pages: {width: number; height: number}[]; frames: Record<string, AtlasFrame>}
export interface AtlasManifest {pages: string[]; frames: Record<string, AtlasFrame>}

const pow2 = (n: number) => 2 ** Math.ceil(Math.log2(Math.max(1, n)));
/** Pure layout: frames are the image area inside a `pad`-pixel gutter (the extrusion lives in the gutter). */
export function packAtlas(items: readonly AtlasInput[], size = 2048, pad = 2): AtlasLayout {
 const pages: {width: number; height: number; x: number; y: number; row: number}[] = [], frames: Record<string, AtlasFrame> = {};
 const sorted = [...items].filter(i => i.width + pad * 2 <= size && i.height + pad * 2 <= size).sort((a, b) => b.height - a.height || b.width - a.width || a.id.localeCompare(b.id));
 for (const item of sorted) {
  const w = item.width + pad * 2, h = item.height + pad * 2;
  let index = pages.findIndex(p => (p.x + w <= size && p.y + Math.max(p.row, h) <= size) || (p.y + p.row + h <= size));
  if (index < 0) { pages.push({width: 0, height: 0, x: 0, y: 0, row: 0}); index = pages.length - 1; }
  const page = pages[index];
  if (page.x + w > size) { page.y += page.row; page.x = 0; page.row = 0; }
  frames[item.id] = {page: index, x: page.x + pad, y: page.y + pad, width: item.width, height: item.height};
  page.x += w; page.row = Math.max(page.row, h);
  page.width = Math.max(page.width, page.x); page.height = Math.max(page.height, page.y + page.row);
 }
 return {pages: pages.map(p => ({width: pow2(p.width), height: pow2(p.height)})), frames};
}

/** Renders the pages with sharp (WebP, lossless) and returns their bytes in page order. */
export async function renderAtlas(layout: AtlasLayout, images: ReadonlyMap<string, Uint8Array>, pad = 2): Promise<Uint8Array[]> {
 const {default: sharp} = await import('sharp');
 const pages: Uint8Array[] = [];
 for (let index = 0; index < layout.pages.length; index++) {
  const {width, height} = layout.pages[index], composite: {input: Buffer; left: number; top: number}[] = [];
  for (const [id, frame] of Object.entries(layout.frames)) {
   if (frame.page !== index) continue;
   const source = images.get(id);
   if (!source) throw Error(`Atlas image missing: ${id}`);
   const input = await sharp(source).ensureAlpha().extend({top: pad, bottom: pad, left: pad, right: pad, extendWith: 'copy'}).png().toBuffer();
   composite.push({input, left: frame.x - pad, top: frame.y - pad});
  }
  pages.push(new Uint8Array(await sharp({create: {width, height, channels: 4, background: {r: 0, g: 0, b: 0, alpha: 0}}}).composite(composite).webp({lossless: true}).toBuffer()));
 }
 return pages;
}

/** Textures referenced only by plain sprites (any other user needs the whole texture), with their size. */
export function atlasCandidates(scenes: readonly {entities: readonly {components: readonly {type: string; data: unknown}[]}[]}[], assets: readonly {id: string; type: string; metadata: unknown}[], maxSide = 1024): AtlasInput[] {
 const users = new Map<string, Set<string>>();
 for (const scene of scenes) for (const e of scene.entities) for (const c of e.components) {
  // Other image fields read the whole file with its own UVs, so such a texture never joins an atlas page.
  for (const [key, id] of Object.entries((c.data as Record<string, unknown> | null) ?? {})) {
   if (typeof id !== 'string' || !id || !(key === 'assetId' || /(AssetId|Texture)$/.test(key))) continue;
   users.set(id, (users.get(id) ?? new Set()).add(key === 'assetId' ? c.type : `${c.type}#${key}`));
  }
 }
 return assets.flatMap(a => {
  const types = users.get(a.id), meta = a.metadata as {width?: unknown; height?: unknown} | null;
  if (a.type !== 'pixi.texture' || !types || [...types].some(t => t !== 'pixi.sprite') || typeof meta?.width !== 'number' || typeof meta.height !== 'number') return [];
  return meta.width <= maxSide && meta.height <= maxSide ? [{id: a.id, width: meta.width, height: meta.height}] : [];
 });
}
