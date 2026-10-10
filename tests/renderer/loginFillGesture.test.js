// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://shop.example/login"}
// A saved login is filled only after a real click in a login field, from the
// guest preload's isolated world — never as the page loads, where any script
// on the page could read it (audit S5). Host side: js/passwords.js. Page side:
// preload-webview.js, "Saved-login fill". Both are wired together here the way
// <webview>.send / ipcRenderer.sendToHost connect them.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { PasswordVault } from '../../src/renderer/js/passwords.js';

const URL_ = 'https://shop.example/login';
const SRC = fs.readFileSync(path.join(__dirname, '../../src/preload-webview.js'), 'utf8').replace(/\r\n/g, '\n');
const SECTION = (() => {
  const start = SRC.indexOf('// === Saved-login fill');
  const end = SRC.indexOf('// === Suggest a strong password', start);
  return SRC.slice(start, end);
})();

// jsdom cannot make a trusted event; the "testable" copy also accepts a flag
// only this file sets. The guard itself is checked against the real source.
function runPage(url = URL_) {
  const sent = [];
  const handlers = {};
  const ipcRenderer = {
    sendToHost: (channel, payload) => sent.push({ channel, payload }),
    on: (channel, fn) => { handlers[channel] = fn; },
  };
  const code = SECTION.split('e.isTrusted').join('(e.isTrusted || e.vexTestTrusted)');
  // eslint-disable-next-line no-new-func
  new Function('require', 'location', code)(() => ({ ipcRenderer }), new URL(url));
  return { sent, handlers };
}
const trusted = (ev) => { ev.vexTestTrusted = true; return ev; };
const press = (el) => el.dispatchEvent(trusted(new Event('pointerdown', { bubbles: true })));

// A <webview> stand-in whose send() reaches the page side and whose
// ipc-message listeners hear the page side's sendToHost.
function connect(url = URL_) {
  const page = runPage(url);
  const listeners = {};
  const wv = {
    _navigationGeneration: 1,
    hostSent: [],
    getURL: () => url,
    getAttribute: () => 'persist:main',
    addEventListener: (name, fn) => { (listeners[name] = listeners[name] || []).push(fn); },
    // executeJavaScript(code) is the page's own main world.
    // eslint-disable-next-line no-eval
    executeJavaScript: vi.fn(async (js) => (0, eval)(js)),
    send(channel, payload) { this.hostSent.push({ channel, payload }); page.handlers[channel]?.({}, payload); },
  };
  PasswordVault.attach(wv);
  const flush = async () => {
    for (let i = 0; i < 20; i++) {
      const batch = page.sent.splice(0);
      for (const { channel, payload } of batch) for (const fn of listeners['ipc-message'] || []) await fn({ channel, args: [payload] });
      await Promise.resolve();
    }
  };
  return { wv, page, flush };
}

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  window.VexTabPolicy = undefined;
  window.escapeHtml = (v) => String(v == null ? '' : v);
  window.showToast = vi.fn();
  window.AutofillLog = { record: vi.fn() };
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ top: 0, left: 0, bottom: 20, right: 200, width: 200, height: 20 });
  window.vex = { vaultGet: vi.fn(async () => [{ username: 'saved@user.test', password: 'saved-secret-value' }]) };
});

describe('nothing is filled as the page loads', () => {
  it('an off-screen login form gets nothing, and no page script sees the password', async () => {
    // What an ad or analytics script on the site could add to any page.
    document.body.innerHTML = '<form style="position:absolute;left:-9999px;opacity:0.01"><input type="email" id="u"><input type="password" id="p"></form>';
    let stolen = null;
    document.getElementById('p').addEventListener('input', (e) => { stolen = e.target.value; });
    const { wv, flush } = connect();
    await PasswordVault.autofill(wv, URL_);
    await flush();
    expect(stolen).toBeNull();
    expect(document.getElementById('u').value).toBe('');
    expect(wv.executeJavaScript).not.toHaveBeenCalled();
    // The page is only told the origin; the password does not leave the host.
    expect(wv.hostSent).toEqual([{ channel: 'vex-login-arm', payload: { origin: 'https://shop.example' } }]);
    expect(JSON.stringify(wv.hostSent)).not.toContain('saved-secret-value');
  });

  it('a click the page makes up does nothing', async () => {
    document.body.innerHTML = '<form><input type="email" id="u"><input type="password" id="p"></form>';
    const { wv, page, flush } = connect();
    await PasswordVault.autofill(wv, URL_);
    document.getElementById('p').dispatchEvent(new Event('pointerdown', { bubbles: true }));
    document.getElementById('p').click();
    await flush();
    expect(page.sent).toEqual([]);
    expect(document.getElementById('p').value).toBe('');
    // The real source refuses untrusted events.
    expect(SECTION).toContain('if (!e.isTrusted || !armed || typed');
  });
});

