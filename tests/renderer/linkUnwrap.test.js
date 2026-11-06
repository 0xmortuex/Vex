// @vitest-environment jsdom
//
// Skip tracking redirect links, the window's side (js/link-unwrap.js): the default for a new or an existing profile, the quiet toast
// the first three times with Undo, and the setting.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fresh = (rel) => { const f = require.resolve(rel); delete require.cache[f]; return require(f); };
let U, S, toasts, state, wv, sets;

beforeEach(() => {
  localStorage.clear();
  delete window.vex;
  window.VexTabPolicy = { isPrivateWindow: false };
  S = fresh('../../src/renderer/js/site-rules-ui.js').SiteRulesUI;
  globalThis.SiteRulesUI = S; window.SiteRulesUI = S;
  toasts = [];
  window.showToast = vi.fn((m, t, d, o) => { toasts.push({ m, o }); });
  wv = { getWebContentsId: () => 42, loadURL: vi.fn() };
  globalThis.TabManager = { tabs: [{ id: 't1' }] };
  globalThis.WebviewManager = { webviews: new Map([['t1', wv]]) };
  state = { ok: true, lite: false, unwrap: null };
  sets = [];
  globalThis.VexQuietDefaults = { state: () => ({ mode: 'quiet', revealed: [] }) };
  window.vex = {
    navPrivacyGet: vi.fn(async () => ({ ...state })),
    navPrivacySet: vi.fn(async (c) => { sets.push(c); state = { ...state, ...c }; return { ...state }; }),
    onNavPrivacyChanged: vi.fn(),
    onLinkUnwrapped: vi.fn(),
    linkUnwrapAllowOnce: vi.fn(async () => ({ ok: true })),
    siteRulesSet: vi.fn(async (r) => ({ ok: true, rules: r })),
  };
  U = fresh('../../src/renderer/js/link-unwrap.js').VexLinkUnwrap;
});
afterEach(() => { vi.restoreAllMocks(); delete window.vex; delete globalThis.VexQuietDefaults; });

const settle = () => new Promise(r => setTimeout(r, 0));

describe('who gets it on', () => {
  it('a new profile (quiet defaults) starts with it on; the choice is saved once', async () => {
    await settle();
    expect(sets).toEqual([{ unwrap: true }]);
    expect(U.on()).toBe(true);
  });
  it('a profile that already had data starts with it off, and that is saved too', async () => {
    await settle();                       // the load in beforeEach already decided for a new profile: start again
    state.unwrap = null; sets.length = 0;
    globalThis.VexQuietDefaults = { state: () => ({ mode: 'all', revealed: [] }) };
    U = fresh('../../src/renderer/js/link-unwrap.js').VexLinkUnwrap;
    await settle();
    expect(sets).toEqual([{ unwrap: false }]);
    expect(U.on()).toBe(false);
  });
  it('a saved choice is never rewritten', async () => {
    await settle();
    state.unwrap = false;
    sets.length = 0;
    U = fresh('../../src/renderer/js/link-unwrap.js').VexLinkUnwrap;
    await settle();
    expect(sets).toEqual([]);
    expect(U.on()).toBe(false);
    state.unwrap = true;
    U = fresh('../../src/renderer/js/link-unwrap.js').VexLinkUnwrap;
    await settle();
    expect(sets).toEqual([]);
    expect(U.on()).toBe(true);
  });
  it('a private window decides nothing', async () => {
    window.VexTabPolicy.isPrivateWindow = true;
    sets.length = 0;
    U = fresh('../../src/renderer/js/link-unwrap.js').VexLinkUnwrap;
    await settle();
    expect(sets).toEqual([]);
    await expect(U.set(true)).rejects.toThrow(/normal window/);
  });
  it('defaultFor is on only for the quiet (new) state', () => {
    expect(U.defaultFor({ mode: 'quiet' })).toBe(true);
    expect(U.defaultFor({ mode: 'all' })).toBe(false);
    expect(U.defaultFor(null)).toBe(false);
  });
  it('without the quiet defaults it raises instead of guessing', async () => {
    await settle();
    state.unwrap = null; sets.length = 0;
    delete globalThis.VexQuietDefaults;
    window.VexProblems = { note: vi.fn() };
    U = fresh('../../src/renderer/js/link-unwrap.js').VexLinkUnwrap;
    await settle();
    expect(window.VexProblems.note).toHaveBeenCalled();
    expect(sets).toEqual([]);
    delete window.VexProblems;
  });
});

