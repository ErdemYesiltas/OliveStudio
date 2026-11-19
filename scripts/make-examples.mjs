// Builds the Hub's example projects (examples/<id>/) with the editor itself: each project is written, opened, played
// briefly (no page or script errors allowed), saved by the editor (canonical file) and photographed for its thumbnail.
// The existing end-to-end example is only photographed. Run after `pnpm build`: node scripts/make-examples.mjs
import {_electron as electron, expect} from '@playwright/test';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(join(root, 'apps/editor-desktop/package.json')), sharp = require('sharp');
const {transform} = createRequire(join(root, 'modules/scripts/package.json'))('sucrase');
const compile = source => transform(source, {transforms: ['typescript', 'imports'], production: true, disableESTransforms: true}).code;

// ---------- building blocks (complete component data, as the editor stores it) ----------
const tf = (id, x, y, more = {}) => ({id: `${id}-t`, type: 'scene.transform2d', version: 1, data: {x, y, rotation: 0, scaleX: 1, scaleY: 1, ...more}});
const shape = (id, kind, w, h, color, more = {}) => ({id: `${id}-s`, type: 'pixi.shape', version: 1, data: {alpha: 1, kind, width: w, height: h, color, rounded: 0, sides: 5, innerRadius: .5, strokeColor: '#ffffff', strokeWidth: 0, ...more}});
const text = (id, value, size, color = '#ffffff', more = {}) => ({id: `${id}-x`, type: 'pixi.text', version: 1, data: {alpha: 1, text: value, fontSize: size, color, font: '', fontWeight: 'normal', fontStyle: 'normal', align: 'center', letterSpacing: 0, strokeColor: '#000000', strokeWidth: 0, ...more}});
const body = (id, data = {}) => ({id: `${id}-rb`, type: 'physics.rigidBody2d', version: 1, data: {bodyType: 'dynamic', density: .001, friction: .3, restitution: 0, airFriction: .01, lockRotation: false, velocityX: 0, velocityY: 0, angularVelocity: 0, frictionStatic: .5, gravityScale: 1, mass: 0, layer: 0, mask: 65535, group: 0, draggable: false, bullet: false, ...data}});
const box = (id, w, h, sensor = false) => ({id: `${id}-box`, type: 'physics.boxCollider2d', version: 1, data: {width: w, height: h, offsetX: 0, offsetY: 0, sensor, chamfer: 0}});
const circle = (id, radius, sensor = false) => ({id: `${id}-cc`, type: 'physics.circleCollider2d', version: 1, data: {radius, offsetX: 0, offsetY: 0, sensor}});
const joint = (id, data) => ({id: `${id}-j`, type: 'physics.joint2d', version: 1, data: {kind: 'distance', target: '', anchorX: 0, anchorY: 0, targetAnchorX: 0, targetAnchorY: 0, length: 0, stiffness: 1, damping: 0, collideConnected: false, ...data}});
const behaviour = (id, scriptId, params = {}) => ({id: `${id}-b`, type: 'scripts.behaviour', version: 1, data: {scriptId, params, refs: {}}});
const rules = (id, list) => ({id: `${id}-r`, type: 'interactions.bindings', version: 1, data: {rules: list}});
const rule = (id, trigger, actions) => ({id, trigger: {event: '', ...trigger}, actions: actions.map((a, i) => ({id: `${id}-${i}`, value: true, ...a}))});
const tween = (id, entityId, tracks, more = {}) => ({id: `${id}-tw`, type: 'tween.player', version: 1, data: {duration: 1, delay: 0, ease: 'sine.inOut', repeat: 0, yoyo: false, autoplay: true, ...more, tracks: tracks.map(([property, from, to], i) => ({id: `${id}-k${i}`, entityId, componentId: `${entityId}-t`, property, from, to}))}});
const particles = (id, data) => ({id: `${id}-p`, type: 'pixi.particles', version: 1, data: {assetId: '', alpha: 1, tint: '#ffffff', count: 60, lifetime: 1, speed: 120, direction: -90, spread: 360, gravity: 0, size: 10, endScale: .2, endAlpha: 0, seed: 7, emission: 'continuous', autoplay: true, ...data}});
const effects = (id, data) => ({id: `${id}-fx`, type: 'pixi.effects', version: 1, data: {blendMode: 'normal', blur: 0, brightness: 1, contrast: 1, saturation: 1, hue: 0, noise: 0, shadowAlpha: 0, shadowColor: '#000000', shadowX: 4, shadowY: 4, shadowBlur: 2, glowStrength: 0, glowColor: '#ffd27a', glowDistance: 12, outlineWidth: 0, outlineColor: '#ffffff', pixelate: 0, ...data}});
const hud = (id, anchor = 'top-left') => ({id: `${id}-hud`, type: 'pixi.screenSpace', version: 1, data: {anchor}});
const camera = (id, data) => ({id: `${id}-cam`, type: 'pixi.camera2d', version: 1, data: {zoom: 1, rotate: false, target: '', offsetX: 0, offsetY: 0, smoothing: 0, deadzoneWidth: 0, deadzoneHeight: 0, limit: false, limitLeft: 0, limitTop: 0, limitRight: 1920, limitBottom: 1080, ...data}});
const entity = (id, name, x, y, components = [], parentId = null, tfMore = {}) => ({id, name, parentId, active: true, components: [tf(id, x, y, tfMore), ...components]});
const scene = (id, name, entities) => ({formatVersion: 1, id, name, entities});
const world = (data = {}) => ({gravityX: 0, gravityY: 980, timeScale: 1, sleeping: false, positionIterations: 8, velocityIterations: 6, walls: false, layers: ['Default'], ...data});
const global = (id, name, initial, type = 'number') => ({id, name, type, initial});
const look = background => ({version: 1, background});
const moveAxis = {id: 'a-move', name: 'Move', kind: 'axis', bindings: [{type: 'keyAxis', negative: 'ArrowLeft', positive: 'ArrowRight'}, {type: 'keyAxis', negative: 'KeyA', positive: 'KeyD'}], globalId: 'g-move'};
/** A clickable label on a rounded button: the same rules (or script) on both, so a click anywhere on it counts. */
const button = (id, label, x, y, w, color, extra) => [entity(id, label, x, y, [shape(id, 'rect', w, 46, color, {rounded: 12}), ...extra(id)]), entity(`${id}-label`, `${label} label`, 0, 0, [text(`${id}-label`, label, 18, '#10131a', {fontWeight: 'bold'}), ...extra(`${id}-label`)], id)];
const restart = (sceneId, globals) => id => [rules(id, [rule(`${id}-go`, {type: 'pointer.click', sourceId: id}, [...globals.map(([g, to]) => ({type: 'global.set', targetId: g, to})), {type: 'scene.change', targetId: sceneId}])])];
const endScene = (id, name, title, line, color, sceneId, globals) => scene(id, name, [
 entity(`${id}-title`, 'Title', 480, 200, [text(`${id}-title`, title, 64, color, {fontWeight: 'bold', strokeColor: '#000000', strokeWidth: 6})]),
 entity(`${id}-line`, 'Result', 480, 280, [text(`${id}-line`, line, 26, '#e8ecf4')]),
 ...button(`${id}-again`, 'Play again', 480, 370, 220, '#7cf3ff', restart(sceneId, globals)),
]);

