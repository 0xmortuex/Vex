// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest';
import '../../src/renderer/js/i18n.js';

beforeEach(() => localStorage.clear());

it('translates every key the English catalog defines', () => {
  const { strings } = window.VexI18n;
  // A key present in `en` but missing from `tr` silently serves English text to
  // someone who explicitly chose Turkish, with no error anywhere.
  const missing = Object.keys(strings.en).filter(key => !(key in strings.tr));
  expect(missing, 'untranslated keys: ' + missing.join(', ')).toEqual([]);
});

it('has no blank or untranslated-looking Turkish values', () => {
  const { strings } = window.VexI18n;
  const blank = Object.keys(strings.tr).filter(key => !String(strings.tr[key] || '').trim());
  expect(blank, 'blank Turkish values: ' + blank.join(', ')).toEqual([]);
  // Catch a key copied across without being translated. Single words can
  // legitimately match (proper nouns, symbols), so compare phrases only.
  const identical = Object.keys(strings.tr).filter(key => {
    const en = strings.en[key];
    return typeof en === 'string' && en.split(/\s+/).length > 2 && en === strings.tr[key];
  });
  expect(identical, 'copied without translating: ' + identical.join(', ')).toEqual([]);
});

it('reads the locale whether or not the storage shim JSON-quoted it', () => {
  const { t, locale } = window.VexI18n;
  localStorage.setItem('vex.lang', 'tr');
  expect(locale()).toBe('tr');
  expect(t('cancel')).toBe('İptal');
  localStorage.setItem('vex.lang', JSON.stringify('tr'));
  expect(locale()).toBe('tr');
  expect(t('cancel')).toBe('İptal');
});

it('falls back to English, then to the caller\'s text, then to the key', () => {
  const { t } = window.VexI18n;
  localStorage.setItem('vex.lang', 'tr');
  // 'welcome.sub' is deliberately Turkish-only; English callers pass their own text.
  localStorage.setItem('vex.lang', 'en');
  expect(t('cancel')).toBe('Cancel');
  expect(t('welcome.sub', 'Inline English copy')).toBe('Inline English copy');
  expect(t('no.such.key')).toBe('no.such.key');
});

it('defaults to English for an unknown or missing language', () => {
  const { t, locale } = window.VexI18n;
  expect(locale()).toBe('en');
  localStorage.setItem('vex.lang', 'de');
  expect(locale()).toBe('en');
  expect(t('ok')).toBe('OK');
});
