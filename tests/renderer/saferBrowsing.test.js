// @vitest-environment jsdom
// Wave 3 security (renderer): sensitive pages, cookie-banner rejecting (T3-077), marketplace signs (T3-098),
// QR verdict (T3-101), vault hygiene (T3-088), chat links (T3-100/102), screen-share safe mode (T3-114).
import { describe, it, expect, beforeEach, vi } from 'vitest';

const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<div id="webviews-container"></div><div id="tabs-list"></div>';
  document.documentElement.className = '';
  globalThis.VexSensitive = fresh(JS + 'sensitive-pages.js').VexSensitive;
});

describe('sensitive pages', () => {
  it('knows banks, sign-in pages, accounts and chats', () => {
    const k = (u) => VexSensitive.kind(u);
    expect(k('https://www.garanti.com.tr/')).toBe('money');
    expect(k('https://online.mybank.example/')).toBe('money');
    expect(k('https://accounts.google.com/signin')).toBe('account');
    expect(k('https://shop.example.org/login')).toBe('signin');
    expect(k('https://login.example.org/')).toBe('signin');
    expect(k('https://discord.com/channels/1')).toBe('chat');
    expect(k('https://news.example.org/story')).toBe('');
    expect(VexSensitive.isSensitiveUrl('https://discord.com/')).toBe(false);
    expect(VexSensitive.hidesTitle('https://discord.com/')).toBe(true);
  });
});

describe('cookie-banner rejecting (T3-077)', () => {
  let ConsentBlock;
  beforeEach(() => { ConsentBlock = fresh(JS + 'page-extras.js').ConsentBlock; globalThis.ConsentBlock = ConsentBlock; });
  const wv = (url) => ({ getURL: () => url, executeJavaScript: vi.fn(() => Promise.resolve()) });

  it('leaves a bank, a sign-in page and a site switched off alone', () => {
    for (const url of ['https://www.garanti.com.tr/', 'https://shop.example.org/login', 'file:///x.html']) {
      const w = wv(url); ConsentBlock.applyTo(w);
      expect(w.executeJavaScript.mock.calls.every(c => !/var sel=/.test(c[0]))).toBe(true);   // the banner script was not injected
      expect(ConsentBlock.skipReason(url)).not.toBe('');
    }
    ConsentBlock.setSiteOff('news.example.org', true);
    expect(ConsentBlock.skipReason('https://news.example.org/a')).toBe('site-off');
    expect(ConsentBlock.skipReason('https://other.example.org/a')).toBe('');
    ConsentBlock.setSiteOff('news.example.org', false);
    expect(ConsentBlock.skipReason('https://news.example.org/a')).toBe('');
  });
  it('injects a script that parses, never clicks on a password page, and knows more banners', () => {
    const w = wv('https://news.example.org/a');
    ConsentBlock.applyTo(w);
    const js = w.executeJavaScript.mock.calls[0][0];
    expect(() => new Function(js)).not.toThrow();
    expect(js).toContain('input[type="password"]');
    for (const sel of ['.iubenda-cs-reject-btn', '.cky-btn-reject', '.cmplz-deny', '#onetrust-reject-all-handler']) expect(js).toContain(sel);
    expect(js).not.toMatch(/accept-all|acceptAll|Allow all/i);
  });
  it('counts a week and keeps 30 days', () => {
    const now = Date.parse('2026-10-16T12:00:00Z');
    ConsentBlock._note(now); ConsentBlock._note(now);
    ConsentBlock._note(now - 3 * 86400000);
    ConsentBlock._note(now - 40 * 86400000);
    expect(ConsentBlock.weekCount(now)).toBe(3);
    expect(ConsentBlock.counts().total).toBe(4);
    ConsentBlock._note(now);
    expect(Object.keys(ConsentBlock.counts().days)).not.toContain('2026-09-06');
  });
});

