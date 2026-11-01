// @vitest-environment jsdom
//
// More from the creator (js/maker-repos.js): the filters, sort and counts over fixture data; the window opens a project in a NEW
// tab and never in the current one; the refresh button asks main only when pressed, shows a failure and is off in a private
// window; every label has Turkish; no emoji.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const { VexI18nUI } = require('../../src/renderer/js/i18n-ui.js');
globalThis.VexI18nUI = VexI18nUI;
require('../../src/renderer/js/faq-tr.js');
const { VexSettingsGroups } = require('../../src/renderer/js/vex-settings-groups.js');
globalThis.VexSettingsGroups = VexSettingsGroups;
globalThis.escapeHtml = window.escapeHtml = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c]));
const { VexMakerRepos: M } = require('../../src/renderer/js/maker-repos.js');
const tr = VexI18nUI.TABLE.tr;

const r = (name, o = {}) => ({ name, description: name + ' does a thing', language: 'JavaScript', stars: 0, forks: 0, topics: [], license: null, updatedAt: '2026-10-01T00:00:00.000Z', pushedAt: '2026-10-01T00:00:00.000Z', archived: false, fork: false, homepage: '', url: 'https://github.com/0xmortuex/' + name, ...o });
const FIX = [
  r('Vex', { stars: 20, forks: 4, topics: ['browser', 'electron'], license: 'MIT', updatedAt: '2026-10-30T00:00:00.000Z', pushedAt: '2026-10-30T00:00:00.000Z' }),
  r('mcp-a', { stars: 5, forks: 1, language: 'Python', topics: ['mcp', 'tools'], updatedAt: '2026-09-01T00:00:00.000Z', pushedAt: '2026-09-15T00:00:00.000Z' }),
  r('mcp-b', { stars: 1, language: 'Python', topics: ['mcp'], updatedAt: '2026-08-01T00:00:00.000Z', pushedAt: '2026-10-20T00:00:00.000Z' }),
  r('lua-thing', { stars: 3, language: 'Lua', description: 'Anti cheat notes' }),
  r('old-fork', { stars: 2, fork: true, language: 'C' }),
  r('retired', { stars: 7, archived: true, language: 'Go', topics: ['browser'] }),
  r('no-lang', { stars: 0, language: null }),
];
const f = (over = {}) => ({ ...M.defaultFilters(), ...over });
const names = (list) => list.map(x => x.name);

