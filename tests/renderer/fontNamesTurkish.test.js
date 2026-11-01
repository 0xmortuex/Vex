// @vitest-environment jsdom
//
// A font's name is never translated ("Georgia" is also the Turkish word for the country), and the font cards' descriptions
// have Turkish. Whether the setup wizard shows it is checked in the real window.
import { describe, it, expect, beforeEach } from 'vitest';

const { VexI18nUI } = require('../../src/renderer/js/i18n-ui.js');
const { VexFonts } = require('../../src/renderer/js/fonts.js');

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  localStorage.setItem('vex.lang', JSON.stringify('tr'));
});

describe('font cards in Turkish', () => {
  it('keeps every font name as it is, and translates only the description', () => {
    document.body.innerHTML = '<div id="top-bar">' + VexFonts.FONTS.map(f =>
      `<button><span id="n-${f.id}" class="vexfont-name"${VexFonts.nameAttrs(f)}>${f.name}</span><span id="d-${f.id}" class="vexfont-note">${f.note}</span></button>`).join('') + '</div>';
    VexI18nUI.apply();
    for (const f of VexFonts.FONTS) {
      if (f.id === 'system') continue;
      expect(document.getElementById('n-' + f.id).textContent, f.name).toBe(f.name);
    }
    expect(document.getElementById('n-georgia').textContent).toBe('Georgia');
  });

  it('has Turkish for every font description and for "Your system font"', () => {
    for (const f of VexFonts.FONTS) {
      expect(VexI18nUI.lookup(f.note, 'tr'), f.note).toBeTruthy();
    }
    expect(VexI18nUI.lookup('Your system font', 'tr')).toBe('Sistem yazı tipiniz');
    document.body.innerHTML = '<div id="top-bar"><span id="s" class="vexfont-name">Your system font</span></div>';
    VexI18nUI.apply();
    expect(document.getElementById('s').textContent).toBe('Sistem yazı tipiniz');
  });
});
