import {GlobalStore} from '@rewrite/interactions';
import {beforeAll, expect, it} from 'vitest';
import type {QuickJSWASMModule} from 'quickjs-emscripten-core';
import type {Entity} from '@rewrite/scene';
import {compileScript} from './compile';
import {describeScript, loadScriptEngine, ScriptSession, type ScriptHost} from './session';
import {globalsDeclaration, scriptTemplate, type ScriptLibrary} from './contracts';

let engine: QuickJSWASMModule;
beforeAll(async () => { engine = await loadScriptEngine(); });

const entity = (id: string, name: string, extra: Entity['components'] = []): Entity => ({id, name, active: true, parentId: null, components: [{id: `${id}-t`, type: 'scene.transform2d', version: 1, data: {x: 100, y: 50, rotation: 0, scaleX: 1, scaleY: 1}}, ...extra]} as unknown as Entity);
const behaviour = (id: string, scriptId: string, params: Record<string, unknown> = {}, refs: Record<string, string> = {}) => ({id, type: 'scripts.behaviour', version: 1, data: {scriptId, params, refs}}) as unknown as Entity['components'][number];
const library = (...scripts: {id: string; name: string; source: string}[]): ScriptLibrary => ({version: 1, items: scripts.map(s => ({...s, ...compileScript(s.source, s.name)}))});
function host(entities: Entity[], extra: Partial<ScriptHost> = {}) {
 const values = new GlobalStore({version: 1, items: [{id: 'v1', name: 'score', type: 'number', initial: 0}, {id: 'v2', name: 'hero', type: 'string', initial: 'knight'}, {id: 'v3', name: 'paused', type: 'boolean', initial: false}]}), log: string[] = [], invoked: string[] = [], scenes: string[] = [];
 const h: ScriptHost = {
  entities: () => entities, time: () => 1.5, stage: {width: 960, height: 540},
  names: {globals: values.list.map(g => ({id: g.id, name: g.name})), scenes: [{id: 's2', name: 'Level 2'}], actions: [{id: 'a1', name: 'jump'}]},
  globals: values,
  setActive: (id, v) => { entities.find(e => e.id === id)!.active = v; },
  changeScene: id => { scenes.push(id); }, invoke: (service, method, id) => { invoked.push(`${service}.${method}:${id}`); },
  log: (level, message) => { log.push(`${level}: ${message}`); }, ...extra,
 };
 return {h, values, log, invoked, scenes};
}

it('compiles TypeScript with line numbers kept and refuses imports or broken syntax', () => {
 const ok = compileScript('const speed: number = 2;\nexport function update(self: GameObject, dt: number) { self.x += speed * dt; }', 'Mover');
 expect(ok.error).toBeUndefined(); expect(ok.code).toContain('exports.update'); expect(ok.code.split('\n')).toHaveLength(2);
 expect(compileScript('// hi\nimport {x} from "fs";', 'Bad').error).toBe('Bad: line 2: scripts cannot import modules; use the game API');
 expect(compileScript('export function update( {', 'Broken').error).toMatch(/^Broken: line 1: /);
 expect(compileScript(scriptTemplate, 'Template').error).toBeUndefined();
});

