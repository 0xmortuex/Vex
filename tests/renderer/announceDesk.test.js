// @vitest-environment jsdom
//
// js/announce-desk.js (T1-028): school / university / exam pages as page watches, a
// "new since last visit" desk, and a result-day watcher that speaks once.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

globalThis.VexTr = require('../../src/renderer/js/vex-tr.js').VexTr;
const { PageWatch } = require('../../src/renderer/js/page-watch.js');
globalThis.PageWatch = PageWatch;
const { PageWatchDiff } = require('../../src/renderer/js/page-watch-diff.js');
globalThis.PageWatchDiff = PageWatchDiff;
const { AnnounceDesk } = require('../../src/renderer/js/announce-desk.js');
globalThis.AnnounceDesk = AnnounceDesk;

const NOW = new Date(2026, 6, 24, 9, 30, 0, 0);   // 24 July 2026, 09:30

function snapshots(id, ...texts) {
  const snaps = PageWatch._snaps();
  snaps[id] = texts.map((text, i) => ({ at: 1000 + i, text, hash: 'h' + i }));
  PageWatch._saveSnaps(snaps);
}

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  AnnounceDesk._now = () => NOW;
  window.showToast = vi.fn();
  window.vexPrompt = vi.fn();
  globalThis.TabManager = { createTab: vi.fn() };
  window.vex = { notify: vi.fn() };
  delete globalThis.VexAttention;
});
afterEach(() => { delete globalThis.VexAttention; delete globalThis.TabManager; delete window.vex; });

describe('adding a page', () => {
  it('makes a page watch of its own kind, polite by default, and remembers the desk\'s notes on it', () => {
    const w = AnnounceDesk.add({ label: 'Okul duyuruları', url: 'https://school.example/duyuru', resultWords: 'sonuç açıklandı; results', resultDate: '2026-07-24' });
    expect(w.source).toBe('announce-desk');
    expect(w.kind).toBe('text');
    expect(w.url).toBe('https://school.example/duyuru');
    const [{ entry }] = AnnounceDesk.pages();
    expect(entry.resultWords).toEqual(['sonuç açıklandı', 'results']);
    expect(entry.resultDate).toBe('2026-07-24');
  });
  it('asks the page once an hour, or every 15 minutes on its result day', () => {
    const w = AnnounceDesk.add({ label: 'A', url: 'https://a.example/' });
    expect(w.every).toBe(AnnounceDesk.POLITE_EVERY);
    expect(AnnounceDesk.wantedEvery({ resultDate: '2026-07-24' }, NOW)).toBe(AnnounceDesk.RESULT_DAY_EVERY);
    expect(AnnounceDesk.wantedEvery({ resultDate: '2026-07-25' }, NOW)).toBe(AnnounceDesk.POLITE_EVERY);
    expect(AnnounceDesk.wantedEvery({ resultDate: '2026-07-24', resultToldAt: 1 }, NOW)).toBe(AnnounceDesk.POLITE_EVERY);
  });
  it('refuses an address with a sign-in in it, a non-web address and a missing name', () => {
    expect(() => AnnounceDesk.add({ label: 'A', url: 'https://user:pass@a.example/' })).toThrow(/public pages only/);
    expect(() => AnnounceDesk.add({ label: 'A', url: 'file:///C:/x.html' })).toThrow(/web page/);
    expect(() => AnnounceDesk.add({ label: 'A', url: 'osym' })).toThrow(/full address/);
    expect(() => AnnounceDesk.add({ label: ' ', url: 'https://a.example/' })).toThrow(/name/);
    expect(() => AnnounceDesk.add({ label: 'A', url: 'https://a.example/', resultDate: '24.07.2026' })).toThrow(/YYYY|date/);
  });
  it('refuses a page on the home network (page watch rule) and a second copy of the same page', () => {
    expect(() => AnnounceDesk.add({ label: 'Router', url: 'http://192.168.1.1/' })).toThrow();
    AnnounceDesk.add({ label: 'A', url: 'https://a.example/' });
    expect(() => AnnounceDesk.add({ label: 'A2', url: 'https://a.example/' })).toThrow(/already/);
  });
  it('holds fifteen pages', () => {
    for (let i = 0; i < AnnounceDesk.MAX_PAGES; i++) AnnounceDesk.add({ label: 'P' + i, url: 'https://p' + i + '.example/' });
    expect(() => AnnounceDesk.add({ label: 'More', url: 'https://more.example/' })).toThrow(/holds 15/);
  });
  it('never adds a suggestion by itself', () => {
    expect(AnnounceDesk.pages()).toEqual([]);
    expect(AnnounceDesk.SUGGESTIONS.map(s => s.label)).toEqual(['ÖSYM', 'MEB', 'YÖK']);
    for (const s of AnnounceDesk.SUGGESTIONS) expect(() => AnnounceDesk.checkUrl(s.url)).not.toThrow();
    AnnounceDesk.tick(NOW);
    expect(PageWatch.list()).toEqual([]);
  });
  it('is refused while switched off', () => {
    AnnounceDesk.setEnabled(false);
    expect(() => AnnounceDesk.add({ label: 'A', url: 'https://a.example/' })).toThrow(/switched off/);
  });
});

