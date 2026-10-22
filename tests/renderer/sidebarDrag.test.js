// @vitest-environment jsdom
// Dragging a sidebar button with the mouse puts it in a new place and keeps the order (the one Settings › Sidebar edits).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SidebarManager } from '../../src/renderer/js/sidebar.js';

const PANELS = ['start', 'notes', 'history', 'clock'];

function build() {
  document.body.innerHTML = '<div id="icon-sidebar">' + PANELS.map(p => `<button class="sidebar-icon" data-panel="${p}"></button>`).join('') + '<div class="sidebar-spacer"></div></div>';
  // 40px tall buttons stacked down the rail
  [...document.querySelectorAll('.sidebar-icon')].forEach((b, i) => {
    b.getBoundingClientRect = () => ({ top: i * 40, left: 0, width: 40, height: 40, right: 40, bottom: i * 40 + 40 });
  });
  SidebarManager.renderSidebarManager = vi.fn();
}
const order = () => [...document.querySelectorAll('#icon-sidebar .sidebar-icon')].map(b => b.dataset.panel);
const fire = (el, type, init) => el.dispatchEvent(Object.assign(new Event(type, { bubbles: true, cancelable: true }), { pointerId: 1, button: 0, ...init }));

beforeEach(() => { localStorage.clear(); build(); });

describe('SidebarManager.dropButton', () => {
  it('puts a button before another, or after it, and saves the order', () => {
    expect(SidebarManager.dropButton('clock', 'notes', false)).toBe(true);
    expect(order()).toEqual(['start', 'clock', 'notes', 'history']);
    expect(JSON.parse(localStorage.getItem('vex.sidebarOrder'))).toEqual(['start', 'clock', 'notes', 'history']);
    SidebarManager.dropButton('start', 'history', true);
    expect(order()).toEqual(['clock', 'notes', 'history', 'start']);
  });
  it('does nothing for itself or an unknown panel', () => {
    expect(SidebarManager.dropButton('notes', 'notes', false)).toBe(false);
    expect(SidebarManager.dropButton('notes', 'nope', false)).toBe(false);
    expect(order()).toEqual(PANELS);
  });
});

describe('dragging a sidebar button', () => {
  beforeEach(() => { document.getElementById('icon-sidebar').dataset.dragWired = ''; delete document.getElementById('icon-sidebar').dataset.dragWired; SidebarManager._wireButtonDrag(); });
  const btn = (p) => document.querySelector(`.sidebar-icon[data-panel="${p}"]`);
  const bar = () => document.getElementById('icon-sidebar');

  it('moves the button to where it is let go', () => {
    fire(btn('clock'), 'pointerdown', { clientX: 20, clientY: 140 });
    fire(bar(), 'pointermove', { clientX: 20, clientY: 50 });          // past the middle of "notes" (40..80) => before it? 50 < 60
    expect(btn('notes').classList.contains('sb-drop-before')).toBe(true);
    expect(btn('clock').classList.contains('sb-dragging')).toBe(true);
    fire(bar(), 'pointerup', { clientX: 20, clientY: 50 });
    expect(order()).toEqual(['start', 'clock', 'notes', 'history']);
    expect(document.querySelector('.sb-dragging, .sb-drop-before, .sb-drop-after')).toBeNull();
  });

  it('lands after the last button when let go below them all', () => {
    fire(btn('start'), 'pointerdown', { clientX: 20, clientY: 20 });
    fire(bar(), 'pointermove', { clientX: 20, clientY: 400 });
    fire(bar(), 'pointerup', { clientX: 20, clientY: 400 });
    expect(order()).toEqual(['notes', 'history', 'clock', 'start']);
  });

  it('is only a click when the pointer barely moves', () => {
    fire(btn('notes'), 'pointerdown', { clientX: 20, clientY: 60 });
    fire(bar(), 'pointermove', { clientX: 22, clientY: 62 });
    fire(bar(), 'pointerup', { clientX: 22, clientY: 62 });
    expect(order()).toEqual(PANELS);
    expect(document.querySelector('.sb-dragging')).toBeNull();
  });

  it('puts everything back on Escape', () => {
    fire(btn('clock'), 'pointerdown', { clientX: 20, clientY: 140 });
    fire(bar(), 'pointermove', { clientX: 20, clientY: 10 });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(order()).toEqual(PANELS);
    expect(document.querySelector('.sb-dragging, .sb-drop-before')).toBeNull();
  });

  it('swallows the click that ends a drag so the panel does not open', () => {
    const onClick = vi.fn();
    btn('clock').addEventListener('click', onClick);
    fire(btn('clock'), 'pointerdown', { clientX: 20, clientY: 140 });
    fire(bar(), 'pointermove', { clientX: 20, clientY: 10 });
    fire(bar(), 'pointerup', { clientX: 20, clientY: 10 });
    btn('clock').click();
    expect(onClick).not.toHaveBeenCalled();
  });
});
