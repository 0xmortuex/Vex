// @vitest-environment jsdom
//
// The importer window's own sentences in Turkish (js/browser-import.js): a Turkish noun has no plural after a number, so "3 yer imi",
// and each message that glues English words together has a Turkish version beside it. English stays exactly as it was.
import { describe, it, expect, beforeEach } from 'vitest';

require('../../src/renderer/js/vex-icons.js');
globalThis.VexIcons = window.VexIcons;
require('../../src/renderer/js/i18n.js');
const { BrowserImport } = require('../../src/renderer/js/browser-import.js');

const tr = () => localStorage.setItem('vex.lang', JSON.stringify('tr'));
beforeEach(() => localStorage.clear());

describe('counts', () => {
  it('are English with a plural in English', () => {
    expect(BrowserImport._n(1, 'bookmark', 'bookmarks', 'yer imi')).toBe('1 bookmark');
    expect(BrowserImport._n(3, 'bookmark', 'bookmarks', 'yer imi')).toBe('3 bookmarks');
  });
  it('are a number and a singular noun in Turkish, with a Turkish thousands mark', () => {
    tr();
    expect(BrowserImport._n(1, 'bookmark', 'bookmarks', 'yer imi')).toBe('1 yer imi');
    expect(BrowserImport._n(1500, 'visit', 'visits', 'ziyaret')).toBe('1.500 ziyaret');
  });
  it('fall back to English when a call gives no Turkish noun', () => {
    tr();
    expect(BrowserImport._n(2, 'item', 'items')).toBe('2 items');
  });
});

describe('the one line per import', () => {
  const r = { browserName: 'Opera GX', profileName: 'Default', at: Date.UTC(2026, 9, 21, 12, 0), added: { bookmarks: 4, history: 10 } };
  it('is English in English', () => {
    expect(BrowserImport.describeImport(r)).toMatch(/^Bookmarks and history from Opera GX \(Default\) · .* · 4 bookmarks, 10 visits$/);
    expect(BrowserImport.describeLoginImport({ browserName: 'Opera GX', file: 'p.csv', at: r.at, logins: [{}, {}] })).toMatch(/^Passwords from Opera GX \(p\.csv\) · .* · 2 logins$/);
  });
  it('is Turkish in Turkish', () => {
    tr();
    expect(BrowserImport.describeImport(r)).toMatch(/^Yer imleri ve geçmiş — Opera GX \(Default\) · .* · 4 yer imi, 10 ziyaret$/);
    expect(BrowserImport.describeLoginImport({ browserName: 'Opera GX', file: 'p.csv', at: r.at, logins: [{}, {}] })).toMatch(/^Parolalar — Opera GX \(p\.csv\) · .* · 2 giriş$/);
  });
});

describe('the password export steps', () => {
  it('cover Opera GX and Opera, and the window lists them', () => {
    expect(BrowserImport.CSV_STEPS['opera-gx']).toMatch(/opera:\/\/settings\/passwords/);
    expect(BrowserImport.CSV_STEPS.opera).toMatch(/opera:\/\/settings\/passwords/);
  });
});
