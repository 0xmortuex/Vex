// @vitest-environment jsdom
// Fixed in the 2026-09-29 sweep: a private window picks up per-site switches
// changed later, permission prompts wait their turn instead of removing each
// other, and an Escape pressed inside Peek or Responsive Preview (that the
// page left alone) closes it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const flush = () => new Promise(r => setTimeout(r, 0));
// A fresh copy of a renderer file, so what it does at load time runs again.
const fresh = (rel) => { const f = require.resolve(rel); delete require.cache[f]; return require(f); };

beforeEach(() => {
  document.body.innerHTML = '';
  window.escapeHtml = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  window.showToast = vi.fn();
  globalThis.VexIcons = { svg: () => '<svg></svg>' };
  window.VexIcons = globalThis.VexIcons;
});
afterEach(() => { vi.restoreAllMocks(); });

describe('a private window follows switches changed in the normal window', () => {
  let S;
  let rules;
  beforeEach(async () => {
    rules = {};
    window.vex = { siteRulesGet: vi.fn(async () => ({ ok: true, rules: structuredClone(rules) })) };
    window.VexTabPolicy = { isPrivateWindow: true };
    S = fresh('../../src/renderer/js/site-rules-ui.js').SiteRulesUI;
    await flush();
  });
  afterEach(() => { clearInterval(S._mirrorTimer); window.VexTabPolicy = { isPrivateWindow: false }; });

  it('reads them again when the window is come back to', async () => {
    expect(S.scriptsOff('https://example.com/')).toBe(false);
    rules = { 'example.com': { js: 'off' } };
    window.dispatchEvent(new Event('focus'));
    await flush();
    expect(S.scriptsOff('https://example.com/')).toBe(true);
  });

  it('and every few seconds while it is on screen', async () => {
    vi.useFakeTimers();
    try {
      clearInterval(S._mirrorTimer);
      S = fresh('../../src/renderer/js/site-rules-ui.js').SiteRulesUI;
      await vi.advanceTimersByTimeAsync(0);
      rules = { 'example.com': { js: 'off' } };
      await vi.advanceTimersByTimeAsync(3100);
      expect(S.scriptsOff('https://example.com/')).toBe(true);
    } finally { clearInterval(S._mirrorTimer); vi.useRealTimers(); }
  });
});

describe('permission prompts wait their turn', () => {
  let P;
  beforeEach(() => {
    window.vex = { permissionRespond: vi.fn(async () => ({ ok: true })) };
    fresh('../../src/renderer/js/permission-prompts.js');
    P = window.PermissionPrompts;
  });
  const shown = () => [...document.querySelectorAll('.permission-prompt')].filter(p => !p.hidden);
  const click = (remember) => shown().at(-1).querySelector(`[data-remember="${remember}"]`).click();

  it('a second request does not remove the first; each is answered in turn', async () => {
    P.showPrompt({ id: 'a', origin: 'https://one.test', permission: 'geolocation' });
    P.showPrompt({ id: 'b', origin: 'https://two.test', permission: 'notifications' });
    expect(shown()).toHaveLength(1);
    expect(shown()[0].querySelector('.perm-origin').textContent).toBe('https://one.test');
    click('session');
    expect(window.vex.permissionRespond).toHaveBeenCalledWith(expect.objectContaining({ id: 'a', decision: 'allow', remember: 'session' }));
    // The second comes up at once.
    expect(shown().at(-1).querySelector('.perm-origin').textContent).toBe('https://two.test');
    click('true');
    await flush();
    expect(window.vex.permissionRespond).toHaveBeenCalledWith(expect.objectContaining({ id: 'b', origin: 'https://two.test', remember: true }));
    expect(window.vex.permissionRespond).toHaveBeenCalledTimes(2);
  });

  it('the same site asking for the same thing joins the open prompt; one answer settles both', async () => {
    P.showPrompt({ id: 'a', origin: 'https://one.test', permission: 'geolocation' });
    P.showPrompt({ id: 'a2', origin: 'https://one.test', permission: 'geolocation' });
    expect(document.querySelectorAll('.permission-prompt')).toHaveLength(1);
    click('true');
    await flush();
    const ids = window.vex.permissionRespond.mock.calls.map(c => c[0].id);
    expect(ids).toEqual(['a', 'a2']);
    expect(P._queue).toHaveLength(0);
  });

  it('Escape still blocks only the prompt on screen, this once', async () => {
    P.showPrompt({ id: 'a', origin: 'https://one.test', permission: 'geolocation' });
    P.showPrompt({ id: 'b', origin: 'https://two.test', permission: 'camera' });
    const e = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    document.body.dispatchEvent(e);
    expect(window.vex.permissionRespond).toHaveBeenCalledTimes(1);
    expect(window.vex.permissionRespond).toHaveBeenCalledWith(expect.objectContaining({ id: 'a', decision: 'deny', remember: false }));
    expect(P._queue).toHaveLength(1);
    expect(P._queue[0].ids).toEqual(['b']);
  });

  // Main blocks a request after two minutes; its prompt used to stay on
  // screen until answered, then fail (found 2026-09-29).
  it('a prompt main gave up on goes away, says why, and the next comes up', () => {
    P.showPrompt({ id: 'a', origin: 'https://one.test', permission: 'geolocation' });
    P.showPrompt({ id: 'a2', origin: 'https://one.test', permission: 'geolocation' });
    P.showPrompt({ id: 'b', origin: 'https://two.test', permission: 'camera' });
    P.expired({ id: 'a' });
    expect(P._queue[0].ids).toEqual(['a2']);
    P.expired({ id: 'a2' });
    expect(window.vex.permissionRespond).not.toHaveBeenCalled();
    expect(window.showToast).toHaveBeenCalledWith(expect.stringMatching(/blocked after two minutes/), 'info', 4000);
    expect(P._queue).toHaveLength(1);
    expect(shown().at(-1).querySelector('.perm-origin').textContent).toBe('https://two.test');
    P.expired({ id: 'nope' });
    expect(P._queue).toHaveLength(1);
  });

  it('an answer main no longer takes (timed out) says so instead of "Allowed"', async () => {
    window.vex.permissionRespond = vi.fn(async () => ({ ok: false, error: 'No pending request' }));
    P.showPrompt({ id: 'old', origin: 'https://one.test', permission: 'geolocation' });
    click('true');
    await flush();
    expect(window.showToast).toHaveBeenCalledWith(expect.stringMatching(/Could not answer .*No pending request/), 'error', 4000);
  });
});