describe('a real click in a login field fills it', () => {
  it('fills the username and password after a click in the password field', async () => {
    document.body.innerHTML = '<form><input type="email" id="u"><input type="password" id="p"></form>';
    const { wv, flush } = connect();
    await PasswordVault.autofill(wv, URL_);
    press(document.getElementById('p'));
    await flush();
    expect(document.getElementById('u').value).toBe('saved@user.test');
    expect(document.getElementById('p').value).toBe('saved-secret-value');
    expect(wv.executeJavaScript).not.toHaveBeenCalled();
    expect(window.AutofillLog.record).toHaveBeenCalledWith('password', URL_, true, 'saved@user.test');
  });

  it('fills the email step of a two-step sign-in, then the password step', async () => {
    document.body.innerHTML = '<input type="email" id="u">';
    const { wv, flush } = connect();
    await PasswordVault.autofill(wv, URL_);
    press(document.getElementById('u'));
    await flush();
    expect(document.getElementById('u').value).toBe('saved@user.test');
    document.body.insertAdjacentHTML('beforeend', '<input type="password" id="p">');
    press(document.getElementById('p'));
    await flush();
    expect(document.getElementById('p').value).toBe('saved-secret-value');
  });

  it('Down arrow in the field asks too; other keys do not', async () => {
    document.body.innerHTML = '<input type="email" id="u"><input type="password" id="p">';
    const { wv, flush } = connect();
    await PasswordVault.autofill(wv, URL_);
    document.getElementById('p').dispatchEvent(trusted(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })));
    await flush();
    expect(document.getElementById('p').value).toBe('');
    document.getElementById('p').dispatchEvent(trusted(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
    await flush();
    expect(document.getElementById('p').value).toBe('saved-secret-value');
  });

  it('a click on a search box or a page with no saved login asks nothing', async () => {
    document.body.innerHTML = '<input type="search" id="s"><input type="text" name="q" id="q">';
    const { wv, page, flush } = connect();
    await PasswordVault.autofill(wv, URL_);
    press(document.getElementById('s')); press(document.getElementById('q'));
    expect(page.sent).toEqual([]);
    await flush();

    window.vex.vaultGet = vi.fn(async () => []);
    document.body.innerHTML = '<input type="password" id="p">';
    const other = connect();
    await PasswordVault.autofill(other.wv, URL_);
    press(document.getElementById('p'));
    expect(other.page.sent).toEqual([]);
  });

  it('leaves a sign-up form and its new-password fields alone', async () => {
    document.body.innerHTML = '<form><input type="email" id="u"><input type="password" id="p1" autocomplete="new-password"><input type="password" id="p2" autocomplete="new-password"></form>';
    const { wv, flush } = connect();
    await PasswordVault.autofill(wv, URL_);
    press(document.getElementById('p1'));
    await flush();
    expect(document.getElementById('p1').value).toBe('');
    expect(document.getElementById('p2').value).toBe('');
  });

  it('on a change-password form fills only the current password', async () => {
    document.body.innerHTML = '<form><input type="text" id="u" autocomplete="username"><input type="password" id="cur" autocomplete="current-password"><input type="password" id="n" autocomplete="new-password"></form>';
    const { wv, flush } = connect();
    await PasswordVault.autofill(wv, URL_);
    press(document.getElementById('cur'));
    await flush();
    expect(document.getElementById('cur').value).toBe('saved-secret-value');
    expect(document.getElementById('n').value).toBe('');
  });

  it('ignores hidden fields and a form that posts to another site', async () => {
    document.body.innerHTML = '<form action="https://evil.test/collect"><input type="email" id="u"><input type="password" id="p"></form><input type="password" id="h" style="visibility:hidden">';
    const { wv, page, flush } = connect();
    await PasswordVault.autofill(wv, URL_);
    press(document.getElementById('p')); press(document.getElementById('h'));
    expect(page.sent).toEqual([]);
    await flush();
    expect([...document.querySelectorAll('input')].every((x) => x.value === '')).toBe(true);
  });

  it('a page that overrides getComputedStyle cannot get a display:none field filled', async () => {
    // The old filler ran in the page's world and used the page's getComputedStyle.
    document.body.innerHTML = '<form><input type="email" id="u"><input type="password" id="p"></form><input type="password" id="h" style="display:none">';
    const { wv, flush } = connect();
    await PasswordVault.autofill(wv, URL_);
    press(document.getElementById('h'));
    await flush();
    expect(document.getElementById('h').value).toBe('');
    expect(SECTION).not.toContain('executeJavaScript');
  });

  it('does not refill once the person has typed', async () => {
    document.body.innerHTML = '<input type="email" id="u"><input type="password" id="p">';
    const { wv, flush } = connect();
    await PasswordVault.autofill(wv, URL_);
    const u = document.getElementById('u');
    u.value = 'other@user.test';
    u.dispatchEvent(trusted(new Event('input', { bubbles: true })));
    press(document.getElementById('p'));
    await flush();
    expect(document.getElementById('p').value).toBe('');
    expect(u.value).toBe('other@user.test');
  });
});