it('runs hooks against the play world: params, state, transforms, globals, services, scenes, messages, logs', () => {
 const player = entity('p', 'Player', [behaviour('b1', 's1', {speed: 10}), {id: 'snd', type: 'audio.source', version: 1, data: {}} as never, {id: 'shape', type: 'pixi.shape', version: 1, data: {alpha: 1}} as never]);
 const coin = entity('c', 'Coin', [behaviour('b2', 's2')]);
 const {h, values, log, invoked, scenes} = host([player, coin]);
 const lib = library(
  {id: 's1', name: 'Mover', source: `export const params = {speed: 1, jump: 3};
export function start(self: GameObject) { self.state.started = game.time; }
export function update(self: GameObject, dt: number) { self.x += self.params.speed * dt * 60; self.alpha = 0.5; if (game.isDown('jump')) self.y -= self.params.jump; }
export function onClick(self: GameObject) { globals.score += 2; if (!globals.paused && 'hero' in globals) globals.hero = globals.hero + '!'; self.play('audio'); game.send('hit', {by: self.name}); console.log('clicked', self, {n: 1}); }
export function onInput(self: GameObject, action: string, phase: string) { if (phase === 'released') game.changeScene('Level 2'); }`},
  {id: 's2', name: 'Coin', source: `export default { onMessage(self: GameObject, message: string, data: any) { if (message === 'hit') { self.active = false; game.log(data.by, 'took', self.name); } }, onGlobal(self: GameObject, name: string, value: number) { game.find('Player')!.rotation = value * 10; } };`},
 );
 const session = new ScriptSession(engine, lib, h, message => log.push(`report: ${message}`));
 expect(session.count).toBe(2);
 session.system.update!(1 / 60);
 const t = player.components[0].data as Record<string, number>;
 expect(t.x).toBeCloseTo(110); expect((player.components[3].data as {alpha: number}).alpha).toBe(0.5);
 session.observe({type: 'input.pressed', sourceId: 'a1', silent: false});
 session.system.update!(1 / 60);
 expect(t.y).toBe(47);
 session.observe({type: 'pointer.click', sourceId: 'p', silent: false});
 expect(values.get('v1')).toBe(2); expect(values.get('v2')).toBe('knight!'); expect(invoked).toEqual(['audio.play:snd']);
 expect(coin.active).toBe(false);
 expect(log).toEqual(['info: clicked GameObject(Player) {"n":1}', 'info: Player took Coin']);
 session.observe({type: 'global.change', sourceId: 'v1', silent: false});
 expect(t.rotation).toBe(0); // the coin is inactive now: its hooks no longer run
 session.observe({type: 'input.released', sourceId: 'a1', silent: false});
 expect(scenes).toEqual(['s2']);
 session.dispose();
});

it('isolates failures: a throwing hook stops only its script, with the source line; bad API use is an error', () => {
 const a = entity('a', 'A', [behaviour('b1', 's1')]), b = entity('b', 'B', [behaviour('b2', 's2')]);
 const reports: string[] = [], {h} = host([a, b]);
 const session = new ScriptSession(engine, library(
  {id: 's1', name: 'Broken', source: 'export function update(self: GameObject) {\n  self.x = 1;\n  (self as any).missing.call();\n}'},
  {id: 's2', name: 'Fine', source: 'export function update(self: GameObject) { self.x += 1; globals.nope = 1; }'},
 ), h, m => reports.push(m));
 session.system.update!(1 / 60);
 session.system.update!(1 / 60);
 expect(reports[0]).toMatch(/^Broken \(line 3\): update stopped this script — /);
 expect(reports[1]).toBe('Fine (line 1): update stopped this script — No global named "nope"');
 expect(reports).toHaveLength(2);
 expect((b.components[0].data as {x: number}).x).toBe(101);
 session.dispose();
});

it('sandbox: no host globals, endless loops and memory bombs are stopped', () => {
 const probe = entity('a', 'A', [behaviour('b1', 's1')]), reports: string[] = [], {h, log} = host([probe]);
 new ScriptSession(engine, library({id: 's1', name: 'Probe', source: 'export function start() { game.log(typeof process, typeof window, typeof document, typeof fetch, typeof require, typeof setTimeout, typeof globalThis.__host); }'}), h, m => reports.push(m)).system.update!(0);
 expect(log).toEqual(['info: undefined undefined undefined undefined undefined function undefined']); // setTimeout is the game-clock timer
 const loop = new ScriptSession(engine, library({id: 's1', name: 'Loop', source: 'export function update() { while (true) {} }'}), h, m => reports.push(m), {callMs: 50, memoryBytes: 32 << 20, stackBytes: 512 << 10, messagesPerFrame: 10});
 loop.system.update!(0); loop.system.update!(0);
 expect(reports.at(-1)).toBe('Scripts stopped: Loop.update ran longer than 50 ms (endless loop?)');
 const bomb = new ScriptSession(engine, library({id: 's1', name: 'Bomb', source: 'export function update() { const a: string[] = []; for (;;) a.push("x".repeat(1 << 16)); }'}), h, m => reports.push(m), {callMs: 5000, memoryBytes: 16 << 20, stackBytes: 512 << 10, messagesPerFrame: 10});
 bomb.system.update!(0);
 expect(reports.at(-1)).toBe('Bomb (line 1): update stopped this script — out of memory');
 const ping = new ScriptSession(engine, library({id: 's1', name: 'Ping', source: 'export function start() { game.send("ping"); } export function onMessage() { game.send("ping"); }'}), h, m => reports.push(m), {callMs: 1000, memoryBytes: 32 << 20, stackBytes: 512 << 10, messagesPerFrame: 10});
 ping.system.update!(0);
 expect(reports.at(-1)).toBe('Too many game.send messages in one frame (limit reached)');
});

