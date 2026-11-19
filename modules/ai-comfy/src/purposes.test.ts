import {describe, expect, it} from 'vitest';
import {imageToImage, textToAudio, textToImage, workflowNeeds} from './contracts';
import {fits, purposeById, purposeFor, purposes, purposesOf, sizeFor, sizePresets} from './purposes';

const video = workflowNeeds({'1': {class_type: 'CLIPTextEncode', inputs: {text: 'a cat', clip: ['9', 0]}}, '2': {class_type: 'LoadImage', inputs: {image: 'x.png'}}, '3': {class_type: 'WanImageToVideo', inputs: {positive: ['1', 0], length: 33, start_image: ['2', 0]}}, '4': {class_type: 'KSampler', inputs: {seed: 1, steps: 20, cfg: 5, positive: ['3', 0], negative: ['1', 0], latent_image: ['3', 2]}}, '7': {class_type: 'SaveVideo', inputs: {video: ['4', 0]}}});
const song = {...workflowNeeds(textToAudio()), lyrics: true};

describe('Generate purposes', () => {
 it('every area has purposes and every purpose has a unique id', () => {
  expect(new Set(purposes.map(p => p.id)).size).toBe(purposes.length);
  expect(purposesOf('image').map(p => p.id)).toEqual(['image.sprite', 'image.background', 'image.icon', 'image.texture', 'image.edit', 'image.sheet', 'image.frames']);
  expect(purposesOf('audio')).toHaveLength(4); expect(purposesOf('video')).toHaveLength(3);
 });
 it('matches workflows to purposes', () => {
  const t2i = workflowNeeds(textToImage()), i2i = workflowNeeds(imageToImage()), audio = workflowNeeds(textToAudio());
  expect(fits(purposeById('image.sprite'), t2i)).toBe(true); expect(fits(purposeById('image.sprite'), i2i)).toBe(false);
  expect(fits(purposeById('image.edit'), i2i)).toBe(true); expect(fits(purposeById('image.frames'), i2i)).toBe(true); expect(fits(purposeById('image.sheet'), t2i)).toBe(true);
  expect(fits(purposeById('audio.sfx'), audio)).toBe(true); expect(fits(purposeById('audio.song'), audio)).toBe(false); expect(fits(purposeById('audio.song'), song)).toBe(true);
  expect(fits(purposeById('video.sprite'), video)).toBe(true); expect(fits(purposeById('video.selection'), video)).toBe(true); expect(fits(purposeById('image.sprite'), video)).toBe(false);
 });
 it('a workflow opens the purpose it fits, keeping the current one when it fits', () => {
  expect(purposeFor(workflowNeeds(textToImage()), purposeById('image.background')).id).toBe('image.background');
  expect(purposeFor(workflowNeeds(textToAudio()), purposeById('image.sprite')).id).toBe('audio.sfx');
  expect(purposeFor(song, purposeById('audio.music')).id).toBe('audio.music');
  expect(purposeFor(video, purposeById('image.sprite')).id).toBe('video.sprite');
  expect(purposeFor(workflowNeeds(imageToImage()), purposeById('image.sprite')).id).toBe('image.edit');
 });
 it('sizes keep about the native pixel count in steps of 16', () => {
  expect(sizeFor([1, 1], 512)).toEqual({width: 512, height: 512});
  expect(sizeFor([16, 9], 1024)).toEqual({width: 1360, height: 768});
  expect(sizePresets(purposeById('image.background'), 512).map(p => `${p.label} ${p.width}x${p.height}`)).toEqual(['16:9 688x384', '9:16 384x688', '4:3 592x448', '21:9 784x336']);
  for (const p of purposes) for (const s of sizePresets(p, 1024)) { expect(s.width % 8).toBe(0); expect(s.height % 8).toBe(0); }
 });
});
