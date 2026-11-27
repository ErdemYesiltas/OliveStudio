import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { localize } from '../apps/editor/locales/catalog.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(join(root, 'apps/editor/package.json'));
const { AnimationState, AnimationStateData, Physics, Skeleton, TextureAtlas } =
  require('@esotericsoftware/spine-core');
const { convertSpineBinary, exportSpineBinary, exportSpineProject, findSpineLauncher, importAssets, readSpineSkeleton } =
  require('./dist/asset-import.cjs');
const { t } = localize(['en']);

function loadRig(asset) {
  const atlasFile = asset.media.files.find(file => file.name.endsWith('.atlas'));
  assert.ok(atlasFile, 'Expected a Spine atlas');
  const atlas = new TextureAtlas(Buffer.from(atlasFile.data, 'base64').toString('utf8'));
  const pages = new Set(asset.media.files.map(file => file.name));
  for (const page of atlas.pages) assert.ok(pages.has(page.name), `Missing atlas page ${page.name}`);
  const bytes = Buffer.from(asset.data, 'base64');
  const data = readSpineSkeleton(/\.skel$/i.test(asset.alias) ? '.skel' : '.json', bytes, atlas);
  return { data, dispose: () => atlas.dispose() };
}

function colorChannels(color) {
  return color ? [color.r, color.g, color.b, color.a] : null;
}

function pose(data, clip, skin, time) {
  const skeleton = new Skeleton(data);
  if (skin) skeleton.setSkinByName(skin);
  skeleton.setSlotsToSetupPose();
  const events = [];
  if (clip !== null) {
    const state = new AnimationState(new AnimationStateData(data));
    state.setAnimation(0, clip, false);
    state.update(time);
    state.addListener({ event: (_entry, event) => events.push({
      name: event.data.name,
      time: event.time,
      int: event.intValue,
      float: event.floatValue,
      text: event.stringValue ?? '',
      audio: event.data.audioPath || null,
      volume: event.volume,
      balance: event.balance,
    }) });
    state.apply(skeleton);
  }
  skeleton.updateWorldTransform(Physics.none);
  return {
    events,
    drawOrder: skeleton.drawOrder.map(slot => slot.data.name),
    bones: new Map(skeleton.bones.map(bone => [bone.data.name, [bone.worldX, bone.worldY, bone.a, bone.b, bone.c, bone.d]])),
    slots: new Map(skeleton.slots.map(slot => [slot.data.name, {
      name: slot.getAttachment()?.name,
      tint: colorChannels(slot.color),
      darkTint: colorChannels(slot.darkColor)?.slice(0, 3) ?? null,
      attachmentTint: colorChannels(slot.getAttachment()?.color),
      sequenceIndex: slot.sequenceIndex,
      deform: Array.from(slot.deform),
    }])),
  };
}

function near(left, right, tolerance, label) {
  assert.ok(Math.abs(left - right) <= tolerance, `${label}: ${left} versus ${right} (tolerance ${tolerance})`);
}

function comparePose(expected, actual, label) {
  assert.equal(actual.events.length, expected.events.length, `${label} / event count`);
  for (const [index, event] of expected.events.entries()) {
    const measured = actual.events[index];
    const eventLabel = `${label} / event ${index} (${event.name})`;
    for (const field of ['name', 'int', 'text', 'audio']) {
      assert.equal(measured[field], event[field], `${eventLabel} / ${field}`);
    }
    for (const field of ['time', 'float', ...(event.audio ? ['volume', 'balance'] : [])]) {
      near(event[field], measured[field], 0.0001, `${eventLabel} / ${field}`);
    }
  }
  assert.deepEqual(actual.drawOrder, expected.drawOrder, `${label} / draw order`);
  for (const [name, transform] of expected.bones) {
    const measured = actual.bones.get(name);
    assert.ok(measured, `${label}: missing bone ${name}`);
    // Rounded JSON keys accumulate through parent transforms. Allow a quarter pixel of pose error.
    transform.forEach((value, index) => near(value, measured[index], index < 2 ? 0.25 : 0.003,
      `${label} / ${name} / transform ${index}`));
  }
  for (const [name, slot] of expected.slots) {
    const measured = actual.slots.get(name);
    assert.equal(measured?.name, slot.name, `${label} / ${name} attachment`);
    assert.equal(measured.sequenceIndex, slot.sequenceIndex, `${label} / ${name} sequence`);
    for (const field of ['tint', 'darkTint', 'attachmentTint']) {
      const tintLabel = `${label} / ${name} / ${field}`;
      assert.equal(measured[field]?.length, slot[field]?.length, tintLabel);
      // Binary stores eight bits per channel. Allow one channel step after animation interpolation.
      slot[field]?.forEach((value, index) => near(value, measured[field][index], 1 / 255 + 0.00001,
        `${tintLabel} / channel ${index}`));
    }
    assert.equal(measured?.deform.length, slot.deform.length, `${label} / ${name} deform length`);
    slot.deform.forEach((value, index) => near(value, measured.deform[index], 0.01,
      `${label} / ${name} / deform ${index}`));
  }
}

