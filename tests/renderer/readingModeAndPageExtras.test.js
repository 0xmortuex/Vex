// @vitest-environment jsdom
//
// Reading mode rebuilt the page's own markup (and its <title>) into a document
// it then loaded, and exiting navigated whatever tab happened to be active.
// ConsentBlock and CopyUnlock injected into every page but had no way to take
// that back when they were switched off.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

require('../../src/renderer/js/vex-utils.js');
require('../../src/renderer/js/vex-icons.js');

let toasts;
beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  toasts = [];
  window.showToast = (message, type, duration) => toasts.push({ message, type, duration });
});
afterEach(() => { vi.restoreAllMocks(); delete global.TabManager; delete global.WebviewManager; });
const lastToast = () => toasts[toasts.length - 1] || {};

// A webview stand-in that records what was loaded into it.
function fakeWebview(extract) {
  return {
    loaded: [],
    scripts: [],
    getURL() { return this.loaded[this.loaded.length - 1] || 'https://origin.test/article'; },
    loadURL(u) { this.loaded.push(u); },
    executeJavaScript(js) { this.scripts.push(js); return Promise.resolve(extract); },
    setZoomFactor() {},
  };
}
const decodeLoaded = (wv) => decodeURIComponent(wv.loaded[wv.loaded.length - 1].replace(/^data:text\/html;charset=utf-8,/, ''));

