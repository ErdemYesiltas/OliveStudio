import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import { registerSectionFiles } from './sectionFiles.mjs';
import { registerScriptFiles } from './scriptFiles.mjs';
import { operationsRows, panelDefaults, runPanelOperation } from './panelActions.mjs';

const command = 'oliveStudio.treeAction';
const treeMime = 'application/vnd.code.tree.olivestudio.rail.hierarchy';
const editKinds = {
  input: ['inputMap'], globals: ['globals', 'gameSave'], physics: ['physics'],
  network: ['multiplayer'], content: ['content', 'gameData'], audioStudio: ['audioMix'],
  shaders: ['shaders'], ai: ['skills'], lighting: ['lighting'],
};
const projectSections = {
  scenes: [['world'], ['gameplayLab']], prefabs: [['brushes']], input: [['inputMap']], globals: [['globals'], ['gameSave']],
  scripts: [['behaviorGraphs'], ['tests']], diagnostics: [['tests']], physics: [['physics']], network: [['multiplayer']],
  content: [['content'], ['gameData']], audioStudio: [['audioMix']], shaders: [['shaders']], ai: [['skills']],
};
const sceneSections = { scenes: [['links']], timeline: [['timeline', 'cinematics']], lighting: [['lighting']] };
const objectIcons = { Container: 'folder', Camera2D: 'device-camera-video', Sprite: 'file-media', Text: 'text-size',
  BitmapText: 'text-size', Light2D: 'lightbulb', AudioSource: 'unmute', AudioListener: 'unmute' };
const pretty = name => name === 'label' ? 'Name' : name.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  .replaceAll('_', ' ').replace(/^./, letter => letter.toUpperCase());
const action = (id, ...values) => ({ id, values });
const row = (id, label, options = {}) => ({ id, label, ...options });

function activeScene(session, project = session?.project) {
  return session.model().sceneRecord(project, session.workspace?.scene);
}

function valueRows(value, path, label, editable) {
  const key = JSON.stringify(path);
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).filter(([name]) => name !== 'id');
    return row(key, label, {
      icon: Array.isArray(value) ? 'list-unordered' : 'symbol-namespace',
      children: entries.map(([name, item]) => valueRows(item, [...path, name],
        Array.isArray(value) ? item?.name ?? item?.label ?? `${label} ${Number(name) + 1}` : pretty(name), editable)),
    });
  }
  const operation = editable && typeof value !== 'undefined' ? editable(path, value, label) : undefined;
  return row(key, label, { description: value === null ? 'None' : String(value), icon: typeof value === 'boolean' ? 'symbol-boolean' : 'symbol-property',
    operation, context: operation && 'olive-property' });
}

function hierarchyRows(scene, workspace) {
  const selected = new Set(workspace?.selection ?? []);
  const nodes = (items, depth = 0) => items.map(node => row(node.id, node.label, {
    icon: objectIcons[node.type] ?? 'symbol-object',
    description: node.locked ? 'Locked' : node.visible === false ? 'Hidden' : node.type,
    context: 'olive-object', objectId: node.id,
    expanded: depth === 0 || selected.has(node.id), children: nodes(node.children ?? [], depth + 1),
  }));
  return nodes(scene.objects);
}

function inspectorRows(session, scene) {
  const asset = session.assets().find(item => item.alias === session.workspace?.inspection[0]);
  if (asset) return [row('asset-preview', 'Preview Asset', { icon: 'eye', operation: action('assetPreview', asset.alias) }), ...Object.entries({ name: asset.name ?? session.model().filename(asset.alias), kind: asset.kind, alias: asset.alias })
    .map(([key, value]) => row(key, pretty(key), { description: value, icon: 'symbol-property' }))];
  const node = session.model().selectionTree(scene.objects).get(session.workspace?.selection.at(-1));
  if (!node) return [row('empty', 'Select an object in Hierarchy or on the canvas', { icon: 'info' })];
  const fields = Object.entries(node.node);
  const transform = new Set(['position', 'rotation', 'scale', 'pivot', 'skew', 'anchor']);
  const internal = new Set(['id', 'prefab', 'children', 'type', 'brushId', 'label']);
  const writable = node.node.locked ? undefined : node.inheritedLock ? undefined :
    (path, value, label) => action('property', scene.id, node.node.id, path, value, label);
  const show = ([key, value]) => valueRows(value, [key], pretty(key), key === 'locked' && !node.inheritedLock ?
    (path, current, label) => action('property', scene.id, node.node.id, path, current, label) : writable);
  return [
    row('object', node.node.label, { description: node.node.type, icon: objectIcons[node.node.type] ?? 'symbol-object' }),
    row('identity', 'Identity', { expanded: true, children: [show(['label', node.node.label]),
      row('type', 'Type', { description: node.node.type }), show(['locked', node.node.locked ?? false])] }),
    row('transform', 'Transform', { expanded: true, children: fields.filter(([key]) => transform.has(key)).map(show) }),
    ...(writable && !session.model().prefabOwner(scene.objects, node.node.id) ? [
      row('details', 'Edit Object Properties as JSON…', { icon: 'json', operation: action('objectSection', scene.id, node.node.id) }),
    ] : []),
    ...(writable && node.node.type === 'Particles' ? [row('test-particles', 'Restart Particles', {
      icon: 'debug-restart', operation: action('canvas', { kind: 'particlePreview', id: node.node.id }),
    })] : []),
    ...(writable && node.node.type === 'AudioSource' ? ['playSource', 'stopSource'].map(kind => row(kind,
      kind === 'playSource' ? 'Play Audio Source' : 'Stop Audio Source', { icon: kind === 'playSource' ? 'play' : 'debug-stop',
        operation: action('canvas', { kind, id: node.node.id }) })) : []),
    ...(writable && node.node.type === 'Camera2D' ? (node.node.camera.postFXs ?? []).map((effect, index) => row('effect:' + index,
      'Preview ' + pretty(effect.type ?? 'Effect'), { icon: 'eye',
        operation: action('canvas', { kind: 'previewEffect', id: node.node.id, index }) })) : []),
    row('properties', 'Properties', { expanded: true,
      children: fields.filter(([key]) => !transform.has(key) && !internal.has(key) && key !== 'locked').map(show) }),
  ];
}

