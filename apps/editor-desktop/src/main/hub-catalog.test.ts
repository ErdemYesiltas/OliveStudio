import {expect, it} from 'vitest';
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ProjectSchema} from '@rewrite/project';

const examples = join(dirname(fileURLToPath(import.meta.url)), '../../../../examples');
const catalog = JSON.parse(readFileSync(join(examples, 'catalog.json'), 'utf8')) as {examples: {id: string; title: string; description: string; tags: string[]; file: string; thumbnail: string; category?: string; origin?: string}[]};

it('lists twelve OliveStudio examples and the PixiJS 3D ones, with unique IDs, a project file and a thumbnail each', () => {
 expect(catalog.examples.filter(e => !e.category)).toHaveLength(12);
 expect(new Set(catalog.examples.map(e => e.id)).size).toBe(catalog.examples.length);
 for (const e of catalog.examples) {
  expect(e.title && e.description && e.tags.length).toBeTruthy();
  expect(existsSync(join(examples, e.file))).toBe(true);
  expect(readFileSync(join(examples, e.thumbnail)).subarray(1, 4).toString()).toBe('PNG');
 }
});

it('ships projects that pass the project schema, start in an existing scene and have compiled scripts', () => {
 for (const e of catalog.examples) {
  const project = ProjectSchema.parse(JSON.parse(readFileSync(join(examples, e.file), 'utf8')));
  expect(project.scenes.some(s => s.id === project.entrySceneId)).toBe(true);
  const library = project.extensions['scripts.library'] as {items: {name: string; code: string; error?: string}[]} | undefined;
  for (const script of library?.items ?? []) { expect(script.error, `${e.title} / ${script.name}`).toBeUndefined(); expect(script.code.length).toBeGreaterThan(0); }
 }
});

it('ships PixiJS 3D examples under a category, linked to their original, with every texture source beside the project', () => {
 const pixi3d = catalog.examples.filter(e => e.category);
 expect(pixi3d.length).toBeGreaterThanOrEqual(7);
 for (const e of pixi3d) {
  expect(e.id.startsWith('pixi3d-') && e.tags.includes('PixiJS 3D') && e.tags.includes(e.category!)).toBe(true);
  expect(e.origin).toMatch(/^https:\/\/pixijs\.com\/3d\/examples\?example=/);
  const project = ProjectSchema.parse(JSON.parse(readFileSync(join(examples, e.file), 'utf8')));
  const items = (project.extensions['assets.registry'] as {items: {id: string; revision: string; source: {extension: string}}[]}).items;
  for (const a of items) expect(existsSync(join(examples, `${e.file}.assets`, 'sources', `${a.id}-${a.revision}.${a.source.extension}`)), `${e.title} / ${a.id}`).toBe(true);
 }
});

it('lists every generated PixiJS 3D example folder in the catalog', () => {
 const listed = new Set(catalog.examples.map(e => e.id));
 expect(readdirSync(examples).filter(name => name.startsWith('pixi3d-') && !listed.has(name))).toEqual([]);
});
