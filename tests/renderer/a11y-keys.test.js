// @vitest-environment jsdom
//
// The tab strip by keyboard (js/a11y-keys.js): a tablist with one tab stop,
// arrows move, Enter switches, Delete closes; Escape closes the panel you are in.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let VexA11yKeys;
const rects = Element.prototype.getClientRects;
beforeEach(async () => {
  // jsdom has no layout; every element is "on screen" here.
  Element.prototype.getClientRects = function () { return [{}]; };
  if (!globalThis.CSS) globalThis.CSS = {};
  if (!CSS.escape) CSS.escape = (s) => String(s).replace(/["\\]/g, '\\$&');
  document.body.innerHTML = `
    <div id="top-tabs-list">
      <div class="top-tab" data-tab-id="a"><img class="tab-favicon" src="x.ico"><span class="tab-title">Alpha</span><span class="tab-close"></span></div>
      <div class="top-tab active" data-tab-id="b"><span class="tab-title">Beta</span><button class="x">x</button></div>
      <div class="top-group-label">Work</div>
      <div class="top-tab in-group sleeping" data-tab-id="c"><span class="tab-title">Gamma</span></div>
    </div>
    <div id="panels-container"><div id="panel-settings"><input id="inside"></div></div>
    <button class="sidebar-icon" data-panel="settings">S</button>`;
  delete document.body.querySelector('#top-tabs-list').dataset.a11yWired;
  vi.resetModules();
  ({ VexA11yKeys } = await import('../../src/renderer/js/a11y-keys.js?' + Math.random()));
});
afterEach(() => { Element.prototype.getClientRects = rects; delete globalThis.TabManager; delete globalThis.SidebarManager; });

const list = () => document.getElementById('top-tabs-list');
const press = (el, key, extra = {}) => el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra }));

describe('the tab strip as a tablist', () => {
  it('names every tab, marks the selected one, and leaves exactly one tab stop', () => {
    const l = list();
    expect(l.getAttribute('role')).toBe('tablist');
    const tabs = [...l.querySelectorAll('.top-tab, .top-group-label')];
    expect(tabs.every(t => t.getAttribute('role') === 'tab')).toBe(true);
    expect(tabs.filter(t => t.tabIndex === 0).map(t => t.dataset.tabId)).toEqual(['b']);
    expect(l.querySelector('[data-tab-id=b]').getAttribute('aria-selected')).toBe('true');
    expect(l.querySelector('[data-tab-id=a]').getAttribute('aria-selected')).toBe('false');
    expect(l.querySelector('[data-tab-id=c]').getAttribute('aria-label')).toBe('Gamma (sleeping)');
    expect(l.querySelector('.top-group-label').getAttribute('aria-expanded')).toBe('true');
    expect(l.querySelector('button.x').tabIndex).toBe(-1);
    expect(l.querySelector('img').getAttribute('alt')).toBe('');
  });

  it('moves with the arrows, Home and End, wrapping at the ends', () => {
    const b = list().querySelector('[data-tab-id=b]');
    b.focus();
    press(b, 'ArrowRight');
    expect(document.activeElement.classList.contains('top-group-label')).toBe(true);
    press(document.activeElement, 'End');
    expect(document.activeElement.dataset.tabId).toBe('c');
    press(document.activeElement, 'ArrowRight');
    expect(document.activeElement.dataset.tabId).toBe('a');
    press(document.activeElement, 'ArrowLeft');
    expect(document.activeElement.dataset.tabId).toBe('c');
    press(document.activeElement, 'Home');
    expect(document.activeElement.dataset.tabId).toBe('a');
    expect([...list().querySelectorAll('[role=tab]')].filter(t => t.tabIndex === 0)).toHaveLength(1);
  });

  it('switches on Enter, closes on Delete, and puts focus back after the strip is rebuilt', async () => {
    const a = list().querySelector('[data-tab-id=a]');
    const clicked = vi.fn();
    a.addEventListener('click', clicked);
    a.focus();
    press(a, 'Enter');
    expect(clicked).toHaveBeenCalledTimes(1);
    // The strip is rebuilt with "a" now active: focus follows it.
    list().innerHTML = '<div class="top-tab active" data-tab-id="a"><span class="tab-title">Alpha</span></div><div class="top-tab" data-tab-id="b"><span class="tab-title">Beta</span></div>';
    await Promise.resolve();
    expect(document.activeElement.dataset.tabId).toBe('a');

    globalThis.TabManager = { closeTab: vi.fn() };
    press(document.activeElement, 'Delete');
    expect(globalThis.TabManager.closeTab).toHaveBeenCalledWith('a');
  });
});

describe('Escape in a panel', () => {
  it('closes the panel and returns to its launcher', () => {
    globalThis.SidebarManager = { activePanel: 'settings', hideActivePanel: vi.fn(function () { this.activePanel = null; }) };
    VexA11yKeys.init();
    const input = document.getElementById('inside');
    input.focus();
    press(input, 'Escape');
    expect(globalThis.SidebarManager.hideActivePanel).toHaveBeenCalled();
    expect(document.activeElement.dataset.panel).toBe('settings');
  });

  it('leaves Escape to a box that has text in it', () => {
    globalThis.SidebarManager = { activePanel: 'settings', hideActivePanel: vi.fn() };
    VexA11yKeys.init();
    const input = document.getElementById('inside');
    input.value = 'query';
    input.focus();
    press(input, 'Escape');
    expect(globalThis.SidebarManager.hideActivePanel).not.toHaveBeenCalled();
  });
});
