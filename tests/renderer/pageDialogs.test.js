// @vitest-environment jsdom
//
// js/page-dialogs.js — a page's alert / confirm / prompt is shown over that
// page's own tab or panel, never over the whole window; a tab that is not on
// screen gets a marker and the question when it is shown.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
const fs = require('fs');
const path = require('path');

let answers, listeners;
function webview(id, { shown = true } = {}) {
  const wv = document.createElement('webview');
  wv.getWebContentsId = () => id;
  wv.__shown = shown;
  wv.getBoundingClientRect = () => (wv.__shown ? { left: 100, top: 50, width: 800, height: 600 } : { left: 0, top: 0, width: 0, height: 0 });
  document.getElementById('webviews-container').appendChild(wv);
  return wv;
}

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '<div id="webviews-container"></div><div class="tab-item" data-tab-id="t2"><button class="tab-close"></button></div><div class="sidebar-icon" data-panel="prime"></div>';
  answers = [];
  listeners = {};
  window.vex = {
    onPageDialog: (cb) => { listeners.show = cb; },
    onPageDialogClose: (cb) => { listeners.close = cb; },
    pageDialogAnswer: (p) => answers.push(p),
  };
  globalThis.VexIcons = { svg: () => '<svg></svg>' };
  if (!globalThis.CSS) globalThis.CSS = {};
  if (!globalThis.CSS.escape) globalThis.CSS.escape = (s) => String(s);
  globalThis.WebviewManager = { webviews: new Map() };
  globalThis.SidebarManager = { panelWebviews: {} };
  delete window.PageDialogs;
  vi.resetModules();
  const file = path.join(__dirname, '../../src/renderer/js/page-dialogs.js');
  // A classic script in the window, as index.html loads it.
  new Function(fs.readFileSync(file, 'utf8'))();
});
// Each test loads the script afresh; the last one's questions are closed so its
// watcher does not mark the next test's tabs.
afterEach(() => {
  for (const e of [...window.PageDialogs.waiting]) listeners.close({ id: e.d.id });
  vi.useRealTimers();
});

const ask = (d) => listeners.show({ id: 'q1', guestId: 7, type: 'alert', message: 'Hello <b>there</b>', value: '', origin: 'example.com', offerStop: false, ...d });

