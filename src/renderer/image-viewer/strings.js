// English is the key; Turkish is looked up in strings-tr.js. A text with a {name} in it takes its values from the second argument.

import { TR } from './strings-tr.js';

let lang = (document.documentElement.getAttribute('lang') || 'en').slice(0, 2);

export function setLang(next) {
  const code = String(next || 'en').slice(0, 2);
  if (code === lang) return;
  lang = code;
  document.documentElement.setAttribute('lang', code);
  window.dispatchEvent(new CustomEvent('iv:lang'));
}
export const getLang = () => lang;

export function t(en, vars) {
  let s = lang === 'tr' && Object.prototype.hasOwnProperty.call(TR, en) ? TR[en] : en;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return s;
}

// The page's own words: [data-i18n] (text), [data-i18n-title], [data-i18n-aria], [data-i18n-placeholder]. The English is kept on the element.
export function applyStatic(root) {
  const scope = root || document;
  for (const n of scope.querySelectorAll('[data-i18n]')) { if (!n.dataset.en) n.dataset.en = n.dataset.i18n; n.textContent = t(n.dataset.en); }
  for (const n of scope.querySelectorAll('[data-i18n-title]')) { n.title = t(n.dataset.i18nTitle); }
  for (const n of scope.querySelectorAll('[data-i18n-aria]')) { n.setAttribute('aria-label', t(n.dataset.i18nAria)); }
  for (const n of scope.querySelectorAll('[data-i18n-placeholder]')) { n.setAttribute('placeholder', t(n.dataset.i18nPlaceholder)); }
}