it('scenes without scripts start nothing; missing or uncompiled scripts refuse to start', () => {
 const {h} = host([entity('a', 'A')]);
 expect(new ScriptSession(engine, {version: 1, items: []}, h, () => {}).count).toBe(0);
 expect(() => new ScriptSession(engine, {version: 1, items: []}, host([entity('a', 'A', [behaviour('b', 'gone')])]).h, () => {})).toThrow('A: the attached script is missing');
 expect(() => new ScriptSession(engine, library({id: 's1', name: 'Bad', source: 'export function ('}), host([entity('a', 'A', [behaviour('b', 's1')])]).h, () => {})).toThrow(/^Bad: line 1/);
});

it('typed params: Inspector fields from the params export, defaults, overrides and object references', () => {
 const source = `export const params = {
  speed: param.number(120, {min: 0, max: 600, step: 10}), jump: 3, label: 'hi', tint: '#ff0000',
  mode: param.choice(['patrol', 'chase'], 'chase'), debug: param.bool(), target: param.object({label: 'Follow'}),
};
export function start(self: GameObject) { const t = self.params.target as GameObject | null; game.log(self.params.speed, self.params.jump, self.params.mode, self.params.debug, t ? t.name : 'none', t ? t.x : 0); }`;
 const compiled = compileScript(source, 'Typed');
 expect(describeScript(engine, compiled.code, 'Typed')).toEqual({fields: [
  {name: 'speed', kind: 'number', default: 120, min: 0, max: 600, step: 10}, {name: 'jump', kind: 'number', default: 3}, {name: 'label', kind: 'text', default: 'hi'},
  {name: 'tint', kind: 'color', default: '#ff0000'}, {name: 'mode', kind: 'choice', default: 'chase', options: ['patrol', 'chase']}, {name: 'debug', kind: 'bool', default: false},
  {name: 'target', kind: 'object', default: null, label: 'Follow'},
 ]});
 expect(describeScript(engine, compileScript('export const params = {bad: [1]};').code, 'X').error).toBe('X: params.bad must be a number, true/false, text, #colour or a param.* value');
 expect(describeScript(engine, compileScript('game.log(1); export const params = {};').code, 'Y').error).toBe('Y: params: game is only available inside hooks');
 expect(describeScript(engine, compileScript('while (true) {}').code, 'Z').error).toMatch(/^Z: params: interrupted/);
 const goal = entity('g', 'Goal'), a = entity('a', 'A', [behaviour('b1', 's1', {speed: 50, debug: true}, {target: 'g'})]), b = entity('b', 'B', [behaviour('b2', 's1', {}, {target: 'gone'})]);
 const {h, log} = host([goal, a, b]);
 new ScriptSession(engine, library({id: 's1', name: 'Typed', source}), h, () => {}).system.update!(0);
 expect(log).toEqual(['warn: B: target points to an object that is not in this scene (null)', 'info: 50 3 chase true Goal 100', 'info: 120 3 chase false none 0']);
});