// ---------- 1. Sky Hopper: platformer ----------
const heroScript = `export const params = { speed: param.number(280), jump: param.number(640) };
export function start(self: GameObject) { self.state.spawn = { x: self.x, y: self.y }; }
export function update(self: GameObject) {
  const feet = (dx: number) => game.physics.raycast(self.x + dx, self.y + 24, self.x + dx, self.y + 32) !== null;
  const grounded = feet(-14) || feet(14);
  const jump = game.isDown('Jump');
  let vy = self.body.velocity.y;
  if (grounded && jump && !self.state.held) vy = -self.params.jump;
  self.state.held = jump;
  self.body.velocity = { x: globals.move * self.params.speed, y: vy };
  if (self.y > 720) { self.body.teleport(self.state.spawn.x, self.state.spawn.y); self.body.velocity = { x: 0, y: 0 }; game.camera.shake(12, 0.3); }
}
export function onCollision(self: GameObject, other: GameObject) {
  if (other.name === 'Coin' && other.active) { other.active = false; globals.coins += 1; }
  if (other.name === 'Goal') game.changeScene('You win');
}`;
const platformer = () => {
 const ground = [[300, 600], [1000, 500], [1650, 600], [2250, 300]].map(([x, w], i) => entity(`ground-${i}`, 'Ground', x, 520, [shape(`ground-${i}`, 'rect', w, 40, '#4d8b31', {strokeColor: '#2f5a1c', strokeWidth: 4}), box(`ground-${i}`, w, 40)]));
 const ledges = [[650, 410, 160], [860, 330, 140], [1350, 380, 160], [1560, 290, 120], [1950, 350, 180]].map(([x, y, w], i) => entity(`ledge-${i}`, 'Ledge', x, y, [shape(`ledge-${i}`, 'rect', w, 22, '#a0703c', {rounded: 6, strokeColor: '#6b4521', strokeWidth: 3}), box(`ledge-${i}`, w, 22)]));
 const coins = [[420, 440], [650, 360], [860, 280], [1000, 440], [1350, 330], [1560, 240], [1700, 440], [1950, 300], [2150, 440]].map(([x, y], i) => entity(`coin-${i}`, 'Coin', x, y, [shape(`coin-${i}`, 'ellipse', 24, 24, '#ffd54a', {strokeColor: '#c79a00', strokeWidth: 3}), circle(`coin-${i}`, 12, true), tween(`coin-${i}`, `coin-${i}`, [['y', y, y - 8]], {duration: .6, yoyo: true, repeat: 100, delay: i * .07})]));
 const hills = [[200, 470, 520, 220], [900, 480, 640, 200], [1700, 470, 600, 240], [2300, 480, 520, 200]].map(([x, y, w, h], i) => entity(`hill-${i}`, 'Hill', x, y, [shape(`hill-${i}`, 'ellipse', w, h, '#9fd77a', {alpha: .55})]));
 const clouds = [[260, 110], [780, 80], [1300, 130], [1850, 90], [2300, 120]].map(([x, y], i) => entity(`cloud-${i}`, 'Cloud', x, y, [shape(`cloud-${i}`, 'ellipse', 150, 52, '#ffffff', {alpha: .85})]));
 return {
  id: 'platformer', title: 'Sky Hopper', file: 'Sky Hopper.pixieditor', expect: 'hero',
  description: 'A side-scrolling platformer: run and jump with the keyboard, collect coins, reach the flag. Camera follow with limits, a HUD layer, physics, input map and a hero script.',
  tags: ['Platformer', 'Camera', 'Physics', 'Input', 'Scripts'],
  project: {
   scenes: [scene('s-level', 'Level 1', [
    ...hills, ...clouds, ...ground, ...ledges, ...coins,
    entity('goal', 'Goal', 2330, 440, [shape('goal', 'rect', 14, 120, '#ffffff', {strokeColor: '#444444', strokeWidth: 2}), box('goal', 30, 120, true)]),
    entity('flag', 'Flag', 28, -38, [shape('flag', 'triangle', 44, 34, '#ff4a6b')], 'goal', {rotation: 90}),
    entity('hero', 'Hero', 120, 420, [shape('hero', 'rect', 34, 46, '#ff6b4a', {rounded: 8, strokeColor: '#9c2f17', strokeWidth: 3}), body('hero', {lockRotation: true, friction: 0, frictionStatic: 0}), box('hero', 34, 46), behaviour('hero', 's-hero')]),
    entity('camera', 'Camera', 480, 270, [camera('camera', {target: 'hero', smoothing: 8, deadzoneWidth: 160, deadzoneHeight: 120, limit: true, limitRight: 2400, limitBottom: 540})]),
    entity('hud', 'Coins label', 90, 32, [text('hud', 'Coins: {coins}', 26, '#ffffff', {fontWeight: 'bold', strokeColor: '#1b3a57', strokeWidth: 5}), hud('hud')]),
    entity('hint', 'Controls hint', 480, 512, [text('hint', '← → or A D to run · Space to jump', 18, '#1b3a57'), hud('hint', 'bottom')]),
   ]), endScene('s-win', 'You win', 'You win!', 'Coins collected: {coins}', '#ffd54a', 's-level', [['g-coins', 0]])],
   extensions: {
    'pixi.render': look('#8fd3ff'), 'physics.world': world({gravityY: 1400}),
    'interactions.globals': {version: 1, items: [global('g-move', 'move', 0), global('g-coins', 'coins', 0)]},
    'input.map': {version: 1, deadzone: .2, actions: [moveAxis, {id: 'a-jump', name: 'Jump', kind: 'button', bindings: [{type: 'key', code: 'Space'}, {type: 'key', code: 'ArrowUp'}, {type: 'key', code: 'KeyW'}]}]},
    'scripts.library': {version: 1, items: [{id: 's-hero', name: 'Hero', source: heroScript, code: compile(heroScript)}]},
   },
  },
 };
};

// ---------- 2. Brick Breaker ----------
const paddleScript = `export function update(self: GameObject, dt: number) {
  self.x = Math.max(78, Math.min(882, self.x + globals.move * 560 * dt));
}`;
const ballScript = `export const params = { speed: param.number(400) };
export function start(self: GameObject) { self.state.wait = 0.8; }
export function update(self: GameObject, dt: number) {
  if (self.state.wait > 0) { self.state.wait -= dt; if (self.state.wait <= 0) self.body.velocity = { x: 150, y: -self.params.speed }; return; }
  const v = self.body.velocity, length = Math.hypot(v.x, v.y) || 1;
  let vx = v.x / length * self.params.speed, vy = v.y / length * self.params.speed;
  if (Math.abs(vy) < 140) vy = vy < 0 ? -140 : 140;
  self.body.velocity = { x: vx, y: vy };
  if (self.y > 580) {
    globals.lives -= 1;
    if (globals.lives <= 0) { game.changeScene('Game over'); return; }
    self.body.teleport(480, 470); self.body.velocity = { x: 0, y: 0 }; self.state.wait = 0.8; game.camera.shake(10, 0.3);
  }
}
export function onCollision(self: GameObject, other: GameObject) {
  if (other.name === 'Paddle') self.body.velocity = { x: (self.x - other.x) / 60 * self.params.speed, y: -self.params.speed };
}`;
const brickScript = `export function onCollision(self: GameObject, other: GameObject) {
  if (other.name !== 'Ball' || !self.active) return;
  self.active = false;
  globals.score += 10;
  if (game.findAll('Brick').every(b => !b.active)) game.changeScene('You win');
}`;
const breakout = () => {
 const colors = ['#ff5d73', '#ff9f43', '#feca57', '#1dd1a1', '#54a0ff'], bricks = [];
 for (let row = 0; row < 5; row++) for (let col = 0; col < 10; col++) { const id = `brick-${row}-${col}`; bricks.push(entity(id, 'Brick', 93 + col * 86, 100 + row * 32, [shape(id, 'rect', 78, 24, colors[row], {rounded: 5}), box(id, 78, 24), behaviour(id, 's-brick')])); }
 const wall = (id, x, y, w, h) => entity(id, 'Wall', x, y, [shape(id, 'rect', w, h, '#2b2f55'), box(id, w, h)]);
 const reset = [['g-score', 0], ['g-lives', 3]];
 return {
  id: 'breakout', title: 'Brick Breaker', file: 'Brick Breaker.pixieditor', expect: 'ball',
  description: 'Keep the ball in play and clear 50 bricks. Bouncing physics with no gravity, a kinematic paddle, score and lives globals, win and game-over scenes.',
  tags: ['Arcade', 'Physics', 'Globals', 'Scenes'],
  project: {
   scenes: [scene('s-game', 'Game', [
    wall('wall-l', 8, 270, 16, 540), wall('wall-r', 952, 270, 16, 540), wall('wall-t', 480, 8, 960, 16),
    ...bricks,
    entity('paddle', 'Paddle', 480, 500, [shape('paddle', 'rect', 120, 16, '#7cf3ff', {rounded: 8}), body('paddle', {bodyType: 'kinematic'}), box('paddle', 120, 16), behaviour('paddle', 's-paddle'), effects('paddle', {glowStrength: 2, glowColor: '#7cf3ff', glowDistance: 10})]),
    entity('ball', 'Ball', 480, 470, [shape('ball', 'ellipse', 18, 18, '#ffffff'), body('ball', {restitution: 1, friction: 0, frictionStatic: 0, airFriction: 0, gravityScale: 0, bullet: true, lockRotation: true}), circle('ball', 9), behaviour('ball', 's-ball')]),
    entity('score', 'Score', 110, 44, [text('score', 'Score {score}', 22, '#e8ecf4', {fontWeight: 'bold'})]),
    entity('lives', 'Lives', 860, 44, [text('lives', 'Lives {lives}', 22, '#ff5d73', {fontWeight: 'bold'})]),
    entity('hint', 'Hint', 480, 530, [text('hint', '← → or A D to move', 16, '#8a90b8')]),
   ]), endScene('s-over', 'Game over', 'Game over', 'Score {score}', '#ff5d73', 's-game', reset), endScene('s-won', 'You win', 'Cleared!', 'Score {score}', '#1dd1a1', 's-game', reset)],
   extensions: {
    'pixi.render': look('#14162b'), 'physics.world': world({gravityY: 0}),
    'interactions.globals': {version: 1, items: [global('g-move', 'move', 0), global('g-score', 'score', 0), global('g-lives', 'lives', 3)]},
    'input.map': {version: 1, deadzone: .2, actions: [moveAxis]},
    'scripts.library': {version: 1, items: [['s-paddle', 'Paddle', paddleScript], ['s-ball', 'Ball', ballScript], ['s-brick', 'Brick', brickScript]].map(([id, name, source]) => ({id, name, source, code: compile(source)}))},
   },
  },
 };
};

