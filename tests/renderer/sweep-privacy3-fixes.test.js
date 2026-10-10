// @vitest-environment jsdom
//
// Privacy fixes from the 2026-09-29 sweep, second pass: per-site switches in
// a private window, autofill that fought the person typing, Clear History
// leaving the closed-tab list behind, and the wrong-PIN wait that a restart
// used to reset.
import vm from 'node:vm';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

require('../../src/renderer/js/vex-icons.js');
globalThis.VexIcons = window.VexIcons;

const tick = () => new Promise(r => setTimeout(r, 0));

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  window.showToast = vi.fn();
  window.escapeHtml = (s) => String(s == null ? '' : s);
  delete window.VexTabPolicy;
  window.vex = {};
});

describe('per-site switches in a private window', () => {
  const { SiteRulesUI: S } = require('../../src/renderer/js/site-rules-ui.js');
  afterEach(() => { S._mirror = null; });

  it('reads the rules main keeps, so JavaScript-off holds in a private tab', async () => {
    window.VexTabPolicy = { isPrivateWindow: true };
    window.vex = { siteRulesGet: vi.fn(async () => ({ ok: true, rules: { 'example.com': { js: 'off', thirdParty: 'off' } } })) };
    expect(S.scriptsOff('https://example.com/')).toBe(false);   // its own storage is empty
    await S.loadMirror();
    expect(S.scriptsOff('https://www.example.com/page')).toBe(true);
    expect(S.isOff('https://example.com/', 'thirdParty')).toBe(true);
    expect(S.scriptsOff('https://other.example/')).toBe(false);
  });

  it('says so when the rules cannot be read', async () => {
    window.VexTabPolicy = { isPrivateWindow: true };
    window.vex = { siteRulesGet: vi.fn(async () => ({ ok: false, error: 'no main' })) };
    await expect(S.loadMirror()).rejects.toThrow('no main');
  });

  it('will not change a switch from a private window, and pushes nothing', async () => {
    window.VexTabPolicy = { isPrivateWindow: true };
    window.vex = { siteRulesSet: vi.fn(async () => ({ ok: true, rules: {} })) };
    await expect(S.set('https://example.com/', 'js', true)).rejects.toThrow(/normal window/);
    expect(window.vex.siteRulesSet).not.toHaveBeenCalled();
  });

  it('a normal window still uses its own stored rules', async () => {
    localStorage.setItem(S.KEY, JSON.stringify({ 'example.com': { cookies: 'off' } }));
    expect(S.isOff('https://example.com/', 'cookies')).toBe(true);
  });
});