function assetRows(session, filter = '') {
  const { assetLibrary: library } = session.project;
  const assets = session.assets();
  const entries = new Map(library.entries.map(entry => [entry.alias, entry]));
  const byAlias = new Map(assets.map(asset => [asset.alias, asset]));
  const item = (asset, label) => row(asset.alias, label, {
    description: [asset.kind, ...(entries.get(asset.alias)?.tags ?? [])].join(' · '),
    icon: asset.kind === 'audio' ? 'unmute' : 'file-media', thumbnail: session.assetThumbnail(asset), context: 'olive-asset',
    assetId: asset.alias, operation: action('inspectAsset', asset.alias),
  });
  if (filter) return assets.filter(asset =>
    [asset.name, asset.alias, asset.kind, ...(entries.get(asset.alias)?.tags ?? [])].some(value => value?.toLowerCase().includes(filter))
  ).map(asset => item(asset, asset.name ?? session.model().filename(asset.alias)));
  const folders = parent => [
    ...library.folders.filter(folder => folder.parentId === parent).map(folder => row(folder.id, folder.name, {
      icon: 'folder', context: 'olive-folder', folderId: folder.id, children: folders(folder.id),
    })),
    ...library.entries.filter(entry => entry.folderId === parent && byAlias.has(entry.alias))
      .map(entry => item(byAlias.get(entry.alias), entry.name ?? session.model().filename(entry.alias))),
  ];
  return [
    row('builtin', 'Built-in', { icon: 'folder-library', expanded: true, children: assets.filter(asset => !asset.alias.startsWith('project/'))
      .map(asset => item(asset, session.model().filename(asset.alias))) }),
    row('imported', 'Project', { icon: 'folder', expanded: true, children: folders(null) }),
  ];
}

function buildRows(id, session, filter) {
  if (!session?.project) return [];
  const scene = activeScene(session);
  const operations = operationsRows(session, id, scene, row, action);
  const rows = panelRows(id, session, scene, filter);
  const structured = [
    ...(projectSections[id] ?? []).map(keys => ({ keys, scene: null })),
    ...(sceneSections[id] ?? []).map(keys => ({ keys, scene: scene.id })),
  ].map(({ keys, scene }) => row('section:' + keys.join(':'), 'Edit ' + keys.map(pretty).join(' & ') + ' as JSON…',
    { icon: 'json', operation: action('projectSection', scene, keys) }));
  return [...operations, ...rows, ...structured];
}

