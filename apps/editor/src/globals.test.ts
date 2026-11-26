import { describe, expect, it } from 'vitest';
import { globalText, PreviewGlobals, readGameSlot, writeGameSlot, type GlobalValues } from './globals';

describe('prototype game globals', () => {
  it('restores an ID-based checkpoint against the current typed definitions', () => {
    const globals = new PreviewGlobals();
    const changes: GlobalValues[] = [];
    const stop = globals.start({ version: 1, items: [
      { id: 'score', name: 'points', type: 'number', initial: 5 },
      { id: 'player', name: 'hero', type: 'object', initial: { hp: 10 } },
      { id: 'new', name: 'bonus', type: 'boolean', initial: true },
    ] }, values => changes.push(values));
    globals.set('new', false);
    globals.restore({ score: 70, player: { hp: 4 }, removed: [] });
    expect(changes).toHaveLength(3);
    expect(globalText('Points {points}, HP {hero.hp}, Bonus {bonus}', globals.snapshot())).toBe('Points 70, HP 4, Bonus true');
    globals.restore({ score: 'wrong type' });
    expect(globals.snapshot()).toEqual({ points: 5, hero: { hp: 10 }, bonus: true });
    stop();
    expect(globals.active).toBe(false);
  });

  it('keeps slots isolated by project and rejects unsupported revisions or corrupted data', () => {
    const records = new Map<string, string>();
    const storage = { getItem: (key: string) => records.get(key) ?? null, setItem: (key: string, value: string) => { records.set(key, value); } };
    const config = { key: 'ac9ade3d-0a23-4c5b-8f51-3814b2f4e3c3', revision: 1 };
    const checkpoint = { main: 'level-2', added: ['hud'], values: { score: 50 } };
    expect(writeGameSlot(storage, config, 2, checkpoint)).toBe(true);
    expect(readGameSlot(storage, config, 1)).toEqual({ status: 'empty' });
    expect(readGameSlot(storage, { ...config, key: '3b823a29-e7d4-48ea-90a7-592a928c4dac' }, 2)).toEqual({ status: 'empty' });
    expect(readGameSlot(storage, { ...config, revision: 2 }, 2)).toEqual({ status: 'revision' });
    expect(readGameSlot(storage, config, 2)).toMatchObject({ status: 'ok', data: checkpoint });
    const [key] = records.keys();
    records.set(key, '{invalid');
    expect(readGameSlot(storage, config, 2)).toEqual({ status: 'invalid' });
  });
});
