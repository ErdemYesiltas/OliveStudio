import { expect, it } from 'vitest';
import { BaseEffect, EffectScope, type EffectDependency } from './BaseEffect';

type Target = { events: string[] };
class Effect extends BaseEffect<Target> {
  constructor(readonly name: string, private readonly requirements: readonly EffectDependency<Target>[] = [],
    private readonly fail = false) { super(); }

  protected dependencies() { return this.requirements; }

  protected onAttach(target: Target) {
    target.events.push(`attach:${this.name}`);
    if (this.fail) throw new Error('setup failed');
  }

  protected onDestroy() { this.target.events.push(`detach:${this.name}`); }
}

const required = (key: string, ...dependencies: EffectDependency<Target>[]) => ({
  key, create: () => new Effect(key, dependencies),
});

it('attaches shared requirements once per target and releases the last dependent', () => {
  const target: Target = { events: [] };
  const scope = EffectScope.for(target);
  const needs = required('blur', required('texture'));
  const a = new Effect('a', [needs]);
  const b = new Effect('b', [needs]);
  a.attach(target);
  scope.attach('b', b);
  expect(target.events).toEqual(['attach:texture', 'attach:blur', 'attach:a', 'attach:b']);
  a.detach();
  expect(scope.get('blur')?.isAttached).toBe(true);
  scope.remove('b');
  expect(scope.get('blur')).toBeUndefined();
  expect(scope.get('texture')).toBeUndefined();
  expect(target.events.filter(event => event.startsWith('detach:')))
    .toEqual(['detach:a', 'detach:b', 'detach:blur', 'detach:texture']);
});

it('keeps an explicitly attached effect when its dependents detach', () => {
  const target: Target = { events: [] };
  const scope = EffectScope.for(target);
  const explicit = new Effect('manual blur');
  scope.attach('blur', explicit);
  const parent = new Effect('parent', [required('blur')]);
  parent.attach(target);
  parent.detach();
  expect(scope.get('blur')).toBe(explicit);
  expect(explicit.isAttached).toBe(true);
  scope.remove('blur');
  expect(explicit.isAttached).toBe(false);
});

it('rolls back dependencies on failure and rejects a cycle introduced by replacement', () => {
  const target: Target = { events: [] };
  const scope = EffectScope.for(target);
  expect(() => scope.attach('bad', new Effect('bad', [required('texture')], true))).toThrow('setup failed');
  expect(scope.get('bad')).toBeUndefined();
  expect(scope.get('texture')).toBeUndefined();
  const first = new Effect('first');
  scope.attach('first', first);
  scope.attach('second', new Effect('second', [required('first')]));
  expect(() => scope.attach('first', new Effect('cycle', [required('second')]))).toThrow('Cyclic effect dependency');
  expect(scope.get('first')).toBe(first);
  scope.clear();
  expect([...scope.values()]).toHaveLength(0);
});