function compareRigs(expected, asset, label) {
  const { data, dispose } = loadRig(asset);
  try {
    for (const group of ['bones', 'slots', 'skins', 'animations', 'events', 'ikConstraints', 'transformConstraints', 'pathConstraints', 'physicsConstraints']) {
      const names = rig => rig[group].map(item => item.name).sort();
      assert.deepEqual(names(data), names(expected), `${label}: ${group}`);
    }
    for (const skin of expected.skins) {
      const attachments = entries => entries.map(({ name, attachment }) => {
        const { sequence } = attachment;
        return [name, attachment.path ?? null, sequence ? {
          start: sequence.start, digits: sequence.digits, setup: sequence.setupIndex,
          regions: sequence.regions.map(region => region.name),
        } : null];
      }).sort(
        ([left], [right]) => left.localeCompare(right));
      for (const slot of expected.slots) {
        const before = [], after = [];
        skin.getAttachmentsForSlot(slot.index, before);
        data.findSkin(skin.name).getAttachmentsForSlot(data.findSlot(slot.name).index, after);
        assert.deepEqual(attachments(after), attachments(before), `${label}: ${skin.name} / ${slot.name}`);
      }
    }
    const skins = expected.skins.length ? expected.skins.map(skin => skin.name) : [null];
    for (const skin of skins) comparePose(pose(expected, null, skin, 0), pose(data, null, skin, 0),
      `${label} / ${skin ?? 'default'} / setup pose`);
    for (const clip of expected.animations) {
      const actualClip = data.findAnimation(clip.name);
      near(clip.duration, actualClip.duration, 0.0001, `${label} / ${clip.name} duration`);
      for (const skin of skins) {
        // Interior sample points avoid common frame boundaries where export rounding can change a discrete key.
        for (const point of [0, 0.237, 0.519, 0.781, 1]) {
          const time = clip.duration * point;
          comparePose(pose(expected, clip.name, skin, time), pose(data, clip.name, skin, actualClip.duration * point),
            `${label} / ${skin ?? 'setup'} / ${clip.name} at ${time}s`);
        }
      }
    }
  } finally { dispose(); }
}

function compareAudio(original, converted, label) {
  const tracks = asset => (asset.media.audio ?? []).map(({ path, data }) => [path, data])
    .sort(([left], [right]) => left.localeCompare(right));
  assert.deepEqual(tracks(converted), tracks(original), `${label}: embedded event audio`);
}

async function defaultFixture(work) {
  const source = join(root, 'modules/spine/testdata');
  const path = join(work, 'rig.json');
  const rig = JSON.parse(await readFile(join(source, 'rig.json'), 'utf8'));
  const warmSkin = rig.skins.find(skin => skin.name === 'warm');
  warmSkin.attachments['tile-slot'] = { 'tile-warm': warmSkin.attachments['tile-slot'].tile };
  const tile = rig.skins.find(skin => skin.name === 'default').attachments['tile-slot'].tile;
  tile.sequence = { count: 3, start: 1, digits: 2, setup: 1 };
  rig.animations.sway.attachments = { default: { 'tile-slot': { tile: { sequence: [
    { mode: 'loop', index: 0, delay: 0.18 }, { time: 0.8, mode: 'pingpongReverse', index: 2, delay: 0.14 },
  ] } } } };
  rig.skeleton.audio = './audio/';
  Object.assign(rig.events.ping, { audio: 'chime.wav', volume: 0.75, balance: -0.25 });
  await mkdir(join(work, 'audio'));
  const atlas = (await readFile(join(source, 'rig.atlas'), 'utf8'))
    .replace('size: 64,64', 'size: 48,48').replace('bounds: 0,0,64,64', 'bounds: 0,0,48,48');
  await Promise.all([
    writeFile(path, JSON.stringify(rig)),
    writeFile(join(work, 'rig.atlas'), atlas + [1, 2, 3].map(index => `tile0${index}\nbounds: 0,0,48,48\n`).join('')),
    writeFile(join(work, 'rig.png'), await readFile(join(root, 'apps/editor/raw-assets/images{m}/olive-crystal.png'))),
    writeFile(join(work, 'audio/chime.wav'), await readFile(join(root, 'apps/editor/raw-assets/sounds{m}/chime.wav'))),
  ]);
  return path;
}

