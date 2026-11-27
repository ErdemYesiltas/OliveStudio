import { type Composition, type DirectorStep } from '@olivestudio/engine/aperion-director';
import { z } from 'zod';

export const directorSourceLimit = 16000;
const identifier = z.string().trim().min(1).max(128);
export const directorDefinitionSchema = z.strictObject({
  id: z.string().min(1),
  name: identifier,
  source: z.string().max(directorSourceLimit),
  event: z.string().trim().max(128).default(''),
  whenExpr: z.string().trim().max(1000).default(''),
});
export const directorLibrarySchema = z.array(directorDefinitionSchema).max(32)
  .refine(items => new Set(items.map(({ id }) => id)).size === items.length &&
    new Set(items.map(({ name }) => name)).size === items.length, 'Director composition IDs and names must be unique');

export type DirectorDefinition = z.output<typeof directorDefinitionSchema>;
const documentSchema = z.strictObject({ root: z.looseObject({ type: identifier }), vars: z.record(z.string(), z.unknown()).optional() });

// These templates are also the strategy reference shown in the editor.
export const directorTemplates = {
  sequence: { type: 'sequence', children: [{ type: 'delay', ms: 250 }, { type: 'log', message: 'Sequence completed' }] },
  parallel: { type: 'parallel', children: [{ type: 'delay', ms: 250 }, { type: 'delay', ms: 500 }] },
  delay: { type: 'delay', ms: 500 },
  repeat: { type: 'repeat', count: 3, child: { type: 'delay', ms: 200 } },
  if: { type: 'if', when: '$score >= 100', then: { type: 'log', message: 'Threshold reached' } },
  switch: { type: 'switch', value: '$difficulty', cases: [{ when: 'hard', then: { type: 'delay', ms: 200 } }] },
  race: { type: 'race', children: [{ type: 'waitFor', event: 'round:done' }, { type: 'delay', ms: 1000 }] },
  try: { type: 'try', do: { type: 'delay', ms: 250 }, catch: { type: 'log', message: 'Action failed' } },
  timeout: { type: 'timeout', ms: 1000, do: { type: 'waitFor', event: 'round:done' } },
  waitFor: { type: 'waitFor', event: 'round:done' },
  emit: { type: 'emit', event: 'round:done', payload: { score: 100 } },
  assign: { type: 'assign', name: 'score', value: 100 },
  forEach: { type: 'forEach', over: 'targets', as: 'target', do: { type: 'visibility', target: '$target', visible: true } },
  log: { type: 'log', message: 'Director step' },
  composition: { type: 'composition', name: 'Intro' },
  animation: { type: 'animation', target: 'Animated Sprite', key: 'idle' },
  rigClip: { type: 'rigClip', target: '', clip: '', speed: 1, loop: false },
  audio: { type: 'audio', play: { layer: 'sfx', alias: 'asset-alias' } },
  audioSource: { type: 'audioSource', target: 'object-id', action: 'play' },
  physics: { type: 'physics', target: 'object-id', action: 'impulse', x: 0, y: -10 },
  scene: { type: 'scene', target: 'scene-id', action: 'replace' },
  dialogue: { type: 'dialogue', target: '', action: 'start' },
  particles: { type: 'particles', target: 'object-id' },
  global: { type: 'global', target: 'global-id', value: '1' },
  visibility: { type: 'visibility', target: 'object-id', visible: true },
  camera: { type: 'camera', shake: { intensity: 5, ms: 250 } },
} satisfies Record<string, DirectorStep>;

export function parseDirectorSource(source: string) {
  if (source.length > directorSourceLimit) throw new Error('Director JSON exceeds the size limit');
  const input: unknown = JSON.parse(source);
  const document = documentSchema.parse(input && typeof input === 'object' && 'root' in input ? input : { root: input });
  function check(value: unknown, depth: number) {
    if (depth > 40) throw new Error('Director JSON exceeds the nesting limit');
    if (Array.isArray(value)) {
      for (const item of value) check(item, depth + 1);
    } else if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        if (key === '__proto__' || key === 'prototype' || key === 'constructor') throw new Error('Invalid Director JSON key');
        check(child, depth + 1);
      }
    }
  }
  check(document, 0);
  return document;
}

/** Update real strategy steps while leaving variables and leaf payloads intact. */
export function rewriteDirectorSteps(definition: DirectorDefinition,
  rewrite: (step: DirectorStep) => DirectorStep | undefined): DirectorDefinition {
  let document;
  try { document = parseDirectorSource(definition.source); }
  catch { return definition; }
  let changed = false;
  const empty = { type: 'sequence', children: [] };
  const visit = (value: unknown): unknown => {
    if (!value || typeof value !== 'object' || !('type' in value) || typeof value.type !== 'string') return value;
    const step = value as DirectorStep;
    const next = rewrite(step);
    if (next !== step) { changed = true; return next; }
    switch (step.type) {
      case 'sequence': case 'seq': case 'parallel': case 'par': case 'race': {
        if (!Array.isArray(step.children)) return step;
        const children = step.children.map(visit).filter(child => child !== undefined);
        return step.children.length && !children.length ? undefined : { ...step, children };
      }
      case 'repeat': {
        const child = visit(step.child);
        return child === undefined && step.child !== undefined ? undefined : { ...step, child };
      }
      case 'forEach': case 'try': case 'timeout': {
        const action = visit(step.do);
        if (action === undefined && step.do !== undefined) return;
        return { ...step, do: action, ...(step.type === 'try' ? { catch: visitOptional(step.catch) } :
          step.type === 'timeout' ? { onTimeout: visit(step.onTimeout) } : {}) };
      }
      case 'if': return { ...step, then: visitOptional(step.then), else: visitOptional(step.else), elseIf: visitBranches(step.elseIf) };
      case 'switch': return { ...step, default: visit(step.default), cases: visitBranches(step.cases) };
      default: return step;
    }
  };
  const visitOptional = (value: unknown) => {
    const next = visit(value);
    return next === undefined && value !== undefined ? empty : next;
  };
  const visitBranches = (branches: unknown) => Array.isArray(branches) ? branches.map(branch =>
    branch && typeof branch === 'object' && !Array.isArray(branch) ? { ...branch, then: visitOptional(branch.then) } : branch) : branches;
  const root = visit(document.root) ?? empty;
  if (!changed) return definition;
  const value = document.vars === undefined ? root : { ...document, root };
  const formatted = JSON.stringify(value, null, definition.source.includes('\n') ? 2 : undefined);
  const source = formatted.length <= directorSourceLimit ? formatted : JSON.stringify(value);
  parseDirectorSource(source);
  return { ...definition, source };
}

export function directorComposition(definition: DirectorDefinition): Composition {
  return { ...parseDirectorSource(definition.source), name: definition.name,
    ...(definition.event ? { trigger: {
      event: definition.event, ...(definition.whenExpr ? { whenExpr: definition.whenExpr } : {}),
    } } : {}),
  };
}

export function directorTemplate(key: keyof typeof directorTemplates) {
  return JSON.stringify(directorTemplates[key], null, 2);
}
