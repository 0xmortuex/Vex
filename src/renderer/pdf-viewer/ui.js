// Small pieces of interface: elements, icons, a menu, a dialog, a toast. Nothing here knows about PDFs.

import { t } from './strings.js';

export const $ = (selector, root) => (root || document).querySelector(selector);
export const $$ = (selector, root) => [...(root || document).querySelectorAll(selector)];

export function icon(name, size) {
  if (typeof VexIcons === 'undefined') throw new Error('The icon set did not load');
  return VexIcons.svg(name, { size: size || 18 });
}

// el('button', { class: 'pv-btn', onclick: fn, 'aria-label': 'x' }, child, 'text')
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

// ---- menus --------------------------------------------------------------
// items: [{ id, label, icon?, keys?, checked?, role? ('menuitem' | 'menuitemradio' | 'menuitemcheckbox'), disabled?, run }]
//        | { type: 'sep' } | { type: 'label', text } | { type: 'node', node }
let openMenuState = null;
export function closeMenu(returnFocus = true) {
  if (!openMenuState) return;
  const { root, anchor, off } = openMenuState;
  openMenuState = null;
  off();
  root.remove();
  if (anchor) { anchor.setAttribute('aria-expanded', 'false'); if (returnFocus && document.contains(anchor)) anchor.focus(); }
}
export function menuIsOpen() { return !!openMenuState; }

export function openMenu({ anchor, items, label, at }) {
  closeMenu(false);
  const root = el('div', { class: 'pv-menu', role: 'menu', 'aria-label': label || '' });
  const buttons = [];
  for (const item of items) {
    if (item.type === 'sep') { root.append(el('div', { class: 'pv-menu-sep', role: 'separator' })); continue; }
    if (item.type === 'label') { root.append(el('div', { class: 'pv-menu-label', role: 'presentation', text: item.text })); continue; }
    if (item.type === 'node') { root.append(item.node); continue; }
    const role = item.role || 'menuitem';
    const check = el('span', { class: 'pv-mi-check', 'aria-hidden': 'true' });
    if (item.checked) check.innerHTML = icon('check', 15);
    const button = el('button', {
      class: 'pv-menu-item', type: 'button', role, tabindex: '-1', disabled: item.disabled ? true : null,
      'aria-checked': role === 'menuitem' ? null : String(!!item.checked),
    },
    role === 'menuitem' && item.icon ? el('span', { class: 'pv-mi-ico', html: null, 'aria-hidden': 'true' }) : (role !== 'menuitem' ? check : null),
    el('span', { class: 'pv-mi-label', text: item.label }),
    item.keys ? el('span', { class: 'pv-mi-keys', text: item.keys }) : null);
    if (role === 'menuitem' && item.icon) button.querySelector('.pv-mi-ico').innerHTML = icon(item.icon, 16);
    button.addEventListener('click', () => { closeMenu(false); Promise.resolve().then(() => item.run && item.run()); });
    root.append(button);
    if (!item.disabled) buttons.push(button);
  }
  document.getElementById('pv-menu-root').append(root);
  if (anchor) anchor.setAttribute('aria-expanded', 'true');
  // Where it goes: under the button, kept inside the window.
  const place = () => {
    const rect = anchor ? anchor.getBoundingClientRect() : { left: at.x, right: at.x, bottom: at.y, top: at.y };
    const w = root.offsetWidth, h = root.offsetHeight;
    let left = Math.min(Math.max(8, rect.right - w), window.innerWidth - w - 8);
    if (rect.left + w < window.innerWidth - 8) left = Math.max(8, rect.left);
    let top = rect.bottom + 4;
    if (top + h > window.innerHeight - 8) top = Math.max(8, rect.top - h - 4);
    root.style.left = left + 'px';
    root.style.top = top + 'px';
  };
  place();
  const onKey = (event) => {
    const i = buttons.indexOf(document.activeElement);
    if (event.key === 'ArrowDown') { event.preventDefault(); buttons[(i + 1) % buttons.length]?.focus(); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); buttons[(i - 1 + buttons.length) % buttons.length]?.focus(); }
    else if (event.key === 'Home') { event.preventDefault(); buttons[0]?.focus(); }
    else if (event.key === 'End') { event.preventDefault(); buttons[buttons.length - 1]?.focus(); }
    else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeMenu(true); }
    else if (event.key === 'Tab') { closeMenu(false); }
  };
  const onDown = (event) => { if (!root.contains(event.target) && !(anchor && anchor.contains(event.target))) closeMenu(false); };
  const onBlur = () => closeMenu(false);
  root.addEventListener('keydown', onKey);
  document.addEventListener('pointerdown', onDown, true);
  window.addEventListener('blur', onBlur);
  window.addEventListener('resize', onBlur);
  openMenuState = { root, anchor, off: () => { document.removeEventListener('pointerdown', onDown, true); window.removeEventListener('blur', onBlur); window.removeEventListener('resize', onBlur); } };
  const first = buttons.find((b) => b.getAttribute('aria-checked') === 'true') || buttons[0];
  (first || root).focus?.();
  return root;
}