describe('autofill leaves a login alone once the person types', () => {
  const { PasswordVault } = require('../../src/renderer/js/passwords.js');
  beforeEach(() => {
    vi.useFakeTimers();
    delete window.__vexPwFocusWired; delete window.__vexEmailFocusWired;
    delete window.__vexLoginTypedWired; delete window.__vexLoginTyped;
  });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
  function page(html, href = 'https://accounts.example.test/login') {
    document.body.innerHTML = html;
    const location = { href, get origin() { return new URL(this.href).origin; } };
    for (const input of document.querySelectorAll('input')) input.getBoundingClientRect = () => ({ width: 100, height: 20 });
    return { location, webview: { getURL: () => location.href, executeJavaScript: vi.fn(async script => vm.runInNewContext(script, { document, window, location, URL, Event, getComputedStyle, setTimeout, clearTimeout })) } };
  }
  // jsdom marks every dispatched event untrusted; a real key press is trusted.
  const typed = (el, value) => {
    el.value = value;
    const e = new Event('input', { bubbles: true });
    // dispatchEvent() always marks an event untrusted, so it goes through
    // jsdom's internal dispatch with the flag set, as a key press would.
    const inner = (o) => o[Object.getOwnPropertySymbols(o).find(k => String(k) === 'Symbol(impl)')];
    inner(e).isTrusted = true;
    inner(el)._dispatch(inner(e));
    expect(e.isTrusted).toBe(true);
  };

  it('does not refill a field the person cleared, or move the cursor', async () => {
    window.vex = { vaultGet: async () => [{ username: 'saved@example.test', password: 'Saved-Pass-1' }] };
    const { webview, location } = page('<input type="email" id="email"><input type="password" id="pw"><button id="other">x</button>');
    await PasswordVault.autofill(webview, location.href);
    const email = document.getElementById('email'), pw = document.getElementById('pw');
    expect(email.value).toBe('saved@example.test');
    expect(document.activeElement).not.toBe(email);            // an automatic fill takes no focus
    typed(pw, ''); typed(email, '');
    pw.focus(); pw.dispatchEvent(new Event('focusin', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(10);
    expect(email.value).toBe('');
    expect(pw.value).toBe('');
    expect(document.activeElement).toBe(pw);
    typed(email, 'other@example.test');
    email.dispatchEvent(new Event('focusin', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(10);
    expect(email.value).toBe('other@example.test');
    expect(pw.value).toBe('');
  });

  it('still fills a password step the person has not touched', async () => {
    window.vex = { vaultGet: async () => [{ username: 'saved@example.test', password: 'Saved-Pass-1' }] };
    const { webview, location } = page('<input type="email" id="email">');
    await PasswordVault.autofill(webview, location.href);
    document.body.insertAdjacentHTML('beforeend', '<input type="password" id="pw">');
    const pw = document.getElementById('pw');
    pw.getBoundingClientRect = () => ({ width: 100, height: 20 });
    pw.dispatchEvent(new Event('focusin', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(10);
    expect(pw.value).toBe('Saved-Pass-1');
  });

  it('the remembered-email fill stops too once the person types', async () => {
    const { webview, location } = page('<input type="email" id="email">');
    PasswordVault._rememberedEmail = () => 'me@example.test';
    PasswordVault._autofillEmailOnly(webview, 'accounts.example.test', location.href);
    await vi.advanceTimersByTimeAsync(0);
    const email = document.getElementById('email');
    expect(email.value).toBe('me@example.test');
    typed(email, '');
    email.dispatchEvent(new Event('focusin', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(10);
    expect(email.value).toBe('');
  });
});

describe('Clear History clears the closed-tab list and the backups', () => {
  const MODULE = '../../src/renderer/js/history-panel.js';
  const load = () => { vi.resetModules(); delete require.cache[require.resolve(MODULE)]; return require(MODULE).HistoryPanel; };

  it('removes vex.recentlyClosed and asks main to erase the backup copies, last', async () => {
    const calls = [];
    localStorage.setItem('vex.history', JSON.stringify([{ id: 'a', url: 'https://secret.example/', visitedAt: new Date().toISOString() }]));
    localStorage.setItem('vex.recentlyClosed', JSON.stringify([{ url: 'https://secret.example/closed' }]));
    globalThis.VexStorage = { save: vi.fn(async () => { calls.push('save'); return true; }) };
    globalThis.vexConfirm = vi.fn(async () => true);
    window.vex = {
      recallClear: vi.fn(async () => { calls.push('recall'); return { ok: true }; }),
      clearHistory: vi.fn(async () => { calls.push('clearHistory'); return true; }),
    };
    document.body.innerHTML = '<div id="panel-history"></div>';
    const H = load();
    H.init();
    document.getElementById('history-clear-btn').click();
    for (let i = 0; i < 5; i++) await tick();
    expect(localStorage.getItem('vex.recentlyClosed')).toBe(null);
    expect(H.entries).toEqual([]);
    // No 'save' first: the file copy of history is gone (main/history-fold.js).
    expect(calls).toEqual(['recall', 'clearHistory']);
    expect(window.showToast).toHaveBeenLastCalledWith('History cleared');
    delete globalThis.VexStorage; delete globalThis.vexConfirm;
  });

  it('says so when main could not erase them', async () => {
    globalThis.VexStorage = { save: vi.fn(async () => true) };
    globalThis.vexConfirm = vi.fn(async () => true);
    window.vex = { recallClear: vi.fn(async () => ({ ok: true })), clearHistory: vi.fn(async () => { throw new Error('disk busy'); }) };
    document.body.innerHTML = '<div id="panel-history"></div>';
    const H = load();
    H.init();
    document.getElementById('history-clear-btn').click();
    for (let i = 0; i < 5; i++) await tick();
    expect(window.showToast).toHaveBeenLastCalledWith(expect.stringContaining('disk busy'), 'error');
    delete globalThis.VexStorage; delete globalThis.vexConfirm;
  });
});

describe('the wrong-PIN wait survives a restart', () => {
  const { VexLock: L } = require('../../src/renderer/js/vex-lock.js');
  beforeEach(() => { L.unlock(); L._waitUntil = 0; });

  it('keeps the wrong-try count and the wait in storage', () => {
    L._fails = 3;
    expect(localStorage.getItem(L.FAILS_KEY)).toBe('3');
    const until = Date.now() + 20000;
    L._waitUntil = until;
    expect(localStorage.getItem(L.WAIT_KEY)).toBe(String(until));
    // A restart: nothing in memory, only what was stored.
    expect(L._fails).toBe(3);
    expect(L._waitUntil).toBe(until);
    L.unlock();
    expect(localStorage.getItem(L.FAILS_KEY)).toBe(null);
  });

  it('a wait stored far ahead (a clock that jumped) is never longer than one wait', () => {
    localStorage.setItem(L.WAIT_KEY, String(Date.now() + 10 * 24 * 3600 * 1000));
    expect(L._waitUntil - Date.now()).toBeLessThanOrEqual(L.WAIT_MS);
  });

  it('a lock screen after a restart still turns tries away during the wait', async () => {
    await L.setPin('4821');
    localStorage.setItem(L.WAIT_KEY, String(Date.now() + 20000));
    L.lock();
    const form = document.querySelector('.vex-lock-screen form');
    form.querySelector('input').value = '4821';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await tick();
    expect(L.locked()).toBe(true);
    expect(document.querySelector('.vex-lock-msg').textContent).toMatch(/Too many tries — wait \d+ s/);
    L.unlock();
  });
});
