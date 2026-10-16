// @vitest-environment jsdom
//
// js/vex-tr.js (T1-027): Turkish casing, search folding, collation, amounts, days
// and clocks; and the places that use it (command bar scorer, tab results, notes,
// bookmarks search, universal search, the reminder / snooze / due-date parsers).
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { VexTr } = require('../../src/renderer/js/vex-tr.js');
globalThis.VexTr = VexTr;
window.escapeHtml = (s) => String(s);

// A fixed "now": Monday 12 October 2026, 10:00 local.
const NOW = new Date(2026, 9, 12, 10, 0, 0, 0);

describe('casing', () => {
  it('lower-cases the Turkish way: I -> ı, İ -> i', () => {
    expect(VexTr.lower('IŞIK')).toBe('ışık');
    expect(VexTr.lower('İSTANBUL')).toBe('istanbul');
    expect(VexTr.lower('İ')).toBe('i');
    expect(VexTr.lower('I')).toBe('ı');
  });
  it('upper-cases the Turkish way: i -> İ, ı -> I', () => {
    expect(VexTr.upper('istanbul')).toBe('İSTANBUL');
    expect(VexTr.upper('ışık')).toBe('IŞIK');
  });
  it('leaves a combining-dot "i̇" out of the lower-cased İ', () => {
    expect(VexTr.lower('İ').length).toBe(1);
    expect('İ'.toLowerCase().length).toBe(2); // the English rule, which is the bug
  });
  it('compares case-insensitively without making ı and i the same letter', () => {
    expect(VexTr.equals('IŞIK', 'ışık')).toBe(true);
    expect(VexTr.equals('İzmir', 'izmir')).toBe(true);
    expect(VexTr.equals('Isparta', 'isparta')).toBe(false); // I is ı: "Isparta" != "isparta"
  });
  it('turns null and undefined into the empty string', () => {
    expect(VexTr.lower(null)).toBe('');
    expect(VexTr.fold(undefined)).toBe('');
  });
});

describe('fold (search form)', () => {
  it('makes "istanbul" find "İstanbul" and the other way round', () => {
    expect(VexTr.fold('İstanbul')).toBe('istanbul');
    expect(VexTr.fold('istanbul')).toBe('istanbul');
    expect(VexTr.fold('ISTANBUL')).toBe('istanbul');
    expect(VexTr.includes('Bugün İstanbul’da', 'istanbul')).toBe(true);
    expect(VexTr.includes('istanbul', 'İSTANBUL')).toBe(true);
  });
  it('finds a word typed without the Turkish letters', () => {
    expect(VexTr.includes('Şişli çarşı', 'sisli carsi')).toBe(true);
    expect(VexTr.includes('Işık Üniversitesi', 'isik universitesi')).toBe(true);
    expect(VexTr.fold('kâğıt')).toBe('kagit');
  });
  it('does not turn different words into one', () => {
    expect(VexTr.fold('kar')).not.toBe(VexTr.fold('kal'));
  });
});

describe('collation', () => {
  it('sorts the Turkish alphabet in its own order', () => {
    const sorted = ['zeytin', 'çay', 'cam', 'şeker', 'sut', 'ılık', 'iyi', 'ğ', 'g', 'ö', 'o', 'ü', 'u'].sort((a, b) => VexTr.compare(a, b));
    expect(sorted).toEqual(['cam', 'çay', 'g', 'ğ', 'ılık', 'iyi', 'o', 'ö', 'sut', 'şeker', 'u', 'ü', 'zeytin']);
  });
  it('can ignore case but keeps the accents', () => {
    expect(VexTr.compare('Işık', 'ışık', { ignoreCase: true })).toBe(0);
    expect(VexTr.compare('Isık', 'isik', { ignoreCase: true })).not.toBe(0);
  });
  it('sorts numbers inside text by value', () => {
    expect(['b10', 'b9', 'b1'].sort((a, b) => VexTr.compare(a, b))).toEqual(['b1', 'b9', 'b10']);
  });
});