describe('a page dialog in Vex', () => {
  it('covers only that page\'s area, beside its webview, with the text as text', () => {
    const wv = webview(7);
    WebviewManager.webviews.set('t1', wv);
    ask({});
    const overlay = document.querySelector('.vex-page-dialog-overlay');
    expect(overlay).toBeTruthy();
    expect(overlay.previousElementSibling).toBe(wv);
    expect(overlay.style.width).toBe('800px');
    expect(overlay.style.height).toBe('600px');
    expect(document.querySelector('.vex-dialog-overlay')).toBe(null);   // not the window-wide one
    expect(overlay.querySelector('.vex-page-dialog-msg').textContent).toBe('Hello <b>there</b>');
    expect(overlay.querySelector('b')).toBe(null);
    expect(overlay.querySelector('.vex-dialog-title').textContent).toBe('example.com says');
  });

  it('OK and Cancel answer confirm; the typed text answers prompt', () => {
    const wv = webview(7);
    WebviewManager.webviews.set('t1', wv);
    ask({ type: 'confirm' });
    document.querySelector('[data-cancel]').click();
    expect(answers.at(-1)).toEqual({ id: 'q1', ok: false, stop: false });
    ask({ id: 'q2', type: 'prompt', value: 'default' });
    const input = document.querySelector('.vex-page-dialog-overlay input[type=text]');
    expect(input.value).toBe('default');
    input.value = 'Ann';
    document.querySelector('[data-ok]').click();
    expect(answers.at(-1)).toEqual({ id: 'q2', ok: true, stop: false, value: 'Ann' });
    expect(document.querySelector('.vex-page-dialog-overlay')).toBe(null);
  });

  it('Escape cancels a confirm, Enter accepts a prompt', () => {
    const wv = webview(7);
    WebviewManager.webviews.set('t1', wv);
    ask({ type: 'confirm' });
    document.querySelector('.vex-page-dialog-overlay').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(answers.at(-1).ok).toBe(false);
    ask({ id: 'q2', type: 'prompt', value: 'v' });
    document.querySelector('.vex-page-dialog-overlay input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(answers.at(-1)).toEqual({ id: 'q2', ok: true, stop: false, value: 'v' });
  });

  it('a background tab is marked, and asks when it is shown', () => {
    const wv = webview(7, { shown: false });
    WebviewManager.webviews.set('t2', wv);
    ask({});
    expect(document.querySelector('.vex-page-dialog-overlay')).toBe(null);
    const mark = document.querySelector('.tab-item[data-tab-id="t2"] > .vex-page-dialog-mark');
    expect(mark).toBeTruthy();
    expect(mark.nextElementSibling.classList.contains('tab-close')).toBe(true);
    wv.__shown = true;
    vi.advanceTimersByTime(300);
    expect(document.querySelector('.vex-page-dialog-overlay').hidden).toBe(false);
    expect(document.querySelector('.vex-page-dialog-mark')).toBe(null);
    // Away again: hidden and marked, still waiting.
    wv.__shown = false;
    vi.advanceTimersByTime(300);
    expect(document.querySelector('.vex-page-dialog-overlay').hidden).toBe(true);
    expect(document.querySelector('.vex-page-dialog-mark')).toBeTruthy();
    expect(answers).toEqual([]);
  });

  it('a hidden panel is marked on its icon', () => {
    const wv = webview(7, { shown: false });
    SidebarManager.panelWebviews.prime = wv;
    ask({});
    expect(document.querySelector('.sidebar-icon[data-panel="prime"] > .vex-page-dialog-mark.icon-badge')).toBeTruthy();
  });

  it('a hidden page that is no tab or panel is answered as cancelled at once', () => {
    webview(7, { shown: false });
    ask({ type: 'confirm' });
    expect(answers).toEqual([{ id: 'q1', ok: false, stop: false }]);
  });

  it('offers to stop more dialogs, and says so in the answer', () => {
    const wv = webview(7);
    WebviewManager.webviews.set('t1', wv);
    ask({ offerStop: true });
    const box = document.querySelector('.vex-page-dialog-stop input[type=checkbox]');
    box.checked = true;
    document.querySelector('[data-ok]').click();
    expect(answers.at(-1)).toEqual({ id: 'q1', ok: true, stop: true });
  });

  it('main taking it away (tab closed) removes the question and the marker', () => {
    const wv = webview(7, { shown: false });
    WebviewManager.webviews.set('t2', wv);
    ask({});
    listeners.close({ id: 'q1' });
    expect(document.querySelector('.vex-page-dialog-mark')).toBe(null);
    expect(window.PageDialogs.waiting.length).toBe(0);
    expect(answers).toEqual([]);
  });
});

// The Prime panel freeze (2026-10-05): the video was in fullscreen in the
// panel when Prime asked. The question was drawn under the fullscreen page,
// everything else in the window was inert behind it, and nothing in Vex could
// be clicked. A question may only hold the keys and the page's pointer while
// it can be seen; otherwise a marker and a card in the corner say where it is.
describe('a question nobody can see holds nothing', () => {
  let fsEl;
  beforeEach(() => {
    fsEl = null;
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fsEl });
    document.exitFullscreen = vi.fn(() => { fsEl = null; return Promise.resolve(); });
    window.VexProblems = { note: vi.fn() };
    SidebarManager.panelLabel = (n) => (n === 'prime' ? 'Prime Video' : n);
    SidebarManager.showPanel = vi.fn();
    SidebarManager.activePanel = null;
    SidebarManager.sidePanel = null;
  });
  afterEach(() => {
    delete document.fullscreenElement;
    delete window.VexProblems;
  });
  const card = () => document.querySelector('.vex-page-dialog-card');

  it('a page in fullscreen leaves it, then is asked over its panel with the keys', async () => {
    const wv = webview(7);
    SidebarManager.panelWebviews.prime = wv;
    wv.focus = () => {};
    fsEl = wv;
    document.exitFullscreen = vi.fn(() => Promise.resolve());   // leaves on the next change
    ask({ type: 'confirm' });
    expect(document.exitFullscreen).toHaveBeenCalledTimes(1);
    // While it is still fullscreen the question is not on screen and takes nothing.
    expect(wv.style.pointerEvents).toBe('');
    expect(document.querySelector('.vex-page-dialog-overlay')).toBe(null);
    fsEl = null;
    document.dispatchEvent(new Event('fullscreenchange'));
    const overlay = document.querySelector('.vex-page-dialog-overlay');
    expect(overlay.hidden).toBe(false);
    expect(wv.style.pointerEvents).toBe('none');
    expect(overlay.contains(document.activeElement)).toBe(true);
    expect(card().hidden).toBe(true);
    // Only once, however often it is refreshed meanwhile.
    expect(document.exitFullscreen).toHaveBeenCalledTimes(1);
  });

  it('another page in fullscreen covers this one: no pointer taken, card shown', () => {
    const wv = webview(7);
    WebviewManager.webviews.set('t2', wv);
    fsEl = document.createElement('webview');
    document.body.appendChild(fsEl);
    ask({});
    expect(document.exitFullscreen).not.toHaveBeenCalled();
    expect(wv.style.pointerEvents).toBe('');
    expect(document.querySelector('.tab-item[data-tab-id="t2"] > .vex-page-dialog-mark')).toBeTruthy();
    expect(card().hidden).toBe(false);
  });

  it('out of sight: no focus, the page gets its pointer back, Enter and Escape answer nothing', () => {
    const wv = webview(7);
    SidebarManager.panelWebviews.prime = wv;
    ask({ type: 'confirm' });
    const overlay = document.querySelector('.vex-page-dialog-overlay');
    expect(overlay.contains(document.activeElement)).toBe(true);
    expect(wv.style.pointerEvents).toBe('none');
    wv.__shown = false;   // the panel is closed
    window.PageDialogs._refresh();
    expect(overlay.contains(document.activeElement)).toBe(false);
    expect(wv.style.pointerEvents).toBe('');
    overlay.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    overlay.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(answers).toEqual([]);
  });

  it('a page outside the window, or made invisible, is not on screen', () => {
    const wv = webview(7);
    WebviewManager.webviews.set('t2', wv);
    wv.getBoundingClientRect = () => ({ left: -5000, top: 50, width: 800, height: 600 });
    ask({});
    expect(document.querySelector('.vex-page-dialog-overlay')).toBe(null);
    expect(wv.style.pointerEvents).toBe('');
    wv.getBoundingClientRect = () => ({ left: 100, top: 50, width: 800, height: 600 });
    wv.checkVisibility = () => false;   // an ancestor at opacity 0
    window.PageDialogs._refresh();
    expect(document.querySelector('.vex-page-dialog-overlay')).toBe(null);
    wv.checkVisibility = () => true;
    window.PageDialogs._refresh();
    expect(document.querySelector('.vex-page-dialog-overlay').hidden).toBe(false);
  });

  it('a hidden panel\'s question is named in the corner; Open shows the panel and its question', () => {
    const wv = webview(7, { shown: false });
    SidebarManager.panelWebviews.prime = wv;
    SidebarManager.showPanel = vi.fn(() => { wv.__shown = true; });
    ask({ type: 'confirm', origin: 'www.primevideo.com' });
    const c = card();
    expect(c.hidden).toBe(false);
    expect(c.getAttribute('role')).toBe('status');
    expect(c.querySelector('.vex-page-dialog-card-title').textContent).toBe('Prime Video asks a question');
    expect(c.querySelector('.vex-page-dialog-card-sub').textContent).toBe('www.primevideo.com says');
    expect(c.contains(document.activeElement)).toBe(false);   // it takes no keys
    c.querySelector('.vex-page-dialog-card-open').click();
    expect(SidebarManager.showPanel).toHaveBeenCalledWith('prime');
    const overlay = document.querySelector('.vex-page-dialog-overlay');
    expect(overlay.hidden).toBe(false);
    expect(overlay.contains(document.activeElement)).toBe(true);
    expect(c.hidden).toBe(true);
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(answers.at(-1)).toEqual({ id: 'q1', ok: false, stop: false });
    expect(document.querySelector('.vex-page-dialog-card').hidden).toBe(true);
  });

  it('a click on the dimmed area keeps the keys with the question', () => {
    const wv = webview(7);
    WebviewManager.webviews.set('t1', wv);
    ask({ type: 'confirm' });
    const overlay = document.querySelector('.vex-page-dialog-overlay');
    document.body.focus();
    overlay.querySelector('[data-ok]').blur();
    overlay.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    expect(overlay.contains(document.activeElement)).toBe(true);
  });

  it('every question is noted in Problems: host, place, kind, first 200 characters', () => {
    const wv = webview(7);
    SidebarManager.panelWebviews.prime = wv;
    ask({ type: 'confirm', origin: 'www.primevideo.com', message: 'x'.repeat(500) });
    expect(window.VexProblems.note).toHaveBeenCalledWith('Page dialog', 'confirm() from www.primevideo.com in the Prime Video panel', 'x'.repeat(200));
    ask({ id: 'q2', guestId: 8, origin: '', message: 'hi' });   // a page that is no tab or panel
    expect(window.VexProblems.note).toHaveBeenLastCalledWith('Page dialog', 'alert() from a local page in a page outside any tab', 'hi');
  });
});

describe('Vex\'s own interface never uses the native boxes', () => {
  it('no window.alert / confirm / prompt in the renderer scripts', () => {
    const dir = path.join(__dirname, '../../src/renderer/js');
    const hits = [];
    for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.js'))) {
      const lines = fs.readFileSync(path.join(dir, f), 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (/^\s*(\/\/|\*)/.test(line)) return;
        // Not in a regular expression (|confirm(?:...) or a string of HTML (>alert().
        if (/(?<![\w.$'"`|>-])(window\.)?(alert|confirm|prompt)\((?!\?)/.test(line) && !/\b(vexConfirm|vexPrompt|vexAlert)\b/.test(line)) hits.push(`${f}:${i + 1}: ${line.trim()}`);
      });
    }
    // chat-file.js has a method named prompt(doc) — its own, not the window's.
    expect(hits.filter(h => !/chat-file\.js:\d+: prompt\(doc\) \{/.test(h)), hits.join('\n')).toEqual([]);
  });
});
