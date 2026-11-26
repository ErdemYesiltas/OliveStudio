import { scaleModes } from '@olivestudio/engine/scale-layout';
import { z } from 'zod';
import { t, type MessageKey } from './i18n';

export const devices = ['common', 'desktop', 'mobile', 'tablet'] as const;
export const orientations = ['landscape', 'portrait'] as const;
export type Device = typeof devices[number];
export type Orientation = typeof orientations[number];

export type SettingField = { key: string; label: MessageKey; description?: MessageKey; category?: MessageKey; orientation?: boolean } & (
  { kind: 'number'; min: number; max: number; step?: number } |
  { kind: 'color' } | { kind: 'select'; choices: readonly string[] } | { kind: 'boolean' }
);
export type ModuleSettings = { label: MessageKey; fields: readonly SettingField[] };

type Schemas = Record<string, z.ZodType>;
type Overrides = Record<string, Record<string, unknown> | undefined>;
type OrientationOverrides = Partial<Record<Orientation, Overrides>>;
type Profiles = { common?: OrientationOverrides } & Partial<Record<Exclude<Device, 'common'>, Overrides & OrientationOverrides>>;
export class ConfigRegistry<Sections extends Schemas = Record<never, never>> {
  constructor(private readonly schemas: Sections, readonly settings: Record<string, ModuleSettings> = {}) {}

  register<Key extends string, Schema extends z.ZodType>(
    key: Key extends keyof Sections ? never : Key,
    schema: Schema,
    settings?: ModuleSettings,
  ): ConfigRegistry<Sections & Record<Key, Schema>> {
    if (Object.hasOwn(this.schemas, key)) throw new Error(t('duplicateConfig', { key }));
    return new ConfigRegistry({ ...this.schemas, [key]: schema } as Sections & Record<Key, Schema>,
      settings ? { ...this.settings, [key]: settings } : this.settings);
  }

  get schema() {
    return z.strictObject(this.schemas);
  }

  get profiles() {
    const modules = Object.fromEntries(Object.entries(this.schemas).flatMap(([key, registered]) => {
      // The overrides use the original field validators and omit their defaults.
      const inner = registered instanceof z.ZodObject ? registered :
        registered instanceof z.ZodPrefault ? registered.unwrap() : undefined;
      if (!(inner instanceof z.ZodObject)) return [];
      const optional = Object.fromEntries(Object.entries(inner.shape).map(([name, rule]) => {
        const validator = rule as z.ZodType;
        return [name, ((validator instanceof z.ZodDefault ? validator.unwrap() : validator) as z.ZodType).optional()];
      }));
      return [[key, optional]] as const;
    }));
    const orientationLayer = z.strictObject(Object.fromEntries(Object.entries(modules).flatMap(([key, fields]) => {
      const keys = this.settings[key]?.fields.filter(field => field.orientation).map(field => field.key) ?? [];
      return keys.length ? [[key, z.strictObject(Object.fromEntries(keys.map(name => [name, fields[name]]))).optional()]] : [];
    }))) as z.ZodType<Overrides>;
    const deviceLayer = z.strictObject({
      ...Object.fromEntries(Object.entries(modules).map(([key, fields]) => [key, z.strictObject(fields).optional()])),
      landscape: orientationLayer.optional(), portrait: orientationLayer.optional(),
    }) as z.ZodType<Overrides & Partial<Record<Orientation, Overrides>>>;
    const common = z.strictObject({ landscape: orientationLayer.optional(), portrait: orientationLayer.optional() });
    return z.strictObject({
      common: common.optional(), desktop: deviceLayer.optional(), mobile: deviceLayer.optional(), tablet: deviceLayer.optional(),
    });
  }

  resolve(input: unknown) {
    return this.schema.parse(input);
  }

  forPreview(config: z.output<z.ZodObject<Sections>> & { profiles?: Profiles },
    device: Device, orientation?: Orientation) {
    const { profiles, ...base } = config;
    const common = base as Overrides;
    const chosen = device === 'common' ? undefined : profiles?.[device];
    const layers = [orientation && profiles?.common?.[orientation], chosen, orientation && chosen?.[orientation]];
    const resolved = Object.fromEntries(Object.keys(this.schemas).map(key => [
      key, Object.assign({}, common[key], ...layers.map(layer => layer && layer[key])),
    ]));
    return this.resolve(resolved);
  }
}

export const rendererOptions = z.strictObject({
  width: z.number().int().min(1).max(4096).default(960),
  height: z.number().int().min(1).max(4096).default(540),
  scaleMode: z.enum(scaleModes).default('FIT'),
  background: z.string().regex(/^#[\da-f]{6}$/i).default('#171c25'),
  resolution: z.number().min(0.5).max(3).default(1),
  maxFPS: z.number().int().min(0).max(240).default(0),
}).prefault({});

export const rendererSettings = {
  label: 'pixiSettings',
  fields: [
    { key: 'width', category: 'settingsDisplay', description: 'settingsWidthDescription', label: 'width', kind: 'number', min: 1, max: 4096, orientation: true },
    { key: 'height', category: 'settingsDisplay', description: 'settingsHeightDescription', label: 'height', kind: 'number', min: 1, max: 4096, orientation: true },
    { key: 'scaleMode', category: 'settingsDisplay', description: 'settingsScaleDescription', label: 'settingsScaleMode', kind: 'select', choices: scaleModes, orientation: true },
    { key: 'background', category: 'settingsRendering', description: 'settingsBackgroundDescription', label: 'settingsBackground', kind: 'color' },
    { key: 'resolution', category: 'settingsRendering', description: 'settingsResolutionDescription', label: 'settingsResolution', kind: 'number', min: 0.5, max: 3, step: 0.25 },
    { key: 'maxFPS', category: 'settingsRendering', description: 'settingsMaxFpsDescription', label: 'settingsMaxFps', kind: 'number', min: 0, max: 240 },
  ],
} as const satisfies ModuleSettings;
