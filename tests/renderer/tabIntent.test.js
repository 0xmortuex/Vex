// @vitest-environment jsdom
//
// T2-022: why is this tab open — opener, search words, your reason, last visit (js/tab-intent.js).
import { describe, it, expect, beforeEach, vi } from 'vitest';

const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };
const NOW = new Date(2026, 9, 14, 14, 0, 0).getTime();

let I;
beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
  globalThis.VexPlanKit = fresh(JS + 'plan-kit.js').VexPlanKit;
  ({ VexTabIntent: I } = fresh(JS + 'tab-intent.js'));
  delete window.VexTabPolicy;
});

describe('queryOf()', () => {
  it('finds the words on the usual search pages', () => {
    expect(I.queryOf('https://www.google.com/search?q=css+grid+gap&hl=en')).toBe('css grid gap');
    expect(I.queryOf('https://duckduckgo.com/?q=xss+filter')).toBe('xss filter');
    expect(I.queryOf('https://www.youtube.com/results?search_query=lofi')).toBe('lofi');
    expect(I.queryOf('https://github.com/search?q=vencord')).toBe('vencord');
  });
  it('finds nothing on an ordinary page, a bad address or a non-web one', () => {
    expect(I.queryOf('https://example.com/?q=hello')).toBe('');
    expect(I.queryOf('not a url')).toBe('');
    expect(I.queryOf('file:///c:/a.html')).toBe('');
  });
});

describe('record() and lines()', () => {
  const opener = { id: 't1', title: 'css grid - Google Search', url: 'https://www.google.com/search?q=css+grid' };
  const tab = { id: 't2', url: 'https://css-tricks.com/grid', lastViewedAt: NOW - 2 * 3600000 };

  it('keeps the opener title and the words searched there', () => {
    const rec = I.record(tab, opener);
    expect(rec).toMatchObject({ fromTitle: 'css grid - Google Search', query: 'css grid' });
    expect(I.intentOf('t2')).toBe(rec);
    const lines = I.lines(tab, rec, null, NOW);
    expect(lines).toEqual([
      { label: 'From', text: 'css grid - Google Search' },
      { label: 'Searched', text: '"css grid"' },
      { label: 'Last visit', text: '2 h ago' },
    ]);
  });
  it('adds your own reason, and reads the words from a tab that is itself a search', () => {
    I.setWhy(tab, 'for the grid article');
    const lines = I.lines({ ...tab, url: 'https://duckduckgo.com/?q=subgrid' }, null, I.whyOf(tab.url) || { text: 'x' }, NOW);
    expect(lines.map(l => l.label)).toEqual(['Searched', 'Why', 'Last visit']);
    expect(I.whyOf(tab.url).text).toBe('for the grid article');
  });
  it('ignores itself, a non-web opener, and switched-off', () => {
    expect(I.record(tab, tab)).toBe(null);
    expect(I.record(tab, { id: 'x', url: 'vex://start' })).toBe(null);
    I.setEnabled(false);
    expect(I.record(tab, opener)).toBe(null);
  });
  it('keeps nothing for a private tab', () => {
    window.VexTabPolicy = { canPersist: (t) => t.id !== 't2' };
    expect(I.record(tab, opener)).toBe(null);
    expect(() => I.setWhy(tab, 'secret')).toThrow(/private tab keeps nothing/);
  });
  it('forgets a closed tab', () => {
    I.record(tab, opener);
    I.forget('t2');
    expect(I.intentOf('t2')).toBe(null);
  });
});

describe('setWhy()', () => {
  const tab = { id: 't', url: 'https://a.test/x' };
  it('clears with an empty line, and refuses a long one', () => {
    I.setWhy(tab, 'read later');
    I.setWhy(tab, '');
    expect(I.whyOf(tab.url)).toBe(null);
    expect(() => I.setWhy(tab, 'x'.repeat(200))).toThrow(/160/);
    expect(() => I.setWhy({ id: 'n', url: 'vex://start' }, 'a')).toThrow(/Only a web page/);
  });
  it('keeps only the newest hundred', () => {
    for (let i = 0; i < 105; i++) { I.setWhy({ id: 'x' + i, url: 'https://a.test/' + i }, 'n' + i); }
    expect(Object.keys(I.whyNotes())).toHaveLength(100);
  });
  it('raises when the stored notes are unreadable', () => {
    localStorage.setItem('vex.tabIntent.notes', '{broken');
    expect(() => I.whyNotes()).toThrow(/could not be read/);
  });
});

describe('decorate()', () => {
  const card = () => { const d = document.createElement('div'); d.innerHTML = '<div class="preview-info"><div class="preview-title"></div><div class="preview-url"></div></div>'; return d; };
  it('adds the lines to the hover card and takes them away again', () => {
    I.record({ id: 'a', url: 'https://a.test/' }, { id: 'o', title: 'Origin', url: 'https://o.test/' });
    const el = card();
    expect(I.decorate(el, { id: 'a', url: 'https://a.test/' })).toBe(true);
    expect(el.querySelector('.preview-intent').textContent).toContain('From: Origin');
    expect(I.decorate(el, { id: 'zzz', url: 'https://nothing.test/' })).toBe(false);
    expect(el.querySelector('.preview-intent')).toBe(null);
  });
  it('leaves the card as it was when switched off', () => {
    I.record({ id: 'a', url: 'https://a.test/' }, { id: 'o', title: 'Origin', url: 'https://o.test/' });
    I.setEnabled(false);
    const el = card();
    expect(I.decorate(el, { id: 'a', url: 'https://a.test/' })).toBe(false);
    expect(el.querySelector('.preview-intent')).toBe(null);
  });
});

describe('tab reason Settings entry points', () => {
  it('exposes the command switch next to revisit reminders, without enabling it implicitly', async () => {
    const { VexTabReason: R } = fresh(JS + 'tab-reason.js');
    window.VexSettingsGroup = fresh(JS + 'settings-group.js').VexSettingsGroup;
    I.setEnabled(false);
    const body = document.createElement('div');
    R.buildSettings(body);
    const master = body.querySelector('[data-tab-intent-switch]');
    expect(master.checked).toBe(false);
    expect(body.querySelector('input[aria-label="Ask about a tab I come back to after a while"]').checked).toBe(true);
    expect(I.enabled()).toBe(false);
    window.showToast = vi.fn();
    await I.askWhy();
    expect(window.showToast).toHaveBeenCalledWith(expect.stringContaining('Show tab origins and written reasons'), 'info');
  });

  it('keeps both command switches synchronized and does not change reminder preferences', () => {
    const { VexTabReason: R } = fresh(JS + 'tab-reason.js');
    window.VexSettingsGroup = fresh(JS + 'settings-group.js').VexSettingsGroup;
    R.savePrefs({ revisit: false, days: 12 }); I.setEnabled(false);
    const one = document.createElement('div'), two = document.createElement('div');
    document.body.append(one, two); R.buildSettings(one); I.controls(two);
    const first = one.querySelector('[data-tab-intent-switch]'), second = two.querySelector('[data-tab-intent-switch]');
    first.checked = true; first.dispatchEvent(new Event('change'));
    expect(I.enabled()).toBe(true); expect(second.checked).toBe(true);
    second.checked = false; second.dispatchEvent(new Event('change'));
    expect(I.enabled()).toBe(false); expect(first.checked).toBe(false);
    expect(R.prefs()).toEqual({ revisit: false, days: 12 });
    one.remove(); two.remove();
  });
});
