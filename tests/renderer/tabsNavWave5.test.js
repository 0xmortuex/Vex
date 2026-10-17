// @vitest-environment jsdom
//
// Wave 5 additions to js/tabs-nav.js: the address bar's path menu and search-selection key (T2-065),
// the smart print name and the full-screen toolbar (T2-060), per-kind download defaults (T2-072).
import { describe, it, expect, beforeEach, vi } from 'vitest';

const N = require('../../src/renderer/js/tabs-nav.js');

beforeEach(() => {
  localStorage.clear();
  document.body.className = '';
  document.body.innerHTML = '';
  delete globalThis.TabManager; delete globalThis.WebviewManager; delete globalThis.VexTypedAddress;
});

describe('the levels of an address (T2-065)', () => {
  it('lists the site and each folder, without the query', () => {
    expect(N.segments('https://example.com/docs/api/v2?x=1#top')).toEqual([
      { label: 'example.com', url: 'https://example.com/' },
      { label: 'docs', url: 'https://example.com/docs' },
      { label: 'api', url: 'https://example.com/docs/api' },
      { label: 'v2', url: 'https://example.com/docs/api/v2' },
    ]);
    expect(N.segments('https://example.com/')).toHaveLength(1);
  });
  it('is empty for something that is not a web page', () => {
    expect(N.segments('about:blank')).toEqual([]);
    expect(N.segments('nonsense')).toEqual([]);
  });
  it('shows a menu under the bar; choosing a level goes there and closes the menu', () => {
    const bar = document.createElement('input'); document.body.appendChild(bar);
    const go = vi.fn();
    N.showSegments(bar, 'https://example.com/a/b', go);
    const items = [...document.querySelectorAll('#vex-address-path button')];
    expect(items.map(b => b.textContent)).toEqual(['example.com', 'a', 'b']);
    items[1].click();
    expect(go).toHaveBeenCalledWith('https://example.com/a');
    expect(document.getElementById('vex-address-path')).toBeNull();
  });
  it('Escape closes it, and an address with no levels is said', () => {
    const bar = document.createElement('input'); document.body.appendChild(bar);
    N.showSegments(bar, 'https://example.com/a', vi.fn());
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.getElementById('vex-address-path')).toBeNull();
    expect(() => N.showSegments(bar, 'about:blank', vi.fn())).toThrow(/no levels/);
  });
});

describe('search the selection (T2-065)', () => {
  const setupTabs = (selection) => {
    const created = [];
    globalThis.TabManager = { activeTabId: 1, createTab: (u) => created.push(u) };
    globalThis.WebviewManager = { webviews: new Map([[1, { executeJavaScript: async () => selection }]]) };
    globalThis.VexTypedAddress = { resolve: (t) => ({ url: 'https://search.example/?q=' + encodeURIComponent(t) }) };
    return created;
  };
  it('is off until Address bar extras is on', async () => {
    setupTabs('hello');
    await expect(N.searchSelection()).rejects.toThrow(/Address bar extras/);
  });
  it('opens the selected words in a new tab', async () => {
    const created = setupTabs('  two words ');
    N.setPref('addressExtras', true);
    expect(await N.searchSelection()).toBe('two words');
    expect(created).toEqual(['https://search.example/?q=two%20words']);
  });
  it('says so when nothing is selected', async () => {
    setupTabs('');
    N.setPref('addressExtras', true);
    await expect(N.searchSelection()).rejects.toThrow(/Select a few words/);
  });
});