function panelRows(id, session, scene, filter) {
  const { project, workspace, debug } = session;
  switch (id) {
    case 'hierarchy': return hierarchyRows(scene, workspace);
    case 'inspector': return inspectorRows(session, scene);
    case 'scenes': return project.scenes.map(record => row(record.id, record.name, { context: 'olive-scene',
      sceneId: record.id, icon: record.id === project.startup ? 'home' : 'window',
      description: record.id === scene.id ? 'Active' : '', operation: action('scene', record.id) }));
    case 'assets': return assetRows(session, filter);
    case 'bundles': return [{ id: null, name: 'Default' }, ...(project.assetLibrary.bundles ?? [])].map(bundle => {
      const entries = project.assetLibrary.entries.filter(item => (item.bundleId ?? null) === bundle.id);
      return row(bundle.id ?? 'default', bundle.name, { icon: 'package', description: String(entries.length), context: bundle.id ? 'olive-bundle' : undefined, bundleId: bundle.id,
        expanded: true, children: entries.map(entry => row(entry.alias, entry.name ?? session.model().filename(entry.alias), {
          icon: 'file-media', assetId: entry.alias, context: 'olive-asset', operation: action('inspectAsset', entry.alias),
        })) });
    });
    case 'prefabs': return project.prefabs.map(prefab => row(prefab.id, prefab.name, { icon: 'symbol-class',
      operation: action('prefab', prefab.id), description: prefab.root.type, children: [
        row(prefab.id + ':place', 'Place in Scene', { icon: 'add', operation: action('canvas', { kind: 'placePrefab', id: prefab.id }) }),
        row(prefab.id + ':variant', 'Create Variant', { icon: 'git-branch', operation: action('canvas', { kind: 'variantPrefab', id: prefab.id }) }),
        row(prefab.id + ':edit', 'Edit Prefab as JSON…', { icon: 'json', operation: action('prefabSection', prefab.id) }),
      ] }));
    case 'timeline': {
      const nodes = session.model().selectionTree(scene.objects);
      const trackRows = (tracks, clipId) => tracks.map(track => {
        const id = JSON.stringify([clipId, track.id]);
        return row(id, pretty(track.property), {
          description: nodes.get(track.target)?.node.label ?? track.target, icon: 'pulse',
          children: [
            row(id + ':add', 'Add Key…', { icon: 'add', operation: action('addKey', scene.id, clipId, track.id) }),
            ...track.keys.map(key => row(id + ':' + key.id, `${key.time}s`, { icon: 'circle-outline',
              description: `${key.value} · ${pretty(key.ease)}`,
              children: [...['time', 'value', 'ease'].map(field => row(id + ':' + key.id + ':' + field, pretty(field), {
                description: String(key[field]), operation: action('timelineKey', scene.id, clipId, track.id, key.id, field, key[field]),
              })), row(id + ':' + key.id + ':remove', 'Remove Key…', { icon: 'trash', operation: action('removeKey', scene.id, clipId, track.id, key.id) })],
            })),
            row(id + ':remove', 'Remove Track…', { icon: 'trash', operation: action('removeTrack', scene.id, clipId, track.id) }),
          ],
        });
      });
      const model = session.model();
      const clips = model.clipList(scene, 'Main Clip');
      return clips.map(clip => row(clip.id, clip.name, {
        icon: 'play', expanded: clip.id === model.mainClip,
        description: scene.cinematics?.autoplay === clip.id ? 'Autoplay' : undefined,
        operation: action('clip', clip.id),
        children: [
          ...trackRows(clip.tracks, clip.id),
          row(clip.id + ':meta', 'Cues and Nested Clips', { icon: 'layers', children: [
            row(clip.id + ':cue', 'Add Cue…', { icon: 'add', operation: action('timelineCue', scene.id, clip.id) }),
            row(clip.id + ':nest', 'Nest Clip…', { icon: 'link', operation: action('timelineNested', scene.id, clip.id) }),
            row(clip.id + ':auto', scene.cinematics?.autoplay === clip.id ? 'Turn Off Autoplay' : 'Set Autoplay',
              { icon: 'play', operation: action('autoplayClip', scene.id, clip.id) }),
            ...['cues', 'nested'].flatMap(field => clip[field].map(item => row(clip.id + ':' + field + ':' + item.id,
              item.name ?? clips.find(itemClip => itemClip.id === item.clip)?.name ?? item.clip, {
                icon: field === 'cues' ? 'bookmark' : 'link', description: `${item.time ?? item.start}s`,
                children: [row(clip.id + ':' + field + ':' + item.id + ':remove', 'Remove…',
                  { icon: 'trash', operation: action('timelineRemoveItem', scene.id, clip.id, field, item.id) })],
              }))),
            ...(clip.id !== model.mainClip ? [row(clip.id + ':remove', 'Remove Clip…',
              { icon: 'trash', operation: action('removeClip', scene.id, clip.id) })] : []),
          ] }),
        ],
      }));
    }
    case 'scripts':
    case 'diagnostics': {
      const lines = (debug?.lines ?? []).filter(line => !session.consoleLevel || line.level === session.consoleLevel);
      return [
        ...(id === 'scripts' ? project.scripts.items.map(item => row(item.id, item.name, { icon: 'file-code',
          description: item.error ? 'Compile Error' : undefined,
          operation: action('source', item.id), children: [
            row(item.id + ':rename', 'Rename Script…', { icon: 'edit', operation: action('renameScript', item.id) }),
            row(item.id + ':delete', 'Delete Script…', { icon: 'trash', operation: action('deleteScript', item.id) }),
          ] })) : []),
        ...(debug?.hit ? [row('breakpoint', 'Paused at breakpoint', { icon: 'debug-breakpoint',
          description: `${project.scripts.items.find(item => item.id === debug.hit.scriptId)?.name ?? debug.hit.scriptId}:${debug.hit.line}`,
          operation: action('resume') })] : []),
        ...(debug?.watches?.length ? [row('watches', 'Live Watches', { icon: 'eye', children: debug.watches.map((value, index) =>
          row('watch:' + index, session.debugSettings?.watches[index] ?? 'Watch ' + (index + 1), { description: value })) })] : []),
        row('console', 'Preview Console', { icon: 'terminal', description: String(lines.length),
          children: lines.slice(-50).map((line, index) => row('log-' + index, line.message, {
            icon: line.level === 'error' ? 'error' : line.level === 'warn' ? 'warning' : 'info',
          })) }),
      ];
    }
    default: return (editKinds[id] ?? []).flatMap(key => {
      const value = (id === 'lighting' ? scene : project)[key] ?? panelDefaults(session.model(), project)[key];
      return value === undefined ? [] : [valueRows(value, [key], pretty(key),
        (path, value, label) => action('documentProperty', id === 'lighting' ? scene.id : null, path, value, label))];
    });
  }
}

