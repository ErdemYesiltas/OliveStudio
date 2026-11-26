import en from './en.json' with { type: 'json' };

const catalogs = { en };
const defaultLocale = 'en';

export function resolveLocale(preferred) {
  for (const tag of preferred) {
    const normalized = tag.toLowerCase();
    if (Object.hasOwn(catalogs, normalized)) return normalized;
    const language = normalized.split('-')[0];
    if (Object.hasOwn(catalogs, language)) return language;
  }
  return defaultLocale;
}

export function localize(preferred) {
  const locale = resolveLocale(preferred);
  return {
    locale,
    t(key, variables = {}) {
      const message = catalogs[locale][key] ?? en[key] ?? key;
      return message.replace(/\{(\w+)\}/g, (placeholder, name) =>
        Object.hasOwn(variables, name) ? String(variables[name]) : placeholder,
      );
    },
  };
}
