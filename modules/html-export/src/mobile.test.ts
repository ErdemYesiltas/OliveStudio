import {expect, it} from 'vitest';
import {mkdir, mkdtemp, readFile, rm, writeFile, readdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createMobileTarget, defaultMobileApp, parseMobileApp, mobileReadme} from './mobile.node';

it('checks mobile app identity and derives a default from the project name', () => {
 expect(defaultMobileApp('Sky Hopper!')).toEqual({version: 1, appId: 'com.example.skyhopper', appName: 'Sky Hopper!'});
 expect(defaultMobileApp('123')).toMatchObject({appId: 'com.example.game'});
 expect(parseMobileApp({appId: 'com.studio.game', appName: 'Game'}).errors).toEqual([]);
 expect(parseMobileApp({appId: 'Game', appName: ''}).errors).toHaveLength(2);
 expect(mobileReadme({version: 1, appId: 'com.a.b', appName: 'B'}, {xcode: null, iosSimulators: [], signingIdentities: 0, androidSdk: null, jdk: null})).toContain('npm run android');
});

it('wraps the HTML export in www/ and writes a Capacitor project with a toolchain report', async () => {
 const stage = await mkdtemp(join(tmpdir(), 'mobile-target-'));
 try {
  const html = {id: 'html', create: (o: {stage: string}) => ({id: 'html', titleKey: 'build.html', validate: async () => [], prepare: async () => {}, build: async () => { await writeFile(join(o.stage, 'index.html'), '<title>Game</title>'); }, package: async () => ['index.html'], cleanup: async () => {}})};
  const target = createMobileTarget(html as never).create({stage, template: '', readAsset: async () => new Uint8Array()});
  const ctx = {profile: {name: 'Tap Tycoon', extensions: {}}, signal: new AbortController().signal, report() {}} as never;
  expect(await target.validate(ctx)).toEqual([]);
  await target.prepare(ctx); await target.build(ctx);
  expect(await target.package(ctx)).toEqual(['www/index.html', 'capacitor.config.json', 'package.json', 'tools/android-gradle.mjs', 'tools/apply-assets.mjs', 'mobile-tools.json', 'README.md']);
  expect(JSON.parse(await readFile(join(stage, 'capacitor.config.json'), 'utf8'))).toEqual({appId: 'com.example.taptycoon', appName: 'Tap Tycoon', webDir: 'www'});
  expect(JSON.parse(await readFile(join(stage, 'package.json'), 'utf8')).dependencies['@capacitor/ios']).toBe('8.6.0');
  expect(await readdir(join(stage, 'www'))).toEqual(['index.html']);
  expect(JSON.parse(await readFile(join(stage, 'package.json'), 'utf8')).scripts.android).toContain('node tools/android-gradle.mjs');
  const wrapper = join(stage, 'android/gradle/wrapper/gradle-wrapper.properties');
  await mkdir(join(stage, 'android/gradle/wrapper'), {recursive: true});
  await writeFile(wrapper, 'distributionBase=GRADLE_USER_HOME\ndistributionUrl=https\\://services.gradle.org/distributions/gradle-8.14.3-all.zip\n');
  expect(execFileSync(process.execPath, ['tools/android-gradle.mjs'], {cwd: stage, encoding: 'utf8'})).toContain('pinned to 9.5.1');
  expect(await readFile(wrapper, 'utf8')).toContain('distributions/gradle-9.5.1-all.zip');
  const bad = createMobileTarget(html as never).create({stage, template: '', readAsset: async () => new Uint8Array()});
  expect((await bad.validate({...(ctx as object), profile: {name: 'X', extensions: {'mobile.app': {appId: 'nope', appName: 'X'}}}} as never))[0]).toMatchObject({severity: 'error'});
 } finally { await rm(stage, {recursive: true, force: true}); }
});

it('makes opaque iOS icons, Android legacy/round/adaptive icons and splashes at the template sizes, and applies them', async () => {
 const sharp = (await import('sharp')).default, {mobileAssets} = await import('./mobile-assets.node');
 const out = await mkdtemp(join(tmpdir(), 'mobile-assets-'));
 try {
  const image = await sharp({create: {width: 64, height: 64, channels: 4, background: {r: 255, g: 0, b: 0, alpha: 1}}}).png().toBuffer();
  const files = await mobileAssets(image, '#123456', join(out, 'resources'));
  expect(files).toHaveLength(2 + 3 + 5 * 5 + 2);
  const meta = (p: string) => sharp(join(out, 'resources', p)).metadata();
  const icon = await meta('ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png');
  expect([icon.width, icon.height, icon.hasAlpha]).toEqual([1024, 1024, false]);
  expect([(await meta('ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732-2.png')).width]).toEqual([2732]);
  const res = 'android/app/src/main/res';
  expect((await meta(res + '/mipmap-xxxhdpi/ic_launcher.png')).width).toBe(192);
  expect((await meta(res + '/mipmap-hdpi/ic_launcher_foreground.png')).width).toBe(162);
  expect([(await meta(res + '/drawable-land-xhdpi/splash.png')).width, (await meta(res + '/drawable-land-xhdpi/splash.png')).height]).toEqual([1280, 720]);
  const corner = await sharp(join(out, 'resources', res, 'mipmap-mdpi/ic_launcher_round.png')).raw().toBuffer({resolveWithObject: true});
  expect(corner.data[3]).toBe(0);
  expect(await readFile(join(out, 'resources', res, 'values/ic_launcher_background.xml'), 'utf8')).toContain('#123456');
  const {applyAssetsTool} = await import('./mobile-assets.node');
  await mkdir(join(out, 'tools')); await writeFile(join(out, 'tools/apply-assets.mjs'), applyAssetsTool);
  await mkdir(join(out, 'ios'));
  expect(execFileSync(process.execPath, ['tools/apply-assets.mjs'], {cwd: out, encoding: 'utf8'})).toContain('ios: icon and splash applied');
  expect(await readdir(join(out, 'ios/App/App/Assets.xcassets/AppIcon.appiconset'))).toEqual(['AppIcon-512@2x.png', 'Contents.json']);
 } finally { await rm(out, {recursive: true, force: true}); }
});