it('hierarchy and the scene script: parent/children, a scene-wide script with params and messages', () => {
 const root = entity('r', 'Root'), child = {...entity('c', 'Child'), parentId: 'r'} as Entity, other = {...entity('o', 'Other'), parentId: 'r'} as Entity;
 const listener = entity('l', 'L', [behaviour('bl', 's2')]);
 const {h, log, values} = host([root, child, other, listener], {scene: {name: 'Main', behaviour: {scriptId: 's1', params: {lives: 5}, refs: {hero: 'c'}}}});
 const lib = library(
  {id: 's1', name: 'Director', source: `export const params = {lives: param.number(3), hero: param.object()};
export function start(self: SceneSelf) { game.log(String(self), self.params.lives, self.params.hero.parent.name, game.find('Root')!.children.map(c => c.name).join('+'), game.find('Root')!.parent); globals.score = self.params.lives; game.send('ready'); }`},
  {id: 's2', name: 'Listener', source: 'export function onMessage(self: GameObject, m: string) { game.log(self.name, "got", m); }'},
 );
 const session = new ScriptSession(engine, lib, h, m => log.push(m));
 expect(session.count).toBe(2); // the object script and the scene script
 session.system.update!(0);
 expect(log).toEqual(['info: Scene(Main) 5 Root Child+Other null', 'info: L got ready']);
 expect(values.get('v1')).toBe(5);
 expect(() => new ScriptSession(engine, {version: 1, items: []}, host([], {scene: {name: 'Main', behaviour: {scriptId: 'gone', params: {}, refs: {}}}}).h, () => {})).toThrow('Main: the attached script is missing');
});

it('copies keep object parameters inside the copied group', async () => {
 const {scriptsModule} = await import('./index');
 const contributed: {value: {remapReferences?(v: unknown, ids: unknown): unknown}}[] = [];
 scriptsModule.activate({contribute: (_slot: unknown, _id: string, value: never) => { contributed.push({value}); }} as never);
 const definition = contributed.map(c => c.value).find(v => (v as {type?: string}).type === 'scripts.behaviour')!;
 expect(definition.remapReferences!({scriptId: 's', params: {speed: 1}, refs: {target: 'old', outside: 'keep'}}, {entities: new Map([['old', 'new']]), components: new Map()})).toEqual({scriptId: 's', params: {speed: 1}, refs: {target: 'new', outside: 'keep'}});
});

it('RxJS in the sandbox: frame$, game.on streams, game-clock timers and operators, timeline handles', () => {
 const a = entity('a', 'A', [behaviour('b1', 's1'), {id: 'anim', type: 'animation.player', version: 1, data: {clips: [{id: 'c1', name: 'Intro'}, {id: 'c2', name: 'Outro'}]}} as never]);
 const calls: string[] = [], {h, log} = host([a], {animation: {
  play: (id, clip, fade) => calls.push(`play ${id} ${clip ?? ''}${fade === undefined ? '' : ' fade ' + fade}`), pause: id => calls.push(`pause ${id}`), resume: id => calls.push(`resume ${id}`),
  seekPlayer: (id, t) => calls.push(`seek ${id} ${t}`), setSpeed: (id, v) => calls.push(`speed ${id} ${v}`), reverse: id => calls.push(`reverse ${id}`),
  state: () => ({clipId: 'c1', time: calls.length / 10, total: 2, running: true, speed: 1, direction: 1}),
 }});
 const session = new ScriptSession(engine, library({id: 's1', name: 'Rx', source: `
export function start(self: GameObject) {
  game.frame$.pipe(rx.skip(1), rx.take(2)).subscribe(f => game.log('frame', f.dt));
  game.on('click', self).pipe(rx.scan((n: number) => n + 1, 0)).subscribe(n => game.log('clicks', n));
  rx.timer(500).subscribe(() => game.log('timer at', Math.round(rx.asyncScheduler.now())));
  rx.interval(250).pipe(rx.take(3), rx.toArray()).subscribe(v => game.log('interval', v.join(',')));
  setTimeout(() => game.log('timeout'), 100);
  const tl = self.timeline('Outro');
  tl.play(); tl.speed(2); tl.reverse(); tl.seek(0.5); tl.pause(); tl.resume(); tl.crossFade(); self.timeline('Intro').crossFade(1.5);
  tl.markers$.subscribe(name => game.log('marker', name));
  tl.complete$.subscribe(o => game.log('complete', o.name));
  game.on('message').subscribe(m => game.log('message', m.message));
  rx.of(1).pipe(rx.map(() => { throw new Error('bad stream'); })).subscribe();
}`}), h, m => log.push(`report: ${m}`));
 // Start runs in the first frame (clock 0.125), so its timers are due 0.125 s later than written.
 for (let i = 0; i < 7; i++) session.system.update!(0.125);
 session.observe({type: 'pointer.click', sourceId: 'a', silent: false});
 session.observe({type: 'pointer.click', sourceId: 'a', silent: false});
 session.observe({type: 'animation.marker', sourceId: 'anim', event: 'hit', silent: false});
 session.observe({type: 'animation.complete', sourceId: 'anim', silent: false});
 session.broadcast('boss');
 expect(calls).toEqual(['play anim c2', 'speed anim 2', 'reverse anim', 'seek anim 0.5', 'pause anim', 'resume anim', 'play anim c2 fade 0.3', 'play anim c1 fade 1.5']);
 expect(log.filter(l => !l.includes('bad stream'))).toEqual(['info: timeout', 'info: frame 0.125', 'info: frame 0.125', 'info: timer at 625', 'info: interval 0,1,2', 'info: clicks 1', 'info: clicks 2', 'info: marker hit', 'info: complete A', 'info: message boss']);
 expect(log.some(l => l.includes('Unhandled error in a stream: bad stream'))).toBe(true);
 session.dispose();
});

