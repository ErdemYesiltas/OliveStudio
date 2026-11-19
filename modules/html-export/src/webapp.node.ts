import {createHash} from 'node:crypto';
import {mkdir, readFile, readdir, stat, writeFile} from 'node:fs/promises';
import {join, relative, sep} from 'node:path';
import sharp from 'sharp';
import {serviceWorker, webAppHead, webManifest, type WebApp} from './webapp';

async function walk(root: string, dir = root): Promise<string[]> {
 const out: string[] = [];
 for (const entry of await readdir(dir, {withFileTypes: true})) { const path = join(dir, entry.name); if (entry.isDirectory()) out.push(...await walk(root, path)); else if (entry.isFile()) out.push(relative(root, path).split(sep).join('/')); }
 return out.sort();
}
/** A plain icon when the project has none: the theme colour with the name's first letter. */
const letterIcon = (app: WebApp) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="${app.themeColor}"/><text x="256" y="256" dy=".35em" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="300" font-weight="700" fill="#ffffff">${(app.shortName[0] ?? 'G').toUpperCase().replace(/[<>&"]/g, '')}</text></svg>`);
/**
 * Writes the web app files into an HTML export: icons (the mobile app icon, else a letter icon; maskable versions keep
 * the safe zone), the manifest, the page head tags and a service worker listing every file. Returns the new top-level
 * entries for packaging.
 */
export async function writeWebApp(stage: string, app: WebApp, options: {icon?: Uint8Array; background: string; orientation?: 'any' | 'landscape' | 'portrait'}): Promise<string[]> {
 const source = options.icon ?? letterIcon(app), icons = join(stage, 'icons');
 await mkdir(icons, {recursive: true});
 for (const size of [192, 512]) {
  await writeFile(join(icons, `icon-${size}.png`), await sharp(source).resize(size, size, {fit: 'contain', background: {r: 0, g: 0, b: 0, alpha: 0}}).png().toBuffer());
  const inner = Math.round(size * .8), padded = await sharp(source).resize(inner, inner, {fit: 'contain', background: {r: 0, g: 0, b: 0, alpha: 0}}).png().toBuffer();
  await writeFile(join(icons, `maskable-${size}.png`), await sharp({create: {width: size, height: size, channels: 4, background: options.background}}).composite([{input: padded, gravity: 'centre'}]).png().toBuffer());
 }
 await writeFile(join(stage, 'manifest.webmanifest'), JSON.stringify(webManifest(app, options.background, options.orientation), null, 2) + '\n');
 const page = join(stage, 'index.html'), html = await readFile(page, 'utf8');
 if (!html.includes('</head>')) throw Error('index.html has no head');
 await writeFile(page, html.replace('</head>', `${webAppHead(app)}</head>`));
 const files = (await walk(stage)).filter(f => f !== 'sw.js' && f !== 'README.txt'), hash = createHash('sha256');
 for (const f of files) hash.update(`${f}:${(await stat(join(stage, f))).size}\n`);
 hash.update(await readFile(join(stage, 'project.json')));
 await writeFile(join(stage, 'sw.js'), serviceWorker(files, hash.digest('hex').slice(0, 16)));
 return ['manifest.webmanifest', 'sw.js', 'icons/'];
}
