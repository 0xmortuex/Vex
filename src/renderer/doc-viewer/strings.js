// The viewer's words, in English and Turkish. The English sentence is the key: t('Search') is the English text, and in Turkish it is
// TR['Search'] when the language is Turkish. A sentence with no Turkish entry would show in English, so tests/renderer/docViewer.test.js
// checks that every sentence given to t() or ctx.t(), and every data-i18n text of this folder, has one.
// A {name} in a sentence is filled from the second argument: t('{n} rows', { n: 3 }).

import { TR } from './strings-tr.js';

// The page is served with the window's language already in <html lang> (main/text-viewer.js servePage); the window may send it again.
let lang = typeof document !== 'undefined' && String(document.documentElement.lang || '').slice(0, 2).toLowerCase() === 'tr' ? 'tr' : 'en';

export function setLang(value) {
  const next = String(value || 'en').slice(0, 2).toLowerCase() === 'tr' ? 'tr' : 'en';
  const changed = next !== lang;
  lang = next;
  document.documentElement.lang = lang;
  return changed;
}
export function getLang() { return lang; }

export function t(english, args) {
  let text = lang === 'tr' && Object.prototype.hasOwnProperty.call(TR, english) ? TR[english] : english;
  if (args) text = text.replace(/\{(\w+)\}/g, (m, name) => (name in args ? String(args[name]) : m));
  return text;
}

// Numbers in the reader's own grouping (1.234.567 in Turkish).
export function num(n) { return Number(n).toLocaleString(lang === 'tr' ? 'tr-TR' : 'en-US'); }

export function bytes(n) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = Number(n), u = 0;
  while (v >= 1024 && u < units.length - 1) { v /= 1024; u++; }
  return (u === 0 ? String(v) : v.toLocaleString(lang === 'tr' ? 'tr-TR' : 'en-US', { maximumFractionDigits: v < 10 ? 1 : 0 })) + ' ' + units[u];
}

// The words written into the page itself (data-i18n = text, data-i18n-title, data-i18n-aria, data-i18n-placeholder).
export function applyStatic(root) {
  const scope = root || document;
  for (const node of scope.querySelectorAll('[data-i18n]')) node.textContent = t(node.dataset.i18n);
  for (const node of scope.querySelectorAll('[data-i18n-title]')) node.title = t(node.dataset.i18nTitle);
  for (const node of scope.querySelectorAll('[data-i18n-aria]')) node.setAttribute('aria-label', t(node.dataset.i18nAria));
  for (const node of scope.querySelectorAll('[data-i18n-placeholder]')) node.setAttribute('placeholder', t(node.dataset.i18nPlaceholder));
}
