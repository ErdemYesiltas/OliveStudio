import {execFile} from 'node:child_process';
import {access, mkdir, writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import type {ExportTarget} from '@rewrite/sdk';
import type {NativeTargetFactory} from '@rewrite/build/node';
import {createHtmlTarget} from './export.node';
import {applyAssetsTool, mobileAssets} from './mobile-assets.node';

import {capacitorVersion, defaultMobileApp, mobileSection, parseMobileApp, type MobileApp} from './mobile';
export * from './mobile';
const run = (file: string, args: string[]) => new Promise<string | null>(resolve => { execFile(file, args, {timeout: 8000}, (error, stdout) => resolve(error ? null : String(stdout))); });
const exists = (path: string) => access(path).then(() => true, () => false);
/** What this computer can build: Xcode and simulators, a signing identity, the Android SDK and a JDK. Never blocks the export. */
export async function mobileToolchain() {
 const xcode = await run('xcodebuild', ['-version']), runtimes = await run('xcrun', ['simctl', 'list', 'runtimes', '--json']), identities = await run('security', ['find-identity', '-p', 'codesigning', '-v']);
 const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? join(homedir(), 'Library/Android/sdk'), studioJbr = '/Applications/Android Studio.app/Contents/jbr/Contents/Home';
 const javaHome = process.env.JAVA_HOME ?? (await run('/usr/libexec/java_home', []))?.trim();
 let ios: string[] = [];
 try { ios = (JSON.parse(runtimes ?? '{}').runtimes as {name: string; isAvailable: boolean}[] ?? []).filter(r => r.isAvailable && r.name.startsWith('iOS')).map(r => r.name); } catch { ios = []; }
 return {
  xcode: xcode ? xcode.split('\n')[0].trim() : null, iosSimulators: ios,
  signingIdentities: identities ? Number(/(\d+) valid identit/.exec(identities)?.[1] ?? 0) : 0,
  androidSdk: await exists(sdk) ? sdk : null,
  jdk: javaHome && await exists(javaHome) ? javaHome : await exists(studioJbr) ? `${studioJbr} (Android Studio)` : null,
 };
}
export type MobileToolchain = Awaited<ReturnType<typeof mobileToolchain>>;

/** Gradle that builds Capacitor's Android template (AGP 8.13) on JDK 21–25; the template's own 8.14.3 cannot run on JDK 25. */
export const androidGradle = '9.5.1';
/** `tools/android-gradle.mjs`: pins the generated Android project's Gradle wrapper (run by `npm run android`). */
export const androidGradleTool = `// Capacitor's Android template ships Gradle 8.14.3, which cannot run on JDK 25 (Android Studio's bundled JDK).
// Gradle ${androidGradle} builds it with JDK 21-25. Run after \`npx cap add android\` (npm run android does).
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
const file = 'android/gradle/wrapper/gradle-wrapper.properties';
if (!existsSync(file)) { console.error('No Android project yet: run npx cap add android first.'); process.exit(1); }
const text = readFileSync(file, 'utf8'), next = text.replace(/gradle-[0-9.]+-(all|bin)\\.zip/, 'gradle-${androidGradle}-all.zip');
writeFileSync(file, next);
console.log(next === text ? 'Gradle wrapper already at ${androidGradle}' : 'Gradle wrapper pinned to ${androidGradle}');
`;

export function mobileReadme(app: MobileApp, tools: MobileToolchain) {
 const yes = (v: unknown) => v ? '✓' : '✗';
 return `# ${app.appName} — mobile project

This folder is a [Capacitor](https://capacitorjs.com) ${capacitorVersion} project around the HTML export in \`www/\`
(the same game as the HTML export). App ID \`${app.appId}\`.

## Build

\`\`\`sh
npm install
npm run ios        # adds the iOS project, applies the icon and splash, syncs, opens Xcode: pick a simulator or your signed device, then Run
npm run android    # adds the Android project, pins Gradle ${androidGradle}, syncs, opens Android Studio: Run
\`\`\`

After changing the game, export again and copy the new \`www/\` (and \`resources/\`) here, then \`npm run assets\` and \`npm run sync\`.
${app.iconAssetId ? '\nThe app icon and splash screens (Settings → Mobile app) are in \`resources/\`; \`npm run ios\` / \`android\` apply them.\n' : '\nNo app icon chosen (Settings → Mobile app): the apps use Capacitor\'s placeholder icon and splash.\n'}

## This computer (when exported)

| Tool | Found |
|---|---|
| Xcode | ${yes(tools.xcode)} ${tools.xcode ?? 'not found'} |
| iOS simulators | ${yes(tools.iosSimulators.length)} ${tools.iosSimulators.join(', ') || 'none'} |
| Code-signing identities (needed for devices and the App Store) | ${yes(tools.signingIdentities)} ${tools.signingIdentities} |
| Android SDK | ${yes(tools.androidSdk)} ${tools.androidSdk ?? 'not found (install Android Studio)'} |
| JDK | ${yes(tools.jdk)} ${tools.jdk ?? 'not found'} |

Notes: iOS builds use Swift Package Manager (no CocoaPods). On a device you need an Apple signing identity (Xcode →
Settings → Accounts). Android needs JDK 21 or newer (Android Studio's bundled JDK works); Capacitor's Gradle
8.14.3 cannot run on JDK 25, so \`npm run android\` pins Gradle ${androidGradle} (\`node tools/android-gradle.mjs\` does it alone). The game scales to any screen and orientation (letterbox,
optional device profiles in Settings → Game); audio starts after the Start tap; the game pauses in the background.
`;
}

/** Export target "Mobile project": the HTML export in www/ plus a Capacitor project and a toolchain report. */
export function createMobileTarget(html = createHtmlTarget()): NativeTargetFactory {
 return {id: 'mobile', create(options): ExportTarget {
  const inner = html.create({...options, stage: join(options.stage, 'www')});
  let app: MobileApp | undefined;
  return {id: 'mobile', titleKey: 'build.mobile',
   async validate(ctx) {
    const project = ctx.profile as {name?: string; extensions?: Record<string, unknown>}, raw = project.extensions?.[mobileSection];
    const parsed = parseMobileApp(raw ?? defaultMobileApp(project.name ?? 'Game'));
    if (parsed.errors.length) return [{owner: 'mobile', severity: 'error', message: `Mobile app (Settings → Game): ${parsed.errors.join('; ')}`}];
    app = parsed.app;
    await mkdir(join(options.stage, 'www'), {recursive: true});
    return inner.validate(ctx);
   },
   prepare: ctx => inner.prepare(ctx),
   build: ctx => inner.build(ctx),
   async package(ctx) {
    const files = await inner.package(ctx);
    if (!app) throw Error('Run mobile preflight first');
    ctx.report('Writing the Capacitor project…');
    const tools = await mobileToolchain();
    await writeFile(join(options.stage, 'capacitor.config.json'), JSON.stringify({appId: app.appId, appName: app.appName, webDir: 'www'}, null, 2) + '\n');
    await writeFile(join(options.stage, 'package.json'), JSON.stringify({name: app.appId.split('.').pop(), private: true, version: '1.0.0', scripts: {ios: 'cap add ios && node tools/apply-assets.mjs && cap sync ios && cap open ios', android: 'cap add android && node tools/android-gradle.mjs && node tools/apply-assets.mjs && cap sync android && cap open android', assets: 'node tools/apply-assets.mjs', sync: 'cap sync'}, dependencies: {'@capacitor/core': capacitorVersion, '@capacitor/ios': capacitorVersion, '@capacitor/android': capacitorVersion}, devDependencies: {'@capacitor/cli': capacitorVersion}}, null, 2) + '\n');
    await mkdir(join(options.stage, 'tools'), {recursive: true});
    await writeFile(join(options.stage, 'tools/android-gradle.mjs'), androidGradleTool);
    await writeFile(join(options.stage, 'tools/apply-assets.mjs'), applyAssetsTool);
    let resources: string[] = [];
    if (app.iconAssetId) {
     ctx.report('Making the app icon and splash screens…');
     const registry = (ctx.profile as {extensions?: Record<string, {items?: {id: string; revision: string; type: string}[]}>}).extensions?.['assets.registry']?.items ?? [];
     const asset = registry.find(a => a.id === app!.iconAssetId);
     if (!asset || asset.type !== 'pixi.texture') throw Error('Mobile app icon: the chosen image is missing from the Library');
     resources = (await mobileAssets(await options.readAsset(asset.id, asset.revision, 'image.webp'), app.splashColor ?? '#111318', join(options.stage, 'resources'))).map(f => join('resources', f));
    }
    await writeFile(join(options.stage, 'mobile-tools.json'), JSON.stringify(tools, null, 2) + '\n');
    await writeFile(join(options.stage, 'README.md'), mobileReadme(app, tools));
    return [...files.map(f => join('www', f)), 'capacitor.config.json', 'package.json', 'tools/android-gradle.mjs', 'tools/apply-assets.mjs', ...resources, 'mobile-tools.json', 'README.md'];
   },
   cleanup: () => inner.cleanup(),
  };
 }};
}
export const mobileTarget = createMobileTarget();
