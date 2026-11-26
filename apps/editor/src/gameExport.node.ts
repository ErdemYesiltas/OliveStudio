import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { sizeReport, zipFolder } from '@rewrite/build/report-node';
import { capacitorVersion, parseMobileApp } from '@rewrite/html-export/mobile';
import { defaultWebApp, serviceWorker, webAppHead, webManifest } from '@rewrite/html-export/webapp';
import { assetMime, encodeAssetPath, projectBundle, readManifest } from './assets';
import { assessBuildBudget, assessExport, exportOptionsSchema } from './exportReport';
import { t } from './i18n';
import { networkPlan } from './networkModel';
import { parseProject, serializeProject } from './project';
import { getExportTarget } from './exportTargets.node';
export { exportTargets, getExportTarget, registerExportTarget } from './exportTargets.node';

const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n';
const escapeHtml = (text: string) => text.replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const slugify = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 56) || 'game';

async function contents(dir: string, prefix = ''): Promise<string[]> {
  const names: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = prefix + entry.name;
    if (entry.isFile()) names.push(path);
    else if (entry.isDirectory()) names.push(...await contents(join(dir, entry.name), path + '/'));
  }
  return names.sort();
}

function iconPng(size: number, maskable: boolean) {
  const width = size * 4 + 1;
  const scan = Buffer.alloc(size * width);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const center = size / 2, dx = x - center, dy = y - center;
    const color = Math.abs(dx) + Math.abs(dy) < center * (maskable ? 0.7 : 0.94) ?
      (dx + dy < 0 ? [198, 225, 133, 255] : [112, 160, 82, 255]) : [25, 29, 33, 255];
    scan.set(color, y * width + x * 4 + 1);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  const chunk = (tag: string, data: Buffer) => {
    const type = Buffer.from(tag);
    const length = Buffer.alloc(4), checksum = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    checksum.writeUInt32BE(crc32(Buffer.concat([type, data])));
    return Buffer.concat([length, type, data, checksum]);
  };
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header),
    chunk('IDAT', deflateSync(scan)), chunk('IEND', Buffer.alloc(0))]);
}

async function addPwa(stage: string, name: string, background: string) {
  const app = { ...defaultWebApp(name), enabled: true };
  const folder = join(stage, 'icons');
  await mkdir(folder);
  for (const size of [192, 512]) {
    await writeFile(join(folder, `icon-${size}.png`), iconPng(size, false));
    await writeFile(join(folder, `maskable-${size}.png`), iconPng(size, true));
  }
  await writeFile(join(stage, 'manifest.webmanifest'), json(webManifest(app, background)));
  const page = join(stage, 'index.html');
  await writeFile(page, (await readFile(page, 'utf8')).replace('</head>', `${webAppHead(app)}</head>`));
  const paths = (await contents(stage)).filter(path => path !== 'README.md' && path !== 'compatibility.json');
  const hash = createHash('sha256');
  for (const path of paths) hash.update(path).update(await readFile(join(stage, path)));
  await writeFile(join(stage, 'sw.js'), serviceWorker(paths.map(encodeAssetPath), hash.digest('hex').slice(0, 20), true));
}

async function addCapacitor(directory: string, appId: string, appName: string) {
  const parsed = parseMobileApp({ appId, appName });
  if (parsed.errors.length) throw new Error(parsed.errors.join('\n'));
  await writeFile(join(directory, 'capacitor.config.json'), json({ appId: parsed.app.appId, appName: parsed.app.appName, webDir: 'www' }));
  await writeFile(join(directory, 'package.json'), json({
    name: slugify(appName), version: '1.0.0', private: true,
    scripts: { 'add:ios': 'cap add ios', 'add:android': 'cap add android', sync: 'cap sync',
      'open:ios': 'cap open ios', 'open:android': 'cap open android' },
    dependencies: { '@capacitor/core': capacitorVersion, '@capacitor/ios': capacitorVersion, '@capacitor/android': capacitorVersion },
    devDependencies: { '@capacitor/cli': capacitorVersion },
  }));
  await writeFile(join(directory, 'README.md'), t('exportCapacitorReadme') + '\n');
}

function exportProject(text: unknown) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 100 * 1024 * 1024) throw new Error(t('exportDocumentInvalid'));
  return parseProject(JSON.parse(text));
}

export function validateNetworkDocument(text: unknown, endpoint?: string) {
  const project = exportProject(text);
  const plan = networkPlan(project);
  if (!plan.rules || !plan.template) throw new Error(plan.problems.join('\n') || t('networkDisabled'));
  return { rules: plan.rules, text: endpoint ? serializeProject({ ...project, version: 2, startup: plan.template.scene,
    multiplayer: { ...plan.settings, endpoint } }) : '' };
}