it('sound API: handles with live volume, fades, buses, crossfade, beat$/ended$ and onBeat', () => {
 const music = entity('m', 'Music', [behaviour('b1', 's1'), {id: 'snd-m', type: 'audio.source', version: 1, data: {volume: 1, rate: 1}} as never]);
 const jingle = entity('j', 'Jingle', [{id: 'snd-j', type: 'audio.source', version: 1, data: {volume: 1, rate: 1}} as never]);
 const calls: string[] = [], buses: Record<string, number> = {music: 1, sfx: 1, ui: 1};
 const {h, log} = host([music, jingle], {audio: {
  play: id => calls.push(`play ${id}`), stop: id => calls.push(`stop ${id}`), fade: (id, to, s, stop) => calls.push(`fade ${id} ${to} ${s}${stop ? ' stop' : ''}`),
  setBus: (b, v) => { buses[b] = v; }, bus: b => buses[b], state: () => ({state: 'playing', fade: 1, beat: 8, position: 4.2}),
 }});
 const session = new ScriptSession(engine, library({id: 's1', name: 'Dj', source: `
export function start(self: GameObject) {
  const s = self.sound();
  s.volume = 0.5; s.rate = 2; s.fadeIn(2); s.fadeTo(0.3); s.fadeOut();
  game.audio.bus('music').volume = 0.4;
  game.audio.crossfade(self, game.find('Jingle'), 3);
  game.log(s.volume, s.rate, s.playing, s.beat, s.position, game.audio.bus('music').volume);
  s.bar$.subscribe(bar => game.log('bar', bar));
  s.ended$.subscribe(o => game.log('ended', o.name));
}
export function onBeat(self: GameObject, beat: number) { game.log('beat', beat); }`}), h, m => log.push(`report: ${m}`));
 session.system.update!(0);
 session.observe({type: 'audio.beat', sourceId: 'snd-m', event: 'beat', silent: false});
 session.observe({type: 'audio.beat', sourceId: 'snd-m', event: 'bar', silent: false});
 session.observe({type: 'audio.ended', sourceId: 'snd-m', silent: false});
 expect(calls).toEqual(['fade snd-m 1 2', 'fade snd-m 0.3 1', 'fade snd-m 0 1 stop', 'fade snd-m 0 3 stop', 'fade snd-j 1 3']);
 expect((music.components[2].data as {volume: number; rate: number})).toEqual({volume: .5, rate: 2});
 expect(buses.music).toBe(.4);
 expect(log).toEqual(['info: 0.5 2 true 8 4.2 0.4', 'info: beat 8', 'info: bar 2', 'info: ended Music']);
 session.dispose();
});

