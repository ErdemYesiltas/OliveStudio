import {expect, it} from 'vitest';
import {existsSync, readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {assert2DProject,ProjectSchema} from '@rewrite/project';

const examples = join(dirname(fileURLToPath(import.meta.url)), '../../../../examples');
const catalog = JSON.parse(readFileSync(join(examples, 'catalog.json'), 'utf8')) as {examples: {id: string; title: string; description: string; tags: string[]; file: string; thumbnail: string; category?: string; origin?: string}[]};

it('lists twelve OliveStudio examples, with unique IDs, a project file and a thumbnail each', () => {
 expect(catalog.examples).toHaveLength(12);
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

it('ships only the 2D example projects', () => {
 expect(catalog.examples.every(e => !e.category && !e.id.startsWith('pixi3d-'))).toBe(true);
 for(const entry of catalog.examples){
  const project=ProjectSchema.parse(JSON.parse(readFileSync(join(examples,entry.file),'utf8')));
  expect(()=>assert2DProject(project)).not.toThrow();
 }
});
