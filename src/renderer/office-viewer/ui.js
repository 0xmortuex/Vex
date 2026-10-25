// Small pieces of interface: elements, icons, a menu, a dialog, a toast. Nothing here knows about documents.

import { t } from './strings.js';

export const $ = (selector, root) => (root || document).querySelector(selector);
export const $$ = (selector, root) => [...(root || document).querySelectorAll(selector)];

export function icon(name, size) {
  if (typeof VexIcons === 'undefined') throw new Error('The icon set did not load');
  return VexIcons.svg(name, { size: size || 18 });
}

// el('button', { class: 'od-btn', onclick: fn, 'aria-label': 'x' }, child, 'text')
export function el(tag, attrs, ...kids) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') throw new Error('el(): no raw html; build the nodes');
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else if (key === 'style' && typeof value === 'object') { for (const [name, v] of Object.entries(value)) { if (name.startsWith('--')) node.style.setProperty(name, v); else node.style[name] = v; } }
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) node.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return node;
}

// Puts the SVG of [data-icon] in place. An element with nothing in it holds the icon alone; one with a label gets the icon before it.
export function decorateIcons(root) {
  for (const node of $$('[data-icon]', root)) {
    if (node.dataset.iconDone) continue;
    node.dataset.iconDone = '1';
    const svg = icon(node.dataset.icon, Number(node.dataset.iconSize) || 18);
    if (!node.childNodes.length) node.innerHTML = svg;
    else node.insertAdjacentHTML('afterbegin', svg);
  }
}

// A button made in code: icon + optional label, a name for assistive tools and a tooltip.
export function button({ icon: name, label, title, aria, onclick, pressed, cls, id, menu, disabled }) {
  const b = el('button', { type: 'button', class: 'od-btn' + (label ? ' od-btn-text' : '') + (cls ? ' ' + cls : ''), id, title: title || label || '', 'aria-label': aria || label || title || '', onclick,
    'aria-pressed': pressed == null ? null : String(!!pressed), 'aria-haspopup': menu ? 'menu' : null, 'aria-expanded': menu ? 'false' : null, disabled: disabled ? true : null });
  if (name) b.insertAdjacentHTML('afterbegin', icon(name, 18));
  if (label) b.append(el('span', { class: 'od-btn-label', text: label }));
  if (menu) b.classList.add('od-btn-menu');
  return b;
}

// ---- menus --------------------------------------------------------------
// items: [{ label, icon?, keys?, checked?, role? ('menuitem' | 'menuitemradio' | 'menuitemcheckbox'), disabled?, run }]
//        | { type: 'sep' } | { type: 'label', text }
let openMenuState = null;
export function closeMenu(returnFocus = true) {
  if (!openMenuState) return;
  const { root, anchor, off } = openMenuState;
  openMenuState = null;
  off();
  root.remove();
  if (anchor) { anchor.setAttribute('aria-expanded', 'false'); if (returnFocus && document.contains(anchor)) anchor.focus(); }
}
export const menuIsOpen = () => !!openMenuState;

export function openMenu({ anchor, items, label, at }) {
  closeMenu(false);
  const root = el('div', { class: 'od-menu', role: 'menu', 'aria-label': label || '' });
  const buttons = [];
  for (const item of items) {
    if (item.type === 'sep') { root.append(el('div', { class: 'od-menu-sep', role: 'separator' })); continue; }
    if (item.type === 'label') { root.append(el('div', { class: 'od-menu-label', role: 'presentation', text: item.text })); continue; }
    const role = item.role || 'menuitem';
    const lead = el('span', { class: 'od-mi-lead', 'aria-hidden': 'true' });
    if (role === 'menuitem' && item.icon) lead.innerHTML = icon(item.icon, 16);
    else if (role !== 'menuitem' && item.checked) lead.innerHTML = icon('check', 15);
    const b = el('button', { class: 'od-menu-item', type: 'button', role, tabindex: '-1', disabled: item.disabled ? true : null, 'aria-checked': role === 'menuitem' ? null : String(!!item.checked) },
      lead, el('span', { class: 'od-mi-label', text: item.label }), item.keys ? el('span', { class: 'od-mi-keys', text: item.keys }) : null);
    b.addEventListener('click', () => { closeMenu(false); Promise.resolve().then(() => item.run && item.run()); });
    root.append(b);
    if (!item.disabled) buttons.push(b);
  }
  document.getElementById('od-menu-root').append(root);
  if (anchor) anchor.setAttribute('aria-expanded', 'true');
  const place = () => {
    const r = anchor ? anchor.getBoundingClientRect() : { left: at ? at.x : 0, bottom: at ? at.y : 0, right: at ? at.x : 0, top: at ? at.y : 0 };
    const w = root.offsetWidth, h = root.offsetHeight;
    let x = Math.min(r.left, innerWidth - w - 8);
    if (r.right - w > 8 && r.left + w > innerWidth - 8) x = r.right - w;
    let y = r.bottom + 4;
    if (y + h > innerHeight - 8) y = Math.max(8, r.top - h - 4);
    root.style.left = Math.max(8, x) + 'px';
    root.style.top = y + 'px';
  };
  place();
  const focusAt = (i) => { const b = buttons[(i + buttons.length) % buttons.length]; if (b) b.focus(); };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(); return; }
    if (e.key === 'Tab') { closeMenu(false); return; }
    const i = buttons.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); focusAt(i + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); focusAt(i < 0 ? -1 : i - 1); }
    else if (e.key === 'Home') { e.preventDefault(); focusAt(0); }
    else if (e.key === 'End') { e.preventDefault(); focusAt(-1); }
  };
  const onDown = (e) => { if (!root.contains(e.target) && !(anchor && anchor.contains(e.target))) closeMenu(false); };
  root.addEventListener('keydown', onKey);
  document.addEventListener('pointerdown', onDown, true);
  window.addEventListener('blur', () => closeMenu(false), { once: true });
  window.addEventListener('resize', place);
  openMenuState = { root, anchor, off: () => { document.removeEventListener('pointerdown', onDown, true); window.removeEventListener('resize', place); } };
  const checked = buttons.findIndex((b) => b.getAttribute('aria-checked') === 'true');
  focusAt(checked >= 0 ? checked : 0);
  return root;
}