it('localization: game.t with values and count, game.language and setLanguage', async () => {
 const {createLanguageStore} = await import('@rewrite/interactions');
 const store = createLanguageStore({version: 1, defaultLanguage: 'en', languages: [{id: 'en', name: 'English'}, {id: 'tr', name: 'Turkish'}], entries: [{key: 'hi', values: {en: 'Hi {{name}}', tr: 'Selam {{name}}'}}, {key: 'coins_one', values: {en: '{{count}} coin'}}, {key: 'coins_other', values: {en: '{{count}} coins'}}]});
 const a = entity('a', 'A', [behaviour('b1', 's1')]), {h, log} = host([a], {language: {current: () => store.language, set: id => store.setLanguage(id), t: (key, values) => store.text(key, values as Record<string, string | number>)}});
 const session = new ScriptSession(engine, library({id: 's1', name: 'Lang', source: 'export function start() { game.log(game.t("hi", {name: "Ada"}), game.t("coins", {count: 2}), game.t("nope"), game.language); game.setLanguage("tr"); game.log(game.t("hi", {name: "Ada"}), game.language); }'}), h, () => {});
 session.system.update!(1 / 60);
 expect(log).toEqual(['info: Hi Ada 2 coins nope en', 'info: Selam Ada tr']);
 session.dispose();
});

it('spawns copies that run their own scripts next frame, destroys objects, edits text and reads the pointer', () => {
 const template = {...entity('tpl', 'Bullet', [behaviour('bt', 's-bullet')]), active: false};
 const label = entity('lbl', 'Label', [{id: 'txt', type: 'pixi.text', version: 1, data: {text: 'Ready'}} as never]);
 const spawner = entity('sp', 'Spawner', [behaviour('bs', 's-spawner')]);
 const entities: Entity[] = [template, label, spawner];
 let next = 0;
 const {h, log} = host(entities, {
  spawn: (name, x, y) => { const id = `copy-${next++}`; const copy = entity(id, name, [behaviour(`${id}-b`, 's-bullet')]); (copy.components[0].data as {x: number}).x = x; (copy.components[0].data as {y: number}).y = y; entities.push(copy); session.spawned([id]); return id; },
  destroy: id => { const i = entities.findIndex(e => e.id === id); if (i >= 0) entities.splice(i, 1); },
 });
 const lib = library(
  {id: 's-spawner', name: 'Spawner', source: `export function onPointerDown(self: GameObject, x: number, y: number) {
   const b = game.spawn('Bullet', x, y); game.log('spawned', b.name, b.x, b.y, game.pointer.down);
   game.find('Label').text = 'Shots ' + game.findAll('Bullet').length;
  }
  export function onPointerUp() { game.log('up', game.pointer.down, game.pointer.x); }`},
  {id: 's-bullet', name: 'Bullet', source: `export function start(self: GameObject) { if (self.active) game.log('bullet ready', self.x); }
  export function update(self: GameObject) { if (self.active) { self.state.n = (self.state.n ?? 0) + 1; if (self.state.n === 2) self.destroy(); } }`},
 );
 const session = new ScriptSession(engine, lib, h, m => log.push(`report: ${m}`));
 session.pointer('down', 300, 200);
 expect(log).toContain('info: spawned Bullet 300 200 true');
 expect(label.components[1].data).toMatchObject({text: 'Shots 2'});
 session.pointer('up', 310, 200);
 expect(log).toContain('info: up false 310');
 session.system.update!(1 / 60);
 expect(log).toContain('info: bullet ready 300');
 session.system.update!(1 / 60);
 expect(entities.some(e => e.id === 'copy-0')).toBe(false);
 expect(log.filter(l => l.startsWith('report'))).toEqual([]);
 session.dispose();
});

