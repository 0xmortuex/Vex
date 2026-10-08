// @vitest-environment jsdom
// "Use a strong password" on a site's sign-up form: the page side
// (preload-webview.js) and the host side (passwords.js).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import G from '../../src/renderer/js/password-gen.js';
import { PasswordVault } from '../../src/renderer/js/passwords.js';

const SRC = fs.readFileSync(path.join(__dirname, '../../src/preload-webview.js'), 'utf8').replace(/\r\n/g, '\n');
const SECTION = (() => {
  const start = SRC.indexOf('// === Suggest a strong password');
  const end = SRC.indexOf('// === Snippets', start);
  return SRC.slice(start, end);
})();

// ---------------------------------------------------------------- host side

function fakeWebview(url, partition = 'persist:main') {
  const listeners = {};
  return {
    sent: [],
    getURL: () => url,
    getAttribute: (n) => (n === 'partition' ? partition : null),
    addEventListener: (name, fn) => { (listeners[name] = listeners[name] || []).push(fn); },
    send(channel, payload) { this.sent.push({ channel, payload }); },
    emit: async (name, event) => { for (const fn of listeners[name] || []) await fn(event); },
  };
}
const say = (wv, channel, payload) => wv.emit('ipc-message', { channel, args: [payload] });

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  window.escapeHtml = (value) => String(value == null ? '' : value);
  window.showToast = vi.fn();
  window.VexPasswordGen = G;
  window.VexTabPolicy = { canReadWebview: (wv) => String(wv.getAttribute('partition') || '').startsWith('persist:') };
  window.vex = { vaultGet: vi.fn(async () => []), vaultSave: vi.fn(async () => ({ ok: true })) };
});

describe('the host offers a password only where the vault works', () => {
  it('answers a sign-up field on an https page with a generated password', async () => {
    const wv = fakeWebview('https://www.shop.example/join');
    PasswordVault.attach(wv);
    await say(wv, 'vex-pwgen-ask', { id: 'pg1', host: 'shop.example', maxLength: 0, minLength: 0 });
    expect(wv.sent).toHaveLength(1);
    const { channel, payload } = wv.sent[0];
    expect(channel).toBe('vex-pwgen-offer');
    expect(payload.id).toBe('pg1');
    expect(payload.password).toHaveLength(20);
    expect(payload.label).toBe('Very strong');
    expect(wv._vexPwSuggestion).toMatchObject({ id: 'pg1', host: 'shop.example', accepted: false });
  });

  it('respects the field’s maxlength', async () => {
    const wv = fakeWebview('https://shop.example/join');
    PasswordVault.attach(wv);
    await say(wv, 'vex-pwgen-ask', { id: 'pg1', host: 'shop.example', maxLength: 12 });
    expect(wv.sent[0].payload.password).toHaveLength(12);
  });

  it('says nothing in a private, off-the-record or Tor tab', async () => {
    for (const partition of ['private-123', 'tor-abc', 'burner-1']) {
      const wv = fakeWebview('https://shop.example/join', partition);
      PasswordVault.attach(wv);
      await say(wv, 'vex-pwgen-ask', { id: 'pg1', host: 'shop.example' });
      expect(wv.sent, partition).toHaveLength(0);
    }
  });

  it('says nothing over plain http, for another host, or on a site set to Never', async () => {
    const http = fakeWebview('http://shop.example/join');
    PasswordVault.attach(http);
    await say(http, 'vex-pwgen-ask', { id: 'pg1', host: 'shop.example' });
    expect(http.sent).toHaveLength(0);

    const other = fakeWebview('https://shop.example/join');
    PasswordVault.attach(other);
    await say(other, 'vex-pwgen-ask', { id: 'pg1', host: 'evil.test' });
    expect(other.sent).toHaveLength(0);

    PasswordVault._addNever('shop.example');
    const never = fakeWebview('https://shop.example/join');
    PasswordVault.attach(never);
    await say(never, 'vex-pwgen-ask', { id: 'pg1', host: 'shop.example' });
    expect(never.sent).toHaveLength(0);
  });
});

