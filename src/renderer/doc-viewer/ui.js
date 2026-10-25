// Small helpers shared by the views: elements, icons, the toast, a debounce, the preferences, the worker.

import { t } from './strings.js';

export function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? '' : String(v));
    }
  }
  for (const c of children) if (c != null) node.append(c);
  return node;
}

// An icon of the interface's own set (js/vex-icons.js, served as /icons.js). The markup is the icon's own, never page text.
export function icon(name, size = 16) {
  const holder = document.createElement('span');
  holder.className = 'dv-icon';
  holder.setAttribute('aria-hidden', 'true');
  if (typeof window.VexIcons === 'undefined') throw new Error(t('The icon set did not load'));
  holder.innerHTML = window.VexIcons.svg(name, { size });
  return holder;
}

// A button with an icon and/or a word. `label` is the English sentence (it is the tooltip and the accessible name too).
export function button({ icon: name, label, text, onClick, pressed, cls, disabled, id }) {
  const b = el('button', { type: 'button', class: 'dv-btn' + (text ? ' dv-btn-text' : '') + (cls ? ' ' + cls : ''), title: t(label), 'aria-label': t(label), id });
  if (name) b.append(icon(name));
  if (text) b.append(el('span', { class: 'dv-btn-label', text: t(text) }));
  if (pressed !== undefined) b.setAttribute('aria-pressed', pressed ? 'true' : 'false');
  if (disabled) b.disabled = true;
  if (onClick) b.addEventListener('click', onClick);
  return b;
}

export function setPressed(b, on) { b.setAttribute('aria-pressed', on ? 'true' : 'false'); }

export function select({ label, options, value, onChange, id }) {
  const wrap = el('label', { class: 'dv-select' });
  wrap.append(el('span', { class: 'dv-select-label', text: t(label) }));
  const s = el('select', { class: 'dv-select-input', id, 'aria-label': t(label) });
  for (const [v, text] of options) s.append(el('option', { value: v, text: t(text) }));
  s.value = value;
  s.addEventListener('change', () => onChange(s.value));
  wrap.append(s);
  wrap.select = s;
  return wrap;
}

// A switch-like checkbox with a word.
export function toggle({ label, checked, onChange, title }) {
  const wrap = el('label', { class: 'dv-toggle', title: title ? t(title) : undefined });
  const box = el('input', { type: 'checkbox', class: 'dv-toggle-input' });
  box.checked = !!checked;
  box.addEventListener('change', () => onChange(box.checked));
  wrap.append(box, el('span', { class: 'dv-toggle-label', text: t(label) }));
  wrap.input = box;
  return wrap;
}

export function debounce(fn, ms) {
  let id = 0;
  const run = (...args) => { clearTimeout(id); id = setTimeout(() => fn(...args), ms); };
  run.cancel = () => clearTimeout(id);
  return run;
}

let toastTimer = 0;
export function toast(message, kind) {
  const host = document.getElementById('dv-toast');
  host.textContent = message;
  host.dataset.kind = kind || 'info';
  host.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { host.hidden = true; }, kind === 'error' ? 7000 : 3200);
}

// What the person turned on and off, per kind of document. Kept in this page's own storage; in a private or Tor tab (the page
// says so with <meta name="vex-persist" content="0">) it lasts only as long as the page.
const PERSIST = (document.querySelector('meta[name="vex-persist"]') || {}).content === '1';
const KEY = 'dv.prefs';
let memory = {};
try { if (PERSIST) memory = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (err) { console.error('[Document viewer] its saved settings could not be read:', err.message); memory = {}; }

export const prefs = {
  get(kind, name, fallback) {
    const group = memory[kind];
    return group && Object.prototype.hasOwnProperty.call(group, name) ? group[name] : fallback;
  },
  set(kind, name, value) {
    (memory[kind] = memory[kind] || {})[name] = value;
    if (!PERSIST) return;
    try { localStorage.setItem(KEY, JSON.stringify(memory)); } catch (err) { console.error('[Document viewer] a setting could not be saved:', err.message); }
  },
};

// A page cannot make an element taller than about 33 million pixels, so a list of millions of rows cannot simply be as tall as its rows.
// Past MAX_PX the scrollbar covers the list at a smaller scale (a pixel of scroll is several pixels of rows) and the rows on screen are
// placed by where the scroll is, not by their own index. Below it, scale is 1 and nothing changes.
export const MAX_PX = 16000000;
export function scaler(total, rowH, viewH) {
  const full = total * rowH;
  const height = Math.min(full, MAX_PX);
  const scale = full <= MAX_PX || height <= viewH ? 1 : (full - viewH) / (height - viewH);
  return {
    height, scale, full,
    // the pixel of the list that is at the top of the screen
    virtualTop: (scrollTop) => scrollTop * scale,
    // where to put row i, in the scrolled element's own coordinates
    topFor: (i, scrollTop) => (scale === 1 ? i * rowH : scrollTop + i * rowH - scrollTop * scale),
    // the scroll position that puts row i at the top of the screen
    scrollFor: (i) => (i * rowH) / scale,
  };
}

// An error in the reader's language: the worker names its sentences (tpl) so they can be translated.
export function errText(err) { return err && err.tpl ? t(err.tpl, err.args) : String(err && err.message ? err.message : err); }

// A question to the worker, answered later.
export class DocWorker {
  constructor(url) {
    this.worker = new Worker(url);
    this.seq = 0;
    this.pending = new Map();
    this.worker.onmessage = (e) => {
      const m = e.data;
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      if (m.ok) p.resolve(m);
      else { const err = new Error(m.error); err.tpl = m.tpl; err.args = m.args; err.parse = m.parse; err.line = m.line; err.col = m.col; err.offset = m.offset; p.reject(err); }
    };
    this.worker.onerror = (e) => {
      const err = new Error(t('The document worker stopped') + ': ' + (e.message || ''));
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
    };
  }
  call(type, msg, transfer) {
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ type, id, ...(msg || {}) }, transfer || []);
    });
  }
  stop() { this.worker.terminate(); this.pending.clear(); }
}

// Highlights `query` in `text` by wrapping each hit in <mark>. Returns a DocumentFragment (text only, never markup).
export function marked(text, query, cs) {
  const frag = document.createDocumentFragment();
  if (!query) { frag.append(text); return frag; }
  const hay = cs ? text : text.toLowerCase();
  const needle = cs ? query : query.toLowerCase();
  let from = 0;
  for (;;) {
    const at = hay.indexOf(needle, from);
    if (at === -1) break;
    if (at > from) frag.append(text.slice(from, at));
    frag.append(el('mark', { class: 'dv-hit', text: text.slice(at, at + needle.length) }));
    from = at + needle.length;
  }
  if (from < text.length) frag.append(text.slice(from));
  return frag;
}