// ---------------------------------------------------------------------------
describe('reading mode', () => {
  const { ReadingMode } = require('../../src/renderer/js/reading-mode.js');

  beforeEach(() => { ReadingMode._originalUrls.clear(); });

  const article = {
    title: 'Bread & Butter <script>alert(1)</script>',
    blocks: [
      { tag: 'H1', text: 'A heading' },
      { tag: 'P', text: 'Body <img src=x onerror=alert(1)> text' },
      { tag: 'IMG', src: 'https://cdn.test/pic.png' },
      { tag: 'IMG', src: 'javascript:alert(1)' },
      { tag: 'SCRIPT', text: 'alert(1)' },
    ],
    fallbackText: '',
    wordCount: 120,
  };

  function setUpTab(id = 't1', extract = article) {
    const wv = fakeWebview(extract);
    global.TabManager = { activeTabId: id, tabs: [{ id, url: 'https://origin.test/article' }] };
    global.WebviewManager = { getActiveWebview: () => wv, webviews: new Map([[id, wv]]) };
    return wv;
  }

  it('escapes the page title instead of splicing it in as markup', async () => {
    const wv = setUpTab();
    await ReadingMode.activate();
    const html = decodeLoaded(wv);
    expect(html).toContain('Bread &amp; Butter &lt;script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
  });

  it('rebuilds block text rather than carrying the page’s own HTML across', async () => {
    const wv = setUpTab();
    await ReadingMode.activate();
    const html = decodeLoaded(wv);
    expect(html).toContain('<p>Body &lt;img src=x onerror=alert(1)&gt; text</p>');
    expect(html).not.toContain('onerror=alert(1)>');
  });

  it('keeps http(s) images and drops javascript: ones, and unknown tags', async () => {
    const wv = setUpTab();
    await ReadingMode.activate();
    const html = decodeLoaded(wv);
    expect(html).toContain('<img src="https://cdn.test/pic.png" alt="">');
    expect(html).not.toContain('javascript:alert(1)');
    expect(html).not.toContain('<script>');
  });

  it('says so when there is nothing to read instead of loading an empty document', async () => {
    const wv = setUpTab('t1', { title: 'x', blocks: [], fallbackText: '', wordCount: 0 });
    await ReadingMode.activate();
    expect(wv.loaded).toHaveLength(0);
    expect(lastToast().message).toMatch(/no article text/i);
  });

  it('reports an extraction failure instead of a bare "failed"', async () => {
    const wv = fakeWebview();
    wv.executeJavaScript = () => Promise.reject(new Error('guest crashed'));
    global.TabManager = { activeTabId: 't1', tabs: [{ id: 't1' }] };
    global.WebviewManager = { getActiveWebview: () => wv, webviews: new Map([['t1', wv]]) };
    await ReadingMode.activate();
    expect(lastToast().type).toBe('error');
    expect(lastToast().message).toMatch(/guest crashed/);
  });

  it('exits the tab it was asked about, not whichever tab is active', async () => {
    const reading = fakeWebview(article);
    const other = fakeWebview(article);
    global.TabManager = { activeTabId: 't1', tabs: [{ id: 't1' }, { id: 't2' }] };
    global.WebviewManager = { getActiveWebview: () => reading, webviews: new Map([['t1', reading], ['t2', other]]) };
    await ReadingMode.activate();
    expect(reading.loaded).toHaveLength(1);

    // The user moves to the other tab, then exits reading mode for t1.
    TabManager.activeTabId = 't2';
    WebviewManager.getActiveWebview = () => other;
    expect(ReadingMode.exitReadingMode('t1')).toBe(true);
    expect(reading.loaded[reading.loaded.length - 1]).toBe('https://origin.test/article');
    expect(other.loaded).toHaveLength(0);   // the visible tab is left alone
  });

  it('forgets tabs that no longer exist instead of holding their URLs forever', async () => {
    setUpTab('t1');
    await ReadingMode.activate();
    expect(ReadingMode._originalUrls.size).toBe(1);
    TabManager.tabs = [];                   // the tab was closed
    ReadingMode._prune();
    expect(ReadingMode._originalUrls.size).toBe(0);
  });

  it('exiting a tab with nothing remembered is a no-op, not a stray navigation', () => {
    const wv = setUpTab('t1');
    expect(ReadingMode.exitReadingMode('t1')).toBe(false);
    expect(wv.loaded).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
describe('consent block and copy unlock can be switched back off', () => {
  const { ConsentBlock, CopyUnlock } = require('../../src/renderer/js/page-extras.js');

  function twoGuests() {
    const a = fakeWebview(), b = fakeWebview();
    global.WebviewManager = { webviews: new Map([['t1', a], ['t2', b]]), getActiveWebview: () => a };
    return [a, b];
  }

  it('turning consent blocking off clears the injected rules in every open page', () => {
    const [a, b] = twoGuests();
    ConsentBlock.setEnabled(true);
    expect(a.scripts.at(-1)).toContain('vex-consent-style');
    expect(a.scripts.at(-1)).toContain('cookie-banner');

    ConsentBlock.setEnabled(false);
    // Not "inject nothing next time" — actively blank the stylesheet that is
    // already in the page, in both guests.
    for (const wv of [a, b]) {
      expect(wv.scripts.at(-1)).toContain("getElementById('vex-consent-style')");
      expect(wv.scripts.at(-1)).toContain("e.textContent=''");
    }
  });

  it('turning consent blocking back on re-injects', () => {
    const [a] = twoGuests();
    ConsentBlock.setEnabled(false);
    ConsentBlock.setEnabled(true);
    expect(a.scripts.at(-1)).toContain('cookie-banner');
  });

  it('copy unlock removes its stylesheet and is honest that listeners need a reload', () => {
    const [a, b] = twoGuests();
    CopyUnlock.setEnabled(true);
    CopyUnlock.reapplyAll();
    expect(a.scripts.at(-1)).toContain('vex-copy-unlock-style');

    CopyUnlock.setEnabled(false);
    const stillUnlocked = CopyUnlock.reapplyAll();
    expect(stillUnlocked).toBe(2);
    for (const wv of [a, b]) expect(wv.scripts.at(-1)).toContain("getElementById('vex-copy-unlock-style')");
  });

  it('reports a preference that could not be stored', () => {
    twoGuests();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError'); });
    expect(ConsentBlock.setEnabled(false)).toBe(false);
    expect(CopyUnlock.setEnabled(true)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe('site settings: resetting a site actually resets it', () => {
  const { VexBoosts } = require('../../src/renderer/js/boosts.js');
  require('../../src/renderer/js/site-profiles.js');
  const SiteProfiles = window.SiteProfiles;

  beforeEach(() => {
    VexBoosts.boosts = {};
    global.TabManager = { tabs: [], getActiveTab: () => null, activeTabId: null };
    global.WebviewManager = { webviews: new Map(), getActiveWebview: () => null };
    global.VexBoosts = VexBoosts;
  });
  afterEach(() => { delete global.VexBoosts; });

  it('a reset boost stays deleted when VexBoosts next saves', () => {
    VexBoosts.boosts['demo.test'] = { zaps: ['.ad'], css: 'body{color:red}', js: '' };
    VexBoosts.save();
    SiteProfiles._resetSite('demo.test');

    // The bug: the reset went straight to localStorage while VexBoosts still
    // held the host in memory, so its next save put the boost back.
    expect(VexBoosts.boosts['demo.test']).toBeUndefined();
    VexBoosts.save();
    expect(Object.keys(JSON.parse(localStorage.getItem('vex.boosts')))).not.toContain('demo.test');
  });

  it('clears the never-sleep flag, which reset used to leave behind', () => {
    SiteProfiles._saveNeverSleep(new Set(['sleepy.test']));
    SiteProfiles._resetSite('sleepy.test');
    expect(SiteProfiles._neverSleepHosts().has('sleepy.test')).toBe(false);
  });

  it('lists a site whose only customization is never-sleep', () => {
    SiteProfiles._saveNeverSleep(new Set(['sleepy.test']));
    const m = document.createElement('div');
    m.innerHTML = '<div id="sp-body"></div>';
    document.body.appendChild(m);
    SiteProfiles._paint(m);
    expect(m.querySelector('[data-host="sleepy.test"]')).toBeTruthy();
  });

  it('names what could not be saved rather than reporting a clean reset', () => {
    SiteProfiles._saveNeverSleep(new Set(['demo.test']));
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError'); });
    expect(SiteProfiles._resetSite('demo.test')).toBe(false);
    expect(lastToast().type).toBe('error');
    expect(lastToast().message).toMatch(/could not be saved/i);
  });
});
