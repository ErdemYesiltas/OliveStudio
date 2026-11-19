import {expect, it} from 'vitest';
import {atlasCandidates, packAtlas} from './atlas.node';
import {guideTargets, snapToGuides} from '@rewrite/render-pixi/guides';

it('packs without overlap inside pages, keeps a gutter and splits pages when full', () => {
 const items = Array.from({length: 30}, (_, i) => ({id: `t${i}`, width: 100 + (i % 5) * 37, height: 60 + (i % 7) * 23}));
 const layout = packAtlas(items, 512, 2), frames = Object.entries(layout.frames);
 expect(frames).toHaveLength(30);
 expect(layout.pages.length).toBeGreaterThan(1);
 for (const [id, f] of frames) {
  const page = layout.pages[f.page];
  expect(f.x).toBeGreaterThanOrEqual(2); expect(f.y).toBeGreaterThanOrEqual(2);
  expect(f.x + f.width + 2).toBeLessThanOrEqual(page.width); expect(f.y + f.height + 2).toBeLessThanOrEqual(page.height);
  for (const [other, g] of frames) if (other !== id && g.page === f.page) expect(f.x + f.width + 2 <= g.x - 2 || g.x + g.width + 2 <= f.x - 2 || f.y + f.height + 2 <= g.y - 2 || g.y + g.height + 2 <= f.y - 2).toBe(true);
 }
 expect(packAtlas([{id: 'huge', width: 600, height: 10}], 512).frames).toEqual({});
});

it('only sprite-only textures of a sane size are atlas candidates', () => {
 const scene = (types: [string, string][]) => ({entities: [{components: types.map(([type, assetId]) => ({type, data: {assetId}}))}]});
 const tex = (id: string, size = 64) => ({id, type: 'pixi.texture', metadata: {width: size, height: size}});
 const got = atlasCandidates([scene([['pixi.sprite', 'a'], ['pixi.sprite', 'b'], ['pixi.tilingSprite', 'b'], ['pixi.sprite', 'big']])], [tex('a'), tex('b'), tex('big', 2048), tex('unused')]);
 expect(got.map(g => g.id)).toEqual(['a']);
});

it('smart guides snap the nearest edge or centre within the threshold', () => {
 const targets = guideTargets([{x: 100, y: 100, width: 50, height: 50}], {width: 960, height: 540});
 expect(targets.x).toEqual(expect.arrayContaining([100, 125, 150, 0, 480, 960]));
 const hit = snapToGuides({x: 203, y: 97, width: 50, height: 20}, targets, 6);
 expect(hit).toMatchObject({dx: 0, dy: 3});
 expect(hit.guides).toEqual([{axis: 'y', value: 100}]);
 expect(snapToGuides({x: 452, y: 300, width: 60, height: 10}, targets, 6)).toMatchObject({dx: -2, guides: [{axis: 'x', value: 480}]});
});