describe('marketplace signs (T3-098)', () => {
  let M;
  beforeEach(() => { M = fresh(JS + 'marketplace-signs.js').VexMarketplaceSigns; });
  it('parses Turkish and English prices', () => {
    expect(M.parseNumber('1.250,50')).toBe(1250.5);
    expect(M.parseNumber('1,250.50')).toBe(1250.5);
    expect(M.parseNumber('1.250')).toBe(1250);
    expect(M.parseNumber('12,5')).toBe(12.5);
    expect(M.prices('Fiyat: 150 TL ve ₺2.000 ve $9.99').map(p => p.n)).toEqual([150, 2000, 9.99]);
  });
  it('sees the five signs, and says nothing on an ordinary listing', () => {
    const bad = 'Hesap 100 TL. Benzer ilanlar: 900 TL, 1.000 TL, 950 TL, 1.100 TL, 1.050 TL. Sadece IBAN ile havale. TR12 0001 0002 0003 0004 0005 06. WhatsApp: +90 532 111 22 33. Yeni üye, 0 satış. Acil, sadece bugün!';
    const seen = M.analyze(bad).filter(s => s.seen).map(s => s.id);
    expect(seen).toEqual(['price', 'iban', 'off-site', 'new', 'hurry']);
    const fine = 'Hesap 900 TL. Benzer: 900 TL, 1.000 TL, 950 TL, 1.100 TL, 1.050 TL. Güvenli ödeme ile satın al. 120 satış.';
    expect(M.analyze(fine).filter(s => s.seen)).toEqual([]);
    expect(M.analyze(bad).every(s => typeof s.why === 'string' && s.why)).toBe(true);
  });
  it('a recent member-since date is a new account', () => {
    const now = Date.parse('2026-10-16T00:00:00Z');
    expect(M.analyze('Üyelik tarihi: 10.10.2026', now).find(s => s.id === 'new').seen).toBe(true);
    expect(M.analyze('Üyelik tarihi: 10.10.2020', now).find(s => s.id === 'new').seen).toBe(false);
  });
  it('only a listed site counts, and the list is the person\'s', () => {
    expect(M.listed('https://www.itemsatis.com/ilan/1')).toBe('itemsatis.com');
    expect(M.listed('https://example.org/')).toBe('');
    M.addHost('https://Trade.example.org/x'); expect(M.listed('https://trade.example.org/y')).toBe('trade.example.org');
    M.removeHost('itemsatis.com'); expect(M.listed('https://itemsatis.com/')).toBe('');
    expect(() => M.addHost('nonsense')).toThrow();
  });
});

describe('QR verdict (T3-101)', () => {
  let Q;
  beforeEach(() => { Q = fresh(JS + 'qr-verdict.js').VexQrVerdict; });
  it('says what a code holds and never shows a 2FA secret', () => {
    expect(Q.classify('https://example.org/a').type).toBe('url');
    const otp = Q.classify('otpauth://totp/x?secret=ABCDEF');
    expect(otp).toEqual({ type: 'otp', text: '' });
    expect(Q.classify('otpauth-migration://offline?data=zz').type).toBe('otp');
    expect(Q.classify('WIFI:S:Home;T:WPA;P:hunter2;;').text).not.toContain('hunter2');
    expect(Q.classify('www.example.org/x').url).toBe('https://www.example.org/x');
    expect(Q.classify('hello').type).toBe('text');
    expect(() => Q.classify('  ')).toThrow();
  });
  it('judges an address with the web-safety verdict and the usual signs', () => {
    const v = Q.verdict('https://bit.ly/abc', { visits: 0 });
    expect(v.level).toBe('medium');
    expect(v.signs.map(s => s.level)).toContain('low');
    const bad = Q.verdict('http://203.0.113.9/x', {});
    expect(bad.level).toBe('high');
    const flagged = Q.verdict('https://paypa1.com/', { webCheck: { flagged: true, line: 'looks like paypal.com', reasons: ['letters swapped'] } });
    expect(flagged.level).toBe('high');
    expect(flagged.headline).toMatch(/Do not open/);
    expect(Q.verdict('https://example.org/', { visits: 4 }).level).toBe('none');
  });
  it('never opens by itself', async () => {
    globalThis.TabManager = { createTab: vi.fn() };
    const out = document.createElement('div');
    window.VexSettingsGroups = fresh(JS + 'vex-settings-groups.js').VexSettingsGroups;
    Q._render(out, { held: { type: 'url', url: 'https://example.org/' }, verdict: Q.verdict('https://example.org/', { visits: 3 }) }, () => {});
    expect(TabManager.createTab).not.toHaveBeenCalled();
    const open = [...out.querySelectorAll('button')].find(b => b.textContent === 'Open it');
    open.click();
    await Promise.resolve(); await Promise.resolve();   // the button runs its action on a microtask
    expect(TabManager.createTab).toHaveBeenCalledTimes(1);
  });
});

