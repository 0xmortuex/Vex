// @vitest-environment jsdom
// Fixed in the 2026-09-29 sweep (fin2): an Escape that closed the page's own
// popup no longer closes Peek too, Ctrl+Enter inside a peeked page opens it
// as a tab, a restored backup says "restored" rather than "synced", and a
// reminder's wall-clock time travels with it through sync.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const flush = () => new Promise(r => setTimeout(r, 0));
const fresh = (rel) => { const f = require.resolve(rel); delete require.cache[f]; return require(f); };

beforeEach(() => {
  document.body.innerHTML = '';
  window.showToast = vi.fn();
  globalThis.VexIcons = { svg: () => '<svg></svg>' };
  window.VexIcons = globalThis.VexIcons;
});
afterEach(() => { vi.restoreAllMocks(); });

describe('the page preload: Escape and Ctrl+Enter', () => {
  const SRC = fs.readFileSync(path.join(__dirname, '../../src/preload-webview.js'), 'utf8').replace(/\r\n/g, '\n');
  const start = SRC.indexOf('// === Escape the page left alone, told to the host ===');
  const block = SRC.slice(start, SRC.indexOf('})();', start) + 5);

  // The block with a stand-in ipc and page. `open` is the page's own dialog,
  // which the page's handler takes away before the bubbling listener runs.
  function load() {
    const sendToHost = vi.fn();
    const capture = [], bubble = [];
    const page = { open: null };
    const doc = {
      fullscreenElement: null,
      querySelector: () => null,
      querySelectorAll: (sel) => (page.open && /role="dialog"/.test(sel) ? [page.open] : []),
    };
    const win = {
      addEventListener: (t, fn, cap) => { if (t === 'keydown') (cap ? capture : bubble).push(fn); },
      getComputedStyle: () => ({ visibility: 'visible', display: 'block' }),
    };
    new Function('require', 'window', 'document', block)(() => ({ ipcRenderer: { sendToHost } }), win, doc);
    const press = (over, pageHandler) => {
      const e = Object.assign({ isTrusted: true, key: 'Escape', repeat: false, defaultPrevented: false, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false }, over);
      capture.forEach(fn => fn(e));
      if (pageHandler) pageHandler(e);
      bubble.forEach(fn => fn(e));
    };
    return { sendToHost, press, page };
  }

  it('is in the file', () => { expect(start).toBeGreaterThan(-1); });

  it('an Escape that closed the page\'s own popup (no preventDefault) is not sent', async () => {
    const t = load();
    t.page.open = { getClientRects: () => [{}] };
    t.press({}, () => { t.page.open = null; });   // the site closes its popup itself
    await flush();
    expect(t.sendToHost).not.toHaveBeenCalled();
  });

  it('a hidden dialog of the page does not count', async () => {
    const t = load();
    t.page.open = { getClientRects: () => [] };
    t.press();
    await flush();
    expect(t.sendToHost).toHaveBeenCalledWith('vex-escape');
  });

  it('an Escape with nothing of the page open is sent', async () => {
    const t = load();
    t.press();
    await flush();
    expect(t.sendToHost).toHaveBeenCalledWith('vex-escape');
  });

  it('Ctrl+Enter the page left alone is sent as vex-peek-promote', async () => {
    const t = load();
    t.press({ key: 'Enter', ctrlKey: true });
    t.press({ key: 'Enter', ctrlKey: true, defaultPrevented: true });
    t.press({ key: 'Enter' });
    await flush();
    expect(t.sendToHost).toHaveBeenCalledTimes(1);
    expect(t.sendToHost).toHaveBeenCalledWith('vex-peek-promote');
  });
});

function ipcMessage(channel) {
  const e = new Event('ipc-message');
  e.channel = channel;
  e.args = [];
  return e;
}

describe('Ctrl+Enter from inside the peeked page', () => {
  it('opens the peek as a tab, from its own webview only', () => {
    window.VexTabPolicy = { partitionFor: (p) => p };
    globalThis.TabManager = { createTab: vi.fn() };
    const { VexPeek } = fresh('../../src/renderer/js/peek.js');
    VexPeek.open('https://example.com/');
    const tab = document.createElement('webview');
    document.body.appendChild(tab);
    tab.dispatchEvent(ipcMessage('vex-peek-promote'));
    expect(TabManager.createTab).not.toHaveBeenCalled();
    VexPeek._els.wv.dispatchEvent(ipcMessage('vex-peek-promote'));
    expect(TabManager.createTab).toHaveBeenCalledWith('https://example.com/', true, null, { partition: 'persist:main' });
    delete globalThis.TabManager;
  });
});

describe('reminders through a backup and through sync', () => {
  let Q;
  beforeEach(() => {
    localStorage.clear();
    Q = fresh('../../src/renderer/js/quick-reminder.js').VexQuickReminder;
  });

  it('a restored backup says restored; a sync says synced', async () => {
    window.vex = { reminders: { import: vi.fn(async () => ({ added: 2, updated: 0 })), list: vi.fn(async () => []) } };
    Q._hostsChanged = () => {};
    localStorage.setItem(Q.MIRROR_KEY, JSON.stringify([{ id: 'a', message: 'x', at: Date.now() + 1e6 }]));
    await Q._applySynced('backup');
    expect(window.showToast).toHaveBeenLastCalledWith('Reminders restored — 2 new, 0 updated');
    localStorage.setItem(Q.MIRROR_KEY, JSON.stringify([{ id: 'a', message: 'x', at: Date.now() + 1e6 }]));
    await Q._applySynced();
    expect(window.showToast).toHaveBeenLastCalledWith('Reminders synced — 2 new, 0 updated');
  });

  it('the restore event is marked as one', () => {
    window.vex = {};
    const { VexBackup } = fresh('../../src/renderer/js/backup.js');
    const seen = vi.fn();
    window.addEventListener('vex-sync-data-applied', seen);
    VexBackup._reloadLive();
    window.removeEventListener('vex-sync-data-applied', seen);
    expect(seen.mock.calls[0][0].detail).toEqual({ source: 'backup' });
  });

  it('the synced copy keeps the wall-clock time a repeating reminder is set for', async () => {
    window.vex = { reminders: { list: vi.fn(async () => [{ id: 'a', message: 'stand-up', at: 1, repeat: 'daily', time: '09:30' }]) } };
    await Q._mirror();
    expect(JSON.parse(localStorage.getItem(Q.MIRROR_KEY))[0].time).toBe('09:30');
  });
});
