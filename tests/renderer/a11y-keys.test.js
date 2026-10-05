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
    <div id="tabs-sidebar">
      <div id="tabs-header"><button id="btn-new-tab">+</button></div>
      <div class="pinned-tabs-container"><div class="pinned-tab" data-tab-id="p" title="Mail"><img src="m.ico"></div></div>
      <div id="tab-groups-container">
        <div class="tab-group" data-group-id="g1">
          <div class="tab-group-header"><div class="tab-group-dot"></div><span class="tab-group-name">Work</span><span class="tab-group-count">1</span></div>
          <div class="tab-group-tabs"><div class="tab-item sleeping" data-tab-id="w"><div class="tab-info"><div class="tab-title">Docs</div></div><button class="tab-close"></button></div></div>
        </div>
      </div>
      <div id="tabs-list">
        <div class="tab-item active" data-tab-id="x"><div class="tab-info"><div class="tab-title">Home</div></div><span class="tab-audio" aria-label="Playing audio"></span><button class="tab-close"></button></div>
        <div class="tab-item private-tab" data-tab-id="y"><div class="tab-info"><div class="tab-title">Secret</div></div><button class="tab-close"></button></div>
      </div>
    </div>
    <div id="panels-container"><div id="panel-settings"><input id="inside"></div></div>
    <button class="sidebar-icon" data-panel="settings">S</button>`;
  delete document.body.querySelector('#top-tabs-list').dataset.a11yWired;
  delete document.body.querySelector('#tabs-sidebar').dataset.a11yWired;
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

// The tabs down the side (the vertical layout): pinned, a group, loose tabs.
describe('the side tabs as vertical tablists', () => {
  const side = () => document.getElementById('tabs-sidebar');
  const tab = (id) => side().querySelector(`[data-tab-id=${id}]`);
  const header = () => side().querySelector('.tab-group-header');
  const flush = () => new Promise(r => setTimeout(r, 0));

  it('is a vertical tablist per list, a labelled group per group, and names each tab with its states', () => {
    const loose = document.getElementById('tabs-list');
    expect(loose.getAttribute('role')).toBe('tablist');
    expect(loose.getAttribute('aria-orientation')).toBe('vertical');
    expect(side().querySelector('.pinned-tabs-container').getAttribute('aria-label')).toBe('Pinned tabs');
    const group = side().querySelector('.tab-group');
    expect(group.getAttribute('role')).toBe('group');
    expect(group.getAttribute('aria-label')).toBe('Group Work');
    expect(header().getAttribute('role')).toBe('button');
    expect(header().getAttribute('aria-expanded')).toBe('true');
    expect(header().getAttribute('aria-label')).toBe('Group Work, 1 tab');
    expect(group.querySelector('.tab-group-tabs').getAttribute('role')).toBe('tablist');

    expect(tab('p').getAttribute('aria-label')).toBe('Mail (pinned)');
    expect(tab('w').getAttribute('aria-label')).toBe('Docs (sleeping, in group Work)');
    expect(tab('x').getAttribute('aria-label')).toBe('Home (playing audio)');
    expect(tab('y').getAttribute('aria-label')).toBe('Secret (private)');
    expect(tab('x').getAttribute('aria-selected')).toBe('true');
    expect(tab('y').getAttribute('aria-selected')).toBe('false');
    // One tab stop for the whole side, on the selected tab; the crosses are off it.
    expect([...side().querySelectorAll('[tabindex="0"]')].map(e => e.dataset.tabId)).toEqual(['x']);
    expect([...side().querySelectorAll('.tab-close')].every(b => b.tabIndex === -1)).toBe(true);
    expect(tab('p').querySelector('img').getAttribute('alt')).toBe('');
  });

  it('reads the tab from TabManager when it has it (a pinned icon shows none of it)', async () => {
    globalThis.TabManager = { tabs: [{ id: 'p', title: 'Inbox', pinned: true, sleeping: true, muted: true, partition: 'tor-1' }] };
    VexA11yKeys.decorate();
    expect(tab('p').getAttribute('aria-label')).toBe('Inbox (pinned, sleeping, muted, Tor)');
  });

  it('walks pinned tabs, group header, grouped and loose tabs as one list with Up, Down, Home and End', () => {
    tab('x').focus();
    press(tab('x'), 'ArrowDown');
    expect(document.activeElement.dataset.tabId).toBe('y');
    press(document.activeElement, 'ArrowDown');
    expect(document.activeElement.dataset.tabId).toBe('p');
    press(document.activeElement, 'ArrowDown');
    expect(document.activeElement).toBe(header());
    press(document.activeElement, 'ArrowDown');
    expect(document.activeElement.dataset.tabId).toBe('w');
    press(document.activeElement, 'End');
    expect(document.activeElement.dataset.tabId).toBe('y');
    press(document.activeElement, 'Home');
    expect(document.activeElement.dataset.tabId).toBe('p');
    press(document.activeElement, 'ArrowUp');
    expect(document.activeElement.dataset.tabId).toBe('y');
    expect([...side().querySelectorAll('[tabindex="0"]')]).toHaveLength(1);
  });

  it('folds a group on Enter and says it is folded', async () => {
    header().addEventListener('click', () => header().parentElement.classList.toggle('collapsed'));
    header().focus();
    press(header(), 'Enter');
    await flush();
    expect(header().getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(header());
  });

  it('switches on Enter or Space, closes on Delete, and opens the menu on Shift+F10', async () => {
    const clicked = vi.fn();
    tab('y').addEventListener('click', clicked);
    tab('y').focus();
    press(tab('y'), ' ');
    expect(clicked).toHaveBeenCalledTimes(1);
    const menu = vi.fn();
    tab('y').addEventListener('contextmenu', menu);
    press(tab('y'), 'F10', { shiftKey: true });
    press(tab('y'), 'ContextMenu');
    expect(menu).toHaveBeenCalledTimes(2);
    globalThis.TabManager = { tabs: [], closeTab: vi.fn() };
    press(tab('y'), 'Delete');
    expect(globalThis.TabManager.closeTab).toHaveBeenCalledWith('y');
  });

  it('keeps focus on the same tab when the list is rebuilt under it', async () => {
    tab('y').focus();
    document.getElementById('tabs-list').innerHTML =
      '<div class="tab-item active" data-tab-id="x"><div class="tab-title">Home</div></div>' +
      '<div class="tab-item" data-tab-id="y"><div class="tab-title">Secret</div></div>';
    await flush();
    expect(document.activeElement).toBe(tab('y'));
    expect(tab('y').tabIndex).toBe(0);
  });

  it('does not pull focus back once the keyboard has left the list', async () => {
    tab('y').focus();
    document.getElementById('inside').focus();
    await flush();
    document.getElementById('tabs-list').innerHTML = '<div class="tab-item active" data-tab-id="x"><div class="tab-title">Home</div></div>';
    await flush();
    expect(document.activeElement.id).toBe('inside');
  });

  it('drops the tablist role from a list with no tab in it', async () => {
    document.getElementById('tabs-list').innerHTML = '';
    await flush();
    expect(document.getElementById('tabs-list').hasAttribute('role')).toBe(false);
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
