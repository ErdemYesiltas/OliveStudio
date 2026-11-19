/**
 * Local background removal for images with a plain background (generated sprites, scans): the background colour is
 * the most common corner colour; everything connected to the image edge within `tolerance` of it becomes transparent
 * (flood fill, so the same colour inside the subject stays), and the ring of pixels just outside that tolerance
 * (up to `feather`) fades out for a soft edge. Already transparent pixels count as background.
 */
export interface CutoutResult {pixels: Uint8ClampedArray; removed: number; background: [number, number, number]}

export function cutoutBackground(source: Uint8ClampedArray, width: number, height: number, tolerance = 32, feather = 16): CutoutResult {
 if (source.length !== width * height * 4) throw Error('Pixel data does not match the size');
 const pixels = new Uint8ClampedArray(source), at = (x: number, y: number) => (y * width + x) * 4;
 const corners = [at(0, 0), at(width - 1, 0), at(0, height - 1), at(width - 1, height - 1)].map(i => [pixels[i], pixels[i + 1], pixels[i + 2]] as [number, number, number]);
 const distance = (a: readonly number[], b: readonly number[]) => Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
 // The corner colour most other corners agree with (a subject touching one corner does not decide the background).
 const background = corners.map(c => ({c, votes: corners.filter(o => distance(c, o) <= tolerance).length})).sort((a, b) => b.votes - a.votes)[0].c;
 const state = new Uint8Array(width * height), queue = new Int32Array(width * height);
 let head = 0, tail = 0, removed = 0;
 const consider = (x: number, y: number) => {
  const p = y * width + x;
  if (state[p]) return;
  const i = p * 4, d = pixels[i + 3] < 10 ? 0 : distance([pixels[i], pixels[i + 1], pixels[i + 2]], background);
  if (d <= tolerance) { state[p] = 1; queue[tail++] = p; return; }
  if (d < tolerance + feather) { state[p] = 2; pixels[i + 3] = Math.round(pixels[i + 3] * (d - tolerance) / feather); }
 };
 for (let x = 0; x < width; x++) { consider(x, 0); consider(x, height - 1); }
 for (let y = 0; y < height; y++) { consider(0, y); consider(width - 1, y); }
 while (head < tail) {
  const p = queue[head++], x = p % width, y = (p - x) / width;
  pixels[p * 4 + 3] = 0; removed++;
  if (x > 0) consider(x - 1, y); if (x < width - 1) consider(x + 1, y); if (y > 0) consider(x, y - 1); if (y < height - 1) consider(x, y + 1);
 }
 return {pixels, removed, background};
}
