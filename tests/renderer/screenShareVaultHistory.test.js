// @vitest-environment jsdom
//
// T3-114, the missing parts: while the screen is shared, the vault's sign-in offers and the
// New Tab "Recent" (history) list are held back too.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import G from '../../src/renderer/js/password-gen.js';
import { PasswordVault } from '../../src/renderer/js/passwords.js';
import { VexToday } from '../../src/renderer/js/today.js';

const JS = path.resolve(__dirname, '../../src/renderer/js');
const fresh = (rel) => { const p = path.join(JS, rel); delete require.cache[require.resolve(p)]; return require(p); };

function fakeWebview(url) {
  const listeners = {};
  return {
    sent: [],
    _navigationGeneration: 1,
    getURL: () => url,
    getAttribute: (n) => (n === 'partition' ? 'persist:main' : null),
    addEventListener: (name, fn) => { (listeners[name] = listeners[name] || []).push(fn); },
    send(channel, payload) { this.sent.push({ channel, payload }); },
    emit: async (name, event) => { for (const fn of listeners[name] || []) await fn(event); },
  };
}
const say = (wv, channel, payload) => wv.emit('ipc-message', { channel, args: [payload] });

let S;
beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<div id="tabs-list"></div>';
  document.documentElement.className = '';
  window.escapeHtml = (v) => String(v == null ? '' : v);
  window.showToast = vi.fn();
  window.VexPasswordGen = G;
  window.VexTabPolicy = { canFillWebview: () => true };
  window.vex = { vaultGet: vi.fn(async () => [{ username: 'ann', password: 'p' }]), vaultSave: vi.fn(async () => ({ ok: true })), reminders: { list: async () => [] } };
  globalThis.TabManager = { tabs: [] };
  globalThis.AttentionState = { changed: vi.fn() };
  globalThis.VexLedger = { record: vi.fn(), registerUndo: vi.fn() };
  globalThis.VexScreenShareSafe = window.VexScreenShareSafe = S = fresh('screen-share-safe.js').VexScreenShareSafe;
  S._sharers = new Set(); S._paused = false; S._on = false; S._held = 0;
  delete globalThis.VexToday;
});

const share = (on) => S.onCapture({ where: 'tab', id: 'x', kind: 'screen', active: on });

describe('sign-in offers while sharing', () => {
  async function armed() {
    const wv = fakeWebview('https://example.com/login');
    PasswordVault.attach(wv);
    wv._vexLoginArm = { host: 'example.com', origin: 'https://example.com' };
    return wv;
  }

  it('fills on a click as usual when no share is on', async () => {
    const wv = await armed();
    await say(wv, 'vex-login-want', { id: 'w1', host: 'example.com', origin: 'https://example.com' });
    expect(wv.sent.map(s => s.channel)).toContain('vex-login-fill');
  });

  it('holds the fill, counts it on the pill, and works again after the share ends', async () => {
    const wv = await armed();
    share(true);
    await say(wv, 'vex-login-want', { id: 'w2', host: 'example.com', origin: 'https://example.com' });
    expect(wv.sent).toEqual([]);
    expect(window.vex.vaultGet).not.toHaveBeenCalled();
    expect(S._held).toBe(1);
    expect(document.getElementById('share-safe-pill-text').textContent).toContain('sign-in offers held (1)');
    share(false);
    await say(wv, 'vex-login-want', { id: 'w3', host: 'example.com', origin: 'https://example.com' });
    expect(wv.sent.map(s => s.channel)).toContain('vex-login-fill');
  });

  it('holds the strong-password card and the remembered-email fill', async () => {
    const wv = await armed();
    share(true);
    await say(wv, 'vex-pwgen-ask', { id: 'g1', host: 'example.com', maxLength: 64, minLength: 8 });
    expect(wv.sent).toEqual([]);
    window.vex.vaultGet = vi.fn(async () => []);
    await PasswordVault.autofill(wv, 'https://example.com/login');
    expect(S._held).toBe(2);
  });

  it('can be left off with its own switch, and "Off for this share" lets offers through', async () => {
    const wv = await armed();
    S.setVault(false);
    share(true);
    await say(wv, 'vex-login-want', { id: 'w4', host: 'example.com', origin: 'https://example.com' });
    expect(wv.sent.map(s => s.channel)).toContain('vex-login-fill');
    S.setVault(true);
    wv.sent.length = 0;
    S.pauseForThisShare();
    await say(wv, 'vex-login-want', { id: 'w5', host: 'example.com', origin: 'https://example.com' });
    expect(wv.sent.map(s => s.channel)).toContain('vex-login-fill');
  });
});

describe('the New Tab Recent list while sharing', () => {
  beforeEach(() => {
    globalThis.HistoryPanel = { list: () => [{ url: 'https://secret.example/a', title: 'A' }, { url: 'https://secret.example/b', title: 'B' }] };
    globalThis.VexToday = window.VexToday = VexToday;
  });

  it('is in the data normally, and absent (with a flag for the page) while sharing', async () => {
    const normal = await VexToday.build();
    expect(normal.recent).toHaveLength(2);
    expect(normal.hideRecent).toBeUndefined();
    share(true);
    const held = await VexToday.build();
    expect(held.recent).toEqual([]);
    expect(held.hideRecent).toBe(true);
    S.setHistory(false);
    expect((await VexToday.build()).recent).toHaveLength(2);
  });

  it('the New Tab data is rebuilt when a share starts and ends', async () => {
    const refresh = vi.spyOn(VexToday, 'refresh').mockResolvedValue({});
    share(true);
    share(false);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('a failed rebuild is reported, not hidden', async () => {
    window.VexProblems = { note: vi.fn() };
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(VexToday, 'refresh').mockRejectedValue(new Error('boom'));
    share(true);
    await new Promise(r => setTimeout(r, 0));
    expect(window.VexProblems.note).toHaveBeenCalledWith('Screen-share safe mode', expect.any(String), expect.any(Error));
    err.mockRestore();
  });

  it('the start page empties and hides its list when told to', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../src/renderer/start.html'), 'utf8');
    expect(src).toMatch(/snap\.hideRecent === true/);
    expect(src).toMatch(/recentSec\.style\.display = snap\.hideRecent === true \? 'none' : ''/);
    expect(src).toMatch(/recentList\.innerHTML = ''/);
  });
});
