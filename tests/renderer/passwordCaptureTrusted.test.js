// @vitest-environment jsdom
// Password capture (preload-webview.js, "Password capture"):
//  - a page's own script could dispatch a fake submit / Enter / click and pop
//    Vex's save card whenever it liked (no isTrusted check);
//  - a two-step login (email on one page, password on the next) was never
//    offered for saving: the password page has no username field.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { PasswordVault } from '../../src/renderer/js/passwords.js';

const SRC = fs.readFileSync(path.join(__dirname, '../../src/preload-webview.js'), 'utf8').replace(/\r\n/g, '\n');
const SECTION = SRC.slice(SRC.indexOf('// === Password capture'), SRC.indexOf('// === Saved-login fill'));

// Runs the page side with a document whose listeners the test calls directly,
// so it can hand them a trusted or an untrusted event.
function pageSide(url, activation = { isActive: true }) {
  const sent = [];
  const handlers = {};
  const doc = {
    addEventListener: (name, fn) => { (handlers[name] = handlers[name] || []).push(fn); },
    querySelectorAll: (s) => document.querySelectorAll(s),
  };
  const ipcRenderer = { sendToHost: (channel, payload) => sent.push({ channel, payload }) };
  new Function('require', 'location', 'document', 'navigator', SECTION)(() => ({ ipcRenderer }), new URL(url), doc, { userActivation: activation });
  const fire = (name, event) => { for (const fn of handlers[name] || []) fn(event); };
  return { sent, fire };
}

describe('page side', () => {
  beforeEach(() => { vi.useFakeTimers(); document.body.innerHTML = ''; });

  it('ignores a submit, Enter or click the page made up itself', () => {
    document.body.innerHTML = '<form><input name="email" value="me@acct.example"><input type="password" value="hunter22"><button type="submit">Sign in</button></form>';
    const { sent, fire } = pageSide('https://acct.example/login');
    const input = document.querySelector('input');
    fire('submit', { isTrusted: false, target: document.querySelector('form') });
    fire('keydown', { isTrusted: false, key: 'Enter', target: input });
    fire('click', { isTrusted: false, target: document.querySelector('button') });
    vi.advanceTimersByTime(500);
    expect(sent.filter(m => m.channel === 'vex-cred-submit')).toEqual([]);
    fire('submit', { isTrusted: true, target: document.querySelector('form') });
    expect(sent.filter(m => m.channel === 'vex-cred-submit')).toEqual([
      { channel: 'vex-cred-submit', payload: { host: 'acct.example', username: 'me@acct.example', password: 'hunter22' } },
    ]);
  });

  it('ignores a trusted submit the page started itself, with no click or key press just before', () => {
    document.body.innerHTML = '<form><input name="email" value="me@acct.example"><input type="password" value="hunter22"></form>';
    const activation = { isActive: false };
    const { sent, fire } = pageSide('https://acct.example/login', activation);
    fire('submit', { isTrusted: true, target: document.querySelector('form') });   // form.requestSubmit()
    expect(sent.some(m => m.channel === 'vex-cred-submit')).toBe(false);
    activation.isActive = true;                                                  // the person just clicked
    fire('submit', { isTrusted: true, target: document.querySelector('form') });
    expect(sent.some(m => m.channel === 'vex-cred-submit')).toBe(true);
  });

  it('sends the first step\'s username, and the password step with no username', () => {
    document.body.innerHTML = '<input type="email" id="e">';
    const step1 = pageSide('https://acct.example/signin');
    const email = document.getElementById('e');
    email.value = 'me@acct.example';
    step1.fire('input', { target: email });
    step1.fire('keydown', { isTrusted: true, key: 'Enter', target: email });
    expect(step1.sent).toContainEqual({ channel: 'vex-login-user', payload: { host: 'acct.example', username: 'me@acct.example' } });
    expect(step1.sent.some(m => m.channel === 'vex-cred-submit')).toBe(false);

    // The next page: only a password field.
    document.body.innerHTML = '<input type="password" id="p">';
    const step2 = pageSide('https://acct.example/signin/pwd');
    const pw = document.getElementById('p');
    pw.value = 'correct horse';
    step2.fire('keydown', { isTrusted: true, key: 'Enter', target: pw });
    expect(step2.sent).toContainEqual({ channel: 'vex-cred-submit', payload: { host: 'acct.example', username: '', password: 'correct horse' } });
  });
});

describe('host side', () => {
  function fakeWebview(url) {
    const listeners = {};
    return {
      getURL: () => url,
      addEventListener: (name, fn) => { (listeners[name] = listeners[name] || []).push(fn); },
      emit: async (name, event) => { for (const fn of listeners[name] || []) await fn(event); },
    };
  }
  const say = (wv, channel, payload) => wv.emit('ipc-message', { channel, args: [payload] });

  beforeEach(() => {
    vi.useRealTimers();
    localStorage.clear();
    document.body.innerHTML = '';
    window.escapeHtml = (v) => String(v == null ? '' : v);
    window.showToast = vi.fn();
    delete window.VexTabPolicy;
    window.vex = { vaultGet: vi.fn(async () => []), vaultSave: vi.fn(async () => ({ ok: true })) };
  });

  it('offers to save a two-step login with the first step\'s username', async () => {
    const wv = fakeWebview('https://www.acct.example/signin/pwd');
    PasswordVault.attach(wv);
    await say(wv, 'vex-login-user', { host: 'acct.example', username: 'me@acct.example' });
    await say(wv, 'vex-cred-submit', { host: 'acct.example', username: '', password: 'correct horse' });
    const card = document.getElementById('vex-pw-offer');
    expect(card).not.toBeNull();
    expect(card.textContent).toMatch(/me@acct\.example on acct\.example/);
    card.querySelector('[data-save]').click();
    await Promise.resolve();
    expect(window.vex.vaultSave).toHaveBeenCalledWith({ host: 'acct.example', username: 'me@acct.example', password: 'correct horse' });
  });

  it('never pairs a username from another site', async () => {
    const wv = fakeWebview('https://acct.example/signin/pwd');
    PasswordVault.attach(wv);
    await say(wv, 'vex-login-user', { host: 'other.example', username: 'me@other.example' });
    await say(wv, 'vex-cred-submit', { host: 'acct.example', username: '', password: 'correct horse' });
    expect(document.getElementById('vex-pw-offer')).toBeNull();
  });
});