describe('filter, sort and counts', () => {
  it('shows originals only by default, most stars first', () => {
    expect(names(M.filter(FIX, f()))).toEqual(['Vex', 'mcp-a', 'lua-thing', 'mcp-b', 'no-lang']);
  });

  it('the type toggles add forks and archived ones', () => {
    expect(names(M.filter(FIX, f({ types: { original: false, fork: true, archived: false } })))).toEqual(['old-fork']);
    expect(names(M.filter(FIX, f({ types: { original: true, fork: true, archived: true } })))).toHaveLength(7);
    expect(M.filter(FIX, f({ types: { original: false, fork: false, archived: false } }))).toEqual([]);
  });

  it('searches name, description and topic, every word needed, ignoring case', () => {
    expect(names(M.filter(FIX, f({ q: 'ANTI cheat' })))).toEqual(['lua-thing']);
    expect(names(M.filter(FIX, f({ q: 'electron' })))).toEqual(['Vex']);
    expect(names(M.filter(FIX, f({ q: 'mcp' })))).toEqual(['mcp-a', 'mcp-b']);
    expect(M.filter(FIX, f({ q: 'mcp electron' }))).toEqual([]);
  });

  it('language chips are multi-select, topic chips match any chosen topic', () => {
    expect(names(M.filter(FIX, f({ langs: ['Python', 'Lua'] })))).toEqual(['mcp-a', 'lua-thing', 'mcp-b']);
    expect(names(M.filter(FIX, f({ topics: ['browser', 'tools'] })))).toEqual(['Vex', 'mcp-a']);
  });

  it('minimum stars', () => {
    expect(names(M.filter(FIX, f({ minStars: 5 })))).toEqual(['Vex', 'mcp-a']);
    expect(names(M.filter(FIX, f({ minStars: 25 })))).toEqual([]);
  });

  it('every sort', () => {
    const all = f({ types: { original: true, fork: true, archived: true } });
    expect(names(M.filter(FIX, { ...all, sort: 'name' }))).toEqual(['lua-thing', 'mcp-a', 'mcp-b', 'no-lang', 'old-fork', 'retired', 'Vex']);
    expect(names(M.filter(FIX, { ...all, sort: 'forks' })).slice(0, 2)).toEqual(['Vex', 'mcp-a']);
    expect(names(M.filter(FIX, { ...all, sort: 'updated' }))[0]).toBe('Vex');
    expect(names(M.filter(FIX, { ...all, sort: 'pushed' })).slice(0, 3)).toEqual(['Vex', 'mcp-b', 'lua-thing']);
    expect(() => M.sort(FIX, 'nope')).toThrow(/Unknown sort/);
  });

  it('totals follow the list', () => {
    expect(M.totals(M.filter(FIX, f()))).toEqual({ projects: 5, stars: 29, forks: 5 });
    expect(M.totals(M.filter(FIX, f({ q: 'mcp' })))).toEqual({ projects: 2, stars: 6, forks: 1 });
  });

  it('facets count each chip over the other filters', () => {
    const fa = M.facets(FIX, f());
    expect(fa.languages.find(l => l.name === 'Python').count).toBe(2);
    expect(fa.languages.find(l => l.name === 'Go')).toBeUndefined();   // the archived one is hidden by default
    expect(fa.topics.map(t => t.name)).toContain('mcp');
    const withPython = M.facets(FIX, f({ langs: ['Python'] }));
    expect(withPython.languages.find(l => l.name === 'JavaScript').count).toBe(1);   // the language facet ignores its own filter
    expect(withPython.topics.find(t => t.name === 'electron')).toBeUndefined();      // topics follow the language
    expect(M.facets(FIX, f({ langs: ['Lua'], minStars: 100 })).languages.find(l => l.name === 'Lua').count).toBe(0);
  });

  it('offers at most ten topic chips', () => {
    const many = Array.from({ length: 15 }, (_, i) => r('t' + i, { topics: ['topic' + i] }));
    expect(M.facets(many, f()).topics).toHaveLength(10);
  });

  it('says how long ago in the language on screen', () => {
    const now = Date.parse('2026-11-01T00:00:00Z');
    expect(M.ago('2026-10-29T00:00:00Z', now, 'en')).toBe('3 days ago');
    expect(M.ago('2026-10-29T00:00:00Z', now, 'tr')).toBe('3 gün önce');
  });

  it('uses the refreshed copy only when it is newer than the snapshot', () => {
    const snap = { fetchedAt: '2026-11-01T00:00:00.000Z', repos: FIX };
    expect(M.pick(snap, null).kind).toBe('snapshot');
    expect(M.pick(snap, { fetchedAt: '2026-10-01T00:00:00.000Z', repos: [] }).kind).toBe('snapshot');
    expect(M.pick(snap, { fetchedAt: '2026-11-02T00:00:00.000Z', repos: [] }).kind).toBe('refreshed');
    expect(() => M.pick(null, null)).toThrow();
  });
});

