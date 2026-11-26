import { compilePhysics } from '@rewrite/physics';
import { definesMachine } from '@rewrite/behavior/contracts';
import { validateInteractions } from '@rewrite/interactions';
import { defaultMobileApp, parseMobileApp } from '@rewrite/html-export/mobile';
import { defaultWebApp, parseWebApp } from '@rewrite/html-export/webapp';
import { z } from 'zod';
import { objectAsset } from './assetLibrary';
import type { Asset } from './assets';
import { clipList } from './cinematics';
import { t } from './i18n';
import { defaultBuildQuality, testFingerprint, type Project } from './project';
import { configRegistry } from './scene';
import { physicsEntities } from './scenePhysics';
import { networkPlan } from './networkModel';
import { selectionTree } from './selection';
import { worldDiagnostics } from './world';
import { parseGameData } from './gameData';
import { logicCatalog, logicTools } from './sceneLogic';

export const exportFormats = ['html', 'zip', 'pwa', 'capacitor'] as const;
export type ExportLayout = typeof exportFormats[number];
export type ExportTargetInfo = { id: string; layout: ExportLayout; label: string };
export const builtInExportTargets: ExportTargetInfo[] = exportFormats.map(layout => ({ id: layout, layout, label: t(`exportFormat_${layout}`) }));
export const exportOptionsSchema = z.strictObject({
  format: z.string().regex(/^[a-z][a-z0-9-]{0,47}$/),
  title: z.string().trim().min(1).max(80),
  appId: z.string().trim().max(140),
});
export type ExportOptions = z.output<typeof exportOptionsSchema>;
export type ExportIssue = { level: 'error' | 'warning' | 'info'; scope: string; message: string };
const mebibyte = 1024 * 1024;

export function assessBuildBudget(project: Project, assets: ReadonlyMap<string, Pick<Asset, 'kind' | 'bytes'>>, outputBytes?: number, textureBytes?: number) {
  const quality = project.buildQuality ?? defaultBuildQuality;
  const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
  const metrics = {
    entities: project.scenes.reduce((n, scene) => n + selectionTree(scene.objects).size, 0),
    audio: [...assets.values()].reduce((n, asset) => n + (asset.kind === 'audio' ? asset.bytes ?? 0 : 0), 0) / mebibyte,
    output: outputBytes === undefined ? undefined : outputBytes / mebibyte,
    textures: textureBytes === undefined ? undefined : textureBytes / mebibyte,
  };
  const warnings: ExportIssue[] = [];
  const budget = (label: string, value: number | undefined, limit: number) => {
    if (value !== undefined && value > limit) warnings.push({ level: quality.enforce ? 'error' : 'warning',
      scope: t('buildQuality'), message: t('buildBudgetExceeded', { metric: label, actual: number.format(value), limit: number.format(limit) }) });
  };
  budget(t('buildBudgetObjects'), metrics.entities, quality.maxEntities);
  budget(t('buildBudgetAudio'), metrics.audio, quality.audioMB);
  budget(t('buildBudgetTextures'), metrics.textures, quality.textureMB);
  budget(t('buildBudgetOutput'), metrics.output, quality.buildMB);
  return { metrics, warnings };
}

export function initialExportOptions(title: string): ExportOptions {
  const name = title.trim().slice(0, 80) || 'Game';
  return { format: 'html', title: name, appId: defaultMobileApp(name).appId };
}

