// @vitest-environment jsdom
//
// "Forget this site when I close it", the window's side (js/forget-site.js): which closing tabs ask main to forget their site.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fresh = (rel) => { const f = require.resolve(rel); delete require.cache[f]; return require(f); };
let S, F, tabs, wvs, asked;
const closeEvent = (id) => document.dispatchEvent(new CustomEvent('vex:tab-closed', { detail: { tabId: id } }));
const gone = (id) => { const i = tabs.findIndex(t => t.id === id); tabs.splice(i, 1); };

beforeEach(async () => {
  vi.useFakeTimers();
  localStorage.clear();
  delete window.vex;
  window.VexTabPolicy = { isPrivateWindow: false };
  S = fresh('../../src/renderer/js/site-rules-ui.js').SiteRulesUI;
  globalThis.SiteRulesUI = S; window.SiteRulesUI = S;
  S._mirror = null;
  S.save({ 'school.example': { forget: true }, 'netflix.com': { forget: true } });
  tabs = [
    { id: 'a', url: 'https://portal.school.example/exam', partition: 'persist:main' },
    { id: 'b', url: 'https://www.school.example/', partition: 'persist:main' },
    { id: 'c', url: 'https://news.example/', partition: 'persist:main' },
    { id: 'n', url: 'https://www.netflix.com/browse', partition: 'persist:main' },
  ];
  wvs = new Map(tabs.map((t, i) => [t.id, { getURL: () => t.url, getWebContentsId: () => 10 + i }]));
  globalThis.TabManager = { tabs, _bulkClosing: false };
  globalThis.WebviewManager = { webviews: wvs };
  asked = [];
  window.vex = { siteRulesSet: vi.fn(async (r) => ({ ok: true, rules: r })), siteForget: vi.fn(async (o) => { asked.push(o); return { ok: true, cleared: true, host: 'school.example' }; }) };
  window.showToast = vi.fn();
  F = fresh('../../src/renderer/js/forget-site.js').VexForgetSite;
  // It started itself when the file loaded (window.vex.siteForget exists), as it does in the window.
  expect(F._bound).toBe(true);
});
afterEach(() => { F.destroy(); vi.useRealTimers(); vi.restoreAllMocks(); delete window.vex; });

describe('when a tab closes', () => {
  it('asks main to forget the site when it was the last tab of it', async () => {
    closeEvent('a'); gone('a');
    await vi.advanceTimersByTimeAsync(5);
    closeEvent('b'); gone('b');
    await vi.advanceTimersByTimeAsync(5);
    // 'a' still had 'b' (www. of the same site) open: only the second close, the last tab, asks.
    expect(asked).toEqual([{ url: 'https://www.school.example/', partition: 'persist:main', exceptPageId: 11 }]);
    expect(window.showToast).toHaveBeenCalledWith('Forgot school.example: its cookies and stored data were cleared.');
  });
  it('does not, while another tab of the site stays open', async () => {
    closeEvent('a'); gone('a');
    await vi.advanceTimersByTimeAsync(5);
    expect(asked).toEqual([]);
  });
  it('does not for a site without the rule', async () => {
    closeEvent('c'); gone('c');
    await vi.advanceTimersByTimeAsync(5);
    expect(asked).toEqual([]);
  });
  it('does not for a video site, even with the rule in storage', async () => {
    closeEvent('n'); gone('n');
    await vi.advanceTimersByTimeAsync(5);
    expect(asked).toEqual([]);
  });
  it('does not when the tab was closed as part of switching workspace', async () => {
    TabManager._bulkClosing = true;
    closeEvent('a'); gone('a'); closeEvent('b'); gone('b');
    TabManager._bulkClosing = false;     // it is over before the timer fires
    await vi.advanceTimersByTimeAsync(5);
    expect(asked).toEqual([]);
  });
  it('does not in a private window, or for a tab that keeps nothing', async () => {
    tabs.find(t => t.id === 'b').partition = 'burner-1';
    closeEvent('b'); gone('b');
    window.VexTabPolicy.isPrivateWindow = true;
    closeEvent('a'); gone('a');
    await vi.advanceTimersByTimeAsync(5);
    expect(asked).toEqual([]);
  });
  it('a tab in a container only counts with the tabs of that container', async () => {
    tabs.find(t => t.id === 'a').partition = 'persist:container-work';
    closeEvent('a'); gone('a');
    await vi.advanceTimersByTimeAsync(5);
    expect(asked.length).toBe(1);   // 'b' is in the main session: the container’s copy of the site had no other tab
    expect(asked[0].partition).toBe('persist:container-work');
  });
  it('a refusal from main is reported and shown, not swallowed', async () => {
    window.vex.siteForget = vi.fn(async () => ({ ok: false, error: 'disk busy' }));
    window.VexProblems = { note: vi.fn() };
    closeEvent('a'); gone('a'); await vi.advanceTimersByTimeAsync(5); closeEvent('b'); gone('b');
    await vi.advanceTimersByTimeAsync(5);
    expect(window.VexProblems.note).toHaveBeenCalled();
    expect(window.showToast).toHaveBeenCalledWith('disk busy', 'error');
    delete window.VexProblems;
  });
  it('stays quiet when main skipped it (another window still has the site open)', async () => {
    window.vex.siteForget = vi.fn(async () => ({ ok: true, skipped: 'open' }));
    closeEvent('a'); gone('a'); await vi.advanceTimersByTimeAsync(5); closeEvent('b'); gone('b');
    await vi.advanceTimersByTimeAsync(5);
    expect(window.showToast).not.toHaveBeenCalled();
  });
});

describe('the setting', () => {
  it('is saved per site, and refused for a protected one with the reason', async () => {
    await S.setField('https://exam.example/', 'forget', true);
    expect(S.forgetOn('https://www.exam.example/x')).toBe(true);
    await expect(S.setField('https://www.netflix.com/', 'forget', true)).rejects.toThrow(/video, music or chat/);
    await S.setField('https://exam.example/', 'forget', false);
    expect(S.forgetOn('https://exam.example/')).toBe(false);
    expect(S.rules()['exam.example']).toBeUndefined();   // nothing set: no entry
  });
  it('the window’s list of protected sites is main’s list', () => {
    expect(S.FORGET_PROTECTED).toEqual(require('../../src/main/site-rules.js').FORGET_PROTECTED);
  });
  it('is listed in Settings › Site settings and says what it does in the site panel', () => {
    const profiles = require('fs').readFileSync('src/renderer/js/site-profiles.js', 'utf8');
    expect(profiles).toMatch(/rule\.forget === true\) opts\.push\('forgotten when closed'\)/);
    const panel = require('fs').readFileSync('src/renderer/js/site-panel.js', 'utf8');
    expect(panel).toMatch(/This signs you out of it each time/);
    expect(panel).toMatch(/Other tabs of \{1\} that are open stay as they are until the last one is closed/);
  });
});
