import { RuntimeSession } from '@olivestudio/engine/runtime';
import type { InteractionEvent } from '@rewrite/interactions';
import { createScenePhysics, type PhysicsSession } from '@rewrite/physics';
import { matterProvider } from '@rewrite/physics-matter';
import type { PhysicsEvent, PhysicsSettings } from '@rewrite/physics/contracts';
import type { Entity } from '@rewrite/scene';
import type { Container } from 'pixi.js';
import { hasPhysics } from './physicsModel';
import type { SceneObject } from './scene';
import { gameEntity } from './previewEntity';
import { selectionTree } from './selection';

export function physicsEntities(roots: readonly SceneObject[], display: (id: string) => Container | undefined) {
  return [...selectionTree(roots.filter(node => !node.screenSpace)).values()].map(({ node, parent }) => {
    // The physics compiler also needs transforms of ancestors without components.
    const entity = gameEntity(node, parent, () => display(node.id));
    const parts: Entity['components'] = [
      ...(node.physics?.colliders.map(item => ({ id: `${node.id}:${item.id}`, version: 1, type: `physics.${item.kind}Collider2d`, data: item.data })) ?? []),
      ...(node.physics?.joints.map(item => ({ id: `${node.id}:${item.id}`, version: 1, type: 'physics.joint2d', data: item.data })) ?? []),
    ];
    if (node.physics?.body) parts.push({ id: `${node.id}:body`, type: 'physics.rigidBody2d', version: 1, data: node.physics.body });
    if (node.type === 'Tilemap' && node.collision === 'solid' && node.tiles.some(tile => tile >= 0)) {
      const { tileWidth, tileHeight, columns, rows } = node;
      const tiles = Array.from({ length: columns * rows }, (_, index) => node.tiles[index] ?? -1);
      parts.push({ id: `${node.id}:tilemap`, type: 'pixi.tilemap', version: 1, data: { collision: 'solid', tileWidth, tileHeight, columns, rows, tiles } });
    }
    entity.components.push(...parts);
    return entity;
  });
}

export type PhysicsStatus = {
  paused: boolean;
  steps: number;
  bodies: number;
  errors: readonly string[];
  contacts: readonly { phase: 'enter' | 'exit'; a: string; b: string; sensor: boolean }[];
};

export class PreviewPhysics {
  private session?: PhysicsSession;
  private clock?: RuntimeSession;
  private stopSession?: () => void;
  private publish?: (status: PhysicsStatus | undefined) => void;
  private contacts: PhysicsStatus['contacts'] = [];
  private lastSteps = 0;
  get active() { return !!this.clock; }
  get controls() { return this.clock ? this.session?.controls : undefined; }

  start(
    objects: readonly SceneObject[], settings: PhysicsSettings, display: (id: string) => Container | undefined,
    bounds: () => { width: number; height: number }, emit: (event: InteractionEvent) => void,
    publish: (status: PhysicsStatus | undefined) => void,
  ) {
    this.stop();
    const roots = objects.filter(node => !node.screenSpace);
    if (!settings.walls && ![...selectionTree(roots).values()].some(({ node }) => hasPhysics(node))) return () => {};
    const entities = physicsEntities(roots, display);
    if (!settings.walls && !entities.some(entity => entity.components.some(component =>
      component.type.startsWith('physics.') || component.type === 'pixi.tilemap'))) return () => {};
    const names = new Map(entities.map(entity => [entity.id, entity.name]));
    const observe = (event: PhysicsEvent) => {
      this.contacts = [{
        phase: event.phase, a: names.get(event.a) ?? event.a, b: names.get(event.b) ?? event.b, sensor: event.sensor,
      }, ...this.contacts].slice(0, 12);
    };
    const session = createScenePhysics(() => entities, settings, matterProvider, { bounds, emit, observe, silent: () => false });
    this.publish = publish;
    this.session = session;
    const clock = new RuntimeSession([], () => [session.system]);
    if (!session.errors.length) this.clock = clock;
    const stop = () => {
      clock.dispose();
      this.clock = undefined;
      this.session = undefined;
      this.stopSession = undefined;
      this.publish = undefined;
      this.contacts = [];
      this.lastSteps = 0;
      publish(undefined);
    };
    this.stopSession = stop;
    this.status();
    return () => { if (this.stopSession === stop) this.stop(); };
  }

  private status() {
    const diagnostics = this.session?.diagnostics;
    if (!diagnostics) return;
    this.lastSteps = diagnostics.steps;
    this.publish?.({
      paused: !!this.clock?.paused, steps: diagnostics.steps, bodies: diagnostics.bodies.length,
      errors: diagnostics.errors, contacts: this.contacts,
    });
  }

  tick(dt: number) {
    const before = this.clock?.frame ?? 0;
    this.clock?.advance(dt);
    if (this.clock && this.clock.frame - this.lastSteps >= 8) this.status();
    return (this.clock?.frame ?? 0) - before;
  }

  pause(paused: boolean) {
    if (paused) this.clock?.pause();
    else this.clock?.resume();
    this.status();
  }

  step() {
    if (this.clock?.paused) this.clock.step();
    this.status();
  }

  pointer(phase: 'down' | 'move' | 'up', x: number, y: number) {
    return this.session?.pointer(phase, x, y) ?? false;
  }

  projectPoses() { this.session?.projectPoses(); }

  stop() { this.stopSession?.(); }
}
