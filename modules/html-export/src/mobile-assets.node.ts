import {mkdir, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import sharp from 'sharp';

const ANDROID_DENSITIES = [['mdpi', 1], ['hdpi', 1.5], ['xhdpi', 2], ['xxhdpi', 3], ['xxxhdpi', 4]] as const;
const SPLASH_PORTRAIT: Record<string, [number, number]> = {mdpi: [320, 480], hdpi: [480, 800], xhdpi: [720, 1280], xxhdpi: [960, 1600], xxxhdpi: [1280, 1920]};

/**
 * Home-screen icons and splash screens for the Capacitor project, at the paths and sizes Capacitor 8's iOS and Android
 * templates use, under `resources/` (mirroring `ios/` and `android/`); `tools/apply-assets.mjs` copies them in after
 * `cap add`. iOS icons are opaque (flattened on the background colour); Android gets legacy, round and adaptive
 * foreground icons plus portrait and landscape splashes per density.
 */
export async function mobileAssets(image: Uint8Array, background: string, out: string): Promise<string[]> {
 const written: string[] = [];
 const save = async (path: string, data: Buffer | string) => { await mkdir(dirname(join(out, path)), {recursive: true}); await writeFile(join(out, path), data); written.push(path); };
 const fit = (size: number) => sharp(image).resize(size, size, {fit: 'contain', background: {r: 0, g: 0, b: 0, alpha: 0}}).png().toBuffer();
 /** The image centred on a background-coloured canvas, at `scale` of the shorter side. */
 const onCanvas = async (width: number, height: number, scale: number, flatten = true) => {
  const size = Math.max(1, Math.round(Math.min(width, height) * scale));
  return sharp({create: {width, height, channels: 4, background: flatten ? background : {r: 0, g: 0, b: 0, alpha: 0}}}).composite([{input: await fit(size), gravity: 'centre'}]).png().toBuffer();
 };
 const ios = 'ios/App/App/Assets.xcassets';
 await save(`${ios}/AppIcon.appiconset/AppIcon-512@2x.png`, await sharp(await onCanvas(1024, 1024, 1)).flatten({background}).png().toBuffer());
 await save(`${ios}/AppIcon.appiconset/Contents.json`, JSON.stringify({images: [{filename: 'AppIcon-512@2x.png', idiom: 'universal', platform: 'ios', size: '1024x1024'}], info: {author: 'xcode', version: 1}}, null, 2) + '\n');
 const splash = await onCanvas(2732, 2732, .25);
 for (const name of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png']) await save(`${ios}/Splash.imageset/${name}`, splash);
 const res = 'android/app/src/main/res';
 for (const [density, k] of ANDROID_DENSITIES) {
  const size = Math.round(48 * k), fg = Math.round(108 * k);
  await save(`${res}/mipmap-${density}/ic_launcher.png`, await onCanvas(size, size, 1));
  const round = await sharp(await onCanvas(size, size, .8)).composite([{input: Buffer.from(`<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}"/></svg>`), blend: 'dest-in'}]).png().toBuffer();
  await save(`${res}/mipmap-${density}/ic_launcher_round.png`, round);
  // Adaptive icons: the launcher masks a 108 dp layer to its middle 72 dp, so the image fills about two thirds.
  await save(`${res}/mipmap-${density}/ic_launcher_foreground.png`, await onCanvas(fg, fg, 66 / 108, false));
  const [w, h] = SPLASH_PORTRAIT[density];
  await save(`${res}/drawable-port-${density}/splash.png`, await onCanvas(w, h, 1 / 3));
  await save(`${res}/drawable-land-${density}/splash.png`, await onCanvas(h, w, 1 / 3));
 }
 await save(`${res}/drawable/splash.png`, await onCanvas(480, 320, 1 / 3));
 await save(`${res}/values/ic_launcher_background.xml`, `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${background.toUpperCase()}</color>\n</resources>\n`);
 return written;
}

/** `tools/apply-assets.mjs`: copies `resources/ios` and `resources/android` over the generated platform projects. */
export const applyAssetsTool = `// Copies the app icon and splash screens exported with the game (resources/) into the iOS and Android projects.
// Run after npx cap add ios / android (npm run ios / android do). Platforms that are not added yet are skipped.
import {cpSync, existsSync} from 'node:fs';
for (const platform of ['ios', 'android']) {
  if (!existsSync(\`resources/\${platform}\`)) continue;
  if (!existsSync(platform)) { console.log(\`\${platform}: not added yet, skipped\`); continue; }
  cpSync(\`resources/\${platform}\`, platform, {recursive: true});
  console.log(\`\${platform}: icon and splash applied\`);
}
`;
