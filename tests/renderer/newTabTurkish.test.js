// The New Tab page (start.html) is its own document: the app's dictionary cannot reach it, so it carries its own Turkish.
// Behaviour was checked in real Chromium (a Turkish run and an English run, no console errors); this guards the wiring.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

const html = fs.readFileSync('src/renderer/start.html', 'utf8').replace(/\r\n/g, '\n');

describe('the New Tab page speaks Turkish when Vex is set to it', () => {
  it('writes its date in the chosen language, not always in English', () => {
    expect(html).toContain("now.toLocaleDateString(START_TR ? 'tr-TR' : 'en-US', options);");
    expect(html).not.toContain("toLocaleDateString('en-US', options)");
  });
  it('translates the Brief buttons, tooltips and its own words through one helper', () => {
    expect(html).toContain("'<span>' + T('Refresh') + '</span>'");
    expect(html).toContain("'<span>' + T('Sections') + '</span>'");
    expect(html).toMatch(/var STR = \{[^}]*'Refresh': 'Yenile'[^}]*'Sections': 'Bölümler'/);
  });
  it('has a word table for the weather box, the recent list and the location dialog', () => {
    for (const pair of ["'My Tools': 'Araçlarım'", "'Weather': 'Hava durumu'", "'Set your city': 'Şehrinizi seçin'", "'Recent': 'Son açılanlar'", "'Cancel': 'İptal'"]) expect(html).toContain(pair);
  });
  it('never translates common single words inside your own content', () => {
    expect(html).toContain("const START_USER = '.recent-item, .shortcut-card:not(.add), #today-list, .brief-card';");
    expect(html).toContain("inUserArea && START_SHORT.has(t) ? null : START_STR[t]");
  });
  it('shows the country names in Turkish from the browser\'s own data', () => {
    expect(html).toContain("new Intl.DisplayNames(['tr'], { type: 'region' })");
  });
  it('translates the shortcut dialog and the Add tile', () => {
    expect(html).toContain("(START_TR ? 'Ekle' : 'Add')");
    expect(html).toContain('trShortcutDialog(modal);');
    expect(html).toContain("START_TR ? e.name + ' ile ara…' : 'Search with ' + e.name + '…'");
  });
  it('does nothing at all in English', () => {
    expect(html).toContain('function startTranslate(root) {\n      if (!START_TR || !root || root.nodeType !== 1) return;');
    expect(html).toContain('if (START_TR) {\n      // Parts of the page are drawn later');
  });
});