describe('the window', () => {
  let tabs, vexApi;
  beforeEach(() => {
    document.body.innerHTML = '';
    globalThis.VexMakerReposData = { login: '0xmortuex', fetchedAt: '2026-10-31T10:00:00.000Z', repos: FIX };
    tabs = { createTab: vi.fn(), navigate: vi.fn() };
    globalThis.TabManager = tabs;
    vexApi = { makerReposStored: vi.fn(async () => null), makerReposRefresh: vi.fn() };
    window.vex = vexApi;
    window.VexTabPolicy = { isPrivateWindow: false };
    window.showToast = vi.fn();
    Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => {}) } });
  });
  const rows = () => [...document.querySelectorAll('#mr-list .mr-item')];
  const click = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }));

  it('draws the header, the filter bar and the rows, with the Vex row marked', async () => {
    await M.open();
    expect(document.querySelector('#vex-maker-repos [role="dialog"]')).toBeTruthy();
    expect(document.querySelector('.mr-by').textContent).toContain('0xmortuex');
    expect(document.getElementById('mr-stats').textContent).toContain('7');
    expect(document.getElementById('mr-source').textContent).toMatch(/^Snapshot of /);
    expect(rows().map(x => x.querySelector('.mr-name').textContent)).toEqual(['Vex', 'mcp-a', 'lua-thing', 'mcp-b', 'no-lang']);
    expect(rows()[0].textContent).toContain('You are using this');
    expect(rows()[1].textContent).not.toContain('You are using this');
    expect(document.getElementById('mr-count').textContent).toBe('Showing 5 of 7');
    expect(document.querySelector('.mr-privacy').textContent).toBe('Nothing is contacted until you press Refresh.');
    expect(vexApi.makerReposRefresh).not.toHaveBeenCalled();
  });

  it('filters live, and Clear filters puts everything back', async () => {
    await M.open();
    const q = document.getElementById('mr-q');
    q.value = 'mcp'; q.dispatchEvent(new Event('input', { bubbles: true }));
    expect(rows()).toHaveLength(2);
    expect(document.getElementById('mr-count').textContent).toBe('Showing 2 of 7');
    click(document.querySelector('[data-lang="Python"]'));
    expect(rows()).toHaveLength(2);
    click(document.querySelector('[data-type="archived"]'));
    expect(document.querySelector('[data-type="archived"]').getAttribute('aria-pressed')).toBe('true');
    click(document.getElementById('mr-clear'));
    expect(q.value).toBe('');
    expect(rows()).toHaveLength(5);
  });

  it('says so when nothing matches', async () => {
    await M.open();
    const q = document.getElementById('mr-q');
    q.value = 'zzzzzz'; q.dispatchEvent(new Event('input', { bubbles: true }));
    expect(document.querySelector('.mr-empty').textContent).toBe('No projects match these filters.');
  });

  it('opens GitHub in a NEW tab, closes the window, and never navigates the current tab', async () => {
    await M.open();
    click(rows()[0].querySelector('[data-open]'));
    expect(tabs.createTab).toHaveBeenCalledWith('https://github.com/0xmortuex/Vex', true);
    expect(tabs.navigate).not.toHaveBeenCalled();
    expect(document.getElementById('vex-maker-repos')).toBeNull();
  });

  it('copies the link', async () => {
    await M.open();
    click(rows()[1].querySelector('[data-copy]'));
    await Promise.resolve();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://github.com/0xmortuex/mcp-a');
  });

  it('closes on Escape and gives focus back to what opened it', async () => {
    const opener = document.createElement('button'); document.body.appendChild(opener); opener.focus();
    await M.open();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.getElementById('vex-maker-repos')).toBeNull();
    await new Promise(res => setTimeout(res, 0));
    expect(document.activeElement).toBe(opener);
  });

  it('refresh asks main once when pressed, then shows the refreshed copy and date', async () => {
    vexApi.makerReposRefresh.mockResolvedValue({ login: '0xmortuex', fetchedAt: '2026-11-01T09:00:00.000Z', repos: [r('fresh', { stars: 9 })] });
    await M.open();
    click(document.getElementById('mr-refresh'));
    await new Promise(res => setTimeout(res, 0));
    expect(vexApi.makerReposRefresh).toHaveBeenCalledTimes(1);
    expect(document.getElementById('mr-source').textContent).toMatch(/^Refreshed /);
    expect(rows().map(x => x.querySelector('.mr-name').textContent)).toEqual(['fresh']);
  });

  it('shows the rate-limit message and keeps the list', async () => {
    vexApi.makerReposRefresh.mockRejectedValue(new Error("Error invoking remote method 'makerepos:refresh': Error: GitHub's limit for requests without a sign-in is used up. It resets at 13:25 (in about 25 minutes). Try again then."));
    await M.open();
    click(document.getElementById('mr-refresh'));
    await new Promise(res => setTimeout(res, 0));
    expect(document.getElementById('mr-alert').textContent).toBe("Could not refresh: GitHub's limit for requests without a sign-in is used up. It resets at 13:25 (in about 25 minutes). Try again then.");
    expect(rows()).toHaveLength(5);
    expect(document.getElementById('mr-source').textContent).toMatch(/^Snapshot of /);
    expect(document.getElementById('mr-refresh').disabled).toBe(false);
  });

  it('the refresh button is off in a private window and never calls main', async () => {
    window.VexTabPolicy = { isPrivateWindow: true };
    await M.open();
    const b = document.getElementById('mr-refresh');
    expect(b.disabled).toBe(true);
    click(b);
    expect(vexApi.makerReposRefresh).not.toHaveBeenCalled();
    expect(document.getElementById('mr-alert').textContent).toBe('Refresh is not available in a private window.');
  });

  it('prefers the refreshed copy kept on disk when it is newer', async () => {
    vexApi.makerReposStored.mockResolvedValue({ fetchedAt: '2026-11-01T00:00:00.000Z', repos: [r('kept', { stars: 4 })] });
    await M.open();
    expect(document.getElementById('mr-source').textContent).toMatch(/^Refreshed /);
    expect(rows()).toHaveLength(1);
  });

  it('shows an unreadable refreshed copy instead of hiding it', async () => {
    vexApi.makerReposStored.mockRejectedValue(new Error('The refreshed list on disk is not one Vex wrote'));
    await M.open();
    expect(document.getElementById('mr-alert').textContent).toContain('not one Vex wrote');
    expect(rows()).toHaveLength(5);
  });
});

