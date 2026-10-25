// Small pieces of interface: elements, icons, a menu, a dialog, a toast. Nothing here knows about folders.

import { t } from './strings.js';

export const $ = (selector, root) => (root || document).querySelector(selector);
export const $$ = (selector, root) => [...(root || document).querySelectorAll(selector)];

export function icon(name, size) {
  if (typeof VexIcons === 'undefined') throw new Error('The icon set did not load');
  return VexIcons.svg(name, { size: size || 18 });
}

// el('button', { class: 'fv-btn', onclick: fn, 'aria-label': 'x' }, child, 'text')
export function el(tag, attrs, ...kids) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') throw new Error('el(): no raw html; build the nodes');
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
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
export function iconSpan(name, size, cls) {
  const s = el('span', { class: cls || 'fv-ico', 'aria-hidden': 'true' });
  s.innerHTML = icon(name, size);
  return s;
}

// ---- announcements for a screen reader, and toasts ----
export function announce(text) {
  const live = document.getElementById('fv-live');
  if (!live) return;
  live.textContent = '';
  setTimeout(() => { live.textContent = text; }, 30);
}
let toastTimer = null;
export function toast(text, kind) {
  const box = document.getElementById('fv-toast');
  if (!box) return;
  box.textContent = text;
  box.dataset.kind = kind || 'info';
  box.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { box.hidden = true; }, kind === 'error' ? 7000 : 3500);
}

// ---- menus --------------------------------------------------------------
// items: [{ label, icon?, keys?, checked?, role?, disabled?, danger?, run }] | { type: 'sep' } | { type: 'label', text }
let openMenuState = null;
export function closeMenu(returnFocus = true) {
  if (!openMenuState) return;
  const { root, anchor, off, restore } = openMenuState;
  openMenuState = null;
  off();
  root.remove();
  if (anchor) anchor.setAttribute('aria-expanded', 'false');
  const target = anchor || restore;
  if (returnFocus && target && document.contains(target)) target.focus();
}
export function menuIsOpen() { return !!openMenuState; }

export function openMenu({ anchor, items, label, at }) {
  const restore = document.activeElement;
  closeMenu(false);
  const root = el('div', { class: 'fv-menu', role: 'menu', 'aria-label': label || '' });
  const buttons = [];
  for (const item of items) {
    if (item.type === 'sep') { root.append(el('div', { class: 'fv-menu-sep', role: 'separator' })); continue; }
    if (item.type === 'label') { root.append(el('div', { class: 'fv-menu-label', role: 'presentation', text: item.text })); continue; }
    const role = item.role || 'menuitem';
    const lead = el('span', { class: 'fv-mi-lead', 'aria-hidden': 'true' });
    if (role !== 'menuitem') { if (item.checked) lead.innerHTML = icon('check', 15); }
    else if (item.icon) lead.innerHTML = icon(item.icon, 16);
    const button = el('button', {
      class: 'fv-menu-item' + (item.danger ? ' danger' : ''), type: 'button', role, tabindex: '-1', disabled: item.disabled ? true : null,
      'aria-checked': role === 'menuitem' ? null : String(!!item.checked),
    }, lead, el('span', { class: 'fv-mi-label', text: item.label }), item.keys ? el('span', { class: 'fv-mi-keys', text: item.keys }) : null);
    button.addEventListener('click', () => { closeMenu(false); Promise.resolve().then(() => item.run && item.run()); });
    root.append(button);
    if (!item.disabled) buttons.push(button);
  }
  document.getElementById('fv-menu-root').append(root);
  if (anchor) anchor.setAttribute('aria-expanded', 'true');
  const place = () => {
    const rect = anchor ? anchor.getBoundingClientRect() : { left: at.x, right: at.x, bottom: at.y, top: at.y };
    const w = root.offsetWidth, h = root.offsetHeight;
    let left = anchor ? Math.min(rect.left, window.innerWidth - w - 8) : Math.min(rect.left, window.innerWidth - w - 8);
    left = Math.max(8, left);
    let top = rect.bottom + (anchor ? 4 : 0);
    if (top + h > window.innerHeight - 8) top = Math.max(8, (anchor ? rect.top - 4 : rect.top) - h);
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
    else if (event.key === 'Tab') { event.preventDefault(); closeMenu(true); }
  };
  const onDown = (event) => { if (!root.contains(event.target) && !(anchor && anchor.contains(event.target))) closeMenu(false); };
  const onBlur = () => closeMenu(false);
  root.addEventListener('keydown', onKey);
  document.addEventListener('pointerdown', onDown, true);
  window.addEventListener('blur', onBlur);
  window.addEventListener('resize', onBlur);
  openMenuState = { root, anchor, restore, off: () => { document.removeEventListener('pointerdown', onDown, true); window.removeEventListener('blur', onBlur); window.removeEventListener('resize', onBlur); } };
  const first = buttons.find((b) => b.getAttribute('aria-checked') === 'true') || buttons[0];
  (first || root).focus?.();
  return root;
}

