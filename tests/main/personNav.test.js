// A page the person opened themselves may hand off to another program (src/main/person-nav.js).
//
// Found 2026-11-11: a Roblox invite link (www.roblox.com/share?code=...&type=ExperienceInvite) pasted into the
// address bar did nothing in Vex and worked in Chrome. The page starts the Roblox app by itself, with no click on
// it, and Vex follows a link to another program only shortly after a click or key press ON THE PAGE. The log said
// "[Protocol] not opening a roblox-player: link nobody clicked", and the person was told nothing.
import { describe, it, expect } from 'vitest';
const fs = require('fs');
const path = require('path');
const { createPersonNav, sameAddress, WINDOW_MS, AFTER_LOAD_MS, MAX_LOAD_MS, CLAIM_MS, MAX_EXPECTED } = require('../../src/main/person-nav.js');
const { installIpcPolicy } = require('../../src/main/ipc-policy.js');
const { validate } = require('../../src/main/ipc-schemas.js');

function rig() {
  const t = { now: 1_000_000 };
  const nav = createPersonNav({ now: () => t.now });
  return { nav, t, pass: (ms) => { t.now += ms; } };
}

describe('a page the person sent somewhere', () => {
  it('may hand off while it loads and for a while after, then no more', () => {
    const { nav, pass } = rig();
    expect(nav.allows(7)).toBe(false);                  // nobody opened it
    nav.started(7);
    expect(nav.allows(7)).toBe(true);
    pass(4000);
    nav.loaded(7);
    pass(WINDOW_MS - 4000 - 1);
    expect(nav.allows(7)).toBe(true);                   // the invite page asked Roblox, moved on, and hands off
    pass(2);
    expect(nav.allows(7)).toBe(false);
    expect(nav.allows(7)).toBe(false);
  });
  it('a slow page still may, for ten seconds after it has loaded', () => {
    const { nav, pass } = rig();
    nav.started(7);
    pass(WINDOW_MS + 20000);                            // still loading, long past the usual window
    expect(nav.allows(7)).toBe(true);
    nav.loaded(7);
    pass(AFTER_LOAD_MS - 1);
    expect(nav.allows(7)).toBe(true);
    pass(2);
    expect(nav.allows(7)).toBe(false);
  });
  it('a page that never finishes loading does not keep it for ever', () => {
    const { nav, pass } = rig();
    nav.started(7);
    pass(MAX_LOAD_MS + 1);
    expect(nav.allows(7)).toBe(false);
  });
  it('is that page\'s alone, ends when the page goes, and a later load by the page itself earns nothing', () => {
    const { nav, pass } = rig();
    nav.started(7);
    expect(nav.allows(8)).toBe(false);
    nav.loaded(7);
    pass(WINDOW_MS + 1);
    nav.loaded(7);                                      // the page reloaded itself: nobody asked for that
    expect(nav.allows(7)).toBe(false);
    nav.started(9);
    nav.forget(9);
    expect(nav.allows(9)).toBe(false);
    expect(() => nav.started('7')).toThrow(/page id/);
  });
});

describe('a tab the person is about to open', () => {
  it('the page that starts loading exactly that address gets it, once', () => {
    const { nav } = rig();
    const link = 'https://www.roblox.com/share?code=abc123&type=ExperienceInvite';
    expect(nav.expect(link)).toBe(true);
    expect(nav.claim(11, 'https://www.roblox.com/home')).toBe(false);       // another tab loading something else
    expect(nav.allows(11)).toBe(false);
    expect(nav.claim(12, link)).toBe(true);
    expect(nav.allows(12)).toBe(true);
    expect(nav.claim(13, link)).toBe(false);                                // a second page asking for the same address
    expect(nav.allows(13)).toBe(false);
  });
  it('matches the address as a browser writes it', () => {
    const { nav } = rig();
    nav.expect('https://Example.com');
    expect(nav.claim(1, 'https://example.com/')).toBe(true);
    expect(sameAddress('https://a.example/x?b=1', 'https://a.example/x?b=2')).toBe(false);
    expect(sameAddress('not an address', 'not an address')).toBe(false);
  });
  it('waits a short time only, takes web addresses only, and keeps a bounded list', () => {
    const { nav, pass } = rig();
    nav.expect('https://late.example/');
    pass(CLAIM_MS + 1);
    expect(nav.claim(1, 'https://late.example/')).toBe(false);
    for (const bad of ['roblox-player:1+launchmode:play', 'file:///C:/x.html', 'javascript:alert(1)', '', null, 'https://a.example/' + 'x'.repeat(9000)]) expect(nav.expect(bad), String(bad).slice(0, 30)).toBe(false);
    for (let i = 0; i < MAX_EXPECTED + 15; i++) nav.expect('https://many.example/' + i);
    expect(nav._size().expected).toBe(MAX_EXPECTED);
  });
});