describe('wiring, Turkish and no emoji', () => {
  const emoji = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u;

  it('is a late module, reachable from the Library, Ctrl+K and Settings, with a catalogue entry, details, manifest and FAQ', () => {
    expect(read('src/renderer/js/lazy-boot.js')).toContain("js/maker-repos.js");
    expect(read('src/renderer/index.html')).not.toContain('maker-repos.js');
    expect(read('src/renderer/js/feature-library.js')).toContain('flib-maker');
    expect(read('src/renderer/js/maker-repos.js')).toContain("registerCommand({ id: 'maker-repos', label: 'More from the creator'");
    expect(read('src/renderer/js/maker-repos.js')).toContain("VexSettingsGroups.register({ id: 'maker-repos'");
    for (const f of ['feature-catalog', 'feature-details', 'feature-manifests', 'faq-data']) expect(read('src/renderer/js/' + f + '.js')).toContain("'maker-repos'");
  });

  it('has Turkish for every label the window draws', () => {
    const words = ['More from the creator', 'Other public projects by the maker of Vex.', 'By', 'public projects', 'stars in total', 'forks in total', 'Refresh from GitHub',
      'Refreshing…', 'Nothing is contacted until you press Refresh.', 'Filters', 'Search name, description or topic', 'Minimum stars', 'Any number of stars', '1 or more', '5 or more',
      '25 or more', '100 or more', 'Sort by', 'Most stars', 'Recently updated', 'Recently pushed', 'Name A to Z', 'Most forks', 'Show', 'Original', 'Forks', 'Archived', 'Fork',
      'Clear filters', 'Languages', 'Topics', 'Stars', 'Projects', 'No topics', 'You are using this', 'Open on GitHub', 'Copy link', 'Link copied', 'Updated',
      'No projects match these filters.', 'Refresh is not available in a private window.', 'Open More from the creator'];
    for (const w of words) expect(tr[w], w).toBeTruthy();
    expect(tr['More from the creator']).toBe('Yapımcının diğer çalışmaları');
    for (const t of ['Snapshot of {1}', 'Refreshed {1}', 'Showing {1} of {2}', '{1} stars in these', 'Open {1} on GitHub', 'Copy the link to {1}', 'Could not refresh: {1}']) expect(tr[t], t).toBeTruthy();
    for (const k of ['Snapshot of 31 Oct 2026', 'Showing 5 of 7', 'Could not refresh: GitHub answered 500']) expect(VexI18nUI.lookup(k, 'tr'), k).toBeTruthy();
    expect(VexI18nUI.lookup('Showing 5 of 7', 'tr')).toBe('7 projeden 5 tanesi gösteriliyor');
    expect(VexI18nUI.lookup("GitHub's limit for requests without a sign-in is used up. It resets at 13:25 (in about 25 minutes). Try again then.", 'tr')).toContain('13:25');
  });

  it('has no emoji in the module, its stylesheet, the snapshot or the script', () => {
    for (const f of ['src/renderer/js/maker-repos.js', 'src/renderer/css/maker-repos.css', 'src/renderer/js/maker-repos-data.js', 'scripts/update-maker-repos.js', 'src/main/maker-repos.js']) {
      expect(emoji.test(read(f)), f).toBe(false);
    }
  });

  it('is in package.json as update:maker and in RELEASING.md', () => {
    expect(JSON.parse(read('package.json')).scripts['update:maker']).toBe('node scripts/update-maker-repos.js');
    expect(read('RELEASING.md')).toContain('update:maker');
  });
});
