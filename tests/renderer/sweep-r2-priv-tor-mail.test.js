// @vitest-environment jsdom
//
// Fixes of 2026-09-30 (r2-priv): the "Tor is running" indicator and its Stop,
// and mail's Load more going on past 100 to the last message.
import { beforeEach, describe, expect, it, vi } from 'vitest';
require('../../src/renderer/js/vex-icons.js');
require('../../src/renderer/js/page-export.js');

const tick = () => new Promise(r => setTimeout(r, 0));
const SESSION = require.resolve('../../src/renderer/js/tor-session.js');

describe('the Tor indicator', () => {
  let onState, vex;
  function load(status) {
    document.body.innerHTML = `<div id="top-bar-right"><div id="tor-running" role="status" hidden>
      <span class="tor-running-icon" aria-hidden="true"></span><span class="tor-running-label">Tor is running</span>
      <button id="tor-running-stop" type="button" title="Stop Tor">Stop</button></div></div>`;
    vex = {
      torStatus: vi.fn(() => Promise.resolve(status)),
      onTorState: vi.fn((cb) => { onState = cb; return () => {}; }),
      stopTor: vi.fn(() => Promise.resolve({ ok: true })),
      onTorReviving: vi.fn(() => () => {}),
      onTorRevived: vi.fn(() => () => {}),
      onTorPageDown: vi.fn(() => () => {}),
    };
    window.vex = vex;
    window.showToast = vi.fn();
    delete require.cache[SESSION];
    return require(SESSION).TorSession;
  }

  beforeEach(() => {
    globalThis.TabManager = { tabs: [], closeTab: vi.fn() };
    globalThis.WebviewManager = { webviews: new Map() };
    window.vexConfirm = vi.fn(() => Promise.resolve(true));
  });

  it('shows while Vex\'s own Tor runs, with an icon and no emoji, and follows start and stop', async () => {
    load({ running: true, tabs: 0, windows: 0, routed: 0 });
    const el = document.getElementById('tor-running');
    await tick();
    expect(el.hidden).toBe(false);
    expect(el.querySelector('.tor-running-icon svg')).not.toBeNull();
    expect(el.textContent).not.toMatch(/\p{Extended_Pictographic}/u);
    onState({ running: false });
    expect(el.hidden).toBe(true);
    onState({ running: true });
    expect(el.hidden).toBe(false);
  });

  // Main now closes the Tor tabs in every window (tor:stop asks each window's
  // closeTorTabs) and counts them for the question (r4-tor, 2026-09-30). A
  // burner routed through Tor stays open (r7, 2026-09-30).
  it('Stop asks first when Tor tabs are open, then stops Tor; each window closes its own Tor tabs (asleep ones too)', async () => {
    const TorSession = load({ running: true, tabs: 2, windows: 1, routed: 1 });
    TabManager.tabs = [{ id: 'a', partition: 'tor-x1' }, { id: 'b', partition: 'otr-burner-1' }, { id: 'c', partition: null }, { id: 'd', partition: 'tor-x2' }];
    WebviewManager.webviews.set('a', { getWebContentsId: () => 7 });
    WebviewManager.webviews.set('b', { getWebContentsId: () => 9 });   // a burner routed through Tor
    WebviewManager.webviews.set('c', { getWebContentsId: () => 11 });
    document.getElementById('tor-running-stop').click();
    await tick(); await tick(); await tick();
    expect(window.vexConfirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Stop Tor?', message: 'The 2 Tor tabs will close. 1 page going through Tor (a container, site rule or burner) stops loading until you use it again.', danger: true }));
    expect(vex.stopTor).toHaveBeenCalled();
    expect(TorSession.countTorTabs()).toBe(2);
    expect(TorSession.closeTorTabs()).toBe(2);
    expect(TabManager.closeTab.mock.calls.map(c => c[0])).toEqual(['a', 'd']);
    expect(window.showToast).toHaveBeenCalledWith('Tor stopped');
  });

  it('Cancel leaves the tabs and Tor alone; with no Tor pages it stops at once', async () => {
    const TorSession = load({ running: true, tabs: 1, windows: 1, routed: 0 });
    TabManager.tabs = [{ id: 'a', partition: 'tor-x1' }];
    window.vexConfirm = vi.fn(() => Promise.resolve(false));
    expect(await TorSession.stop()).toBe(false);
    expect(TabManager.closeTab).not.toHaveBeenCalled();
    expect(vex.stopTor).not.toHaveBeenCalled();

    vex.torStatus = vi.fn(() => Promise.resolve({ running: true, tabs: 0, windows: 0, routed: 0 }));
    TabManager.tabs = [];
    expect(await TorSession.stop()).toBe(true);
    expect(window.vexConfirm).toHaveBeenCalledTimes(1);
    expect(vex.stopTor).toHaveBeenCalled();
  });

  it('a Stop main refuses is said, not swallowed', async () => {
    load({ running: true, tabs: 0, windows: 0, routed: 0 });
    vex.stopTor = vi.fn(() => Promise.resolve({ ok: false, error: 'Untrusted IPC sender' }));
    document.getElementById('tor-running-stop').click();
    await tick(); await tick(); await tick();
    expect(window.showToast).toHaveBeenCalledWith('Tor could not be stopped: Untrusted IPC sender', 'error');
  });
});

describe('mail: Load more goes on to the first message', () => {
  const { VexMail } = require('../../src/renderer/js/mail.js');
  const CUSTOM = { id: 'c1', email: 'tester@mail.test', provider: null, host: '127.0.0.1', port: 1143, name: '127.0.0.1', webmail: null };
  const all = Array.from({ length: 501 }, (_, i) => ({ uid: 501 - i, subject: 'Message ' + (501 - i), from: { name: 'S', address: 's@bulk.test' }, date: Date.now() - i * 60000, seen: false, messageId: '<m' + i + '@x>' }));

  beforeEach(() => {
    document.body.innerHTML = '';
    window.escapeHtml = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    window.showToast = vi.fn();
    globalThis.TabManager = { createTab: vi.fn() };
    globalThis.VexMail = VexMail;
    VexMail._state = { accountId: null, inbox: null, open: null };
  });

  it('pages of 50, older each time, until all 501 are listed and the button goes', async () => {
    const inbox = vi.fn((_id, limit, before) => Promise.resolve({ ok: true, value: { account: CUSTOM, total: 501, unseen: 0, messages: all.filter(m => before == null || m.uid < before).slice(0, limit) } }));
    window.vex = { mail: { accounts: () => Promise.resolve({ ok: true, value: [CUSTOM] }), inbox } };
    await VexMail.open();
    const o = document.querySelector('.vex-mail-overlay');
    for (let i = 0; i < 20 && o.querySelector('[data-more]'); i++) {
      o.querySelector('[data-more]').click();
      await tick(); await tick();
    }
    const uids = [...o.querySelectorAll('[data-uid]')].map(r => Number(r.dataset.uid));
    expect(uids).toHaveLength(501);
    expect(uids[500]).toBe(1);
    expect(o.querySelector('[data-more-note]')).toBeNull();
    expect(inbox).toHaveBeenCalledWith('c1', 50, 102);
  });

  it('a page that fails keeps the button and says why', async () => {
    let calls = 0;
    const inbox = vi.fn(() => (++calls === 1
      ? Promise.resolve({ ok: true, value: { account: CUSTOM, total: 501, unseen: 0, messages: all.slice(0, 50) } })
      : Promise.resolve({ ok: false, error: 'The mail server did not answer in time' })));
    window.vex = { mail: { accounts: () => Promise.resolve({ ok: true, value: [CUSTOM] }), inbox } };
    await VexMail.open();
    const o = document.querySelector('.vex-mail-overlay');
    o.querySelector('[data-more]').click();
    await tick(); await tick();
    expect(window.showToast).toHaveBeenCalledWith(expect.stringContaining('did not answer in time'), 'error');
    expect(o.querySelector('[data-more]').disabled).toBe(false);
    expect(o.querySelectorAll('[data-uid]')).toHaveLength(50);
  });
});