// ---------- 3. Tap Tycoon: idle clicker ----------
const coinScript = `export function onClick(self: GameObject) {
  globals.coins += globals.perTap;
  self.play('tween');
}`;
const shopScript = `export const params = { kind: param.choice(['tap', 'helper'] as const) };
const cost = (kind: string) => kind === 'tap' ? globals.tapCost : globals.helperCost;
export function update(self: GameObject) { self.alpha = globals.coins >= cost(self.params.kind) ? 1 : 0.5; }
export function onClick(self: GameObject) {
  const kind = self.params.kind, price = cost(kind);
  if (globals.coins < price) { game.camera.shake(6, 0.2); return; }
  globals.coins -= price;
  if (kind === 'tap') { globals.perTap += 1; globals.tapCost = Math.round(price * 1.6); }
  else { globals.perSecond += 1; globals.helperCost = Math.round(price * 1.5); }
}`;
const incomeScript = `export function update(self: SceneSelf, dt: number) {
  self.state.t = (self.state.t ?? 0) + dt;
  while (self.state.t >= 1) { self.state.t -= 1; globals.coins += globals.perSecond; }
}`;
const clicker = () => ({
 id: 'clicker', title: 'Tap Tycoon', file: 'Tap Tycoon.pixieditor', expect: 'coin',
 description: 'An idle clicker: tap the coin, buy stronger taps and helpers that earn every second. Live text from globals, tweens, burst particles, a saved game and a scene script.',
 tags: ['UI', 'Globals', 'Tween', 'Particles', 'Save'],
 project: {
  scenes: [scene('s-shop', 'Shop', [
   entity('glow', 'Glow', 480, 290, [shape('glow', 'ellipse', 300, 300, '#ffb703', {alpha: .18}), effects('glow', {blur: 24}), tween('glow', 'glow', [['scaleX', 1, 1.08], ['scaleY', 1, 1.08]], {duration: 1.4, yoyo: true, repeat: 100})]),
   entity('title', 'Title', 480, 52, [text('title', 'Tap Tycoon', 42, '#ffd166', {fontWeight: 'bold', strokeColor: '#5a3b00', strokeWidth: 6})]),
   entity('counter', 'Coins', 480, 112, [text('counter', '{coins} coins', 34, '#ffffff', {fontWeight: 'bold'})]),
   entity('rate', 'Rate', 480, 150, [text('rate', '+{perTap} per tap · +{perSecond} per second', 18, '#b8b3d6')]),
   entity('coin', 'Coin', 480, 290, [shape('coin', 'ellipse', 180, 180, '#ffc53d', {strokeColor: '#b07800', strokeWidth: 10}), behaviour('coin', 's-coin'), tween('coin', 'coin', [['scaleX', 1, 1.12], ['scaleY', 1, 1.12]], {duration: .07, yoyo: true, repeat: 1, autoplay: false, ease: 'quad.out'}),
    rules('coin', [rule('coin-burst', {type: 'pointer.click', sourceId: 'coin'}, [{type: 'particles.play', targetId: 'sparkle-p'}])])]),
   entity('star', 'Shine', -40, -40, [shape('star', 'star', 34, 34, '#fff3c4', {sides: 4, innerRadius: .35})], 'coin'),
   entity('sparkle', 'Sparkle', 480, 290, [particles('sparkle', {tint: '#ffe680', count: 28, lifetime: .8, speed: 300, spread: 360, gravity: 500, size: 10, emission: 'burst', autoplay: false})]),
   entity('hint', 'Hint', 480, 405, [text('hint', 'Tap the coin!', 18, '#8f88b8')]),
   ...button('buy-tap', 'Stronger taps · {tapCost}', 290, 470, 300, '#7cf3ff', id => [behaviour(id, 's-shop', {kind: 'tap'})]),
   ...button('buy-helper', 'Hire helper · {helperCost}', 670, 470, 300, '#b4f07a', id => [behaviour(id, 's-shop', {kind: 'helper'})]),
   entity('saver', 'Save game', 40, 520, [rules('saver', [rule('load', {type: 'scene.start', sourceId: 's-shop'}, [{type: 'save.read', targetId: 'save'}]), rule('store', {type: 'global.change', sourceId: 'g-coins'}, [{type: 'save.write', targetId: 'save'}])])]),
  ])],
  sceneScripts: {'s-shop': 's-income'},
  extensions: {
   'pixi.render': look('#1d1a2f'),
   'interactions.globals': {version: 1, items: [global('g-coins', 'coins', 0), global('g-pertap', 'perTap', 1), global('g-persec', 'perSecond', 0), global('g-tapcost', 'tapCost', 10), global('g-helpercost', 'helperCost', 25)]},
   'scripts.library': {version: 1, items: [['s-coin', 'CoinTap', coinScript], ['s-shop', 'ShopButton', shopScript], ['s-income', 'Income', incomeScript]].map(([id, name, source]) => ({id, name, source, code: compile(source)}))},
  },
 },
});

// ---------- 4. Physics Playground ----------
const playground = () => {
 const palette = ['#ff6b6b', '#feca57', '#48dbfb', '#1dd1a1', '#ff9ff3'], crates = [];
 for (let row = 0; row < 5; row++) for (let i = 0; i < 5 - row; i++) { const id = `crate-${row}-${i}`; crates.push(entity(id, 'Crate', 640 + (i - (4 - row) / 2) * 42, 488 - row * 42, [shape(id, 'rect', 40, 40, palette[(row + i) % 5], {rounded: 4, strokeColor: '#1e2a33', strokeWidth: 2}), body(id, {draggable: true, friction: .5}), box(id, 40, 40)])); }
 const balls = [[140, 120, 22, '#ff9f43'], [200, 60, 16, '#54a0ff'], [250, 150, 28, '#5f27cd']].map(([x, y, r, c], i) => entity(`ball-${i}`, 'Ball', x, y, [shape(`ball-${i}`, 'ellipse', r * 2, r * 2, c), body(`ball-${i}`, {restitution: .65, draggable: true}), circle(`ball-${i}`, r)]));
 const chain = [0, 1, 2].map(i => entity(`link-${i}`, 'Chain link', 360, 100 + i * 45, [shape(`link-${i}`, 'ellipse', 16, 16, '#c8d6e5'), body(`link-${i}`, {draggable: true}), circle(`link-${i}`, 8), joint(`link-${i}`, i ? {target: `link-${i - 1}`} : {targetAnchorX: 360, targetAnchorY: 50})]));
 const anchorDot = entity('anchor', 'Anchor', 360, 50, [shape('anchor', 'ellipse', 12, 12, '#576574')]);
 const bob = entity('bob', 'Wrecking ball', 360, 270, [shape('bob', 'ellipse', 56, 56, '#222f3e', {strokeColor: '#c8d6e5', strokeWidth: 3}), body('bob', {draggable: true, density: .004}), circle('bob', 28), joint('bob', {target: 'link-2'})]);
 const plank = entity('plank', 'Seesaw', 180, 430, [shape('plank', 'rect', 240, 14, '#c8a165', {rounded: 4}), body('plank', {draggable: true}), box('plank', 240, 14), joint('plank', {kind: 'pin', targetAnchorX: 180, targetAnchorY: 430})]);
 const fulcrum = entity('fulcrum', 'Fulcrum', 180, 470, [shape('fulcrum', 'triangle', 50, 64, '#576574')]);
 const action = (actions) => id => [rules(id, [rule(`${id}-do`, {type: 'pointer.click', sourceId: id}, actions)])];
 return {
  id: 'physics', title: 'Physics Playground', file: 'Physics Playground.pixieditor', expect: 'bob',
  description: 'Drag anything with the mouse: a crate pyramid, bouncy balls, a chain with a wrecking ball and a seesaw. Buttons push, change gravity and restart the scene.',
  tags: ['Physics', 'Joints', 'Drag', 'Rules'],
  project: {
   scenes: [scene('s-play', 'Playground', [
    entity('floor', 'Floor', 480, 525, [shape('floor', 'rect', 960, 30, '#3b4b59'), box('floor', 960, 30)]),
    ...crates, ...balls, anchorDot, ...chain, bob, fulcrum, plank,
    entity('help', 'Help', 600, 110, [text('help', 'Drag anything · the buttons push, change gravity and restart', 16, '#a4b0be')]),
    ...button('btn-kick', 'Kick', 470, 46, 110, '#feca57', action([{type: 'physics.push', targetId: 'bob', x: 900, y: -300}])),
    ...button('btn-low', 'Moon gravity', 620, 46, 160, '#48dbfb', action([{type: 'physics.gravity', targetId: 'physics', x: 0, y: 160}])),
    ...button('btn-normal', 'Earth gravity', 800, 46, 160, '#1dd1a1', action([{type: 'physics.gravity', targetId: 'physics', x: 0, y: 980}])),
    ...button('btn-reset', 'Restart', 920, 100, 80, '#ff9ff3', action([{type: 'scene.change', targetId: 's-play'}])),
   ])],
   extensions: {'pixi.render': look('#1e2a33'), 'physics.world': world({walls: true, sleeping: true})},
  },
 };
};