describe('result words', () => {
  it('match across the Turkish letters and case', () => {
    expect(AnnounceDesk.matchWords(['SINAV SONUÇLARI AÇIKLANDI'], ['sonuçları açıklandı', 'sonuclari aciklandi', 'ek yerleştirme'])).toEqual(['sonuçları açıklandı', 'sonuclari aciklandi']);
    expect(AnnounceDesk.matchWords(['Duyuru: yeni tarih'], ['sonuç'])).toEqual([]);
  });
  it('cleans the words: trimmed, no repeats, at most eight', () => {
    expect(AnnounceDesk.cleanWords(' a ,b;b\n c ,, ')).toEqual(['a', 'b', 'c']);
    expect(AnnounceDesk.cleanWords('1,2,3,4,5,6,7,8,9,10')).toHaveLength(8);
  });
});

describe('when a page changes', () => {
  function setup(words = 'sonuç açıklandı') {
    const w = AnnounceDesk.add({ label: 'Sınav', url: 'https://exam.example/', resultWords: words });
    return w;
  }
  it('tells once when a result word appears in what is NEW, and stops asking the page', () => {
    const w = setup();
    snapshots(w.id, 'Duyurular\nHoş geldiniz', 'Duyurular\nHoş geldiniz\nSınav SONUÇ AÇIKLANDI.');
    AnnounceDesk.announce(PageWatch.list()[0]);
    expect(window.showToast).toHaveBeenCalledTimes(1);
    expect(window.showToast.mock.calls[0][0]).toMatch(/Sınav: the page now says "sonuç açıklandı"/);
    expect(PageWatch.list()[0].paused).toBe(true);
    expect(AnnounceDesk.state().pages[w.id].resultToldAt).toBeGreaterThan(0);
    // a second change does not tell again
    AnnounceDesk.announce(PageWatch.list()[0]);
    expect(window.showToast).toHaveBeenCalledTimes(1);
  });
  it('does not take a word that was already on the page for a result', () => {
    const w = setup();
    snapshots(w.id, 'Geçen yılın sonuç açıklandı duyurusu', 'Geçen yılın sonuç açıklandı duyurusu\nBaşvuru tarihleri');
    AnnounceDesk.announce(PageWatch.list()[0]);
    expect(PageWatch.list()[0].paused).toBe(false);
    expect(AnnounceDesk.state().pages[w.id].resultToldAt || 0).toBe(0);
  });
  it('a page without result words is an ordinary announcement: one useful line through the attention budget', () => {
    const w = AnnounceDesk.add({ label: 'Okul', url: 'https://school.example/' });
    snapshots(w.id, 'A', 'A\nB yeni duyuru');
    globalThis.VexAttention = { isMuted: () => false, notify: vi.fn((opts, show) => { show(); return { allow: true }; }), request: vi.fn(() => ({ allow: true })), osNotify: vi.fn(async () => ({})) };
    AnnounceDesk.announce(PageWatch.list()[0]);
    expect(globalThis.VexAttention.notify).toHaveBeenCalledTimes(1);
    expect(globalThis.VexAttention.notify.mock.calls[0][0]).toMatchObject({ feature: 'announce-desk', urgency: 'useful' });
    expect(PageWatch.list()[0].paused).toBe(false);
  });
  it('the result line is a reminder: critical, with a Windows notification', () => {
    const w = setup();
    snapshots(w.id, 'x', 'x\nsonuç açıklandı');
    globalThis.VexAttention = { isMuted: () => true, request: vi.fn(() => ({ allow: true })), osNotify: vi.fn(async () => ({})) };
    AnnounceDesk.announce(PageWatch.list()[0]);
    expect(globalThis.VexAttention.osNotify).toHaveBeenCalledWith(expect.objectContaining({ feature: 'announce-desk', urgency: 'critical' }));
    expect(window.showToast).toHaveBeenCalled();   // even a feature muted in the Inbox still delivers a result
  });
  it('page watch hands a desk page to the desk and not to its own toast', () => {
    const w = setup();
    snapshots(w.id, 'x', 'x\nsonuç açıklandı');
    PageWatch.announce(PageWatch.list()[0], { changed: true, to: 'z', why: 'changed' });
    expect(window.showToast).toHaveBeenCalledTimes(1);
    expect(window.showToast.mock.calls[0][0]).toMatch(/the page now says/);
    expect(window.vex.notify).not.toHaveBeenCalled();
  });
});

describe('the new lines', () => {
  it('are what is added since the look before', () => {
    const w = AnnounceDesk.add({ label: 'A', url: 'https://a.example/' });
    snapshots(w.id, 'one\ntwo', 'one\ntwo\nthree\nfour');
    expect(AnnounceDesk.newLines(w.id)).toEqual(['three', 'four']);
  });
  it('are none with a single look', () => {
    const w = AnnounceDesk.add({ label: 'A', url: 'https://a.example/' });
    snapshots(w.id, 'one');
    expect(AnnounceDesk.newLines(w.id)).toEqual([]);
  });
});