it('instruments only lines that start in code and finds the names in scope', async () => {
 const {codeLineStarts, namesBefore, instrumentScript} = await import('./compile');
 const source = ['const message = `first', 'second`;', '/* block', 'still */', 'export function update(self: GameObject, dt: number) {', '  const speed = 2, {x, y} = self;', '  const data = {', '    a: 1,', '  };', '  self.x += speed * dt;', '}'].join('\n');
 expect(codeLineStarts(source)).toEqual([true, false, true, false, true, true, true, true, true, true, true]);
 expect(namesBefore(source, 10)).toEqual(expect.arrayContaining(['message', 'self', 'dt', 'speed', 'x', 'y', 'data']));
 const built = instrumentScript(source, 'Mover', 's1', [2, 4, 8, 10, 99]);
 expect(built.error).toBeUndefined();
 expect(built.lines).toEqual([10]);
 expect(built.code.split('\n')).toHaveLength(11);
 expect(built.code.split('\n')[9]).toContain('__bp("s1", 10');
});

it('debugger: a breakpoint reports that line\'s locals and watches; removing it keeps running objects and their state', async () => {
 const {instrumentScript} = await import('./compile');
 const mover = entity('m', 'Mover', [behaviour('mb', 's-move')]);
 const {h, values, log} = host([mover]);
 const source = 'export function update(self: GameObject, dt: number) {\n  const step = 3;\n  self.state.n = (self.state.n ?? 0) + step;\n  globals.score += 1;\n}';
 const session = new ScriptSession(engine, library({id: 's-move', name: 'Mover', source}), h, m => log.push(`report: ${m}`));
 const hits: import('./session').DebugHit[] = [];
 const valid = session.debug({breakpoints: new Map([['s-move', [3]]]), watches: ['self.state.n', 'step * 2', 'nope.x'], hit: x => hits.push(x), build: instrumentScript});
 expect(valid).toEqual({'s-move': [3]});
 session.system.update!(1 / 60);
 expect(hits).toHaveLength(1);
 expect(hits[0]).toMatchObject({scriptId: 's-move', line: 3, hook: 'Mover.update'});
 expect(hits[0].locals).toMatchObject({self: 'Mover (object)', dt: '0.0166667', step: '3'});
 expect(hits[0].watches).toMatchObject({'self.state.n': 'undefined', 'step * 2': '6'});
 expect(hits[0].watches['nope.x']).toMatch(/^⚠/);
 expect(session.watch(['globals.score', 'game.time'])).toEqual(['1', '1.5']);
 expect(session.instances()).toEqual([{script: 'Mover', object: 'Mover', entityId: 'm', state: '{n: 3}'}]);
 session.debug({breakpoints: new Map(), watches: [], hit: x => hits.push(x), build: instrumentScript});
 session.system.update!(1 / 60);
 expect(hits).toHaveLength(1);
 expect(session.instances()[0].state).toBe('{n: 6}');
 expect(values.get('v1')).toBe(2);
 expect(log.filter(l => l.startsWith('report'))).toEqual([]);
 session.dispose();
});

it('compiles every New script template without errors', async () => {
 const {scriptTemplates} = await import('./contracts');
 for (const template of scriptTemplates) expect(compileScript(template.source, template.name).error, template.id).toBeUndefined();
});

it('swaps running objects to edited code while playing, keeping their state', () => {
 const hero = entity('h', 'Hero', [behaviour('b', 's1')]);
 const v1 = library({id: 's1', name: 'Mover', source: 'export function update(self: GameObject) { self.state.n = (self.state.n ?? 0) + 1; self.x = self.state.n; }'});
 const {h} = host([hero]);
 const session = new ScriptSession(engine, v1, h, () => {});
 session.system.update!(0); session.system.update!(0);
 const v2 = library({id: 's1', name: 'Mover', source: 'export function update(self: GameObject) { self.state.n = (self.state.n ?? 0) + 1; self.x = self.state.n * 100; }'});
 expect(session.reload(v2)).toEqual(['Mover']);
 session.system.update!(0);
 expect((hero.components[0].data as {x: number}).x).toBe(300);
 expect(session.reload(v2)).toEqual([]);
 const broken = {...v2, items: v2.items.map(i => ({...i, code: '', error: 'x'}))};
 expect(session.reload(broken)).toEqual([]);
 session.dispose();
});