describe('main.js wiring', () => {
  const MAIN = fs.readFileSync(path.join(__dirname, '../../src/main.js'), 'utf8');
  const block = (start, len) => { const i = MAIN.indexOf(start); expect(i, start).toBeGreaterThan(-1); return MAIN.slice(i, i + len); };
  it('a link to another program is followed after a click on the page OR for a page the person opened', () => {
    expect(block('function handleExternalProtocol(', 420)).toContain('const gesture = _mainHelpers.hasRecentGesture(_lastGestureAt.get(contents.id)) || _personNav.allows(contents.id);');
  });
  it('a private, off-the-record or Tor page is still refused first, and the question is still asked', () => {
    const fn = block('function handleExternalProtocol(', 2400);
    expect(fn.indexOf('refusesExternalApps(')).toBeGreaterThan(-1);
    expect(fn.indexOf('refusesExternalApps(')).toBeLessThan(fn.indexOf("if (!gesture) { console.log(`[Protocol] not opening"));
    expect(fn.indexOf('askExternalApp(')).toBeGreaterThan(fn.indexOf('if (!gesture)'));
  });
  it('only the main frame\'s own new document can take an expected address, and a load is noted', () => {
    const hook = block("contents.on('did-start-navigation', (evt, url, isInPlace, isMainFrame) => {", 520);
    expect(hook).toContain('if (main && !same) _personNav.claim(contents.id, (evt && evt.url) || url);');
    expect(MAIN).toContain("contents.on('did-finish-load', () => _personNav.loaded(contents.id));");
    expect(MAIN).toContain("contents.once('destroyed', () => _personNav.forget(contents.id));");
  });
  it('a link clicked in a page says so only when there was a click', () => {
    expect(MAIN).toContain('clicked: _mainHelpers.hasRecentGesture(_lastGestureAt.get(contents.id)) || undefined,');
  });
});

describe('the channels', () => {
  function policy({ ui = false, owner = null, owns = true } = {}) {
    const handlers = new Map();
    const ipcMain = { handle: (c, f) => handlers.set(c, f), on() {} };
    installIpcPolicy(ipcMain, { isUiFrame: () => ui, owner: () => owner, isAuxiliary: () => false, ownsTarget: () => owns });
    for (const c of ['tabs:person-navigated', 'tabs:person-opening']) ipcMain.handle(c, () => 'ok');
    return (c, ...a) => handlers.get(c)({ sender: {}, senderFrame: { url: 'https://evil.example/' } }, ...a);
  }
  it('a page can never say "the person opened me"', async () => {
    const call = policy({ owner: { id: 1 } });
    await expect(call('tabs:person-navigated', 7)).rejects.toThrow(/Untrusted IPC sender|outside Vex.s own window/);
    await expect(call('tabs:person-opening', 'https://evil.example/')).rejects.toThrow(/Untrusted IPC sender|outside Vex.s own window/);
  });
  it('Vex\'s own window can, for a tab of its own only', async () => {
    const call = policy({ ui: true, owner: { id: 1 } });
    expect(await call('tabs:person-navigated', 7)).toBe('ok');
    expect(await call('tabs:person-opening', 'https://www.roblox.com/share?code=abc')).toBe('ok');
    const other = policy({ ui: true, owner: { id: 1 }, owns: false });
    await expect(other('tabs:person-navigated', 7)).rejects.toThrow();
  });
  it('the payloads are checked', () => {
    expect(() => validate('tabs:person-navigated', [7])).not.toThrow();
    expect(() => validate('tabs:person-navigated', ['7'])).toThrow();
    expect(() => validate('tabs:person-opening', ['https://www.roblox.com/share?code=abc'])).not.toThrow();
    expect(() => validate('tabs:person-opening', ['roblox-player:1'])).toThrow();
    expect(() => validate('tabs:person-opening', [])).toThrow();
  });
});
