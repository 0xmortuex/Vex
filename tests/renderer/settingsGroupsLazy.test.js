// @vitest-environment jsdom
//
// Module Settings sections are drawn when Settings opens, not while Vex starts (2026-10-28). Every one of the ~150 modules that register a
// section used to draw ALL of them at once while the page was loading: about 18,000 hidden elements and 150 rounds of building every section
// so far. Measured in the real app: the interface window held 339 MB at start and 156 MB with this change.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { VexSettingsGroups } = require('../../src/renderer/js/vex-settings-groups.js');

let built;
const def = (id) => ({ id, title: 'Section ' + id, keywords: 'k', render: (body) => { built.push(id); body.textContent = 'x'; } });
const content = () => document.querySelector('#panel-settings .settings-content');

beforeEach(() => {
  built = [];
  document.body.innerHTML = '<div id="panel-settings"><div class="settings-content"></div></div>';
  VexSettingsGroups._defs.clear();
});
afterEach(() => { delete globalThis.SidebarManager; });

describe('a section registered while Settings is closed', () => {
  it('is recorded but not built or put in the page (the sidebar says Settings is not open)', () => {
    globalThis.SidebarManager = { activePanel: null, sidePanel: null };
    VexSettingsGroups.register(def('alpha'));
    VexSettingsGroups.register(def('beta'));
    expect(VexSettingsGroups.ids()).toEqual(['alpha', 'beta']);
    expect(built).toEqual([]);
    expect(content().children.length).toBe(0);
  });

  it('does not build the earlier ones again for each new one (150 modules made 150 rounds of building them all)', () => {
    globalThis.SidebarManager = { activePanel: 'bookmarks', sidePanel: null };
    for (let i = 0; i < 20; i++) VexSettingsGroups.register(def('s' + i));
    expect(built.length).toBe(0);
  });

  it('is drawn, once each, when Settings opens (inject, which SettingsUI.enhance runs)', () => {
    globalThis.SidebarManager = { activePanel: null, sidePanel: null };
    VexSettingsGroups.register(def('alpha'));
    VexSettingsGroups.register(def('beta'));
    globalThis.SidebarManager.activePanel = 'settings';
    expect(VexSettingsGroups.inject()).toBe(2);
    expect(built).toEqual(['alpha', 'beta']);
    expect(content().querySelectorAll(':scope > .setting-group').length).toBe(2);
    expect(document.getElementById('setting-alpha').querySelector('.setting-label').textContent).toBe('Section alpha');
  });
});

describe('a section registered while Settings is showing', () => {
  it('appears at once, as it always did (as the page, or beside another panel)', () => {
    globalThis.SidebarManager = { activePanel: 'settings', sidePanel: null };
    VexSettingsGroups.register(def('alpha'));
    expect(document.getElementById('setting-alpha')).toBeTruthy();
    document.body.innerHTML = '<div id="panel-settings"><div class="settings-content"></div></div>';
    globalThis.SidebarManager = { activePanel: 'tabs', sidePanel: 'settings' };
    VexSettingsGroups.register(def('beta'));
    expect(document.getElementById('setting-beta')).toBeTruthy();
  });
});

describe('before the sidebar exists (modules register while the scripts are still loading)', () => {
  it('a hidden Settings panel means closed: nothing is built', () => {
    document.getElementById('panel-settings').style.display = 'none';
    VexSettingsGroups.register(def('alpha'));
    expect(built).toEqual([]);
  });
  it('a panel on screen means open, and no panel at all (a unit test) builds at once as before', () => {
    VexSettingsGroups.register(def('alpha'));
    expect(built).toEqual(['alpha']);
    document.body.innerHTML = '';
    VexSettingsGroups.register(def('beta'));   // no panel and no root: nothing to put it in, and no error
    expect(VexSettingsGroups.ids()).toEqual(['alpha', 'beta']);
  });
});

describe('every module section is there after Settings opens', () => {
  it('the same sections come out whether they were registered before or after the panel opened', () => {
    globalThis.SidebarManager = { activePanel: null, sidePanel: null };
    VexSettingsGroups.register(def('early'));
    globalThis.SidebarManager.activePanel = 'settings';
    VexSettingsGroups.register(def('late'));            // drawn at once; this also draws the early one
    VexSettingsGroups.inject();
    expect([...content().querySelectorAll(':scope > .setting-group')].map(g => g.id).sort()).toEqual(['setting-early', 'setting-late']);
  });
});

describe('Settings closed again: the module sections are taken out a minute later', () => {
  const leave = (panel, beside = null) => document.dispatchEvent(new CustomEvent('vex:panel-changed', { detail: { panel, beside } }));
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('drops them after RELEASE_MS and draws them again, once each, when Settings opens', () => {
    globalThis.SidebarManager = { activePanel: 'settings', sidePanel: null };
    VexSettingsGroups.register(def('alpha'));
    VexSettingsGroups.register(def('beta'));
    expect(content().querySelectorAll(':scope > .setting-group').length).toBe(2);
    globalThis.SidebarManager.activePanel = null;
    leave(null);
    vi.advanceTimersByTime(VexSettingsGroups.RELEASE_MS - 1000);
    expect(content().querySelectorAll(':scope > .setting-group').length).toBe(2);   // not yet
    vi.advanceTimersByTime(2000);
    expect(content().querySelectorAll(':scope > .setting-group').length).toBe(0);
    built.length = 0;
    globalThis.SidebarManager.activePanel = 'settings';
    leave('settings');
    VexSettingsGroups.inject();
    expect(built.sort()).toEqual(['alpha', 'beta']);
    expect(content().querySelectorAll(':scope > .setting-group').length).toBe(2);
  });

  it('does nothing when Settings is opened again before the minute is up', () => {
    globalThis.SidebarManager = { activePanel: 'settings', sidePanel: null };
    VexSettingsGroups.register(def('alpha'));
    globalThis.SidebarManager.activePanel = null; leave(null);
    vi.advanceTimersByTime(30000);
    globalThis.SidebarManager.activePanel = 'settings'; leave('settings');
    vi.advanceTimersByTime(120000);
    expect(document.getElementById('setting-alpha')).toBeTruthy();
  });

  it('never takes the sections out while Settings is showing beside another panel', () => {
    globalThis.SidebarManager = { activePanel: 'tabs', sidePanel: 'settings' };
    VexSettingsGroups.register(def('alpha'));
    leave('tabs', 'settings');
    vi.advanceTimersByTime(120000);
    expect(document.getElementById('setting-alpha')).toBeTruthy();
    expect(VexSettingsGroups.release()).toBe(0);
  });

  it('leaves the sections that are not a module\'s (the page\'s own) alone', () => {
    globalThis.SidebarManager = { activePanel: null, sidePanel: null };
    content().innerHTML = '<div class="setting-group" id="own"><label class="setting-label">Own</label></div>';
    VexSettingsGroups.register(def('alpha'));
    leave(null);
    vi.advanceTimersByTime(120000);
    expect(document.getElementById('own')).toBeTruthy();
  });
});
