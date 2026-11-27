import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export const panelDefaults = (model, project) => ({
  physics: model.defaultPhysicsSettings, multiplayer: model.defaultMultiplayer(), content: model.emptyContent,
  gameData: model.emptyGameData, world: model.emptyWorld, shaders: model.emptyShaderLibrary(), skills: model.emptySkills(),
  brushes: model.productionDefaults.brushes, behaviorGraphs: model.productionDefaults.graphs,
  gameplayLab: model.productionDefaults.lab, tests: model.productionDefaults.tests,
  lighting: { enabled: false, ambient: '#20243a' },
  audioMix: { ...model.defaultMixer, master: project.config.audio.volume, music: project.config.audio.music,
    sfx: project.config.audio.sfx, ui: project.config.audio.ui, ...project.audioMix },
});

export function operationsRows(session, id, scene, row, action) {
  const { project, runtime = {} } = session;
  const native = (id, label, icon, ...values) => row('action:' + id + ':' + JSON.stringify(values), label, { icon, operation: action(id, ...values) });
  const canvas = (label, kind, params = {}, icon = 'play') => row('canvas:' + label + ':' + JSON.stringify(params), label, {
    icon, operation: action('canvas', { kind, ...params }),
  });
  const sceneRows = () => {
    const map = session.model().worldDiagnostics(project);
    return [
      native('addLink', 'Add Scene Link…', 'link', scene.id),
      native('deleteScene', 'Delete Active Scene…', 'trash', scene.id),
      row('scene-links', 'Scene Links', { icon: 'link', children: scene.links.map((link, index) => row('link:' + index,
        project.scenes.find(item => item.id === link.target)?.name ?? link.target,
        { description: link.mode, children: [
          canvas('Follow in Live Preview', 'sceneLink', { link }), native('removeLink', 'Remove Link', 'trash', scene.id, index, link),
        ] })) }),
      canvas('Go Back in Live Preview', 'goBack', {}, 'arrow-left'),
      row('world', 'World Map', { icon: 'map', children: [
        native('positionRoom', 'Set Active Room Position…', 'move', scene.id),
        native('addPortal', 'Add Portal…', 'link', scene.id),
        ...map.invalid.map((error, index) => row('portal-error:' + index, error, { icon: 'warning' })),
        ...map.unreachable.map(record => row('unreachable:' + record.id, record.name, { icon: 'warning', description: 'Unreachable from Startup' })),
        ...project.scenes.map(record => {
          const room = project.world?.rooms.find(room => room.sceneId === record.id);
          return row('room:' + record.id, record.name, {
            icon: 'location', operation: action('scene', record.id), description: room && `${room.x}, ${room.y}`,
            children: (project.world?.portals ?? []).filter(portal => portal.fromScene === record.id).map(portal =>
              row('portal:' + portal.id, portal.name, { icon: 'arrow-right',
                description: project.scenes.find(to => to.id === portal.toScene)?.name ?? portal.toScene,
                children: [native('removePortal', 'Remove Portal…', 'trash', portal.id)] })),
          });
        }),
      ] }),
      row('gameplay-lab', 'Gameplay Lab', { icon: 'game', children: [
        canvas('Install Platformer Kit', 'installCharacterKit', { mode: 'platformer' }, 'add'),
        canvas('Install Top-Down Kit', 'installCharacterKit', { mode: 'topdown' }, 'add'),
        canvas('Make Selected Rectangle a Platform', 'applyPlatform', {}, 'add'),
      ] }),
    ];
  };
  const tests = () => row('tests', 'Scene Tests', { icon: 'beaker', children: [
    native('addTest', 'Add Scene Test…', 'add', scene.id),
    ...(project.tests?.items ?? []).map(test => {
      const state = runtime.test?.id === test.id ? runtime.test : undefined;
      const report = state?.report;
      const proof = project.tests.proofs.find(proof => proof.testId === test.id);
      const description = state?.running ? 'Running' : state?.error ? 'Failed' : report || proof ?
        (report ?? proof).passed ? 'Passed' : 'Failed' : `${test.assertions.length} checks`;
      return row('test:' + test.id, test.name, { icon: 'beaker', description, children: [
        ...(test.assertions.length ? [canvas('Run Scene Test', 'runTest', { id: test.id }, 'play')] : []),
        ...(state?.error ? [row('test-error', state.error, { icon: 'error' })] : []),
        ...(report?.checks ?? []).map((check, index) => row('test-check:' + index,
          `${check.field} at frame ${check.frame}`, { icon: check.passed ? 'pass' : 'error',
            description: `expected ${String(check.expected)} · got ${String(check.actual)}` })),
        ...(report?.errors ?? []).map((error, index) => row('test-log:' + index, error, { icon: 'error' })),
      ] });
    }),
  ] });
  switch (id) {
    case 'scenes': return sceneRows();
    case 'hierarchy': return [
      native('transformSelection', 'Selection Operations…', 'settings-gear', scene.id),
      native('reorderObject', 'Move Selected Object…', 'list-ordered', scene.id),
    ];
    case 'prefabs': return [
      canvas('Capture Selection', 'capturePrefab', {}, 'add'),
      ...['apply', 'revert', 'unpack'].map(mode => canvas(`${mode[0].toUpperCase() + mode.slice(1)} Prefab Overrides`, 'prefabInstance', { mode }, 'symbol-class')),
      row('brushes', 'Brushes', { icon: 'paintcan', description: runtime.brushErase ? 'Erase' : undefined, children: [
        native('addBrush', 'Add Prefab Brush…', 'add'),
        canvas('Brush Off', 'chooseBrush', { id: '' }, 'circle-slash'),
        canvas(runtime.brushErase ? 'Paint Mode' : 'Erase Mode', 'eraseBrush', { enabled: !runtime.brushErase }, 'trash'),
        ...(project.brushes?.items ?? []).map(brush => canvas(brush.name, 'chooseBrush', { id: brush.id }, 'paintcan')),
      ] }),
    ];
    case 'input': return [
      native('addInput', 'Add Input Action…', 'add'),
      ...project.inputMap.actions.map(item => row('input:' + item.id, item.name, {
        icon: 'keyboard', description: String(runtime.input?.[item.id] ?? runtime.input?.[item.name] ?? item.kind), children: [
          native('addBinding', 'Add Binding…', 'add', item.id),
          ...(item.kind === 'axis' ? [native('axisGlobal', 'Bind to Number Global…', 'link', item.id)] : []),
          ...item.bindings.map((binding, index) => row(`binding:${item.id}:${index}`, binding.code ?? binding.type, {
            icon: 'remove', operation: action('removeBinding', item.id, index, binding),
          })),
          native('removeInput', 'Remove Action', 'trash', item.id),
        ],
      })),
    ];
    case 'globals': return [
      native('addGlobal', 'Add Global…', 'add'),
      native('enableSaves', 'Enable Game Saves', 'save'),
      ...project.globals.items.map(item => row('global:' + item.id, item.name, {
        icon: 'symbol-variable', description: runtime.globals && Object.hasOwn(runtime.globals, item.id) ? JSON.stringify(runtime.globals[item.id]) : item.type,
        children: [native('setGlobal', 'Set Live Value…', 'edit', item.id), native('removeGlobal', 'Remove Global', 'trash', item.id)],
      })),
      ...(project.gameSave ? [row('save-slots', 'Save Slots', { icon: 'save-all', description: runtime.slotMessage,
        children: session.model().gameSlots.map(slot => row('slot:' + slot, 'Slot ' + slot, { children: [
          canvas('Save Slot ' + slot, 'slot', { mode: 'save', slot }, 'save'),
          canvas('Load Slot ' + slot, 'slot', { mode: 'load', slot }, 'folder-open'),
        ] })) })] : []),
    ];
    case 'physics': return [
      native('addLayer', 'Add Collision Layer…', 'add'),
      native('collisionPair', 'Set Layer Collision…', 'settings-gear'),
      native('physicsComponent', 'Add Physics Component to Selection…', 'add', scene.id),
      canvas(runtime.physicsDebug ? 'Hide Colliders' : 'Show Colliders', 'toggleColliders', {}, 'eye'),
      canvas('Pause Physics', 'pausePhysics', { enabled: true }, 'debug-pause'),
      canvas('Resume Physics', 'pausePhysics', { enabled: false }, 'debug-continue'),
      canvas('Step Physics', 'stepPhysics', {}, 'debug-step-over'),
      ...(runtime.physics ? [row('physics-status', 'Simulation', { icon: 'pulse', description: JSON.stringify(runtime.physics) })] : []),
    ];
    case 'lighting': return [canvas('Add Light', 'addLight', {}, 'lightbulb'),
      canvas(runtime.lightingPreview ? 'Disable Lighting Preview' : 'Enable Lighting Preview', 'toggleLighting', {}, 'eye')];
    case 'network': return [
      canvas('Set Up Selected Player', 'setupNetwork', {}, 'person-add'),
      ...['start', 'stop', 'client'].map(networkAction => canvas(
        { start: 'Start Local Server', stop: 'Stop Local Server', client: 'Open Test Client' }[networkAction],
        'network', { action: networkAction }, networkAction === 'stop' ? 'debug-stop' : 'broadcast')),
      native('latency', 'Simulate Latency…', 'watch'),
      row('network-status', runtime.network?.running ? 'Server Online' : 'Server Offline',
        { icon: runtime.network?.running ? 'radio-tower' : 'debug-disconnect',
          description: runtime.network?.endpoint ?? runtime.networkError }),
    ];
    case 'audioStudio': return [
      canvas('Play Scene Audio', 'playSceneAudio'), canvas('Pause Scene Audio', 'pauseSceneAudio', {}, 'debug-pause'),
      canvas('Stop Asset Preview', 'stopAudio', {}, 'debug-stop'),
      native('generateSound', 'Generate Sound from Preset…', 'waveform'),
      ...(runtime.audio ? [row('audio-levels', 'Live Levels', { icon: 'pulse', children: Object.entries(runtime.audio)
        .map(([bus, value]) => {
          const gain = Math.round(Math.min(1, Math.max(0, value.gain)) * 8);
          return row('audio:' + bus, bus, { icon: value.playing ? 'unmute' : 'mute',
            description: `${'▰'.repeat(gain)}${'▱'.repeat(8 - gain)}  ${value.playing} playing` });
        }) })] : []),
    ];
    case 'scripts': return [native('addScript', 'New Script…', 'new-file'),
      native('attachScript', 'Attach Script to Selection…', 'link', scene.id),
      native('setSceneScript', 'Set Active Scene Script…', 'link', scene.id),
      native('breakpoint', 'Add Script Breakpoint…', 'debug-breakpoint'),
      native('watches', 'Set Debug Watches…', 'eye'), tests(),
    ];
    case 'timeline': return [
      native('addClip', 'Add Clip…', 'add', scene.id), native('addTrack', 'Add Track…', 'pulse', scene.id),
      native('scrub', 'Seek to Time…', 'watch'), native('timelineTransport', 'Playback Options…', 'settings-gear'),
      native('pauseTimeline', 'Pause Timeline', 'debug-pause'), native('onionSkin', 'Toggle Onion Skin', 'layers'),
      native('recordTimeline', 'Arm or Stop Recording…', 'record'),
    ];
    case 'content': return [
      native('addDialogue', 'New Dialogue…', 'comment'), native('addAchievement', 'New Achievement…', 'star'),
      native('newTable', 'New Data Table…', 'table'), native('importTranslations', 'Import Translations…', 'cloud-download'),
      native('exportTranslations', 'Export Translations…', 'export'),
      ...((project.gameData?.tables ?? []).map(table => row('table:' + table.id, table.name, { icon: 'table',
        children: [native('importCSV', 'Import CSV…', 'cloud-download', table.id), native('copyCSV', 'Copy CSV', 'copy', table.id)] }))),
    ];
    case 'shaders': return [native('addShader', 'New Shader…', 'add'),
      ...(project.shaders?.items ?? []).map(shader => row('shader:' + shader.id, shader.name, { icon: 'symbol-color',
        description: session.model().checkShader(shader.source).map(error => error.message).join(' · ') || 'Ready',
        children: [native('shaderSource', 'Open GLSL Source', 'file-code', shader.id),
          native('duplicateShader', 'Duplicate Shader…', 'copy', shader.id),
          native('assignShader', 'Apply to Selection', 'link', shader.id), native('removeShader', 'Remove from Library', 'trash', shader.id)],
      })), native('clearShader', 'Remove Shader from Selection', 'unlink')];
    case 'diagnostics': {
      const profile = runtime.profile;
      const spark = profile?.history.map(value => '▁▂▃▄▅▆▇█'[Math.min(7, Math.round(value / 8))]).join('');
      return [native('stepDebug', 'Step Script Frame', 'debug-step-over'),
        native('filterConsole', 'Filter Preview Console…', 'filter'),
        native('clearConsole', 'Clear Preview Console', 'clear-all'), tests(),
        row('profiler', 'Profiler', { icon: 'pulse', description: profile?.frames ? `${profile.fps} FPS · ${profile.frames} frames` : 'Live preview',
          children: [
            canvas(profile?.paused === false ? 'Pause Capture' : 'Start Capture', 'pauseProfile', { enabled: profile?.paused === false }, 'record'),
            canvas('Clear Capture', 'clearProfile', {}, 'clear-all'),
            ...(profile?.frames ? [
              row('profile:frames', 'Recent Frame Times', { description: spark, icon: 'graph-line' }),
              row('profile:average', 'Frame Time', { description: `${profile.average.toFixed(1)} ms avg · ${profile.p95.toFixed(1)} ms p95` }),
              row('profile:draw', 'Draw Calls', { description: String(profile.drawCalls) }),
              row('profile:objects', 'Scene Objects', { description: String(profile.objects) }),
              ...profile.systems.map(system => row('profile:' + system.id, system.id,
                { description: `${system.average.toFixed(2)} ms avg · ${system.max.toFixed(2)} ms max` })),
            ] : []),
          ] }),
      ];
    }
    case 'ai': return [
      native('localModels', 'Connect Local Model…', 'plug'), native('localChat', 'Ask Local Model…', 'comment-discussion'),
      native('localPlan', 'Propose Scene Edits…', 'sparkle'), native('localGenerate', 'Run ComfyUI Workflow…', 'play'),
      native('hubPair', 'Pair LocalHub…', 'plug'), native('hubUnpair', 'Disconnect LocalHub', 'debug-disconnect'),
      native('hubFiles', 'List LocalHub Files', 'files'),
    ];
    default: return [];
  }
}

