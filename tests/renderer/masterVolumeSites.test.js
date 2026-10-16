// @vitest-environment jsdom
//
// T2-003: a level kept for one site, used instead of the level for every site;
// the warning above 100%; the weekly reminder in the Attention Inbox.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { VexIcons } = require('../../src/renderer/js/vex-icons.js');
globalThis.VexIcons = VexIcons; window.VexIcons = VexIcons;
require('../../src/renderer/js/vex-utils.js');
require('../../src/renderer/js/site-volume.js');
const { MasterVolume } = require('../../src/renderer/js/master-volume.js');

const wvAt = (url) => ({ getURL: () => url, isConnected: true });

beforeEach(() => {
  MasterVolume.close();
  document.body.innerHTML = '';
  localStorage.clear();
  delete window.vexGuestUrl;
  window.vexGuestEvalFrames = vi.fn(async () => ({ results: [] }));
  window.showToast = vi.fn();
  delete globalThis.VexAttention;
  delete globalThis.TabManager;
});

describe('levels kept per site', () => {
  it('uses the kept level for that site and the level for every site elsewhere', () => {
    localStorage.setItem('vex.masterVolume', '2.5');
    MasterVolume.setSiteLevel('https://www.quiet-videos.com/watch?v=1', 3.5);
    expect(MasterVolume.levelFor('https://quiet-videos.com/x')).toBe(3.5);
    expect(MasterVolume.levelFor('https://cdn.quiet-videos.com/x')).toBe(3.5);
    expect(MasterVolume.levelFor('https://loud-site.com/')).toBe(2.5);
  });

  it('a site kept at 100% is not boosted by a 250% level for every site', () => {
    localStorage.setItem('vex.masterVolume', '2.5');
    MasterVolume.setSiteLevel('https://loud-site.com/', 1);
    expect(MasterVolume.needsApply(wvAt('https://loud-site.com/'))).toBe(false);
    expect(MasterVolume.needsApply(wvAt('https://other.com/'))).toBe(true);
  });

  it('applies the kept level to its page, not the level for every site', () => {
    localStorage.setItem('vex.masterVolume', '2.5');
    MasterVolume.setSiteLevel('https://quiet.com/', 4);
    MasterVolume.applyToWebview(wvAt('https://quiet.com/a'));
    expect(window.vexGuestEvalFrames.mock.calls[0][1]).toContain('})(4);');
    MasterVolume.applyToWebview(wvAt('https://other.com/a'));
    expect(window.vexGuestEvalFrames.mock.calls[1][1]).toContain('})(2.5);');
  });

  it('the slider moves every page except a site that keeps its own level', () => {
    const quiet = wvAt('https://quiet.com/');
    const other = wvAt('https://other.com/');
    MasterVolume.setSiteLevel('https://quiet.com/', 4);
    MasterVolume._allWebviews = () => [quiet, other];
    MasterVolume.apply(1.5);
    const codes = window.vexGuestEvalFrames.mock.calls.map(c => c[1]);
    expect(codes[0]).toContain('})(4);');
    expect(codes[1]).toContain('})(1.5);');
    expect(MasterVolume.level()).toBe(1.5);
  });

  it('switched off, every site follows the level for every site and nothing is forgotten', () => {
    MasterVolume.setSiteLevel('https://quiet.com/', 4);
    MasterVolume.setSiteMemoryEnabled(false);
    expect(MasterVolume.siteLevel('https://quiet.com/')).toBe(null);
    MasterVolume.setSiteMemoryEnabled(true);
    expect(MasterVolume.siteLevel('https://quiet.com/')).toBe(4);
  });

  it('forgets one site', () => {
    MasterVolume.setSiteLevel('https://quiet.com/', 4);
    expect(MasterVolume.forgetSite('quiet.com')).toBe(true);
    expect(MasterVolume.forgetSite('quiet.com')).toBe(false);
  });

  it('refuses a level out of range and a non-web page, and raises a damaged record', () => {
    expect(() => MasterVolume.setSiteLevel('https://a.com/', 9)).toThrow(/between/);
    expect(() => MasterVolume.setSiteLevel('about:blank', 1)).toThrow(/web page/);
    localStorage.setItem('vex.masterVolume.sites', '{nope');
    expect(() => MasterVolume.sites()).toThrow(/could not be read/);
  });
});

describe('the box', () => {
  it('warns above 100% and offers to keep the level for the site in front', () => {
    globalThis.TabManager = { getActiveTab: () => ({ url: 'https://quiet.com/watch' }) };
    MasterVolume.show();
    const pop = document.querySelector('.mastervol-pop');
    expect(pop.querySelector('.mastervol-warn').hidden).toBe(true);
    const slider = pop.querySelector('.mastervol-slider');
    slider.value = 250;
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    expect(pop.querySelector('.mastervol-warn').hidden).toBe(false);
    slider.dispatchEvent(new Event('change', { bubbles: true }));
    const keep = pop.querySelector('.mastervol-keep');
    expect(keep.textContent).toBe('Keep 250% for quiet.com');
    keep.click();
    expect(MasterVolume.siteLevel('https://quiet.com/')).toBe(2.5);
    expect(pop.querySelector('.mastervol-keepnote').textContent).toContain('keeps its own level: 250%');
    MasterVolume.close();
  });
});

describe('the reminder', () => {
  it('speaks once a week, only above 100%', () => {
    const suggest = vi.fn(() => true);
    globalThis.VexAttention = { suggest };
    expect(MasterVolume.warnIfLoud(1e12)).toBe(false);
    localStorage.setItem('vex.masterVolume', '2.5');
    expect(MasterVolume.warnIfLoud(1e12)).toBe(true);
    expect(suggest.mock.calls[0][0].title).toContain('250%');
    expect(MasterVolume.warnIfLoud(1e12 + 86400000)).toBe(false);
    expect(MasterVolume.warnIfLoud(1e12 + 8 * 86400000)).toBe(true);
  });
  it('stays quiet when the kept levels are switched off', () => {
    globalThis.VexAttention = { suggest: vi.fn() };
    localStorage.setItem('vex.masterVolume', '2.5');
    MasterVolume.setSiteMemoryEnabled(false);
    expect(MasterVolume.warnIfLoud(1e12)).toBe(false);
  });
});