describe('score', () => {
  it('ranks whole text, start, word start, inside, letters in order, nothing', () => {
    expect(VexTr.score('istanbul', 'İstanbul')).toBe(100);
    expect(VexTr.score('ist', 'İstanbul Rehberi')).toBe(90);
    expect(VexTr.score('reh', 'İstanbul Rehberi')).toBe(80);
    expect(VexTr.score('tanb', 'İstanbul Rehberi')).toBe(60);
    expect(VexTr.score('isr', 'İstanbul Rehberi')).toBe(35);
    expect(VexTr.score('xyz', 'İstanbul Rehberi')).toBe(0);
  });
  it('needs every word of the query, and the weakest word decides', () => {
    expect(VexTr.score('istanbul rehber', 'İstanbul Rehberi')).toBe(80);
    expect(VexTr.score('istanbul ankara', 'İstanbul Rehberi')).toBe(0);
  });
  it('can leave out the letters-in-order tier', () => {
    expect(VexTr.score('isr', 'İstanbul Rehberi', { fuzzy: false })).toBe(0);
    expect(VexTr.score('tanb', 'İstanbul Rehberi', { fuzzy: false })).toBe(60);
  });
  it('is 0 for an empty query', () => {
    expect(VexTr.score('  ', 'x')).toBe(0);
  });
});

describe('parseAmount', () => {
  it.each([
    ['1.234,56', 1234.56, null],
    ['1.234,56 TL', 1234.56, 'TRY'],
    ['₺1.250', 1250, 'TRY'],
    ['250 TL', 250, 'TRY'],
    ['12,5', 12.5, null],
    ['12,50 ₺', 12.5, 'TRY'],
    ['12.5', 12.5, null],
    ['$1,234.56', 1234.56, 'USD'],
    ['€99,90', 99.9, 'EUR'],
    ['1.234.567', 1234567, null],
    ['1000', 1000, null],
  ])('reads %s', (text, value, currency) => {
    const r = VexTr.parseAmount(text);
    expect(r.value).toBe(value);
    expect(r.currency).toBe(currency);
    expect(r.cents).toBe(Math.round(value * 100));
  });
  it.each(['', 'abc', '-5', '1,2,3', '12.345,6.7', '1..2'])('refuses %j', (text) => {
    expect(() => VexTr.parseAmount(text)).toThrow();
  });
});

