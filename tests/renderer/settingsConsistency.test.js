// @vitest-environment jsdom
//
// Settings that say one thing and do another (the v2.36.4 settings audit):
// Sync claiming "Signed in" with nowhere to sync to, keys synced that nothing
// writes, guide entries that pointed nowhere, counts written down and gone
// stale, a group "Sleep tabs" that silenced music, and panels that slept on a
// timer of their own.

import { describe, it, expect, vi, beforeEach } from 'vitest';

require('../../src/renderer/js/vex-utils.js');
const { VexIcons } = require('../../src/renderer/js/vex-icons.js');
globalThis.VexIcons = VexIcons; window.VexIcons = VexIcons;

describe('Vex Sync without a Sync Worker URL', () => {
  function render(state, url) {
    vi.resetModules();
    window.VexConfig = { syncWorkerUrl: () => url };
    global.SyncEngine = { getState: () => state, listDevices: vi.fn(async () => []), signOut: vi.fn(async () => {}) };
    require('../../src/renderer/js/sync-settings.js');
    const host = document.createElement('div');
    document.body.innerHTML = '';
    document.body.appendChild(host);
    return window.SyncSettings.renderSyncPanel(host).then(() => host);
  }

  it('is "Not syncing", with a button to Settings › Cloud — never "Signed in"', async () => {
    globalThis.SettingsUI = { openSection: vi.fn() };
    const host = await render({ enabled: true, email: 'a@b.test' }, '');
    expect(host.textContent).not.toMatch(/Signed in/);
    expect(host.textContent).toMatch(/Not syncing/);
    expect(host.textContent).toMatch(/Settings › Cloud/);
    host.querySelector('#btn-sync-open-cloud').click();
    expect(SettingsUI.openSection).toHaveBeenCalledWith('setting-sync-worker-url');
    host.querySelector('#btn-sync-forget-old').click();
    expect(SyncEngine.signOut).toHaveBeenCalledWith(false);
    delete globalThis.SettingsUI;
  });

  it('with a URL and a working last sync it is "Signed in"; a failed last sync says so', async () => {
    let host = await render({ enabled: true, email: 'a@b.test', lastError: null }, 'https://sync.test');
    expect(host.textContent).toMatch(/Signed in as/);
    host = await render({ enabled: true, email: 'a@b.test', lastError: 'Push returned 500' }, 'https://sync.test');
    expect(host.textContent).not.toMatch(/Signed in as/);
    expect(host.textContent).toMatch(/Not syncing — the last sync failed/);
    expect(host.textContent).toMatch(/Push returned 500/);
  });
});

describe('what Vex Sync carries', () => {
  it('names only keys something writes — auto-sleep travels as vex.autoSleepPrefs', () => {
    vi.resetModules();
    window.VexConfig = { syncWorkerUrl: () => '' };
    require('../../src/renderer/js/sync-engine.js');
    const keys = window.SyncEngine.SYNC_KEYS;
    for (const dead of ['vex.autosleep', 'vex.autosleepMinutes', 'vex.autosleepExcludePinned', 'vex.settings', 'vex.customCommands', 'vex-theme']) {
      expect(keys).not.toContain(dead);
    }
    expect(keys).toContain('vex.autoSleepPrefs');
    const fs = require('fs'), path = require('path');
    const app = fs.readFileSync(path.join(__dirname, '../../src/renderer/js/app.js'), 'utf8');
    expect(app).toMatch(/localStorage\.setItem\('vex\.autoSleepPrefs'/);
  });

  it('its error points at Settings › Cloud, where the URL is', () => {
    const fs = require('fs'), path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '../../src/renderer/js/sync-engine.js'), 'utf8');
    expect(src).toMatch(/Add your Sync Worker URL in Settings › Cloud/);
    expect(src).not.toMatch(/Settings → Sync/);
  });
});

