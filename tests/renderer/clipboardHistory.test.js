// @vitest-environment jsdom
//
// The clipboard holds one thing and the last copy wins. Every clipboard manager
// fixes that by watching the system clipboard — and so also records what you
// copy out of your password manager, your bank and your terminal.
//
// This one sees exactly one thing: text copied off a web page. What it may keep
// and where it may keep it is the whole design, so that is what is tested here.

import { beforeEach, describe, expect, it, vi } from 'vitest';
require('../../src/renderer/js/vex-utils.js');
const { ClipboardHistory } = require('../../src/renderer/js/clipboard-history.js');

// A webview that reports copies the way preload-webview.js does.
function fakeWebview(url = 'https://shop.example/orders', partition = 'persist:main') {
  const handlers = {};
  return {
    getURL: () => url,
    getAttribute: (n) => (n === 'partition' ? partition : null),
    addEventListener: (ev, fn) => { (handlers[ev] ||= []).push(fn); },
    copies(text, extra = {}) {
      (handlers['ipc-message'] || []).forEach(fn => fn({ channel: 'vex-copy', args: [{ text, ...extra }] }));
    },
    says(channel, payload) {
      (handlers['ipc-message'] || []).forEach(fn => fn({ channel, args: [payload] }));
    },
  };
}

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  window.showToast = vi.fn();
  window.VexTabPolicy = { canReadWebview: (wv) => !String(wv.getAttribute('partition') || '').match(/^(tor-|private)/) && wv.getAttribute('partition')?.startsWith('persist:') };
  Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => {}) } });
  ClipboardHistory.recent = [];
  ClipboardHistory.pinned = [];
  ClipboardHistory.init();
});

describe('what it records', () => {
  it('keeps what you copied, newest first, with where it came from', () => {
    const wv = fakeWebview();
    ClipboardHistory.attach(wv);
    wv.copies('DHL 1234567890', { title: 'Orders' });
    wv.copies('12 Bridge Street', { title: 'Orders' });
    expect(ClipboardHistory.list().map(i => i.text)).toEqual(['12 Bridge Street', 'DHL 1234567890']);
    expect(ClipboardHistory.list()[0].host).toBe('shop.example');
  });

  it('copying the same thing again moves it up instead of duplicating it', () => {
    const wv = fakeWebview();
    ClipboardHistory.attach(wv);
    wv.copies('again');
    wv.copies('other');
    wv.copies('again');
    expect(ClipboardHistory.list().map(i => i.text)).toEqual(['again', 'other']);
  });

  it('ignores whitespace-only copies and anything absurdly long', () => {
    const wv = fakeWebview();
    ClipboardHistory.attach(wv);
    wv.copies('   \n  ');
    wv.copies('x'.repeat(ClipboardHistory.MAX_LEN + 1));
    expect(ClipboardHistory.list()).toEqual([]);
  });

  it('forgets the oldest once it is full rather than growing without end', () => {
    const wv = fakeWebview();
    ClipboardHistory.attach(wv);
    for (let i = 0; i < ClipboardHistory.MAX + 10; i++) wv.copies('entry ' + i);
    expect(ClipboardHistory.recent).toHaveLength(ClipboardHistory.MAX);
    expect(ClipboardHistory.recent[0].text).toBe('entry ' + (ClipboardHistory.MAX + 9));
  });

  it('pays no attention to other things a page says', () => {
    const wv = fakeWebview();
    ClipboardHistory.attach(wv);
    wv.says('vex-gesture', 'LR');
    wv.says('vex-selection', { text: 'not a copy' });
    expect(ClipboardHistory.list()).toEqual([]);
  });
});

describe('what it refuses to record', () => {
  it('a private tab leaves nothing behind, and that includes this', () => {
    const wv = fakeWebview('https://shop.example/x', 'private-1');
    ClipboardHistory.attach(wv);
    wv.copies('something private');
    expect(ClipboardHistory.list()).toEqual([]);
  });

  it('nor a Tor tab', () => {
    const wv = fakeWebview('https://example.onion/x', 'tor-1');
    ClipboardHistory.attach(wv);
    wv.copies('something else');
    expect(ClipboardHistory.list()).toEqual([]);
  });

  it('nothing at all when the feature is turned off', () => {
    ClipboardHistory.setEnabled(false);
    const wv = fakeWebview();
    ClipboardHistory.attach(wv);
    wv.copies('anything');
    expect(ClipboardHistory.list()).toEqual([]);
    ClipboardHistory.setEnabled(true);
    expect(ClipboardHistory.enabled()).toBe(true);
  });

  it('turning it off drops what was already held, rather than merely hiding it', () => {
    const wv = fakeWebview();
    ClipboardHistory.attach(wv);
    wv.copies('held');
    ClipboardHistory.setEnabled(false);
    expect(ClipboardHistory.recent).toEqual([]);
  });
});

