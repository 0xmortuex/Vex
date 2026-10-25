// @vitest-environment jsdom
//
// Quick look (js/download-quicklook.js). Wiring and pure logic only: how it LOOKS is checked in the real app
// (jsdom resolves no var() and no layout).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(__dirname, '..', '..');
const SRC = fs.readFileSync(path.join(ROOT, 'src/renderer/js/download-quicklook.js'), 'utf8');
const { VexI18nUI } = require('../../src/renderer/js/i18n-ui.js');

let DownloadsPanel, VexQuickLook;
const dl = (over = {}) => ({ id: 'd' + Math.random().toString(36).slice(2), filename: 'a.png', url: 'https://example.com/a.png', state: 'completed', path: 'C:\\Dl\\a.png', totalBytes: 10, receivedBytes: 10, startedAt: new Date().toISOString(), ...over });

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  document.body.innerHTML = '<div id="panel-downloads"></div>';
  globalThis.window.escapeHtml = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  globalThis.VexIcons = { svg: (n) => `<svg data-i="${n}"></svg>` };
  window.VexIcons = globalThis.VexIcons;
  window.vex = { downloadsPeek: vi.fn(async (p) => ({ ok: true, kind: 'text', name: 'a.txt', ext: 'txt', size: 3, modified: Date.now(), text: 'hello' })), downloadsShowInFolder: vi.fn(), downloadsOpenFile: vi.fn(async () => ({ ok: true })), downloadsPeekHash: vi.fn(async () => ({ ok: true, sha256: 'a'.repeat(64) })), fileInspect: vi.fn(async () => ({ ok: true, verdict: 'unsigned', lines: ['No signature.'] })) };
  window.showToast = vi.fn();
  ({ DownloadsPanel } = require('../../src/renderer/js/downloads-panel.js'));
  globalThis.DownloadsPanel = DownloadsPanel;
  ({ VexQuickLook } = require('../../src/renderer/js/download-quicklook.js'));
  globalThis.VexQuickLook = VexQuickLook;
  DownloadsPanel._renderShell(document.getElementById('panel-downloads'));
  DownloadsPanel._bindListKeys(document.getElementById('downloads-list'));
});
afterEach(() => { VexQuickLook.close(); VexQuickLook.closeMenu(); delete globalThis.VexQuickLook; delete globalThis.DownloadsPanel; });

const flush = () => new Promise(r => setTimeout(r, 0));
const key = (el, k, opt = {}) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opt }));

describe('Turkish', () => {
  it('every visible English string in the module has a Turkish entry', () => {
    const found = [...SRC.matchAll(/T\('((?:[^'\\]|\\.)*)'\)/g)].map(m => m[1].replace(/\\'/g, "'"));
    expect(found.length).toBeGreaterThan(60);
    const missing = found.filter(s => VexI18nUI.lookup(s, 'tr') == null);
    expect(missing).toEqual([]);
    for (const extra of ['Quick look (Space)', 'Quick look is still loading. Try again in a moment.']) expect(VexI18nUI.lookup(extra, 'tr')).not.toBeNull();
  });
  it('the sentences with a changing part fill in and translate', () => {
    expect(VexI18nUI.lookup('Showing the first 5 pages of 12', 'tr')).toBe('12 sayfanın ilk 5 sayfası gösteriliyor');
    expect(VexI18nUI.lookup('3 items inside', 'tr')).toBe('İçinde 3 öğe var');
    expect(VexI18nUI.lookup('Page 2', 'tr')).toBe('Sayfa 2');
  });
});

describe('which downloads it walks through', () => {
  it('only finished ones that are still on disk, in the order the panel shows them, skipping rows a search hides', () => {
    const a = dl({ filename: 'a.txt' }), b = dl({ filename: 'b.txt', missing: true }), c = dl({ filename: 'c.txt', state: 'failed' }), d = dl({ filename: 'd.txt' }), e = dl({ filename: 'e.txt' });
    DownloadsPanel.downloads = [a, b, c, d, e];
    DownloadsPanel.renderList();
    DownloadsPanel._query = 'e.txt'; DownloadsPanel._applyFilter();
    expect(VexQuickLook.open(a.id)).toBe(false);                // a is hidden by the search
    DownloadsPanel._query = ''; DownloadsPanel._applyFilter();
    expect(VexQuickLook.open(a.id)).toBe(true);
    expect(VexQuickLook._state().count).toBe(3);                // a, d, e
    expect(VexQuickLook.open(b.id)).toBe(false);                // b was deleted
  });
  it('a deleted or unfinished download cannot be looked at', () => {
    const b = dl({ missing: true }), c = dl({ state: 'progressing' });
    DownloadsPanel.downloads = [b, c]; DownloadsPanel.renderList();
    expect(VexQuickLook.open(b.id)).toBe(false);
    expect(VexQuickLook.open(c.id)).toBe(false);
    expect(window.showToast).toHaveBeenCalled();
  });
});

