/**
 * Runs inside the script sandbox after the XState bundle: one actor per Behavior component, built from the script's
 * `machine` export. Game events become typed actor events; delays use the sandbox's game-clock timers, so Pause stops
 * them and Step advances them by the step's time. Nothing here reaches the host except through the provider API.
 */
export const behaviorSandbox = String.raw`"use strict";
globalThis.xstate = globalThis.XState;
__kind('behavior.machine', api => {
  const actors = [], HISTORY = 20, SENDS_PER_FRAME = 256, CONTEXT_CHARS = 2000;
  const owned = {onClick: 'click', onCollision: 'collision', onCollisionExit: 'collisionExit', onArrive: 'arrive', onTimer: 'timer', onComplete: 'complete', onMarker: 'marker', onBeat: 'beat', onSoundEnd: 'soundEnd'};
  const shared = {onInput: 'input', onGlobal: 'global', onMessage: 'message', onDialogue: 'dialogue'};
  const paths = (value, prefix) => typeof value === 'string' ? [prefix ? prefix + '.' + value : value] : Object.entries(value || {}).flatMap(([k, v]) => { const here = prefix ? prefix + '.' + k : k; const inner = paths(v, here); return inner.length ? inner : [here]; });
  const withAncestors = leaves => { const out = new Set(); for (const leaf of leaves) { const parts = leaf.split('.'); for (let i = 1; i <= parts.length; i++) out.add(parts.slice(0, i).join('.')); } return [...out]; };
  const machineOf = exports => { const m = exports && exports.machine; if (!m || typeof m.provide !== 'function' || !m.root) throw new Error('the script has no machine export (export const machine = xstate.setup({...}).createMachine({...}))'); return m; };
  const nodePaths = machine => { const out = []; const visit = node => { for (const child of Object.values(node.states || {})) { out.push(child.path.join('.')); visit(child); } }; visit(machine.root); return out; };
  const eventTypes = machine => { const out = new Set(); const visit = node => { for (const t of Object.keys(node.config.on || {})) if (t && !t.startsWith('xstate.')) out.add(t); for (const child of Object.values(node.states || {})) visit(child); }; visit(machine.root); return [...out].sort(); };
  const plain = (v, depth = 0) => {
    if (v === null || typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') return typeof v === 'number' && !Number.isFinite(v) ? null : v;
    if (v === undefined || typeof v === 'function') return undefined;
    if (depth > 6) return '…';
    if (Array.isArray(v)) return v.slice(0, 50).map(x => plain(x, depth + 1) ?? null);
    if (typeof v === 'object' && v.constructor && v.constructor.name === 'GameObject') { try { return {object: v.name, id: v.id}; } catch { return {object: '(removed)'}; } }
    const out = {}; for (const k of Object.keys(v).slice(0, 50)) { const x = plain(v[k], depth + 1); if (x !== undefined) out[k] = x; } return out;
  };
  const describe = a => {
    const snap = a.actor && a.actor.getSnapshot();
    let context = snap ? JSON.stringify(plain(snap.context)) ?? 'null' : 'null';
    if (context.length > CONTEXT_CHARS) context = context.slice(0, CONTEXT_CHARS) + '…';
    return {
      key: a.key, entityId: a.entityId, object: (() => { try { return a.self.name; } catch { return '(removed)'; } })(), script: a.name,
      machine: a.machine ? {id: a.machine.id, version: a.machine.version ?? null} : null,
      status: a.error ? 'error' : !a.actor ? 'idle' : snap.status === 'done' ? 'done' : a.stopped ? 'stopped' : snap.status === 'error' ? 'error' : 'active',
      value: snap ? plain(snap.value) : null, states: a.states, context,
      children: snap ? Object.keys(snap.children || {}) : [], events: a.machine ? eventTypes(a.machine) : [],
      history: a.history.slice(), guards: plain(a.exports.guardResults || {}), error: a.error || null,
    };
  };
  const fail = (a, error) => { if (a.error) return; a.error = error && error.message ? error.message : String(error); api.report(a.name + ' (' + describe(a).object + '): the behavior stopped — ' + a.error); stop(a); };
  const stop = a => { a.stopped = true; if (a.sub) { try { a.sub.unsubscribe(); } catch {} a.sub = null; } if (a.actor) { try { a.actor.stop(); } catch {} } };
  const observe = (a, snap, cause) => {
    const leaves = paths(snap.value, ''), next = withAncestors(leaves), before = new Set(a.all);
    const changed = leaves.join('|') !== a.states.join('|');
    a.states = leaves; a.all = next;
    if (changed) { a.history.push({time: game.time, event: cause, from: a.previous, to: leaves}); a.previous = leaves; if (a.history.length > HISTORY) a.history.shift(); }
    if (a.entityId) for (const p of next) if (!before.has(p)) api.emit('behavior.state', a.entityId, p);
  };
  const start = a => {
    if (a.actor || a.error || a.stopped) return;
    try {
      a.machine = machineOf(a.exports);
      if (a.pin && (a.pin.id !== a.machine.id || (a.pin.version != null && String(a.pin.version) !== String(a.machine.version ?? '')))) throw new Error('expects machine ' + a.pin.id + (a.pin.version != null ? ' v' + a.pin.version : '') + ' but the script defines ' + a.machine.id + (a.machine.version != null ? ' v' + a.machine.version : ''));
      let cause = '(start)';
      a.clock = {now: 0, next: 0, timers: new Map(),
        setTimeout(fn, ms) { const id = ++this.next; this.timers.set(id, {at: this.now + Math.max(0, Number(ms) || 0), fn}); return id; },
        clearTimeout(id) { this.timers.delete(id); },
        advance(dt) { this.now += dt * 1000; let budget = 256; for (;;) { const due = [...this.timers].filter(([, t]) => t.at <= this.now + 1e-7).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0]; if (!due) break; if (--budget < 0) throw new Error('Too many behavior timers in one frame'); this.timers.delete(due[0]); due[1].fn(); } },
      };
      a.actor = xstate.createActor(a.machine, {clock: a.clock, input: {self: a.self, params: a.self.params}, inspect: ev => { if (ev.type === '@xstate.event' && ev.actorRef === a.actor) cause = ev.event && ev.event.type || cause; }});
      a.sub = a.actor.subscribe({next: snap => { observe(a, snap, cause); if (snap.status === 'done') a.history.push({time: game.time, event: cause, from: a.previous, to: ['(done)']}); }, error: error => fail(a, error)});
      a.previous = [];
      a.actor.start();
      const snap = a.actor.getSnapshot();
      if (snap.status === 'error') fail(a, snap.error); else observe(a, snap, '(start)');
    } catch (error) { fail(a, error); }
  };
  const deliver = (a, event) => {
    if (!a.actor || a.error || a.stopped) return false;
    if (++a.sent > SENDS_PER_FRAME) { if (!a.flooded) { a.flooded = true; api.report(a.name + ': more than ' + SENDS_PER_FRAME + ' behavior events in one frame (dropped; an event loop?)'); } return false; }
    const before = api.current; api.current = a.name + '.' + event.type;
    try { a.actor.send(event); } catch (error) { fail(a, error); } finally { api.current = before; }
    const snap = a.actor && a.actor.getSnapshot();
    if (snap && snap.status === 'error') fail(a, snap.error);
    return true;
  };
  const checkpoint = (a, value) => {
    const c=a.exports.checkpoint;if(!c||!Number.isInteger(c.version)||c.version<1||typeof c.save!=='function'||typeof c.restore!=='function')throw new Error('Export checkpoint = {version, save, restore, migrate?} to support domain checkpoints');
    if(value===undefined){const data=JSON.parse(JSON.stringify(c.save({snapshot:a.actor.getSnapshot(),self:a.self,params:a.self.params})));const out={formatVersion:1,machineId:a.machine.id,dataVersion:c.version,data};if(JSON.stringify(out).length>32000)throw new Error('Behavior checkpoint exceeds 32 KB');return out;}
    if(!value||value.formatVersion!==1||value.machineId!==a.machine.id||!Number.isInteger(value.dataVersion)||value.dataVersion<1)throw new Error('Incompatible behavior checkpoint');
    if(value.dataVersion>c.version)throw new Error('Checkpoint is newer than this machine');
    let data=JSON.parse(JSON.stringify(value.data));
    if(value.dataVersion!==c.version){if(typeof c.migrate!=='function')throw new Error('Checkpoint migration is required');data=c.migrate(data,value.dataVersion,c.version);}
    const event=c.restore({data,self:a.self,params:a.self.params});
    // Author-defined restore produces a normal event: guards and actions still own the transition.
    if(!event||typeof event.type!=='string'||event.type.startsWith('xstate.'))throw new Error('Checkpoint restore must return a domain event');
    deliver(a,event);return describe(a);
  };
  const live = a => !a.error && !a.stopped && (!a.entityId || api.alive(a.entityId));
  const find = target => { const id = target && typeof target === 'object' ? target.id : String(target); return actors.find(a => a.entityId === id && live(a)); };
  const toEvent = (event, data) => { const e = typeof event === 'string' ? Object.assign({}, data && typeof data === 'object' ? data : {}, {type: event}) : event; if (!e || typeof e.type !== 'string' || !e.type) throw new TypeError('A behavior event needs a type'); if (e.type.startsWith('xstate.')) throw new TypeError('xstate.* events are internal'); return e; };
  globalThis.behavior = Object.freeze({
    /** Send an event to an object's behavior: behavior.send(enemy, 'hit', {damage: 2}) or behavior.send(enemy, {type: 'hit'}). */
    send(target, event, data) { const a = find(target); if (!a) throw new Error('That object has no running behavior'); return deliver(a, toEvent(event, data)); },
    /** The behavior's active states (leaf paths such as 'movement.walking') — empty when it has none. */
    states(target) { const a = find(target); return a ? a.states.slice() : []; },
    /** Whether a state (or one of its children) is active: behavior.matches(hero, 'movement'). */
    matches(target, path) { const a = find(target); return Boolean(a && a.all.includes(String(path))); },
    checkpoint(target) { const a=find(target);if(!a)throw new Error('No running behavior');return checkpoint(a); },
    restore(target,value) { const a=find(target);if(!a)throw new Error('No running behavior');return checkpoint(a,value); },
    /** The running actor's snapshot (value, context, status) for reading; change it only through events. */
    snapshot(target) { const a = find(target); return a && a.actor ? a.actor.getSnapshot() : null; },
  });
  return {
    attach(i) { actors.push({key: i.key, entityId: i.entityId, scriptId: i.scriptId, name: i.name, exports: i.exports, self: i.self, pin: i.data && i.data.machine || null, actor: null, sub: null, machine: null, states: [], all: [], previous: [], history: [], sent: 0, flooded: false, stopped: false, error: ''}); },
    start() { for (const a of actors) if (!a.actor && !a.error && !a.stopped && (!a.entityId || api.alive(a.entityId))) start(a); },
    frame(dt) {
      for (let i = actors.length - 1; i >= 0; i--) { const a = actors[i]; if (a.entityId && !api.exists(a.entityId)) { stop(a); actors.splice(i, 1); } }
      for (const a of actors) { a.sent = 0; a.flooded = false; }
      for (const a of actors) if (live(a) && a.clock) { try { a.clock.advance(dt); } catch (error) { fail(a, error); } }
      for (const a of actors) if (live(a) && a.exports.tick === true) deliver(a, {type: 'tick', dt});
    },
    event(kind, entityId, args) {
      const type = owned[kind] || shared[kind]; if (!type) return;
      const event = kind === 'onCollision' ? {type, other: args[0], contact: args[1]} : kind === 'onCollisionExit' ? {type, other: args[0]} : kind === 'onInput' ? {type: 'input.' + args[1], action: args[0]} : kind === 'onGlobal' ? {type, name: args[0], value: args[1]} : kind === 'onMessage' ? {type, message: args[0], data: args[1]} : kind === 'onDialogue' ? {type, event: args[0], dialogue: args[1]} : kind === 'onMarker' ? {type, name: args[0]} : kind === 'onBeat' ? {type, beat: args[0]} : {type};
      for (const a of actors) if (live(a) && (!owned[kind] || a.entityId === entityId)) deliver(a, event);
    },
    listens(kind, entityId) { return kind === 'onClick' && actors.some(a => live(a) && a.entityId === entityId && a.machine && eventTypes(a.machine).includes('click')); },
    swap(scriptId, exports) {
      for (const a of actors) if (a.scriptId === scriptId && !a.error) { stop(a); Object.assign(a, {exports, actor: null, sub: null, machine: null, states: [], all: [], previous: [], stopped: false}); a.history.push({time: game.time, event: '(script edited)', from: [], to: []}); start(a); }
    },
    call(op, arg) {
      if(op==='checkpoint'||op==='restore'){const a=find(arg.entityId);if(!a)throw new Error('No running behavior');return checkpoint(a,op==='restore'?arg.value:undefined);}
      if (op === 'inspect') { const id = arg && arg.entityId; return actors.filter(a => !id || a.entityId === id).slice(0, 200).map(describe); }
      if (op === 'send') {
        const a = actors.find(x => x.entityId === String(arg && arg.entityId) && live(x)); if (!a) throw new Error('That object has no running behavior');
        const event = toEvent(arg.event);
        if (!eventTypes(a.machine).some(t => t === event.type || (t.endsWith('.*') && event.type.startsWith(t.slice(0, -1))) || t === '*')) throw new Error('The machine ' + a.machine.id + ' does not handle ' + event.type + ' (handles: ' + eventTypes(a.machine).join(', ') + ')');
        deliver(a, event); return describe(a);
      }
      if (op === 'machines') return actors.map(a => ({entityId: a.entityId, script: a.name, machine: a.machine ? {id: a.machine.id, version: a.machine.version ?? null, states: nodePaths(a.machine), events: eventTypes(a.machine)} : null, error: a.error || null}));
      throw new Error('Unknown behavior request ' + op);
    },
  };
});
`;