describe('days and clocks', () => {
  it('reads dd.mm.yyyy, dd/mm/yyyy and two-digit years', () => {
    expect(VexTr.parseDay('15.03.2027', NOW).date).toEqual(new Date(2027, 2, 15));
    expect(VexTr.parseDay('15/03/2027', NOW).date).toEqual(new Date(2027, 2, 15));
    expect(VexTr.parseDay('1.2.27', NOW).date).toEqual(new Date(2027, 1, 1));
  });
  it('reads a day and Turkish month name, with or without a year', () => {
    expect(VexTr.parseDay('15 Mart 2027', NOW).date).toEqual(new Date(2027, 2, 15));
    expect(VexTr.parseDay('15 mart', NOW).date).toEqual(new Date(2027, 2, 15)); // 15 March 2026 has passed: next year
    expect(VexTr.parseDay('20 Ekim', NOW).date).toEqual(new Date(2026, 9, 20));
    expect(VexTr.parseDay('3 Şubat', NOW).date).toEqual(new Date(2027, 1, 3));
    expect(VexTr.parseDay('3 Eyl', NOW).date).toEqual(new Date(2027, 8, 3));
  });
  it('reads bugün, yarın, öbür gün and the weekdays', () => {
    expect(VexTr.parseDay('bugün', NOW).date).toEqual(new Date(2026, 9, 12));
    expect(VexTr.parseDay('Yarın', NOW).date).toEqual(new Date(2026, 9, 13));
    expect(VexTr.parseDay('öbür gün', NOW).date).toEqual(new Date(2026, 9, 14));
    expect(VexTr.parseDay('cuma', NOW).date).toEqual(new Date(2026, 9, 16));
    expect(VexTr.parseDay('pazartesi', NOW).date).toEqual(new Date(2026, 9, 19)); // said on a Monday: the next one
    expect(VexTr.parseDay('haftaya cuma', NOW).date).toEqual(new Date(2026, 9, 23));
    expect(VexTr.parseDay('çarşamba', NOW).date).toEqual(new Date(2026, 9, 14));
  });
  it('returns null for text that is not Turkish, and for a clock written with a dot', () => {
    expect(VexTr.parseDay('tomorrow', NOW)).toBeNull();
    expect(VexTr.parseDay('14.30', NOW)).toBeNull();
    expect(VexTr.parseDay('merhaba dünya', NOW)).toBeNull();
  });
  it('throws for a date that does not exist', () => {
    expect(() => VexTr.parseDay('31.02.2027', NOW)).toThrow(/not a real date/);
    expect(() => VexTr.parseDay('31 Şubat 2027', NOW)).toThrow(/not a real date/);
  });
  it('reads clocks', () => {
    expect(VexTr.parseClock('14:30')).toEqual({ hour: 14, minute: 30 });
    expect(VexTr.parseClock('14.30')).toEqual({ hour: 14, minute: 30 });
    expect(VexTr.parseClock('saat 9')).toEqual({ hour: 9, minute: 0 });
    expect(VexTr.parseClock('saat 14:05')).toEqual({ hour: 14, minute: 5 });
    expect(VexTr.parseClock('akşam 8')).toEqual({ hour: 20, minute: 0 });
    expect(VexTr.parseClock('sabah 9')).toEqual({ hour: 9, minute: 0 });
    expect(VexTr.parseClock('öğleden sonra 3')).toEqual({ hour: 15, minute: 0 });
    expect(VexTr.parseClock('gece 11')).toEqual({ hour: 23, minute: 0 });
    expect(VexTr.parseClock('gece 12')).toEqual({ hour: 0, minute: 0 });
    expect(VexTr.parseClock('öğlen')).toEqual({ hour: 12, minute: 0 });
    expect(VexTr.parseClock('gece yarısı')).toEqual({ hour: 0, minute: 0 });
    expect(VexTr.parseClock('akşam')).toEqual({ hour: 19, minute: 0 });
    expect(VexTr.parseClock('hello')).toBeNull();
    expect(() => VexTr.parseClock('25:00')).toThrow();
    expect(() => VexTr.parseClock('12:75')).toThrow();
  });
  it('reads a day with a clock', () => {
    expect(VexTr.parseWhen('yarın 14:30', NOW)).toEqual(new Date(2026, 9, 13, 14, 30));
    expect(VexTr.parseWhen('yarın', NOW)).toEqual(new Date(2026, 9, 13, 9, 0));
    expect(VexTr.parseWhen('15.03.2027 akşam 8', NOW)).toEqual(new Date(2027, 2, 15, 20, 0));
    expect(VexTr.parseWhen('cuma saat 17:00', NOW)).toEqual(new Date(2026, 9, 16, 17, 0));
    expect(VexTr.parseWhen('tomorrow 9am', NOW)).toBeNull();
    expect(() => VexTr.parseWhen('yarın blah', NOW)).toThrow(/time of day/);
  });
});

describe('the command bar scorer', () => {
  const { CommandBar } = require('../../src/renderer/js/command.js');
  it('matches a label with İ from a query typed with i, and I', () => {
    const c = { id: 'x', label: 'İstanbul haritası', hint: '' };
    expect(CommandBar._scoreCommand('istanbul', c)).toBe(100);
    expect(CommandBar._scoreCommand('ISTANBUL', c)).toBe(100);
    expect(CommandBar._scoreCommand('haritasi', c)).toBe(85);
    expect(CommandBar._scoreCommand('zzz', c)).toBe(0);
  });
  it('finds the hint with the Turkish letters folded', () => {
    expect(CommandBar._scoreCommand('sisli', { id: 'y', label: 'Zzz', hint: 'Şişli toplantısı' })).toBe(45);
  });
  it('matches open tabs by a folded title', () => {
    globalThis.TabManager = { tabs: [{ id: 't1', title: 'İzmir Haberleri', url: 'https://izmir.example/' }], activeTabId: 'other' };
    window.showToast = vi.fn();
    const r = CommandBar._tabResults('izmir');
    expect(r.map(x => x.id)).toEqual(['tab:t1']);
    delete globalThis.TabManager;
  });
});