describe('saving the suggested password', () => {
  async function usedSuggestion() {
    const wv = fakeWebview('https://shop.example/join');
    PasswordVault.attach(wv);
    await say(wv, 'vex-pwgen-ask', { id: 'pg1', host: 'shop.example' });
    const password = wv.sent[0].payload.password;
    await say(wv, 'vex-pwgen-used', { id: 'pg1', host: 'shop.example' });
    return { wv, password };
  }

  it('is not saved when it is only filled in', async () => {
    const { wv } = await usedSuggestion();
    expect(wv._vexPwSuggestion.accepted).toBe(true);
    expect(window.vex.vaultSave).not.toHaveBeenCalled();
    expect(window.showToast).toHaveBeenCalledWith(expect.stringMatching(/saves it when you submit/));
  });

  it('is saved when the form is submitted, and says so', async () => {
    const { wv, password } = await usedSuggestion();
    await say(wv, 'vex-cred-submit', { host: 'shop.example', username: 'new@user.test', password });
    expect(window.vex.vaultSave).toHaveBeenCalledWith({ host: 'shop.example', username: 'new@user.test', password });
    expect(window.showToast).toHaveBeenLastCalledWith('Password saved for shop.example');
    expect(document.getElementById('vex-pw-offer')).toBeNull();
    expect(wv._vexPwSuggestion).toBeNull();
  });

  it('a suggestion that was never used is not saved on submit — the usual offer appears', async () => {
    const wv = fakeWebview('https://shop.example/join');
    PasswordVault.attach(wv);
    await say(wv, 'vex-pwgen-ask', { id: 'pg1', host: 'shop.example' });
    const password = wv.sent[0].payload.password;
    await say(wv, 'vex-cred-submit', { host: 'shop.example', username: 'new@user.test', password });
    expect(window.vex.vaultSave).not.toHaveBeenCalled();
    expect(document.getElementById('vex-pw-offer')).not.toBeNull();
  });

  it('a password the person changed afterwards goes through the usual offer', async () => {
    const { wv } = await usedSuggestion();
    await say(wv, 'vex-cred-submit', { host: 'shop.example', username: 'new@user.test', password: 'typed-by-hand-' + Date.now() });
    expect(window.vex.vaultSave).not.toHaveBeenCalled();
    expect(document.getElementById('vex-pw-offer')).not.toBeNull();
  });

  it('a "used" message for another offer changes nothing', async () => {
    const wv = fakeWebview('https://shop.example/join');
    PasswordVault.attach(wv);
    await say(wv, 'vex-pwgen-ask', { id: 'pg1', host: 'shop.example' });
    await say(wv, 'vex-pwgen-used', { id: 'pg-forged', host: 'shop.example' });
    expect(wv._vexPwSuggestion.accepted).toBe(false);
  });

  it('a failed save is said out loud and the offer stays to try again', async () => {
    window.vex.vaultSave = vi.fn(async () => ({ ok: false, error: 'Vex is locked' }));
    const { wv, password } = await usedSuggestion();
    await say(wv, 'vex-cred-submit', { host: 'shop.example', username: 'new@user.test', password });
    expect(window.showToast).toHaveBeenLastCalledWith('Could not save the new password: Vex is locked', 'error');
    expect(document.getElementById('vex-pw-offer')).not.toBeNull();
  });
});


// ---------------------------------------------------------------- page side

// Runs the preload section against jsdom. `location` is handed in (jsdom's
// own cannot be faked). jsdom cannot make a trusted event and the card's
// shadow root is closed, so the "testable" run widens exactly those two
// things — the guards themselves are checked against the real source below.
function runPreloadSection({ url = 'https://shop.example/join', testable = false } = {}) {
  const sent = [];
  const handlers = {};
  const ipcRenderer = {
    sendToHost: (channel, payload) => sent.push({ channel, payload }),
    on: (channel, fn) => { handlers[channel] = fn; },
  };
  let code = SECTION;
  if (testable) {
    code = code.split('e.isTrusted').join('(e.isTrusted || e.vexTestTrusted)').replace('mode: "closed"', 'mode: "open"');
  }
  // eslint-disable-next-line no-new-func
  new Function('require', 'location', code)(() => ({ ipcRenderer }), new URL(url));
  return { sent, offer: (payload) => handlers['vex-pwgen-offer']({}, payload) };
}
const trusted = (ev) => { ev.vexTestTrusted = true; return ev; };

