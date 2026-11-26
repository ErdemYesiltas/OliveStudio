type EffectIdentity = { type: string; effectId?: string };

/** Older entries used the type as their key. Keep it for the first occurrence. */
export function effectEntries<T extends EffectIdentity>(effects: readonly T[]) {
  const counts = new Map<string, number>();
  return effects.map(effect => {
    const occurrence = (counts.get(effect.type) ?? 0) + 1;
    counts.set(effect.type, occurrence);
    return { effect, key: effect.effectId ?? (occurrence === 1 ? effect.type : `${effect.type}:${occurrence}`), occurrence };
  });
}

export function uniqueEffectIds(effects: readonly EffectIdentity[]) {
  const keys = effectEntries(effects).map(entry => entry.key);
  return new Set(keys).size === keys.length;
}