// ---- dialogs ------------------------------------------------------------
// -> { root, close() }. `actions`: [{ label, primary?, danger?, run(close) }]. Esc closes (and calls onCancel). `focus`: the label of the action focused first.
let dialogState = null;
export function dialogIsOpen() { return !!dialogState; }
export function openDialog({ title, lead, body, actions, onCancel, role, focus }) {
  if (dialogState) dialogState.close(false);
  const restore = document.activeElement;
  const back = el('div', { class: 'fv-dialog-back' });
  const heading = el('h2', { id: 'fv-dlg-title', text: title });
  const bodyBox = el('div', { class: 'fv-dialog-body', id: 'fv-dlg-body' }, lead ? el('p', { text: lead }) : null, body);
  const bar = el('div', { class: 'fv-dialog-actions' });
  const box = el('div', { class: 'fv-dialog', role: role || 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'fv-dlg-title', 'aria-describedby': 'fv-dlg-body' }, heading, bodyBox, bar);
  back.append(box);
  let done = false;
  const close = (restoreFocus = true) => {
    if (done) return;
    done = true;
    dialogState = null;
    document.removeEventListener('keydown', onKey, true);
    back.remove();
    const app = document.getElementById('fv-app');
    if (app) app.inert = false;
    if (restoreFocus && restore && document.contains(restore)) restore.focus();
  };
  const buttons = [];
  for (const a of actions) {
    const b = el('button', { class: 'fv-btn-text' + (a.primary ? ' primary' : '') + (a.danger ? ' danger' : ''), type: 'button', text: a.label });
    b.addEventListener('click', () => { if (a.run) a.run(close); else close(); });
    bar.append(b);
    buttons.push(b);
  }
  const onKey = (event) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); if (onCancel) onCancel(); return; }
    if (event.key === 'Tab') {
      const tabbable = [...box.querySelectorAll('button, input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((n) => !n.disabled);
      if (!tabbable.length) return;
      const first = tabbable[0], last = tabbable[tabbable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  };
  document.addEventListener('keydown', onKey, true);
  back.addEventListener('pointerdown', (event) => { if (event.target === back) { close(); if (onCancel) onCancel(); } });
  document.body.append(back);
  const app = document.getElementById('fv-app');
  if (app) app.inert = true;
  dialogState = { close };
  const wanted = focus ? buttons.find((b) => b.textContent === focus) : null;
  (wanted || buttons.find((b) => b.classList.contains('primary')) || buttons[0] || box).focus();
  return { root: box, close };
}

export function confirmDialog({ title, lead, body, ok, cancel, danger, focusCancel }) {
  return new Promise((resolve) => {
    openDialog({
      title, lead, body, role: danger ? 'alertdialog' : 'dialog',
      focus: focusCancel ? (cancel || t('Cancel')) : undefined,
      onCancel: () => resolve(false),
      actions: [
        { label: cancel || t('Cancel'), run: (close) => { close(); resolve(false); } },
        { label: ok, primary: !danger, danger: !!danger, run: (close) => { close(); resolve(true); } },
      ],
    });
  });
}
