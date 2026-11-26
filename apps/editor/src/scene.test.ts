import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { localize, resolveLocale } from '../locales/catalog.mjs';
import { readManifest } from './assets';
import { configRegistry, moveObject, sampleScene, sceneSchema, validationMessage } from './scene';

describe('prototype scene configuration', () => {
  it('resolves defaults and validates registered constructor options by path', () => {
    expect(configRegistry.resolve({ audio: { volume: 0.35 } })).toEqual({
      renderer: { width: 960, height: 540, scaleMode: 'FIT', background: '#171c25', resolution: 1, maxFPS: 0 },
      audio: { volume: 0.35, muted: false, music: 1, sfx: 1, ui: 1 },
    });
    const result = sceneSchema.safeParse({ version: 1, objects: [], config: { audio: { volume: 2, bad: true } } });
    expect(result.success).toBe(false);
    const message = validationMessage(result.error);
    expect(message).toContain('config.audio.volume');
    expect(message).toContain('config.audio.bad');
  });

  it('applies orientation and device overrides while keeping legacy options as defaults', () => {
    const scene = sceneSchema.parse({ version: 1, objects: [], config: {
      renderer: { width: 1200, background: '#132433' },
      profiles: {
        common: { portrait: { renderer: { width: 720, height: 1280 } } },
        mobile: { renderer: { width: 600 }, portrait: { renderer: { scaleMode: 'ENVELOP' } } },
        tablet: { renderer: { resolution: 2 }, landscape: { renderer: { width: 1024 } } },
      },
    } });
    expect(configRegistry.forPreview(scene.config, 'mobile', 'portrait').renderer)
      .toMatchObject({ width: 600, height: 1280, scaleMode: 'ENVELOP', background: '#132433' });
    expect(configRegistry.forPreview(scene.config, 'desktop', 'portrait').renderer)
      .toMatchObject({ width: 720, height: 1280, scaleMode: 'FIT' });
    expect(configRegistry.forPreview(scene.config, 'tablet', 'landscape').renderer)
      .toMatchObject({ width: 1024, height: 540, resolution: 2 });
    expect(configRegistry.forPreview(scene.config, 'tablet', 'portrait').renderer)
      .toMatchObject({ width: 720, height: 1280, resolution: 2 });
  });

  it('accepts a new extension’s schema without changing existing config, and rejects duplicate keys', () => {
    const schema = z.strictObject({ active: z.boolean().default(true) }).prefault({});
    const extended = configRegistry.register('testExtension', schema);
    expect(extended.resolve({}).testExtension).toEqual({ active: true });
    expect(() => configRegistry.resolve({ testExtension: {} })).toThrow();
    const duplicate: string = 'testExtension';
    expect(() => extended.register(duplicate, schema)).toThrow('Config section already registered');
  });

  it('validates versions, types and duplicate IDs and round-trips the scene', () => {
    expect(sceneSchema.parse(JSON.parse(JSON.stringify(sampleScene)))).toEqual(sampleScene);
    expect(sceneSchema.safeParse({ ...sampleScene, version: 2 }).success).toBe(false);
    expect(sceneSchema.safeParse({ version: 1, objects: [{ type: 'Mesh', id: 'm', label: 'Mesh' }] }).success).toBe(false);
    const duplicate = sceneSchema.safeParse({
      ...sampleScene, objects: [...sampleScene.objects, { type: 'Sprite', id: 'sample-sprite', label: 'Duplicate' }],
    });
    expect(validationMessage(duplicate.error)).toContain('objects.1.id');
  });
});

describe('AssetPack manifest', () => {
  it('encodes output paths independently of the persistent alias and rejects traversal', () => {
    const manifest = { bundles: [{ name: 'images', assets: [{ alias: ['images/doku #1.png'], src: ['images/doku #1.png'] }] }] };
    expect(readManifest(manifest, '/tools/assetpack/')[0].assets[0]).toEqual({
      alias: 'images/doku #1.png', path: 'images/doku #1.png',
      url: '/tools/assetpack/images/doku%20%231.png', kind: 'image',
    });
    expect(() => readManifest({ bundles: [{ name: 'default', assets: [{ alias: ['x.png'], src: ['../x.png'] }] }] }, '/')).toThrow();
  });
});

describe('localization', () => {
  it('resolves regional preferences to available languages and falls back to English', () => {
    expect(resolveLocale(['en-GB'])).toBe('en');
    expect(resolveLocale(['tr-TR', 'fr'])).toBe('en');
    expect(localize(['tr']).t('addObject', { type: 'Sprite' })).toBe('Add Sprite');
  });
});

describe('scene hierarchy', () => {
  it('rejects cycles and no-ops and preserves local transforms across parents', () => {
    const { objects } = sceneSchema.parse({
      version: 1,
      objects: [{ type: 'Container', label: 'Parent', id: 'parent', children: [
        { type: 'Container', label: 'Child', id: 'child', position: { x: 12, y: 34 } },
      ] }],
    });
    expect(moveObject(objects, 'parent', { id: 'child', placement: 'inside' })).toBe(objects);
    expect(moveObject(objects, 'child', { id: 'parent', placement: 'inside' })).toBe(objects);
    const moved = moveObject(objects, 'child', { id: null, placement: 'inside' });
    expect(moved.map(node => node.id)).toEqual(['parent', 'child']);
    expect(moved[1].position).toEqual({ x: 12, y: 34 });
    expect(moved[0]).toMatchObject({ children: [] });
    expect(objects[0]).toMatchObject({ children: [{ id: 'child' }] });
  });
});