function ipcMessage(channel) {
  const e = new Event('ipc-message');
  e.channel = channel;
  e.args = [];
  return e;
}

describe('Escape from inside the previewed page', () => {
  it('closes Peek, from its own webview only', async () => {
    window.VexTabPolicy = { partitionFor: (p) => p };
    const { VexPeek } = require('../../src/renderer/js/peek.js');
    VexPeek.open('https://example.com/');
    const wv = VexPeek._els.wv;
    const close = vi.spyOn(VexPeek, 'close');
    wv.dispatchEvent(ipcMessage('vex-other'));
    expect(close).not.toHaveBeenCalled();
    // A tab's webview sending the same message is nothing to do with Peek.
    const tab = document.createElement('webview');
    document.body.appendChild(tab);
    tab.dispatchEvent(ipcMessage('vex-escape'));
    expect(close).not.toHaveBeenCalled();
    wv.dispatchEvent(ipcMessage('vex-escape'));
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('closes Responsive Preview', () => {
    const { ResponsivePreview } = require('../../src/renderer/js/devtools-pack.js');
    ResponsivePreview.open('https://example.com/');
    const frames = document.querySelectorAll('#vex-responsive webview[data-rp]');
    expect(frames.length).toBeGreaterThan(1);
    frames[2].dispatchEvent(ipcMessage('vex-escape'));
    expect(document.getElementById('vex-responsive')).toBeNull();
  });
});

describe('the page preload reports an Escape the page left alone', () => {
  const SRC = fs.readFileSync(path.join(__dirname, '../../src/preload-webview.js'), 'utf8').replace(/\r\n/g, '\n');
  const start = SRC.indexOf('// === Escape the page left alone, told to the host ===');
  const block = SRC.slice(start, SRC.indexOf('})();', start) + 5);

  // Runs the block with a stand-in ipc, and hands back its keydown listener.
  function load(doc = { fullscreenElement: null, querySelector: () => null }) {
    const sendToHost = vi.fn();
    let listener = null;
    const win = { addEventListener: (t, fn) => { if (t === 'keydown') listener = fn; } };
    new Function('require', 'window', 'document', block)(() => ({ ipcRenderer: { sendToHost } }), win, doc);
    return { sendToHost, press: (over) => listener(Object.assign({ isTrusted: true, key: 'Escape', repeat: false, defaultPrevented: false }, over)) };
  }

  it('is in the file', () => { expect(start).toBeGreaterThan(-1); });

  it('sends vex-escape after the page has had the key and left it alone', async () => {
    const { sendToHost, press } = load();
    press();
    expect(sendToHost).not.toHaveBeenCalled(); // not before the page's own listeners
    await flush();
    expect(sendToHost).toHaveBeenCalledWith('vex-escape');
  });

  it('not when the page used it, made it up, or it closes a <dialog> / full screen', async () => {
    const a = load(); a.press({ defaultPrevented: true }); a.press({ isTrusted: false }); a.press({ key: 'a' }); a.press({ shiftKey: true });
    const b = load({ fullscreenElement: {}, querySelector: () => null }); b.press();
    const c = load({ fullscreenElement: null, querySelector: (s) => (s === 'dialog:modal' ? {} : null) }); c.press();
    await flush();
    expect(a.sendToHost).not.toHaveBeenCalled();
    expect(b.sendToHost).not.toHaveBeenCalled();
    expect(c.sendToHost).not.toHaveBeenCalled();
  });
});
