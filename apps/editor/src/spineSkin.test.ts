import { AtlasAttachmentLoader, Skeleton, SkeletonJson, TextureAtlas } from '@esotericsoftware/spine-core';
import { expect, it } from 'vitest';
import { applySpineSkins } from '@olivestudio/engine/spine';

it('combines skin memberships and preserves attachment identity with last-layer priority', () => {
  const atlas = new TextureAtlas('');
  const data = new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData({
    skeleton: { spine: '4.2.120' },
    bones: [{ name: 'root' }, { name: 'accessory', parent: 'root', skin: true }],
    slots: [{ name: 'head', bone: 'root', attachment: 'visible' }, { name: 'coat', bone: 'root', attachment: 'visible' }],
    skins: [
      { name: 'default', attachments: {
        head: { visible: { type: 'point', x: 1 } }, coat: { visible: { type: 'point', x: 2 } },
      } },
      { name: 'hood', attachments: { head: { visible: { type: 'point', x: 3 } } } },
      { name: 'helmet', bones: ['accessory'], attachments: { head: { visible: { type: 'point', x: 4 } } } },
    ],
  });
  atlas.dispose();
  const rig = new Skeleton(data);
  applySpineSkins(rig, null, ['hood', 'helmet', 'missing', 'helmet']);
  expect(rig.slots[0].getAttachment()).toBe(data.findSkin('helmet')?.getAttachment(0, 'visible'));
  expect(rig.slots[1].getAttachment()).toBe(data.defaultSkin?.getAttachment(1, 'visible'));
  expect(rig.bones[1].active).toBe(true);
  applySpineSkins(rig, null, ['helmet', 'hood']);
  expect(rig.slots[0].getAttachment()).toBe(data.findSkin('hood')?.getAttachment(0, 'visible'));
  applySpineSkins(rig, null);
  expect(rig.slots[0].getAttachment()).toBe(data.defaultSkin?.getAttachment(0, 'visible'));
  expect(rig.bones[1].active).toBe(false);
});