const launcher = await findSpineLauncher();
if (!launcher) throw new Error('Spine CLI verification requires an activated Spine 4.2 launcher. Install Spine or set OLIVESTUDIO_SPINE_EXECUTABLE.');
const scratch = await mkdtemp(join(tmpdir(), 'olive-spine-cli-roundtrip-'));
try {
  const fixture = process.argv[2] ? resolve(process.argv[2]) : await defaultFixture(scratch);
  assert.ok(/\.json$/i.test(fixture), 'Select a Spine 4.2 JSON rig with its atlas and pages.');
  const [original] = await importAssets([fixture], t, launcher);
  if (!process.argv[2]) assert.equal(original.media.audio?.[0]?.path, 'chime.wav', 'Expected fixture event audio');
  const expected = loadRig(original);
  const stem = basename(original.media.files.find(file => file.name.endsWith('.atlas')).name, '.atlas');
  try {
    const binaryPath = await exportSpineBinary(scratch, original, t, launcher);
    const [binary] = await importAssets([join(binaryPath, stem + '.skel')], t, launcher);
    compareRigs(expected.data, binary, 'JSON → .skel');
    compareAudio(original, binary, 'JSON → .skel');
    compareRigs(expected.data, { ...original, data: await convertSpineBinary(binary, t, launcher) }, '.skel → JSON');
    for (const [asset, format] of [[original, 'JSON'], [binary, '.skel']]) {
      const projectPath = await exportSpineProject(scratch, asset, t, launcher);
      const [project] = await importAssets([join(projectPath, stem + '.spine')], t, launcher);
      compareRigs(expected.data, project, `${format} → .spine → JSON`);
      compareAudio(original, project, `${format} → .spine → JSON`);
    }
    if (!process.argv[2]) {
      const document = JSON.parse(Buffer.from(original.data, 'base64').toString('utf8'));
      const warm = document.skins.find(skin => skin.name === 'warm');
      warm.attachments['tile-slot'] = { tile: warm.attachments['tile-slot']['tile-warm'] };
      const legacy = { ...original, data: Buffer.from(JSON.stringify(document)).toString('base64') };
      const legacyRig = loadRig(legacy);
      try {
        const folder = await exportSpineProject(scratch, legacy, t, launcher);
        const [restored] = await importAssets([join(folder, stem + '.spine')], t, launcher);
        compareRigs(legacyRig.data, restored, 'overlapping default and warm skins → .spine → JSON');
        compareAudio(legacy, restored, 'overlapping default and warm skins → .spine → JSON');
        const legacyBinaryFolder = await exportSpineBinary(scratch, legacy, t, launcher);
        const [legacyBinary] = await importAssets([join(legacyBinaryFolder, stem + '.skel')], t, launcher);
        compareRigs(legacyRig.data, legacyBinary, 'overlapping default and warm skins → .skel');
        compareAudio(legacy, legacyBinary, 'overlapping default and warm skins → .skel');
        compareRigs(legacyRig.data, { ...legacy, data: await convertSpineBinary(legacyBinary, t, launcher) },
          'overlapping default and warm skins → .skel → JSON');
      } finally { legacyRig.dispose(); }
    }
  } finally { expected.dispose(); }
  console.log('PASS Spine CLI: binary and project round trips preserved atlas pages, rigs, animation poses, deform, tints, sequences and event values.');
} finally { await rm(scratch, { recursive: true, force: true }); }