export async function exportGame(renderer: string, serverBundle: string, output: string, text: unknown, request: unknown,
  textureSize?: (bytes: Buffer) => number) {
  const options = exportOptionsSchema.parse(request);
  const target = getExportTarget(options.format);
  if (!target) throw new Error(t('exportUnknownTarget'));
  const project = exportProject(text);
  const assetpack = join(renderer, 'assetpack');
  const manifest = JSON.parse(await readFile(join(assetpack, 'manifest.json'), 'utf8'));
  const assets = new Map([...readManifest(manifest, ''), projectBundle(project.assets)]
    .flatMap(bundle => bundle.assets.map(asset => [asset.alias, asset])));
  await Promise.all([...assets.values()].map(async asset => {
    if (asset.kind === 'audio' && asset.bytes === undefined) asset.bytes = (await stat(join(assetpack, asset.path))).size;
  }));
  const issues = [...assessExport(project, options, assets, target.layout), ...(await target.check?.({ project, options }) ?? [])];
  if (issues.some(issue => issue.level === 'error')) throw new Error(issues.filter(issue => issue.level === 'error')
    .map(issue => `${issue.scope}: ${issue.message}`).join('\n'));
  const packed = target.layout === 'zip';
  const folder = packed ? dirname(output) : output;
  let textureBytes: number | undefined;
  if (textureSize) {
    textureBytes = 0;
    for (const asset of assets.values()) {
      if (asset.kind === 'image') textureBytes += textureSize(asset.url.startsWith('data:') ?
        Buffer.from(asset.url.slice(asset.url.indexOf(',') + 1), 'base64') : await readFile(join(assetpack, asset.path)));
      for (const image of asset.media?.files ?? []) {
        if (assetMime(image.name)?.startsWith('image/')) textureBytes += textureSize(Buffer.from(image.data, 'base64'));
      }
    }
  }
  const stage = await mkdtemp(join(folder, '.olive-build-'));
  let committed = '';
  try {
    const web = target.layout === 'capacitor' ? join(stage, 'www') : stage;
    await mkdir(web, { recursive: true });
    const runtime = join(renderer, 'game-runtime');
    await cp(join(runtime, 'assets'), join(web, 'assets'), { recursive: true });
    await cp(assetpack, join(web, 'assetpack'), { recursive: true });
    const html = await readFile(join(runtime, 'game.html'), 'utf8');
    await writeFile(join(web, 'index.html'), html.replace('</head>', `<meta name="game-title" content="${escapeHtml(options.title)}"></head>`));
    await writeFile(join(web, 'config.json'), JSON.stringify(project.config, null, 2) + '\n');
    // Prefab instances already carry their resolved scene components in the project file.
    await writeFile(join(web, 'project.json'), serializeProject({ ...project, tests: undefined, skills: undefined, prefabs: [], scenes: project.scenes.map(scene => {
      const strip = (nodes: typeof scene.objects): typeof scene.objects => nodes.map(node => {
        const { prefab: _prefab, ...data } = node;
        return data.type === 'Container' ? { ...data, children: strip(data.children) } : data;
      });
      return { ...scene, objects: strip(scene.objects) };
    }) }));
    await target.prepare?.({ project, options, directory: stage, webDirectory: web });
    if (target.layout === 'pwa') await addPwa(web, options.title, project.config.renderer.background);
    if (target.layout === 'capacitor') await addCapacitor(stage, options.appId, options.title);
    else await writeFile(join(stage, 'README.md'), t('exportWebReadme') + '\n');
    const network = networkPlan(project);
    if (network.rules) {
      const server = join(stage, 'server');
      await mkdir(server);
      await cp(serverBundle, join(server, 'server.mjs'));
      await writeFile(join(server, 'rules.json'), json(network.rules));
      await writeFile(join(server, 'README.md'), t('networkServerReadme') + '\n');
    }
    const sizes = await sizeReport(stage);
    const { warnings } = assessBuildBudget(project, assets, sizes.total, textureBytes);
    const outputIssues = warnings.filter(issue => !issues.some(existing => existing.scope === issue.scope && existing.message === issue.message));
    if (outputIssues.some(issue => issue.level === 'error')) throw new Error(outputIssues.map(issue => issue.message).join('\n'));
    issues.push(...outputIssues);
    await writeFile(join(stage, 'compatibility.json'), json({ version: 1, title: options.title,
      target: options.format, startup: project.startup, issues, sizes }));
    if (packed) {
      const archive = join(stage, 'archive.tmp');
      await zipFolder(stage, archive);
      await rename(archive, output);
      committed = output;
    } else {
      const destination = await mkdtemp(join(folder, `${slugify(options.title)}-${options.format}-`));
      try {
        await rename(stage, destination);
        committed = destination;
      } catch (error) {
        await rm(destination, { recursive: true, force: true });
        throw error;
      }
    }
    return { path: committed, name: basename(committed), bytes: sizes.total, textureBytes, issues };
  } finally {
    if (committed !== stage) await rm(stage, { recursive: true, force: true });
  }
}

export { localChat, localGenerate, localModels } from './localAI.node';
