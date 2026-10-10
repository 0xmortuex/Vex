// @vitest-environment jsdom
//
// The page side of Clipboard History (preload-webview.js, "Copy tracker").
// Audit SE8 (2026-10-10): a page could dispatch made-up copy events and fill
// the history with whatever it liked. And a site's own "Copy" button
// (navigator.clipboard.writeText) never reached the history at all.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '../../src/preload-webview.js'), 'latin1');
const SECTION = (() => {
  const start = SRC.indexOf('// === Copy tracker');
  const end = SRC.indexOf('// === Mouse-gesture tracker', start);
  return SRC.slice(start, end);
})();

let active;
class Clipboard { writeText() { return Promise.resolve(); } }

// jsdom cannot make a trusted event: the "testable" run reads e.vexTestTrusted
// as well; the guard itself is checked against the real source below.
function run({ testable = false, mainWorld = true } = {}) {
  const sent = [];
  const ipcRenderer = { sendToHost: (channel, payload) => sent.push({ channel, payload }) };
  // executeInMainWorld: jsdom has one world, so the function runs right here,
  // with the arguments handed to it as Electron hands them over.
  const cb = mainWorld ? { executeInMainWorld: ({ func, args }) => func(...args) } : undefined;
  let code = SECTION;
  if (testable) code = code.split('e.isTrusted').join('(e.isTrusted || e.vexTestTrusted)');
  // eslint-disable-next-line no-new-func
  new Function('require', '__vexCB', code)(() => ({ ipcRenderer }), cb);
  return sent;
}
const copyEvent = (trusted) => { const e = new Event('copy', { bubbles: true }); if (trusted) e.vexTestTrusted = true; return e; };
const flush = () => new Promise(r => setTimeout(r, 0));

beforeEach(() => {
  document.body.innerHTML = '<p id="t">Order 4711</p>';
  globalThis.Clipboard = Clipboard;
  Clipboard.prototype.writeText = function () { return Promise.resolve(); };
  active = true;
  Object.defineProperty(navigator, 'userActivation', { configurable: true, get: () => ({ isActive: active }) });
  navigator.clipboard = new Clipboard();
});
afterEach(() => { delete globalThis.Clipboard; delete navigator.clipboard; });

describe('copy and cut events', () => {
  it('only a real copy is reported; one the page made up is not', () => {
    const sent = run({ testable: true });
    const range = document.createRange(); range.selectNodeContents(document.getElementById('t'));
    getSelection().removeAllRanges(); getSelection().addRange(range);
    document.dispatchEvent(copyEvent(false));
    document.dispatchEvent(copyEvent(false));
    expect(sent).toEqual([]);
    document.dispatchEvent(copyEvent(true));
    expect(sent).toEqual([{ channel: 'vex-copy', payload: expect.objectContaining({ text: 'Order 4711', kind: 'copy' }) }]);
  });

  it('the guard is in the real source for both events', () => {
    expect(SECTION).toContain('document.addEventListener("copy", (e) => { if (e.isTrusted) report("copy"); }, true);');
    expect(SECTION).toContain('document.addEventListener("cut", (e) => { if (e.isTrusted) report("cut"); }, true);');
  });
});

describe('a site\'s own Copy button (navigator.clipboard.writeText)', () => {
  it('is reported once the write has happened, after a click', async () => {
    const sent = run();
    const p = navigator.clipboard.writeText('ABCD-1234');
    expect(sent).toEqual([]);
    await p; await flush();
    expect(sent).toEqual([{ channel: 'vex-copy', payload: expect.objectContaining({ text: 'ABCD-1234', kind: 'write' }) }]);
  });

  it('without a click or key press it is not: a page cannot fill the history on its own', async () => {
    const sent = run();
    active = false;
    for (let i = 0; i < 50; i++) await navigator.clipboard.writeText('spam ' + i);
    await flush();
    expect(sent).toEqual([]);
  });

  it('a write that failed is not reported', async () => {
    Clipboard.prototype.writeText = () => Promise.reject(new Error('NotAllowedError'));
    const sent = run();
    await expect(navigator.clipboard.writeText('nope')).rejects.toThrow('NotAllowedError');
    await flush();
    expect(sent).toEqual([]);
  });

  it('nothing the page can reach reports a copy: no bridge on window, and a faked then() is not believed', async () => {
    // A write the browser refuses (no permission): the page wants it reported
    // as if it had happened.
    Clipboard.prototype.writeText = () => Promise.reject(new Error('NotAllowedError'));
    const sent = run();
    expect(Object.keys(window).filter(k => /vex/i.test(k) && /copy|clip/i.test(k))).toEqual([]);
    const realThen = Promise.prototype.then;
    let p;
    try {
      // The page swaps then() so that a refused write looks finished.
      Promise.prototype.then = function (ok) { try { ok(); } catch {} return this; };
      p = navigator.clipboard.writeText('fake address');
    } finally { Promise.prototype.then = realThen; }
    await p.catch(() => {});
    await flush();
    expect(sent).toEqual([]);
  });

  it('what the page gets back is the real write, and a copy out of a password box is not kept', async () => {
    document.body.innerHTML = '<input type="password" id="pw">';
    document.getElementById('pw').focus();
    const sent = run();
    const p = navigator.clipboard.writeText('hunter2');
    expect(p).toBeInstanceOf(Promise);
    await p; await flush();
    expect(sent).toEqual([]);
  });

  it('with no main-world bridge (an old build) nothing is wrapped', () => {
    const before = Clipboard.prototype.writeText;
    run({ mainWorld: false });
    expect(Clipboard.prototype.writeText).toBe(before);
  });
});