describe('vault hygiene (T3-088)', () => {
  let V;
  beforeEach(() => { V = fresh(JS + 'vault-hygiene.js').VexVaultHygiene; });
  const health = {
    total: 5,
    reused: [{ count: 3, entries: [{ host: 'a.com', username: 'u' }, { host: 'b.com', username: 'u' }, { host: 'c.com', username: 'u' }] }],
    weak: [{ host: 'd.com', username: 'u', reasons: ['too short'] }],
    old: [{ host: 'e.com', username: 'u', days: 900 }],
    ages: [{ host: 'a.com', username: 'u', days: 10 }, { host: 'e.com', username: 'u', days: 900 }, { host: 'x.com', username: 'u', days: null }],
  };
  it('picks at most three, reused first, and explains the blast radius', () => {
    const v = V.build({ health, logins: [{ host: 'a.com' }, { host: 'b.com' }, { host: 'e.com' }], totp: [{ issuer: 'A' }] });
    expect(v.rotate).toHaveLength(3);
    expect(v.rotate.slice(0, 3).every(r => ['a.com', 'b.com', 'c.com'].includes(r.host))).toBe(true);
    expect(v.clusters[0].blast).toMatch(/If the password for a\.com leaks, b\.com, c\.com open too \(2 of 3 without 2FA\)/);
    expect(v.coverage.find(c => c.host === 'a.com').has2fa).toBe(true);
    expect(v.buckets.find(b => b.label === 'Over 2 years').count).toBe(1);
    expect(v.unknownAge).toBe(1);
  });
  it('is empty, and so silent, for a clean vault', () => {
    expect(V.build({ health: { total: 2, reused: [], weak: [], old: [], ages: [] }, logins: [], totp: [] }).rotate).toEqual([]);
  });
  it('offers one quiet line a week, only when there is something', async () => {
    window.vex = { vaultHealth: async () => health, vaultList: async () => [], totpList: async () => [] };
    globalThis.VexAttention = { suggest: vi.fn(() => true) };
    const now = new Date('2026-10-16T10:00:00');
    expect(await V.maybeSuggest(now)).toBe(true);
    expect(VexAttention.suggest).toHaveBeenCalledWith(expect.objectContaining({ feature: 'vault-hygiene' }));
    expect(await V.maybeSuggest(now)).toBe(false);
    expect(VexAttention.suggest).toHaveBeenCalledTimes(1);
    expect(V.weekId(now)).toBe('2026-W42');
  });
  it('never sees a password', () => {
    expect(JSON.stringify(V.build({ health, logins: [], totp: [] }))).not.toMatch(/password"/);
  });
});

describe('chat links (T3-100, T3-102)', () => {
  let L;
  beforeEach(() => {
    globalThis.HistoryPanel = { list: () => [{ url: 'https://www.known.example.org/a' }] };
    L = fresh(JS + 'chat-links.js').VexChatLinks;
  });
  it('flags a never-visited site from a chat, not a visited one or an ordinary link', () => {
    expect(L.plan({ url: 'https://fresh.example.xyz/', fromChat: 'Discord' })).toMatchObject({ newDomain: true, throwaway: false, realHost: 'fresh.example.xyz' });
    expect(L.plan({ url: 'https://shop.known.example.org/', fromChat: 'Discord' })).toBe(null);
    expect(L.plan({ url: 'https://fresh.example.xyz/' })).toBe(null);
    L.addQuiet('fresh.example.xyz');
    expect(L.plan({ url: 'https://fresh.example.xyz/', fromChat: 'Discord' })).toBe(null);
  });
  it('the throwaway session is off until chosen, then only for unknown sites unless told otherwise', () => {
    expect(L.throwEnabled()).toBe(false);
    L.setThrowEnabled(true);
    const p = L.plan({ url: 'https://fresh.example.xyz/', fromChat: 'Discord' });
    expect(p.throwaway).toBe(true);
    expect(p.partition).toMatch(/^otr-chat-/);
    expect(L.plan({ url: 'https://shop.known.example.org/', fromChat: 'Discord' })).toBe(null);
    L.setThrowMode('all');
    expect(L.plan({ url: 'https://shop.known.example.org/', fromChat: 'Discord' }).throwaway).toBe(true);
    expect(L.plan({ url: 'https://fresh.example.xyz/', fromChat: 'Discord', partition: 'persist:container-work' }).throwaway).toBe(false);
    expect(() => L.setThrowMode('some')).toThrow();
  });
  it('unwraps a wrapper link to judge where it really goes', () => {
    globalThis.LinkSafety = fresh(JS + 'link-safety.js').LinkSafety;
    const p = L.plan({ url: 'https://l.facebook.com/l.php?u=' + encodeURIComponent('https://fresh.example.xyz/p'), fromChat: 'Messenger' });
    expect(p.wrapped).toBe(true);
    expect(p.realHost).toBe('fresh.example.xyz');
    delete globalThis.LinkSafety;
  });
});

describe('screen-share safe mode (T3-114)', () => {
  let S;
  beforeEach(() => {
    globalThis.TabManager = { tabs: [{ id: 't1', url: 'https://www.garanti.com.tr/' }, { id: 't2', url: 'https://news.example.org/' }] };
    document.getElementById('tabs-list').innerHTML = '<div class="tab-item" data-tab-id="t1"><div class="tab-title">Bank</div></div><div class="tab-item" data-tab-id="t2"><div class="tab-title">News</div></div>';
    globalThis.AttentionState = { changed: vi.fn() };
    globalThis.VexLedger = { record: vi.fn(), registerUndo: vi.fn() };
    S = fresh(JS + 'screen-share-safe.js').VexScreenShareSafe;
    S._sharers = new Set(); S._paused = false; S._on = false;
  });
  it('starts and ends with the share, blurs only private titles, and holds notices through the attention state', () => {
    expect(S.onCapture({ where: 'tab', id: 'x', kind: 'screen', active: true })).toBe(true);
    expect(S.active()).toBe(true);
    expect(document.documentElement.classList.contains('vex-sharing')).toBe(true);
    expect(document.querySelector('[data-tab-id="t1"]').dataset.shareHidden).toBe('1');
    expect(document.querySelector('[data-tab-id="t2"]').dataset.shareHidden).toBeUndefined();
    expect(AttentionState.changed).toHaveBeenCalled();
    expect(VexLedger.record).toHaveBeenCalledWith(expect.objectContaining({ feature: 'screen-share-safe', undo: { kind: 'share-safe-off' } }));
    S.onCapture({ where: 'tab', id: 'x', kind: 'screen', active: false });
    expect(S.active()).toBe(false);
    expect(document.documentElement.classList.contains('vex-sharing')).toBe(false);
    expect(document.querySelector('[data-share-hidden]')).toBe(null);
  });
  it('ignores the camera, the microphone and Vex\'s own recorder', () => {
    expect(S.onCapture({ where: 'tab', id: 'x', kind: 'camera', active: true })).toBe(false);
    expect(S.onCapture({ where: 'vex', kind: 'screen', active: true })).toBe(false);
    expect(S.active()).toBe(false);
  });
  it('can be paused for one share, and switched off', () => {
    S.onCapture({ where: 'panel', id: 'discord', kind: 'screen', active: true });
    S.pauseForThisShare();
    expect(S.active()).toBe(false);
    S.onCapture({ where: 'panel', id: 'discord', kind: 'screen', active: false });
    S.onCapture({ where: 'panel', id: 'discord', kind: 'screen', active: true });
    expect(S.active()).toBe(true);
    S.setEnabled(false);
    expect(S.active()).toBe(false);
  });
  it('feeds the attention state as a source', () => {
    const AS = fresh(JS + 'attention-state.js').AttentionState;
    globalThis.VexScreenShareSafe = S;
    S.onCapture({ where: 'tab', id: 'x', kind: 'screen', active: true });
    expect(AS.get().reason).toBe('sharing');
    delete globalThis.VexScreenShareSafe;
  });
});