const dialog = (title, value) => vscode.window.showInputBox({ title, value });
const select = (items, title) => vscode.window.showQuickPick(items, { title });
const confirm = async (message, title) => await vscode.window.showWarningMessage(message, { modal: true }, title) === title;
const integer = value => value?.trim() && /^\d+$/.test(value) ? Number(value) : undefined;

function changeUnlockedObject(scene, model, id, change) {
  const entry = model.selectionTree(scene.objects).get(id);
  const prefab = model.prefabOwner(scene.objects, id);
  if (!entry || entry.node.locked || entry.inheritedLock || (prefab && prefab.id !== id)) return scene.objects;
  return model.changeObject(scene.objects, id, change);
}

export async function runPanelOperation(operation, current, helpers) {
  const [one, two, three, four] = operation.values;
  const { modelEdit, activeScene, openScript, refreshPanel } = helpers;
  const append = (key, get, item) => current.change(project => ({ ...project, version: 2,
    [key]: { ...project[key], ...get(project[key], item) } }));
  switch (operation.id) {
    case 'canvas': await current.canvas(one); return true;
    case 'deleteScene': {
      const target = current.project.scenes.find(item => item.id === one);
      if (!target || !current.model().canDeleteScene(current.project, one)) throw Error('Remove links to the scene before deleting it. Keep at least one scene.');
      if (await vscode.window.showWarningMessage(`Delete “${target.name}”?`, { modal: true }, 'Delete') !== 'Delete') return true;
      await current.change((project, model) => {
        if (!model.canDeleteScene(project, one)) return project;
        const scenes = project.scenes.filter(record => record.id !== one);
        const world = project.world && { ...project.world, rooms: project.world.rooms.filter(room => room.sceneId !== one),
          portals: project.world.portals.filter(portal => portal.fromScene !== one && portal.toScene !== one) };
        return { ...project, version: 2, scenes, world, startup: project.startup === one ? scenes[0].id : project.startup };
      });
      await current.select({ scene: current.project.startup, selection: [], inspection: [] });
      return true;
    }
    case 'addLink': {
      const target = await select(current.project.scenes.filter(scene => scene.id !== one)
        .map(scene => ({ label: scene.name, id: scene.id })), 'Scene Link Destination');
      if (!target) return true;
      const model = current.model();
      const mode = await select(model.sceneLinkModes, 'Scene Link Mode');
      if (!mode) return true;
      const kind = await select(model.sceneTransitionKinds, 'Scene Transition');
      if (!kind) return true;
      const ms = kind === 'instant' ? 0 : integer(await dialog('Transition Duration (milliseconds)', '300'));
      if (ms === undefined || ms > 10000) return true;
      await current.change(project => ({ ...project, version: 2, scenes: project.scenes.map(scene => scene.id !== one ? scene :
        { ...scene, links: [...scene.links, { target: target.id, mode, transition: { kind, ms } }] }) }));
      return true;
    }
    case 'removeLink':
      await current.change(project => ({ ...project, version: 2, scenes: project.scenes.map(scene => scene.id !== one ? scene :
        { ...scene, links: scene.links.filter((link, index) => index !== two || JSON.stringify(link) !== JSON.stringify(three)) }) }));
      return true;
    case 'positionRoom': {
      const room = current.project.world?.rooms.find(room => room.sceneId === one);
      const coordinates = [];
      for (const axis of ['x', 'y']) {
        const raw = await dialog('Room ' + axis.toUpperCase(), String(room?.[axis] ?? 0));
        if (!raw?.trim() || !Number.isFinite(Number(raw))) return true;
        coordinates.push(Number(raw));
      }
      await current.change((project, model) => {
        const world = project.world ?? model.emptyWorld;
        const room = world.rooms.find(room => room.sceneId === one);
        return { ...project, version: 2, world: { ...world, rooms: [...world.rooms.filter(room => room.sceneId !== one),
          { ...room, sceneId: one, x: coordinates[0], y: coordinates[1] }] } };
      });
      return true;
    }
    case 'addPortal': {
      const destination = await select(current.project.scenes.filter(scene => scene.id !== one)
        .map(scene => ({ label: scene.name, id: scene.id })), 'Portal Destination');
      if (!destination) return true;
      const chooseObject = async (id, title) => select(current.project.scenes.find(scene => scene.id === id).objects
        .filter(node => node.type !== 'Camera2D' && !node.screenSpace).map(node => ({ label: node.label, id: node.id })), title);
      const fields = [['fromEntity', one, 'Portal Marker'], ['fromActor', one, 'Source Actor'],
        ['toSpawn', destination.id, 'Destination Spawn'], ['toActor', destination.id, 'Destination Actor']];
      const targets = {};
      for (const [key, scene, title] of fields) {
        const object = await chooseObject(scene, title);
        if (!object) return true;
        targets[key] = object.id;
      }
      const name = (await dialog('Portal Name', 'Portal'))?.trim();
      const mode = name && await select(['click', 'near'], 'Portal Activation');
      if (mode) await current.change((project, model) => {
        const world = project.world ?? model.emptyWorld;
        return { ...project, version: 2, world: { ...world, portals: [...world.portals,
          { ...targets, id: randomUUID(), fromScene: one, toScene: destination.id, name, mode }] } };
      });
      return true;
    }
    case 'removePortal':
      if (await confirm('Remove this portal?', 'Remove')) await current.change(project => !project.world ? project :
        { ...project, world: { ...project.world, portals: project.world.portals.filter(portal => portal.id !== one) } });
      return true;
    case 'addBrush': {
      const prefab = await select(current.project.prefabs.map(prefab => ({ label: prefab.name, id: prefab.id })), 'Brush Prefab');
      const name = prefab && (await dialog('Brush Name', prefab.label))?.trim();
      if (name) await current.change((project, model) => {
        const brushes = project.brushes ?? model.productionDefaults.brushes;
        const brush = model.BrushSchema.parse({ id: randomUUID(), name, kind: 'prefab', prefabId: prefab.id });
        return { ...project, version: 2, brushes: { ...brushes, items: [...brushes.items, brush] } };
      });
      return true;
    }
    case 'axisGlobal': {
      const global = await select([{ label: 'None' }, ...current.project.globals.items
        .filter(item => item.type === 'number').map(item => ({ label: item.name, id: item.id }))], 'Write Axis Value to Global');
      if (global) await current.change(project => ({ ...project, version: 2, inputMap: { ...project.inputMap,
        actions: project.inputMap.actions.map(item => item.id !== one || item.kind !== 'axis' ? item : { ...item, globalId: global.id }) } }));
      return true;
    }
    case 'transformSelection': {
      const choice = await select(['Show', 'Hide', 'Lock', 'Unlock', 'Flip Horizontally', 'Flip Vertically'], 'Selection Operations');
      if (!choice) return true;
      const ids = current.workspace?.selection ?? [];
      await modelEdit(current, one, (scene, model) => {
        const index = model.selectionTree(scene.objects);
        const objects = ids.reduce((objects, id) => {
          const entry = index.get(id), owner = model.prefabOwner(scene.objects, id);
          if (!entry || entry.inheritedLock || (owner && owner.id !== id) || entry.node.locked && choice !== 'Unlock') return objects;
          return model.changeObject(objects, id, node => {
            if (choice === 'Show' || choice === 'Hide') return { ...node, visible: choice === 'Show' };
            if (choice === 'Lock' || choice === 'Unlock') return { ...node, locked: choice === 'Lock' };
            const axis = choice === 'Flip Horizontally' ? 'x' : 'y';
            return { ...node, scale: { ...node.scale, [axis]: -node.scale[axis] } };
          });
        }, scene.objects);
        return objects === scene.objects ? scene : { ...scene, objects };
      });
      return true;
    }
    case 'reorderObject': {
      const currentId = current.workspace?.selection.at(-1);
      if (!currentId) return true;
      const model = current.model();
      const index = model.selectionTree(activeScene(current).objects);
      const targets = [...index.values()].filter(entry => entry.node.id !== currentId && entry.node.type !== 'Camera2D' &&
        !entry.node.locked && !entry.inheritedLock).map(entry => ({ label: entry.node.label, id: entry.node.id }));
      const target = await select(targets, 'Move Relative to Object');
      if (!target) return true;
      const placement = await select(['before', 'after', ...(index.get(target.id)?.node.type === 'Container' ? ['inside'] : [])], 'Placement');
      if (!placement) return true;
      await modelEdit(current, one, (scene, model) => {
        const index = model.selectionTree(scene.objects);
        const source = index.get(currentId), destination = index.get(target.id);
        if (!source || !destination || source.node.type === 'Camera2D' || [source, destination].some(entry => entry.inheritedLock || entry.node.locked)) return scene;
        if (model.prefabOwner(scene.objects, currentId) || model.prefabOwner(scene.objects, target.id)) return scene;
        const objects = model.moveObject(scene.objects, currentId, { id: target.id, placement });
        return objects === scene.objects ? scene : { ...scene, objects };
      });
      return true;
    }
    case 'addInput': {
      const name = (await vscode.window.showInputBox({ title: 'Input Action Name', validateInput: value =>
        /^[a-z][a-z0-9_]*$/i.test(value.trim()) ? undefined : 'Start with a letter and use letters, digits or underscores.' }))?.trim();
      const kind = name && await select(['button', 'axis'], 'Input Action Type');
      if (kind) await append('inputMap', (map, item) => ({ actions: [...map.actions, item] }), { id: randomUUID(), name, kind, bindings: [] });
      return true;
    }
    case 'addBinding': {
      const kind = current.project.inputMap.actions.find(item => item.id === one)?.kind;
      if (!kind) return true;
      const type = await select(kind === 'axis' ? ['keyAxis', 'gamepadAxis'] : ['key', 'mouse', 'touch', 'gamepadButton'], 'Input Binding Type');
      if (!type) return true;
      const binding = type === 'key' ? { type, code: await dialog('Keyboard Code', 'Space') } :
        type === 'touch' ? { type } : type === 'gamepadAxis' ? { type, index: integer(await dialog('Gamepad Axis', '0')), invert: false } :
          type === 'keyAxis' ? { type, negative: await dialog('Negative Key Code', 'ArrowLeft'), positive: await dialog('Positive Key Code', 'ArrowRight') } :
            type === 'gamepadButton' ? { type, index: integer(await dialog('Gamepad Button', '0')) } :
              { type, button: integer(await dialog('Mouse Button', '0')) };
      if (Object.values(binding).some(value => value === undefined)) return true;
      await current.change(project => ({ ...project, version: 2, inputMap: { ...project.inputMap,
        actions: project.inputMap.actions.map(item => item.id !== one ? item : { ...item, bindings: [...item.bindings, binding] }) } }));
      return true;
    }
    case 'removeInput': case 'removeBinding':
      await current.change(project => ({ ...project, version: 2, inputMap: { ...project.inputMap,
        actions: operation.id === 'removeInput' ? project.inputMap.actions.filter(item => item.id !== one) :
          project.inputMap.actions.map(item => item.id !== one ? item : { ...item,
            bindings: item.bindings.filter((value, index) => index !== two || JSON.stringify(value) !== JSON.stringify(three)) }) } }));
      return true;
    case 'addGlobal': {
      const name = (await dialog('Global Name'))?.trim();
      const kind = name && await select(['number', 'boolean', 'string', 'list', 'object'], 'Global Type');
      const defaults = { number: 0, boolean: false, string: '', list: [], object: {} };
      if (kind) await current.change((project, model) => ({ ...project, version: 2, gameSave: project.gameSave ?? model.createGameSave(),
        globals: { ...project.globals, items: [...project.globals.items, { id: randomUUID(), name, type: kind, initial: defaults[kind] }] } }));
      return true;
    }
    case 'removeGlobal':
      await current.change(project => ({ ...project, version: 2, globals: { ...project.globals,
        items: project.globals.items.filter(item => item.id !== one) },
        inputMap: { ...project.inputMap, actions: project.inputMap.actions.map(item => {
          if (item.globalId !== one) return item;
          const { globalId: _removed, ...unbound } = item;
          return unbound;
        }) } }));
      return true;
    case 'setGlobal': {
      const item = current.project.globals.items.find(item => item.id === one);
      if (!item) return true;
      const value = await dialog('Live Global Value (JSON)', JSON.stringify(current.runtime?.globals?.[one] ?? item.initial));
      if (value !== undefined) await current.canvas({ kind: 'global', id: one, value: JSON.parse(value) });
      return true;
    }
    case 'enableSaves':
      await current.change((project, model) => project.gameSave ? project : { ...project, version: 2, gameSave: model.createGameSave() });
      return true;
    case 'addLayer': {
      const name = (await dialog('Collision Layer Name'))?.trim();
      if (name) await current.change((project, model) => {
        const physics = project.physics ?? model.defaultPhysicsSettings;
        return { ...project, version: 2, physics: { ...physics, layers: [...physics.layers, name] } };
      });
      return true;
    }
    case 'collisionPair': {
      const model = current.model(), settings = current.project.physics ?? model.defaultPhysicsSettings;
      const layers = settings.layers.map((label, index) => ({ label, index }));
      const first = await select(layers, 'First Collision Layer');
      const second = first && await select(layers, 'Second Collision Layer');
      if (!second) return true;
      const enabled = await select(['Enable Collision', 'Disable Collision'], 'Collision Between Layers');
      if (!enabled) return true;
      await current.change(project => {
        const physics = project.physics ?? model.defaultPhysicsSettings;
        if (physics.layers[first.index] !== first.label || physics.layers[second.index] !== second.label) return project;
        return { ...project, version: 2, physics: { ...physics, collisions: model.setLayerPair(physics, physics.layers.length,
          first.index, second.index, enabled === 'Enable Collision') } };
      });
      return true;
    }
    case 'physicsComponent': {
      const id = current.workspace?.selection.at(-1);
      if (!id) return true;
      const choice = await select(['Rigid Body', 'Joint', ...current.model().colliderKinds], 'Physics Component');
      if (!choice) return true;
      await modelEdit(current, one, (scene, model) => {
        const node = model.selectionTree(scene.objects).get(id);
        if (!node || node.node.locked || node.inheritedLock || model.prefabOwner(scene.objects, id)) return scene;
        return { ...scene, objects: model.changeObject(scene.objects, id, node => {
          const physics = node.physics ?? { joints: [], colliders: [] };
          return { ...node, physics: choice === 'Rigid Body' ? { ...physics, body: physics.body ?? model.defaultRigidBody } :
            choice === 'Joint' ? { ...physics, joints: [...physics.joints, model.newJoint()] } :
              { ...physics, colliders: [...physics.colliders, model.newCollider(choice)] } };
        }) };
      });
      return true;
    }
    case 'generateSound': {
      const model = current.model();
      const preset = await select(model.sfxPresets, 'Sound Preset');
      if (!preset) return true;
      const name = (await dialog('Sound Name', preset))?.trim();
      if (!name) return true;
      const choice = await select(['Add to Assets', 'Add to Assets and Place in Scene'], 'Generated Sound');
      if (!choice) return true;
      const bytes = model.encodeWav(model.renderSfx(model.presetSfx(preset, 1)));
      const alias = `project/${randomUUID()}/${name.replace(/[^a-z0-9 _-]/gi, '_').slice(0, 75)}.wav`;
      await modelEdit(current, activeScene(current).id, (scene, model) => ({
        ...scene, assets: [...scene.assets, { alias, data: Buffer.from(bytes).toString('base64') }],
        assetLibrary: model.addLibraryEntries(scene.assetLibrary, [alias], null, true),
      }));
      if (choice.endsWith('Scene')) await current.canvas({ kind: 'placeAsset', alias });
      return true;
    }
    case 'latency': {
      const value = integer(await dialog('Simulated Latency in ms', '100'));
      if (value !== undefined) await current.canvas({ kind: 'network', action: 'latency', value });
      return true;
    }
    case 'addTest': {
      const name = (await dialog('Scene Test Name', 'Scene Test'))?.trim();
      if (name) await current.change(project => {
        const tests = project.tests ?? { version: 1, items: [], proofs: [] };
        return { ...project, version: 2, tests: { ...tests, items: [...tests.items,
          { id: randomUUID(), sceneId: one, name, frames: 60, seed: 1, assertions: [], events: [] }] } };
      });
      return true;
    }
    case 'renameScript': case 'deleteScript': {
      const script = current.project.scripts.items.find(item => item.id === one);
      if (!script) return true;
      const name = operation.id === 'renameScript' ? (await dialog('Script Name', script.name))?.trim() : undefined;
      if (operation.id === 'renameScript' && (!name || name === script.name)) return true;
      if (operation.id === 'deleteScript' && !await confirm(`Delete “${script.name}”?`, 'Delete')) return true;
      await current.change((project, model) => {
        if (project.scripts.items.find(item => item.id === one)?.source !== script.source) return project;
        if (!name && (Object.values(project.scripts.scenes ?? {}).some(binding => binding.scriptId === one) ||
          [...model.selectionTree([...project.scenes.flatMap(scene => scene.objects), ...project.prefabs.map(prefab => prefab.root)]).values()]
            .some(({ node }) => node.behaviour?.scriptId === one))) throw new Error('Detach the script from scenes and objects first.');
        const { error: _error, ...previous } = script;
        return { ...project, version: 2, scripts: { ...project.scripts, items: name ?
          project.scripts.items.map(item => item.id !== one ? item : { ...previous, name, ...model.compileScript(script.source, name) }) :
          project.scripts.items.filter(item => item.id !== one) } };
      });
      return true;
    }
    case 'addScript': {
      const name = (await dialog('Script Name', 'Script'))?.trim();
      if (!name) return true;
      const id = randomUUID();
      const source = 'export function start(self: GameObject) {\n}\n';
      await current.change((project, model) => ({ ...project, version: 2,
        scripts: { ...project.scripts, items: [...project.scripts.items, { id, name, source, ...model.compileScript(source, name) }] } }));
      await openScript(current, id);
      return true;
    }
    case 'addClip': {
      const name = (await dialog('Clip Name', 'Clip'))?.trim();
      if (name) await modelEdit(current, one, (scene, model) => {
        const library = scene.cinematics ?? model.emptyCinematics;
        return { ...scene, cinematics: { ...library, clips: [...library.clips,
          { id: randomUUID(), name, tracks: [], cues: [], nested: [] }] } };
      });
      return true;
    }
    case 'addTrack': {
      const model = current.model(), scene = activeScene(current);
      const targets = [...model.selectionTree(scene.objects).values()].map(({ node }) => ({ label: node.label, id: node.id, node }));
      const node = targets.find(item => item.id === current.workspace?.selection.at(-1)) ?? await select(targets, 'Track Target');
      if (!node) return true;
      const property = await select(model.timelineProperties.filter(prop => !model.audioTween(prop) || node.node.type === 'AudioSource'), 'Track Property');
      if (!property) return true;
      const clip = await select(model.clipList(scene, 'Main Clip').map(item => ({ label: item.name, id: item.id })), 'Timeline Clip');
      if (!clip) return true;
      await modelEdit(current, one, (scene, model) => ({ ...scene, ...model.changeClip(scene, clip.id, item => {
        if (item.tracks.some(track => track.target === node.id && track.property === property)) throw Error('This property already has a track in the clip.');
        return { ...item, tracks: [...item.tracks, { id: randomUUID(), target: node.id, property, keys: [
          { id: randomUUID(), time: 0, value: model.authoredValue(node.node, property), ease: 'linear' },
        ] }] };
      }) }));
      return true;
    }
    case 'timelineNested': case 'timelineCue': {
      const model = current.model();
      const clip = model.clipList(activeScene(current), 'Main Clip').find(item => item.id === two);
      if (!clip) return true;
      const raw = await dialog(operation.id === 'timelineNested' ? 'Start Time (seconds)' : 'Cue Time (seconds)', '0');
      const seconds = Number(raw);
      if (!raw?.trim() || !Number.isFinite(seconds) || seconds < 0 || seconds > 600) return true;
      const options = model.clipList(activeScene(current), 'Main Clip').filter(item => item.id !== two)
        .map(item => ({ label: item.name, id: item.id }));
      let field, value;
      if (operation.id === 'timelineNested') {
        const target = await select(options, 'Nested Clip');
        if (!target) return true;
        field = 'nested';
        value = { id: randomUUID(), clip: target.id, start: seconds, speed: 1 };
      } else {
        const kind = await select(['message', 'audio', 'visibility', 'camera', 'global', 'scene', 'clip'], 'Cue Type');
        if (!kind) return true;
        const name = (await dialog('Cue Name', kind))?.trim();
        if (!name) return true;
        field = 'cues';
        value = { id: randomUUID(), name, kind, time: kind === 'clip' ? Math.max(0.01, seconds) : seconds };
        const nodes = [...model.selectionTree(activeScene(current).objects).values()].map(({ node }) => node);
        const picks = { audio: nodes.filter(node => node.type === 'AudioSource'), visibility: nodes,
          global: current.project.globals.items, scene: current.project.scenes };
        if (kind === 'message') {
          value.message = await dialog('Cue Message', '');
          if (value.message === undefined) return true;
        } else if (kind !== 'camera') {
          const target = await select(kind === 'clip' ? options : picks[kind].map(item => ({ label: item.label ?? item.name, id: item.id })), 'Cue Target');
          if (!target) return true;
          value.target = target.id;
          if (kind === 'clip') value.fade = 0.3;
          if (kind === 'audio') {
            value.action = await select(['play', 'stop'], 'Audio Action');
            if (!value.action) return true;
          }
          if (kind === 'global') {
            value.value = await dialog('Global Value');
            if (value.value === undefined) return true;
          }
          if (kind === 'visibility') {
            const visible = await select(['Show', 'Hide'], 'Object Visibility');
            if (!visible) return true;
            value.visible = visible === 'Show';
          }
        }
      }
      await modelEdit(current, one, (scene, model) => ({ ...scene, ...model.changeClip(scene, two,
        clip => ({ ...clip, [field]: [...clip[field], value] })) }));
      return true;
    }
    case 'timelineRemoveItem':
      if (await confirm('Remove this timeline item?', 'Remove')) await modelEdit(current, one, (scene, model) =>
        ({ ...scene, ...model.changeClip(scene, two, clip => ({ ...clip,
          [three]: clip[three].filter(item => item.id !== four) })) }));
      return true;
    case 'autoplayClip':
      await modelEdit(current, one, (scene, model) => {
        const library = scene.cinematics ?? model.emptyCinematics;
        return { ...scene, cinematics: { ...library, autoplay: library.autoplay === two ? undefined : two } };
      });
      return true;
    case 'removeClip':
      if (await confirm('Remove this clip and references to it?', 'Remove')) await modelEdit(current, one, (scene, model) =>
        scene.cinematics ? { ...scene, cinematics: model.removeClip(scene.cinematics, two) } : scene);
      return true;
    case 'addKey': case 'removeKey': case 'removeTrack': {
      const model = current.model();
      const clip = model.clipList(activeScene(current), 'Main Clip').find(item => item.id === (two ?? model.mainClip));
      const track = clip?.tracks.find(track => track.id === three);
      if (!track) return true;
      let key;
      if (operation.id === 'addKey') {
        const rawTime = await dialog('Key Time (seconds)', String(Math.min(600, track.keys.at(-1).time + 1)));
        const time = Number(rawTime);
        if (!rawTime?.trim() || !Number.isFinite(time) || time < 0 || time > 600) return true;
        const rawValue = await dialog('Key Value', String(track.keys.at(-1).value));
        const value = Number(rawValue);
        if (!rawValue?.trim() || !Number.isFinite(value)) return true;
        const ease = await select(model.timelineEases, 'Easing Curve');
        if (!ease) return true;
        key = { id: randomUUID(), time, value, ease };
      } else if (!await confirm(operation.id === 'removeKey' ? 'Remove this key?' : 'Remove this track?', 'Remove')) return true;
      await modelEdit(current, one, (scene, model) => ({ ...scene, ...model.changeClip(scene, two ?? model.mainClip, clip => {
        const after = clip.tracks.flatMap(item => {
          if (item.id !== three) return [item];
          if (operation.id === 'removeTrack') return [];
          if (key && item.keys.some(other => other.time === key.time)) throw new Error('This track already has a key at that time.');
          const keys = key ? [...item.keys, key] : item.keys.filter(key => key.id !== four);
          if (!keys.length) throw new Error('Keep at least one key or remove the track.');
          return [{ ...item, keys }];
        });
        return { ...clip, tracks: after };
      }) }));
      return true;
    }
    case 'scrub': case 'recordTimeline': {
      const model = current.model(), clips = model.clipList(activeScene(current), 'Main Clip');
      const options = clips.map(clip => ({ label: clip.name, id: clip.id }));
      if (operation.id === 'recordTimeline') options.push({ label: 'Stop Recording', id: '' });
      const choice = await select(options, 'Timeline Clip');
      if (!choice) return true;
      if (!choice.id) { await current.invoke('vscode:timeline', { action: 'record' }); return true; }
      const raw = await dialog('Timeline Time (seconds)', '0'), time = Number(raw);
      if (!raw?.trim() || !Number.isFinite(time) || time < 0 || time > 600) return true;
      const clip = model.compileClip(clips, choice.id);
      if (clip) await current.invoke('vscode:timeline', operation.id === 'scrub' ? { action: 'seek', clip, position: time } :
        { action: 'record', target: { id: choice.id, clip, time } });
      return true;
    }
    case 'timelineTransport': {
      const mode = await select(['Forward', 'Reverse', 'Loop', 'Reverse Loop'], 'Playback Mode');
      if (!mode) return true;
      const speed = Number(await dialog('Playback Speed', '1'));
      if (!Number.isFinite(speed) || speed <= 0 || speed > 8) return true;
      current.timelineTransport = { speed, reverse: mode.startsWith('Reverse'), loop: mode.endsWith('Loop') };
      return true;
    }
    case 'pauseTimeline': await current.invoke('vscode:timeline', { action: 'pause' }); return true;
    case 'onionSkin':
      current.onion = !current.onion;
      await current.invoke('vscode:timeline', { action: 'onion', settings: current.onion ? { before: 1, after: 1, spacing: 6 } : undefined });
      return true;
    case 'attachScript': case 'setSceneScript': {
      const choice = await select([{ label: 'None', id: '' }, ...current.project.scripts.items.map(item => ({ label: item.name, id: item.id }))],
        'Choose Project Script');
      if (!choice) return true;
      const binding = choice.id ? { scriptId: choice.id, params: {}, refs: {} } : undefined;
      if (operation.id === 'attachScript') {
        const id = current.workspace?.selection.at(-1);
        if (id) await modelEdit(current, one, (scene, model) => ({ ...scene,
          objects: changeUnlockedObject(scene, model, id, node => ({ ...node, behaviour: binding })) }));
      } else await current.change(project => {
        const scenes = { ...project.scripts.scenes };
        if (binding) scenes[one] = binding; else delete scenes[one];
        return { ...project, version: 2, scripts: { ...project.scripts, scenes } };
      });
      return true;
    }
    case 'breakpoint': {
      const file = await select(current.project.scripts.items.map(item => ({ label: item.name, id: item.id })), 'Script');
      if (!file) return true;
      const line = integer(await dialog('Breakpoint Line', '1'));
      if (line > 0) {
        const settings = current.debugSettings ??= { breakpoints: {}, watches: [] };
        const active = settings.breakpoints[file.id] ?? [];
        settings.breakpoints[file.id] = active.includes(line) ? active.filter(item => item !== line) : [...active, line];
        await current.invoke('vscode:debug-control', { settings });
      }
      return true;
    }
    case 'watches': {
      const settings = current.debugSettings ??= { breakpoints: {}, watches: [] };
      const value = await dialog('Watch Expressions (semicolon separated)', settings.watches.join('; '));
      if (value !== undefined) {
        settings.watches = [...new Set(value.split(';').map(item => item.trim()).filter(Boolean))];
        await current.invoke('vscode:debug-control', { settings });
      }
      return true;
    }
    case 'addDialogue': case 'addAchievement': {
      const isDialogue = operation.id === 'addDialogue';
      const name = (await dialog(isDialogue ? 'Dialogue Name' : 'Achievement Name'))?.trim();
      if (!name) return true;
      const text = await dialog(isDialogue ? 'First Line' : 'Description', '');
      if (text === undefined) return true;
      await current.change((project, model) => {
        const key = isDialogue ? 'dialogues' : 'achievements';
        const content = project.content ?? model.emptyContent;
        const initial = isDialogue ? model.newLine(randomUUID(), text) : undefined;
        const item = initial ? { id: randomUUID(), name, start: initial.id, lines: [initial] } :
          { id: randomUUID(), name, description: text, hidden: false };
        return { ...project, version: 2, content: { ...content, [key]: { ...content[key], items: [...content[key].items, item] } } };
      });
      return true;
    }
    case 'newTable': {
      const name = (await dialog('Data Table Name'))?.trim();
      if (name) await current.change((project, model) => {
        const data = project.gameData ?? model.emptyGameData;
        return { ...project, version: 2, gameData: { ...data, tables: [...data.tables, { id: randomUUID(), name, fields: [], rows: [] }] } };
      });
      return true;
    }
    case 'copyCSV': case 'importCSV': {
      const table = current.project.gameData?.tables.find(table => table.id === one);
      if (!table) return true;
      if (operation.id === 'copyCSV') { await vscode.env.clipboard.writeText(current.model().tableCSV(table)); return true; }
      const files = await vscode.window.showOpenDialog({ title: 'Import Table CSV', filters: { CSV: ['csv'] }, canSelectMany: false });
      if (!files?.[0]) return true;
      const csv = await readFile(files[0].fsPath, 'utf8');
      await current.change((project, model) => ({ ...project, version: 2, gameData: model.parseGameData(project, {
        ...project.gameData, tables: project.gameData.tables.map(item => item.id !== one ? item : { ...item, rows: model.importCSV(item, csv) }),
      }) }));
      return true;
    }
    case 'importTranslations': {
      const files = await current.invoke('olive:import-translations');
      if (!files?.length) return true;
      await current.change((project, model) => {
        const content = project.content ?? model.emptyContent;
        const localization = files.reduce((locale, file) => model.mergeI18nextJson(locale, file.name.replace(/\.json$/i, ''), JSON.parse(file.text)).table, content.localization);
        return { ...project, version: 2, content: { ...content, localization } };
      });
      return true;
    }
    case 'exportTranslations': {
      const model = current.model(), localization = (current.project.content ?? model.emptyContent).localization;
      const out = await current.invoke('olive:export-translations', localization.languages.map(language =>
        ({ name: language.id + '.json', text: JSON.stringify(model.toI18nextJson(localization, language.id), null, 2) + '\n' })));
      if (out) void vscode.window.showInformationMessage('Exported translations to ' + out);
      return true;
    }
    case 'localModels': case 'localChat': case 'localPlan': {
      const endpoint = await dialog('LM Studio Local Endpoint', current.aiEndpoint ?? 'http://127.0.0.1:1234/v1');
      if (!endpoint) return true;
      const status = await current.invoke('olive:ai-status', 'lm', endpoint);
      if (!status.online) throw Error(status.error || 'LM Studio is offline.');
      const model = await select(status.models.map(model => ({ label: model.id })), 'Local Model');
      if (!model) return true;
      current.aiEndpoint = endpoint;
      if (operation.id === 'localModels') { void vscode.window.showInformationMessage('Connected to ' + model.label); return true; }
      const prompt = await dialog('Ask the Local Model');
      if (!prompt) return true;
      const scene = activeScene(current), api = current.model(), project = current.project;
      const planning = operation.id === 'localPlan', id = randomUUID();
      const messages = planning ? [{ role: 'system', content: 'Return a JSON array. Actions are rename {id,label}, move {id,x,y}, visibility {id,visible}, setText {id,text}. Use action as the discriminator. Edit only listed IDs.' },
        { role: 'user', content: prompt + '\n' + JSON.stringify([...api.selectionTree(scene.objects).values()].slice(0, 250)
          .map(({ node }) => ({ id: node.id, type: node.type, name: node.label, position: node.position }))) }] : [{ role: 'user', content: prompt }];
      const reply = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Running local model', cancellable: true },
        async (_progress, token) => {
          const dispose = token.onCancellationRequested(() => { void current.invoke('olive:ai-cancel', id); });
          try { return await current.invoke('olive:ai-request', id, 'lm', endpoint, { model: model.label, messages, maxTokens: 1500 }); }
          finally { dispose.dispose(); }
        });
      if (!planning) {
        const document = await vscode.workspace.openTextDocument({ language: 'markdown', content: reply.content || '' });
        await vscode.window.showTextDocument(document, { preview: false });
      } else {
        const edits = api.parseAssistantEdits(reply.content);
        const choice = await vscode.window.showWarningMessage('Apply the proposed scene edits?', {
          modal: true, detail: edits.map(edit => JSON.stringify(edit)).join('\n'),
        }, 'Apply');
        if (choice === 'Apply') await modelEdit(current, scene.id, (authored, model, latest) => {
          if (latest !== project) throw Error('The scene changed. Generate a new proposal.');
          const blocked = new Set([...model.selectionTree(authored.objects).values()].flatMap(({ node, inheritedLock }) =>
            inheritedLock || node.locked || model.prefabOwner(authored.objects, node.id) ? [node.id] : []));
          return { ...authored, objects: model.applyAssistantEdits(authored.objects, edits, blocked) };
        });
      }
      return true;
    }
    case 'localGenerate': {
      const endpoint = await dialog('ComfyUI Local Endpoint', 'http://127.0.0.1:8188');
      const files = endpoint && await vscode.window.showOpenDialog({ filters: { 'ComfyUI Workflow': ['json'] }, canSelectMany: false });
      if (!endpoint || !files?.[0]) return true;
      const workflow = JSON.parse(await readFile(files[0].fsPath, 'utf8')), id = randomUUID();
      const results = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Running local ComfyUI workflow', cancellable: true },
        async (_progress, token) => {
          const dispose = token.onCancellationRequested(() => { void current.invoke('olive:ai-cancel', id); });
          try { return await current.invoke('olive:ai-request', id, 'comfy', endpoint, workflow); }
          finally { dispose.dispose(); }
        });
      const chosen = await vscode.window.showQuickPick(results.map((file, index) => ({ label: file.name, index, picked: true })),
        { title: 'Import Generated Assets', canPickMany: true });
      if (chosen?.length) await modelEdit(current, activeScene(current).id, (scene, model) => {
        const entries = chosen.map(({ index }) => ({ alias: 'project/' + randomUUID() + '/' + model.filename(results[index].name), data: results[index].data }));
        return { ...scene, assets: [...scene.assets, ...entries],
          assetLibrary: model.addLibraryEntries(scene.assetLibrary, entries.map(item => item.alias), null, true) };
      });
      return true;
    }
    case 'hubPair': {
      const invite = await dialog('LocalHub Pairing Invite');
      if (invite) await current.invoke('localhub:pair', invite);
      return true;
    }
    case 'hubUnpair': await current.invoke('localhub:unpair'); return true;
    case 'hubFiles': {
      const files = await current.invoke('localhub:files');
      if (files) await select(files.map(file => ({ label: file.filename, description: String(file.bytes) })), 'LocalHub Files');
      return true;
    }
    case 'addShader': {
      const model = current.model();
      const choice = await select([{ label: 'Empty Shader', source: 'vec4 effect(vec2 uv) { return tex(uv); }' },
        ...model.shaderPresets.map(item => ({ label: item.name, source: item.source }))], 'Shader Preset');
      if (!choice) return true;
      const name = (await dialog('Shader Name', choice.label))?.trim();
      if (name) await current.change(project => ({ ...project, version: 2,
        shaders: { version: 1, items: [...(project.shaders?.items ?? []), { id: randomUUID(), name, source: choice.source }] } }));
      return true;
    }
    case 'duplicateShader': {
      const shader = current.project.shaders?.items.find(item => item.id === one);
      const name = shader && (await dialog('Shader Name', shader.name + ' Copy'))?.trim();
      if (name) await current.change(project => ({ ...project, shaders: { ...project.shaders, items: [...project.shaders.items,
        { ...shader, id: randomUUID(), name }] } }));
      return true;
    }
    case 'assignShader': case 'clearShader': {
      const source = current.project.shaders?.items.find(item => item.id === one);
      if (operation.id === 'assignShader' && (!source || current.model().checkShader(source.source).length)) throw Error('Fix shader diagnostics first.');
      const id = current.workspace?.selection.at(-1);
      if (id) await modelEdit(current, activeScene(current).id, (scene, model) => ({ ...scene,
        objects: changeUnlockedObject(scene, model, id, node =>
          ({ ...node, shader: source ? { shaderId: source.id, padding: 0, values: {} } : undefined })) }));
      return true;
    }
    case 'removeShader':
      await current.change((project, model) => {
        if ([...project.scenes.flatMap(scene => scene.objects), ...project.prefabs.map(prefab => prefab.root)]
          .some(node => [...model.selectionTree([node]).values()].some(({ node }) => node.shader?.shaderId === one))) {
          throw Error('Remove the shader from its objects before deleting it.');
        }
        return { ...project, version: 2, shaders: { ...project.shaders, items: project.shaders.items.filter(item => item.id !== one) } };
      });
      return true;
    case 'stepDebug': await current.invoke('vscode:debug-control', 'step'); return true;
    case 'filterConsole': {
      const level = await select(['All', 'Info', 'Warning', 'Error'], 'Preview Console Level');
      if (level) {
        current.consoleLevel = { Info: 'info', Warning: 'warn', Error: 'error' }[level];
        refreshPanel('diagnostics');
        refreshPanel('scripts');
      }
      return true;
    }
    case 'clearConsole': await current.invoke('vscode:debug-control', 'clearConsole'); return true;
    default: return false;
  }
}
