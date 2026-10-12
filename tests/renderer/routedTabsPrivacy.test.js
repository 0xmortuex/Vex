// @vitest-environment jsdom
//
// A Tor tab is never read, recorded or sent anywhere by Vex. A tab routed its
// own way keeps its cookies (persist:) and so passed the same check
// (VexTabPolicy.canReadWebview): a site rule's Tor or proxy route
// (persist:route-*), a Tor container (persist:container-tor-*) and a container
// given a route of its own were read by the AI (page reads, the agent,
// Organize Tabs, Ask both models' cloud side), by email-code filling, and
// recorded by Clipboard History and price history (found 2026-10-11). They
// are now treated as a Tor tab there; an ordinary container is not.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

require('../../src/renderer/js/vex-utils.js');
require('../../src/renderer/js/data-contracts.js');

let routes;
beforeAll(() => {
  routes = { 'persist:container-work': { mode: 'direct' }, 'persist:container-secret': { mode: 'proxy', custom: 'socks5://127.0.0.1:1080' } };
  window.vex = { routingGet: vi.fn(async (p) => routes[p] || { mode: 'direct' }) };
  require('../../src/renderer/js/tab-policy.js');
});
beforeEach(() => { localStorage.clear(); document.body.innerHTML = ''; window.showToast = vi.fn(); });

function webview(partition, url = 'https://example.com/page') {
  const handlers = {};
  return {
    getURL: () => url,
    getAttribute: (n) => (n === 'partition' ? partition : null),
    addEventListener: (ev, fn) => { (handlers[ev] ||= []).push(fn); },
    emit(ev, e) { (handlers[ev] || []).forEach(fn => fn(e)); },
  };
}
const settle = () => new Promise(r => setTimeout(r, 0));

describe('VexTabPolicy and routed tabs', () => {
  const P = () => window.VexTabPolicy;

  it('reads an ordinary tab', () => {
    expect(P().canReadWebview(webview('persist:main'))).toBe(true);
    expect(P().canShareTab({ url: 'https://a.example/', partition: 'persist:main' })).toBe(true);
  });

  it.each(['persist:route-tor', 'persist:route-proxy-1x2y', 'persist:container-tor-kq3z'])('does not read or share %s', (partition) => {
    expect(P().canReadWebview(webview(partition))).toBe(false);
    expect(P().canShareTab({ url: 'https://a.example/', partition })).toBe(false);
  });

  it('still fills saved logins and codes into a routed tab, as before, but never into a Tor tab', () => {
    expect(P().canFillWebview(webview('persist:route-proxy-1x2y'))).toBe(true);
    expect(P().canFillWebview(webview('tor-1'))).toBe(false);
  });

  it('asks main about a container: routed until it answers, then by its own route', async () => {
    expect(P().isRouted('persist:container-work')).toBe(true);
    expect(P().isRouted('persist:container-secret')).toBe(true);
    await settle();
    expect(window.vex.routingGet).toHaveBeenCalledWith('persist:container-work');
    expect(P().canReadWebview(webview('persist:container-work'))).toBe(true);
    expect(P().canReadWebview(webview('persist:container-secret'))).toBe(false);
  });

  it('follows a container routed or set back to direct from Vex', async () => {
    P().noteRoute('persist:container-work', 'tor');
    expect(P().isRouted('persist:container-work')).toBe(true);
    P().noteRoute('persist:container-work', 'direct');
    expect(P().isRouted('persist:container-work')).toBe(false);
  });
});

describe('features that read or record a tab', () => {
  it('Clipboard History keeps nothing copied off a routed tab', () => {
    const { ClipboardHistory } = require('../../src/renderer/js/clipboard-history.js');
    ClipboardHistory.recent = []; ClipboardHistory.pinned = [];
    for (const p of ['persist:main', 'persist:route-tor']) {
      const wv = webview(p);
      ClipboardHistory.attach(wv);
      wv.emit('ipc-message', { channel: 'vex-copy', args: [{ text: 'copied in ' + p }] });
    }
    expect(ClipboardHistory.list().map(i => i.text)).toEqual(['copied in persist:main']);
  });

  it('the AI gets no page text from a routed tab', async () => {
    // A plain script with no exports, as the window loads it.
    const src = require('fs').readFileSync(require('path').join(__dirname, '../../src/renderer/js/page-context.js'), 'utf8');
    const PageContext = new Function(src + '\nreturn PageContext;')();
    window.vexGuestEval = vi.fn(async () => ({ url: 'https://example.com/page', title: 'T', text: 'secret' }));
    expect(await PageContext.extractPageContext(webview('persist:route-proxy-1x2y'))).toBeNull();
    expect(window.vexGuestEval).not.toHaveBeenCalled();
  });

  it('"Organize Tabs with AI" does not send routed tabs', async () => {
    globalThis.TabManager = {
      tabs: [
        { id: 'a', url: 'https://github.com/x', title: 'GitHub repo', partition: 'persist:main' },
        { id: 'b', url: 'https://docs.github.com/y', title: 'GitHub docs', partition: 'persist:main' },
        { id: 'c', url: 'https://news.example/z', title: 'News', partition: 'persist:main' },
        { id: 'r', url: 'https://forum.example/42', title: 'Routed forum', partition: 'persist:route-tor' },
        { id: 'k', url: 'https://mail.example/', title: 'Tor container mail', partition: 'persist:container-tor-kq3z' },
      ],
      groups: [], activeTabId: 'a', mayAskSiteForIcon: () => false,
    };
    let sent = null;
    globalThis.AIRouter = { callAI: vi.fn(async (_f, req) => { sent = req; return { result: JSON.stringify({ groups: [], ungrouped: [], reasoning: 'none' }) }; }) };
    const { TabGrouper } = require('../../src/renderer/js/tab-grouper.js');
    await TabGrouper.analyzeAndPropose();
    const titles = sent.tabs.map(t => t.title);
    expect(titles).toContain('GitHub repo');
    expect(titles).not.toContain('Routed forum');
    expect(titles).not.toContain('Tor container mail');
  });
});