// A button that opens a menu built when it is pressed.
export function menuButton(btn, build) {
  btn.addEventListener('click', () => { if (btn.getAttribute('aria-expanded') === 'true') closeMenu(); else openMenu({ anchor: btn, items: build(), label: btn.getAttribute('aria-label') }); });
  btn.addEventListener('keydown', (e) => { if (e.key === 'ArrowDown') { e.preventDefault(); openMenu({ anchor: btn, items: build(), label: btn.getAttribute('aria-label') }); } });
}

// ---- dialog ---------------------------------------------------------------
// Resolves to the id of the button pressed, or null on Escape. buttons: [{ id, label, primary? }]
export function dialog({ title, body, buttons }) {
  return new Promise((resolve) => {
    const prior = document.activeElement;
    const titleId = 'od-dlg-title-' + Math.random().toString(36).slice(2, 8);
    const box = el('div', { class: 'od-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
      el('h2', { id: titleId, class: 'od-dialog-title', text: title }),
      el('div', { class: 'od-dialog-body' }, body),
      el('div', { class: 'od-dialog-actions' }, buttons.map((b) => el('button', { type: 'button', class: 'od-dbtn' + (b.primary ? ' primary' : ''), 'data-id': b.id, text: b.label, onclick: () => done(b.id) }))));
    const scrim = el('div', { class: 'od-scrim' }, box);
    const done = (id) => { scrim.remove(); document.removeEventListener('keydown', onKey, true); if (prior && document.contains(prior)) prior.focus(); resolve(id); };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(null); }
      else if (e.key === 'Tab') {
        const f = [...box.querySelectorAll('button, input, select, textarea, [tabindex="0"]')].filter((x) => !x.disabled);
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey, true);
    document.getElementById('od-dialog-root').append(scrim);
    (box.querySelector('.od-dbtn.primary') || box.querySelector('.od-dbtn') || box).focus();
  });
}

// ---- toast ------------------------------------------------------------------
export function toast(message, kind) {
  const host = document.getElementById('od-toasts');
  if (!host) return;
  const node = el('div', { class: 'od-toast' + (kind === 'error' ? ' error' : ''), text: message });
  host.append(node);
  setTimeout(() => node.remove(), kind === 'error' ? 7000 : 3500);
}

// ---- clipboard ------------------------------------------------------------
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const area = el('textarea', { style: { position: 'fixed', opacity: '0', left: '-9999px' }, 'aria-hidden': 'true' });
    area.value = text;
    document.body.append(area);
    area.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    area.remove();
    return ok;
  }
}

export const formatBytes = (n) => (n >= 1048576 ? (n / 1048576).toFixed(n >= 10485760 ? 0 : 1) + ' MB' : n >= 1024 ? Math.round(n / 1024) + ' KB' : n + ' B');
export const debounce = (fn, ms) => { let timer = 0; const d = (...a) => { clearTimeout(timer); timer = setTimeout(() => fn(...a), ms); }; d.flush = () => { clearTimeout(timer); }; return d; };
export const raf = (fn) => requestAnimationFrame(fn);
export { t };