// ---- dialogs ------------------------------------------------------------
// -> { root, close(), body }. `actions`: [{ label, primary?, danger?, run(close) }]. Esc closes (and calls onCancel) unless modal.
export function openDialog({ title, lead, body, actions, onCancel, label, backdropCancels = true }) {
  const back = el('div', { class: 'pv-dialog-back' });
  const heading = el('h2', { id: 'pv-dlg-title', text: title });
  const bodyBox = el('div', { class: 'pv-dialog-body' }, lead ? el('p', { text: lead }) : null, body);
  const bar = el('div', { class: 'pv-dialog-actions' });
  const box = el('div', { class: 'pv-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'pv-dlg-title', 'aria-label': label || null }, heading, bodyBox, bar);
  back.append(box);
  const previous = document.activeElement;
  const close = (restore = true) => {
    document.removeEventListener('keydown', onKey, true);
    back.remove();
    if (restore && previous && document.contains(previous)) previous.focus();
  };
  const cancel = () => { close(); if (onCancel) onCancel(); };
  for (const action of actions || []) {
    const button = el('button', { class: 'pv-action' + (action.primary ? ' primary' : '') + (action.danger ? ' danger' : ''), type: 'button', text: action.label });
    button.addEventListener('click', () => action.run ? action.run(close, button) : close());
    bar.append(button);
  }
  function onKey(event) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel(); return; }
    if (event.key !== 'Tab') return;
    const nodes = [...box.querySelectorAll('button:not(:disabled), input:not(:disabled), select, textarea, [tabindex]:not([tabindex="-1"])')].filter((n) => n.offsetParent !== null);
    if (!nodes.length) return;
    const first = nodes[0], last = nodes[nodes.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
  document.addEventListener('keydown', onKey, true);
  back.addEventListener('pointerdown', (event) => { if (event.target === back && backdropCancels) cancel(); });
  document.getElementById('pv-dialog-root').append(back);
  const initial = box.querySelector('[data-autofocus]') || box.querySelector('input:not([type=hidden]), textarea, select') || bar.querySelector('.primary') || bar.querySelector('button');
  if (initial) initial.focus();
  return { root: box, close, body: bodyBox };
}

// ---- toasts -------------------------------------------------------------
export function toast(message, options) {
  const o = options || {};
  const box = el('div', { class: 'pv-toast', 'data-kind': o.kind || 'info' }, el('span', { text: message }));
  if (o.action) {
    const button = el('button', { type: 'button', text: o.action.label });
    button.addEventListener('click', () => { box.remove(); o.action.run(); });
    box.append(button);
  }
  const host = document.getElementById('pv-toasts');
  host.append(box);
  while (host.children.length > 3) host.firstChild.remove();
  setTimeout(() => box.remove(), o.ms || (o.kind === 'error' ? 9000 : 4800));
  return box;
}

export function formatBytes(n) {
  if (!Number.isFinite(n)) return '';
  if (n >= 1048576) return (n / 1048576).toFixed(n >= 10485760 ? 0 : 1) + ' MB';
  return Math.max(1, Math.round(n / 1024)) + ' KB';
}

export { t };