describe('the daily tick', () => {
  it('speeds a page up on its result day, reminds once in the morning, and slows it after', () => {
    const w = AnnounceDesk.add({ label: 'Sınav', url: 'https://exam.example/', resultWords: 'sonuç', resultDate: '2026-07-24' });
    expect(AnnounceDesk.tick(NOW)).toEqual([]);   // already at 15 minutes: added on the day
    expect(window.showToast).toHaveBeenCalledTimes(1);
    expect(window.showToast.mock.calls[0][0]).toMatch(/Result day for Sınav/);
    AnnounceDesk.tick(NOW);
    expect(window.showToast).toHaveBeenCalledTimes(1);   // once
    expect(PageWatch.list()[0].every).toBe(AnnounceDesk.RESULT_DAY_EVERY);
    expect(AnnounceDesk.tick(new Date(2026, 6, 25, 9, 0))).toEqual([w.id]);
    expect(PageWatch.list()[0].every).toBe(AnnounceDesk.POLITE_EVERY);
  });
  it('does not remind before eight in the morning', () => {
    AnnounceDesk.add({ label: 'Sınav', url: 'https://exam.example/', resultDate: '2026-07-24' });
    AnnounceDesk.tick(new Date(2026, 6, 24, 6, 0));
    expect(window.showToast).not.toHaveBeenCalled();
  });
});

describe('the switch', () => {
  it('off pauses what was running and puts back only that; a page you paused stays paused', () => {
    const a = AnnounceDesk.add({ label: 'A', url: 'https://a.example/' });
    const b = AnnounceDesk.add({ label: 'B', url: 'https://b.example/' });
    PageWatch.setPaused(b.id, true);
    AnnounceDesk.setEnabled(false);
    expect(PageWatch.list().map(w => w.paused)).toEqual([true, true]);
    AnnounceDesk.setEnabled(true);
    expect(PageWatch.list().find(w => w.id === a.id).paused).toBe(false);
    expect(PageWatch.list().find(w => w.id === b.id).paused).toBe(true);
  });
  it('off, the tick does nothing', () => {
    AnnounceDesk.add({ label: 'A', url: 'https://a.example/', resultDate: '2026-07-24' });
    AnnounceDesk.setEnabled(false);
    expect(AnnounceDesk.tick(NOW)).toEqual([]);
    expect(window.showToast).not.toHaveBeenCalled();
  });
  it('removing a page removes its watch and its notes', () => {
    const w = AnnounceDesk.add({ label: 'A', url: 'https://a.example/', resultWords: 'x' });
    AnnounceDesk.remove(w.id);
    expect(PageWatch.list()).toEqual([]);
    expect(AnnounceDesk.state().pages[w.id]).toBeUndefined();
  });
});

describe('the desk', () => {
  it('lists the pages with what is new highlighted, and the suggestions fill the boxes without adding', () => {
    globalThis.VexSettingsGroups = require('../../src/renderer/js/vex-settings-groups.js').VexSettingsGroups;
    const w = AnnounceDesk.add({ label: 'Okul', url: 'https://school.example/', resultWords: 'sonuç' });
    const list = PageWatch.list(); list[0].lastChangedAt = 5000; list[0].seenAt = 0; PageWatch._save(list);
    snapshots(w.id, 'a', 'a\nyeni burs duyurusu');
    AnnounceDesk.open();
    const card = document.querySelector('#announce-desk .ad-page');
    expect(card.classList.contains('fresh')).toBe(true);
    expect([...card.querySelectorAll('.ad-new li')].map(li => li.textContent)).toEqual(['yeni burs duyurusu']);
    const chips = [...document.querySelectorAll('#announce-desk .ad-chips button')];
    expect(chips.map(c => c.textContent)).toEqual(['ÖSYM', 'MEB', 'YÖK']);
    chips[0].click();
    expect(document.querySelectorAll('#announce-desk .ad-form input')[1].value).toBe('https://www.osym.gov.tr/');
    expect(PageWatch.list()).toHaveLength(1);
    delete globalThis.VexSettingsGroups;
  });
  it('Mark as seen clears the highlight', () => {
    globalThis.VexSettingsGroups = require('../../src/renderer/js/vex-settings-groups.js').VexSettingsGroups;
    const w = AnnounceDesk.add({ label: 'Okul', url: 'https://school.example/' });
    const list = PageWatch.list(); list[0].lastChangedAt = Date.now() - 1000; list[0].seenAt = 0; PageWatch._save(list);
    snapshots(w.id, 'a', 'a\nb');
    AnnounceDesk.open();
    [...document.querySelectorAll('#announce-desk .ad-actions button')].find(b => b.textContent === 'Mark as seen').click();
    expect(document.querySelector('#announce-desk .ad-page').classList.contains('fresh')).toBe(false);
    delete globalThis.VexSettingsGroups;
  });
});
