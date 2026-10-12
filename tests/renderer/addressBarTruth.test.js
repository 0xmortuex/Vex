// @vitest-environment jsdom
//
// What the address bar and its padlock say is what the page is (found
// 2026-10-10):
//   * http://accounts.google.com@127.0.0.1/signin was shown as typed, so it
//     read as a Google address while the page came from 127.0.0.1;
//   * a page that failed to load over https (no TLS, a refused certificate)
//     still had the padlock and "Connection is secure".
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('the address bar leaves out a name and password before the host', () => {
  let TabManager;
  beforeEach(async () => {
    vi.resetModules();
    document.body.innerHTML = '<input id="url-input">';
    globalThis.VexStorage = { loadTabs: vi.fn(async () => []), saveTabs: vi.fn(async () => true), loadGroups: vi.fn(async () => []), saveGroups: vi.fn(async () => true), loadStacks: vi.fn(async () => []), saveStacks: vi.fn(async () => true) };
    if (!window.vex) window.vex = { getStartPageUrl: () => new Promise(() => {}) };
    await import('../../src/renderer/js/vex-icons.js');
    await import('../../src/renderer/js/vex-utils.js');
    ({ TabManager } = await import('../../src/renderer/js/tabs.js'));
  });

  it('shows the real host', () => {
    expect(TabManager.urlBarText({ url: 'http://accounts.google.com@127.0.0.1:9947/signin' })).toBe('http://127.0.0.1:9947/signin');
    expect(TabManager.urlBarText({ url: 'https://user:pa%40ss@example.com/a?b=c@d' })).toBe('https://example.com/a?b=c@d');
  });
  it('leaves an ordinary address, and an @ in the path, alone', () => {
    expect(TabManager.urlBarText({ url: 'https://example.com/@someone' })).toBe('https://example.com/@someone');
    expect(TabManager.urlBarText({ url: 'mailto:a@b.example' })).toBe('mailto:a@b.example');
  });
});

describe('the padlock follows the page that loaded', () => {
  function load(tab, url) {
    vi.resetModules();
    document.body.innerHTML = '<div id="url-bar"><button id="url-site-btn" type="button"></button><input id="url-input"></div>';
    globalThis.VexIcons = window.VexIcons = { svg: (name) => `<svg data-icon="${name}"></svg>` };
    window.VexTabPolicy = { isPrivateWindow: false, defaultPartition: 'persist:main' };
    const wv = { getURL: () => url, getWebContentsId: () => 7 };
    globalThis.TabManager = { tabs: [tab], getActiveTab: () => tab, activeTabId: tab.id };
    globalThis.WebviewManager = { webviews: new Map([[tab.id, wv]]), getActiveWebview: () => wv };
    delete require.cache[require.resolve('../../src/renderer/js/site-panel.js')];
    return require('../../src/renderer/js/site-panel.js').SitePanel;
  }

  it('an https page that loaded is secure', () => {
    const P = load({ id: 't1', url: 'https://bank.example/' }, 'https://bank.example/');
    expect(P.refreshIcon()).toBe('secure');
  });
  it('an https page that failed is not', () => {
    const tab = { id: 't1', url: 'https://bank.example/', _loadFailed: { code: -107, url: 'https://bank.example/' } };
    const P = load(tab, 'https://bank.example/');
    expect(P.refreshIcon()).toBe('failed');
    expect(P.context().secure).toBe(false);
    expect(document.getElementById('url-site-btn').title).toMatch(/did not load/);
  });
  it('an older failure does not mark the page that loaded after it', () => {
    const tab = { id: 't1', url: 'https://bank.example/ok', _loadFailed: { code: -107, url: 'https://bank.example/' } };
    expect(load(tab, 'https://bank.example/ok').refreshIcon()).toBe('secure');
  });
});
