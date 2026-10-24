// @vitest-environment jsdom
// T2-065 (Wave 6): Shift+Enter in the address bar can open a full private window (tabs, toolbar, sidebar) on the address.
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const N = require('../../src/renderer/js/tabs-nav.js');
const { validate } = require('../../src/main/ipc-schemas.js');
const src = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');

beforeEach(() => localStorage.clear());

describe('the choice', () => {
  it('is a small app window until the person picks the private window, and remembers it', () => {
    expect(N.shiftEnterTarget()).toBe('app');
    expect(N.setShiftEnterTarget('private')).toBe('private');
    expect(N.shiftEnterTarget()).toBe('private');
    N.setShiftEnterTarget('app');
    expect(N.shiftEnterTarget()).toBe('app');
  });
  it('refuses anything else, and an unreadable value means the app window', () => {
    expect(() => N.setShiftEnterTarget('tab')).toThrow(/app window or a full private window/);
    localStorage.setItem(N.SHIFT_ENTER_KEY, 'something');
    expect(N.shiftEnterTarget()).toBe('app');
  });
  it('tells listeners', () => {
    let seen = null;
    document.addEventListener('vex:tabs-nav-changed', (e) => { seen = e.detail; }, { once: true });
    N.setShiftEnterTarget('private');
    expect(seen).toEqual({ name: 'shiftEnter', value: 'private' });
  });
});

describe('the private window gets the address', () => {
  it('the channel takes an optional web address as its third argument, and nothing else', () => {
    expect(() => validate('open-private-window', ['classic', 'full', 'https://example.com/a'])).not.toThrow();
    expect(() => validate('open-private-window', ['classic', 'full'])).not.toThrow();
    expect(() => validate('open-private-window', ['classic', 'full', 'file:///C:/x'])).toThrow(/Invalid payload/);
    expect(() => validate('open-private-window', ['classic', 'full', 'javascript:alert(1)'])).toThrow(/Invalid payload/);
  });
  it('main passes only an http(s) address to the window, and the window opens it as its first tab', () => {
    const main = src('src/main.js');
    expect(main).toMatch(/ipcMain\.handle\('open-private-window', \(_e, look, uiMode, url(?:, boot)?\) => openPrivateWindow\(\{[^}]*url: \/\^https\?:/);
    expect(main).toMatch(/\(clean \? \{ clean: 'true', url \} : \(url \? \{ url \} : \{\}\)\)/);
    expect(src('src/preload.js')).toMatch(/openPrivateWindow: \(look, uiMode, url(?:, boot)?\) =>/);
    expect(src('src/renderer/js/app.js')).toMatch(/isPrivateWindow && !window\.VexTabPolicy\.isCleanWindow[\s\S]{0,200}createTab\(wanted, true\)/);
  });
  it('Shift+Enter picks the window by the setting, and still needs the address bar extras', () => {
    const app = src('src/renderer/js/app.js');
    expect(app).toMatch(/newWindow && typeof VexTabsNav !== 'undefined' && VexTabsNav\.on\('addressExtras'\)/);
    expect(app).toMatch(/VexTabsNav\.shiftEnterTarget\(\) === 'private'[\s\S]{0,120}window\.vex\.openPrivateWindow\(VexGuiStyle\.get\(\), VexSimpleMode\.mode\(\), url(?:, window\.VexEarlyLook[^\n]*)?\)/);
  });
  it('has a settings row and an owner for its storage key', () => {
    expect(src('src/renderer/js/tabs-nav-settings.js')).toMatch(/setShiftEnterTarget\(seSel\.value\)/);
    expect(src('src/renderer/js/feature-manifests.js')).toMatch(/'vex\.tabsNav\.shiftEnter'/);
  });
});