describe('the guide and the feature list point at real places', () => {
  const { VexFeatures } = require('../../src/renderer/js/feature-catalog.js');
  const { VexGuide } = require('../../src/renderer/js/vex-guide.js');
  const fs = require('fs'), path = require('path');
  const html = fs.readFileSync(path.join(__dirname, '../../src/renderer/index.html'), 'utf8');

  it('an entry with a section opens that section (it said "nothing to point at")', () => {
    globalThis.SettingsUI = { openSection: vi.fn() };
    window.showToast = vi.fn();
    const sync = VexFeatures.get('sync');
    VexGuide.show(sync);
    expect(SettingsUI.openSection).toHaveBeenCalledWith('sync-panel-content');
    expect(window.showToast).not.toHaveBeenCalled();
    expect(VexGuide.steps(sync).join(' ')).not.toMatch(/turn on/);
    delete globalThis.SettingsUI;
  });

  it('the entries the audit found pointing at the wrong section point at the right one', () => {
    const where = (id) => { const s = VexFeatures.get(id).setting; return s.id || s.section; };
    expect(where('ai-router')).toBe('ai-mode-radio');
    expect(where('accessibility')).toBe('a11y-panel-content');
    expect(where('guistyle')).toBe('setting-gui-style');
    expect(where('updates')).toBe('setting-update-on-start');
    expect(where('permissions')).toBe('permissions-panel-content');
    for (const f of VexFeatures.ITEMS) {
      if (!f.setting) continue;
      const target = f.setting.id || f.setting.section;
      expect(html.includes('id="' + target + '"'), f.id + ' → ' + target).toBe(true);
    }
  });

  it('no text sends anyone to a "Settings › Gaming" that does not exist', () => {
    for (const f of ['feature-catalog.js', 'game-mode.js']) {
      expect(fs.readFileSync(path.join(__dirname, '../../src/renderer/js/', f), 'utf8')).not.toMatch(/Settings › Gaming\b(?! and)/);
    }
  });
});

describe('counts come from the real lists', () => {
  it('the theme and feature counts in Settings are filled in, not written down', () => {
    const { ThemeManager } = require('../../src/renderer/js/theme-manager.js');
    const { VexFeatures } = require('../../src/renderer/js/feature-catalog.js');
    const { SettingsUI } = require('../../src/renderer/js/settings-ui.js');
    globalThis.ThemeManager = ThemeManager;
    globalThis.VexFeatures = VexFeatures;
    document.body.innerHTML = '<div><span data-count="themes">Dozens</span> <span data-count="features">the</span></div>';
    SettingsUI._fillCounts(document.body);
    expect(document.querySelector('[data-count="themes"]').textContent).toBe(String(ThemeManager.THEMES.length));
    expect(document.querySelector('[data-count="features"]').textContent).toBe(String(VexFeatures.ITEMS.length));
    expect(VexFeatures.get('themes').what).toMatch(new RegExp('^' + ThemeManager.THEMES.length + ' themes'));
    delete globalThis.ThemeManager; delete globalThis.VexFeatures;
  });
});

describe('sleeping a group, and panels', () => {
  beforeEach(() => { localStorage.clear(); });

  it('a group’s "Sleep tabs" leaves the one playing sound alone, as its toast says', async () => {
    const { TabManager } = require('../../src/renderer/js/tabs.js');
    TabManager.groups = [{ id: 'g', name: 'Music' }];
    TabManager.tabs = [
      { id: 'a', groupId: 'g', audible: true, muted: false },
      { id: 'b', groupId: 'g' },
    ];
    TabManager.activeTabId = 'x';
    TabManager.sleepTab = vi.fn(async (id) => { TabManager.tabs.find(t => t.id === id).sleeping = true; });
    TabManager.rebuildAllTabs = vi.fn();
    window.showToast = vi.fn();
    await TabManager._handleGroupAction('sleep-tabs', 'g');
    expect(TabManager.sleepTab).toHaveBeenCalledTimes(1);
    expect(TabManager.sleepTab).toHaveBeenCalledWith('b');
  });

  it('panels sleep after the same idle time as tabs', () => {
    const { SidebarManager } = require('../../src/renderer/js/sidebar.js');
    window.vexTabSleepMinutes = () => 15;
    expect(SidebarManager.panelSleepPrefs().minutes).toBe(15);
    localStorage.setItem('vex.memorySaver', '1');
    expect(SidebarManager.panelSleepPrefs().minutes).toBe(10);
    delete window.vexTabSleepMinutes;
  });
});