it('adds and removes scenes by name, and a standby sandbox runs scripts on objects that join a script-less scene', () => {
 const entities: Entity[] = [entity('m', 'Main object')], calls: string[] = [];
 const {h, log} = host(entities, {standby: true, addScene: id => { calls.push(`add:${id}`); entities.push(entity('hud', 'Panel', [behaviour('hb', 's-panel')])); session.spawned(['hud']); }, removeScene: id => { calls.push(`remove:${id}`); }});
 const lib = library({id: 's-panel', name: 'Panel', source: `export function start(self: GameObject) { game.log('panel', self.name); game.removeScene('Level 2'); }`});
 const session = new ScriptSession(engine, lib, h, m => log.push(`report: ${m}`));
 expect(session.count).toBe(0);
 h.addScene!('s2');
 session.system.update!(1 / 60); session.system.update!(1 / 60);
 expect(log).toContain('info: panel Panel');
 expect(calls).toEqual(['add:s2', 'remove:s2']);
 const idle = new ScriptSession(engine, lib, host([entity('x', 'X')]).h, () => {});
 idle.spawned(['x']); expect(idle.count).toBe(0); idle.dispose();
 session.dispose();
});

it('reports a missing scene name for addScene', () => {
 const {h, log} = host([entity('p', 'Player', [behaviour('b', 's')])], {addScene: () => {}, removeScene: () => {}});
 const session = new ScriptSession(engine, library({id: 's', name: 'Adder', source: `export function start() { game.addScene('Nowhere'); }`}), h, m => log.push(`report: ${m}`));
 session.system.update!(1 / 60);
 expect(log.join('\n')).toMatch(/Nowhere/);
 session.dispose();
});

it('list and object globals: reads are live views that write back on change, onGlobal gets the value, Monaco types them', () => {
 const store = new GlobalStore({version: 1, items: [{id: 'inv', name: 'inventory', type: 'list', initial: ['sword']}, {id: 'pl', name: 'player', type: 'object', initial: {hp: 10, pos: {x: 1}}}]});
 const p = entity('p', 'Player', [behaviour('b', 's')]), log: string[] = [];
 const h: ScriptHost = {entities: () => [p], time: () => 0, stage: {width: 960, height: 540}, names: {globals: store.list.map(g => ({id: g.id, name: g.name})), scenes: []}, globals: store, setActive: () => {}, changeScene: () => {}, invoke: () => {}, log: (level, message) => { log.push(`${level}: ${message}`); }};
 const session = new ScriptSession(engine, library({id: 's', name: 'Bag', source: `
export function start() {
  globals.inventory.push('key');
  globals.player.hp -= 3;
  globals.player.pos.x = 5;
  delete globals.player.pos;
  game.log(globals.inventory.length, globals.inventory.join('+'), globals.player.hp, JSON.stringify(globals.player));
  globals.inventory = [...globals.inventory, 'map'];
  try { globals.inventory = { a: 1 }; } catch (e) { game.log('refused', String(e.message)); }
  game.on('global').subscribe(c => game.log('stream', c.name, JSON.stringify(c.value)));
}
export function onGlobal(self: GameObject, name: string, value: unknown) { game.log('hook', name, JSON.stringify(value)); }`}), h, m => log.push(`report: ${m}`));
 session.system.update!(1 / 60);
 expect(store.get('inv')).toEqual(['sword', 'key', 'map']);
 expect(store.get('pl')).toEqual({hp: 7});
 store.push('inv', 'gem');
 session.observe({type: 'global.change', sourceId: 'inv', silent: false});
 expect(log).toEqual(expect.arrayContaining(['info: 2 sword+key 7 {"hp":7}', 'info: refused inventory is a list', 'info: hook inventory ["sword","key","map","gem"]', 'info: stream inventory ["sword","key","map","gem"]']));
 expect(globalsDeclaration(store.list)).toBe('interface Globals {\n  inventory: string[];\n  player: {hp: number; pos: {x: number; [key: string]: any}; [key: string]: any};\n}\n');
 session.dispose();
});