describe('the smart print name (T2-060)', () => {
  const D = new Date(2026, 9, 17);
  it('is site - title - date', () => {
    expect(N.printName('Quarterly report', 'https://www.example.com/r/1', D)).toBe('example.com - Quarterly report - 2026-10-17');
  });
  it('drops a closing site name and the characters a file name cannot hold', () => {
    expect(N.printName('Invoice: 2026/10 | Example Shop', 'https://shop.example.com/', D)).toBe('shop.example.com - Invoice 2026 10 - 2026-10-17');
    expect(N.printName('A <b> "title"?', 'https://x.test/', D)).toBe('x.test - A b title - 2026-10-17');
  });
  it('keeps a title that is only the site name, and limits the length', () => {
    expect(N.printName('Example', 'https://example.com/', D)).toBe('example.com - Example - 2026-10-17');
    expect(N.printName('x'.repeat(300), 'https://example.com/', D).length).toBeLessThanOrEqual(90);
  });
  it('names the page while it prints, then puts the title back', async () => {
    N.setPref('smartPrint', true);
    const calls = [];
    const wv = { getURL: () => 'https://example.com/', executeJavaScript: async (code) => { calls.push(code); return code === 'document.title' ? 'Old title' : undefined; } };
    const restore = await N.namePrintJob(wv);
    expect(calls[1]).toMatch(/^document.title = "example.com - Old title - /);
    await restore();
    expect(calls[2]).toMatch(/document.title = "Old title"/);
  });
  it('does nothing when the extra is off', async () => {
    const wv = { getURL: () => 'https://example.com/', executeJavaScript: vi.fn() };
    expect(await N.namePrintJob(wv)).toBeNull();
    expect(wv.executeJavaScript).not.toHaveBeenCalled();
  });
});

describe('full screen with the toolbar one touch away (T2-060)', () => {
  it('marks the page only while the extra is on, and un-reveals when it goes off', () => {
    N.syncAutoHide();
    expect(document.body.classList.contains('chrome-autohide')).toBe(false);
    N.setPref('autoHideChrome', true);
    N.syncAutoHide();
    expect(document.body.classList.contains('chrome-autohide')).toBe(true);
    N.setReveal(true);
    expect(document.body.classList.contains('chrome-reveal')).toBe(true);
    N.setPref('autoHideChrome', false);
    N.syncAutoHide();
    expect(document.body.classList.contains('chrome-autohide')).toBe(false);
    expect(document.body.classList.contains('chrome-reveal')).toBe(false);
  });
  it('the rule only matches in full screen', () => {
    const fs = require('fs');
    const css = fs.readFileSync(require('path').resolve(__dirname, '../../src/renderer/css/tabs-nav.css'), 'utf8');
    expect(css).toMatch(/body\.fullscreen\.chrome-autohide #top-bar/);
    expect(css).not.toMatch(/(^|\n)body\.chrome-autohide #top-bar/);
  });
});

describe('what a finished download does by kind (T2-072)', () => {
  it('opens a PDF in a tab only when that is switched on', () => {
    expect(N.downloadAction('paper.PDF')).toBe('');
    N.setPref('downloadTypes', true);
    expect(N.downloadAction('paper.PDF')).toBe('tab');
    expect(N.downloadAction('setup.exe')).toBe('');
    expect(N.downloadAction('noext')).toBe('');
  });
  it('makes a file address from a Windows path', () => {
    expect(N.fileUrl('C:\\Users\\me\\Downloads\\a b#1.pdf')).toBe('file:///C:/Users/me/Downloads/a%20b%231.pdf');
  });
  it('opens it in a new tab and refuses a download with no path', () => {
    const created = [];
    globalThis.TabManager = { createTab: (u, a) => created.push([u, a]) };
    N.openDownloadInTab('C:\\d\\x.pdf');
    expect(created).toEqual([['file:///C:/d/x.pdf', true]]);
    expect(() => N.openDownloadInTab('')).toThrow(/no file/);
  });
  it('lists the installer kinds that ask where to save', () => {
    for (const k of ['exe', 'msi', 'msix']) expect(N.INSTALLER_KINDS).toContain(k);
    expect(N.kindOf('Setup.EXE')).toBe('exe');
  });
});

describe('Enter opens the newest finished-download card (T2-072)', () => {
  const { DownloadToast } = require('../../src/renderer/js/download-toast.js');
  const card = () => {
    document.body.innerHTML = '<div id="download-toast-container"><div class="download-toast"><button data-action="open"></button></div></div>';
    const btn = document.querySelector('[data-action="open"]');
    btn.click = vi.fn();
    return btn;
  };
  const enter = () => new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
  beforeEach(() => { globalThis.VexTabsNav = N; });
  it('is off until switched on', () => {
    const btn = card();
    expect(DownloadToast.enterOpens(enter())).toBe(false);
    expect(btn.click).not.toHaveBeenCalled();
  });
  it('clicks Open when on, and leaves a field you are typing in alone', () => {
    N.setPref('downloadEnter', true);
    const btn = card();
    const input = document.createElement('input'); document.body.appendChild(input); input.focus();
    expect(DownloadToast.enterOpens(enter())).toBe(false);
    input.blur();
    expect(DownloadToast.enterOpens(enter())).toBe(true);
    expect(btn.click).toHaveBeenCalledTimes(1);
  });
  it('does nothing without a card, and not for other keys or modifiers', () => {
    N.setPref('downloadEnter', true);
    document.body.innerHTML = '';
    expect(DownloadToast.enterOpens(enter())).toBe(false);
    card();
    expect(DownloadToast.enterOpens(new KeyboardEvent('keydown', { key: 'a' }))).toBe(false);
    expect(DownloadToast.enterOpens(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true }))).toBe(false);
  });
});