describe('the host checks every answer', () => {
  it('answers only a page it armed, for its own host and origin', async () => {
    document.body.innerHTML = '<input type="password" id="p">';
    const { wv } = connect();
    const want = (payload) => PasswordVault._onLoginWant(wv, payload, 'shop.example');
    await want({ id: 'a', host: 'shop.example', origin: 'https://shop.example' });   // not armed yet
    expect(wv.hostSent).toEqual([]);
    await PasswordVault.autofill(wv, URL_);
    wv.hostSent.length = 0;
    await want({ id: 'b', host: 'evil.test', origin: 'https://shop.example' });
    await want({ id: 'c', host: 'shop.example', origin: 'https://evil.test' });
    expect(wv.hostSent).toEqual([]);
    await want({ id: 'd', host: 'shop.example', origin: 'https://shop.example' });
    expect(wv.hostSent.map((m) => m.channel)).toEqual(['vex-login-fill']);
  });

  it('the page side drops an answer it did not ask for, or for another origin', () => {
    document.body.innerHTML = '<input type="email" id="u"><input type="password" id="p">';
    const page = runPage();
    page.handlers['vex-login-arm']({}, { origin: 'https://shop.example' });
    page.handlers['vex-login-fill']({}, { id: 'x', origin: 'https://shop.example', username: 'a', password: 'b' });
    expect(document.getElementById('p').value).toBe('');
    press(document.getElementById('p'));
    const id = page.sent[0].payload.id;
    page.handlers['vex-login-fill']({}, { id, origin: 'https://evil.test', username: 'a', password: 'b' });
    expect(document.getElementById('p').value).toBe('');
    page.handlers['vex-login-fill']({}, { id, origin: 'https://shop.example', username: 'a', password: 'b' });
    expect(document.getElementById('p').value).toBe('b');
  });

  it('several saved logins: the chooser opens after the click, and fills the one picked', async () => {
    window.vex.vaultGet = vi.fn(async () => [{ username: 'alice@b.test', password: 'x' }, { username: 'bob@b.test', password: 'y' }]);
    document.body.innerHTML = '<form><input type="email" id="u"><input type="password" id="p"></form>';
    const { wv, flush } = connect();
    await PasswordVault.autofill(wv, URL_);
    await flush();
    expect(document.getElementById('vex-pw-pick')).toBeNull();          // nothing on load
    press(document.getElementById('p'));
    const done = flush();
    await vi.waitFor(() => expect(document.getElementById('vex-pw-pick')).not.toBeNull());
    expect([...document.querySelectorAll('#pwpick-list button')].map((b) => b.textContent)).toEqual(['alice@b.test', 'bob@b.test']);
    document.querySelectorAll('#pwpick-list button')[1].click();
    await done; await flush();
    expect(document.getElementById('u').value).toBe('bob@b.test');
    expect(document.getElementById('p').value).toBe('y');
  });

  it('fills nothing when the chooser is dismissed', async () => {
    window.vex.vaultGet = vi.fn(async () => [{ username: 'alice@b.test', password: 'x' }, { username: 'bob@b.test', password: 'y' }]);
    document.body.innerHTML = '<input type="email" id="u"><input type="password" id="p">';
    const { wv, flush } = connect();
    await PasswordVault.autofill(wv, URL_);
    press(document.getElementById('p'));
    const done = flush();
    await vi.waitFor(() => expect(document.getElementById('vex-pw-pick')).not.toBeNull());
    document.getElementById('pwpick-cancel').click();
    await done;
    expect(wv.hostSent.map((m) => m.channel)).toEqual(['vex-login-arm']);
    expect(document.getElementById('p').value).toBe('');
  });

  it('logs a fill only when the page says a field was filled', async () => {
    document.body.innerHTML = '<input type="search" id="s">';
    const { wv } = connect();
    await PasswordVault.autofill(wv, URL_);
    await PasswordVault._onLoginWant(wv, { id: 'k', host: 'shop.example', origin: 'https://shop.example' }, 'shop.example');
    PasswordVault._onLoginFilled(wv, { id: 'k', filled: 0 });
    expect(window.AutofillLog.record).not.toHaveBeenCalled();
    await PasswordVault._onLoginWant(wv, { id: 'm', host: 'shop.example', origin: 'https://shop.example' }, 'shop.example');
    PasswordVault._onLoginFilled(wv, { id: 'forged', filled: 2 });
    expect(window.AutofillLog.record).not.toHaveBeenCalled();
    PasswordVault._onLoginFilled(wv, { id: 'm', filled: 2 });
    expect(window.AutofillLog.record).toHaveBeenCalledWith('password', URL_, true, 'saved@user.test');
  });

  it('the AI agent’s sign-in fills at once, still from the isolated world', async () => {
    document.body.innerHTML = '<input type="email" id="u"><input type="password" id="p">';
    const { wv, flush } = connect();
    await PasswordVault.autofill(wv, URL_, { now: true });
    await flush();
    expect(document.getElementById('p').value).toBe('saved-secret-value');
    expect(wv.executeJavaScript).not.toHaveBeenCalled();
  });

  it('still fills after the site rewrites its query string between steps', async () => {
    // Spotify rewrites flow_ctx between the email and password steps.
    document.body.innerHTML = '<input type="email" id="u"><input type="password" id="p">';
    const { wv, flush } = connect('https://shop.example/login?flow_ctx=first');
    await PasswordVault.autofill(wv, 'https://shop.example/login?flow_ctx=first');
    wv.getURL = () => 'https://shop.example/login?flow_ctx=regenerated';
    press(document.getElementById('p'));
    await flush();
    expect(document.getElementById('p').value).toBe('saved-secret-value');
  });

  it('hands nothing over once the tab has left the origin', async () => {
    document.body.innerHTML = '<input type="email" id="u"><input type="password" id="p">';
    const { wv } = connect();
    await PasswordVault.autofill(wv, URL_);
    wv.hostSent.length = 0;
    wv.getURL = () => 'https://evil.test/login';
    await PasswordVault._onLoginWant(wv, { id: 'z', host: 'shop.example', origin: 'https://shop.example' }, 'shop.example');
    expect(wv.hostSent).toEqual([]);
    // And the page side of another origin is never armed by this one's message.
    const evil = runPage('https://evil.test/login');
    evil.handlers['vex-login-arm']({}, { origin: 'https://shop.example' });
    press(document.getElementById('p'));
    expect(evil.sent).toEqual([]);
  });

  it('does not arm a page reached while the vault was being read', async () => {
    let resolve;
    window.vex.vaultGet = () => new Promise((r) => { resolve = r; });
    let current = URL_;
    const wv = { _navigationGeneration: 1, getURL: () => current, send: vi.fn(), executeJavaScript: vi.fn() };
    const pending = PasswordVault.autofill(wv, URL_);
    current = 'https://evil.test/login';
    resolve([{ username: 'a', password: 'b' }]);
    await pending;
    expect(wv.send).not.toHaveBeenCalled();
    expect(wv.executeJavaScript).not.toHaveBeenCalled();
  });
});