describe('the toast', () => {
  const msg = { pageId: 42, from: 'https://www.google.com/url?q=x', to: 'https://example.com/', via: ['google.com'] };
  beforeEach(async () => { await settle(); });

  it('says which redirect was skipped, with Undo', () => {
    U.onSkipped(msg);
    expect(toasts.length).toBe(1);
    expect(toasts[0].m).toBe('Skipped the redirect via google.com');
    expect(toasts[0].o.actions.map(a => a.label)).toEqual(['Undo']);
  });
  it('only the first three times', () => {
    for (let i = 0; i < 6; i++) U.onSkipped(msg);
    expect(toasts.length).toBe(3);
    expect(U.toastsShown()).toBe(3);
  });
  it('a link opened in a new tab has no Undo', () => {
    U.onSkipped({ ...msg, newTab: true });
    expect(toasts[0].o).toBeUndefined();
  });
  it('Undo lets main open the link as it was, once, and opens it in the tab it was clicked in', async () => {
    U.onSkipped(msg);
    toasts[0].o.actions[0].run();
    await settle();
    expect(window.vex.linkUnwrapAllowOnce).toHaveBeenCalledWith({ pageId: 42, url: msg.from });
    expect(wv.loadURL).toHaveBeenCalledWith(msg.from);
  });
  it('Undo for a tab that is gone says so instead of opening something else', async () => {
    window.VexProblems = { note: vi.fn() };
    U.onSkipped({ ...msg, pageId: 99 });
    toasts[0].o.actions[0].run();
    await settle();
    expect(wv.loadURL).not.toHaveBeenCalled();
    expect(window.showToast).toHaveBeenLastCalledWith('That tab is not open any more', 'error');
    delete window.VexProblems;
  });
  it('ignores a message that is not one', () => {
    U.onSkipped(null); U.onSkipped({}); U.onSkipped({ from: 5 });
    expect(toasts).toEqual([]);
  });
});

describe('the setting and the site panel', () => {
  it('is changed with a boolean through main', async () => {
    await settle();
    expect(await U.set(false)).toBe(false);
    expect(sets.at(-1)).toEqual({ unwrap: false });
  });
  it('a refusal from main is raised', async () => {
    await settle();
    window.vex.navPrivacySet = vi.fn(async () => ({ ok: false, error: 'nope' }));
    await expect(U.set(true)).rejects.toThrow(/nope/);
  });
  it('the per-site off switch is a site rule, and the panel row says how to use it', () => {
    const panel = require('fs').readFileSync('src/renderer/js/site-panel.js', 'utf8');
    expect(panel).toMatch(/_section\('links', 'Links'/);
    expect(panel).toMatch(/case 'unwrap-site':[\s\S]{0,200}SiteRulesUI\.set\(c\.url, 'unwrap', !el\.checked\)/);
    expect(panel).toMatch(/Turn this off if signing in with it breaks/);
    const profiles = require('fs').readFileSync('src/renderer/js/site-profiles.js', 'utf8');
    expect(profiles).toMatch(/rule\.unwrap === 'off'\) opts\.push\('redirect links not skipped'\)/);
  });
  it('the Roblox and Discord sign-in wrappers carry the flags that keep them out', () => {
    const { LinkSafety } = require('../../src/renderer/js/link-safety.js');
    expect(LinkSafety.WRAPPERS.filter(w => w.login).length).toBe(2);
    expect(LinkSafety.WRAPPERS.filter(w => w.app).length).toBe(1);
    // Copying a link still unwraps them as before.
    expect(LinkSafety.unwrap('https://www.roblox.com/login?returnUrl=' + encodeURIComponent('https://www.roblox.com/home'))).toBe('https://www.roblox.com/home');
  });
});
