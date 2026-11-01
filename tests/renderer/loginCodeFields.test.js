// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://account.example/security"}
//
// The saved-account chooser came up over an Authenticator code (Riot account page, 2026-11-01): a visible
// password field somewhere on the page made every plain text box a "login field", including the six boxes of a
// one-time code. The page side (preload-webview.js, "Saved-login fill") now never treats a one-time-code box as
// a user field, and only lets a password field make a plain text box a login when it is in the same form or
// dialog.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SRC = fs.readFileSync(path.join(__dirname, '../../src/preload-webview.js'), 'utf8').replace(/\r\n/g, '\n');
const FILL = SRC.slice(SRC.indexOf('// === Saved-login fill'), SRC.indexOf('// === Suggest a strong password'));

function fillPage() {
  const sent = [];
  const handlers = {};
  const ipcRenderer = { sendToHost: (channel, payload) => sent.push({ channel, payload }), on: (c, fn) => { handlers[c] = fn; } };
  const code = FILL.split('e.isTrusted').join('(e.isTrusted || e.vexTestTrusted)');
  new Function('require', 'location', code)(() => ({ ipcRenderer }), new URL('https://account.example/security'));
  handlers['vex-login-arm']({}, { origin: 'https://account.example' });
  return { sent, handlers };
}

// A real click on the element: true when the page asked the host for a saved login.
function clickAsks(el) {
  const { sent } = fillPage();
  const down = new Event('pointerdown', { bubbles: true, composed: true });
  down.vexTestTrusted = true;
  el.dispatchEvent(down);
  return sent.some(m => m.channel === 'vex-login-want');
}

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '';
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ top: 0, left: 0, bottom: 20, right: 200, width: 200, height: 20 });
});

describe('a one-time-code box is not a login field', () => {
  // The Riot shape: a sign-in form with a visible password field in one place, and an MFA code dialog in another.
  const page = (codeBoxes) => {
    document.body.innerHTML = '<form id="signin"><input type="text" id="u" name="username"><input type="password" id="p"></form>'
      + '<div role="dialog" aria-modal="true" id="mfa">' + codeBoxes + '</div>';
  };

  it('six one-digit boxes (inputmode numeric, maxlength 1)', () => {
    page('<input type="text" inputmode="numeric" maxlength="1" id="c1"><input type="text" inputmode="numeric" maxlength="1" id="c2">');
    expect(clickAsks(document.getElementById('c1'))).toBe(false);
    expect(clickAsks(document.getElementById('c2'))).toBe(false);
  });

  it('autocomplete="one-time-code"', () => {
    page('<input type="text" autocomplete="one-time-code" id="c">');
    expect(clickAsks(document.getElementById('c'))).toBe(false);
  });

  it('a plain text box whose name or label says it is a code', () => {
    page('<input type="text" name="verification_code" id="a"><input type="text" aria-label="Enter the 6-digit security code" id="b">'
      + '<input type="tel" placeholder="Authenticator code" id="c">');
    for (const id of ['a', 'b', 'c']) expect(clickAsks(document.getElementById(id)), id).toBe(false);
  });

  it('a plain text box in a dialog that has no password field of its own', () => {
    page('<input type="text" id="x" name="field1">');
    expect(clickAsks(document.getElementById('x'))).toBe(false);
  });
});

describe('real sign-in forms still ask for the saved login', () => {
  it('a user name and a password in the same form', () => {
    document.body.innerHTML = '<form><input type="text" id="u" name="field1"><input type="password" id="p"></form>';
    expect(clickAsks(document.getElementById('u'))).toBe(true);
    expect(clickAsks(document.getElementById('p'))).toBe(true);
  });

  it('an e-mail box, and a box that says it is a user name', () => {
    document.body.innerHTML = '<form><input type="email" id="e"></form><form><input type="text" name="username" id="n"></form>';
    expect(clickAsks(document.getElementById('e'))).toBe(true);
    expect(clickAsks(document.getElementById('n'))).toBe(true);
  });

  it('a sign-in in a dialog: user name and password inside the same dialog', () => {
    document.body.innerHTML = '<div role="dialog"><input type="text" id="u" name="field1"><input type="password" id="p"></div>';
    expect(clickAsks(document.getElementById('u'))).toBe(true);
  });

  it('with no form or dialog around, a password field on the page still counts', () => {
    document.body.innerHTML = '<input type="text" id="u" name="field1"><input type="password" id="p">';
    expect(clickAsks(document.getElementById('u'))).toBe(true);
  });
});