// ---------- 5. Neon Garden: visuals ----------
const breatheScript = `export function update() { game.camera.zoom = 1.03 + 0.03 * Math.sin(game.time * 0.7); }`;
const neon = () => {
 const ring = Array.from({length: 8}, (_, i) => { const a = i / 8 * Math.PI * 2, x = 480 + Math.cos(a) * 200, y = 270 + Math.sin(a) * 150, id = `hex-${i}`, hue = ['#7cf3ff', '#ff4fd8', '#b4f07a', '#ffd166'][i % 4];
  return entity(id, 'Hexagon', x, y, [shape(id, 'polygon', 54, 54, hue, {sides: 6, alpha: .9}), effects(id, {glowStrength: 2.5, glowColor: hue, glowDistance: 14, blendMode: 'add'}), tween(id, id, [['scaleX', .7, 1.15], ['scaleY', .7, 1.15], ['rotation', 0, 60]], {duration: 1.2, yoyo: true, repeat: 100, delay: i * .15})]); });
 const orbs = [[150, 130, '#5f27cd'], [820, 120, '#00d2d3'], [170, 430, '#ff4fd8'], [800, 420, '#feca57']].map(([x, y, c], i) => entity(`orb-${i}`, 'Orb', x, y, [shape(`orb-${i}`, 'ellipse', 150, 150, c, {alpha: .55}), effects(`orb-${i}`, {blur: 30, blendMode: 'add'}), tween(`orb-${i}`, `orb-${i}`, [['x', x, x + (i % 2 ? -40 : 40)], ['y', y, y + 30]], {duration: 3 + i * .4, yoyo: true, repeat: 100})]));
 return {
  id: 'effects', title: 'Neon Garden', file: 'Neon Garden.pixieditor', expect: 'core',
  description: 'A glowing visual toy: blur, glow and additive blending, looping tweens, a particle fountain and a breathing camera. Click the star for a burst and a shake.',
  tags: ['Visuals', 'Effects', 'Particles', 'Tween'],
  project: {
   scenes: [scene('s-garden', 'Garden', [
    ...orbs,
    entity('fountain', 'Fountain', 480, 520, [particles('fountain', {tint: '#7cf3ff', count: 220, lifetime: 2.2, speed: 300, direction: -90, spread: 28, gravity: 260, size: 9, endScale: .1}), effects('fountain', {blendMode: 'add'})]),
    ...ring,
    entity('core', 'Star', 480, 270, [shape('core', 'star', 150, 150, '#ff4fd8', {sides: 5, innerRadius: .45, strokeColor: '#ffd1f4', strokeWidth: 4}), effects('core', {glowStrength: 4, glowColor: '#ff4fd8', glowDistance: 24}), tween('core', 'core', [['rotation', 0, 360]], {duration: 8, ease: 'linear', repeat: 100}),
     rules('core', [rule('core-click', {type: 'pointer.click', sourceId: 'core'}, [{type: 'camera.shake', targetId: 'camera', amount: 16}, {type: 'particles.play', targetId: 'burst-p'}])])]),
    entity('burst', 'Burst', 480, 270, [particles('burst', {tint: '#ffd1f4', count: 80, lifetime: 1, speed: 420, spread: 360, size: 8, emission: 'burst', autoplay: false}), effects('burst', {blendMode: 'add'})]),
    entity('title', 'Title', 480, 56, [text('title', 'NEON GARDEN', 44, '#e9fbff', {fontWeight: 'bold', letterSpacing: 8}), effects('title', {glowStrength: 3, glowColor: '#7cf3ff', glowDistance: 16})]),
    entity('hint', 'Hint', 480, 500, [text('hint', 'click the star', 16, '#7f8fa6', {letterSpacing: 3})]),
    entity('camera', 'Camera', 480, 270, [camera('camera', {})]),
   ])],
   sceneScripts: {'s-garden': 's-breathe'},
   extensions: {'pixi.render': look('#0b0e1a'), 'scripts.library': {version: 1, items: [{id: 's-breathe', name: 'Breathe', source: breatheScript, code: compile(breatheScript)}]}},
  },
 };
};

// ---------- 6. Grid Snake: tick-based grid game, no physics ----------
const snakeScript = `export const params = { step: param.number(0.12, { label: 'Seconds per step' }) };
const CELL = 30, COLS = 32, ROWS = 17, TOP = 30;
const at = (c: number, r: number) => ({ x: c * CELL + CELL / 2, y: TOP + r * CELL + CELL / 2 });
const turns: Record<string, { c: number; r: number }> = { Up: { c: 0, r: -1 }, Down: { c: 0, r: 1 }, Left: { c: -1, r: 0 }, Right: { c: 1, r: 0 } };
export function start(self: SceneSelf) { reset(self); }
function reset(self: SceneSelf) {
  self.state.body = [{ c: 8, r: 8 }, { c: 7, r: 8 }, { c: 6, r: 8 }];
  self.state.dir = self.state.next = { c: 1, r: 0 };
  self.state.t = 0; self.state.dead = false; globals.score = 0;
  game.find('Game over').active = false;
  food(self); draw(self);
}
function food(self: SceneSelf) {
  let c = 0, r = 0;
  do { c = Math.floor(Math.random() * COLS); r = Math.floor(Math.random() * ROWS); } while (self.state.body.some((p: any) => p.c === c && p.r === r));
  self.state.food = { c, r };
  const f = game.find('Food'), p = at(c, r); f.x = p.x; f.y = p.y;
}
function draw(self: SceneSelf) {
  game.findAll('Segment').forEach((s, i) => { const b = self.state.body[i]; s.active = !!b; if (b) { const p = at(b.c, b.r); s.x = p.x; s.y = p.y; } });
}
export function onInput(self: SceneSelf, action: string, phase: string) {
  if (phase !== 'pressed') return;
  if (action === 'Restart' && self.state.dead) return reset(self);
  const d = turns[action];
  if (d && (d.c !== -self.state.dir.c || d.r !== -self.state.dir.r)) self.state.next = d;
}
export function update(self: SceneSelf, dt: number) {
  if (self.state.dead) return;
  self.state.t += dt;
  const step = Math.max(0.05, self.params.step - globals.score * 0.002);
  while (self.state.t >= step && !self.state.dead) { self.state.t -= step; tick(self); }
}
function tick(self: SceneSelf) {
  self.state.dir = self.state.next;
  const head = self.state.body[0], n = { c: head.c + self.state.dir.c, r: head.r + self.state.dir.r };
  if (n.c < 0 || n.r < 0 || n.c >= COLS || n.r >= ROWS || self.state.body.some((p: any) => p.c === n.c && p.r === n.r)) {
    self.state.dead = true;
    if (globals.score > globals.best) globals.best = globals.score;
    game.find('Game over').active = true; game.camera.shake(10, 0.3);
    return;
  }
  self.state.body.unshift(n);
  if (n.c === self.state.food.c && n.r === self.state.food.r) { globals.score += 1; if (self.state.body.length > 120) self.state.body.pop(); food(self); }
  else self.state.body.pop();
  draw(self);
}`;
const snake = () => {
 const hsl = i => { const h = (140 + i * 2) % 360, s = .75, l = .55, k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l), f = n => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)))); return '#' + [f(0), f(8), f(4)].map(v => v.toString(16).padStart(2, '0')).join(''); };
 const segments = Array.from({length: 120}, (_, i) => ({...entity(`seg-${i}`, 'Segment', 255 - i * 30, 285, [shape(`seg-${i}`, 'rect', 26, 26, hsl(i), {rounded: i ? 6 : 9})]), active: i < 3}));
 const key = (id, name, ...codes) => ({id, name, kind: 'button', bindings: codes.map(code => ({type: 'key', code}))});
 return {
  id: 'snake', title: 'Grid Snake', file: 'Grid Snake.pixieditor', expect: 'food',
  description: 'The classic on a 32 × 17 grid: steer with the arrows or WASD, eat, grow and speed up. A fixed-step scene script, onInput, a pool of 120 segments and a saved best score. No physics at all.',
  tags: ['Arcade', 'Grid', 'Scene script', 'Save'],
  project: {
   scenes: [scene('s-snake', 'Snake', [
    entity('board', 'Board', 480, 285, [shape('board', 'rect', 960, 510, '#101c17')]),
    ...segments,
    entity('food', 'Food', 495, 285, [shape('food', 'ellipse', 22, 22, '#ff4d6d'), effects('food', {glowStrength: 3, glowColor: '#ff4d6d', glowDistance: 12}), tween('food', 'food', [['scaleX', .8, 1.15], ['scaleY', .8, 1.15]], {duration: .4, yoyo: true, repeat: 100})]),
    entity('bar', 'Top bar', 480, 15, [shape('bar', 'rect', 960, 30, '#0b1410')]),
    entity('score', 'Score', 70, 15, [text('score', 'Score {score}', 18, '#b4f07a', {fontWeight: 'bold'})]),
    entity('best', 'Best', 890, 15, [text('best', 'Best {best}', 18, '#7f9c8a')]),
    entity('help', 'Help', 480, 15, [text('help', 'Arrows / WASD to steer · Space to restart', 14, '#5f7a6a')]),
    {...entity('over', 'Game over', 480, 280, [text('over', 'Game over · Space to play again', 34, '#ffffff', {fontWeight: 'bold', strokeColor: '#101c17', strokeWidth: 8})]), active: false},
    entity('saver', 'Best score', 20, 520, [rules('saver', [rule('load', {type: 'scene.start', sourceId: 's-snake'}, [{type: 'save.read', targetId: 'save'}]), rule('store', {type: 'global.change', sourceId: 'g-best'}, [{type: 'save.write', targetId: 'save'}])])]),
   ])],
   sceneScripts: {'s-snake': 's-snake'},
   extensions: {
    'pixi.render': look('#0b1410'),
    'interactions.globals': {version: 1, items: [global('g-score', 'score', 0), global('g-best', 'best', 0)]},
    'input.map': {version: 1, deadzone: .2, actions: [key('a-up', 'Up', 'ArrowUp', 'KeyW'), key('a-down', 'Down', 'ArrowDown', 'KeyS'), key('a-left', 'Left', 'ArrowLeft', 'KeyA'), key('a-right', 'Right', 'ArrowRight', 'KeyD'), key('a-restart', 'Restart', 'Space', 'Enter')]},
    'scripts.library': {version: 1, items: [{id: 's-snake', name: 'SnakeGame', source: snakeScript, code: compile(snakeScript)}]},
   },
  },
 };
};