describe('the page side picks only new-password fields', () => {
  beforeEach(() => {
    // jsdom lays nothing out; every field is "visible".
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ top: 10, bottom: 30, left: 10, right: 210, width: 200, height: 20 });
  });

  function asks(html, focusSelector, opts) {
    document.body.innerHTML = html;
    const page = runPreloadSection(opts);
    document.querySelector(focusSelector).focus();
    return page;
  }

  it('a field marked autocomplete="new-password" is offered', () => {
    const { sent } = asks('<form><input type="email" name="email"><input type="password" id="p1" autocomplete="new-password" maxlength="40"><input type="password" id="p2" autocomplete="new-password"><button>Continue</button></form>', '#p1');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ channel: 'vex-pwgen-ask', payload: { host: 'shop.example', maxLength: 40 } });
  });

  it('its confirm twin is not offered separately', () => {
    const { sent } = asks('<form><input type="password" id="p1" autocomplete="new-password"><input type="password" id="p2" autocomplete="new-password"></form>', '#p2');
    expect(sent).toHaveLength(0);
  });

  it('a sign-up form without hints: two password fields and a "Create account" button', () => {
    const { sent } = asks('<form><input name="user"><input type="password" id="a"><input type="password" id="b"><button type="submit">Create account</button></form>', '#a');
    expect(sent).toHaveLength(1);
  });

  it('a login form never is', () => {
    const { sent } = asks('<form><input type="email" name="email"><input type="password" id="pw"><button type="submit">Sign in</button></form>', '#pw');
    expect(sent).toHaveLength(0);
  });

  it('a current-password field never is, even on a sign-up page', () => {
    const { sent } = asks('<form><input type="password" id="pw" autocomplete="current-password"><button>Sign up</button></form>', '#pw');
    expect(sent).toHaveLength(0);
  });

  it('a change-password form with no hints (three fields) is left alone', () => {
    const { sent } = asks('<form><input type="password" id="a"><input type="password" id="b"><input type="password" id="c"><button>Choose a password</button></form>', '#b');
    expect(sent).toHaveLength(0);
  });

  it('nothing over plain http', () => {
    const { sent } = asks('<form><input type="password" id="p1" autocomplete="new-password"></form>', '#p1', { url: 'http://shop.example/join' });
    expect(sent).toHaveLength(0);
  });

  it('shows the card only for the offer it asked for, in a closed shadow root', () => {
    const { sent, offer } = asks('<form><input type="email"><input type="password" id="p1" autocomplete="new-password"><input type="password" id="p2" autocomplete="new-password"></form>', '#p1');
    offer({ id: 'someone-else', password: 'Xx1-not-this-one', label: 'Very strong', theme: {} });
    expect(document.querySelector('vex-password-suggestion')).toBeNull();
    offer({ id: sent[0].payload.id, password: 'Gen-erated.Value_42', label: 'Very strong', theme: {} });
    const card = document.querySelector('vex-password-suggestion');
    expect(card).not.toBeNull();
    expect(card.shadowRoot).toBeNull();
    expect(document.body.textContent).not.toContain('Gen-erated.Value_42');
  });

  it('the click fills the new and confirm fields, never the current one, and tells the host', () => {
    const { sent, offer } = asks('<form><input type="password" id="cur" autocomplete="current-password" value=""><input type="password" id="p1" autocomplete="new-password"><input type="password" id="p2" autocomplete="new-password"></form>', '#p1', { testable: true });
    const inputs = [];
    document.addEventListener('input', (e) => inputs.push(e.target.id));
    offer({ id: sent[0].payload.id, password: 'Gen-erated.Value_42', label: 'Very strong', theme: {} });
    const button = document.querySelector('vex-password-suggestion').shadowRoot.querySelector('button');
    button.dispatchEvent(new MouseEvent('click', { bubbles: true })); // made up by the page
    expect(document.getElementById('p1').value).toBe('');
    button.dispatchEvent(trusted(new MouseEvent('click', { bubbles: true })));
    expect(document.getElementById('p1').value).toBe('Gen-erated.Value_42');
    expect(document.getElementById('p2').value).toBe('Gen-erated.Value_42');
    expect(document.getElementById('cur').value).toBe('');
    expect(inputs).toEqual(['p1', 'p2']); // frameworks hear about it
    expect(sent[1]).toMatchObject({ channel: 'vex-pwgen-used', payload: { id: sent[0].payload.id, host: 'shop.example', filled: 2 } });
    expect(document.querySelector('vex-password-suggestion')).toBeNull();
  });

  it('Escape closes the card and the field is not offered again', () => {
    const { sent, offer } = asks('<form><input type="password" id="p1" autocomplete="new-password"><input id="other"></form>', '#p1', { testable: true });
    offer({ id: sent[0].payload.id, password: 'Gen-erated.Value_42', label: 'Very strong', theme: {} });
    document.getElementById('p1').dispatchEvent(trusted(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(document.querySelector('vex-password-suggestion')).toBeNull();
    document.getElementById('other').focus();
    document.getElementById('p1').focus();
    expect(sent).toHaveLength(1);
  });

  it('typing their own password closes the card', () => {
    const { sent, offer } = asks('<form><input type="password" id="p1" autocomplete="new-password"></form>', '#p1', { testable: true });
    offer({ id: sent[0].payload.id, password: 'Gen-erated.Value_42', label: 'Very strong', theme: {} });
    const p1 = document.getElementById('p1');
    p1.value = 'x';
    p1.dispatchEvent(trusted(new Event('input', { bubbles: true })));
    expect(document.querySelector('vex-password-suggestion')).toBeNull();
  });
});

describe('the guards in the real source', () => {
  it('the fill needs a real click, the keys a real key press', () => {
    const click = SECTION.slice(SECTION.indexOf('button.addEventListener("click"'));
    expect(click).toMatch(/^button\.addEventListener\("click", \(e\) => \{\s*\/\/[^\n]*\n\s*if \(!e\.isTrusted/);
    const keys = SECTION.slice(SECTION.indexOf('document.addEventListener("keydown"'));
    expect(keys).toMatch(/if \(!card \|\| !e\.isTrusted\) return;/);
    expect(SECTION).toContain('attachShadow({ mode: "closed" })');
  });
});
