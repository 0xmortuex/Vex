// @vitest-environment jsdom
//
// T3-010 (Wave 5): the fake browser-update overlay guard. It only warns; the page is a stand-in.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };
let G;

const LURE = 'Your Chrome browser is out of date! Security update required. Click Download to install the latest Chrome update now.';
const overlay = (over = {}) => ({ cover: 0.9, text: LURE, links: [{ href: 'https://cdn.evil.example/Chrome_Update.exe', download: false, text: 'Update Chrome' }], buttons: ['Download'], ...over });

beforeEach(() => {
  localStorage.clear();
  window.showToast = vi.fn();
  window.VexProblems = { note: vi.fn() };
  globalThis.VexLedger = { note: vi.fn() };
  delete globalThis.VexAttention;
  window.vex = { webSafety: { get: vi.fn(async () => ({ sensitivity: 'standard', allow: [], paranoid: [] })) } };
  window.VexTabPolicy = { isPrivateWindow: false };
  ({ VexFakeUpdate: G } = fresh('../../src/renderer/js/fake-update-guard.js'));
  G._told.clear();
});

describe('judge', () => {
  it('warns on a big overlay with the lure text and a program to download', () => {
    const v = G.judge(overlay(), 'free-games.example');
    expect(v.warn).toBe(true);
    expect(v.browser).toBe('chrome');
    expect(v.reasons.join(' ')).toContain('google.com');
  });
  it('warns on download-style wording even without a program link', () => {
    expect(G.judge(overlay({ links: [], buttons: ['Update now'] }), 'x.example').warn).toBe(true);
  });
  it('does not warn without the lure, without an overlay, or without a way to get a program', () => {
    expect(G.judge(overlay({ text: 'Welcome to our shop. Download our catalogue.' }), 'x.example').warn).toBe(false);
    expect(G.judge(overlay({ cover: 0.05 }), 'x.example').warn).toBe(false);
    expect(G.judge(overlay({ links: [], buttons: ['Close'] }), 'x.example').warn).toBe(false);
    expect(G.judge(null, 'x.example').warn).toBe(false);
  });
  it('leaves the maker\'s own site and a site the person said not to warn about alone', () => {
    expect(G.judge(overlay(), 'support.google.com').warn).toBe(false);
    expect(G.judge(overlay({ text: 'Your Firefox is out of date. Download the update.' }), 'www.mozilla.org').warn).toBe(false);
    expect(G.judge(overlay(), 'free-games.example', ['free-games.example']).warn).toBe(false);
    // The maker's site is only excused for its OWN browser.
    expect(G.judge(overlay(), 'www.mozilla.org').warn).toBe(true);
  });
  it('the lure words are not matched in ordinary text about browsers', () => {
    expect(G.judge(overlay({ text: 'We review every browser. Download the report for details about Chrome market share.' }), 'blog.example').warn).toBe(false);
  });
});

describe('scan', () => {
  const wv = (report) => ({ executeJavaScript: vi.fn(async () => report), isConnected: true });
  const tab = { id: 't', url: 'https://free-games.example/play' };
  it('reads the page once with the read-only probe and warns, once per site', async () => {
    const view = wv(overlay());
    const v = await G.scan(tab, view);
    expect(v.warn).toBe(true);
    expect(view.executeJavaScript).toHaveBeenCalledWith(G.PROBE);
    expect(window.showToast).toHaveBeenCalledWith(expect.stringContaining('fake browser update'), 'error', 14000);
    expect(globalThis.VexLedger.note).toHaveBeenCalled();
    await G.scan(tab, wv(overlay()));
    expect(window.showToast).toHaveBeenCalledTimes(1);
  });
  it('does not look at all while Web safety is off, in a tab Vex may not read, or when the switch is off', async () => {
    window.vex.webSafety.get = vi.fn(async () => ({ sensitivity: 'off', allow: [] }));
    const view = wv(overlay());
    expect(await G.scan(tab, view)).toBeNull();
    window.vex.webSafety.get = vi.fn(async () => ({ sensitivity: 'standard', allow: [] }));
    window.VexTabPolicy = { canReadWebview: () => false };
    expect(await G.scan(tab, view)).toBeNull();
    window.VexTabPolicy = { isPrivateWindow: false };
    G.setEnabled(false);
    expect(await G.scan(tab, view)).toBeNull();
    expect(view.executeJavaScript).not.toHaveBeenCalled();
  });
  it('skips addresses that are not web pages and raises when Web safety is unavailable', async () => {
    expect(await G.scan({ id: 't', url: 'file:///start.html' }, wv(overlay()))).toBeNull();
    delete window.vex.webSafety;
    await expect(G.scan(tab, wv(overlay()))).rejects.toThrow(/Web safety is not available/);
  });
});

describe('the probe is read-only', () => {
  it('has no code that changes or clicks the page', () => {
    expect(G.PROBE).not.toMatch(/\.click\(|\.remove\(|\.submit\(|\.appendChild|innerHTML\s*=|location\s*=|\.style\.|\.setAttribute|\.dispatchEvent|fetch\(|XMLHttpRequest|window\.open/);
  });
  it('runs on a real overlay and reads its text and links', () => {
    document.body.innerHTML = '<div id="o" style="position:fixed;left:0;top:0;width:100vw;height:100vh">Your Chrome is out of date. <a href="/Chrome_Update.exe">Update Chrome</a><button>Download</button></div>';
    const o = document.getElementById('o');
    o.getBoundingClientRect = () => ({ left: 0, top: 0, right: innerWidth, bottom: innerHeight, width: innerWidth, height: innerHeight });
    Object.defineProperty(o, 'innerText', { get() { return 'Your Chrome is out of date. Update Chrome Download'; } });
    const report = (0, eval)(G.PROBE);
    expect(report.cover).toBeGreaterThan(0.9);
    expect(report.links[0].href).toContain('Chrome_Update.exe');
  });
});
