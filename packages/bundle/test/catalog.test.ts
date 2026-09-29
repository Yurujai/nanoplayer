// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { BASE_LANGUAGE, strings } from '@nanoplayer/core';
// Lives here, not in `ui`: importing the bundle loads every catalogue it ships,
// the UI's and each included plugin's.
import '../src/index.js';

/** The variables a template expects: `'Behind: {time}'` → `['time']`. */
const variables = (template: string): string[] =>
  [...template.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();

const base = BASE_LANGUAGE;
const baseKeys = strings.keys(base).sort();
const translations = strings.languages.filter((l) => l !== base);

describe('catalogue · is loaded', () => {
  it('the base language has strings', () => {
    expect(baseKeys.length).toBeGreaterThan(0);
  });

  it('there is at least one translation to check', () => {
    // Otherwise every test below would pass vacuously.
    expect(translations.length).toBeGreaterThan(0);
  });
});

describe.each(translations)('catalogue · language "%s"', (lang) => {
  const keys = strings.keys(lang).sort();

  it('misses no key from the base language', () => {
    // A half translation silently falls back to the base: a player half in one language.
    const missing = baseKeys.filter((k) => !keys.includes(k));
    expect(missing, `missing in "${lang}": ${missing.join(', ')}`).toEqual([]);
  });

  it('has no key the base language lacks', () => {
    // Almost always a typo in the key, leaving the right string unused.
    const extra = keys.filter((k) => !baseKeys.includes(k));
    expect(extra, `extra in "${lang}": ${extra.join(', ')}`).toEqual([]);
  });

  it('has no empty string', () => {
    const t = strings.translator(lang);
    const empty = keys.filter((k) => t(k).trim() === '');
    expect(empty, `empty in "${lang}": ${empty.join(', ')}`).toEqual([]);
  });

  it('keeps the variables of every template', () => {
    // The truly silent failure: a translation that drops `{time}` still exists and is not empty.
    const tBase = strings.translator(base);
    const t = strings.translator(lang);
    const broken = baseKeys
      .map((k) => ({ k, base: variables(tBase(k)), translated: variables(t(k)) }))
      .filter((x) => x.base.join(',') !== x.translated.join(','))
      .map((x) => `${x.k} (expects {${x.base.join('} {')}})`);
    expect(broken, `different variables in "${lang}": ${broken.join('; ')}`).toEqual([]);
  });
});