describe('the keys', () => {
  let a, b, row;
  beforeEach(async () => {
    a = dl({ filename: 'a.txt', path: 'C:\\Dl\\a.txt' }); b = dl({ filename: 'b.txt', path: 'C:\\Dl\\b.txt' });
    DownloadsPanel.downloads = [a, b]; DownloadsPanel.renderList();
    row = DownloadsPanel._rowFor(a.id);
  });
  it('Space on a focused row opens it; the arrows on rows move focus, one row is the tab stop', async () => {
    expect(row.tabIndex).toBe(0);
    expect(DownloadsPanel._rowFor(b.id).tabIndex).toBe(-1);
    key(row, 'ArrowDown');
    expect(document.activeElement).toBe(DownloadsPanel._rowFor(b.id));
    expect(DownloadsPanel._rowFor(b.id).tabIndex).toBe(0); expect(row.tabIndex).toBe(-1);
    key(row, ' ');
    await flush();
    expect(document.querySelector('.dlql-ov')).toBeTruthy();
    expect(window.vex.downloadsPeek).toHaveBeenCalledWith('C:\\Dl\\a.txt');
    expect(document.querySelector('.dlql-card').getAttribute('role')).toBe('dialog');
    expect(document.querySelector('.dlql-title').textContent).toBe('a.txt');
  });
  it('Space on a button inside the row does not open Quick look', () => {
    const open = row.querySelector('[data-action="open-file"]');
    key(open, ' ');
    expect(document.querySelector('.dlql-ov')).toBeNull();
  });
  it('Right and Left move between downloads, Esc closes and focus returns to the row', async () => {
    key(row, ' '); await flush();
    const card = document.querySelector('.dlql-card');
    key(card, 'ArrowRight'); await flush();
    expect(document.querySelector('.dlql-title').textContent).toBe('b.txt');
    expect(document.querySelector('.dlql-pos').textContent).toBe('2 / 2');
    key(card, 'ArrowLeft'); await flush();
    expect(document.querySelector('.dlql-title').textContent).toBe('a.txt');
    key(card, 'ArrowLeft'); await flush();
    expect(document.querySelector('.dlql-title').textContent).toBe('b.txt');            // wraps
    key(card, 'Escape');
    expect(document.querySelector('.dlql-ov')).toBeNull();
    expect(document.activeElement).toBe(DownloadsPanel._rowFor(b.id));
  });
  it('Enter opens with Windows through the panel\'s own check', async () => {
    key(row, ' '); await flush();
    key(document.querySelector('.dlql-card'), 'Enter'); await flush(); await flush();
    expect(window.vex.downloadsOpenFile).toHaveBeenCalledWith('C:\\Dl\\a.txt');
  });
});

describe('a program is never opened from here', () => {
  it('Enter does nothing, there is no Open button, and the card says what it is', async () => {
    const exe = dl({ filename: 'setup.exe', path: 'C:\\Dl\\setup.exe', fileCheck: { checked: true, worst: 'high', findings: [{ level: 'high', kind: 'x', text: 'Looks like a document but is a program' }], note: '' } });
    DownloadsPanel.downloads = [exe]; DownloadsPanel.renderList();
    window.vex.downloadsPeek.mockResolvedValue({ ok: true, kind: 'program', name: 'setup.exe', ext: 'exe', size: 10, modified: Date.now() });
    VexQuickLook.open(exe.id); await flush(); await flush();
    const ov = document.querySelector('.dlql-ov');
    expect(ov.querySelector('[data-act="open"]')).toBeNull();
    expect(ov.querySelector('[data-act="folder"]')).toBeTruthy();
    expect(ov.querySelector('.dlql-say').textContent).toMatch(/never runs a program/);
    expect(ov.querySelector('.dlql-warn').textContent).toMatch(/Looks like a document/);
    expect(window.vex.fileInspect).toHaveBeenCalledWith('C:\\Dl\\setup.exe', 'https://example.com/a.png');
    key(ov.firstElementChild, 'Enter'); await flush();
    expect(window.vex.downloadsOpenFile).not.toHaveBeenCalled();
    expect(window.showToast).toHaveBeenCalledWith(expect.stringMatching(/not opened from Quick look/), 'info');
  });
  it('the right-click menu of a program has no Open', () => {
    const exe = dl({ filename: 'x.msi', path: 'C:\\Dl\\x.msi' });
    VexQuickLook.menu(10, 10, exe);
    expect([...document.querySelectorAll('.dlql-mi')].map(b => b.dataset.mi)).toEqual(['look', 'folder', 'copy']);
  });
});