describe('what survives closing Vex', () => {
  it('nothing, until you pin it', () => {
    const wv = fakeWebview();
    ClipboardHistory.attach(wv);
    wv.copies('forgettable');
    wv.copies('worth keeping');
    expect(localStorage.getItem(ClipboardHistory.PIN_KEY)).toBe(null);

    const keep = ClipboardHistory.list().find(i => i.text === 'worth keeping');
    ClipboardHistory.pin(keep.id);

    // A fresh session: memory is gone, the pin is not.
    ClipboardHistory.recent = [];
    ClipboardHistory.pinned = [];
    ClipboardHistory.init();
    expect(ClipboardHistory.list().map(i => i.text)).toEqual(['worth keeping']);
    expect(ClipboardHistory.list()[0].pinned).toBe(true);
  });

  it('a pinned entry is not listed twice when it is also still recent', () => {
    const wv = fakeWebview();
    ClipboardHistory.attach(wv);
    wv.copies('one thing');
    ClipboardHistory.pin(ClipboardHistory.recent[0].id);
    expect(ClipboardHistory.list()).toHaveLength(1);
    expect(ClipboardHistory.list()[0].pinned).toBe(true);
  });

  it('unpinning stops it surviving, and pinning twice is not two pins', () => {
    const wv = fakeWebview();
    ClipboardHistory.attach(wv);
    wv.copies('maybe');
    const id = ClipboardHistory.recent[0].id;
    ClipboardHistory.pin(id);
    ClipboardHistory.pin(id);
    expect(ClipboardHistory.pinned).toHaveLength(1);
    ClipboardHistory.unpin(id);
    expect(ClipboardHistory.pinned).toEqual([]);
    expect(localStorage.getItem(ClipboardHistory.PIN_KEY)).toBe('[]');
  });

  it('clear means clear — the session and the disk', () => {
    const wv = fakeWebview();
    ClipboardHistory.attach(wv);
    wv.copies('a'); wv.copies('b');
    ClipboardHistory.pin(ClipboardHistory.recent[0].id);
    ClipboardHistory.clear();
    expect(ClipboardHistory.list()).toEqual([]);
    expect(localStorage.getItem(ClipboardHistory.PIN_KEY)).toBe(null);
  });

  it('will not pin something that is gone', () => {
    expect(() => ClipboardHistory.pin('nope')).toThrow(/gone/);
  });
});

describe('putting one back', () => {
  it('writes it to the clipboard and treats that as a fresh copy', async () => {
    const wv = fakeWebview();
    ClipboardHistory.attach(wv);
    wv.copies('first');
    wv.copies('second');
    const first = ClipboardHistory.list().find(i => i.text === 'first');

    await ClipboardHistory.use(first.id);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('first');
    expect(ClipboardHistory.list().map(i => i.text)).toEqual(['first', 'second']);
    expect(window.showToast).toHaveBeenCalled();
  });

  it('says so when the entry has gone', async () => {
    await expect(ClipboardHistory.use('nope')).rejects.toThrow(/gone/);
  });

  it('shortens a long copy to one line for display, without altering it', () => {
    const item = { text: 'a very long\n  line   with  gaps '.repeat(10) };
    const shown = ClipboardHistory.preview(item, 30);
    expect(shown).toHaveLength(30);
    expect(shown.endsWith('…')).toBe(true);
    expect(shown).not.toContain('\n');
    expect(item.text).toContain('\n');            // the entry itself is untouched
  });
});

describe('the list you can browse', () => {
  beforeEach(() => {
    window.escapeHtml = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    window.VexIcons = { svg: () => '<svg></svg>' };
  });

  it('shows each entry and copies the one you click', async () => {
    const wv = fakeWebview();
    ClipboardHistory.attach(wv);
    wv.copies('click me');
    ClipboardHistory.openPicker();
    const row = document.querySelector('.vex-clip-box [data-list] > div');
    expect(row.textContent).toContain('click me');
    expect(row.textContent).toContain('shop.example');
    row.click();
    await vi.waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith('click me'));
  });

  it('a copied page title cannot become markup in the list', () => {
    const wv = fakeWebview();
    ClipboardHistory.attach(wv);
    wv.copies('<img src=x onerror=alert(1)>');
    ClipboardHistory.openPicker();
    const list = document.querySelector('[data-list]');
    expect(list.querySelector('img')).toBe(null);
    expect(list.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('Escape closes it and stops listening', () => {
    ClipboardHistory.openPicker();
    expect(document.querySelector('.vex-clip-overlay')).not.toBe(null);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('.vex-clip-overlay')).toBe(null);
  });

  it('opening it twice does not leave two of them', () => {
    ClipboardHistory.openPicker();
    ClipboardHistory.openPicker();
    expect(document.querySelectorAll('.vex-clip-overlay')).toHaveLength(1);
  });

  it('says plainly that there is nothing yet', () => {
    ClipboardHistory.openPicker();
    expect(document.querySelector('[data-list]').textContent).toMatch(/Nothing copied yet/);
  });
});
