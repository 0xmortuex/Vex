// @vitest-environment jsdom
//
// The address bar shows the address Vex's own error pages stand for, as
// Chrome does. HTTPS-Only's "no secure connection" page and the certificate
// pages are data: pages (main.js, _showVexPage), which the tab ignores by
// design (reading mode's snapshot is one too), so the bar kept the address of
// the page the person came from. Main now says which address each of its
// pages stands for, and only for the page it is still showing.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
const path = require('path');

const { createVexPageAddresses } = require('../../src/main/vex-page-address.js');
require('../../src/renderer/js/vex-utils.js');
const { WebviewManager } = require('../../src/renderer/js/webview.js');

const read = f => fs.readFileSync(path.resolve(f), 'utf8').replace(/\r\n/g, '\n');

function fakeContents(id, url) {
  const c = new EventEmitter();
  c.id = id; c.url = url;
  c.getURL = () => c.url;
  c.isDestroyed = () => false;
  return c;
}

describe('main remembers which address a Vex page stands for', () => {
  it('answers while the tab still shows that page, and not after', () => {
    const pages = createVexPageAddresses();
    const c = fakeContents(7, 'data:text/html;charset=utf-8,X');
    pages.set(c, 'data:text/html;charset=utf-8,X', 'http://plain.example/a?b');
    expect(pages.addressOf(c)).toBe('http://plain.example/a?b');
    c.url = 'http://plain.example/a?b';           // "Continue", or Back
    expect(pages.addressOf(c)).toBeNull();
  });

  it('Back to an older Vex page in the same tab still knows its address', () => {
    const pages = createVexPageAddresses();
    const c = fakeContents(10, 'data:one');
    pages.set(c, 'data:one', 'http://plain.example/');
    c.url = 'data:two';
    pages.set(c, 'data:two', 'https://bad-cert.example/x');
    c.url = 'data:one';   // Back
    expect(pages.addressOf(c)).toBe('http://plain.example/');
  });

  it('a data: page main did not show (reading mode, one typed) stands for nothing', () => {
    const pages = createVexPageAddresses();
    expect(pages.addressOf(fakeContents(8, 'data:text/html,<p>reader</p>'))).toBeNull();
  });

  it('only a web address can be stood for, and a closed tab is forgotten', () => {
    const pages = createVexPageAddresses();
    const c = fakeContents(9, 'data:x');
    expect(() => pages.set(c, 'data:x', 'javascript:alert(1)')).toThrow(/web address/);
    pages.set(c, 'data:x', 'https://bad-cert.example/');
    c.emit('destroyed');
    c.url = 'data:x';
    expect(pages.addressOf(c)).toBeNull();
  });

  it('main.js records each page with the address it stands for and answers the tab', () => {
    const MAIN = read('src/main.js');
    const show = MAIN.slice(MAIN.indexOf('function _showVexPage('), MAIN.indexOf('function _showVexPage(') + 900);
    expect(show).toMatch(/function _showVexPage\(contents, html, failedUrl, what, standsFor\)/);
    expect(show).toContain('_vexPages.set(contents, dataUrl, standsFor)');
    expect(MAIN).toContain("_showVexPage(contents, _httpsOnly.noHttpsPage(u.host, httpUrl), validatedURL, 'no-HTTPS page', httpUrl)");
    expect(MAIN).toContain("_showVexPage(contents, _httpsOnly.certErrorPage(u.host, desc), validatedURL, 'certificate page', validatedURL)");
    expect(MAIN).toContain("_showVexPage(contents, _httpsCertNotice(u.host, httpUrl), validatedURL, 'certificate notice', validatedURL)");
    expect(MAIN).toMatch(/ipcMain\.handle\('tabs:vex-page-address', \(_e, id\) =>/);
    expect(read('src/main/ipc-policy.js')).toMatch(/TARGET_CHANNELS = new Set\(\[[^\]]*'tabs:vex-page-address'/);
    expect(read('src/main/ipc-schemas.js')).toMatch(/define\('[^']*tabs:vex-page-address[^']*', \[integer\]\)/);
    expect(read('src/preload.js')).toContain("vexPageAddress: (id) => ipcRenderer.invoke('tabs:vex-page-address', id)");
  });
});

describe('the tab shows that address', () => {
  let tab;
  beforeEach(() => {
    tab = { id: 't1', url: 'https://came-from.example/' };
    globalThis.TabManager = { tabs: [tab], updateTab: vi.fn((id, data) => Object.assign(tab, data)) };
  });

  it('a Vex page: the bar shows the address it stands for, and nothing goes into history', async () => {
    const dataUrl = 'data:text/html;charset=utf-8,%3C!doctype';
    const wv = { getWebContentsId: () => 42, getURL: () => dataUrl };
    window.vex = { vexPageAddress: vi.fn(async () => 'http://plain.example/') };
    const changed = vi.fn();
    window.addEventListener('vex:tab-url-changed', changed);
    await WebviewManager._showVexPageAddress(tab, wv, dataUrl);
    expect(window.vex.vexPageAddress).toHaveBeenCalledWith(42);
    expect(TabManager.updateTab).toHaveBeenCalledWith('t1', { url: 'http://plain.example/' });
    expect(changed).toHaveBeenCalled();
    window.removeEventListener('vex:tab-url-changed', changed);
  });

  it("any other data: page (reading mode's) leaves the tab as it was", async () => {
    const wv = { getWebContentsId: () => 42, getURL: () => 'data:text/html,reader' };
    window.vex = { vexPageAddress: vi.fn(async () => null) };
    await WebviewManager._showVexPageAddress(tab, wv, 'data:text/html,reader');
    expect(TabManager.updateTab).not.toHaveBeenCalled();
    expect(tab.url).toBe('https://came-from.example/');
  });

  it('an answer that comes after the tab moved on is dropped', async () => {
    let now = 'data:text/html,vexpage';
    const wv = { getWebContentsId: () => 42, getURL: () => now };
    window.vex = { vexPageAddress: vi.fn(async () => { now = 'https://next.example/'; return 'http://plain.example/'; }) };
    await WebviewManager._showVexPageAddress(tab, wv, 'data:text/html,vexpage');
    expect(TabManager.updateTab).not.toHaveBeenCalled();
  });

  it('did-navigate asks for it before leaving a data: page alone', () => {
    const src = read('src/renderer/js/webview.js');
    expect(src).toMatch(/if \(\/\^data:\/i\.test\(url\)\) this\._showVexPageAddress\(tab, webview, url\)[^\n]*\n[^\n]*if \(\/\^about:blank\\b\/i\.test\(url\) \|\| \/\^data:\/i\.test\(url\)\) return;/);
  });
});