// ---------- 7. Desert Dash: endless runner with hand-written motion ----------
const runnerScript = `export const params = { gravity: param.number(2400), jump: param.number(820) };
const GROUND = 430;
export function start(self: SceneSelf) { reset(self); }
function reset(self: SceneSelf) {
  self.state.vy = 0; self.state.speed = 360; self.state.distance = 0; self.state.dead = false; self.state.held = true;
  const runner = game.find('Runner'); runner.y = GROUND - 20;
  game.findAll('Cactus').forEach((c, i) => { c.x = 1100 + i * 420; });
  game.find('Game over').active = false; globals.distance = 0;
}
const hit = (a: GameObject, aw: number, ah: number, b: GameObject, bw: number, bh: number) => Math.abs(a.x - b.x) < (aw + bw) / 2 && Math.abs(a.y - b.y) < (ah + bh) / 2;
export function update(self: SceneSelf, dt: number) {
  const runner = game.find('Runner'), jump = game.isDown('Jump');
  if (self.state.dead) { if (jump && !self.state.held) reset(self); self.state.held = jump; return; }
  const onGround = runner.y >= GROUND - 20;
  if (onGround && jump && !self.state.held) self.state.vy = -self.params.jump;
  self.state.held = jump;
  self.state.vy += self.params.gravity * dt;
  runner.y = Math.min(GROUND - 20, runner.y + self.state.vy * dt);
  if (runner.y >= GROUND - 20) self.state.vy = 0;
  runner.rotation = onGround ? 0 : runner.rotation + 360 * dt;
  self.state.speed = Math.min(900, self.state.speed + 12 * dt);
  self.state.distance += self.state.speed * dt;
  globals.distance = Math.floor(self.state.distance / 10);
  const cacti = game.findAll('Cactus');
  for (const c of cacti) {
    c.x -= self.state.speed * dt;
    if (c.x < -60) c.x = Math.max(...cacti.map(o => o.x)) + 320 + Math.random() * 380;
    if (hit(runner, 40, 40, c, 30, 64)) {
      self.state.dead = true; game.find('Game over').active = true; game.camera.shake(14, 0.35);
      if (globals.distance > globals.best) globals.best = globals.distance;
    }
  }
  for (const layer of [['Dune', 0.3, 1200], ['Cloud', 0.1, 1200]] as const)
    for (const o of game.findAll(layer[0])) { o.x -= self.state.speed * layer[1] * dt; if (o.x < -300) o.x += layer[2]; }
}`;
const runner = () => {
 const cacti = [0, 1, 2].map(i => entity(`cactus-${i}`, 'Cactus', 1100 + i * 420, 398, [shape(`cactus-${i}`, 'rect', 30, 64, '#2d6a4f', {rounded: 12, strokeColor: '#1b4332', strokeWidth: 3})]));
 const arms = [0, 1, 2].flatMap(i => [entity(`arm-${i}-a`, 'Arm', -20, -6, [shape(`arm-${i}-a`, 'rect', 14, 26, '#2d6a4f', {rounded: 7})], `cactus-${i}`), entity(`arm-${i}-b`, 'Arm', 20, -16, [shape(`arm-${i}-b`, 'rect', 14, 22, '#2d6a4f', {rounded: 7})], `cactus-${i}`)]);
 const dunes = [0, 1, 2, 3].map(i => entity(`dune-${i}`, 'Dune', i * 400 + 100, 420, [shape(`dune-${i}`, 'ellipse', 520, 160, i % 2 ? '#e9b872' : '#dda15e', {alpha: .8})]));
 const clouds = [0, 1, 2, 3].map(i => entity(`cloud-${i}`, 'Cloud', i * 330 + 80, 90 + (i % 2) * 50, [shape(`cloud-${i}`, 'ellipse', 130, 40, '#fff6e5', {alpha: .8})]));
 return {
  id: 'runner', title: 'Desert Dash', file: 'Desert Dash.pixieditor', expect: 'runner',
  description: 'An endless runner that gets faster: jump the cacti with Space, a click or a tap. Motion and collisions are written by hand in one scene script (no physics engine), with parallax dunes and clouds and a saved best distance.',
  tags: ['Runner', 'Touch', 'Scene script', 'Parallax'],
  project: {
   scenes: [scene('s-run', 'Run', [
    entity('sun', 'Sun', 780, 110, [shape('sun', 'ellipse', 120, 120, '#ffd166'), effects('sun', {glowStrength: 3, glowColor: '#ffb703', glowDistance: 30})]),
    ...clouds, ...dunes,
    entity('ground', 'Ground', 480, 485, [shape('ground', 'rect', 960, 110, '#bc6c25')]),
    entity('ground-line', 'Ground line', 480, 431, [shape('ground-line', 'rect', 960, 4, '#7f4f24')]),
    ...cacti, ...arms,
    entity('runner', 'Runner', 160, 410, [shape('runner', 'rect', 40, 40, '#e63946', {rounded: 10, strokeColor: '#9d0208', strokeWidth: 3})]),
    entity('eye', 'Eye', 8, -6, [shape('eye', 'ellipse', 8, 8, '#ffffff')], 'runner'),
    entity('distance', 'Distance', 480, 40, [text('distance', '{distance} m', 30, '#5a3e1b', {fontWeight: 'bold'})]),
    entity('best', 'Best', 860, 40, [text('best', 'Best {best} m', 18, '#7f5539')]),
    entity('help', 'Help', 160, 40, [text('help', 'Space, click or tap to jump', 16, '#7f5539')]),
    {...entity('over', 'Game over', 480, 230, [text('over', 'Ouch! Jump to run again', 38, '#ffffff', {fontWeight: 'bold', strokeColor: '#5a3e1b', strokeWidth: 8})]), active: false},
    entity('saver', 'Best distance', 20, 520, [rules('saver', [rule('load', {type: 'scene.start', sourceId: 's-run'}, [{type: 'save.read', targetId: 'save'}]), rule('store', {type: 'global.change', sourceId: 'g-best'}, [{type: 'save.write', targetId: 'save'}])])]),
   ])],
   sceneScripts: {'s-run': 's-runner'},
   extensions: {
    'pixi.render': look('#f4d6a0'),
    'interactions.globals': {version: 1, items: [global('g-distance', 'distance', 0), global('g-best', 'best', 0)]},
    'input.map': {version: 1, deadzone: .2, actions: [{id: 'a-jump', name: 'Jump', kind: 'button', bindings: [{type: 'key', code: 'Space'}, {type: 'key', code: 'ArrowUp'}, {type: 'mouse', button: 0}, {type: 'touch'}]}]},
    'scripts.library': {version: 1, items: [{id: 's-runner', name: 'Runner', source: runnerScript, code: compile(runnerScript)}]},
   },
  },
 };
};

