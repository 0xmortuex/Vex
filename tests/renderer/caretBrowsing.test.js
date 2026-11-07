// @vitest-environment jsdom
//
// Caret browsing (F7): Chromium's own switch does nothing in this build (probed in a real <webview>), so Vex draws and moves the
// caret itself. The movement is proved in real Chromium by a throwaway Electron probe (Selection.modify needs a layout engine);
// these cover the window's side (F7, the question, the choice kept, every page told) and the shape of the page's side.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(__dirname, '../..');
let VexCaretBrowsing;

function fakeWebview({ attached = true } = {}) {
  const listeners = {};
  const wv = document.createElement('webview');
  wv._attached = attached;
  wv.send = vi.fn();
  wv.addEventListener = (ev, fn) => { (listeners[ev] ||= []).push(fn); };
  wv.fire = (ev) => (listeners[ev] || []).forEach(fn => fn());
  document.body.appendChild(wv);
  return wv;
}

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  window.showToast = vi.fn();
  globalThis.vexConfirm = vi.fn(async () => true);
  delete require.cache[require.resolve('../../src/renderer/js/caret-browsing.js')];
  ({ VexCaretBrowsing } = require('../../src/renderer/js/caret-browsing.js'));
});

describe('the window side', () => {
  it('starts off, and a damaged saved value means off', () => {
    expect(VexCaretBrowsing.enabled()).toBe(false);
    localStorage.setItem('vex.caretBrowsing', '{nope');
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(VexCaretBrowsing.enabled()).toBe(false);
    expect(err).toHaveBeenCalled();
  });

  it('turning it on asks first (the way Chrome does), then tells every open page', async () => {
    const a = fakeWebview(), b = fakeWebview();
    expect(await VexCaretBrowsing.toggle()).toBe(true);
    expect(vexConfirm).toHaveBeenCalledTimes(1);
    expect(vexConfirm.mock.calls[0][0].title).toBe('Turn on caret browsing?');
    expect(VexCaretBrowsing.enabled()).toBe(true);
    expect(a.send).toHaveBeenCalledWith('vex-caret', true);
    expect(b.send).toHaveBeenCalledWith('vex-caret', true);
  });

  it('"Cancel" leaves it off and tells nobody', async () => {
    const a = fakeWebview();
    vexConfirm.mockResolvedValueOnce(false);
    expect(await VexCaretBrowsing.toggle()).toBe(false);
    expect(VexCaretBrowsing.enabled()).toBe(false);
    expect(a.send).not.toHaveBeenCalled();
  });

  it('turning it off needs no question and tells every page', async () => {
    const a = fakeWebview();
    VexCaretBrowsing.set(true);
    a.send.mockClear();
    expect(await VexCaretBrowsing.toggle()).toBe(false);
    expect(vexConfirm).not.toHaveBeenCalled();
    expect(a.send).toHaveBeenCalledWith('vex-caret', false);
    expect(VexCaretBrowsing.enabled()).toBe(false);
  });

  it('a page that is not attached yet is skipped, and told when it is ready (and again after each navigation)', () => {
    VexCaretBrowsing.set(true);
    const wv = fakeWebview({ attached: false });
    VexCaretBrowsing.attach(wv);
    VexCaretBrowsing.attach(wv); // twice is once
    VexCaretBrowsing.set(true);
    expect(wv.send).not.toHaveBeenCalled();
    wv._attached = true;
    wv.fire('dom-ready');
    wv.fire('dom-ready');
    expect(wv.send).toHaveBeenCalledTimes(2);
    expect(wv.send).toHaveBeenCalledWith('vex-caret', true);
  });

  it('a page loaded while it is off is not told anything', () => {
    const wv = fakeWebview();
    VexCaretBrowsing.attach(wv);
    wv.fire('dom-ready');
    expect(wv.send).not.toHaveBeenCalled();
  });

  it('a real send failure is not swallowed, a "not ready yet" one is', () => {
    const wv = fakeWebview();
    wv.send = vi.fn(() => { throw new Error('The WebView must be attached to the DOM and the dom-ready event emitted before this method can be called.'); });
    expect(() => VexCaretBrowsing._tell(wv, true)).not.toThrow();
    wv.send = vi.fn(() => { throw new Error('boom'); });
    expect(() => VexCaretBrowsing._tell(wv, true)).toThrow('boom');
  });

  it('init (the module loads after the window) wires the pages already open and tells them when it was left on', () => {
    localStorage.setItem('vex.caretBrowsing', JSON.stringify({ on: true }));
    const wv = fakeWebview();
    VexCaretBrowsing.init();
    expect(wv.send).toHaveBeenCalledWith('vex-caret', true);
    wv.send.mockClear();
    wv.fire('dom-ready');
    expect(wv.send).toHaveBeenCalledWith('vex-caret', true);
  });
});

describe('wiring', () => {
  const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
  it('F7 is the default key and runs the Ctrl+K command', () => {
    const SR = require('../../src/renderer/js/shortcuts-registry.js');
    window.vex = { setGuestShortcutKeys: vi.fn() };
    globalThis.CommandBar = { commands: [] };
    SR.init();
    expect(SR.getShortcut('caret-browsing')).toBe('F7');
    expect(SR.getAllShortcuts()['caret-browsing'].cmd).toBe('caret-browsing');
  });
  it('the command, the late-module entry and the webview hook exist, and index.html has no tag for it', () => {
    expect(read('src/renderer/js/command.js')).toMatch(/\{ id: 'caret-browsing', label: 'Caret Browsing'/);
    expect(read('src/renderer/js/lazy-boot.js')).toMatch(/src: 'js\/caret-browsing\.js'/);
    expect(read('src/renderer/js/webview.js')).toMatch(/VexCaretBrowsing\.attach\(webview\)/);
    expect(read('src/renderer/index.html')).not.toMatch(/caret-browsing\.js/);
  });
  it('the page preload reads vex-caret, leaves text fields and handled keys alone, and never reads Alt/Meta', () => {
    const src = read('src/preload-webview.js');
    const block = src.slice(src.indexOf('// === Caret browsing (js/caret-browsing.js)'));
    expect(block).toMatch(/ipcRenderer\.on\("vex-caret"/);
    expect(block).toMatch(/e\.defaultPrevented/);
    expect(block).toMatch(/e\.metaKey \|\| e\.altKey/);
    expect(block).toMatch(/isTrusted/);
    expect(block).toMatch(/INPUT\|TEXTAREA\|SELECT/);
    expect(block).toMatch(/sel\.modify\(e\.shiftKey \? "extend" : "move"/);
    expect(block).toMatch(/prefers-reduced-motion/);
    expect(block).toMatch(/forced-colors/);
  });
});