export function registerNativeViews(context, descriptors, reportError) {
  let session;
  const openScript = registerScriptFiles(context);
  const openSection = registerSectionFiles(context);
  const trees = new Map();
  let assetFilter = '';
  const safely = work => (...args) => Promise.resolve().then(() => work(...args)).catch(reportError);
  const get = () => session?.project && session;
  const modelEdit = (current, sceneId, change) => current.change((project, model) => {
    const record = model.sceneRecord(project, sceneId);
    if (sceneId && record.id !== sceneId) return project;
    const before = model.readScene(project, record.id);
    const next = change(before, model, project);
    return next === before ? project : model.writeScene(project, record.id, next);
  });
  const sceneEdit = (current, change) => modelEdit(current, activeScene(current).id, change);

  async function promptValue(value, label) {
    const changed = typeof value === 'boolean' ? (await vscode.window.showQuickPick(['True', 'False'], { title: label })) :
      await vscode.window.showInputBox({
        title: label, value: value === null ? '' : String(value),
        validateInput: input => typeof value === 'number' && (!input.trim() || !Number.isFinite(Number(input))) ? 'Enter a number.' : undefined,
      });
    if (changed === undefined) return;
    return typeof value === 'boolean' ? changed === 'True' : typeof value === 'number' ? Number(changed) :
      value === null && !changed ? null : changed;
  }

  async function setProperty(current, sceneId, objectId, path, value, label) {
    const next = await promptValue(value, label);
    if (next === undefined || next === value) return;
    await modelEdit(current, sceneId, (scene, model) => {
      const entry = model.selectionTree(scene.objects).get(objectId);
      const owner = model.prefabOwner(scene.objects, objectId);
      if (!entry || entry.inheritedLock || (owner && owner.id !== objectId) ||
          (entry.node.locked && path[0] !== 'locked')) return scene;
      return { ...scene, objects: model.changeObject(scene.objects, objectId, object => {
        const copy = structuredClone(object);
        const parent = path.slice(0, -1).reduce((data, key) => data?.[key], copy);
        if (!parent || (parent[path.at(-1)] ?? (path[0] === 'locked' ? false : undefined)) !== value) return object;
        parent[path.at(-1)] = next;
        return copy;
      }) };
    });
  }

  async function run(operation) {
    const current = get();
    if (!current || !operation) return;
    const [first, second, third, fourth, fifth] = operation.values;
    if (await runPanelOperation(operation, current, { modelEdit, activeScene, openScript, refreshPanel: id => trees.get(id)?.refresh() })) return;
    switch (operation.id) {
      case 'scene': return current.select({ scene: first, selection: [], inspection: [] });
      case 'inspectAsset':
        await current.select({ inspection: [first] });
        return vscode.commands.executeCommand('oliveStudio.rail.inspector.focus');
      case 'property': return setProperty(current, first, second, third, fourth, fifth);
      case 'assetPreview': return current.previewAsset(first);
      case 'projectSection': {
        const keys = second;
        const model = current.model();
        const read = project => {
          const scope = first ? project.scenes.find(scene => scene.id === first) : project;
          if (!scope) return;
          const defaults = panelDefaults(model, project);
          return Object.fromEntries(keys.map(key => [key, scope[key] ?? defaults[key] ?? null]));
        };
        return openSection(current, {
          id: JSON.stringify([first, keys]), title: keys.map(pretty).join(' & '), read,
          write(project, next) {
            if (!read(project) || !next || typeof next !== 'object' || keys.some(key => !Object.hasOwn(next, key)) ||
                Object.keys(next).length !== keys.length) throw new Error('Keep the original section keys. Use null to clear optional values.');
            const patch = Object.fromEntries(keys.map(key => [key, next[key] ?? undefined]));
            if (first) return { ...project, scenes: project.scenes.map(scene => scene.id === first ? { ...scene, ...patch } : scene),
              version: keys.includes('links') ? 2 : project.version };
            const updated = { ...project, ...patch, version: 2 };
            if (patch.audioMix) {
              const { master, music, sfx, ui } = patch.audioMix;
              updated.config = { ...project.config, audio: { ...project.config.audio, volume: master, music, sfx, ui } };
            }
            return updated;
          },
        });
      }
      case 'shaderSource': {
        const find = project => project.shaders?.items.find(shader => shader.id === first);
        const shader = find(current.project);
        if (!shader) return;
        return openSection(current, {
          id: 'shader:' + first, title: shader.name, raw: true, read: project => find(project)?.source,
          write(project, source) {
            if (!find(project)) throw new Error('The shader was removed.');
            return { ...project, shaders: { ...project.shaders, items: project.shaders.items.map(shader =>
              shader.id === first ? { ...shader, source } : shader) } };
          },
        });
      }
      case 'prefabSection': {
        const read = project => project.prefabs.find(prefab => prefab.id === first);
        const initial = read(current.project);
        if (!initial) return;
        return openSection(current, {
          id: 'prefab:' + first, title: initial.name, read,
          write(project, next, model) {
            const existing = read(project);
            if (!existing || next?.id !== first || next?.root?.id !== existing.root.id) throw new Error('Keep the prefab and its root IDs.');
            const revision = model.revisePrefab(project, next);
            if (!revision) throw new Error('The prefab contains invalid dependencies.');
            return revision;
          },
        });
      }
      case 'objectSection': {
        const model = current.model();
        const find = project => model.selectionTree(project.scenes.find(scene => scene.id === first)?.objects ?? []).get(second);
        const read = project => {
          const entry = find(project);
          if (!entry) return;
          const { id: _id, type: _type, children: _children, prefab: _prefab, ...properties } = entry.node;
          return properties;
        };
        const entry = find(current.project);
        if (!entry) return;
        return openSection(current, {
          id: JSON.stringify([first, second]), title: entry.node.label, read,
          write(project, next) {
            const { inheritedLock, node } = find(project) ?? {};
            const scene = project.scenes.find(scene => scene.id === first);
            if (!node || inheritedLock || node.locked || model.prefabOwner(scene.objects, second)) throw new Error('This object is locked.');
            if (!next || Array.isArray(next) || typeof next !== 'object' ||
                ['id', 'type', 'children', 'prefab'].some(key => Object.hasOwn(next, key))) throw new Error('Edit the object properties as a JSON object.');
            const replacement = { ...next, id: node.id, type: node.type, ...(node.children ? { children: node.children } : {}) };
            return { ...project, scenes: project.scenes.map(record => record !== scene ? record :
              { ...record, objects: model.changeObject(scene.objects, second, () => replacement) }) };
          },
        });
      }
      case 'documentProperty': {
        const next = await promptValue(third, fourth);
        if (next === undefined || next === third) return;
        const updated = source => {
          const copy = structuredClone(source);
          const parent = second.slice(0, -1).reduce((value, key) => value?.[key], copy);
          if (!parent || parent[second.at(-1)] !== third) return source;
          parent[second.at(-1)] = next;
          return copy;
        };
        const key = second[0];
        const apply = (source, project) => {
          const defaults = panelDefaults(current.model(), project);
          const initial = source[key] === undefined && defaults[key] !== undefined ?
            { ...source, [key]: defaults[key] } : source;
          const result = updated(initial);
          return result === initial ? source : result;
        };
        return first ? modelEdit(current, first, (scene, _model, project) => apply(scene, project)) : current.change(project => {
          const after = apply(project, project);
          if (after === project) return project;
          if (key !== 'audioMix') return { ...after, version: 2 };
          const { master, music, sfx, ui } = after.audioMix;
          return { ...after, version: 2, config: { ...project.config, audio: { ...project.config.audio, volume: master, music, sfx, ui } } };
        });
      }
      case 'clip': {
        const model = current.model();
        const clip = model.compileClip(model.clipList(activeScene(current), 'Main Clip'), first ?? model.mainClip);
        const transport = current.timelineTransport ?? model.defaultTransport;
        if (clip) return current.invoke('vscode:timeline', { action: 'play', clip, position: transport.reverse ? clip.duration : 0, transport, fade: 0 });
        return;
      }
      case 'timelineKey': {
        const [, , , , field, value] = operation.values;
        const next = field === 'ease' ? await vscode.window.showQuickPick(current.model().timelineEases, { title: 'Easing Curve' }) :
          await promptValue(value, pretty(field));
        if (next === undefined || next === value) return;
        return modelEdit(current, first, scene => {
          const update = tracks => tracks.map(track => track.id !== third ? track : { ...track,
            keys: track.keys.map(key => key.id === fourth && key[field] === value ? { ...key, [field]: next } : key)
              .sort((a, b) => a.time - b.time) });
          return second ? { ...scene, cinematics: { ...scene.cinematics, clips: scene.cinematics.clips.map(clip =>
            clip.id === second ? { ...clip, tracks: update(clip.tracks) } : clip) } } : { ...scene, timeline: update(scene.timeline) };
        });
      }
      case 'source': return openScript(current, first);
      case 'resume': return current.invoke('vscode:debug-native-resume');
      case 'prefab': return current.invoke('vscode:edit-prefab', first);
    }
  }

  for (const descriptor of descriptors) {
    const id = descriptor.id.split('.').at(-1);
    const emitter = new vscode.EventEmitter();
    let rows;
    let elements = new Map();
    let revealing = false;
    let parents = new Map();
    const load = () => {
      if (rows) return rows;
      parents = new Map();
      elements = new Map();
      const index = (items, parent) => {
        for (const item of items) {
          parents.set(item.id, parent);
          elements.set(item.id, item);
          if (item.children) index(item.children, item);
        }
      };
      rows = buildRows(id, get(), assetFilter);
      index(rows);
      return rows;
    };
    const tree = vscode.window.createTreeView(descriptor.id, {
      canSelectMany: id === 'hierarchy' || id === 'assets',
      treeDataProvider: {
        onDidChangeTreeData: emitter.event,
        getChildren(item) { return item ? item.children ?? [] : load(); },
        getParent(item) { load(); return parents.get(item.id); },
        getTreeItem(item) {
          const state = item.children?.length ? item.expanded ? vscode.TreeItemCollapsibleState.Expanded :
            vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None;
          const result = new vscode.TreeItem(item.label, state);
          result.id = item.id;
          result.iconPath = item.thumbnail ?? (item.icon && new vscode.ThemeIcon(item.icon));
          result.description = item.description;
          result.contextValue = item.context;
          result.tooltip = `OliveStudio · ${item.label}`;
          result.accessibilityInformation = { label: [item.label, item.description].filter(Boolean).join(', ') };
          if (item.operation) result.command = { command, title: item.label, arguments: [item.operation] };
          return result;
        },
      },
      dragAndDropController: id !== 'hierarchy' ? undefined : {
        dragMimeTypes: [treeMime], dropMimeTypes: [treeMime],
        handleDrag(items, transfer) {
          if (items.length === 1) transfer.set(treeMime, new vscode.DataTransferItem({
            uri: get()?.uri.toString(), object: items[0].objectId,
          }));
        },
        handleDrop: safely(async (target, transfer) => {
          const current = get();
          const data = transfer.get(treeMime)?.value;
          if (!current || data?.uri !== current.uri.toString() || !data.object) return;
          await sceneEdit(current, (scene, model) => {
            const index = model.selectionTree(scene.objects);
            const entry = index.get(data.object), destination = index.get(target?.objectId);
            if (!entry || entry.node.type === 'Camera2D' || entry.inheritedLock || entry.node.locked || entry.node.prefab ||
                destination?.inheritedLock || destination?.node.locked || destination?.node.prefab ||
                (target && destination?.node.type !== 'Container')) return scene;
            const objects = model.moveObject(scene.objects, data.object, { placement: 'inside', id: target?.objectId ?? null });
            return objects === scene.objects ? scene : { ...scene, objects };
          });
        }),
      },
    });
    const refresh = () => {
      tree.message = session && !session.project ? 'Waiting for project data…' : undefined;
      rows = undefined;
      emitter.fire();
      if (id !== 'hierarchy' || !tree.visible || revealing) return;
      const current = get();
      const ids = current?.workspace?.selection;
      if (ids?.length !== 1 || tree.selection.some(item => item.objectId === ids[0])) return;
      load();
      const item = elements.get(ids[0]);
      if (!item) return;
      revealing = true;
      void tree.reveal(item, { select: true, focus: false, expand: false }).catch(() => {}).finally(() => { revealing = false; });
    };
    trees.set(id, { refresh, tree, getItem: key => { load(); return elements.get(key); } });
    context.subscriptions.push(tree, emitter, tree.onDidChangeVisibility(({ visible }) => session?.setPanelVisibility(id, visible)));
    if (id === 'hierarchy') {
      context.subscriptions.push(tree.onDidChangeSelection(({ selection }) => {
        const current = get();
        const ids = selection.map(item => item.objectId).filter(Boolean);
        if (!revealing && current && ids.length && JSON.stringify(ids) !== JSON.stringify(current.workspace?.selection)) {
          void current.select({ selection: ids, inspection: [] }).catch(reportError);
        }
      }));
    }
  }

  const addCommand = (id, work) => context.subscriptions.push(vscode.commands.registerCommand(id, safely(work)));
  addCommand(command, run);
  addCommand('oliveStudio.editTreeItem', item => run(item?.operation));
  addCommand('oliveStudio.addObject', async () => {
    const current = get();
    if (!current) return;
    const sceneId = activeScene(current).id;
    const type = await vscode.window.showQuickPick(['Container', 'Sprite', 'Text', 'Graphics', 'BitmapText', 'TilingSprite',
      'NineSliceSprite', 'Tilemap', 'MeshPlane', 'MeshRope', 'Particles', 'AnimatedSprite', 'Spine', 'AudioSource',
      'AudioListener', 'Light2D', 'UIWidget'], { title: 'Add Object' });
    if (!type) return;
    const object = current.model().createObject(type);
    await modelEdit(current, sceneId, scene => ({ ...scene, objects: [...scene.objects, object] }));
    await current.select({ selection: [object.id], inspection: [] });
  });
  addCommand('oliveStudio.renameObject', item => {
    const current = get();
    if (!current || !item?.objectId) return;
    const scene = activeScene(current);
    const node = current.model().selectionTree(scene.objects).get(item.objectId)?.node;
    return node && setProperty(current, scene.id, node.id, ['label'], node.label, 'Name');
  });
  addCommand('oliveStudio.deleteObject', async item => {
    const current = get();
    const scene = current && activeScene(current);
    const id = item?.objectId;
    if (!scene || !id) return;
    const target = current.model().selectionTree(scene.objects).get(id);
    if (!target) return;
    const answer = await vscode.window.showWarningMessage(`Delete “${target.node.label}”?`, { modal: true }, 'Delete');
    if (answer !== 'Delete') return;
    await modelEdit(current, scene.id, (before, model) => {
      const entry = model.selectionTree(before.objects).get(id);
      if (!entry || entry.inheritedLock || model.prefabOwner(before.objects, id)) return before;
      const subtree = model.selectionTree([entry.node]);
      if ([...subtree.values()].some(({ node }) => node.type === 'Camera2D' || node.locked)) {
        throw new Error('Unlock the object before deleting it. A scene camera is required.');
      }
      const objects = model.changeObject(before.objects, id, () => null);
      const remaining = new Set(model.selectionTree(objects).keys());
      return { ...before, objects, timeline: before.timeline.filter(track => remaining.has(track.target)),
        cinematics: before.cinematics && model.pruneCinematics(before.cinematics, remaining) };
    });
  });
  addCommand('oliveStudio.addScene', async () => {
    const current = get();
    if (!current) return;
    const name = await vscode.window.showInputBox({ title: 'New Scene', value: 'Scene', validateInput: value => value.trim() ? undefined : 'Enter a scene name.' });
    if (!name) return;
    const id = randomUUID();
    await current.change((project, model) => ({ ...project, version: 2, scenes: [...project.scenes,
      { id, name: name.trim(), objects: [model.newSceneCamera(project.config.renderer)], links: [], timeline: [] }] }));
    await current.select({ scene: id, selection: [], inspection: [] });
  });
  addCommand('oliveStudio.renameScene', async item => {
    const current = get();
    const target = current?.project.scenes.find(scene => scene.id === item?.sceneId);
    if (!target) return;
    const name = await vscode.window.showInputBox({ title: 'Rename Scene', value: target.name,
      validateInput: value => value.trim() ? undefined : 'Enter a scene name.' });
    if (!name) return;
    return current.change(project => ({ ...project, version: 2, scenes: project.scenes.map(scene =>
      scene.id === target.id ? { ...scene, name: name.trim() } : scene) }));
  });
  addCommand('oliveStudio.duplicateScene', async item => {
    const current = get();
    const target = current?.project.scenes.find(scene => scene.id === item?.sceneId);
    if (!target) return;
    const duplicate = current.model().duplicateScene(target);
    await current.change(project => ({ ...project, version: 2, scenes: [...project.scenes, duplicate] }));
    await current.select({ scene: duplicate.id, selection: [], inspection: [] });
  });
  addCommand('oliveStudio.setStartup', item => {
    const current = get();
    return current && item?.sceneId && current.change(project => ({ ...project, version: 2, startup: item.sceneId }));
  });
  addCommand('oliveStudio.importAssets', async item => {
    const current = get();
    if (!current) return;
    const sceneId = activeScene(current).id;
    const imported = await current.invoke('olive:import-assets');
    if (!imported?.length) return;
    await modelEdit(current, sceneId, (scene, model) => ({ ...scene, assets: [...scene.assets, ...imported],
      assetLibrary: model.addLibraryEntries(scene.assetLibrary, imported.map(asset => asset.alias), item?.folderId ?? null) }));
    await current.select({ inspection: imported.map(asset => asset.alias) });
  });
  addCommand('oliveStudio.addAssetFolder', async item => {
    const current = get();
    if (!current) return;
    const name = await vscode.window.showInputBox({ title: 'New Asset Folder' });
    if (!name?.trim()) return;
    return sceneEdit(current, (scene, model) => model.changeLibrary(scene,
      { type: 'create', parent: item?.folderId ?? null, id: randomUUID(), name }));
  });
  addCommand('oliveStudio.assignAsset', item => {
    const current = get();
    const asset = current?.assets().find(asset => asset.alias === item?.assetId);
    if (!asset || current.workspace?.selection.length !== 1) return;
    const id = current.workspace.selection[0];
    return sceneEdit(current, (scene, model) => {
      const target = model.selectionTree(scene.objects).get(id);
      if (!target || target.inheritedLock || target.node.locked) return scene;
      const edited = model.assignObjectAsset(target.node, asset);
      if (edited === target.node) throw new Error('Select an object that supports this asset type.');
      return { ...scene, objects: model.changeObject(scene.objects, id, () => edited) };
    });
  });
  addCommand('oliveStudio.filterAssets', async () => {
    const input = await vscode.window.showInputBox({ title: 'Filter Assets by Name, Type or Tag', value: assetFilter });
    if (input !== undefined) { assetFilter = input.trim().toLowerCase(); trees.get('assets')?.refresh(); }
  });
  addCommand('oliveStudio.previewAsset', item => item?.assetId && get()?.previewAsset(item.assetId));
  addCommand('oliveStudio.revealAsset', async item => {
    const assets = trees.get('assets');
    if (!item?.assetId || !assets) return;
    if (!assets.getItem(item.assetId)) { assetFilter = ''; assets.refresh(); }
    const target = assets.getItem(item.assetId);
    if (target) await assets.tree.reveal(target, { select: true, focus: true });
  });
  addCommand('oliveStudio.placeAsset', item => item?.assetId && get()?.canvas({ kind: 'placeAsset', alias: item.assetId }));
  addCommand('oliveStudio.renameAsset', async item => {
    const current = get();
    const target = item?.assetId ? { type: 'asset', id: item.assetId } : item?.folderId ? { type: 'folder', id: item.folderId } : null;
    if (!current || !target) return;
    const name = (await vscode.window.showInputBox({ title: 'Rename Asset or Folder', value: item.label }))?.trim();
    if (name) await sceneEdit(current, (scene, model) => model.changeLibrary(scene, { type: 'rename', item: target, name }, current.project.scenes.flatMap(scene => scene.objects)));
  });
  addCommand('oliveStudio.moveAsset', async item => {
    const current = get();
    const target = item?.assetId ? { type: 'asset', id: item.assetId } : item?.folderId ? { type: 'folder', id: item.folderId } : null;
    if (!current || !target) return;
    const destination = await vscode.window.showQuickPick([{ label: 'Project', id: null }, ...current.project.assetLibrary.folders
      .filter(folder => folder.id !== target.id).map(folder => ({ label: folder.name, id: folder.id }))], { title: 'Move Into Folder' });
    if (destination) await sceneEdit(current, (scene, model) => model.changeLibrary(scene,
      { type: 'move', item: target, parent: destination.id }, current.project.scenes.flatMap(scene => scene.objects)));
  });
  addCommand('oliveStudio.deleteAsset', async item => {
    const current = get();
    const target = item?.assetId ? { type: 'asset', id: item.assetId } : item?.folderId ? { type: 'folder', id: item.folderId } : null;
    if (!current || !target || await vscode.window.showWarningMessage(`Delete “${item.label}”?`, { modal: true }, 'Delete') !== 'Delete') return;
    await sceneEdit(current, (scene, model, project) => model.changeLibrary(scene, { type: 'delete', item: target },
      [...project.scenes.flatMap(scene => scene.objects), ...project.prefabs.map(prefab => prefab.root)]));
  });
  addCommand('oliveStudio.tagAsset', async item => {
    const current = get();
    if (!current || !item?.assetId) return;
    const entry = current.project.assetLibrary.entries.find(entry => entry.alias === item.assetId);
    if (!entry) return;
    const value = await vscode.window.showInputBox({ title: 'Asset Tags (comma separated)', value: entry.tags?.join(', ') ?? '' });
    if (value !== undefined) await sceneEdit(current, (scene, model) => model.changeLibrary(scene,
      { type: 'tags', aliases: [entry.alias], tags: [...new Set(value.split(',').map(tag => tag.trim()).filter(Boolean))] }));
  });
  addCommand('oliveStudio.renameBundle', async item => {
    const current = get();
    if (!current || !item?.bundleId) return;
    const name = (await vscode.window.showInputBox({ title: 'Rename Asset Bundle', value: item.label }))?.trim();
    if (name) await sceneEdit(current, (scene, model) => model.changeLibrary(scene,
      { type: 'bundle', operation: { type: 'save', id: item.bundleId, name } }));
  });
  addCommand('oliveStudio.removeBundle', async item => {
    const current = get();
    if (!current || !item?.bundleId || await vscode.window.showWarningMessage(`Remove “${item.label}”?`, { modal: true }, 'Remove') !== 'Remove') return;
    await sceneEdit(current, (scene, model) => model.changeLibrary(scene,
      { type: 'bundle', operation: { type: 'delete', id: item.bundleId } }));
  });
  addCommand('oliveStudio.addBundle', async () => {
    const current = get();
    if (!current) return;
    const name = await vscode.window.showInputBox({ title: 'New Asset Bundle', validateInput: value =>
      /^[a-z][a-z\d_-]{0,47}$/.test(value) && value !== 'default' ? undefined : 'Use a lowercase bundle name.' });
    if (!name) return;
    return sceneEdit(current, (scene, model) => model.changeLibrary(scene, {
      type: 'bundle', operation: { type: 'save', id: randomUUID(), name },
    }));
  });
  addCommand('oliveStudio.assignBundle', async (item, selected) => {
    const current = get();
    if (!current) return;
    const membership = new Set(current.project.assetLibrary.entries.map(entry => entry.alias));
    const selectedAssets = Array.isArray(selected) && selected.some(entry => entry.assetId === item?.assetId) ? selected : [item];
    const aliases = [...new Set(selectedAssets.map(entry => entry?.assetId).filter(alias => membership.has(alias)))];
    if (!aliases.length) return;
    const bundle = await vscode.window.showQuickPick([{ id: null, label: 'Default' },
      ...(current.project.assetLibrary.bundles ?? []).map(({ id, name }) => ({ id, label: name }))], { title: 'Assign Asset Bundle' });
    if (!bundle) return;
    return sceneEdit(current, (scene, model) => model.changeLibrary(scene,
      { type: 'bundle', operation: { type: 'assign', aliases, id: bundle.id } }));
  });
  addCommand('oliveStudio.stopTimeline', () => get()?.invoke('vscode:timeline', { action: 'stop' }));
  addCommand('oliveStudio.exportBundles', async () => {
    const current = get();
    if (!current || !current.project.assets.length) return;
    const names = new Map((current.project.assetLibrary.bundles ?? []).map(bundle => [bundle.id, bundle.name]));
    const memberships = new Map(current.project.assetLibrary.entries.map(entry => [entry.alias, entry.bundleId]));
    const output = await current.invoke('olive:export-bundles', current.project.assets.map(asset =>
      ({ ...asset, bundle: names.get(memberships.get(asset.alias)) ?? 'default' })));
    if (output) void vscode.window.showInformationMessage('Exported bundles to ' + output);
  });

  const refresh = () => { for (const tree of trees.values()) tree.refresh(); };
  return {
    setSession(active) {
      if (active === session) return;
      for (const [id] of trees) session?.setPanelVisibility(id, false);
      session = active;
      for (const [id, { tree }] of trees) active?.setPanelVisibility(id, tree.visible);
      refresh();
    },
    update(active) { if (active === session) refresh(); },
    updateRuntime(active) {
      if (active !== session) return;
      for (const id of ['input', 'globals', 'physics', 'lighting', 'network', 'audioStudio', 'prefabs', 'diagnostics', 'scripts']) {
        const view = trees.get(id);
        if (view?.tree.visible) view.refresh();
      }
    },
    updateDebug(active) { if (active === session) { trees.get('scripts')?.refresh(); trees.get('diagnostics')?.refresh(); } },
  };
}
