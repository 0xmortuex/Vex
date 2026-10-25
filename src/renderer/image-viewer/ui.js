// Small pieces of interface for the viewer: elements, icons, a menu, a toast. Nothing here knows about pictures.

import { t } from './strings.js';

export const $ = (selector, root) => (root || document).querySelector(selector);
export const $$ = (selector, root) => [...(root || document).querySelectorAll(selector)];

export function icon(name, size) {
  if (typeof VexIcons === 'undefined') throw new Error('The icon set did not load');
  return VexIcons.svg(name, { size: size || 18 });
}

// el('button', { class: 'iv-btn', onclick: fn }, child, 'text')
export function el(tag, attrs, ...kids) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) node.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return node;
}

// Puts the SVG of [data-icon] in place; an element with a label already in it gets the icon before it.
export function decorateIcons(root) {
  for (const node of $$('[data-icon]', root)) {
    if (node.dataset.iconDone) continue;
    node.dataset.iconDone = '1';
    const svg = icon(node.dataset.icon, Number(node.dataset.iconSize) || 18);
    if (!node.childNodes.length) node.innerHTML = svg;
    else node.insertAdjacentHTML('afterbegin', svg);
  }
}

export function setIcon(node, name, size) { node.innerHTML = icon(name, size || 18); }

// ---- menu ---------------------------------------------------------------
// items: [{ label, icon?, keys?, checked?, role?, disabled?, run }] | { type: 'sep' }
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

export function openMenu({ anchor, items, label }) {
  closeMenu(false);
  const root = el('div', { class: 'iv-menu', role: 'menu', 'aria-label': label || '' });
  const buttons = [];
  for (const item of items) {
    if (item.type === 'sep') { root.append(el('div', { class: 'iv-menu-sep', role: 'separator' })); continue; }
    const role = item.role || 'menuitem';
    const lead = el('span', { class: 'iv-mi-ico', 'aria-hidden': 'true' });
    if (role === 'menuitem' && item.icon) lead.innerHTML = icon(item.icon, 16);
    else if (item.checked) lead.innerHTML = icon('check', 15);
    const button = el('button', {
      class: 'iv-menu-item', type: 'button', role, tabindex: '-1', disabled: item.disabled ? true : null,
      'aria-checked': role === 'menuitem' ? null : String(!!item.checked),
    }, lead, el('span', { class: 'iv-mi-label', text: item.label }), item.keys ? el('span', { class: 'iv-mi-keys', text: item.keys }) : null);
    button.addEventListener('click', () => { closeMenu(false); Promise.resolve().then(() => item.run && item.run()); });
    root.append(button);
    if (!item.disabled) buttons.push(button);
  }
  document.getElementById('iv-menu-root').append(root);
  if (anchor) anchor.setAttribute('aria-expanded', 'true');
  const rect = anchor.getBoundingClientRect();
  const w = root.offsetWidth, h = root.offsetHeight;
  root.style.left = Math.max(8, Math.min(rect.right - w, window.innerWidth - w - 8)) + 'px';
  root.style.top = (rect.bottom + 4 + h > window.innerHeight - 8 ? Math.max(8, rect.top - h - 4) : rect.bottom + 4) + 'px';
  const onKey = (event) => {
    const i = buttons.indexOf(document.activeElement);
    if (event.key === 'ArrowDown') { event.preventDefault(); buttons[(i + 1) % buttons.length]?.focus(); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); buttons[(i - 1 + buttons.length) % buttons.length]?.focus(); }
    else if (event.key === 'Home') { event.preventDefault(); buttons[0]?.focus(); }
    else if (event.key === 'End') { event.preventDefault(); buttons[buttons.length - 1]?.focus(); }
    else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeMenu(true); }
    else if (event.key === 'Tab') { event.preventDefault(); closeMenu(true); }
  };
  const onDown = (event) => { if (!root.contains(event.target) && !(anchor && anchor.contains(event.target))) closeMenu(false); };
  const onBlur = () => closeMenu(false);
  root.addEventListener('keydown', onKey);
  document.addEventListener('pointerdown', onDown, true);
  window.addEventListener('blur', onBlur);
  window.addEventListener('resize', onBlur);
  openMenuState = { root, anchor, off: () => { document.removeEventListener('pointerdown', onDown, true); window.removeEventListener('blur', onBlur); window.removeEventListener('resize', onBlur); } };
  (buttons.find((b) => b.getAttribute('aria-checked') === 'true') || buttons[0])?.focus();
  return root;
}

// ---- toasts ---------------------------------------------------------------
export function toast(message, options) {
  const o = options || {};
  const box = el('div', { class: 'iv-toast', 'data-kind': o.kind || 'info' }, el('span', { text: message }));
  if (o.action) {
    const button = el('button', { type: 'button', text: o.action.label });
    button.addEventListener('click', () => { box.remove(); o.action.run(); });
    box.append(button);
  }
  const host = document.getElementById('iv-toasts');
  host.append(box);
  while (host.children.length > 3) host.firstChild.remove();
  setTimeout(() => box.remove(), o.ms || (o.kind === 'error' ? 9000 : 4200));
  return box;
}

export function formatBytes(n) {
  if (!Number.isFinite(n)) return '';
  if (n >= 1048576) return (n / 1048576).toFixed(n >= 10485760 ? 0 : 1) + ' MB';
  if (n >= 1024) return Math.round(n / 1024) + ' KB';
  return n + ' B';
}

export { t };