// ---------- 8. Pair Up: memory puzzle with messages ----------
const cardScript = `export function onClick(self: GameObject) { game.send('pick', self.id); }`;
const memoryScript = `export function start(self: SceneSelf) {
  const cards = game.findAll('Card'), spots = cards.map(c => ({ x: c.x, y: c.y }));
  for (let i = spots.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [spots[i], spots[j]] = [spots[j], spots[i]]; }
  cards.forEach((c, i) => { c.x = spots[i].x; c.y = spots[i].y; c.children[0].active = false; });
  self.state.open = []; self.state.matched = []; self.state.wait = 0; self.state.time = 0; self.state.done = false;
  globals.moves = 0; globals.seconds = 0;
}
export function update(self: SceneSelf, dt: number) {
  if (!self.state.done) { self.state.time += dt; globals.seconds = Math.floor(self.state.time); }
  if (self.state.wait > 0) {
    self.state.wait -= dt;
    if (self.state.wait <= 0) { for (const id of self.state.open) flip(id, false); self.state.open = []; }
  }
}
function card(id: string) { return game.findAll('Card').find(c => c.id === id)!; }
function flip(id: string, face: boolean) { const c = card(id); c.children[0].active = face; c.play('tween'); }
export function onMessage(self: SceneSelf, message: string, id: string) {
  if (message !== 'pick' || self.state.wait > 0 || self.state.done) return;
  if (self.state.open.includes(id) || self.state.matched.includes(id)) return;
  flip(id, true); self.state.open.push(id);
  if (self.state.open.length < 2) return;
  globals.moves += 1;
  const [a, b] = self.state.open.map(card);
  if (a.children[0].name === b.children[0].name) {
    self.state.matched.push(a.id, b.id); self.state.open = [];
    for (const c of [a, b]) c.alpha = 0.55;
    if (self.state.matched.length === game.findAll('Card').length) { self.state.done = true; game.find('Solved').active = true; }
  } else self.state.wait = 0.8;
}`;
const memory = () => {
 const symbols = ['star', 'circle', 'triangle', 'hexagon', 'diamond', 'heart'], colors = ['#ffd166', '#06d6a0', '#ef476f', '#118ab2', '#c77dff', '#ff8fab'];
 const face = (id, symbol, color) => {
  if (symbol === 'star') return shape(id, 'star', 64, 64, color, {sides: 5, innerRadius: .45});
  if (symbol === 'circle') return shape(id, 'ellipse', 60, 60, color);
  if (symbol === 'triangle') return shape(id, 'triangle', 64, 58, color);
  if (symbol === 'hexagon') return shape(id, 'polygon', 64, 64, color, {sides: 6});
  if (symbol === 'diamond') return shape(id, 'polygon', 50, 70, color, {sides: 4});
  return shape(id, 'star', 66, 66, color, {sides: 8, innerRadius: .7});
 };
 const cards = [];
 for (let i = 0; i < 12; i++) {
  const s = Math.floor(i / 2), id = `card-${i}`, x = 210 + (i % 4) * 180, y = 150 + Math.floor(i / 4) * 150;
  cards.push(entity(id, 'Card', x, y, [shape(id, 'rect', 140, 120, '#2b2d42', {rounded: 14, strokeColor: '#8d99ae', strokeWidth: 3}), behaviour(id, 's-card'), tween(id, id, [['scaleX', 1, .82]], {duration: .09, yoyo: true, repeat: 1, autoplay: false, ease: 'quad.out'})]));
  cards.push({...entity(`${id}-face`, `${symbols[s]} face`, 0, 0, [face(`${id}-face`, symbols[s], colors[s])], id), active: false});
 }
 return {
  id: 'memory', title: 'Pair Up', file: 'Pair Up.pixieditor', expect: 'card-0',
  description: 'A memory puzzle: flip two cards, keep the pairs, clear the board in as few moves as you can. Cards shuffle every game; card scripts send messages to a scene script that runs the rules, the timer and the move counter.',
  tags: ['Puzzle', 'Messages', 'Tween', 'Mouse'],
  project: {
   scenes: [scene('s-pairs', 'Table', [
    entity('felt', 'Felt', 480, 300, [shape('felt', 'rect', 780, 470, '#1b4332', {rounded: 24, strokeColor: '#0f2a1f', strokeWidth: 6})]),
    ...cards,
    entity('title', 'Title', 480, 34, [text('title', 'Pair Up', 30, '#edf2f4', {fontWeight: 'bold'})]),
    entity('moves', 'Moves', 140, 34, [text('moves', 'Moves {moves}', 20, '#8d99ae')]),
    entity('time', 'Time', 690, 34, [text('time', '{seconds} s', 20, '#8d99ae')]),
    {...entity('solved', 'Solved', 480, 300, [text('solved', 'Solved in {moves} moves!', 42, '#ffd166', {fontWeight: 'bold', strokeColor: '#1b1b2f', strokeWidth: 8})]), active: false},
    ...button('again', 'Shuffle', 860, 34, 120, '#edf2f4', id => [rules(id, [rule(`${id}-go`, {type: 'pointer.click', sourceId: id}, [{type: 'scene.change', targetId: 's-pairs'}])])]),
   ])],
   sceneScripts: {'s-pairs': 's-memory'},
   extensions: {
    'pixi.render': look('#1b1b2f'),
    'interactions.globals': {version: 1, items: [global('g-moves', 'moves', 0), global('g-seconds', 'seconds', 0)]},
    'scripts.library': {version: 1, items: [['s-card', 'Card', cardScript], ['s-memory', 'Pairs', memoryScript]].map(([id, name, source]) => ({id, name, source, code: compile(source)}))},
   },
  },
 };
};

// ---------- 9. Gravity Well: a home-made n-body force ----------
const orbitScript = `export const params = { pull: param.number(5200000, { label: 'Sun pull (GM)' }) };
export function update(self: SceneSelf, dt: number) {
  const sun = game.find('Sun'), planets = game.findAll('Planet');
  for (const p of planets) {
    let ax = 0, ay = 0;
    const add = (o: GameObject, gm: number) => { const dx = o.x - p.x, dy = o.y - p.y, d2 = Math.max(400, dx * dx + dy * dy), d = Math.sqrt(d2); ax += gm * dx / (d2 * d); ay += gm * dy / (d2 * d); };
    add(sun, self.params.pull);
    for (const q of planets) if (q !== p) add(q, self.params.pull * 0.004 * q.body.mass / p.body.mass);
    p.body.push(ax * dt, ay * dt);
  }
}`;
const planetScript = `export function onCollision(self: GameObject, other: GameObject) {
  if (other.name !== 'Sun') return;
  const r = 180 + Math.random() * 200, a = Math.random() * Math.PI * 2, v = Math.sqrt(5200000 / r);
  self.body.teleport(480 + Math.cos(a) * r, 270 + Math.sin(a) * r);
  self.body.velocity = { x: -Math.sin(a) * v, y: Math.cos(a) * v };
  game.camera.shake(8, 0.25);
}`;
const orbits = () => {
 let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
 const stars = Array.from({length: 90}, (_, i) => entity(`star-${i}`, 'Star', -240 + rnd() * 1440, -170 + rnd() * 880, [shape(`star-${i}`, 'ellipse', 2 + rnd() * 3, 2 + rnd() * 3, '#ffffff', {alpha: .3 + rnd() * .6})]));
 const planets = [[130, 10, '#7cc6fe', .002], [210, 16, '#f4a259', .003], [300, 22, '#8ac926', .004], [400, 13, '#c77dff', .002]].map(([r, size, color, density], i) => {
  const a = i * 1.7, v = Math.sqrt(5200000 / r), id = `planet-${i}`;
  return entity(id, 'Planet', 480 + Math.cos(a) * r, 270 + Math.sin(a) * r, [shape(id, 'ellipse', size * 2, size * 2, color), effects(id, {glowStrength: 1.5, glowColor: color, glowDistance: 10}), body(id, {density, friction: 0, frictionStatic: 0, airFriction: 0, restitution: .9, draggable: true, velocityX: Math.round(-Math.sin(a) * v), velocityY: Math.round(Math.cos(a) * v)}), circle(id, size), behaviour(id, 's-planet')]);
 });
 return {
  id: 'orbits', title: 'Gravity Well', file: 'Gravity Well.pixieditor', expect: 'sun',
  description: 'Planets orbit a sun under a gravity force written in a scene script (and pull on each other a little). Drag a planet and let go to fling it into a new orbit. Physics with world gravity off, a zoomed-out camera and glow.',
  tags: ['Simulation', 'Forces', 'Drag', 'Camera'],
  project: {
   scenes: [scene('s-space', 'Space', [
    entity('ring-1', 'Orbit guide', 480, 270, [shape('ring-1', 'ellipse', 600, 600, '#070b1a', {strokeColor: '#1f2747', strokeWidth: 2})]),
    entity('ring-2', 'Orbit guide', 480, 270, [shape('ring-2', 'ellipse', 260, 260, '#070b1a', {strokeColor: '#1f2747', strokeWidth: 2})]),
    ...stars,
    entity('sun', 'Sun', 480, 270, [shape('sun', 'ellipse', 90, 90, '#ffbe0b'), effects('sun', {glowStrength: 5, glowColor: '#ff8800', glowDistance: 40}), body('sun', {bodyType: 'static'}), circle('sun', 45), tween('sun', 'sun', [['scaleX', 1, 1.06], ['scaleY', 1, 1.06]], {duration: 1.6, yoyo: true, repeat: 100})]),
    ...planets,
    entity('camera', 'Camera', 480, 270, [camera('camera', {zoom: .75})]),
    entity('help', 'Help', 480, 512, [text('help', 'Drag a planet and let go to change its orbit', 18, '#8892b0'), hud('help', 'bottom')]),
   ])],
   sceneScripts: {'s-space': 's-orbit'},
   extensions: {
    'pixi.render': look('#070b1a'), 'physics.world': world({gravityY: 0}),
    'scripts.library': {version: 1, items: [['s-orbit', 'Gravity', orbitScript], ['s-planet', 'Planet', planetScript]].map(([id, name, source]) => ({id, name, source, code: compile(source)}))},
   },
  },
 };
};

