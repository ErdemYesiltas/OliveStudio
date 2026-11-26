import type en from './en.json';

export type MessageKey = keyof typeof en;
export function resolveLocale(preferred: readonly string[]): string;
export function localize(preferred: readonly string[]): {
  locale: string;
  t(key: MessageKey, variables?: Record<string, string | number>): string;
};
