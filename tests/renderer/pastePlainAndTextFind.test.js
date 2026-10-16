// @vitest-environment jsdom
//
// js/paste-plain.js (T3-056) and js/tab-text-find.js with TabContentIndex.searchText (T3-057).
import { describe, it, expect, vi, beforeEach } from 'vitest';

globalThis.VexIcons = { has: () => true, svg: (name) => '<svg data-icon="' + name + '"></svg>' };
const { VexTr } = require('../../src/renderer/js/vex-tr.js');
globalThis.VexTr = VexTr;
const { VexPickList } = require('../../src/renderer/js/pick-list.js');
globalThis.VexPickList = VexPickList;
const { VexPastePlain } = require('../../src/renderer/js/paste-plain.js');
const { TabContentIndex } = require('../../src/renderer/js/tab-content-index.js');
globalThis.TabContentIndex = TabContentIndex;
const { VexTabTextFind } = require('../../src/renderer/js/tab-text-find.js');

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  window.showToast = vi.fn();
});

describe('Paste as plain text', () => {
  it('adds its row to an editable field\'s menu, greyed out when there is nothing to paste', () => {
    const wv = { pasteAndMatchStyle: vi.fn(), focus: vi.fn() };
    const rows = VexPastePlain.menuRows(wv, { isEditable: true, editFlags: { canPaste: true } });
    expect(rows.map(r => r.label)).toEqual(['Paste as plain text']);
    expect(rows[0].disabled).toBe(false);
    expect(VexPastePlain.menuRows(wv, { isEditable: true, editFlags: { canPaste: false } })[0].disabled).toBe(true);
    rows[0].action();
    expect(wv.focus).toHaveBeenCalled();
    expect(wv.pasteAndMatchStyle).toHaveBeenCalledTimes(1);
  });

  it('has no row outside a field, nor when switched off', () => {
    const wv = { pasteAndMatchStyle: vi.fn() };
    expect(VexPastePlain.menuRows(wv, { isEditable: false })).toEqual([]);
    VexPastePlain.setEnabled(false);
    expect(VexPastePlain.menuRows(wv, { isEditable: true })).toEqual([]);
    expect(() => VexPastePlain.paste(wv)).toThrow(/switched off/);
  });

  it('says so out loud when the page cannot paste, instead of doing nothing', () => {
    const rows = VexPastePlain.menuRows({}, { isEditable: true });
    rows[0].action();
    expect(window.showToast).toHaveBeenCalledWith(expect.stringMatching(/no page to paste into/), 'error');
  });

  it('pastes into the tab in front from Ctrl+K', () => {
    const wv = { pasteAndMatchStyle: vi.fn(), focus: vi.fn() };
    globalThis.WebviewManager = { getActiveWebview: () => wv };
    VexPastePlain.pasteIntoActive();
    expect(wv.pasteAndMatchStyle).toHaveBeenCalled();
    globalThis.WebviewManager = { getActiveWebview: () => null };
    expect(() => VexPastePlain.pasteIntoActive()).toThrow(/Open a page first/);
  });
});

describe('TabContentIndex.searchText', () => {
  beforeEach(() => {
    TabContentIndex.clear();
    TabContentIndex._byTab.set('t1', { url: 'https://a.example/', title: 'A', words: new Set(), at: 1, text: 'Our refund policy says a refund takes five days. Ask about a Refund anytime.' });
    TabContentIndex._byTab.set('t2', { url: 'https://b.example/', title: 'B', words: new Set(), at: 2, text: 'İstanbul haritası ve Şişli yolu' });
    TabContentIndex._byTab.set('t3', { url: 'https://c.example/', title: 'C', words: new Set(), at: 3, text: '' });
  });

  it('finds the exact words, counts them and quotes the words around the first', () => {
    const hits = TabContentIndex.searchText('refund');
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ tabId: 't1', count: 3 });
    expect(hits[0].before).toBe('Our ');
    expect(hits[0].match).toBe('refund');
    expect(hits[0].after.startsWith(' policy says')).toBe(true);
  });

  it('is not fuzzy: a part of a word is found, a different word is not, and nothing is stemmed', () => {
    expect(TabContentIndex.searchText('refun')).toHaveLength(1);        // literal text, as typed
    expect(TabContentIndex.searchText('refunds')).toEqual([]);
    expect(TabContentIndex.searchText('refnd')).toEqual([]);
  });

  it('does not tell the Turkish I and its accents apart, unless the words are in quotes', () => {
    expect(TabContentIndex.searchText('istanbul').map(h => h.tabId)).toEqual(['t2']);
    expect(TabContentIndex.searchText('sisli').map(h => h.tabId)).toEqual(['t2']);
    expect(TabContentIndex.searchText('"İstanbul"').map(h => h.tabId)).toEqual(['t2']);
    expect(TabContentIndex.searchText('"istanbul"')).toEqual([]);
    expect(TabContentIndex.searchText('"Refund"').map(h => h.count)).toEqual([1]);
  });

  it('needs two letters and skips a page whose text was trimmed away', () => {
    expect(TabContentIndex.searchText('r')).toEqual([]);
    expect(TabContentIndex.searchText('"x"')).toEqual([]);
  });

  it('keeps the page text and trims the oldest first when there is too much', async () => {
    TabContentIndex.clear();
    window.vexGuestEval = vi.fn(async () => 'alpha beta gamma '.repeat(10));
    const guest = { isConnected: true };
    await TabContentIndex.index('t1', guest, { id: 't1', url: 'https://a.example/', title: 'A' });
    expect(TabContentIndex._byTab.get('t1').text.startsWith('alpha beta gamma')).toBe(true);
    const was = TabContentIndex.MAX_TEXT_CHARS;
    TabContentIndex.MAX_TEXT_CHARS = 200;
    await TabContentIndex.index('t2', guest, { id: 't2', url: 'https://b.example/', title: 'B' });
    await TabContentIndex.index('t3', guest, { id: 't3', url: 'https://c.example/', title: 'C' });
    TabContentIndex.MAX_TEXT_CHARS = was;
    const kept = [...TabContentIndex._byTab.values()].filter(e => e.text).length;
    expect(kept).toBeLessThan(3);
    expect(TabContentIndex._byTab.size).toBe(3);       // the words of every page stay
  });
});

