// @vitest-environment jsdom
//
// The setup wizard's order (sidebar question before the starting point) and the "Pick a font" step, which is in the FULL setup only.
// The font is written on Save; Skip leaves it. Whether the typeface really changes is checked in the real window, not here.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';

require('../../src/renderer/js/vex-utils.js');
require('../../src/renderer/js/vex-icons.js');
globalThis.VexIcons = window.VexIcons;
globalThis.VexFonts = require('../../src/renderer/js/fonts.js').VexFonts;
const { Onboarding } = require('../../src/renderer/js/onboarding.js');

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  document.documentElement.removeAttribute('data-vex-font');
  document.documentElement.style.cssText = '';
  globalThis.WebviewManager = { webviews: new Map() };
  Onboarding.step = 0; Onboarding._session = {}; Onboarding._pace = null; Onboarding._pendingFont = undefined;
});

const keys = (list) => list.map(s => s.key);

describe('step order', () => {
  it('asks the sidebar question right before "Choose your starting point", in both versions', () => {
    const all = keys(Onboarding.STEPS());
    expect(all.indexOf('sidebar')).toBe(all.indexOf('setupstyle') - 1);
    const quick = keys(Onboarding.STEPS().filter(s => s.quick));
    expect(quick.indexOf('sidebar')).toBe(quick.indexOf('setupstyle') - 1);
    expect(Onboarding.STEPS().find(s => s.key === 'setupstyle').title).toBe('Choose your starting point');
  });

  it('still asks the sidebar question before the look, which it steers', () => {
    const all = keys(Onboarding.STEPS());
    expect(all.indexOf('sidebar')).toBeLessThan(all.indexOf('look'));
  });

  it('puts the font in the full setup only, right after the look', () => {
    const all = keys(Onboarding.STEPS());
    expect(all.indexOf('font')).toBe(all.indexOf('look') + 1);
    Onboarding._pace = 'quick';
    expect(keys(Onboarding._stepsForPace())).not.toContain('font');
    Onboarding._pace = 'full';
    expect(keys(Onboarding._stepsForPace())).toContain('font');
  });
});

describe('the font step', () => {
  const render = () => { const body = document.createElement('div'); document.body.appendChild(body); Onboarding._renderFont(body); return body; };
  const overlayAtFont = () => {
    const overlay = document.createElement('div'); overlay.innerHTML = '<div id="ob-body"></div>'; document.body.appendChild(overlay);
    Onboarding.activeSteps = Onboarding.STEPS();
    Onboarding.step = Onboarding.activeSteps.findIndex(s => s.key === 'font');
    return overlay;
  };

  it('offers readable fonts from the Settings list, with the current one chosen and a preview line', () => {
    const body = render();
    const ids = [...body.querySelectorAll('[data-font]')].map(b => b.dataset.font);
    expect(ids.length).toBeGreaterThan(3);
    for (const id of ids) expect(VexFonts.get(id)).not.toBeNull();
    expect(ids.every(id => VexFonts.get(id).kind !== 'mono')).toBe(true);
    expect(body.querySelector('[aria-pressed="true"]').dataset.font).toBe('times');   // the shipped default
    expect(body.querySelector('#ob-font-preview').textContent.length).toBeGreaterThan(10);
  });

  it('a click moves the preview but writes nothing', () => {
    const body = render();
    body.querySelector('[data-font="verdana"]').click();
    expect(body.querySelector('#ob-font-preview').style.fontFamily).toMatch(/Verdana/);
    expect(body.querySelector('[data-font="verdana"]').getAttribute('aria-pressed')).toBe('true');
    expect(localStorage.getItem('vex.font')).toBe(null);
  });

  it('Save applies the pick through VexFonts and marks the step done', async () => {
    const overlay = overlayAtFont();
    expect(Onboarding._isStepDone('font')).toBe(false);
    render().querySelector('[data-font="calibri"]').click();
    const r = vi.spyOn(Onboarding, '_render').mockImplementation(() => {});
    await Onboarding._commitAndNext('font', overlay);
    expect(localStorage.getItem('vex.font')).toBe('calibri');
    expect(VexFonts.current().id).toBe('calibri');
    expect(Onboarding._isStepDone('font')).toBe(true);
    r.mockRestore();
  });

  it('Skip leaves the font untouched', () => {
    const overlay = overlayAtFont();
    render().querySelector('[data-font="arial"]').click();
    const r = vi.spyOn(Onboarding, '_render').mockImplementation(() => {});
    Onboarding._skip('font', overlay);
    expect(localStorage.getItem('vex.font')).toBe(null);
    expect(VexFonts.current().id).toBe('times');
    r.mockRestore();
  });

  it('has a Turkish title, explanation and sample line, each defined once', () => {
    const src = readFileSync('src/renderer/js/i18n.js', 'utf8');
    for (const k of ["    font: '", "'font.sub': '", "fontSample: '"]) expect(src.split(k).length).toBe(2);
  });
});
