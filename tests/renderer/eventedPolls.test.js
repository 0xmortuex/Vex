// @vitest-environment jsdom
//
// Things that used to poll on a timer and now follow events instead: the sync
// indicator (1 s), automations' URL rules and site reminders (3 s each), and
// streamer mode's capture check (5 s). An idle Vex woke its window about twice
// a second for these, all day, to find nothing had changed.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const fs = require('fs');
const path = require('path');

const src = (rel) => fs.readFileSync(path.join(__dirname, '../../src/renderer', rel), 'utf8');
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('the tab events', () => {
  it('switching tabs announces the tab now in front, after it is in front', () => {
    const tabs = src('js/tabs.js');
    const body = tabs.slice(tabs.indexOf('  switchTab(id) {'), tabs.indexOf('  _revealActiveInSidebar() {'));
    const set = body.indexOf('this.activeTabId = id;');
    const said = body.indexOf("window.dispatchEvent(new CustomEvent('vex:tab-activated'");
    expect(set).toBeGreaterThan(-1);
    expect(said).toBeGreaterThan(set);
  });

  it('a tab arriving somewhere new, or moving inside its page, is announced', () => {
    const wv = src('js/webview.js');
    expect(wv.match(/window\.dispatchEvent\(new CustomEvent\('vex:tab-url-changed'/g) || []).toHaveLength(2);
    expect(wv).toMatch(/TabManager\.updateTab\(tab\.id, \{ url \}\);\r?\n\s*window\.dispatchEvent\(new CustomEvent\('vex:tab-url-changed'/);
    expect(wv).toMatch(/TabManager\.updateTab\(tab\.id, \{ url: e\.url \}\);\r?\n\s*window\.dispatchEvent\(new CustomEvent\('vex:tab-url-changed'/);
  });
});

describe('automations', () => {
  let A;
  beforeEach(async () => {
    vi.resetModules();
    localStorage.clear();
    window.showToast = vi.fn();
    await import('../../src/renderer/js/automations.js?evented');
    A = window.Automations;
    A._started = false; A._firedUrl = {}; A._lastUrl = '';
  });

  it('a URL rule runs when its page comes to the front — with no 3 s poll behind it', () => {
    const every = vi.spyOn(globalThis, 'setInterval');
    localStorage.setItem(A.KEY, JSON.stringify([{ id: 'a1', name: 'Mail', enabled: true, trigger: { type: 'url', value: 'mail.test' }, action: { type: 'open', value: 'https://cal.test' } }]));
    let url = 'vex://start';
    vi.stubGlobal('TabManager', { getActiveTab: () => ({ url }), createTab: vi.fn() });
    A.start();
    expect(every.mock.calls.map(c => c[1])).toEqual([30000]);   // the clock rules only
    url = 'https://mail.test/inbox';
    window.dispatchEvent(new CustomEvent('vex:tab-activated', { detail: { tabId: 't1' } }));
    expect(TabManager.createTab).toHaveBeenCalledTimes(1);
    url = 'https://other.test/';
    window.dispatchEvent(new CustomEvent('vex:tab-url-changed', { detail: { tabId: 't1', url } }));
    url = 'https://mail.test/inbox/2';
    window.dispatchEvent(new CustomEvent('vex:tab-url-changed', { detail: { tabId: 't1', url } }));
    expect(TabManager.createTab).toHaveBeenCalledTimes(2);
  });
});

describe('site reminders', () => {
  it('"next time I open github.com" fires on the navigation, not on a 3 s poll', async () => {
    const { VexQuickReminder: R } = require('../../src/renderer/js/quick-reminder.js');
    const every = vi.spyOn(globalThis, 'setInterval');
    let url = 'https://example.test/';
    vi.stubGlobal('TabManager', { getActiveTab: () => ({ url }) });
    const b = { list: vi.fn(async () => [{ id: 'r1', site: 'github.com' }]), visited: vi.fn(async () => 1) };
    R._watching = false; R._lastHost = ''; R._siteHosts = null;
    R._watchSites(b);
    await flush();
    expect(every.mock.calls.map(c => c[1])).toEqual([30000]);  // the list re-read only
    expect(b.visited).not.toHaveBeenCalled();
    url = 'https://www.github.com/me';
    window.dispatchEvent(new CustomEvent('vex:tab-url-changed', { detail: { tabId: 't1', url } }));
    expect(b.visited).toHaveBeenCalledWith('github.com');
    await flush();
    expect(b.list).toHaveBeenCalledTimes(2);                    // fired, so the list is read again
    window.dispatchEvent(new CustomEvent('vex:tab-activated', { detail: { tabId: 't1' } }));
    expect(b.visited).toHaveBeenCalledTimes(1);                 // same page: not asked twice
  });

  it('a reminder made while you are already on its site is checked straight away', async () => {
    const { VexQuickReminder: R } = require('../../src/renderer/js/quick-reminder.js');
    vi.stubGlobal('TabManager', { getActiveTab: () => ({ url: 'https://docs.test/a' }) });
    const visited = vi.fn(async () => 0);
    let list = [];
    window.vex = { reminders: { list: vi.fn(async () => list), visited } };
    R._watching = false; R._lastHost = ''; R._siteHosts = null;
    R._watchSites();
    await flush();
    expect(visited).not.toHaveBeenCalled();     // no site reminders yet
    list = [{ id: 'r2', site: 'docs.test' }];
    R._hostsChanged();                          // one is made, on this page
    await flush();
    expect(visited).toHaveBeenCalledWith('docs.test');
    delete window.vex;
  });
});

describe('streamer mode while sharing', () => {
  it('follows capture events, and a closed sharing tab, with no 5 s poll', async () => {
    vi.useFakeTimers();
    const { GameMode } = require('../../src/renderer/js/game-mode.js');
    const every = vi.spyOn(globalThis, 'setInterval');
    window.showToast = vi.fn();
    localStorage.setItem(GameMode.KEY, 'auto');
    const tabs = [{ id: 't1', capturing: { screen: true } }];
    vi.stubGlobal('TabManager', { tabs });
    GameMode._watching = false; GameMode._was = undefined;
    GameMode.watchCapture();
    expect(every).not.toHaveBeenCalled();
    expect(document.body.classList.contains('streamer-mode')).toBe(true);
    tabs.splice(0, 1);
    document.dispatchEvent(new CustomEvent('vex:tab-closed', { detail: { tabId: 't1' } }));
    await vi.advanceTimersByTimeAsync(0);
    expect(document.body.classList.contains('streamer-mode')).toBe(false);
    tabs.push({ id: 't2', capturing: { screen: true } });
    document.dispatchEvent(new CustomEvent('vex:media-capture', { detail: { where: 'tab', id: 't2', kind: 'screen', active: true } }));
    expect(document.body.classList.contains('streamer-mode')).toBe(true);
    GameMode.markTitles(false);
  });
});

describe('the sync indicator', () => {
  it('is drawn on the engine\'s state events, not on a one-second poll', () => {
    const app = src('js/app.js');
    const block = app.slice(app.indexOf('// === Phase 13: Vex Sync'), app.indexOf("document.getElementById('sync-indicator')?.addEventListener('click'"));
    expect(block).not.toMatch(/setInterval/);
    expect(block).toMatch(/window\.addEventListener\('vex-sync-state', drawSyncIndicator\)/);
  });

  it('the engine says when its state changes: restored, syncing, done, signed out', async () => {
    vi.resetModules();
    vi.useFakeTimers();
    window.VexConfig = { syncWorkerUrl: () => 'https://sync.test' };
    window.vex = {
      syncLoadMeta: async () => ({ email: 'a@b.test', sessionToken: 't', deviceId: 'd1', emailHash: 'h', lastPushAt: null, lastPullAt: null, revision: 0 }),
      syncLoadKey: async () => 'ab'.repeat(32),
      syncClearState: vi.fn(async () => {}),
    };
    vi.stubGlobal('SyncCrypto', { hexToKey: x => x, importKey: async () => ({}) });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    const seen = [];
    const on = (e) => seen.push({ enabled: e.detail.enabled, syncing: e.detail.syncing, key: e.detail.encryptionKey });
    window.addEventListener('vex-sync-state', on);
    try {
      await import('../../src/renderer/js/sync-engine.js?evented');
      expect(await window.SyncEngine.initFromDisk()).toBe(true);
      expect(seen.at(-1)).toEqual({ enabled: true, syncing: false, key: null });   // never the key
      await window.SyncEngine.pullNow();
      expect(seen.slice(-2).map(s => s.syncing)).toEqual([true, false]);
      await window.SyncEngine.signOut();
      expect(seen.at(-1)).toMatchObject({ enabled: false });
    } finally {
      window.removeEventListener('vex-sync-state', on);
      vi.clearAllTimers();
      delete window.vex; delete window.VexConfig;
    }
  });
});

describe('the Library\'s long descriptions', () => {
  it('are not a startup script any more', () => {
    expect(src('index.html')).not.toMatch(/<script src="js\/feature-details\.js"><\/script>/);
  });

  it('load when the Library opens, and the cards are drawn again with them', async () => {
    const { FeatureLibrary } = require('../../src/renderer/js/feature-library.js');
    const { VexFeatures } = require('../../src/renderer/js/feature-catalog.js');
    const { VexGuide } = require('../../src/renderer/js/vex-guide.js');
    const { FeatureDetails } = require('../../src/renderer/js/feature-details.js');
    vi.stubGlobal('VexFeatures', VexFeatures);
    vi.stubGlobal('VexGuide', VexGuide);
    vi.stubGlobal('CommandBar', { commands: [] });
    window.escapeHtml = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    delete globalThis.FeatureDetails;
    window.VexLazy = { ensure: vi.fn(async () => { globalThis.FeatureDetails = FeatureDetails; return true; }) };
    try {
      document.body.innerHTML = '<div id="host"></div>';
      const host = document.getElementById('host');
      FeatureLibrary._query = VexFeatures.nameOf(VexFeatures.get('ai-panel'));
      FeatureLibrary._cat = null;
      FeatureLibrary.render(host);
      expect(window.VexLazy.ensure).toHaveBeenCalledWith('js/feature-details.js');
      const detail = FeatureDetails['ai-panel'];
      await flush();
      expect(host.textContent).toContain(detail.slice(0, 40));
    } finally {
      delete globalThis.FeatureDetails; delete window.VexLazy;
    }
  });

  it('Ask Vex waits for them, and says so when they cannot load', async () => {
    const { FeatureLibrary } = require('../../src/renderer/js/feature-library.js');
    delete globalThis.FeatureDetails;
    window.showToast = vi.fn();
    window.VexLazy = { ensure: vi.fn(async () => { throw new Error('lazy load failed: js/feature-details.js'); }) };
    vi.stubGlobal('AIPanel', { open: vi.fn(), sendMessage: vi.fn() });
    try {
      await FeatureLibrary.ask('ai-panel');
      expect(AIPanel.open).not.toHaveBeenCalled();
      expect(window.showToast).toHaveBeenCalledWith(expect.stringContaining('could not load'), 'error');
    } finally { delete window.VexLazy; }
  });
});