describe('notes, bookmarks, universal search', () => {
  it('finds a note by the other spelling of İ', async () => {
    const { NotesPanel } = await import('../../src/renderer/js/notes-panel.js');
    const note = { id: 'n', title: 'İstanbul gezisi', content: '', tags: ['Işık'] };
    expect(NotesPanel.matches(note, 'istanbul')).toBe(true);
    expect(NotesPanel.matches(note, 'isik')).toBe(true);
    expect(NotesPanel.matches(note, 'ankara')).toBe(false);
  });
  it('sorts notes by title and tags in Turkish order', async () => {
    const { NotesPanel } = await import('../../src/renderer/js/notes-panel.js');
    const notes = ['Zeytin', 'Çay', 'Cam', 'Şeker', 'Sut'].map((title, i) => ({ id: 'n' + i, title, content: '', tags: [] }));
    expect(NotesPanel.sortNotes(notes, 'title').map(n => n.title)).toEqual(['Cam', 'Çay', 'Sut', 'Şeker', 'Zeytin']);
    expect(NotesPanel.allTags(['Işık', 'ısı', 'iyi', 'İlk'].map((t, i) => ({ id: 'a' + i, tags: [t] })))).toEqual(['ısı', 'Işık', 'İlk', 'iyi']);
  });
  it('universal search ranks İstanbul for "istanbul"', () => {
    const { UniversalSearch } = require('../../src/renderer/js/universal-search.js');
    const hits = UniversalSearch.search('istanbul', [{ type: 'note', id: '1', title: 'İstanbul planı' }, { type: 'note', id: '2', title: 'Ankara' }]);
    expect(hits.map(h => h.id)).toEqual(['1']);
  });
});

describe('the reminder, snooze and due-date parsers', () => {
  it('quick reminder reads Turkish days and clocks, and still reads English', () => {
    const { VexQuickReminder } = require('../../src/renderer/js/quick-reminder.js');
    expect(VexQuickReminder.parseWhen('yarın 14:30', NOW)).toEqual(new Date(2026, 9, 13, 14, 30));
    expect(VexQuickReminder.parseWhen('15 Kasım saat 9', NOW)).toEqual(new Date(2026, 10, 15, 9, 0));
    expect(VexQuickReminder.parseWhen('cuma 17:00', NOW)).toEqual(new Date(2026, 9, 16, 17, 0));
    expect(VexQuickReminder.parseWhen('tomorrow 9am', NOW)).toEqual(new Date(2026, 9, 13, 9, 0));
    expect(() => VexQuickReminder.parseWhen('31 Şubat', NOW)).toThrow(/not a real date/);
    expect(() => VexQuickReminder.parseWhen('blah blah', NOW)).toThrow(/Could not read/);
  });
  it('snooze reads Turkish and refuses an impossible date', () => {
    const { VexSnooze } = require('../../src/renderer/js/snooze-anything.js');
    const at = (text) => { const r = VexSnooze.parseWhen(text, NOW.getTime()); return r && new Date(r.at); };
    expect(at('yarın sabah')).toEqual(new Date(2026, 9, 13, 9, 0));
    expect(at('bu akşam')).toEqual(new Date(2026, 9, 12, 19, 0));
    expect(at('hafta sonu')).toEqual(new Date(2026, 9, 17, 10, 0));
    expect(at('haftaya')).toEqual(new Date(2026, 9, 19, 9, 0));
    expect(at('31 Şubat')).toBeNull();
    expect(at('nonsense words')).toBeNull();
  });
  it('meeting actions read a Turkish due date', () => {
    const { MeetingCopilot } = require('../../src/renderer/js/meeting-copilot.js');
    expect(MeetingCopilot.parseDue('Raporu gönder, son tarih 15.03.2027', NOW)).toBe('2027-03-15');
    expect(MeetingCopilot.parseDue('Raporu gönder 15 Kasım’a kadar', NOW)).toBe('2026-11-15');
    expect(MeetingCopilot.parseDue('Raporu gönder yarına kadar', NOW)).toBe('2026-10-13');
    expect(MeetingCopilot.parseDue('Raporu gönder cumaya kadar', NOW)).toBe('2026-10-16');
    expect(MeetingCopilot.parseDue('Raporu gönder 31 Şubat’a kadar', NOW)).toBe('');
    expect(MeetingCopilot.parseDue('call Sam by tomorrow', NOW)).toBe('2026-10-13');
  });
  it('expenses accept "250 TL" in Turkish lira and the Turkish number format', () => {
    const { Expenses } = require('../../src/renderer/js/expenses.js');
    expect(Expenses.parseAmount('250 TL', 'TRY')).toBe(25000);
    expect(Expenses.parseAmount('₺1.234,50', 'TRY')).toBe(123450);
    expect(() => Expenses.parseAmount('250 TL', 'USD')).toThrow(/not in USD/);
  });
});
