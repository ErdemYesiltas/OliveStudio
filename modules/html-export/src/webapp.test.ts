import {expect, it} from 'vitest';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import sharp from 'sharp';
import {defaultWebApp, parseWebApp, serviceWorker, webAppHead, webManifest} from './webapp';
import {writeWebApp} from './webapp.node';

it('parses web app settings with defaults from the project name and reports bad values', () => {
 expect(parseWebApp(undefined, 'Space Rocks Deluxe Edition')).toEqual({app: {...defaultWebApp('Space Rocks Deluxe Edition'), shortName: 'Space Rocks'}, errors: []});
 expect(parseWebApp({enabled: true, name: '', shortName: 'A very long short name', display: 'standalone', themeColor: 'red'}, 'X').errors).toEqual(['Web app name needs 1–45 characters', 'Short name needs 1–12 characters (it shows under the icon)', 'Theme colour must be #rrggbb']);
 const app = parseWebApp({enabled: true, name: 'Rocks', shortName: 'Rocks', display: 'standalone', themeColor: '#AA2200'}, 'X').app;
 expect(app).toEqual({version: 1, enabled: true, name: 'Rocks', shortName: 'Rocks', display: 'standalone', themeColor: '#aa2200'});
 const manifest = webManifest(app, '#101010', 'landscape');
 expect(manifest).toMatchObject({name: 'Rocks', start_url: './', display: 'standalone', orientation: 'landscape', background_color: '#101010', theme_color: '#aa2200'});
 expect(manifest.icons.map(i => `${i.src} ${i.purpose}`)).toEqual(['icons/icon-192.png any', 'icons/maskable-192.png maskable', 'icons/icon-512.png any', 'icons/maskable-512.png maskable']);
 expect(webAppHead({...app, shortName: '<b>'})).toContain('apple-mobile-web-app-title" content="b"');
 const sw = serviceWorker(['index.html', 'assets/a.js'], 'abc');
 expect(sw).toContain('"pixi-game-abc"');
 expect(sw).toContain('["./","./index.html","./assets/a.js"]');
});

it('writes icons (from the app icon or a letter), the manifest, head tags and a service worker for every file', async () => {
 const stage = await mkdtemp(join(tmpdir(), 'webapp-'));
 try {
  await mkdir(join(stage, 'assets'));
  await writeFile(join(stage, 'index.html'), '<!doctype html><html><head><title>x</title></head><body></body></html>');
  await writeFile(join(stage, 'project.json'), '{}'); await writeFile(join(stage, 'assets', 'a.js'), 'x'); await writeFile(join(stage, 'README.txt'), 'r');
  const app = parseWebApp({enabled: true}, 'Rocks').app;
  const icon = await sharp({create: {width: 64, height: 32, channels: 4, background: '#ff0000'}}).png().toBuffer();
  expect(await writeWebApp(stage, app, {icon, background: '#000000', orientation: 'landscape'})).toEqual(['manifest.webmanifest', 'sw.js', 'icons/']);
  for (const size of [192, 512]) { expect(await sharp(join(stage, `icons/icon-${size}.png`)).metadata()).toMatchObject({width: size, height: size}); expect((await sharp(join(stage, `icons/maskable-${size}.png`)).metadata()).width).toBe(size); }
  expect(await readFile(join(stage, 'index.html'), 'utf8')).toContain('<link rel="manifest" href="./manifest.webmanifest"><meta name="theme-color" content="#191d21">');
  const sw = await readFile(join(stage, 'sw.js'), 'utf8'), files = JSON.parse(/const FILES = (.*);/.exec(sw)![1]);
  expect(files).toEqual(['./', './assets/a.js', './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-192.png', './icons/maskable-512.png', './index.html', './manifest.webmanifest', './project.json']);
  expect(JSON.parse(await readFile(join(stage, 'manifest.webmanifest'), 'utf8')).orientation).toBe('landscape');
  // No app icon: a letter icon in the theme colour.
  await writeWebApp(stage, app, {background: '#000000'});
  const {data} = await sharp(join(stage, 'icons/icon-192.png')).raw().toBuffer({resolveWithObject: true});
  expect([data[0], data[1], data[2]]).toEqual([0x19, 0x1d, 0x21]);
 } finally { await rm(stage, {recursive: true, force: true}); }
});
