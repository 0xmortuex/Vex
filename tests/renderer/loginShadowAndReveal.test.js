// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://acct.example/login"}
//
// Two real sign-in shapes the page side missed (preload-webview.js, "Password
// capture" and "Saved-login fill"):
//  - the person clicks the eye ("show password"), the field becomes
//    type=text, and the sign-in was never offered for saving;
//  - sign-in forms built from web components keep each input in its own open
//    shadow root, where document.querySelectorAll never looks: no fill, no
//    save offer.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SRC = fs.readFileSync(path.join(__dirname, '../../src/preload-webview.js'), 'utf8').replace(/\r\n/g, '\n');
const CAPTURE = SRC.slice(SRC.indexOf('// === Password capture'), SRC.indexOf('// === Saved-login fill'));
const FILL = SRC.slice(SRC.indexOf('// === Saved-login fill'), SRC.indexOf('// === Suggest a strong password'));

function capturePage() {
  const sent = [];
  const handlers = {};
  const doc = {
    addEventListener: (name, fn) => { (handlers[name] = handlers[name] || []).push(fn); },
    querySelectorAll: (s) => document.querySelectorAll(s),
  };
  const ipcRenderer = { sendToHost: (channel, payload) => sent.push({ channel, payload }) };
  new Function('require', 'location', 'document', 'navigator', CAPTURE)(() => ({ ipcRenderer }), new URL('https://acct.example/login'), doc, { userActivation: { isActive: true } });
  const fire = (name, event) => { for (const fn of handlers[name] || []) fn(event); };
  return { sent, fire };
}

function fillPage() {
  const sent = [];
  const handlers = {};
  const ipcRenderer = { sendToHost: (channel, payload) => sent.push({ channel, payload }), on: (c, fn) => { handlers[c] = fn; } };
  const code = FILL.split('e.isTrusted').join('(e.isTrusted || e.vexTestTrusted)');
  new Function('require', 'location', code)(() => ({ ipcRenderer }), new URL('https://acct.example/login'));
  return { sent, handlers };
}

// A custom element with an open shadow root holding one <input>.
function shadowInput(id, type, extra = {}) {
  const host = document.createElement('text-field');
  const root = host.attachShadow({ mode: 'open' });
  const input = document.createElement('input');
  input.id = id; input.type = type;
  for (const [k, v] of Object.entries(extra)) input.setAttribute(k, v);
  root.appendChild(input);
  return { host, input };
}

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '';
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ top: 0, left: 0, bottom: 20, right: 200, width: 200, height: 20 });
});

describe('capture', () => {
  it('still offers to save when the password was showing as text at submit', () => {
    document.body.innerHTML = '<form><input type="email" id="e"><input type="password" id="p"></form>';
    const { sent, fire } = capturePage();
    const email = document.getElementById('e'), pw = document.getElementById('p');
    email.value = 'me@acct.example';
    fire('input', { target: email });
    pw.value = 'hunter2-hunter2';
    fire('input', { target: pw });
    pw.type = 'text';            // the eye button
    fire('keydown', { isTrusted: true, key: 'Enter', target: pw });
    expect(sent).toContainEqual({ channel: 'vex-cred-submit', payload: { host: 'acct.example', username: 'me@acct.example', password: 'hunter2-hunter2' } });
  });

  it('does not take the revealed password for the username', () => {
    document.body.innerHTML = '<form><input type="password" id="p"></form>';
    const { sent, fire } = capturePage();
    const pw = document.getElementById('p');
    pw.value = 'name-user-login-secret';
    fire('input', { target: pw });
    pw.type = 'text';
    fire('input', { target: pw });   // typing again while it shows
    fire('keydown', { isTrusted: true, key: 'Enter', target: pw });
    const cred = sent.find(m => m.channel === 'vex-cred-submit');
    expect(cred.payload).toEqual({ host: 'acct.example', username: '', password: 'name-user-login-secret' });
  });

  it('finds a password field inside a shadow root', () => {
    const user = shadowInput('u', 'email'); const pw = shadowInput('p', 'password');
    document.body.append(user.host, pw.host);
    user.input.value = 'me@acct.example'; pw.input.value = 'shadow-secret-1';
    const { sent, fire } = capturePage();
    // The event reaches the document retargeted to the host; composedPath has the input.
    const path = [pw.input, pw.host];
    fire('keydown', { isTrusted: true, key: 'Enter', target: pw.host, composedPath: () => path });
    const cred = sent.find(m => m.channel === 'vex-cred-submit');
    expect(cred.payload.password).toBe('shadow-secret-1');
    expect(cred.payload.username).toBe('me@acct.example');
  });
});

describe('fill', () => {
  it('fills a username and password that live in shadow roots', () => {
    const user = shadowInput('u', 'email'); const pw = shadowInput('p', 'password');
    document.body.append(user.host, pw.host);
    const { sent, handlers } = fillPage();
    handlers['vex-login-arm']({}, { origin: 'https://acct.example' });
    const down = new Event('pointerdown', { bubbles: true, composed: true });
    down.vexTestTrusted = true;
    pw.input.dispatchEvent(down);
    const want = sent.find(m => m.channel === 'vex-login-want');
    expect(want).toBeTruthy();
    handlers['vex-login-fill']({}, { id: want.payload.id, origin: 'https://acct.example', username: 'saved@acct.example', password: 'saved-secret' });
    expect(user.input.value).toBe('saved@acct.example');
    expect(pw.input.value).toBe('saved-secret');
    expect(sent.find(m => m.channel === 'vex-login-filled').payload.filled).toBe(2);
  });
});
