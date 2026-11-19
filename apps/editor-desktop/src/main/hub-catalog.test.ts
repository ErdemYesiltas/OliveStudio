import {expect, it} from 'vitest';
import {existsSync, readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ProjectSchema} from '@rewrite/project';

const examples = join(dirname(fileURLToPath(import.meta.url)), '../../../../examples');
const catalog = JSON.parse(readFileSync(join(examples, 'catalog.json'), 'utf8')) as {examples: {id: string; title: string; description: string; tags: string[]; file: string; thumbnail: string}[]};

it('lists twelve examples with unique IDs, a project file and a thumbnail each', () => {
 expect(catalog.examples).toHaveLength(12);
 expect(new Set(catalog.examples.map(e => e.id)).size).toBe(12);
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
