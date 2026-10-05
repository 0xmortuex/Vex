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