export function assessExport(project: Project, options: ExportOptions, assets: ReadonlyMap<string, Pick<Asset, 'kind' | 'bytes'>>, layout?: ExportLayout): ExportIssue[] {
  const format = layout ?? builtInExportTargets.find(target => target.id === options.format)?.layout;
  const issues: ExportIssue[] = [];
  const add = (level: ExportIssue['level'], scope: string, message: string) => issues.push({ level, scope, message });
  if (!exportOptionsSchema.safeParse(options).success) add('error', t('exportWindow'), t('exportTitleInvalid'));
  if (!format) add('error', t('exportWindow'), t('exportUnknownTarget'));
  if (format === 'capacitor') {
    for (const error of parseMobileApp({ appId: options.appId, appName: options.title }).errors) add('error', 'Capacitor', error);
    add('info', 'Capacitor', t('exportNativeNote'));
  }
  if (format === 'pwa') {
    for (const error of parseWebApp(defaultWebApp(options.title), options.title).errors) add('error', 'PWA', error);
    add('info', 'PWA', t('exportPwaNote'));
  }
  const network = networkPlan(project);
  for (const problem of network.problems) add('error', t('networkPanel'), problem);
  if (network.rules) add('info', t('networkPanel'), t('networkExportNote'));
  if (network.rules && format === 'capacitor' && !network.settings.endpoint.startsWith('wss://')) {
    add('warning', t('networkPanel'), t('networkMobileEndpoint'));
  }
  const scripts = new Map(project.scripts.items.map(script => [script.id, script]));
  if (project.world) {
    const world = worldDiagnostics(project);
    for (const error of world.invalid) add('error', t('worldMap'), error);
    if (world.unreachable.length) add('info', t('worldMap'), t('worldUnreachable', { names: world.unreachable.map(scene => scene.name).join(', ') }));
  }
  if (project.gameData) {
    try { parseGameData(project, project.gameData); }
    catch (error) { add('error', t('gameData'), error instanceof Error ? error.message : String(error)); }
  }
  const quality = project.buildQuality ?? defaultBuildQuality;
  if (quality.requiredTests.length) {
    const fingerprint = testFingerprint(project);
    for (const id of quality.requiredTests) {
      const scenario = project.tests?.items.find(item => item.id === id);
      if (!scenario || !project.tests?.proofs.some(proof => proof.testId === id && proof.passed && proof.fingerprint === fingerprint)) {
        add(quality.enforce ? 'error' : 'warning', t('buildQuality'), t('missingTestProof', { name: scenario?.name ?? id }));
      }
    }
  }
  const sceneIds = new Set(project.scenes.map(scene => scene.id));
  const globals = new Set(project.globals.items.map(item => item.id));
  for (const record of project.scenes) {
    const tree = selectionTree(record.objects);
    if ([...tree.values()].some(({ node }) => node.logicGraph)) {
      const { triggers, actions } = logicTools(project.content);
      for (const problem of validateInteractions(logicCatalog(project, record.objects), triggers, actions)) add('error', record.name, problem);
    }
    const checkScript = (id: string | undefined, owner: string) => {
      if (!id) return;
      const script = scripts.get(id);
      if (!script) add('error', owner, t('exportMissingScript'));
      else if (!script.code || script.error) add('error', owner, script.error ?? t('exportMissingScriptCode'));
    };
    checkScript(project.scripts.scenes?.[record.id]?.scriptId, record.name);
    for (const { node } of tree.values()) {
      const scope = `${record.name} / ${node.label}`;
      const alias = objectAsset(node);
      if (alias) {
        const type = node.type === 'Spine' ? 'spine' : node.type === 'AnimatedSprite' ? 'sheet' : node.type === 'AudioSource' ? 'audio' : 'image';
        const asset = assets.get(alias);
        if (!asset || asset.kind !== type) add('error', scope, t('exportMissingAsset', { alias, type }));
      }
      checkScript(node.behaviour?.scriptId, scope);
      if (node.behavior?.scriptId) {
        checkScript(node.behavior.scriptId, scope);
        const script = scripts.get(node.behavior.scriptId);
        if (script && !definesMachine(script.source)) add('error', scope, t('behavior.noMachine'));
      }
      if (node.logicGraph?.nodes.some(node => node.kind !== 'event' && node.kind !== 'action' && node.kind !== 'branch' && node.kind !== 'delay')) {
        add('error', scope, t('exportUnsupportedLogic'));
      }
    }
    const { errors } = compilePhysics(physicsEntities(record.objects, () => undefined));
    for (const error of errors) add('error', record.name, error);
    const clips = clipList(record, t('timelineMainClip'));
    const clipIds = new Set(clips.map(clip => clip.id));
    for (const clip of clips) {
      for (const track of clip.tracks) {
        if (!tree.has(track.target)) add('warning', `${record.name} / ${clip.name}`, t('exportTimelineTarget'));
      }
      for (const cue of clip.cues) {
        if (!('target' in cue)) continue;
        const available = cue.kind === 'scene' ? sceneIds : cue.kind === 'clip' ? clipIds :
          cue.kind === 'global' ? globals : tree;
        if (!available.has(cue.target)) add('warning', `${record.name} / ${cue.name}`, t('exportCueTarget'));
      }
    }
    if (!record.cinematics?.autoplay && clips.some(clip => clip.tracks.length || clip.cues.length)) {
      add('info', record.name, t('exportTimelineInactive'));
    }
  }
  for (const device of ['desktop', 'mobile', 'tablet'] as const) {
    for (const orientation of ['landscape', 'portrait'] as const) {
      const { width, height, resolution } = configRegistry.forPreview(project.config, device, orientation).renderer;
      if (Math.max(width, height) * resolution > 4096) {
        add('warning', `${device} / ${orientation}`, t('exportLargeCanvas'));
      }
    }
  }
  return [...issues, ...assessBuildBudget(project, assets).warnings];
}
