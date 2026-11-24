import {expect, it} from 'vitest';
import {FlipbookSchema} from '@rewrite/render-pixi/flipbook';
import {importedSheets, BundleManifestSchema, flipbookData, sheetGeometry, stem} from './bundle';

it('validates bundle manifests: relative paths only, unique names per kind, sane animation ranges', () => {
 const ok = BundleManifestSchema.parse({version: 1, textures: [{file: 'bg/sky.png'}], sheets: [{file: 'hero.png', name: 'Hero', frameWidth: 32, frameHeight: 32, animations: {idle: {from: 0, to: 3}, run: {from: 4, to: 7, fps: 16, loop: true}}}], sounds: [{file: 'sfx/jump.wav'}]});
 expect(ok.sheets[0].animations.idle).toEqual({from: 0, to: 3, fps: 12, loop: true});
 expect(stem('sfx/jump.wav')).toBe('jump');
 for (const file of ['../secret.png', '/etc/passwd', 'C:/x.png', 'a\\b.png', 'a//b.png', './a.png']) expect(BundleManifestSchema.safeParse({version: 1, textures: [{file}]}).success, file).toBe(false);
 expect(BundleManifestSchema.safeParse({version: 1}).error?.issues[0].message).toBe('The manifest lists no files');
 expect(BundleManifestSchema.safeParse({version: 1, textures: [{file: 'a/x.png'}, {file: 'b/x.png'}]}).error?.issues[0].message).toMatch('Two images are named "x"');
 expect(BundleManifestSchema.safeParse({version: 1, sheets: [{file: 'h.png', frameWidth: 8, frameHeight: 8, animations: {bad: {from: 3, to: 1}}}]}).success).toBe(false);
 expect(BundleManifestSchema.safeParse({version: 2, textures: [{file: 'x.png'}]}).success).toBe(false);
});

it('derives sheet grids from the image size and builds flipbook data for one named range', () => {
 const entry = BundleManifestSchema.parse({version: 1, sheets: [{file: 'hero.png', frameWidth: 32, frameHeight: 16, animations: {idle: {from: 0, to: 3}, run: {from: 4, to: 7, fps: 20}}}]}).sheets[0];
 const {sheet, errors} = sheetGeometry(entry, {width: 128, height: 32});
 expect(errors).toEqual([]); expect(sheet).toMatchObject({columns: 4, rows: 2, frames: 8});
 const run = flipbookData('11111111-1111-4111-8111-111111111111', sheet!, 'run');
 expect(run).toMatchObject({start: 4, frames: 4, fps: 20, columns: 4, rows: 2, width: 32, height: 16});
 expect(FlipbookSchema.parse(run).start).toBe(4);
 expect(FlipbookSchema.safeParse({...run, start: 5}).success).toBe(false);
 expect(sheetGeometry(entry, {width: 130, height: 32}).errors[0]).toMatch('does not divide');
 expect(sheetGeometry({...entry, animations: {long: {from: 0, to: 9, fps: 12, loop: true}}}, {width: 128, height: 32}).errors[0]).toMatch('ends at frame 9, but the sheet has frames 0–7');
 expect(sheetGeometry(entry, {}).errors[0]).toMatch('size is unknown');
});

it('keeps distinct named grids over the same image on their own asset IDs',()=>{
 const manifest=BundleManifestSchema.parse({version:1,sheets:[{file:'hero.png',name:'Small',frameWidth:16,frameHeight:16},{file:'hero.png',name:'Large',frameWidth:32,frameHeight:32}]});
 const entries=['Small','Large'].map((name,i)=>({kind:'sheet',file:'hero.png',name,asset:{id:`asset${i}`,metadata:{width:64,height:64}}}));
 const sheets=importedSheets(manifest,entries);
 expect(sheets.get('asset0')).toMatchObject({columns:4,rows:4});expect(sheets.get('asset1')).toMatchObject({columns:2,rows:2});
});
