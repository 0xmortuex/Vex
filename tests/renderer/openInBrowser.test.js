// @vitest-environment jsdom
// The page and link menus' "open in another browser" rows (js/open-in-browser.js).
import { describe, it, expect, vi, beforeEach } from 'vitest';
const fs = require('fs'), path = require('path');
const { VexOpenIn } = require('../../src/renderer/js/open-in-browser.js');

const wv = (partition) => ({ getAttribute: () => partition });
beforeEach(() => {
  VexOpenIn.installed = [];
  window.showToast = vi.fn();
  window.vexConfirm = vi.fn(async () => true);
  window.vex = { openInBrowser: vi.fn(async () => ({ ok: true })) };
  window.VexTabPolicy = { isPrivateWindow: false, canReadWebview: (w) => !String(w.getAttribute() || '').startsWith('temp') };
});

describe('choices', () => {
  it('always has the default browser first, then only the installed known ones', () => {
    expect(VexOpenIn.choices([]).map(c => c.id)).toEqual(['default']);
    expect(VexOpenIn.choices([{ id: 'brave' }, { id: 'edge' }, { id: 'netscape' }]).map(c => c.id)).toEqual(['default', 'brave', 'edge']);
  });
  it('gives no rows for an address that is not http(s)', () => {
    expect(VexOpenIn.menuItems('file:///C:/x', wv('persist:main'))).toEqual([]);
    expect(VexOpenIn.menuItems('https://a.test/', wv('persist:main')).length).toBe(1);
  });
});

describe('open', () => {
  it('opens an ordinary tab without asking', async () => {
    expect(await VexOpenIn.open('https://a.test/', 'edge', wv('persist:main'))).toBe(true);
    expect(window.vexConfirm).not.toHaveBeenCalled();
    expect(window.vex.openInBrowser).toHaveBeenCalledWith('https://a.test/', 'edge');
  });
  it('asks first for a private, routed or disposable tab, and does nothing on No', async () => {
    window.vexConfirm = vi.fn(async () => false);
    expect(await VexOpenIn.open('https://a.test/', 'default', wv('temp-burner'))).toBe(false);
    expect(window.vexConfirm).toHaveBeenCalledTimes(1);
    expect(window.vex.openInBrowser).not.toHaveBeenCalled();
    window.vexConfirm = vi.fn(async () => true);
    expect(await VexOpenIn.open('https://a.test/', 'default', wv('temp-burner'))).toBe(true);
    expect(window.vex.openInBrowser).toHaveBeenCalledTimes(1);
  });
  it('asks in every tab of a private window', async () => {
    window.VexTabPolicy.isPrivateWindow = true;
    await VexOpenIn.open('https://a.test/', 'default', wv('persist:main'));
    expect(window.vexConfirm).toHaveBeenCalled();
  });
  it('refuses a non-web address before asking anything', async () => {
    expect(await VexOpenIn.open('file:///C:/x', 'default', wv('persist:main'))).toBe(false);
    expect(window.vex.openInBrowser).not.toHaveBeenCalled();
  });
  it('tells the person when main refuses', async () => {
    window.vex.openInBrowser = vi.fn(async () => ({ ok: false, error: 'That browser is not installed' }));
    expect(await VexOpenIn.open('https://a.test/', 'edge', wv('persist:main'))).toBe(false);
    expect(window.showToast).toHaveBeenCalledWith('That browser is not installed', 'error');
  });
});

describe('wiring', () => {
  const web = fs.readFileSync(path.join(__dirname, '../../src/renderer/js/webview.js'), 'utf8');
  it('the page menu and the link menu use it', () => {
    expect(web).toMatch(/VexOpenIn\.menuItems\(webview\.getURL\(\), webview\)/);
    expect(web).toMatch(/label: 'Open Link in Another Browser'/);
  });
  it('is loaded late, not from index.html', () => {
    expect(fs.readFileSync(path.join(__dirname, '../../src/renderer/js/lazy-boot.js'), 'utf8')).toContain("'js/open-in-browser.js'");
    expect(fs.readFileSync(path.join(__dirname, '../../src/renderer/index.html'), 'utf8')).not.toContain('open-in-browser.js');
  });
});
