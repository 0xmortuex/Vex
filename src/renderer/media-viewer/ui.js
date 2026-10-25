// The player's menus, panels and toasts. One menu or panel is open at a time, above the button that opened it.

import { h, iconHtml } from './util.js';
import { t } from './strings.js';

let open = null;     // { el, anchor, onClose }

const poproot = () => document.getElementById('mv-pop');

export const isOpen = () => !!open;
export const openAnchor = () => (open ? open.anchor : null);

export function closePop(restoreFocus = true) {
  if (!open) return;
  const { el, anchor, onClose } = open;
  open = null;
  el.remove();
  document.removeEventListener('pointerdown', outside, true);
  if (anchor) { anchor.setAttribute('aria-expanded', 'false'); if (restoreFocus && anchor.isConnected) anchor.focus({ preventScroll: true }); }
  if (onClose) onClose();
}

function outside(event) {
  if (!open) return;
  if (open.el.contains(event.target)) return;
  // A press on the button that opened it is its own toggle (the button closes it).
  if (open.anchor && open.anchor.contains(event.target)) return;
  closePop(false);
}

function place(el, anchor) {
  const stage = document.getElementById('mv-stage').getBoundingClientRect();
  el.style.visibility = 'hidden';
  poproot().appendChild(el);
  const box = el.getBoundingClientRect();
  const a = anchor ? anchor.getBoundingClientRect() : { left: stage.right - 20, right: stage.right - 20, top: stage.bottom - 90 };
  let left = a.right - stage.left - box.width;
  left = Math.max(8, Math.min(left, stage.width - box.width - 8));
  el.style.left = left + 'px';
  el.style.bottom = Math.max(8, stage.bottom - a.top + 8) + 'px';
  el.style.visibility = '';
}

function show(el, anchor, onClose) {
  closePop(false);
  place(el, anchor);
  open = { el, anchor, onClose };
  if (anchor) anchor.setAttribute('aria-expanded', 'true');
  document.addEventListener('pointerdown', outside, true);
  el.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closePop(true); }
    else if (event.key === 'Tab') closePop(false);
  });
}

// items: [{ label, hint, checked, role: 'menuitem' | 'menuitemradio' | 'menuitemcheckbox', icon, onSelect, keepOpen } | { separator: true } | { heading }]
export function openMenu(anchor, { title, items, label }) {
  const menu = h('div', { class: 'mv-pop', role: 'menu', 'aria-label': label || title || t('Menu') });
  if (title) menu.append(h('div', { class: 'mv-pop-title', text: title }));
  const buttons = [];
  for (const item of items) {
    if (item.separator) { menu.append(h('div', { class: 'mv-sep', role: 'separator' })); continue; }
    if (item.heading) { menu.append(h('div', { class: 'mv-pop-title', text: item.heading })); continue; }
    const role = item.role || 'menuitem';
    const button = h('button', { class: 'mv-item', type: 'button', role, tabindex: '-1' });
    if (role !== 'menuitem') button.setAttribute('aria-checked', item.checked ? 'true' : 'false');
    if (role === 'menuitemradio' || role === 'menuitemcheckbox') {
      const check = h('span', { class: 'mv-item-check', 'aria-hidden': 'true' });
      if (item.checked) check.innerHTML = iconHtml('check', 16);
      button.append(check);
    } else if (item.icon) {
      const icon = h('span', { class: 'mv-item-icon', 'aria-hidden': 'true' });
      icon.innerHTML = iconHtml(item.icon, 16);
      button.append(icon);
    }
    button.append(h('span', { class: 'mv-item-label', text: item.label }));
    if (item.hint) button.append(h('span', { class: 'mv-item-hint', text: item.hint }));
    if (item.disabled) button.disabled = true;
    button.addEventListener('click', () => {
      if (!item.keepOpen) closePop(true);
      if (item.onSelect) item.onSelect();
    });
    buttons.push(button);
    menu.append(button);
  }
  menu.addEventListener('keydown', (event) => {
    const list = buttons.filter((b) => !b.disabled);
    const at = list.indexOf(document.activeElement);
    let next = null;
    if (event.key === 'ArrowDown') next = list[(at + 1) % list.length];
    else if (event.key === 'ArrowUp') next = list[(at - 1 + list.length) % list.length];
    else if (event.key === 'Home') next = list[0];
    else if (event.key === 'End') next = list[list.length - 1];
    if (next) { event.preventDefault(); event.stopPropagation(); next.focus(); }
  });
  show(menu, anchor);
  const first = buttons.find((b) => b.getAttribute('aria-checked') === 'true') || buttons.find((b) => !b.disabled);
  if (first) first.focus({ preventScroll: true });
  return menu;
}

// A panel with its own controls (the subtitle settings). `node` is the content; focus goes to its first control.
export function openPanel(anchor, node, { label, onClose } = {}) {
  const panel = h('div', { class: 'mv-pop mv-panel', role: 'dialog', 'aria-label': label || '' }, node);
  show(panel, anchor, onClose);
  const first = panel.querySelector('button, input, select, [tabindex]');
  if (first) first.focus({ preventScroll: true });
  return panel;
}

// A short message that goes by itself. `action` is { label, run }.
export function toast(text, { action, ms = 3200 } = {}) {
  const host = document.getElementById('mv-toast');
  const box = h('div', {}, h('span', { text }));
  let timer = 0;
  const gone = () => { clearTimeout(timer); box.remove(); };
  if (action) box.append(h('button', { class: 'mv-btn mv-btn-pill mv-btn-sm', type: 'button', text: action.label, onclick: () => { gone(); action.run(); } }));
  host.append(box);
  while (host.children.length > 3) host.firstChild.remove();
  timer = setTimeout(gone, ms);
  return gone;
}