// ---------- 10. The Lighthouse: branching story, state machine, English/Turkish ----------
const lighthouse = () => {
 const lines = {
  intro: ['A storm rolls in. The old lighthouse has been dark for years, and a boat is still out at sea.', 'Bir fırtına yaklaşıyor. Eski deniz feneri yıllardır karanlık ve denizde hâlâ bir tekne var.'],
  stairs: ['You climb 117 rusty steps. At the top, the great lamp waits under a sheet of dust.', 'Paslı 117 basamağı tırmanıyorsun. Tepede büyük lamba bir toz örtüsünün altında bekliyor.'],
  shore: ['On the shore you find a rowing boat and an oil lantern that still has a little fuel.', 'Kıyıda bir kayık ve içinde hâlâ biraz yağ olan bir fener buluyorsun.'],
  lit: ['The lamp roars to life. Its beam sweeps the waves and the boat turns safely toward the harbour.', 'Lamba canlanıyor. Işığı dalgaları tarıyor ve tekne güvenle limana yöneliyor.'],
  rowed: ['You row into the dark, lantern held high. The sailors see you and follow you home.', 'Feneri yukarıda tutarak karanlığa kürek çekiyorsun. Denizciler seni görüp eve kadar izliyor.'],
  choose: ['What do you do?', 'Ne yapıyorsun?'],
  climb: ['Climb the tower', 'Kuleye tırman'], walk: ['Walk the shore', 'Kıyıda yürü'], light: ['Light the lamp', 'Lambayı yak'], row: ['Row out to sea', 'Denize açıl'], back: ['Go back', 'Geri dön'], again: ['Begin again', 'Baştan başla'],
  title: ['The Lighthouse', 'Deniz Feneri'], end: ['The end', 'Son'],
 };
 const entries = Object.entries(lines).map(([key, [en, tr]]) => ({key: `story.${key}`, values: {en, tr}}));
 const narration = (key, active) => ({...entity(`line-${key}`, `Line ${key}`, 480, 392, [text(`line-${key}`, `{@story.${key}}`, 22, '#f1f5f9', {strokeColor: '#0b132b', strokeWidth: 5, wordWrap: true, wrapWidth: 760, lineHeight: 30})]), active});
 const steps = ['intro', 'stairs', 'shore', 'lit', 'rowed'], buttons = {intro: ['climb', 'walk'], stairs: ['light', 'back'], shore: ['row', 'back'], lit: ['again'], rowed: ['again']};
 const x = (list, i) => list.length === 1 ? 480 : 340 + i * 280;
 // A copy of a choice button per step keeps each state's buttons independent.
 const buttonEntities = steps.flatMap(s => buttons[s].flatMap((k, i) => button(`btn-${k}-${s}`, `{@story.${k}}`, x(buttons[s], i), 470, 240, '#ffd166', () => []).map(e => e.parentId ? e : {...e, active: s === 'intro'})));
 const visible = new Set(buttonEntities.map(e => e.id).filter(id => !id.endsWith('-label')));
 const show = s => [...[...steps.map(x => `line-${x}`), ...visible].map(id => ({type: 'entity.active', targetId: id, value: id === `line-${s}` || id.endsWith(`-${s}`) && visible.has(id)}))];
 const states = steps.map(s => ({id: `st-${s}`, name: s[0].toUpperCase() + s.slice(1), actions: show(s).map((a, i) => ({id: `st-${s}-${i}`, ...a}))}));
 const go = (from, key, to) => [`btn-${key}-${from}`, `btn-${key}-${from}-label`].map((source, i) => ({id: `tr-${from}-${key}-${i}`, from: `st-${from}`, to: `st-${to}`, trigger: {type: 'pointer.click', sourceId: source, event: ''}}));
 const transitions = [...go('intro', 'climb', 'stairs'), ...go('intro', 'walk', 'shore'), ...go('stairs', 'light', 'lit'), ...go('stairs', 'back', 'intro'), ...go('shore', 'row', 'rowed'), ...go('shore', 'back', 'intro'), ...go('lit', 'again', 'intro'), ...go('rowed', 'again', 'intro')];
 const waves = [0, 1, 2].map(i => entity(`wave-${i}`, 'Wave', 480 + i * 30, 300 + i * 26, [shape(`wave-${i}`, 'rect', 1100, 60, ['#1c3b5a', '#16324e', '#102841'][i], {rounded: 30}), tween(`wave-${i}`, `wave-${i}`, [['x', 470 + i * 30, 500 + i * 30], ['y', 300 + i * 26, 306 + i * 26]], {duration: 2.4 + i * .5, yoyo: true, repeat: 100})]));
 const lang = (id, label, x) => button(`lang-${id}`, label, x, 30, 56, '#e2e8f0', bid => [rules(bid, [rule(`${bid}-set`, {type: 'pointer.click', sourceId: bid}, [{type: 'language.set', targetId: id}])])]);
 return {
  id: 'story', title: 'The Lighthouse', file: 'The Lighthouse.pixieditor', expect: 'story',
  description: 'A short branching story with two endings. A state machine shows each passage and its choices; every line is localized in English and Turkish, switchable in the game. Ambient tweens animate the sea and the beam.',
  tags: ['Story', 'State machine', 'Localization', 'UI'],
  project: {
   scenes: [scene('s-story', 'Story', [
    entity('moon', 'Moon', 160, 90, [shape('moon', 'ellipse', 70, 70, '#e2e8f0'), effects('moon', {glowStrength: 2, glowColor: '#cbd5e1', glowDistance: 20})]),
    entity('tower', 'Tower', 760, 190, [shape('tower', 'triangle', 90, 240, '#e2e8f0', {strokeColor: '#94a3b8', strokeWidth: 3})]),
    entity('stripe', 'Stripe', 0, 30, [shape('stripe', 'rect', 52, 22, '#ef4444')], 'tower'),
    entity('lamp', 'Lamp', 760, 72, [shape('lamp', 'ellipse', 30, 30, '#fde68a'), effects('lamp', {glowStrength: 4, glowColor: '#fbbf24', glowDistance: 30}), tween('lamp', 'lamp', [['scaleX', .7, 1.25], ['scaleY', .7, 1.25]], {duration: 1.1, yoyo: true, repeat: 100})]),
    entity('beam', 'Beam', 760, 72, [shape('beam', 'triangle', 120, 520, '#fde68a', {alpha: .18}), effects('beam', {blur: 6, blendMode: 'add'}), tween('beam', 'beam', [['rotation', -60, 60]], {duration: 4, yoyo: true, repeat: 100})], null, {rotation: -60}),
    ...waves,
    entity('panel', 'Text panel', 480, 425, [shape('panel', 'rect', 900, 190, '#0b132b', {rounded: 18, alpha: .82})]),
    entity('title', 'Title', 480, 30, [text('title', '{@story.title}', 28, '#f8fafc', {fontWeight: 'bold', letterSpacing: 2})]),
    ...steps.map(s => narration(s, s === 'intro')),
    ...buttonEntities,
    ...lang('en', 'EN', 830), ...lang('tr', 'TR', 900),
    entity('story', 'Story', 40, 40, [{id: 'story-sm', type: 'interactions.stateMachine', version: 1, data: {states, initial: 'st-intro', transitions}}]),
   ])],
   extensions: {
    'pixi.render': look('#0b1d33'),
    'interactions.strings': {version: 1, defaultLanguage: 'en', languages: [{id: 'en', name: 'English'}, {id: 'tr', name: 'Türkçe'}], entries},
   },
  },
 };
};