describe('Find text in all tabs', () => {
  function tabs() {
    globalThis.TabManager = {
      tabs: [
        { id: 't1', url: 'https://a.example/', title: 'Policies', favicon: null, pinned: true },
        { id: 't2', url: 'https://b.example/', title: 'Maps', favicon: null, sleeping: true },
        { id: 't3', url: 'https://c.example/', title: 'Never loaded', favicon: null },
        { id: 't4', url: 'vex://settings', title: 'Settings' },
      ],
      switchTab: vi.fn(),
    };
    globalThis.WebviewManager = { findInPage: vi.fn() };
    TabContentIndex.clear();
    TabContentIndex._byTab.set('t1', { url: 'https://a.example/', title: 'Policies', words: new Set(), at: 1, text: 'The refund window is thirty days from delivery.' });
    TabContentIndex._byTab.set('t2', { url: 'https://b.example/', title: 'Maps', words: new Set(), at: 2, text: 'Take the refund desk on the left.' });
  }

  it('says how many web tabs have no text to search yet', () => {
    tabs();
    expect(VexTabTextFind.coverage()).toEqual({ total: 3, ready: 2, waiting: 1 });
  });

  it('lists the tabs with the words, sleeping ones too, with the words around the first hit', () => {
    tabs();
    VexTabTextFind.open();
    const input = document.querySelector('#vex-pick-list input');
    input.value = 'refund'; input.dispatchEvent(new Event('input'));
    const titles = [...document.querySelectorAll('#vex-pick-list .tt-title')].map(e => e.textContent);
    expect(titles.sort()).toEqual(['Maps', 'Policies']);
    const subs = [...document.querySelectorAll('#vex-pick-list .tt-sub')].map(e => e.textContent);
    expect(subs.some(s => s.includes('«refund» window is thirty days'))).toBe(true);
    expect(document.querySelector('#vex-pick-list .tt-hint').textContent).toMatch(/1 of 3 tabs have not loaded yet/);
  });

  it('says nothing matches, and how many tabs it could not read', () => {
    tabs();
    VexTabTextFind.open();
    const input = document.querySelector('#vex-pick-list input');
    input.value = 'xylophone'; input.dispatchEvent(new Event('input'));
    expect(document.querySelector('#vex-pick-list .tt-empty').textContent).toMatch(/No open tab has those words \(1 not loaded yet\)/);
  });

  it('goes to the tab and marks the words in a page that is loaded, but not in one that is asleep', () => {
    tabs();
    VexTabTextFind.open();
    const input = document.querySelector('#vex-pick-list input');
    input.value = '"refund"'; input.dispatchEvent(new Event('input'));
    const enter = () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    enter();
    expect(TabManager.switchTab).toHaveBeenCalledTimes(1);
    const first = TabManager.switchTab.mock.calls[0][0];
    if (first === 't1') expect(WebviewManager.findInPage).toHaveBeenCalledWith('refund');
    else expect(WebviewManager.findInPage).not.toHaveBeenCalled();
  });

  it('is refused when switched off', () => {
    tabs();
    VexTabTextFind.setEnabled(false);
    expect(() => VexTabTextFind.open()).toThrow(/switched off/);
  });
});