describe('what comes from a file is never markup', () => {
  it('text, file names and CSV cells are inserted as text', async () => {
    const t = dl({ filename: '<img src=x onerror=alert(1)>.txt', path: 'C:\\Dl\\t.txt' });
    DownloadsPanel.downloads = [t]; DownloadsPanel.renderList();
    window.vex.downloadsPeek.mockResolvedValue({ ok: true, kind: 'text', name: t.filename, ext: 'md', size: 5, modified: 1, text: '# <b>hi</b>\n\n<script>x</script> **bold** [l](javascript:alert(1))' });
    VexQuickLook.open(t.id); await flush(); await flush();
    const ov = document.querySelector('.dlql-ov');
    expect(ov.querySelector('.dlql-title img')).toBeNull();
    expect(ov.querySelector('script')).toBeNull();
    expect(ov.querySelector('b')).toBeNull();
    expect(ov.querySelector('a')).toBeNull();                    // a link is shown, never made clickable
    expect(ov.querySelector('.dlql-md strong').textContent).toBe('bold');
    expect(ov.textContent).toContain('<script>x</script>');
  });
  it('CSV: quotes, doubled quotes, semicolons, tabs and a row cap', () => {
    expect(VexQuickLook.parseCsv('a,b\n"x, y","he said ""hi"""\n', null)).toEqual([['a', 'b'], ['x, y', 'he said "hi"']]);
    expect(VexQuickLook.parseCsv('a;b;c\n1;2;3', null)[1]).toEqual(['1', '2', '3']);
    expect(VexQuickLook.parseCsv('a\tb\n1\t2', '\t')[1]).toEqual(['1', '2']);
    const many = Array.from({ length: 500 }, (_, i) => i + ',x').join('\n');
    expect(VexQuickLook.parseCsv(many, null).length).toBeLessThanOrEqual(201);
  });
});

describe('the SHA-256 and delete', () => {
  it('the hash is made only when asked', async () => {
    const a = dl({ filename: 'a.txt', path: 'C:\\Dl\\a.txt' });
    DownloadsPanel.downloads = [a]; DownloadsPanel.renderList();
    VexQuickLook.open(a.id); await flush();
    expect(window.vex.downloadsPeekHash).not.toHaveBeenCalled();
    document.querySelector('[data-act="hash"]').click(); await flush(); await flush();
    expect(window.vex.downloadsPeekHash).toHaveBeenCalledWith('C:\\Dl\\a.txt');
    expect(document.querySelector('.dlql-hash code').textContent).toBe('a'.repeat(64));
  });
  it('Delete goes through the panel\'s own confirmation', async () => {
    const a = dl({ filename: 'a.txt', path: 'C:\\Dl\\a.txt' });
    DownloadsPanel.downloads = [a]; DownloadsPanel.renderList();
    const spy = vi.spyOn(DownloadsPanel, '_deleteFile').mockImplementation(async () => {});
    VexQuickLook.open(a.id); await flush();
    document.querySelector('[data-act="delete"]').click(); await flush();
    expect(spy).toHaveBeenCalledWith(a.id);
    expect(document.querySelector('.dlql-ov')).toBeTruthy();       // kept: it stays open
  });
});

describe('Quick look is one door among the rest', () => {
  it('is a late module, not a blocking script', () => {
    const html = fs.readFileSync(path.join(ROOT, 'src/renderer/index.html'), 'utf8');
    expect(html).not.toMatch(/download-quicklook\.js/);
    expect(fs.readFileSync(path.join(ROOT, 'src/renderer/js/lazy-boot.js'), 'utf8')).toMatch(/js\/download-quicklook\.js/);
  });
  it('uses no emoji and no native dialogs', () => {
    expect(SRC).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
    expect(SRC).not.toMatch(/\b(?:confirm|prompt|alert)\(/);
  });
});