// ---------- 11. Maze Escape: top-down, keys and doors, patrols ----------
const explorerScript = `export const params = { speed: param.number(230) };
export function start(self: GameObject) { self.state.spawn = { x: self.x, y: self.y }; globals.keys = 0; }
export function update(self: GameObject) {
  const x = globals.moveX, y = globals.moveY, length = Math.hypot(x, y) || 1, k = Math.min(1, Math.hypot(x, y)) / length;
  self.body.velocity = { x: x * k * self.params.speed, y: y * k * self.params.speed };
}
export function onCollision(self: GameObject, other: GameObject) {
  if (other.name.endsWith(' key') && other.active) {
    other.active = false; globals.keys += 1;
    const door = game.find(other.name.replace('key', 'door')); if (door) door.active = false;
  }
  if (other.name === 'Guard') { self.body.teleport(self.state.spawn.x, self.state.spawn.y); game.camera.shake(12, 0.3); }
  if (other.name === 'Exit') game.changeScene('Escaped');
}`;
const maze = () => {
 const plan = [
  '########################',
  '#S......#.....b.#......#',
  '#.......#.......#......#',
  '#.#####.#.#####.B......#',
  '#.......#...#...#......#',
  '#.......#...#...#......#',
  '######..#...#...######.#',
  '#.......###.#...#......#',
  '#.......#...#...#......#',
  '#..######...#...#.######',
  '#.......#.###.###..#...#',
  '#...#...Y.......#..#...#',
  '#.y.#...#.......#..#..E#',
  '#.......#.......#......#',
  '########################',
 ];
 const S = 60, out = [];
 plan.forEach((row, r) => [...row].forEach((ch, c) => {
  const x = c * S + S / 2, y = r * S + S / 2, id = `m-${r}-${c}`;
  if (ch === '#') out.push(entity(id, 'Wall', x, y, [shape(id, 'rect', S, S, '#334155', {strokeColor: '#1e293b', strokeWidth: 2}), box(id, S, S)]));
  if (ch === 'y' || ch === 'b') { const color = ch === 'y' ? '#facc15' : '#38bdf8', name = ch === 'y' ? 'Yellow key' : 'Blue key'; out.push(entity(id, name, x, y, [shape(id, 'star', 30, 30, color, {sides: 4, innerRadius: .4}), circle(id, 14, true), tween(id, id, [['rotation', 0, 90]], {duration: 1.2, repeat: 100, ease: 'linear'})])); }
  if (ch === 'Y' || ch === 'B') { const color = ch === 'Y' ? '#facc15' : '#38bdf8', name = ch === 'Y' ? 'Yellow door' : 'Blue door'; out.push(entity(id, name, x, y, [shape(id, 'rect', S, S, color, {alpha: .85, strokeColor: '#0f172a', strokeWidth: 4}), box(id, S, S)])); }
  if (ch === 'E') out.push(entity('exit', 'Exit', x, y, [shape('exit', 'rect', S - 8, S - 8, '#22c55e', {rounded: 8}), effects('exit', {glowStrength: 3, glowColor: '#22c55e', glowDistance: 18}), box('exit', S - 20, S - 20, true)]));
  if (ch === 'S') out.push(entity('explorer', 'Explorer', x, y, [shape('explorer', 'ellipse', 34, 34, '#f97316', {strokeColor: '#7c2d12', strokeWidth: 3}), body('explorer', {lockRotation: true, friction: 0, frictionStatic: 0, airFriction: 0}), circle('explorer', 16), behaviour('explorer', 's-explorer')]));
 }));
 const guard = (id, x, y, axis, from, to, duration) => entity(id, 'Guard', x, y, [shape(id, 'polygon', 36, 36, '#ef4444', {sides: 3}), effects(id, {glowStrength: 2, glowColor: '#ef4444', glowDistance: 12}), body(id, {bodyType: 'kinematic'}), circle(id, 16, true), tween(id, id, [[axis, from, to]], {duration, yoyo: true, repeat: 100, ease: 'sine.inOut'})]);
 return {
  id: 'maze', title: 'Maze Escape', file: 'Maze Escape.pixieditor', expect: 'explorer',
  description: 'A top-down maze: move in any direction with the arrows or WASD, pick up keys to open matching doors, dodge patrolling guards and reach the green exit. Two input axes, sensors, kinematic patrols and a zoomed camera that follows you.',
  tags: ['Top-down', 'Input', 'Physics', 'Camera'],
  project: {
   scenes: [scene('s-maze', 'Maze', [
    entity('floor', 'Floor', 720, 450, [shape('floor', 'rect', 1440, 900, '#0f172a')]),
    ...out,
    guard('guard-1', 90, 510, 'x', 90, 450, 2.6), guard('guard-2', 870, 270, 'y', 270, 570, 2.2), guard('guard-3', 1050, 270, 'x', 1050, 1350, 2.4),
    entity('camera', 'Camera', 480, 270, [camera('camera', {zoom: 1.3, target: 'explorer', smoothing: 7, limit: true, limitRight: 1440, limitBottom: 900})]),
    entity('keys', 'Keys label', 80, 30, [text('keys', 'Keys {keys} / 2', 20, '#f8fafc', {fontWeight: 'bold', strokeColor: '#0f172a', strokeWidth: 5}), hud('keys')]),
   ]), endScene('s-out', 'Escaped', 'Escaped!', 'You found the way out.', '#22c55e', 's-maze', [])],
   extensions: {
    'pixi.render': look('#020617'), 'physics.world': world({gravityY: 0}),
    'interactions.globals': {version: 1, items: [global('g-mx', 'moveX', 0), global('g-my', 'moveY', 0), global('g-keys', 'keys', 0)]},
    'input.map': {version: 1, deadzone: .2, actions: [
     {id: 'a-mx', name: 'MoveX', kind: 'axis', bindings: [{type: 'keyAxis', negative: 'ArrowLeft', positive: 'ArrowRight'}, {type: 'keyAxis', negative: 'KeyA', positive: 'KeyD'}], globalId: 'g-mx'},
     {id: 'a-my', name: 'MoveY', kind: 'axis', bindings: [{type: 'keyAxis', negative: 'ArrowUp', positive: 'ArrowDown'}, {type: 'keyAxis', negative: 'KeyW', positive: 'KeyS'}], globalId: 'g-my'},
    ]},
    'scripts.library': {version: 1, items: [{id: 's-explorer', name: 'Explorer', source: explorerScript, code: compile(explorerScript)}]},
   },
  },
 };
};

const built = [platformer(), breakout(), clicker(), playground(), neon(), snake(), runner(), memory(), orbits(), lighthouse(), maze()];
const interactive = {id: 'interactive', title: 'Interactive Demo', file: '../end-to-end/Interactive demo.pixieditor', expect: null, description: 'The end-to-end sample with imported art and sound: sprites, a tween and an animation, a click sound, Matter physics, a Spine skeleton and a scene change.', tags: ['Sprites', 'Audio', 'Spine', 'Animation']};

// ---------- run the editor ----------
const temp = await mkdtemp(join(tmpdir(), 'rewrite-examples-'));
const env = {...process.env}; delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
 app = await electron.launch({executablePath: process.env.REWRITE_EXECUTABLE || require('electron'), args: [...(process.env.REWRITE_EXECUTABLE ? [] : [join(root, 'apps/editor-desktop/out/main/index.js')]), '--no-hub', `--user-data-dir=${join(temp, 'user')}`], env});
 const page = await app.firstWindow(); page.setDefaultTimeout(20000);
 const errors = []; page.on('pageerror', e => errors.push(e.message));
 const canvas = page.getByTestId('pixi-canvas');
 await expect(canvas).toHaveAttribute('data-ready', 'true', {timeout: 30000});
 const menu = label => app.evaluate(({Menu}, l) => Menu.getApplicationMenu().items.flatMap(m => m.submenu?.items ?? []).find(i => i.label === l).click(), label);
 const choose = path => app.evaluate(({dialog}, target) => { dialog.showOpenDialog = async () => ({canceled: false, filePaths: [target]}); dialog.showSaveDialog = async () => ({canceled: false, filePath: target}); dialog.showMessageBox = async () => ({response: 1, checkboxChecked: false}); }, path);
 await page.addStyleTag({content: '.viewport-navigation{display:none!important}'});
 const blank = join(temp, 'blank.pixieditor'); await choose(blank); await menu('Save');
 await expect.poll(() => readFile(blank, 'utf8').then(() => true, () => false)).toBe(true);
 const base = JSON.parse(await readFile(blank, 'utf8'));
 const photograph = async (target, stage = {width: 960, height: 540}) => {
  await page.getByRole('button', {name: 'Play', exact: true}).click();
  await page.waitForTimeout(1600);
  const b = await canvas.locator('canvas').boundingBox(), s = Math.min((b.width - 80) / stage.width, (b.height - 90) / stage.height);
  const shot = await page.screenshot({clip: {x: b.x + (b.width - stage.width * s) / 2, y: b.y + (b.height - stage.height * s) / 2, width: stage.width * s, height: stage.height * s}});
  await sharp(shot).resize(480, 270).png().toFile(target);
  const rulesErrors = JSON.parse(await canvas.getAttribute('data-interactions') ?? '{}').errors ?? [];
  await page.keyboard.press('Alt+KeyC'); const problems = await page.getByTestId('script-console').locator('[data-level=error]').allInnerTexts().catch(() => []); await page.keyboard.press('Escape');
  await page.getByRole('button', {name: 'Stop', exact: true}).click();
  return [...problems, ...rulesErrors.map(e => JSON.stringify(e))];
 };
 const catalog = [];
 for (const example of built) {
  const dir = join(root, 'examples', example.id), file = join(dir, example.file);
  await rm(dir, {recursive: true, force: true}); await mkdir(dir, {recursive: true});
  const {scenes, extensions, sceneScripts = {}} = example.project;
  const library = extensions['scripts.library'];
  if (library && Object.keys(sceneScripts).length) library.scenes = Object.fromEntries(Object.entries(sceneScripts).map(([sceneId, scriptId]) => [sceneId, {scriptId, params: {}, refs: {}}]));
  await writeFile(file, JSON.stringify({...base, name: example.title, entrySceneId: scenes[0].id, scenes, extensions: {...base.extensions, ...extensions}}));
  await choose(file); await menu('Open…');
  await expect.poll(async () => Object.keys(JSON.parse(await canvas.getAttribute('data-transforms') ?? '{}'))).toContain(example.expect);
  await choose(file); await menu('Save'); await expect(page.getByLabel('Unsaved changes', {exact: true})).toHaveCount(0);
  const problems = await photograph(join(dir, 'thumbnail.png'));
  if (problems.length || errors.length) throw Error(`${example.title}: ${[...problems, ...errors].join('\n')}`);
  catalog.push({id: example.id, title: example.title, description: example.description, tags: example.tags, file: `${example.id}/${example.file}`, thumbnail: `${example.id}/thumbnail.png`});
  console.log(`PASS ${example.title}: opened, saved and played without errors`);
 }
 const demo = join(root, 'examples/end-to-end/Interactive demo.pixieditor');
 await choose(demo); await menu('Open…');
 await expect.poll(async () => Object.keys(JSON.parse(await canvas.getAttribute('data-transforms') ?? '{}')).length).toBeGreaterThan(3);
 await photograph(join(root, 'examples/end-to-end/thumbnail.png'));
 catalog.splice(4, 0, {id: interactive.id, title: interactive.title, description: interactive.description, tags: interactive.tags, file: 'end-to-end/Interactive demo.pixieditor', thumbnail: 'end-to-end/thumbnail.png'});
 await writeFile(join(root, 'examples/catalog.json'), JSON.stringify({version: 1, examples: catalog}, null, 1) + '\n');
 if (errors.length) throw Error(errors.join('\n'));
 console.log(`PASS catalog: ${catalog.length} examples`);
} finally {
 if (app) { await app.evaluate(({BrowserWindow}) => { for (const w of BrowserWindow.getAllWindows()) w.destroy(); }).catch(() => {}); await app.close().catch(() => {}); }
 await rm(temp, {recursive: true, force: true, maxRetries: 3});
}
